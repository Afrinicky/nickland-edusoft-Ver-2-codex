// Nickland Edusoft Cloud — taking fees over the internet.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// What this is for: a parent settling a bill at ten at night, from another
// region, with the school's computer switched off in a locked office. The
// desktop cannot answer, so the cloud has to — and that means the cloud has to
// hold the school's gateway key, which is a real cost and worth stating
// plainly rather than burying.
//
// How the cost is contained:
//
//   • The key is OPT-IN. A school that has not switched internet payments on
//     has no key here, and this whole module answers "not available". Payments
//     on the school's own network do not need it and never send it.
//   • It is stored outside the snapshot table, in `school_payments`, which no
//     read endpoint touches. There is no route that returns it. `config()`
//     below is the only reader, and it is called only by the code that talks
//     to the gateway.
//   • It is pushed by the school's own desktop over the school-key channel.
//     Nothing a parent, a teacher or a portal session does can write it.
//
// And the rules that hold whether or not the desktop is up:
//
//   • Only a signed webhook may say a payment succeeded, and the signature is
//     checked over the raw bytes.
//   • The amount is re-read from the gateway, never taken from the webhook.
//   • Settlement does not record the payment here. The cloud has no receipt
//     counter and no ledger; it queues a `fee_payment` change and the school's
//     desktop records it through the same function the counter uses. Until
//     then the parent is told, truthfully, that the money has arrived and the
//     receipt follows.
//   • The queued change carries the gateway's reference, and the desktop
//     de-duplicates on it — so a gateway retrying a delivery, or a second
//     verification from the parent's app, cannot become a second payment.

const crypto = require('crypto');

const MIN_DEFAULT = 1;
const MAX_DEFAULT = 10000;

async function config(store, school_id) {
  if (typeof store.getPaymentConfig !== 'function') return null;
  try {
    const c = await store.getPaymentConfig(school_id);
    if (!c || !c.secret || c.enabled === false) return null;
    return c;
  } catch (_) { return null; }
}

/** What a parent's app may be told: never the secret, only whether there is one. */
async function availability(store, school_id) {
  const c = await config(store, school_id);
  if (!c) return { available: false, gateway: null, min: MIN_DEFAULT, max: MAX_DEFAULT, currency: 'GHS' };
  return {
    available: true,
    gateway: c.gateway,
    public_key: c.public_key || null,
    currency: c.currency || 'GHS',
    min: Number(c.min_amount) || MIN_DEFAULT,
    max: Number(c.max_amount) || MAX_DEFAULT,
  };
}

// A tiny JSON client. The cloud twin cannot reach the desktop's gateway
// adapters, and pulling a dependency in for two calls is not worth it.
function httpJson(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    let mod, u;
    try { u = new URL(url); mod = u.protocol === 'http:' ? require('http') : require('https'); }
    catch (e) { return resolve({ status: 0, error: 'bad_url' }); }
    const data = body ? JSON.stringify(body) : null;
    const req = mod.request({
      method, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
      timeout: 20000,
    }, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(d) }); } catch (_) { resolve({ status: res.statusCode, json: null }); } });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

const base = (c) => (c.base_url || 'https://api.paystack.co').replace(/\/+$/, '');

async function gatewayInitialize(c, { amount, email, reference, metadata }) {
  const body = {
    amount: Math.round(Number(amount) * 100),        // minor units, as Paystack requires
    email: email || 'payments@nicklandedusoft.app',
    reference, currency: c.currency || 'GHS', metadata: metadata || {},
  };
  if (c.callback_url) body.callback_url = c.callback_url;
  const res = await httpJson(`${base(c)}/transaction/initialize`, {
    method: 'POST', headers: { Authorization: `Bearer ${c.secret}` }, body,
  });
  if (res.status >= 200 && res.status < 300 && res.json && res.json.status && res.json.data) {
    return { ok: true, authorization_url: res.json.data.authorization_url, reference: res.json.data.reference || reference };
  }
  return { ok: false, error: (res.json && res.json.message) || res.error || `init_failed_${res.status}` };
}

async function gatewayVerify(c, reference) {
  const res = await httpJson(`${base(c)}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${c.secret}` },
  });
  if (res.status >= 200 && res.status < 300 && res.json && res.json.data) {
    const d = res.json.data;
    return {
      ok: true, paid: d.status === 'success',
      amount: (Number(d.amount) || 0) / 100, currency: d.currency, gateway_status: d.status,
    };
  }
  return { ok: false, error: (res.json && res.json.message) || res.error || `verify_failed_${res.status}` };
}

/** HMAC-SHA512 of the raw body, compared in constant time. */
function verifyWebhook(secret, signature, rawBody) {
  if (!secret || !signature) return false;
  try {
    const expected = crypto.createHmac('sha512', secret).update(rawBody == null ? '' : rawBody, 'utf8').digest('hex');
    const a = Buffer.from(expected); const b = Buffer.from(String(signature));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) { return false; }
}

// ── intents ─────────────────────────────────────────────────────────────────
// Kept as snapshots so the desktop sees them on its next pull and the parent's
// app can read back the status of a charge it started. They carry no secret:
// a reference, an amount, a status, and whose child it was for.

