// Nickland Edusoft — Hubtel payment gateway adapter
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The desktop twin of `cloud-python/app/gateways/hubtel.py`, written against
// Hubtel's published Online Checkout contract and not exercised against a live
// Hubtel account from inside this repository.
//
// The thing that makes Hubtel different from the card gateways:
//
//   **Hubtel does not sign its callbacks.** It POSTs to the URL you gave it
//   and that is all. So `verifyWebhook` returns false — always — and
//   `signedCallbacks: false` tells the webhook route to treat the delivery as
//   what it actually is: a nudge saying "go and look". The looking is
//   `verify()`, against the transaction-status API over the school's own
//   authenticated connection. Nothing is weaker here than it is for Paystack,
//   because settlement has never believed a webhook about an amount. The only
//   difference is that a Hubtel callback cannot by itself settle anything, and
//   this code says so rather than pretending.
//
// Credentials are the API ID and API key from Hubtel's dashboard, sent as HTTP
// Basic auth, plus the merchant account number the money lands in.

const { getSetting } = require('../../utils/idgen');
const { httpJson } = require('./http');

const CHECKOUT_BASE = 'https://payproxyapi.hubtel.com';
const STATUS_BASE = 'https://api-txnstatus.hubtel.com';

function cfg(db) {
  return {
    clientId: getSetting(db, 'hubtel_client_id', ''),
    clientSecret: getSetting(db, 'hubtel_client_secret', ''),
    account: getSetting(db, 'hubtel_merchant_account', ''),
    base: (getSetting(db, 'hubtel_base_url', CHECKOUT_BASE) || CHECKOUT_BASE).replace(/\/+$/, ''),
    status: (getSetting(db, 'hubtel_status_url', STATUS_BASE) || STATUS_BASE).replace(/\/+$/, ''),
    callback: getSetting(db, 'hubtel_callback_url', '') || getSetting(db, 'paystack_callback_url', ''),
  };
}

function auth(c) {
  return { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}` };
}

const hubtel = {
  id: 'hubtel',
  channels: ['mobile_money', 'card'],
  cardBrands: ['visa', 'mastercard'],
  signedCallbacks: false,
  isConfigured(db) {
    const c = cfg(db);
    return !!(c.clientId && c.clientSecret && c.account);
  },

  async initialize(db, { amount, email, reference, metadata }) {
    const c = cfg(db);
    if (!this.isConfigured(db)) return { ok: false, error: 'hubtel_not_configured' };
    const res = await httpJson(`${c.base}/items/initiate`, {
      method: 'POST',
      headers: auth(c),
      body: {
        totalAmount: Math.round(Number(amount) * 100) / 100,
        description: (metadata && metadata.description) || 'School fees',
        callbackUrl: c.callback || '',
        returnUrl: c.callback || '',
        cancellationUrl: c.callback || '',
        merchantAccountNumber: c.account,
        clientReference: reference,
      },
    });
    const d = (res.json && res.json.data) || {};
    const url = d.checkoutDirectUrl || d.checkoutUrl;
    if (res.status >= 200 && res.status < 300 && url) {
      return { ok: true, authorization_url: url, reference: d.clientReference || reference, access_code: d.checkoutId };
    }
    return { ok: false, error: (res.json && res.json.message) || res.error || `hubtel_init_failed_${res.status}` };
  },

  // Hubtel's transaction-status API, asked by OUR client reference. This is the
  // whole of what settles a Hubtel payment — there is no signed message to
  // trust instead, so there is nothing else it could be.
  async verify(db, reference) {
    const c = cfg(db);
    if (!this.isConfigured(db)) return { ok: false, error: 'hubtel_not_configured' };
    const res = await httpJson(
      `${c.status}/transactions/${encodeURIComponent(c.account)}/status?clientReference=${encodeURIComponent(reference)}`,
      { headers: auth(c) });
    if (!(res.status >= 200 && res.status < 300)) {
      return { ok: false, error: (res.json && res.json.message) || res.error || `hubtel_verify_failed_${res.status}` };
    }
    let d = (res.json && res.json.data) || {};
    if (Array.isArray(d)) d = d[0] || {};
    const state = String(d.status || '').toLowerCase();
    return {
      ok: true,
      paid: state === 'paid' || state === 'success' || state === 'successful',
      amount: Number(d.amount) || 0,
      currency: 'GHS',
      gateway_status: String(d.status || ''),
      raw: d,
    };
  },

  // False, always, and deliberately. Returning true for an unsigned POST would
  // mean anybody who learns the callback URL can claim a payment succeeded.
  verifyWebhook() { return false; },

  webhookReference(payload) {
    const d = (payload && (payload.Data || payload.data || payload)) || {};
    return d.ClientReference || d.clientReference || null;
  },
  // A callback body is never evidence of success. The most it can say is "go
  // and check", and the route does the checking.
  webhookIsSuccess() { return true; },
};

module.exports = hubtel;
