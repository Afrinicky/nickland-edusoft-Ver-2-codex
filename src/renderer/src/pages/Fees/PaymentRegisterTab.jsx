// Nickland Edusoft — The register of what has been taken.
//
// Every receipt written, whatever it was for, in one list. This is the screen a
// bursar balances the drawer against at four o'clock and the one a proprietor
// opens when they want to know what came in this week — which is why it counts
// school fees, books, the canteen and the bus together rather than making
// somebody add up four modules.
import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate, fullName } from '../../lib/format.js';
import Receipt from './Receipt.jsx';

function todayISO() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const RANGES = [
  { id: 'today', label: 'Today', from: todayISO, to: todayISO },
  { id: 'week', label: 'Last 7 days', from: () => daysAgo(6), to: todayISO },
  { id: 'month', label: 'Last 30 days', from: () => daysAgo(29), to: todayISO },
  { id: 'all', label: 'Everything', from: () => null, to: () => null },
  { id: 'custom', label: 'Between dates', from: null, to: null },
];

export default function PaymentRegisterTab() {
  const classes = useStore(s => s.classes);
  const showToast = useStore(s => s.showToast);

  const [config, setConfig] = useState({ purposes: [], methods: [] });
  const [range, setRange] = useState('today');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [purposes, setPurposes] = useState([]);
  const [classId, setClassId] = useState('');
  const [method, setMethod] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    window.api.payments.purposes().then(r => r?.ok && setConfig(r)).catch(() => {});
  }, []);

  useEffect(() => {
    const preset = RANGES.find(r => r.id === range);
    if (preset && preset.from) { setFrom(preset.from()); setTo(preset.to()); }
  }, [range]);

  useEffect(() => {
    let live = true;
    const id = setTimeout(async () => {
      const r = await window.api.payments.register({
        from: from || null, to: to || null,
        purposes: purposes.length ? purposes : undefined,
        classId: classId || undefined,
        method: method || undefined,
        q: q || undefined,
      });
      if (live) setData(r?.ok ? r : { payments: [], total: 0, count: 0 });
    }, 200);
    return () => { live = false; clearTimeout(id); };
  }, [from, to, purposes.join(','), classId, method, q]);

  const rows = data?.payments || [];

  // The drawer, split by how the money arrived — which is the split that
  // matters when you are counting notes against a screen.
  const byMethod = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const k = r.payment_method || 'Cash';
      map.set(k, (map.get(k) || 0) + (Number(r.amount) || 0));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  async function openReceipt(row) {
    const r = await window.api.payments.receipt({ source: row.source, paymentId: row.id });
    if (!r?.ok) return showToast(r?.error || 'That receipt could not be read', 'error');
    setReceipt(r.receipt);
  }

  async function print() {
    if (!receipt) return;
    setPrinting(true);
    const res = await window.api.receipts.print({
      paymentSource: receipt.source, paymentId: receipt.payment_id,
    });
    setPrinting(false);
    if (!res?.ok) showToast(res?.error || 'The receipt could not be printed', 'error');
  }

  function togglePurpose(key) {
    setPurposes(list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]));
  }

  if (receipt) {
    return (
      <div style={{ display: 'grid', gap: 14, justifyItems: 'center' }}>
        <Receipt receipt={receipt} busy={printing} onPrint={print} onClose={() => setReceipt(null)} />
      </div>
    );
  }

  return (
    <div>
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="metric-card">
          <div className="metric-body">
            <div className="metric-label">Taken</div>
            <div className="metric-value success">{fmtCedi(data?.total || 0)}</div>
            <div className="metric-sub">
              {from || to ? `${from || 'the beginning'} → ${to || 'today'}` : 'every payment on record'}
            </div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-body">
            <div className="metric-label">Receipts</div>
            <div className="metric-value">{data?.count || 0}</div>
            <div className="metric-sub">
              {rows.length >= 400 ? 'showing the most recent 400' : 'every one in the range'}
            </div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-body">
            <div className="metric-label">How it came in</div>
            <div style={{ display: 'grid', gap: 2, marginTop: 4 }}>
              {byMethod.length === 0
                ? <div className="text-sm text-muted">Nothing yet</div>
                : byMethod.map(([m, total]) => (
                  <div key={m} className="row gap-2 text-sm">
                    <span>{m}</span><span className="flex-1"></span>
                    <span className="bold">{fmtCedi(total)}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="toolbar">
          <select className="select" style={{ maxWidth: 160 }}
            value={range} onChange={e => setRange(e.target.value)}>
            {RANGES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          {range === 'custom' && (
            <>
              <input className="input" type="date" style={{ maxWidth: 160 }}
                value={from || ''} onChange={e => setFrom(e.target.value)} />
              <input className="input" type="date" style={{ maxWidth: 160 }}
                value={to || ''} onChange={e => setTo(e.target.value)} />
            </>
          )}
          <select className="select" style={{ maxWidth: 170 }}
            value={classId} onChange={e => setClassId(e.target.value)}>
            <option value="">Every class</option>
            {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
          </select>
          <select className="select" style={{ maxWidth: 170 }}
            value={method} onChange={e => setMethod(e.target.value)}>
            <option value="">Any method</option>
            {config.methods.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input className="input" style={{ flex: 1, minWidth: 160 }}
            placeholder="Name, admission number or receipt"
            value={q} onChange={e => setQ(e.target.value)} />
        </div>

        <div className="row gap-2" style={{ flexWrap: 'wrap', padding: '0 0 10px' }}>
          <span className="text-sm text-muted" style={{ alignSelf: 'center' }}>Paid for:</span>
          {config.purposes.map(p => {
            const on = purposes.includes(p.key);
            return (
              <button key={p.key} className={'btn btn-sm ' + (on ? 'btn-primary' : 'btn-outline')}
                onClick={() => togglePurpose(p.key)}>{p.label}</button>
            );
          })}
          {purposes.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setPurposes([])}>All of them</button>
          )}
        </div>

        <div className="table-wrap" style={{ maxHeight: 520 }}>
          <table>
            <thead>
              <tr>
                <th>Receipt</th><th>Pupil</th><th>Class</th><th>Paid for</th>
                <th>Date</th><th>How</th><th>Taken by</th>
                <th className="text-right">Amount</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.source}-${r.id}`}>
                  <td className="text-sm" style={{ fontFamily: 'monospace' }}>{r.receipt_number || '—'}</td>
                  <td>{fullName(r)}<div className="text-xs text-muted">{r.index_number}</div></td>
                  <td className="text-sm">{r.class_name}</td>
                  <td><span className="badge badge-muted">{sourceLabel(r.source)}</span></td>
                  <td className="text-sm text-muted">{fmtDate(r.payment_date)}</td>
                  <td className="text-sm">
                    {r.payment_method}
                    {r.reference && <div className="text-xs text-muted">{r.reference}</div>}
                  </td>
                  <td className="text-sm">{r.received_by_name || '—'}</td>
                  <td className="text-right bold" style={{ color: 'var(--success)' }}>
                    {fmtCedi(r.amount)}
                  </td>
                  <td className="text-right">
                    <button className="btn btn-outline btn-sm" onClick={() => openReceipt(r)}>
                      Receipt
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan="9">
                    <div className="empty-state">
                      <h3>Nothing taken in that range</h3>
                      <p>Widen the dates, or clear a filter.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan="7">{data.count} receipt(s)</td>
                  <td className="text-right" style={{ color: 'var(--success)' }}>{fmtCedi(data.total)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

function sourceLabel(source) {
  return { fees: 'School fees', books: 'Books', canteen: 'Canteen', transport: 'Transport' }[source] || source;
}
