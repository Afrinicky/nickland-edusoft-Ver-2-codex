// Nickland Edusoft — Payments service (shared)
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// One place that records a fee payment and drives the receipt + delivery, used
// by the desktop, the mobile API, and (later) a gateway webhook. A payment can
// arrive electronically (mobile money / bank), at the accounts office, or as a
// bank-deposit slip — in every case, the moment it is ACKNOWLEDGED here the
// ledger is posted and a receipt is generated + auto-delivered.

const crypto = require('crypto');
const { postIncome } = require('../ipc/_ledger');
const { autoReceiptForPayment, autoDeliverReceipt } = require('../ipc/receipts_engine');
const { getNextReceiptNumber, getSetting } = require('../utils/idgen');
const { getGateway } = require('./gateways');
const { enqueueStudentSnapshot, postToOutbox } = require('./sync/outbox');

function todayISO() { return new Date().toISOString().slice(0, 10); }

// Record a fee payment against a student's current-term bill. Returns
// { ok, payment_id, receipt_number }. DB writes run in one transaction;
// receipt generation + delivery happen after commit (best-effort).
function recordFeePayment(db, data) {
  const amount = Number(data.amount);
  if (!data.student_id || !amount || amount <= 0) {
    return { ok: false, error: 'student_id and a positive amount are required.' };
  }
  const payDate = data.payment_date || todayISO();
  const term = data.term_id
    ? db.prepare('SELECT * FROM terms WHERE id = ?').get(data.term_id)
    : db.prepare('SELECT * FROM terms WHERE is_current = 1').get();
  const termId = term ? term.id : null;
  const bill = termId
    ? db.prepare('SELECT id FROM student_bills WHERE student_id = ? AND term_id = ?').get(data.student_id, termId)
    : null;
  const billId = data.bill_id || (bill ? bill.id : null);

  // The receipt counter is consumed INSIDE the transaction. Taken outside, a
  // payment that failed to record still burned a number, leaving gaps in the
  // receipt sequence — which is exactly what an audit of a school's books
  // treats as a missing receipt.
  let receiptNo;
  const tx = db.transaction(() => {
    const counter = getNextReceiptNumber(db);
    receiptNo = `FE/${new Date().getFullYear().toString().slice(-2)}/${String(counter).padStart(5, '0')}`;
    const r = db.prepare(`
      INSERT INTO payments (student_id, student_bill_id, term_id, amount, payment_date,
        payment_method, reference, received_by, notes, receipt_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.student_id, billId, termId, amount, payDate,
      data.payment_method || 'Cash', data.reference || null,
      data.received_by || null, data.notes || null, receiptNo
    );
    if (billId) {
      db.prepare(`
        UPDATE student_bills SET total_paid = total_paid + ?,
          balance = total_billed - (total_paid + ?) WHERE id = ?
      `).run(amount, amount, billId);
    }
    postIncome(db, {
      receipt_number: receiptNo, category: 'fees', amount,
      description: `School fees payment — ${receiptNo}`,
      payment_method: data.payment_method || 'Cash', reference: data.reference || null,
      date: payDate, source: data.source || 'student_payment',
      student_id: data.student_id, term_id: termId,
      linked_payment_id: r.lastInsertRowid, recorded_by: data.received_by || null, is_auto: 1,
    });
    return r.lastInsertRowid;
  });

  let paymentId;
  try { paymentId = tx(); }
  catch (e) { return { ok: false, error: `Payment could not be recorded: ${e.message}` }; }

  try { autoReceiptForPayment(db, 'fees', paymentId); } catch (_) {}
  let delivery = null;
  try { delivery = autoDeliverReceipt(db, 'fees', paymentId); } catch (_) {}
  // Thin-cloud projection: refresh the student's balance snapshot + log the
  // receipt for the portal (no-op when cloud sync is off).
  try {
    enqueueStudentSnapshot(db, data.student_id);
    postToOutbox(db, { entity_type: 'receipt', entity_key: `receipt:${receiptNo}`, payload: {
      receipt_number: receiptNo, student_id: data.student_id, amount, category: 'fees',
      payment_method: data.payment_method || 'Cash', date: payDate,
    } });
  } catch (_) {}
  return { ok: true, payment_id: paymentId, receipt_number: receiptNo, delivered: delivery?.channels || [] };
}

// ── Intents ──
function createIntent(db, { student_id, parent_id, amount, channel, reference, notes }) {
  const amt = Number(amount);
  if (!student_id || !amt || amt <= 0) return { ok: false, error: 'A positive amount is required.' };
  const term = db.prepare('SELECT id FROM terms WHERE is_current = 1').get();
  const uuid = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const r = db.prepare(`
    INSERT INTO payment_intents (uuid, student_id, parent_id, term_id, amount, channel, reference, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(uuid, student_id, parent_id || null, term?.id || null, amt, channel || 'mobile', reference || null, notes || null);
  return { ok: true, intent_id: r.lastInsertRowid, uuid, status: 'pending' };
}

// Acknowledge a pending intent → record the payment (+ receipt + delivery).
function acknowledgeIntent(db, intentId, { actorUserId, method } = {}) {
  const intent = db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(intentId);
  if (!intent) return { ok: false, error: 'Intent not found.' };
  if (intent.status !== 'pending') return { ok: false, error: `Intent already ${intent.status}.` };

  const rec = recordFeePayment(db, {
    student_id: intent.student_id,
    term_id: intent.term_id,
    amount: intent.amount,
    payment_method: method || channelToMethod(intent.channel),
    reference: intent.reference,
    received_by: actorUserId || null,
    notes: `Mobile payment${intent.channel ? ` (${intent.channel})` : ''}`,
    source: 'mobile_payment',
  });
  if (!rec.ok) return rec;

  db.prepare(`
    UPDATE payment_intents SET status = 'acknowledged', payment_id = ?, acknowledged_by = ?, acknowledged_at = datetime('now')
    WHERE id = ?
  `).run(rec.payment_id, actorUserId || null, intentId);
  return { ok: true, payment_id: rec.payment_id, receipt_number: rec.receipt_number, delivered: rec.delivered };
}

function rejectIntent(db, intentId, { actorUserId, reason } = {}) {
  const intent = db.prepare('SELECT status FROM payment_intents WHERE id = ?').get(intentId);
  if (!intent) return { ok: false, error: 'Intent not found.' };
  if (intent.status !== 'pending') return { ok: false, error: `Intent already ${intent.status}.` };
  db.prepare(`
    UPDATE payment_intents SET status = 'rejected', acknowledged_by = ?, acknowledged_at = datetime('now'), reject_reason = ?
    WHERE id = ?
  `).run(actorUserId || null, reason || null, intentId);
  return { ok: true };
}

function listIntents(db, status = 'pending') {
  return db.prepare(`
    SELECT pi.*, s.surname, s.first_name, s.index_number, c.name AS class_name,
           p.full_name AS parent_name, p.phone AS parent_phone
    FROM payment_intents pi
    JOIN students s ON s.id = pi.student_id
    LEFT JOIN class_groups c ON c.id = s.current_class_id
    LEFT JOIN parents p ON p.id = pi.parent_id
    WHERE pi.status = ? ORDER BY pi.created_at DESC LIMIT 200
  `).all(status);
}

function intentsForStudent(db, studentId) {
  return db.prepare(`
    SELECT id, amount, channel, reference, status, created_at, acknowledged_at
    FROM payment_intents WHERE student_id = ? ORDER BY created_at DESC LIMIT 20
  `).all(studentId);
}

function channelToMethod(channel) {
  return { mobile: 'Mobile Money', mobile_money: 'Mobile Money', bank: 'Bank Transfer', cash: 'Cash', paystack: 'Paystack' }[channel] || 'Mobile Money';
}

// ── Online (gateway) payments ──
// Create an intent AND start a gateway checkout. Returns the authorization URL
// the client opens. Settlement happens later via verifyAndSettle (pull) or the
// gateway webhook.
async function createOnlineIntent(db, { student_id, parent_id, amount, email }) {
  const g = getGateway(db);
  if (!g || !g.isConfigured(db)) return { ok: false, error: 'Online payments are not available for this school.' };
  const base = createIntent(db, { student_id, parent_id, amount, channel: g.id, notes: 'Online payment' });
  if (!base.ok) return base;

  const reference = `NE-${base.intent_id}-${crypto.randomBytes(4).toString('hex')}`;
  const init = await g.initialize(db, { amount, email, reference, metadata: { intent_id: base.intent_id, student_id } });
  if (!init.ok) {
    db.prepare("UPDATE payment_intents SET status = 'rejected', gateway_status = ? WHERE id = ?").run(init.error || 'init_failed', base.intent_id);
    return { ok: false, error: 'Could not start the online payment. Please try again.' };
  }
  db.prepare(`
    UPDATE payment_intents SET gateway = ?, gateway_reference = ?, authorization_url = ?, email = ?, currency = ?
    WHERE id = ?
  `).run(g.id, init.reference, init.authorization_url, email || null, getSetting(db, 'payment_currency', 'GHS'), base.intent_id);

  return { ok: true, intent_id: base.intent_id, reference: init.reference, authorization_url: init.authorization_url };
}

// Verify a gateway transaction and, if paid, settle it (record payment +
// receipt). Idempotent — a settled intent returns its existing payment.
async function verifyAndSettle(db, reference, { actorUserId } = {}) {
  const intent = db.prepare('SELECT * FROM payment_intents WHERE gateway_reference = ?').get(reference);
  if (!intent) return { ok: false, error: 'Payment not found.' };
  if (intent.status === 'acknowledged') return { ok: true, already: true, payment_id: intent.payment_id, receipt_number: null };

  const g = getGateway(db);
  if (!g) return { ok: false, error: 'No gateway configured.' };
  const v = await g.verify(db, reference);
  if (!v.ok) return { ok: false, error: v.error };
  if (!v.paid) {
    db.prepare('UPDATE payment_intents SET gateway_status = ? WHERE id = ?').run(v.gateway_status || 'pending', intent.id);
    return { ok: false, pending: true, error: 'Payment not completed yet.' };
  }
  // Record the amount the gateway actually confirmed.
  if (Math.round((v.amount || 0) * 100) !== Math.round(intent.amount * 100)) {
    db.prepare('UPDATE payment_intents SET amount = ? WHERE id = ?').run(v.amount, intent.id);
  }
  const ack = acknowledgeIntent(db, intent.id, { actorUserId: actorUserId || null, method: 'Paystack' });
  if (ack.ok) db.prepare("UPDATE payment_intents SET gateway_status = 'success' WHERE id = ?").run(intent.id);
  return ack;
}

module.exports = {
  recordFeePayment, createIntent, acknowledgeIntent, rejectIntent, listIntents, intentsForStudent,
  createOnlineIntent, verifyAndSettle,
};
