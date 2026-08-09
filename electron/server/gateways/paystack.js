// Nickland Edusoft — Paystack payment gateway adapter
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Implements the gateway interface used by payments_service:
//   initialize(intent)         → { ok, authorization_url, reference }
//   verify(reference)          → { ok, paid, amount, currency, raw }
//   verifyWebhook(sig, rawBody)→ boolean (HMAC-SHA512 of the raw body)
//
// Amounts are handled in the minor unit (pesewas/kobo = value × 100), as
// Paystack requires. Currency defaults to GHS.

const crypto = require('crypto');
const { getSetting } = require('../../utils/idgen');
const { httpJson } = require('./http');

function cfg(db) {
  return {
    secret: getSetting(db, 'paystack_secret_key', ''),
    base: (getSetting(db, 'paystack_base_url', 'https://api.paystack.co') || 'https://api.paystack.co').replace(/\/+$/, ''),
    currency: getSetting(db, 'payment_currency', 'GHS') || 'GHS',
    callback: getSetting(db, 'paystack_callback_url', ''),
  };
}

const paystack = {
  id: 'paystack',
  isConfigured(db) { return !!getSetting(db, 'paystack_secret_key', ''); },

  async initialize(db, { amount, email, reference, metadata }) {
    const c = cfg(db);
    if (!c.secret) return { ok: false, error: 'paystack_not_configured' };
    const body = {
      amount: Math.round(Number(amount) * 100), // minor units
      email: email || 'payments@nicklandedusoft.app',
      reference,
      currency: c.currency,
      metadata: metadata || {},
    };
    if (c.callback) body.callback_url = c.callback;
    const res = await httpJson(`${c.base}/transaction/initialize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.secret}` },
      body,
    });
    if (res.status >= 200 && res.status < 300 && res.json && res.json.status && res.json.data) {
      return { ok: true, authorization_url: res.json.data.authorization_url, reference: res.json.data.reference || reference, access_code: res.json.data.access_code };
    }
    return { ok: false, error: (res.json && res.json.message) || res.error || `paystack_init_failed_${res.status}` };
  },

  async verify(db, reference) {
    const c = cfg(db);
    if (!c.secret) return { ok: false, error: 'paystack_not_configured' };
    const res = await httpJson(`${c.base}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${c.secret}` },
    });
    if (res.status >= 200 && res.status < 300 && res.json && res.json.data) {
      const d = res.json.data;
      return {
        ok: true,
        paid: d.status === 'success',
        amount: (Number(d.amount) || 0) / 100, // back to major units
        currency: d.currency,
        gateway_status: d.status,
        raw: d,
      };
    }
    return { ok: false, error: (res.json && res.json.message) || res.error || `paystack_verify_failed_${res.status}` };
  },

  // Paystack signs webhooks with HMAC-SHA512 of the raw body using the secret key.
  verifyWebhook(db, signature, rawBody) {
    const c = cfg(db);
    if (!c.secret || !signature) return false;
    const expected = crypto.createHmac('sha512', c.secret).update(rawBody, 'utf8').digest('hex');
    try {
      const a = Buffer.from(expected); const b = Buffer.from(String(signature));
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (_) { return false; }
  },

  webhookReference(payload) {
    // charge.success → data.reference
    return payload && payload.data ? payload.data.reference : null;
  },
  webhookIsSuccess(payload) {
    return payload && payload.event === 'charge.success';
  },
};

module.exports = paystack;
