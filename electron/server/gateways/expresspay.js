// Nickland Edusoft — ExpressPay payment gateway adapter
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The desktop twin of `cloud-python/app/gateways/expresspay.py`, written
// against ExpressPay's published contract and not exercised against a live
// ExpressPay account from inside this repository.
//
// ExpressPay is the oldest-fashioned of the four and the code shows it, for
// reasons that are the provider's and not ours:
//
//   * Requests are form-encoded, not JSON, and the field names carry hyphens
//     (`merchant-id`, `api-key`). The answers are JSON.
//   * Checkout is two steps: `submit.php` returns a token, and the payer is
//     then sent to `checkout.php?token=…`. So the authorization URL this
//     adapter hands back is one we build, not one the provider returns.
//   * There are no signed callbacks — `signedCallbacks: false`, and the
//     callback is a nudge that makes the route go and ask, exactly as for
//     Hubtel and for the same reason.
//   * ExpressPay identifies a payment by its TOKEN, not by our order id. The
//     token is already inside the checkout URL we stored on the intent, so
//     `verifyAndSettle` passes it back in and nothing new had to be kept.
//   * Its success flag is `result: 1`. 2 is declined, 3 is pending, 4 is a bad
//     request — and pending is not failure, which is why a pending payment
//     comes back `paid: false` with no error.

const { getSetting } = require('../../utils/idgen');
const { httpForm } = require('./http');

const LIVE_BASE = 'https://expresspaygh.com/api';
const SANDBOX_BASE = 'https://sandbox.expresspaygh.com/api';

function cfg(db) {
  return {
    merchant: getSetting(db, 'expresspay_merchant_id', ''),
    key: getSetting(db, 'expresspay_api_key', ''),
    base: (getSetting(db, 'expresspay_base_url', LIVE_BASE) || LIVE_BASE).replace(/\/+$/, ''),
    currency: getSetting(db, 'payment_currency', 'GHS') || 'GHS',
    callback: getSetting(db, 'expresspay_callback_url', '') || getSetting(db, 'paystack_callback_url', ''),
  };
}

function credentials(c) {
  return { 'merchant-id': c.merchant, 'api-key': c.key };
}

// The token out of a checkout URL we built earlier.
function tokenFromUrl(url) {
  const text = String(url || '');
  if (!text.includes('token=')) return '';
  return text.split('token=')[1].split('&')[0].trim();
}

const expresspay = {
  id: 'expresspay',
  channels: ['card', 'mobile_money'],
  cardBrands: ['visa', 'mastercard'],
  signedCallbacks: false,
  isConfigured(db) {
    const c = cfg(db);
    return !!(c.merchant && c.key);
  },

  async initialize(db, { amount, email, reference, metadata }) {
    const c = cfg(db);
    if (!this.isConfigured(db)) return { ok: false, error: 'expresspay_not_configured' };
    const res = await httpForm(`${c.base}/submit.php`, {
      ...credentials(c),
      currency: c.currency,
      amount: (Math.round(Number(amount) * 100) / 100).toFixed(2),
      'order-id': reference,
      'order-desc': (metadata && metadata.description) || 'School fees',
      'redirect-url': c.callback || '',
      'post-url': c.callback || '',
      email: email || 'payments@nicklandedusoft.app',
    });
    const p = res.json || {};
    if (res.status >= 200 && res.status < 300 && String(p.status) === '1' && p.token) {
      // The address the payer goes to is assembled here: ExpressPay returns a
      // token and expects the merchant to build the URL around it.
      return {
        ok: true,
        authorization_url: `${c.base}/checkout.php?token=${encodeURIComponent(p.token)}`,
        reference,
        access_code: p.token,
      };
    }
    return { ok: false, error: p.message || res.error || `expresspay_init_failed_${res.status}` };
  },

  // `token` comes from the caller, which reads it off the stored checkout URL.
  // Without one there is nothing to ask about, and saying that plainly beats a
  // confusing 400 from the provider.
  async verify(db, reference, { token } = {}) {
    const c = cfg(db);
    if (!this.isConfigured(db)) return { ok: false, error: 'expresspay_not_configured' };
    if (!token) return { ok: false, error: 'expresspay_needs_token' };
    const res = await httpForm(`${c.base}/query.php`, { ...credentials(c), token });
    if (!(res.status >= 200 && res.status < 300)) {
      return { ok: false, error: res.error || `expresspay_verify_failed_${res.status}` };
    }
    const p = res.json || {};
    const result = String(p.result || '');
    return {
      ok: true,
      paid: result === '1',
      // Pending is not failure. A mobile-money payer who has not yet approved
      // the prompt sits here for a minute or two, and treating that as a
      // decline would tell a parent their money failed when it has not.
      pending: result === '3',
      amount: Number(p.amount) || 0,
      currency: p.currency || c.currency,
      gateway_status: p['result-text'] || result,
      raw: p,
    };
  },

  // False, always. ExpressPay does not sign its callbacks.
  verifyWebhook() { return false; },

  webhookReference(payload) {
    const p = payload || {};
    return p['order-id'] || p.order_id || null;
  },
  webhookToken(payload) { return (payload && payload.token) || ''; },
  webhookIsSuccess() { return true; },   // a nudge, never a verdict — see above
};

module.exports = expresspay;
module.exports.tokenFromUrl = tokenFromUrl;
