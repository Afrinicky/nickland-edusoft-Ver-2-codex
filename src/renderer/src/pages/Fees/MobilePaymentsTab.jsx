// Nickland Edusoft — Mobile Payments review
// The accounts office reviews payments parents submitted from the app and
// acknowledges them (records the payment + auto-sends the receipt) or rejects.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate } from '../../lib/format.js';

const METHODS = ['Mobile Money', 'Bank Transfer', 'Cash'];

export default function MobilePaymentsTab() {
  const showToast = useStore(s => s.showToast);
  const [status, setStatus] = useState('pending');
  const [intents, setIntents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  async function refresh() {
    setLoading(true);
    const res = await window.api.paymentIntents.list(status);
    setIntents(res.intents || []);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [status]);

  async function acknowledge(intent, method) {
    setBusyId(intent.id);
    const res = await window.api.paymentIntents.acknowledge({ intentId: intent.id, method });
    setBusyId(null);
    if (!res.ok) return showToast(res.error || 'Failed', 'error');
    const sent = res.delivered && res.delivered.length ? ` · sent via ${res.delivered.join(' & ')}` : '';
    showToast(`Recorded ${fmtCedi(intent.amount)} — receipt ${res.receipt_number}${sent}`, 'success');
    refresh();
  }

  async function reject(intent) {
    const reason = prompt('Reason for rejecting this payment (optional):') ?? '';
    setBusyId(intent.id);
    const res = await window.api.paymentIntents.reject({ intentId: intent.id, reason });
    setBusyId(null);
    if (!res.ok) return showToast(res.error || 'Failed', 'error');
    showToast('Payment rejected', 'success');
    refresh();
  }

  return (
    <div>
      <div className="card no-print">
        <div className="section-header">
          <div>
            <div className="section-title">Mobile payments</div>
            <div className="text-sm text-muted">
              Payments parents submitted from the app. Acknowledge to record them and auto-send the receipt.
            </div>
          </div>
          <select className="select" style={{ maxWidth: 200 }} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        {loading
          ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
          : intents.length === 0
            ? <div className="empty-state" style={{ padding: 30 }}>No {status} payments.</div>
            : <div className="table-wrap">
                <table className="reports-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Student</th><th>Class</th><th>Parent</th>
                      <th className="text-right">Amount</th><th>Channel</th><th>Reference</th><th>Submitted</th>
                      {status === 'pending' && <th style={{ minWidth: 260 }}>Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {intents.map(it => (
                      <tr key={it.id}>
                        <td><strong>{it.surname}, {it.first_name}</strong><div className="text-xs text-muted">{it.index_number}</div></td>
                        <td>{it.class_name || '—'}</td>
                        <td>{it.parent_name || '—'}<div className="text-xs text-muted">{it.parent_phone || ''}</div></td>
                        <td className="text-right" style={{ fontWeight: 700 }}>{fmtCedi(it.amount)}</td>
                        <td>{labelChannel(it.channel)}</td>
                        <td className="text-sm">{it.reference || '—'}</td>
                        <td className="text-sm">{fmtDate(it.created_at)}</td>
                        {status === 'pending' && (
                          <td>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              <AckControl intent={it} busy={busyId === it.id} onAck={acknowledge} />
                              <button className="btn btn-ghost btn-sm" disabled={busyId === it.id} onClick={() => reject(it)}>Reject</button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
        }
      </div>
    </div>
  );
}

function AckControl({ intent, busy, onAck }) {
  const [method, setMethod] = useState(defaultMethod(intent.channel));
  return (
    <>
      <select className="select" style={{ maxWidth: 150, padding: '4px 8px' }} value={method} onChange={e => setMethod(e.target.value)}>
        {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <button className="btn btn-success btn-sm" disabled={busy} onClick={() => onAck(intent, method)}>
        {busy ? '…' : '✓ Acknowledge'}
      </button>
    </>
  );
}

function labelChannel(c) {
  return { mobile: 'Mobile Money', mobile_money: 'Mobile Money', bank: 'Bank', cash: 'Cash' }[c] || c || '—';
}
function defaultMethod(c) {
  return { bank: 'Bank Transfer', cash: 'Cash' }[c] || 'Mobile Money';
}
