// Nickland Edusoft — Online payment gateway settings
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Four providers, and off. The same four the cloud offers
// (cloud-python/app/gateways/), so a school that sets up online payments here
// and later moves to the portal — or the other way round — does not have to
// change provider to do it.
//
// The fields are declared, not hand-written per provider, because the set of
// providers is going to grow and a form written four times is a form that gets
// updated three times. Secret fields are write-only: the server never reads
// them back (see SETTINGS_WRITE_ONLY in electron/server/admin_api.js), so an
// empty secret box means "the one already saved", not "no key".
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

const GATEWAYS = [
  { id: 'none', label: 'Off — no online payments' },
  { id: 'paystack', label: 'Paystack' },
  { id: 'flutterwave', label: 'Flutterwave' },
  { id: 'hubtel', label: 'Hubtel' },
  { id: 'expresspay', label: 'ExpressPay' },
];

// key, label, secret?, placeholder, hint
const FIELDS = {
  paystack: {
    title: 'Paystack',
    where: 'Paystack dashboard → Settings → API Keys & Webhooks.',
    fields: [
      ['paystack_secret_key', 'Secret key', true, 'sk_live_… or sk_test_…'],
      ['paystack_public_key', 'Public key', false, 'pk_live_… or pk_test_…'],
      ['paystack_base_url', 'API address (optional)', false, 'https://api.paystack.co'],
      ['paystack_callback_url', 'Callback URL (optional)', false, 'Leave blank — the app handles return'],
    ],
  },
  flutterwave: {
    title: 'Flutterwave',
    where: 'Flutterwave dashboard → Settings → API.',
    fields: [
      ['flutterwave_secret_key', 'Secret key', true, 'FLWSECK-…'],
      ['flutterwave_public_key', 'Public key', false, 'FLWPUBK-…'],
      ['flutterwave_secret_hash', 'Webhook secret hash', true, 'Settings → Webhooks → Secret hash',
        'Type the SAME text here and in the dashboard, or Flutterwave’s notifications are refused.'],
      ['flutterwave_base_url', 'API address (optional)', false, 'https://api.flutterwave.com/v3'],
      ['flutterwave_callback_url', 'Callback URL (optional)', false, 'Leave blank — the app handles return'],
    ],
  },
  hubtel: {
    title: 'Hubtel',
    where: 'Hubtel dashboard → API Keys.',
    fields: [
      ['hubtel_client_id', 'API ID', true, 'Sometimes shown as Client ID or Username'],
      ['hubtel_client_secret', 'API key', true, 'Sometimes shown as Client Secret'],
      ['hubtel_merchant_account', 'Merchant account number', false, '2019204',
        'The Hubtel account the money is paid into. Digits only.'],
      ['hubtel_base_url', 'Checkout address (optional)', false, 'https://payproxyapi.hubtel.com'],
      ['hubtel_status_url', 'Status address (optional)', false, 'https://api-txnstatus.hubtel.com'],
      ['hubtel_callback_url', 'Callback URL (optional)', false, 'Leave blank — the app handles return'],
    ],
    note: 'Hubtel does not sign its notifications, so a notification only tells Edusoft to go and '
        + 'ask Hubtel whether the payment really happened. Nothing is recorded until Hubtel itself '
        + 'confirms it.',
  },
  expresspay: {
    title: 'ExpressPay',
    where: 'Issued by your ExpressPay account manager.',
    fields: [
      ['expresspay_merchant_id', 'Merchant ID', false, ''],
      ['expresspay_api_key', 'API key', true, 'Keep it off email'],
      ['expresspay_base_url', 'Environment', false, 'https://expresspaygh.com/api',
        'https://sandbox.expresspaygh.com/api for testing; the live address for real money.'],
      ['expresspay_callback_url', 'Callback URL (optional)', false, 'Leave blank — the app handles return'],
    ],
    note: 'ExpressPay does not sign its notifications either. As with Hubtel, a notification is a '
        + 'prompt to check, never the confirmation itself.',
  },
};

export default function Payments() {
  const settings = useStore(s => s.settings);
  const loadSettings = useStore(s => s.loadSettings);
  const showToast = useStore(s => s.showToast);
  const [data, setData] = useState({});

  useEffect(() => { setData(settings.payments || {}); }, [settings]);
  const set = (k, v) => setData(prev => ({ ...prev, [k]: v }));

  async function save() {
    for (const [k, v] of Object.entries(data)) await window.api.settings.set(k, v);
    await loadSettings();
    showToast('Payment settings saved', 'success');
  }

  const gw = data.payment_gateway || 'none';
  const spec = FIELDS[gw];

  return (
    <div>
      <div className="card mb-4">
        <h3 className="card-title">Online payments</h3>
        <p className="text-sm text-muted" style={{ marginTop: 4 }}>
          Let parents pay fees from the app/portal by card or mobile money. When a payment succeeds it is
          recorded automatically and the receipt is sent — no manual entry. Office and bank-deposit payments
          are still recorded by hand under Fees.
        </p>
        <div className="form-row" style={{ marginTop: 12 }}>
          <div className="form-group">
            <label className="label">Provider</label>
            <select className="select" value={gw} onChange={e => set('payment_gateway', e.target.value)}>
              {GATEWAYS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Currency</label>
            <select className="select" value={data.payment_currency || 'GHS'} onChange={e => set('payment_currency', e.target.value)}>
              <option value="GHS">GHS — Ghana Cedi</option>
              <option value="NGN">NGN — Naira</option>
              <option value="USD">USD — US Dollar</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-muted" style={{ marginTop: 8 }}>
          The money goes to your school’s own account with the provider. Nickland never holds it.
        </p>
      </div>

      {spec && (
        <div className="card mb-4">
          <h3 className="card-title">{spec.title}</h3>
          <p className="text-sm text-muted" style={{ marginTop: 4 }}>{spec.where}</p>
          {spec.fields.map(([key, label, secret, placeholder, hint]) => (
            <div className="form-group" key={key}>
              <label className="label">{label}</label>
              <input
                className="input"
                type={secret ? 'password' : 'text'}
                value={data[key] || ''}
                placeholder={placeholder}
                autoComplete="off"
                onChange={e => set(key, e.target.value)}
              />
              {hint ? <div className="text-xs text-muted" style={{ marginTop: 4 }}>{hint}</div> : null}
            </div>
          ))}
          {spec.note ? (
            <div className="text-xs text-muted" style={{ marginTop: 8 }}>{spec.note}</div>
          ) : null}
          <div className="text-xs text-muted" style={{ marginTop: 8 }}>
            For automatic confirmation without the app polling, point the provider’s webhook at
            <code> {`https://<your-host>/api/v1/payments/webhook/${gw}`} </code>
            (the host must be reachable over the internet). On LAN the app verifies each payment
            directly, so a webhook isn’t required.
          </div>
        </div>
      )}

      <button className="btn btn-primary" onClick={save}>Save payment settings</button>
    </div>
  );
}
