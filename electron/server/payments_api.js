// Nickland Edusoft — money coming in from outside the school.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The app used to take payments, then stopped, and now takes them again — so
// it is worth writing down what makes the difference, because the reason it
// was removed was a good one.
//
// The old build had two ways to pay and both of them ended with somebody in
// the office deciding whether a number a parent had typed was true. That is
// not a payment system; it is a form. What is here instead:
//
//   • A CHECKOUT. The parent's phone asks this server to start a charge. The
//     server talks to the gateway with the school's own key, and hands back
//     the gateway's URL. The phone never sees the key and never names the
//     amount that will be settled.
//
//   • A WEBHOOK, and only a webhook, may say a payment succeeded. It is
//     verified by HMAC over the raw bytes, against the school's secret; an
//     unsigned or wrongly signed call is dropped without a word. Even then the
//     amount is not taken from the webhook body — the gateway is asked
//     directly, and what IT reports is what the school's books record.
//
//   • A DECLARATION, kept separate. A parent who paid by transfer at the bank
//     can say so, and that raises an intent the office acknowledges. It moves
//     no money and touches no ledger until a person with `fees: edit` says it
//     arrived. It is a message, and it is filed as one.
//
// Settlement itself lives in server/payments_service.js — the same function
// the desktop calls, so a payment taken online is posted, receipted and
// delivered exactly like a payment taken at the counter, and appears in the
// same audit and the same parent snapshot.

const { getSetting } = require('../utils/idgen');
const { getGateway, gatewayEnabled } = require('./gateways');
const payments = require('./payments_service');

// Is this school taking money through the app at all? Two conditions, both
// required: a gateway configured with a key, and the school having switched it
// on. A school that has entered a test key but not gone live is not live.
function onlinePaymentsEnabled(db) {
  try {
    return getSetting(db, 'online_payments_enabled', 'false') === 'true' && gatewayEnabled(db);
  } catch (_) { return false; }
}

function bounds(db) {
  const min = Number(getSetting(db, 'online_payment_min', '1')) || 1;
  const max = Number(getSetting(db, 'online_payment_max', '10000')) || 10000;
  return { min, max };
}

