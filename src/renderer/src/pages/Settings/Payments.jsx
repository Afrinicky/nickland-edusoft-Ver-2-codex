// Nickland Edusoft — Online payment gateway settings
// Paystack is the default; a school can pick another provider or turn online
// payments off entirely (they still take office/bank payments manually).
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

const GATEWAYS = [
  { id: 'none', label: 'Off — no online payments' },
  { id: 'paystack', label: 'Paystack' },
];

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
      </div>

      {gw === 'paystack' && (
        <div className="card mb-4">
          <h3 className="card-title">Paystack</h3>
          <div className="form-group">
            <label className="label">Secret key</label>
            <input className="input" type="password" value={data.paystack_secret_key || ''}
              onChange={e => set('paystack_secret_key', e.target.value)} placeholder="sk_live_… or sk_test_…" />
          </div>
          <div className="form-group">
            <label className="label">Public key</label>
            <input className="input" value={data.paystack_public_key || ''}
              onChange={e => set('paystack_public_key', e.target.value)} placeholder="pk_live_… or pk_test_…" />
          </div>
          <div className="form-group">
            <label className="label">Callback URL (optional)</label>
            <input className="input" value={data.paystack_callback_url || ''}
              onChange={e => set('paystack_callback_url', e.target.value)} placeholder="Leave blank — the app handles return" />
          </div>
          <div className="text-xs text-muted" style={{ marginTop: 4 }}>
            For automatic confirmation without the app polling, set your Paystack webhook to
            <code> {'https://<your-host>/api/v1/webhooks/paystack'} </code> (requires the host to be reachable over the internet).
            On LAN the app verifies each payment directly, so a webhook isn't required.
          </div>
        </div>
      )}

      <button className="btn btn-primary" onClick={save}>Save payment settings</button>
    </div>
  );
}