const intentKey = (reference) => `cloud_payment:${reference}`;

async function saveIntent(store, school_id, intent) {
  await store.upsertSnapshot(school_id, {
    entity_type: 'cloud_payment', entity_key: intentKey(intent.reference),
    op: 'upsert', version: intent.version || 1, payload: intent,
  });
  return intent;
}

async function getIntent(store, school_id, reference) {
  const rows = await store.listSnapshots(school_id, 'cloud_payment');
  const hit = rows.find(r => r.entity_key === intentKey(reference));
  return hit ? { ...hit.payload, version: hit.version } : null;
}

/**
 * Start a charge for one child.
 *
 * `studentKeys` is the set of children the signed-in parent actually has —
 * checked here rather than trusted from the request, because "which children
 * are mine" is exactly the parameter an attacker would like to choose.
 */
async function createCheckout(store, school_id, { parent_id, student_id, amount, email, studentKeys }) {
  const c = await config(store, school_id);
  if (!c) {
    return { ok: false, status: 400,
      error: 'This school does not take payments over the internet. Use the school’s own channels.' };
  }
  if (!studentKeys.has(`student:${student_id}`)) return { ok: false, status: 403, error: 'Not your child.' };

  const amt = Number(amount);
  const min = Number(c.min_amount) || MIN_DEFAULT;
  const max = Number(c.max_amount) || MAX_DEFAULT;
  if (!Number.isFinite(amt) || amt < min) return { ok: false, status: 400, error: `The smallest payment is ${min}.` };
  if (amt > max) return { ok: false, status: 400, error: `The largest single payment is ${max}.` };

  const reference = `NEC-${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`;
  const init = await gatewayInitialize(c, {
    amount: amt, email, reference,
    metadata: { school_id, student_id, parent_id, source: 'cloud' },
  });
  if (!init.ok) return { ok: false, status: 502, error: 'Could not start the payment. Please try again.' };

  await saveIntent(store, school_id, {
    reference: init.reference, gateway: c.gateway, student_id, parent_id,
    amount: amt, currency: c.currency || 'GHS',
    status: 'pending', gateway_status: 'initialised',
    created_at: new Date().toISOString(),
  });
  return { ok: true, reference: init.reference, authorization_url: init.authorization_url };
}

/**
 * Settle a reference, once the gateway itself confirms it.
 *
 * Idempotent by design and by necessity: a webhook delivery is retried, and a
 * parent's app polls. The second call finds `status: 'paid'` and returns it
 * without queueing a second payment.
 */
async function settle(store, school_id, reference) {
  const intent = await getIntent(store, school_id, reference);
  if (!intent) return { ok: false, status: 404, error: 'No such payment.' };
  if (intent.status === 'paid') return { ok: true, already: true, payment: intent };

  const c = await config(store, school_id);
  if (!c) return { ok: false, status: 400, error: 'Payments are not configured.' };

  const v = await gatewayVerify(c, reference);
  if (!v.ok) return { ok: false, status: 502, error: 'Could not confirm the payment with the gateway.' };
  if (!v.paid) {
    await saveIntent(store, school_id, { ...intent, gateway_status: v.gateway_status || 'pending', version: (intent.version || 1) + 1 });
    return { ok: false, status: 202, pending: true, error: 'Payment not completed yet.' };
  }

  // The gateway's figure, not the one the phone asked for and not the one in
  // the webhook body. This is the only number that has been through anybody's
  // authenticated connection.
  const settledAmount = Number(v.amount) || 0;
  const paid = {
    ...intent, status: 'paid', gateway_status: 'success', amount: settledAmount,
    paid_at: new Date().toISOString(), version: (intent.version || 1) + 1,
  };
  await saveIntent(store, school_id, paid);

  // The school records it, because the school owns the receipt numbers.
  await store.enqueueChange(school_id, {
    type: 'fee_payment',
    payload: {
      student_id: intent.student_id, parent_id: intent.parent_id || null,
      amount: settledAmount, currency: intent.currency || 'GHS',
      gateway: intent.gateway, gateway_reference: reference,
      paid_at: paid.paid_at, source: 'cloud_gateway',
    },
  });
  return { ok: true, payment: paid };
}

/** The status of one charge, for the parent's app after it comes back. */
async function status(store, school_id, reference, studentKeys) {
  const intent = await getIntent(store, school_id, reference);
  if (!intent) return { ok: false, status: 404, error: 'No such payment.' };
  if (studentKeys && !studentKeys.has(`student:${intent.student_id}`)) {
    return { ok: false, status: 403, error: 'Not your payment.' };
  }
  if (intent.status === 'pending') {
    const s = await settle(store, school_id, reference);
    if (s.ok) return { ok: true, payment: s.payment, receipt_pending: true };
  }
  const now = await getIntent(store, school_id, reference);
  return { ok: true, payment: now, receipt_pending: now && now.status === 'paid' };
}

module.exports = {
  config, availability, verifyWebhook, createCheckout, settle, status,
  getIntent, saveIntent, gatewayInitialize, gatewayVerify,
};