function registerPaymentRoutes({ add, db, json, API, getSetting: gs, audit, rateLimited }) {
  const bad = (res, msg) => json(res, 400, { ok: false, error: msg });
  const missing = (res, msg) => json(res, 404, { ok: false, error: msg || 'Not found.' });
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  const parentOwns = (ctx, id) => ctx && ctx.role === 'parent' && ctx.student_ids.includes(id);

  // What a parent's app asks before it draws the screen: may I pay here, how
  // much is owed, and what are the limits. Answered for one child, and only
  // for a child of the parent asking.
  add('GET', `${API}/parent/children/:id/payment-options`, async (ctx, req, res, params) => {
    const sid = parseInt(params.id, 10);
    if (!parentOwns(ctx, sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    const term = db.prepare('SELECT id, label FROM terms WHERE is_current = 1').get();
    const bill = term ? db.prepare(`
      SELECT balance FROM student_bills WHERE student_id = ? AND term_id = ?
        AND COALESCE(status,'active') = 'active'
    `).get(sid, term.id) : null;
    const g = getGateway(db);
    const { min, max } = bounds(db);
    return json(res, 200, {
      ok: true,
      balance: bill ? num(bill.balance) : 0,
      currency: gs(db, 'payment_currency', 'GHS'),
      online: {
        available: onlinePaymentsEnabled(db),
        gateway: g ? g.id : null,
        min, max,
      },
      // The office's own channels, which work whether or not a gateway does.
      // A school with no gateway still has a bursar and a WhatsApp number, and
      // that is what this reply says rather than an empty screen.
      offline: {
        declare: true,
        whatsapp: gs(db, 'school_whatsapp', '') || gs(db, 'school_phone_1', ''),
        phone: gs(db, 'school_phone_1', ''),
        momo: gs(db, 'school_momo_number', ''),
        bank: { name: gs(db, 'school_bank_name', ''), account: gs(db, 'school_bank_account', '') },
      },
    });
  });

  // ── Checkout ──────────────────────────────────────────────────────────────
  // Starts a charge and returns the gateway's own URL for the phone to open.
  // Nothing is recorded against the child here beyond a pending intent: this
  // route can be called and abandoned all day without a penny moving.
  add('POST', `${API}/parent/children/:id/pay`, async (ctx, req, res, params, body, ip) => {
    const sid = parseInt(params.id, 10);
    if (!parentOwns(ctx, sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    // A checkout is cheap for us and expensive for the gateway, and a loop in
    // a client should not become a thousand abandoned transactions.
    if (rateLimited(ip, `pay:${ctx.parent.id}`)) {
      return json(res, 429, { ok: false, error: 'Too many attempts. Try again shortly.' });
    }
    if (!onlinePaymentsEnabled(db)) {
      return bad(res, 'This school does not take payments in the app. Use the school’s own channels.');
    }
    const amount = num(body.amount);
    const { min, max } = bounds(db);
    if (!(amount >= min)) return bad(res, `The smallest payment is ${min}.`);
    if (amount > max) return bad(res, `The largest single payment is ${max}. Pay in parts, or see the office.`);

    const r = await payments.createOnlineIntent(db, {
      student_id: sid,
      parent_id: ctx.parent.id,
      amount,
      email: ctx.parent.email || body.email || undefined,
    });
    if (!r.ok) return json(res, 400, r);
    audit(db, null, 'payment_intent', r.intent_id, 'checkout_started',
      `Parent ${ctx.parent.id} started ${amount} for student ${sid}`);
    return json(res, 200, {
      ok: true, intent_id: r.intent_id, reference: r.reference,
      authorization_url: r.authorization_url,
    });
  });

  // Where the parent's app comes back to after the gateway. It does NOT take
  // the app's word that the payment worked — it asks the gateway. So a phone
  // that never returns (a dropped connection, a closed tab) costs nothing: the
  // webhook settles it anyway, and this only ever reports what already is.
  add('GET', `${API}/parent/payments/:reference`, async (ctx, req, res, params) => {
    if (!ctx || ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const intent = db.prepare('SELECT * FROM payment_intents WHERE gateway_reference = ? OR uuid = ?')
      .get(params.reference, params.reference);
    if (!intent) return missing(res, 'No such payment.');
    if (intent.parent_id !== ctx.parent.id && !ctx.student_ids.includes(intent.student_id)) {
      return json(res, 403, { ok: false, error: 'Not your payment.' });
    }
    if (intent.status === 'pending' && intent.gateway_reference) {
      try { await payments.verifyAndSettle(db, intent.gateway_reference); } catch (_) {}
    }
    const now = db.prepare(`
      SELECT pi.status, pi.amount, pi.gateway_status, pi.created_at, pi.acknowledged_at,
             p.receipt_number, p.payment_date
      FROM payment_intents pi LEFT JOIN payments p ON p.id = pi.payment_id WHERE pi.id = ?
    `).get(intent.id);
    return json(res, 200, { ok: true, payment: now });
  });

  // ── Declaring a payment made elsewhere ────────────────────────────────────
  // Not a payment. A message with a number on it, which the office confirms
  // against its own statement before anything is recorded. It is here because
  // a parent who has already paid at the bank should not have to telephone to
  // say so — and because the alternative, a parent's word posting straight to
  // the ledger, is how a school's books stop being true.
  add('POST', `${API}/parent/children/:id/declare-payment`, async (ctx, req, res, params, body, ip) => {
    const sid = parseInt(params.id, 10);
    if (!parentOwns(ctx, sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    if (rateLimited(ip, `declare:${ctx.parent.id}`)) {
      return json(res, 429, { ok: false, error: 'Too many attempts. Try again shortly.' });
    }
    const amount = num(body.amount);
    if (!(amount > 0)) return bad(res, 'Enter the amount you paid.');
    const channel = ['bank', 'mobile_money', 'cash'].includes(body.channel) ? body.channel : 'bank';
    const reference = String(body.reference || '').trim().slice(0, 80);
    if (!reference) return bad(res, 'Enter the transaction or deposit reference, so the office can find it.');

    const r = payments.createIntent(db, {
      student_id: sid, parent_id: ctx.parent.id, amount, channel, reference,
      notes: String(body.notes || '').slice(0, 300) || 'Declared by the parent in the app',
    });
    if (!r.ok) return json(res, 400, r);
    audit(db, null, 'payment_intent', r.intent_id, 'payment_declared',
      `Parent ${ctx.parent.id} declared ${amount} (${channel}, ref ${reference}) for student ${sid}`);
    return json(res, 200, {
      ok: true, intent_id: r.intent_id,
      message: 'The office has it. Your account updates once they confirm it against the school’s statement.',
    });
  });

  // ── The gateway's webhook ─────────────────────────────────────────────────
  // Public by necessity — the gateway has no account here — and therefore the
  // most carefully guarded route in the server:
  //
  //   • The signature is checked over the RAW body, before the payload is
  //     believed about anything, including which gateway it claims to be from.
  //   • A bad signature gets 401 and nothing else. No hint about references,
  //     no timing difference worth measuring (the HMAC compare is constant
  //     time — see gateways/paystack.js).
  //   • The amount is NOT read from the body. Settlement re-asks the gateway
  //     over the school's own authenticated connection, which is the one thing
  //     an attacker who can post here cannot forge.
  //   • Settling twice is not a second payment: verifyAndSettle returns the
  //     existing one, because a gateway retrying a delivery is normal.
  add('POST', `${API}/payments/webhook/:gateway`, async (ctx, req, res, params, body, ip, tokenId, query, rawBody) => {
    const g = getGateway(db);
    if (!g || g.id !== params.gateway) return json(res, 404, { ok: false, error: 'Not found' });

    const signature = req.headers['x-paystack-signature'] || req.headers['x-signature'] || '';
    if (!g.verifyWebhook(db, signature, rawBody == null ? '' : rawBody)) {
      // Logged as a security event: somebody posting unsigned bodies at a
      // school's payment endpoint is worth a school knowing about.
      audit(db, null, 'security', null, 'webhook_rejected',
        `Unsigned or invalid ${params.gateway} webhook from ${ip}`, 'high');
      return json(res, 401, { ok: false, error: 'Unauthorized' });
    }

    // Answer the gateway immediately. Settlement talks to the network and can
    // be slow; a webhook that times out is a webhook the gateway retries, and
    // retries are how duplicate work gets attempted.
    json(res, 200, { ok: true });

    if (!g.webhookIsSuccess(body)) return undefined;
    const reference = g.webhookReference(body);
    if (!reference) return undefined;
    try {
      const settled = await payments.verifyAndSettle(db, reference);
      audit(db, null, 'payment_intent', null, 'webhook_settled',
        `${params.gateway} ${reference}: ${settled.ok ? (settled.already ? 'already settled' : `receipt ${settled.receipt_number}`) : settled.error}`);
    } catch (e) {
      audit(db, null, 'payment_intent', null, 'webhook_failed', `${reference}: ${e.message}`, 'high');
    }
    return undefined;
  }, { public: true, rawBody: true });
}

module.exports = { registerPaymentRoutes, onlinePaymentsEnabled };
