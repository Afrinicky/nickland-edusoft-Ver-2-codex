// Nickland Edusoft — Fees Bulk Payment Sheet (WHONET-style)
// Pick a class → see every active student × their fee balance, type an amount,
// click Save (green when dirty), auto-clears, updates running totals.
import React, { useEffect, useState, useRef } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate } from '../../lib/format.js';

export default function FeesBulkPaySheet() {
  const { classes, currentTerm, currentUser } = useStore();
  const showToast = useStore(s => s.showToast);
  const [classId, setClassId] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [amountInputs, setAmountInputs] = useState({}); // { studentId: '120.00' }
  const [savingRowId, setSavingRowId] = useState(null);
  const [lastPaid, setLastPaid] = useState({}); // { studentId: { receiptNo, amount } }
  const [previewRow, setPreviewRow] = useState(null);

  async function refresh() {
    if (!classId) { setRows([]); return; }
    setLoading(true);
    const data = await window.api.feesBulkPay.sheet({
      classId,
      termId: currentTerm?.id,
    });
    setRows(data);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, [classId, currentTerm?.id]);

  async function save(row) {
    const amountStr = amountInputs[row.student_id];
    const amount = parseFloat(amountStr);
    if (!amount || amount <= 0) {
      showToast('Enter a positive amount before saving', 'warning');
      return;
    }
    if (amount > row.balance + 1) {
      if (!confirm(`Amount ${fmtCedi(amount)} exceeds balance ${fmtCedi(row.balance)}. Record as overpayment?`)) {
        return;
      }
    }
    setSavingRowId(row.student_id);
    const res = await window.api.feesBulkPay.record({
      student_id: row.student_id,
      bill_id: row.bill_id,
      term_id: currentTerm?.id,
      amount,
      payment_method: 'Cash',
      received_by: currentUser?.id,
    });
    setSavingRowId(null);
    if (!res.ok) {
      showToast(res.error || 'Save failed', 'error');
      return;
    }
    // Clear input, store last receipt + payment_id for Print/Preview wiring
    setAmountInputs(prev => { const n = { ...prev }; delete n[row.student_id]; return n; });
    setLastPaid(prev => ({
      ...prev,
      [row.student_id]: {
        receiptNo: res.receipt_number,
        amount,
        paymentId: res.payment_id,
      },
    }));
    showToast(`Saved ${fmtCedi(amount)} — receipt ${res.receipt_number}`, 'success');
    refresh();
  }

  async function printReceipt(row) {
    const lp = lastPaid[row.student_id];
    if (!lp?.paymentId) return showToast('No recent payment to print', 'info');
    const res = await window.api.receipts.generate({
      templateType: 'fees',
      paymentId: lp.paymentId,
      paymentSource: 'fees',
    });
    if (!res.ok) {
      showToast(res.error || 'Receipt generation failed', 'error');
      return;
    }
    // Open the generated docx in the OS default app (Word)
    const openRes = await window.api.app.openFile(res.output_path);
    if (openRes.ok) {
      showToast(`Receipt ${lp.receiptNo} opened in Word`, 'success');
    } else {
      showToast(`Receipt saved to ${res.output_path} — open it manually`, 'info');
    }
  }

  const filteredRows = statusFilter
    ? rows.filter(r => r.status === statusFilter)
    : rows;

  const totals = filteredRows.reduce(
    (acc, r) => ({
      gross_billed: acc.gross_billed + (r.gross_billed || 0),
      discount: acc.discount + (r.discount_amount || 0),
      net_billed: acc.net_billed + (r.net_billed || 0),
      paid: acc.paid + (r.fees_paid || 0),
      balance: acc.balance + (r.balance || 0),
    }),
    { gross_billed: 0, discount: 0, net_billed: 0, paid: 0, balance: 0 }
  );

  return (
    <div className="bulk-pay-sheet">
      {/* Toolbar */}
      <div className="card no-print">
        <div className="section-header">
          <div>
            <div className="section-title">Bulk Payment Sheet</div>
            <div className="text-sm text-muted">
              Enter payments quickly for an entire class · Term: <strong>{currentTerm?.label || '—'}</strong>
            </div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => window.print()}>🖨 Print Class List</button>
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
      </div>

      {/* Summary band */}
      {classId && rows.length > 0 && (
        <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 16 }}>
          <div className="metric-card">
            <div className="metric-body">
              <div className="metric-label">Billed (Net)</div>
              <div className="metric-value">{fmtCedi(totals.net_billed)}</div>
              <div className="metric-sub">After {fmtCedi(totals.discount)} discounts</div>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-body">
              <div className="metric-label">Collected</div>
              <div className="metric-value success">{fmtCedi(totals.paid)}</div>
              <div className="metric-sub">{rows.filter(r => r.status === 'paid_full').length} fully paid</div>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-body">
              <div className="metric-label">Outstanding</div>
              <div className="metric-value danger">{fmtCedi(totals.balance)}</div>
              <div className="metric-sub">{rows.filter(r => r.balance > 0).length} debtors</div>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-body">
              <div className="metric-label">Collection Rate</div>
              <div className="metric-value">
                {totals.net_billed > 0 ? Math.round((totals.paid / totals.net_billed) * 100) : 0}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* The sheet */}
      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        {!classId
          ? <div className="empty-state" style={{ padding: 40 }}>Select a class to begin</div>
          : loading
            ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
            : filteredRows.length === 0
              ? <div className="empty-state" style={{ padding: 30 }}>No students match the filter</div>
              : <div className="sheet-wrap" style={{ maxHeight: 'calc(100vh - 440px)' }}>
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
                        <th style={{ minWidth: 220 }} className="no-print">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((row, i) => {
                        const inputVal = amountInputs[row.student_id] || '';
                        const hasInput = inputVal && parseFloat(inputVal) > 0;
                        const lp = lastPaid[row.student_id];
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
                            <td className="sheet-cell text-right">{fmtCedi(row.gross_billed).replace('GHS ', '')}</td>
                            <td className="sheet-cell text-right">
                              {row.discount_amount > 0 && (
                                <span style={{ color: 'var(--success)' }} title={row.discount_reason || ''}>
                                  −{fmtCedi(row.discount_amount).replace('GHS ', '')}
                                  {row.discount_label && <div className="text-xs">({row.discount_label})</div>}
                                </span>
                              )}
                              {row.discount_amount === 0 && '—'}
                            </td>
                            <td className="sheet-cell text-right" style={{ fontWeight: 600 }}>
                              {fmtCedi(row.net_billed).replace('GHS ', '')}
                            </td>
                            <td className="sheet-cell text-right" style={{ color: 'var(--success)' }}>
                              {fmtCedi(row.fees_paid).replace('GHS ', '')}
                            </td>
                            <td className="sheet-cell text-right" style={{
                              fontWeight: 700,
                              color: row.balance > 0 ? 'var(--danger)' : 'var(--success)',
                            }}>
                              {fmtCedi(row.balance).replace('GHS ', '')}
                            </td>
                            <td className="sheet-cell">
                              <span className={'badge ' + statusBadge(row.status)}>
                                {statusLabel(row.status)}
                              </span>
                            </td>
                            <td className="sheet-cell bulk-pay-amount-col">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={inputVal}
                                onChange={e => setAmountInputs(prev => ({ ...prev, [row.student_id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter' && hasInput) save(row); }}
                                placeholder="0.00"
                                className="bulk-pay-amount-input"
                                disabled={row.status === 'not_billed' || savingRowId === row.student_id}
                              />
                            </td>
                            <td className="sheet-cell no-print">
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button
                                  className={'btn btn-sm ' + (hasInput ? 'btn-success' : 'btn-ghost')}
                                  disabled={!hasInput || savingRowId === row.student_id}
                                  onClick={() => save(row)}
                                  title="Save payment"
                                >
                                  {savingRowId === row.student_id ? '…' : '💾 Save'}
                                </button>
                                <button
                                  className={'btn btn-sm ' + (lp ? 'btn-outline' : 'btn-ghost')}
                                  disabled={!lp}
                                  onClick={() => printReceipt(row)}
                                  title="Print receipt of last payment"
                                >
                                  🖨
                                </button>
                                <button
                                  className={'btn btn-sm ' + (lp ? 'btn-outline' : 'btn-ghost')}
                                  disabled={!lp}
                                  onClick={() => setPreviewRow(row)}
                                  title="Preview last receipt"
                                >
                                  👁
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--primary-50)', fontWeight: 700 }}>
                        <td colSpan="4">TOTALS — {filteredRows.length} students</td>
                        <td className="text-right">{fmtCedi(totals.gross_billed).replace('GHS ','')}</td>
                        <td className="text-right" style={{ color: 'var(--success)' }}>
                          −{fmtCedi(totals.discount).replace('GHS ','')}
                        </td>
                        <td className="text-right">{fmtCedi(totals.net_billed).replace('GHS ','')}</td>
                        <td className="text-right" style={{ color: 'var(--success)' }}>{fmtCedi(totals.paid).replace('GHS ','')}</td>
                        <td className="text-right" style={{ color: 'var(--danger)' }}>{fmtCedi(totals.balance).replace('GHS ','')}</td>
                        <td colSpan="3"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
        }
      </div>

      <div className="sheet-help no-print" style={{ marginTop: 12 }}>
        <strong>How to use:</strong> Enter an amount in the green <strong>Amount Paid Now</strong> column · Press <kbd>Enter</kbd> or click <strong>💾 Save</strong> · The Save button turns green when there's something to save · After saving, Print and Preview buttons activate · Filter by status to focus on debtors or fully-paid students.
      </div>

      {previewRow && (
        <PreviewModal row={previewRow} lastPaid={lastPaid[previewRow.student_id]} onClose={() => setPreviewRow(null)} />
      )}
    </div>
  );
}

function statusBadge(s) {
  return {
    paid_full:    'badge-success',
    paid_partial: 'badge-warning',
    unpaid:       'badge-danger',
    not_billed:   'badge-muted',
  }[s] || 'badge-muted';
}
function statusLabel(s) {
  return {
    paid_full:    'Full',
    paid_partial: 'Partial',
    unpaid:       'None',
    not_billed:   'No Bill',
  }[s] || s;
}

function PreviewModal({ row, lastPaid, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Receipt Preview</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <table className="reports-table" style={{ width: '100%' }}>
          <tbody>
            <tr><td>Receipt #</td><td><strong>{lastPaid?.receiptNo || '—'}</strong></td></tr>
            <tr><td>Student</td><td>{row.surname}, {row.first_name}</td></tr>
            <tr><td>Index No.</td><td>{row.index_number}</td></tr>
            <tr><td>Class</td><td>{row.class_name}</td></tr>
            <tr style={{ borderTop: '2px solid', fontWeight: 700 }}>
              <td>Amount Paid</td>
              <td style={{ color: 'var(--success)', fontSize: 16 }}>{fmtCedi(lastPaid?.amount || 0)}</td>
            </tr>
            <tr><td>Balance Remaining</td><td>{fmtCedi(row.balance)}</td></tr>
          </tbody>
        </table>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>← Back to Sheet</button>
          <button className="btn btn-primary" onClick={() => { window.print(); }}>🖨 Print</button>
        </div>
      </div>
    </div>
  );
}
