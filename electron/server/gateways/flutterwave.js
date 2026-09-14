// Nickland Edusoft — Flutterwave (v3) payment gateway adapter
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The desktop twin of `cloud-python/app/gateways/flutterwave.py`. Both are
// written against Flutterwave's published v3 contract, and neither has been
// exercised against a live Flutterwave account from inside this repository —
// which is why the cloud marks it unverified and makes a school pass a Test
// before switching it on.
//
// Two things about Flutterwave that are unlike Paystack:
//
//   * Its webhook is NOT an HMAC. Flutterwave sends a `verif-hash` header
//     carrying a secret string the merchant typed into their own dashboard.
//     That proves the sender and says nothing about the body — which is
//     enough here, because settlement re-asks Flutterwave for the amount
//     regardless (see payments_service.verifyAndSettle).
//   * Its reference is `tx_ref`, ours, and Flutterwave also mints an `id` of
//     its own. We verify by ours, so a delivery arriving before we have seen
//     the provider's id is still answerable.

const crypto = require('crypto');
const { getSetting } = require('../../utils/idgen');
const { httpJson } = require('./http');

const DEFAULT_BASE = 'https://api.flutterwave.com/v3';

function cfg(db) {
  return {
    secret: getSetting(db, 'flutterwave_secret_key', ''),
    hash: getSetting(db, 'flutterwave_secret_hash', ''),
    base: (getSetting(db, 'flutterwave_base_url', DEFAULT_BASE) || DEFAULT_BASE).replace(/\/+$/, ''),
    currency: getSetting(db, 'payment_currency', 'GHS') || 'GHS',
    callback: getSetting(db, 'flutterwave_callback_url', '') || getSetting(db, 'paystack_callback_url', ''),
  };
}

const flutterwave = {
  id: 'flutterwave',
  signedCallbacks: true,
  isConfigured(db) { return !!getSetting(db, 'flutterwave_secret_key', ''); },

  async initialize(db, { amount, email, reference, metadata }) {
    const c = cfg(db);
    if (!c.secret) return { ok: false, error: 'flutterwave_not_configured' };
    const body = {
      tx_ref: reference,
      amount: String(Math.round(Number(amount) * 100) / 100),
      currency: c.currency,
      redirect_url: c.callback || '',
      customer: { email: email || 'payments@nicklandedusoft.app' },
      customizations: { title: 'School fees' },
      meta: metadata || {},
    };
    const res = await httpJson(`${c.base}/payments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.secret}` },
      body,
    });
    const link = res.json && res.json.data ? res.json.data.link : null;
    if (res.status >= 200 && res.status < 300 && res.json && res.json.status === 'success' && link) {
      return { ok: true, authorization_url: link, reference };
    }
    return { ok: false, error: (res.json && res.json.message) || res.error || `flutterwave_init_failed_${res.status}` };
  },

  // By OUR reference. `verify_by_reference` exists for exactly this: the
  // merchant knows what it called the transaction and should not have to have
  // stored the provider's own id before it can ask about it.
  async verify(db, reference) {
    const c = cfg(db);
    if (!c.secret) return { ok: false, error: 'flutterwave_not_configured' };
    const res = await httpJson(
      `${c.base}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${c.secret}` } });
    const d = res.json && res.json.data;
    if (res.status >= 200 && res.status < 300 && d) {
      return {
        ok: true,
        paid: String(d.status || '').toLowerCase() === 'successful',
        amount: Number(d.amount) || 0,     // Flutterwave quotes major units already
        currency: d.currency || c.currency,
        gateway_status: String(d.status || ''),
        raw: d,
      };
    }
    return { ok: false, error: (res.json && res.json.message) || res.error || `flutterwave_verify_failed_${res.status}` };
  },

  // A shared secret, compared in constant time. No hash configured means every
  // delivery is anonymous, and an anonymous delivery is not evidence of
  // anything — so it is refused rather than waved through.
  verifyWebhook(db, signature, rawBody) {
    const c = cfg(db);
    if (!c.hash || !signature) return false;
    try {
      const a = Buffer.from(c.hash); const b = Buffer.from(String(signature));
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (_) { return false; }
  },

  webhookReference(payload) {
    const d = (payload && (payload.data || payload)) || {};
    return d.tx_ref || d.txRef || null;
  },
  webhookIsSuccess(payload) {
    const d = (payload && (payload.data || payload)) || {};
    return String(d.status || '').toLowerCase() === 'successful';
  },
};

module.exports = flutterwave;
