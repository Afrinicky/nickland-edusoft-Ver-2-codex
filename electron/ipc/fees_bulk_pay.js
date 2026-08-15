// Nickland Edusoft — Fees Bulk-Payment Sheet IPC
// Provides per-class payment sheet data (WHONET-style) and rapid payment recording
// Copyright © 2026 Nickland Sales. All rights reserved.
const { postIncome } = require('./_ledger');
const { autoReceiptForPayment, autoDeliverReceipt } = require('./receipts_engine');
const { getNextReceiptNumber } = require('../utils/idgen');

// Reuse the shared, upsert-backed counter so the receipt number always advances
// (a bare UPDATE is a silent no-op if the counter row is missing → duplicate
// receipt numbers → the next payment hits the UNIQUE constraint).
function nextFeesReceipt(db) {
  const n = getNextReceiptNumber(db);
  const year = new Date().getFullYear().toString().slice(-2);
  return `FE/${year}/${String(n).padStart(5, '0')}`;
}

function computeDiscount(db, studentId, amount, appliesTo) {
  const disc = db.prepare(`
    SELECT * FROM student_discounts
    WHERE student_id = ? AND is_active = 1
      AND (applies_to = ? OR applies_to = 'both')
    LIMIT 1
  `).get(studentId, appliesTo);
  if (!disc) return { discount: 0, net: amount, hasDiscount: false };
  let d = 0;
  if (disc.discount_type === 'percent') {
    d = Math.round(amount * (disc.discount_value / 100) * 100) / 100;
  } else {
    d = Math.min(disc.discount_value, amount);
  }
  return {
    discount: d,
    net: Math.max(0, amount - d),
    hasDiscount: true,
    discount_id: disc.id,
    discount_label: disc.discount_type === 'percent' ? `${disc.discount_value}%` : `GHS ${disc.discount_value}`,
    reason: disc.reason,
  };
}

module.exports = function registerFeesBulkPayHandlers(ipcMain, db) {

  // Data for the bulk-payment sheet for a given class + term
  ipcMain.handle('fees:bulk-pay-sheet', (_e, { classId, termId }) => {
    const term = termId
      ? db.prepare('SELECT * FROM terms WHERE id = ?').get(termId)
      : db.prepare("SELECT * FROM terms WHERE is_current = 1").get();
    if (!term) return [];

    const students = db.prepare(`
      SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names,
             c.name AS class_name, c.short_code,
             sb.id AS bill_id,
             sb.total_billed AS gross_billed,
             sb.total_paid AS fees_paid,
             sb.balance AS fees_balance,
             sb.arrears_from_prev,
             sb.books_arrears
      FROM students s
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      LEFT JOIN student_bills sb ON sb.student_id = s.id AND sb.term_id = ?
                                AND COALESCE(sb.status, 'active') = 'active'
      WHERE s.current_class_id = ? AND s.status = 'Active'
      ORDER BY s.surname, s.first_name
    `).all(term.id, classId);

    // Apply discounts + compute status
    return students.map(s => {
      const gross = s.gross_billed || 0;
      const disc = computeDiscount(db, s.id, gross, 'fees');
      const netBilled = disc.net;
      const balance = netBilled - (s.fees_paid || 0);
      let status = 'unpaid';
      if (gross === 0)                                status = 'not_billed';
      else if ((s.fees_paid || 0) >= netBilled - 0.01) status = 'paid_full';
      else if ((s.fees_paid || 0) > 0)                status = 'paid_partial';

      return {
        student_id: s.id,
        index_number: s.index_number,
        surname: s.surname,
        first_name: s.first_name,
        other_names: s.other_names,
        class_name: s.class_name,
        class_short: s.short_code,
        bill_id: s.bill_id,
        gross_billed: gross,
        discount_amount: disc.discount,
        discount_label: disc.discount_label || null,
        discount_reason: disc.reason || null,
        net_billed: netBilled,
        fees_paid: s.fees_paid || 0,
        balance: Math.max(0, balance),
        status,
        books_arrears: s.books_arrears || 0,
      };
    });
  });

  // Record a single payment from the bulk sheet (one row)
  ipcMain.handle('fees:bulk-pay-record', (_e, data) => {
    if (!data.student_id || !data.amount || data.amount <= 0) {
      return { ok: false, error: 'student_id and positive amount required' };
    }
    const receipt = nextFeesReceipt(db);
    const today = data.payment_date || new Date().toISOString().slice(0, 10);
    const termId = data.term_id || db.prepare("SELECT id FROM terms WHERE is_current = 1").get()?.id;

    const tx = db.transaction(() => {
      const r = db.prepare(`
        INSERT INTO payments
          (student_id, student_bill_id, term_id, amount, payment_date,
           payment_method, reference, receipt_number, received_by, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.student_id, data.bill_id || null, termId,
        data.amount, today,
        data.payment_method || 'Cash',
        data.reference || null, receipt,
        data.received_by || null, data.notes || null
      );

      // Update bill total + balance
      if (data.bill_id) {
        db.prepare(`
          UPDATE student_bills SET
            total_paid = total_paid + ?,
            balance = total_billed - (total_paid + ?)
          WHERE id = ?
        `).run(data.amount, data.amount, data.bill_id);
      }

      // Auto-record income via the central ledger helper (always sets
      // transaction_date + term_id so it shows up in Finance).
      postIncome(db, {
        receipt_number: receipt,
        category: 'fees',
        amount: data.amount,
        description: `School fees payment — ${data.notes || receipt}`,
        payment_method: data.payment_method || 'Cash',
        reference: data.reference || null,
        date: today,
        source: 'student_payment',
        student_id: data.student_id,
        term_id: termId || null,
        linked_payment_id: r.lastInsertRowid,
        recorded_by: data.received_by || null,
        is_auto: 1,
      });

      return r.lastInsertRowid;
    });

    const paymentId = tx();
    let receiptRow = null;
    try { receiptRow = autoReceiptForPayment(db, 'fees', paymentId); } catch (_) {}
    let delivery = null;
    try { delivery = autoDeliverReceipt(db, 'fees', paymentId); } catch (_) {}
    return { ok: true, payment_id: paymentId, receipt_number: receipt, receipt_id: receiptRow?.id || null, delivered: delivery?.channels || [] };
  });
};
