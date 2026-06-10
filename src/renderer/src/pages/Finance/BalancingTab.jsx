// Nickland Edusoft — Balancing Sheet (Cashbook)
// WHONET-style spreadsheet view of merged income + expense ledger
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate } from '../../lib/format.js';
import { IncomeModal, ExpenseModal } from './Modals.jsx';

export default function BalancingTab({ onSwitchTab }) {
  const { currentTerm } = useStore();
  const showToast = useStore(s => s.showToast);
  const { currentUser } = useStore();
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState({ fromDate: '', toDate: '', search: '' });
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [addingAt, setAddingAt] = useState(null);      // { afterRowIndex, type: 'income'|'expense' }
  const [addingChoice, setAddingChoice] = useState(null); // intermediate "income or expense?"
  const [showIncome, setShowIncome] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [justification, setJustification] = useState(null); // { action, row, callback }

  async function refresh() {
    setLoading(true);
    const [inc, exp] = await Promise.all([
      window.api.finance.listIncome({
        termId: currentTerm?.id,
        fromDate: filter.fromDate || undefined,
        toDate: filter.toDate || undefined,
      }),
      window.api.finance.listExpense({
        termId: currentTerm?.id,
        fromDate: filter.fromDate || undefined,
        toDate: filter.toDate || undefined,
      }),
    ]);
    // Merge and sort by date
    const merged = [
      ...inc.map(r => ({ ...r, _type: 'income', _date: r.transaction_date || r.date })),
      ...exp.map(r => ({ ...r, _type: 'expense', _date: r.transaction_date || r.date })),
    ];
    merged.sort((a, b) => {
      const d = (a._date || '').localeCompare(b._date || '');
      return d !== 0 ? d : (a.id - b.id);
    });

    // Search filter
    const filtered = filter.search
      ? merged.filter(r => {
          const q = filter.search.toLowerCase();
          return (r.description || '').toLowerCase().includes(q)
              || (r.payer_name || r.payee_name || '').toLowerCase().includes(q)
              || (r.category || '').toLowerCase().includes(q)
              || (r.receipt_number || r.transaction_number || '').toLowerCase().includes(q);
        })
      : merged;

    setRows(filtered);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, [currentTerm?.id, filter]);

  // Running balance
  let runningBalance = 0;
  const rowsWithBalance = rows.map(r => {
    if (r._type === 'income') runningBalance += r.amount;
    else runningBalance -= r.amount;
    return { ...r, _balance: runningBalance };
  });

  const totalIncome = rows.filter(r => r._type === 'income').reduce((s, r) => s + r.amount, 0);
  const totalExpense = rows.filter(r => r._type === 'expense').reduce((s, r) => s + r.amount, 0);
  const netBalance = totalIncome - totalExpense;

  function handleAddRow(afterIdx) {
    setAddingChoice({ afterRowIndex: afterIdx });
  }

  function chooseType(type) {
    setAddingChoice(null);
    if (type === 'income') setShowIncome(true);
    else setShowExpense(true);
  }

  async function handleDelete(row) {
    setJustification({
      title: `Delete ${row._type} transaction?`,
      description: `You are about to delete a ${row._type} of ${fmtCedi(row.amount)} dated ${fmtDate(row._date)}. This action will be permanently logged in the audit trail and cannot be undone.`,
      placeholder: 'Why is this transaction being deleted? (e.g., duplicate entry, recorded in error, reversed by bank)',
      onConfirm: async (reason) => {
        try {
          const userId = useStore.getState().currentUser?.id;
          const res = row._type === 'income'
            ? await window.api.finance.deleteIncome({ id: row.id, justification: reason, userId })
            : await window.api.finance.deleteExpense({ id: row.id, justification: reason, userId });
          if (res.ok) {
            showToast(`${row._type === 'income' ? 'Income' : 'Expense'} deleted. Audit log updated.`, 'success');
            setJustification(null);
            refresh();
          } else {
            showToast(res.error || 'Delete failed', 'error');
          }
        } catch (e) {
          showToast(e.message, 'error');
        }
      },
    });
  }

  return (
    <div className="balancing-tab">
      {/* Header */}
      <div className="card">
        <div className="section-header">
          <div>
            <div className="section-title">Balancing Sheet (Cashbook)</div>
            <div className="text-sm text-muted">
              Combined ledger of all income and expenses with running balance
            </div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => window.print()}>🖨 Print Cashbook</button>
        </div>
        <div className="form-row" style={{ marginTop: 14 }}>
          <div className="form-group">
            <label>From Date</label>
            <input type="date" value={filter.fromDate ?? ''}
              onChange={e => setFilter({ ...filter, fromDate: e.target.value })} />
          </div>
          <div className="form-group">
            <label>To Date</label>
            <input type="date" value={filter.toDate ?? ''}
              onChange={e => setFilter({ ...filter, toDate: e.target.value })} />
          </div>
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label>Search</label>
            <input type="text" value={filter.search ?? ''}
              onChange={e => setFilter({ ...filter, search: e.target.value })}
              placeholder="Description, payer, category, receipt #…" />
          </div>
        </div>
      </div>

      {/* Summary band */}
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 16 }}>
        <div className="metric-card">
          <div className="metric-body">
            <div className="metric-label">Total Income</div>
            <div className="metric-value success">{fmtCedi(totalIncome)}</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-body">
            <div className="metric-label">Total Expenses</div>
            <div className="metric-value danger">{fmtCedi(totalExpense)}</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-body">
            <div className="metric-label">Net Balance</div>
            <div className="metric-value" style={{ color: netBalance >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {fmtCedi(netBalance)}
            </div>
          </div>
        </div>
      </div>

      {/* The sheet */}
      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        {loading
          ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
          : <div className="sheet-wrap" style={{ maxHeight: 'calc(100vh - 480px)' }}>
              <table className="sheet-table balancing-table">
                <thead>
                  <tr>
                    <th className="sheet-row-num-header">#</th>
                    <th style={{ minWidth: 100 }}>Date</th>
                    <th style={{ minWidth: 110 }}>Receipt/Txn #</th>
                    <th style={{ minWidth: 120 }}>Type</th>
                    <th style={{ minWidth: 130 }}>Category</th>
                    <th style={{ minWidth: 200 }}>Description</th>
                    <th style={{ minWidth: 130 }}>Party</th>
                    <th style={{ minWidth: 110 }} className="text-right">Income (GHS)</th>
                    <th style={{ minWidth: 110 }} className="text-right">Expense (GHS)</th>
                    <th style={{ minWidth: 110 }} className="text-right">Running Balance</th>
                    <th style={{ minWidth: 140 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsWithBalance.length === 0
                    ? <tr>
                        <td colSpan="11" className="sheet-empty">
                          No transactions yet. Click the + button below to add one.
                        </td>
                      </tr>
                    : rowsWithBalance.map((r, i) => (
                      <tr key={`${r._type}-${r.id}`} className={'balancing-row balancing-' + r._type}>
                        <td className="sheet-row-num">{i + 1}</td>
                        <td className="sheet-cell">{fmtDate(r._date)}</td>
                        <td className="sheet-cell" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                          {r.receipt_number || r.transaction_number || '—'}
                        </td>
                        <td className="sheet-cell">
                          <span className={'badge badge-' + (r._type === 'income' ? 'success' : 'danger')}>
                            {r._type}
                          </span>
                        </td>
                        <td className="sheet-cell">{labelize(r.category)}</td>
                        <td className="sheet-cell text-sm">{r.description || '—'}</td>
                        <td className="sheet-cell text-sm">
                          {r._type === 'income' ? r.payer_name : r.payee_name || '—'}
                        </td>
                        <td className="sheet-cell text-right" style={{ color: 'var(--success)', fontWeight: r._type === 'income' ? 600 : 400 }}>
                          {r._type === 'income' ? fmtCedi(r.amount).replace('GHS ', '') : '—'}
                        </td>
                        <td className="sheet-cell text-right" style={{ color: 'var(--danger)', fontWeight: r._type === 'expense' ? 600 : 400 }}>
                          {r._type === 'expense' ? fmtCedi(r.amount).replace('GHS ', '') : '—'}
                        </td>
                        <td className="sheet-cell text-right" style={{
                          fontWeight: 700,
                          color: r._balance >= 0 ? 'var(--success)' : 'var(--danger)',
                          fontFamily: 'monospace',
                        }}>
                          {fmtCedi(r._balance).replace('GHS ', '')}
                        </td>
                        <td className="sheet-cell">
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap' }}>
                            <button className="btn btn-ghost btn-sm" title="Preview"
                              onClick={() => setPreview(r)}>👁</button>
                            <button className="btn btn-ghost btn-sm" title="Add row here"
                              onClick={() => handleAddRow(i)}>＋</button>
                            <button className="btn btn-ghost btn-sm" title="Delete"
                              onClick={() => handleDelete(r)}>×</button>
                          </div>
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--primary-50)', fontWeight: 700, position: 'sticky', bottom: 0 }}>
                    <td colSpan="7">TOTALS</td>
                    <td className="text-right" style={{ color: 'var(--success)' }}>{fmtCedi(totalIncome).replace('GHS ', '')}</td>
                    <td className="text-right" style={{ color: 'var(--danger)' }}>{fmtCedi(totalExpense).replace('GHS ', '')}</td>
                    <td className="text-right" style={{ color: netBalance >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {fmtCedi(netBalance).replace('GHS ', '')}
                    </td>
                    <td>
                      <button className="btn btn-primary btn-sm" onClick={() => handleAddRow(rows.length)}>＋ Add Row</button>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
        }
      </div>

      {/* Help text */}
      <div className="sheet-help" style={{ marginTop: 12 }}>
        <strong>How to use:</strong> Click <strong>👁</strong> to preview a transaction · Click <strong>＋</strong> next to a row to add a new transaction at that position · Click <strong>×</strong> to delete (requires justification) · Running balance shows cumulative cash position after each transaction.
      </div>

      {/* Modals */}
      {preview && (
        <PreviewModal row={preview} onClose={() => setPreview(null)} onSwitchTab={onSwitchTab} />
      )}

      {addingChoice && (
        <div className="modal-backdrop" onClick={() => setAddingChoice(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">What type of transaction?</div>
              <button className="modal-close" onClick={() => setAddingChoice(null)}>×</button>
            </div>
            <p className="text-sm text-muted" style={{ marginBottom: 16 }}>
              You'll be taken to the relevant tab to enter the details. After saving,
              you can return here.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <button className="finance-action-card finance-action-income"
                onClick={() => chooseType('income')}>
                <div className="finance-action-icon">＋</div>
                <div className="finance-action-text">
                  <div className="finance-action-title">Income</div>
                  <div className="finance-action-sub">Fees, donations, etc.</div>
                </div>
              </button>
              <button className="finance-action-card finance-action-expense"
                onClick={() => chooseType('expense')}>
                <div className="finance-action-icon">−</div>
                <div className="finance-action-text">
                  <div className="finance-action-title">Expense</div>
                  <div className="finance-action-sub">Salary, supplies, etc.</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {showIncome && <IncomeModal onClose={() => setShowIncome(false)}
        onDone={() => { setShowIncome(false); refresh(); }} />}
      {showExpense && <ExpenseModal onClose={() => setShowExpense(false)}
        onDone={() => { setShowExpense(false); refresh(); }} />}

      {justification && (
        <JustificationModal
          title={justification.title}
          description={justification.description}
          placeholder={justification.placeholder}
          onClose={() => setJustification(null)}
          onConfirm={justification.onConfirm}
        />
      )}
    </div>
  );
}

function PreviewModal({ row, onClose, onSwitchTab }) {
  const isIncome = row._type === 'income';
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            {isIncome ? 'Income' : 'Expense'} Transaction
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <table className="reports-table" style={{ width: '100%' }}>
          <tbody>
            <tr><td>Receipt / Txn #</td><td><strong>{row.receipt_number || row.transaction_number || '—'}</strong></td></tr>
            <tr><td>Date</td><td>{fmtDate(row._date)}</td></tr>
            <tr><td>Type</td><td><span className={'badge badge-' + (isIncome ? 'success' : 'danger')}>{row._type}</span></td></tr>
            <tr><td>Category</td><td>{labelize(row.category)}</td></tr>
            {row.subcategory && <tr><td>Subcategory</td><td>{row.subcategory}</td></tr>}
            <tr><td>Description</td><td>{row.description || '—'}</td></tr>
            <tr><td>{isIncome ? 'Payer' : 'Payee'}</td><td>{isIncome ? row.payer_name : row.payee_name || '—'}</td></tr>
            <tr><td>Payment Method</td><td>{row.payment_method}</td></tr>
            <tr><td>Reference</td><td>{row.reference || '—'}</td></tr>
            <tr style={{ borderTop: '2px solid', fontWeight: 700 }}>
              <td>Amount</td>
              <td style={{ color: isIncome ? 'var(--success)' : 'var(--danger)', fontSize: 16 }}>
                {fmtCedi(row.amount)}
              </td>
            </tr>
          </tbody>
        </table>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>← Back to Balancing</button>
          <button className="btn btn-outline" onClick={() => { onClose(); onSwitchTab(isIncome ? 'income' : 'expenses'); }}>
            Open in {isIncome ? 'Income' : 'Expenses'} tab →
          </button>
        </div>
      </div>
    </div>
  );
}

function JustificationModal({ title, description, placeholder, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title" style={{ color: 'var(--warning)' }}>⚠ {title}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <p className="text-sm" style={{ marginBottom: 12, lineHeight: 1.5 }}>{description}</p>
        <div className="form-group">
          <label>Justification <span className="text-danger">*</span></label>
          <textarea rows="4" value={reason} onChange={e => setReason(e.target.value)}
            placeholder={placeholder} autoFocus />
          <div className="form-hint">Minimum 15 characters · This will be saved in the audit log.</div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" onClick={() => onConfirm(reason)}
            disabled={reason.trim().length < 15}>
            Confirm & Save Reason
          </button>
        </div>
      </div>
    </div>
  );
}

function labelize(s) {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
