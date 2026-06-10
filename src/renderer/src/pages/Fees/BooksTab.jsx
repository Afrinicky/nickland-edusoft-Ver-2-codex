// Nickland Edusoft — Books Tab
// Books are billed at start of academic year. Unpaid balance carries
// forward to Term 2/3 bills as "Books Arrears" (visually separated).
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi } from '../../lib/format.js';

export default function BooksTab() {
  const { classes, currentUser } = useStore();
  const showToast = useStore(s => s.showToast);
  const [academicYears, setAcademicYears] = useState([]);
  const [classId, setClassId] = useState('');
  const [yearId, setYearId] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [amountInputs, setAmountInputs] = useState({});
  const [savingRowId, setSavingRowId] = useState(null);
  const [lastPaid, setLastPaid] = useState({});
  const [setupModal, setSetupModal] = useState(false);

  useEffect(() => {
    (async () => {
      const ys = await window.api.settings.listAcademicYears();
      setAcademicYears(ys);
      const cur = ys.find(y => y.is_current);
      if (cur) setYearId(cur.id);
    })();
  }, []);

  async function refresh() {
    if (!classId || !yearId) { setRows([]); return; }
    setLoading(true);
    const data = await window.api.books.classPaymentSheet({ classId, academicYearId: yearId });
    setRows(data);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [classId, yearId]);

  async function save(row) {
    const amount = parseFloat(amountInputs[row.student_id]);
    if (!amount || amount <= 0) return showToast('Enter a positive amount', 'warning');
    setSavingRowId(row.student_id);
    const res = await window.api.books.recordPayment({
      student_id: row.student_id,
      student_books_id: row.student_books_id,
      amount,
      payment_method: 'Cash',
      received_by: currentUser?.id,
    });
    setSavingRowId(null);
    if (res.ok) {
      setAmountInputs(prev => { const n = { ...prev }; delete n[row.student_id]; return n; });
      setLastPaid(prev => ({
        ...prev,
        [row.student_id]: { receiptNo: res.receipt_number, amount, paymentId: res.payment_id },
      }));
      showToast(`Saved ${fmtCedi(amount)} — receipt ${res.receipt_number}`, 'success');
      refresh();
    } else {
      showToast(res.error || 'Save failed', 'error');
    }
  }

  async function printReceipt(row) {
    const lp = lastPaid[row.student_id];
    if (!lp?.paymentId) return showToast('No recent payment to print', 'info');
    const res = await window.api.receipts.generate({
      templateType: 'books',
      paymentId: lp.paymentId,
      paymentSource: 'books',
    });
    if (!res.ok) {
      showToast(res.error || 'Receipt generation failed', 'error');
      return;
    }
    const openRes = await window.api.app.openFile(res.output_path);
    if (openRes.ok) {
      showToast(`Receipt ${lp.receiptNo} opened in Word`, 'success');
    } else {
      showToast(`Receipt saved to ${res.output_path}`, 'info');
    }
  }

  const filteredRows = statusFilter
    ? rows.filter(r => r.status === statusFilter)
    : rows;
  const totals = filteredRows.reduce((acc, r) => ({
    billed: acc.billed + (r.books_total || 0),
    paid:   acc.paid   + (r.books_paid || 0),
    balance:acc.balance+ (r.books_balance || 0),
  }), { billed: 0, paid: 0, balance: 0 });

  return (
    <div className="books-tab">
      <div className="card no-print">
        <div className="section-header">
          <div>
            <div className="section-title">Books Management</div>
            <div className="text-sm text-muted">
              Books are billed once per academic year (Term 1). Unpaid balance carries forward to subsequent terms as separate arrears.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => window.print()}>🖨 Print</button>
            <button className="btn btn-primary" onClick={() => setSetupModal(true)} disabled={!classId || !yearId}>
              📚 Set Books for Class
            </button>
          </div>
        </div>
        <div className="form-row" style={{ marginTop: 14 }}>
          <div className="form-group">
            <label>Academic Year</label>
            <select value={yearId} onChange={e => setYearId(e.target.value)}>
              <option value="">— Select —</option>
              {academicYears.map(y => <option key={y.id} value={y.id ?? ''}>{y.label}</option>)}
            </select>
          </div>
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
              <option value="">All</option>
              <option value="paid_full">Paid in Full</option>
              <option value="paid_partial">Partial Payment</option>
              <option value="unpaid">Not Paid</option>
              <option value="not_billed">Not Billed</option>
            </select>
          </div>
        </div>
      </div>

      {classId && yearId && rows.length > 0 && (
        <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 16 }}>
          <div className="metric-card"><div className="metric-body">
            <div className="metric-label">Total Billed</div>
            <div className="metric-value">{fmtCedi(totals.billed)}</div>
          </div></div>
          <div className="metric-card"><div className="metric-body">
            <div className="metric-label">Total Collected</div>
            <div className="metric-value success">{fmtCedi(totals.paid)}</div>
          </div></div>
          <div className="metric-card"><div className="metric-body">
            <div className="metric-label">Outstanding</div>
            <div className="metric-value danger">{fmtCedi(totals.balance)}</div>
          </div></div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        {!classId || !yearId
          ? <div className="empty-state" style={{ padding: 40 }}>Select an academic year and class</div>
          : loading
            ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
            : filteredRows.length === 0
              ? <div className="empty-state" style={{ padding: 30 }}>No students match the filter</div>
              : <div className="sheet-wrap" style={{ maxHeight: 'calc(100vh - 500px)' }}>
                  <table className="sheet-table bulk-pay-table">
                    <thead>
                      <tr>
                        <th className="sheet-row-num-header">#</th>
                        <th style={{ minWidth: 100 }}>Index No.</th>
                        <th style={{ minWidth: 180 }}>Name</th>
                        <th className="text-right" style={{ minWidth: 110 }}>Books Cost</th>
                        <th className="text-right" style={{ minWidth: 110 }}>Paid</th>
                        <th className="text-right" style={{ minWidth: 110 }}>Balance</th>
                        <th style={{ minWidth: 100 }}>Status</th>
                        <th style={{ minWidth: 130 }} className="bulk-pay-amount-col">Pay Now</th>
                        <th style={{ minWidth: 100 }} className="no-print">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((row, i) => {
                        const inputVal = amountInputs[row.student_id] || '';
                        const hasInput = inputVal && parseFloat(inputVal) > 0;
                        return (
                          <tr key={row.student_id}>
                            <td className="sheet-row-num">{i + 1}</td>
                            <td className="sheet-cell" style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.index_number}</td>
                            <td className="sheet-cell"><strong>{row.surname}</strong>, {row.first_name}</td>
                            <td className="sheet-cell text-right">
                              {row.books_total > 0 ? fmtCedi(row.books_total).replace('GHS ', '') : '—'}
                            </td>
                            <td className="sheet-cell text-right" style={{ color: 'var(--success)' }}>
                              {fmtCedi(row.books_paid || 0).replace('GHS ', '')}
                            </td>
                            <td className="sheet-cell text-right" style={{
                              fontWeight: 700,
                              color: (row.books_balance || 0) > 0 ? 'var(--danger)' : 'var(--success)',
                            }}>
                              {fmtCedi(row.books_balance || 0).replace('GHS ', '')}
                            </td>
                            <td className="sheet-cell">
                              <span className={'badge ' + statusBadge(row.status)}>{statusLabel(row.status)}</span>
                            </td>
                            <td className="sheet-cell bulk-pay-amount-col">
                              <input
                                type="number" step="0.01" min="0"
                                value={inputVal}
                                onChange={e => setAmountInputs(prev => ({ ...prev, [row.student_id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter' && hasInput) save(row); }}
                                placeholder="0.00"
                                className="bulk-pay-amount-input"
                                disabled={row.status === 'not_billed'}
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
                                  {savingRowId === row.student_id ? '…' : '💾'}
                                </button>
                                <button
                                  className={'btn btn-sm ' + (lastPaid[row.student_id] ? 'btn-outline' : 'btn-ghost')}
                                  disabled={!lastPaid[row.student_id]}
                                  onClick={() => printReceipt(row)}
                                  title="Print receipt of last payment"
                                >
                                  🖨
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
        }
      </div>

      {setupModal && (
        <BooksSetupModal
          classId={classId}
          academicYearId={yearId}
          onClose={() => setSetupModal(false)}
          onSaved={() => { setSetupModal(false); refresh(); showToast('Books configured for class', 'success'); }}
        />
      )}
    </div>
  );
}

function statusBadge(s) {
  return {
    paid_full: 'badge-success', paid_partial: 'badge-warning',
    unpaid: 'badge-danger', not_billed: 'badge-muted',
  }[s] || 'badge-muted';
}
function statusLabel(s) {
  return { paid_full: 'Full', paid_partial: 'Partial', unpaid: 'None', not_billed: 'No Bill' }[s] || s;
}

function BooksSetupModal({ classId, academicYearId, onClose, onSaved }) {
  const showToast = useStore(s => s.showToast);
  const [items, setItems] = useState([{ title: '', amount: 0 }]);
  const [saving, setSaving] = useState(false);

  function addRow() { setItems([...items, { title: '', amount: 0 }]); }
  function removeRow(i) { setItems(items.filter((_, j) => j !== i)); }
  function updateRow(i, field, value) {
    setItems(items.map((r, j) => j === i ? { ...r, [field]: value } : r));
  }

  async function save() {
    const validItems = items.filter(i => i.title.trim() && parseFloat(i.amount) > 0);
    if (validItems.length === 0) return showToast('Add at least one book with a title and amount', 'warning');
    setSaving(true);
    const res = await window.api.books.generateForClass({
      classId, academicYearId,
      items: validItems,
    });
    setSaving(false);
    if (res.ok) {
      showToast(`Books set up for ${res.created} students`, 'success');
      onSaved();
    } else {
      showToast(res.error || 'Failed', 'error');
    }
  }

  const total = items.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Set Books for Class</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <p className="text-sm text-muted" style={{ marginBottom: 14 }}>
          Add each book/textbook for this class. Total: <strong>{fmtCedi(total)}</strong>.
          This will create a books bill for every active student in the class who doesn't already have one.
        </p>
        <div style={{ maxHeight: 320, overflow: 'auto' }}>
          {items.map((row, i) => (
            <div key={i} className="form-row" style={{ alignItems: 'flex-end', marginBottom: 8 }}>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label>{i === 0 ? 'Book Title' : ''}</label>
                <input type="text" value={row.title ?? ''} onChange={e => updateRow(i, 'title', e.target.value)}
                  placeholder="e.g. English Reader BS4" />
              </div>
              <div className="form-group">
                <label>{i === 0 ? 'Amount (GHS)' : ''}</label>
                <input type="number" step="0.01" min="0" value={row.amount ?? ''}
                  onChange={e => updateRow(i, 'amount', e.target.value)} placeholder="0.00" />
              </div>
              <div className="form-group" style={{ maxWidth: 70 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => removeRow(i)}
                  disabled={items.length === 1}>×</button>
              </div>
            </div>
          ))}
        </div>
        <button className="btn btn-outline btn-sm" onClick={addRow}>+ Add Book</button>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Creating…' : 'Create Books Bills'}
          </button>
        </div>
      </div>
    </div>
  );
}
