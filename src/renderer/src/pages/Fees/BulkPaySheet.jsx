// Nickland Edusoft — Bulk Payment Sheet.
//
// A class at a time, on collection day. When forty parents are outside, the
// office works down a sheet — it does not open forty forms.
//
// ── What changed, and what deliberately did not ─────────────────────────────
//
// The sheet is the same sheet: pick a class, see every pupil against what they
// owe, type into the green column, press Enter. That layout is what the school
// uses and it stays.
//
// What is new is that it now takes money for anything the school charges for,
// not only school fees — the same list of purposes as the single-payment desk —
// and it captures what a receipt actually needs: the mode of payment, and the
// transaction reference for anything that is not cash. Those are set once at
// the top of the sheet, because on collection day forty parents pay the same
// way and re-typing "Cash" forty times is not data entry, it is friction.
//
// The Actions column was two grey icons at 45% opacity that nobody could see
// were buttons. It is now a labelled Save, and — once a row is receipted — a
// receipt number you can click, which is the thing a bursar actually wants:
// proof it went through, and a way back to the paper.
import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, termLabel } from '../../lib/format.js';
import Receipt from './Receipt.jsx';

export default function FeesBulkPaySheet() {
  const { classes, currentTerm, currentUser } = useStore();
  const showToast = useStore(s => s.showToast);

  const [config, setConfig] = useState({ purposes: [], methods: [], reference_required: [] });
  const [purpose, setPurpose] = useState('school_fees');
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');

  const [classId, setClassId] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [amountInputs, setAmountInputs] = useState({});
  const [savingRowId, setSavingRowId] = useState(null);
  const [lastPaid, setLastPaid] = useState({});
  const [receipt, setReceipt] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [busyAll, setBusyAll] = useState(false);

  useEffect(() => {
    window.api.payments.purposes().then(r => r?.ok && setConfig(r)).catch(() => {});
  }, []);

  async function refresh() {
    if (!classId) { setRows([]); return; }
    setLoading(true);
    const data = await window.api.feesBulkPay.sheet({ classId, termId: currentTerm?.id });
    setRows(data || []);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [classId, currentTerm?.id]);

  const needsReference = (config.reference_required || []).includes(method);
  const purposeLabel = config.purposes.find(p => p.key === purpose)?.label || 'School Fees';

  async function save(row) {
    const amount = parseFloat(amountInputs[row.student_id]);
    if (!(amount > 0)) return showToast('Enter a positive amount before saving', 'warning');
    if (needsReference && !reference.trim()) {
      return showToast(`A ${method.toLowerCase()} payment needs its transaction reference — `
        + 'put it in at the top of the sheet', 'warning');
    }
    if (purpose === 'school_fees' && amount > row.balance + 1) {
      if (!window.confirm(
        `${fmtCedi(amount)} is more than the ${fmtCedi(row.balance)} outstanding. `
        + 'Record it anyway? The extra stays as credit on the account.')) return;
    }

    setSavingRowId(row.student_id);
    const res = await window.api.payments.take({
      studentId: row.student_id,
      purpose,
      referenceId: purpose === 'school_fees' ? row.bill_id : undefined,
      amount, method,
      reference: reference.trim(),
      termId: currentTerm?.id,
    });
    setSavingRowId(null);
    if (!res?.ok) return showToast(res?.error || 'The payment could not be recorded', 'error');

    setAmountInputs(prev => { const n = { ...prev }; delete n[row.student_id]; return n; });
    setLastPaid(prev => ({
      ...prev,
      [row.student_id]: {
        receiptNo: res.receipt_number, amount,
        paymentId: res.payment_id, source: res.source, receipt: res.receipt,
      },
    }));
    const sent = (res.delivered || []).length ? ` · sent by ${res.delivered.join(' & ')}` : '';
    showToast(`${fmtCedi(amount)} — receipt ${res.receipt_number}${sent}`, 'success');
    refresh();
  }

  // Receipting the whole column at once. The office's own instruction on
  // collection day is "take them all", and pressing Save down forty rows is
  // the same instruction with thirty-nine extra clicks in it.
  async function saveAll() {
    const entered = Object.entries(amountInputs).filter(([, v]) => parseFloat(v) > 0);
    if (!entered.length) return showToast('Nothing typed in yet', 'warning');
    if (needsReference && !reference.trim()) {
      return showToast(`A ${method.toLowerCase()} payment needs its transaction reference`, 'warning');
    }
    const total = entered.reduce((n, [, v]) => n + parseFloat(v), 0);
    if (!window.confirm(
      `Receipt ${entered.length} payment(s) totalling ${fmtCedi(total)} as ${purposeLabel}, `
      + `paid by ${method}?`)) return;

    setBusyAll(true);
    let done = 0;
    let lastError = null;
    const paid = {};
    for (const [studentId, value] of entered) {
      const row = rows.find(r => String(r.student_id) === String(studentId));
      const res = await window.api.payments.take({
        studentId: Number(studentId), purpose,
        referenceId: purpose === 'school_fees' ? row?.bill_id : undefined,
        amount: parseFloat(value), method, reference: reference.trim(),
        termId: currentTerm?.id,
      });
      if (res?.ok) {
        done += 1;
        paid[studentId] = {
          receiptNo: res.receipt_number, amount: parseFloat(value),
          paymentId: res.payment_id, source: res.source, receipt: res.receipt,
        };
      } else { lastError = res?.error; }
    }
    setBusyAll(false);
    setLastPaid(prev => ({ ...prev, ...paid }));
    setAmountInputs({});
    if (done) showToast(`${done} payment(s) receipted — ${fmtCedi(total)}`, 'success');
    if (lastError) showToast(`Some could not be taken: ${lastError}`, done ? 'warning' : 'error');
    refresh();
  }

  function showReceipt(row) {
    const lp = lastPaid[row.student_id];
    if (!lp) return;
    if (lp.receipt) return setReceipt(lp.receipt);
    window.api.payments.receipt({ source: lp.source, paymentId: lp.paymentId })
      .then(r => r?.ok && setReceipt(r.receipt))
      .catch(() => showToast('That receipt could not be read', 'error'));
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

  const filteredRows = statusFilter ? rows.filter(r => r.status === statusFilter) : rows;

  const totals = useMemo(() => filteredRows.reduce((acc, r) => ({
    gross_billed: acc.gross_billed + (r.gross_billed || 0),
    discount: acc.discount + (r.discount_amount || 0),
    net_billed: acc.net_billed + (r.net_billed || 0),
    paid: acc.paid + (r.fees_paid || 0),
    balance: acc.balance + (r.balance || 0),
  }), { gross_billed: 0, discount: 0, net_billed: 0, paid: 0, balance: 0 }), [filteredRows]);

  const entered = Object.entries(amountInputs).filter(([, v]) => parseFloat(v) > 0);
  const enteredTotal = entered.reduce((n, [, v]) => n + parseFloat(v), 0);

  if (receipt) {
    return (
      <div style={{ display: 'grid', gap: 14, justifyItems: 'center' }}>
        <Receipt receipt={receipt} busy={printing} onPrint={print} onClose={() => setReceipt(null)} />
      </div>
    );
  }

  return (
    <div className="bulk-pay-sheet">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="card no-print">
        <div className="section-header">
          <div>
            <div className="section-title">Bulk Payment Sheet</div>
            <div className="text-sm text-muted">
              Enter payments quickly for an entire class · Term:{' '}
              <strong>{termLabel(currentTerm, '—')}</strong>
            </div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => window.print()}>
            🖨 Print Class List
          </button>
        </div>

        <div className="form-row" style={{ marginTop: 14 }}>
          <div className="form-group">
            <label>Class</label>
            <select value={classId} onChange={e => setClassId(e.target.value)}>
              <option value="">— Select Class —</option>
              {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Filter by Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Students</option>
              <option value="paid_full">Paid in Full</option>
              <option value="paid_partial">Partial Payment</option>
              <option value="unpaid">Not Paid</option>
              <option value="not_billed">Not Billed</option>
            </select>
          </div>
        </div>

        {/* What every payment on this sheet is for, and how it arrived. Set
            once: on collection day forty parents pay the same way. */}
        <div className="form-row">
          <div className="form-group">
            <label>Payment purpose</label>
            <select value={purpose} onChange={e => setPurpose(e.target.value)}>
              {config.purposes.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Mode of payment</label>
            <select value={method} onChange={e => setMethod(e.target.value)}>
              {config.methods.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>
              Reference {needsReference ? <span style={{ color: 'var(--danger)' }}>*</span> : '(cash needs none)'}
            </label>
            <input className="input" value={reference} disabled={!needsReference}
              placeholder={needsReference ? 'Transaction ID or slip number' : '—'}
              onChange={e => setReference(e.target.value)} />
          </div>
        </div>

        <div className="text-xs text-muted">
          Every receipt written from this sheet is dated and timed automatically and
          carries <b>{currentUser?.full_name || currentUser?.username || 'your name'}</b> as
          the person who took the money.
          {purpose !== 'school_fees' && (
            <> Amounts typed below are taken as <b>{purposeLabel}</b>, not as school fees —
              the balances in the table are still the fees ones.</>
          )}
        </div>
      </div>

      {/* ── Summary band ───────────────────────────────────────────── */}
      {classId && rows.length > 0 && (
        <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 16 }}>
          <Metric label="Billed (Net)" value={fmtCedi(totals.net_billed)}
            sub={`After ${fmtCedi(totals.discount)} discounts`} />
          <Metric label="Collected" value={fmtCedi(totals.paid)} tone="success"
            sub={`${rows.filter(r => r.status === 'paid_full').length} fully paid`} />
          <Metric label="Outstanding" value={fmtCedi(totals.balance)} tone="danger"
            sub={`${rows.filter(r => r.balance > 0).length} debtors`} />
          <Metric label="Collection Rate"
            value={`${totals.net_billed > 0 ? Math.round((totals.paid / totals.net_billed) * 100) : 0}%`} />
        </div>
      )}

      {/* ── The sheet ──────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        {!classId
          ? <div className="empty-state" style={{ padding: 40 }}>Select a class to begin</div>
          : loading
            ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
            : filteredRows.length === 0
              ? <div className="empty-state" style={{ padding: 30 }}>No students match the filter</div>
              : <div className="sheet-wrap" style={{ maxHeight: 'calc(100vh - 480px)' }}>
                <table className="sheet-table bulk-pay-table">
                  <thead>
                    <tr>
                      <th className="sheet-row-num-header">#</th>
                      <th style={{ minWidth: 100 }}>Index No.</th>
                      <th style={{ minWidth: 150 }}>Name</th>
                      <th style={{ minWidth: 60 }}>Class</th>
                      <th className="text-right" style={{ minWidth: 110 }}>Term Fees</th>
                      <th className="text-right" style={{ minWidth: 95 }}>Discount</th>
                      <th className="text-right" style={{ minWidth: 110 }}>Net Billed</th>
                      <th className="text-right" style={{ minWidth: 110 }}>Total Paid</th>
                      <th className="text-right" style={{ minWidth: 110 }}>Balance</th>
                      <th style={{ minWidth: 100 }}>Status</th>
                      <th style={{ minWidth: 130 }} className="bulk-pay-amount-col">Amount Paid Now</th>
                      <th style={{ minWidth: 210 }} className="no-print">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, i) => {
                      const inputVal = amountInputs[row.student_id] || '';
                      const hasInput = inputVal && parseFloat(inputVal) > 0;
                      const lp = lastPaid[row.student_id];
                      const saving = savingRowId === row.student_id;
                      return (
                        <tr key={row.student_id}>
                          <td className="sheet-row-num">{i + 1}</td>
                          <td className="sheet-cell" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                            {row.index_number}
                          </td>
                          <td className="sheet-cell">
                            <strong>{row.surname}</strong>, {row.first_name} {row.other_names || ''}
                          </td>
                          <td className="sheet-cell">{row.class_short}</td>
                          <td className="sheet-cell text-right">{plain(row.gross_billed)}</td>
                          <td className="sheet-cell text-right">
                            {row.discount_amount > 0 ? (
                              <span style={{ color: 'var(--success)' }} title={row.discount_reason || ''}>
                                −{plain(row.discount_amount)}
                                {row.discount_label && <div className="text-xs">({row.discount_label})</div>}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="sheet-cell text-right" style={{ fontWeight: 600 }}>
                            {plain(row.net_billed)}
                          </td>
                          <td className="sheet-cell text-right" style={{ color: 'var(--success)' }}>
                            {plain(row.fees_paid)}
                          </td>
                          <td className="sheet-cell text-right" style={{
                            fontWeight: 700,
                            color: row.balance > 0 ? 'var(--danger)' : 'var(--success)',
                          }}>{plain(row.balance)}</td>
                          <td className="sheet-cell">
                            <span className={'badge ' + statusBadge(row.status)}>
                              {statusLabel(row.status)}
                            </span>
                          </td>
                          <td className="sheet-cell bulk-pay-amount-col">
                            <input
                              type="number" step="0.01" min="0" value={inputVal}
                              onChange={e => setAmountInputs(prev => ({ ...prev, [row.student_id]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter' && hasInput) save(row); }}
                              placeholder="0.00"
                              className="bulk-pay-amount-input"
                              disabled={saving || (purpose === 'school_fees' && row.status === 'not_billed')}
                            />
                          </td>

                          {/* The Actions column, made legible. A row that has
                              nothing typed in it shows what to do; a row that
                              has been receipted shows its receipt number, which
                              is the proof a bursar is looking for, and clicking
                              it brings the receipt back up. */}
                          <td className="sheet-cell no-print">
                            {hasInput || saving ? (
                              <button className="btn btn-sm btn-success" disabled={saving}
                                onClick={() => save(row)} style={{ minWidth: 140 }}>
                                {saving ? 'Saving…' : `💾 Take ${fmtCedi(parseFloat(inputVal) || 0)}`}
                              </button>
                            ) : lp ? (
                              <div className="row gap-2" style={{ alignItems: 'center' }}>
                                <span className="badge badge-success" title="Receipted just now">
                                  {lp.receiptNo}
                                </span>
                                <button className="btn btn-sm btn-outline" onClick={() => showReceipt(row)}>
                                  View receipt
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-muted">
                                Type an amount to take a payment
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--primary-50)', fontWeight: 700 }}>
                      <td colSpan="4">TOTALS — {filteredRows.length} students</td>
                      <td className="text-right">{plain(totals.gross_billed)}</td>
                      <td className="text-right" style={{ color: 'var(--success)' }}>
                        −{plain(totals.discount)}
                      </td>
                      <td className="text-right">{plain(totals.net_billed)}</td>
                      <td className="text-right" style={{ color: 'var(--success)' }}>{plain(totals.paid)}</td>
                      <td className="text-right" style={{ color: 'var(--danger)' }}>{plain(totals.balance)}</td>
                      <td></td>
                      <td className="text-right bulk-pay-amount-col">
                        {enteredTotal > 0 ? plain(enteredTotal) : ''}
                      </td>
                      <td className="no-print"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
        }
      </div>

      {/* The whole column at once — the office's own instruction is "take
          them all", and pressing Save forty times is that instruction with
          thirty-nine extra clicks in it. */}
      {entered.length > 0 && (
        <div className="card no-print" style={{
          marginTop: 12, position: 'sticky', bottom: 12,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          borderColor: 'var(--primary)',
        }}>
          <div>
            <div className="bold" style={{ fontSize: 16 }}>
              {entered.length} payment(s) typed in · {fmtCedi(enteredTotal)}
            </div>
            <div className="text-sm text-muted">
              As {purposeLabel}, paid by {method}
              {reference ? ` · ref ${reference}` : ''}. Nothing is receipted until you press this.
            </div>
          </div>
          <div className="flex-1"></div>
          <button className="btn btn-ghost" onClick={() => setAmountInputs({})}>Clear the column</button>
          <button className="btn btn-primary" disabled={busyAll} onClick={saveAll}
            style={{ fontSize: 15, padding: '10px 18px' }}>
            {busyAll ? 'Receipting…' : `Receipt all ${entered.length}`}
          </button>
        </div>
      )}

      <div className="sheet-help no-print" style={{ marginTop: 12 }}>
        <strong>How to use:</strong> set what the money is for and how it arrived at the top ·
        type each amount in the green <strong>Amount Paid Now</strong> column ·
        press <kbd>Enter</kbd> or the row's <strong>Take</strong> button for one,
        or <strong>Receipt all</strong> for the whole column ·
        a receipted row shows its receipt number, and clicking it brings the receipt back up.
      </div>
    </div>
  );
}

function Metric({ label, value, sub, tone }) {
  const cls = tone === 'success' ? 'metric-value success'
    : tone === 'danger' ? 'metric-value danger' : 'metric-value';
  return (
    <div className="metric-card">
      <div className="metric-body">
        <div className="metric-label">{label}</div>
        <div className={cls}>{value}</div>
        {sub && <div className="metric-sub">{sub}</div>}
      </div>
    </div>
  );
}

// The sheet prints the figures without the currency on every cell — a column
// of "GHS" forty rows deep is noise, and the heading already says it.
function plain(n) {
  return fmtCedi(n).replace('GHS ', '');
}

function statusBadge(s) {
  return {
    paid_full: 'badge-success',
    paid_partial: 'badge-warning',
    unpaid: 'badge-danger',
    not_billed: 'badge-muted',
  }[s] || 'badge-muted';
}
function statusLabel(s) {
  return {
    paid_full: 'Full', paid_partial: 'Partial', unpaid: 'None', not_billed: 'No Bill',
  }[s] || s;
}
