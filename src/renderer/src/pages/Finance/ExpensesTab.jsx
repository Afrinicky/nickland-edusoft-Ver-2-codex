// Nickland Edusoft — Expenses & Financial Reports Tab
// Accounting-grade: expense tracking, classification, ranking, financial reports
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate } from '../../lib/format.js';
import { ExpenseModal } from './Modals.jsx';

export default function ExpensesTab() {
  const { currentTerm } = useStore();
  const [view, setView] = useState('expenses');  // 'expenses' | 'reports'

  return (
    <div className="expenses-tab">
      <div className="sub-tabs">
        <button className={'sub-tab' + (view === 'expenses' ? ' active' : '')} onClick={() => setView('expenses')}>Expenses</button>
        <button className={'sub-tab' + (view === 'reports' ? ' active' : '')} onClick={() => setView('reports')}>Financial Reports</button>
      </div>
      <div style={{ marginTop: 16 }}>
        {view === 'expenses' && <ExpenseLedger />}
        {view === 'reports'  && <FinancialReports />}
      </div>
    </div>
  );
}

// ── Expense Ledger ─────────────────────────────────────
function ExpenseLedger() {
  const { currentTerm } = useStore();
  const [expenses, setExpenses] = useState([]);
  const [filter, setFilter] = useState({ category: '', fromDate: '', toDate: '' });
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  async function refresh() {
    setLoading(true);
    const list = await window.api.finance.listExpense({
      termId: currentTerm?.id,
      category: filter.category || undefined,
      fromDate: filter.fromDate || undefined,
      toDate: filter.toDate || undefined,
    });
    setExpenses(list);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [currentTerm?.id, filter]);

  const total = expenses.reduce((s, r) => s + (r.amount || 0), 0);

  // Rank by category
  const byCategory = {};
  for (const r of expenses) byCategory[r.category] = (byCategory[r.category] || 0) + r.amount;
  const ranked = Object.entries(byCategory)
    .map(([cat, amt]) => ({ cat, amt }))
    .sort((a, b) => b.amt - a.amt);

  return (
    <>
      {/* Summary */}
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="metric-card">
          <div className="metric-icon red"><IconMinus /></div>
          <div className="metric-body">
            <div className="metric-label">Total Expenses</div>
            <div className="metric-value danger">{fmtCedi(total)}</div>
            <div className="metric-sub">{expenses.length} transactions</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon orange"><IconRank /></div>
          <div className="metric-body">
            <div className="metric-label">Top Category</div>
            <div className="metric-value" style={{ fontSize: 16 }}>{ranked[0]?.cat ? labelize(ranked[0].cat) : '—'}</div>
            <div className="metric-sub">{ranked[0] ? fmtCedi(ranked[0].amt) : 'No data'}</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon purple"><IconChart /></div>
          <div className="metric-body">
            <div className="metric-label">Categories Used</div>
            <div className="metric-value">{ranked.length}</div>
            <div className="metric-sub">Distinct expense types</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="section-header">
          <div className="section-title">Expense Transactions</div>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Record Expense</button>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Category</label>
            <select value={filter.category ?? ''} onChange={e => setFilter({ ...filter, category: e.target.value })}>
              <option value="">All Categories</option>
              <option value="salary">Salary</option>
              <option value="utilities">Utilities</option>
              <option value="rent">Rent</option>
              <option value="supplies">Supplies</option>
              <option value="canteen_supplies">Canteen Supplies</option>
              <option value="maintenance">Maintenance</option>
              <option value="transport">Transport</option>
              <option value="operations">Operations</option>
              <option value="welfare">Welfare</option>
              <option value="taxes_levies">Taxes / Levies</option>
              <option value="ssnit_remittance">SSNIT Remittance</option>
              <option value="paye_remittance">PAYE Remittance</option>
              <option value="construction">Construction</option>
              <option value="training">Training</option>
              <option value="marketing">Marketing</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="form-group">
            <label>From Date</label>
            <input type="date" value={filter.fromDate ?? ''} onChange={e => setFilter({ ...filter, fromDate: e.target.value })} />
          </div>
          <div className="form-group">
            <label>To Date</label>
            <input type="date" value={filter.toDate ?? ''} onChange={e => setFilter({ ...filter, toDate: e.target.value })} />
          </div>
        </div>
      </div>

      {/* Category ranking */}
      {ranked.length > 0 && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="section-header">
            <div className="section-title">Expenses Ranked by Category</div>
          </div>
          <div className="class-bar-list">
            {ranked.map((r, i) => {
              const max = ranked[0].amt;
              const pct = total > 0 ? Math.round((r.amt / total) * 100) : 0;
              return (
                <div key={r.cat} className="class-bar-row">
                  <div className="class-bar-label">
                    <span className="text-muted text-xs" style={{ marginRight: 8 }}>#{i + 1}</span>
                    {labelize(r.cat)}
                  </div>
                  <div className="class-bar-track">
                    <div className="class-bar-fill" style={{
                      width: `${(r.amt / max) * 100}%`,
                      background: 'linear-gradient(90deg, #B91C1C, #EF4444)'
                    }} />
                  </div>
                  <div className="class-bar-count" style={{ minWidth: 140, textAlign: 'right' }}>
                    {fmtCedi(r.amt)} <span className="text-xs text-muted">({pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Expenses table */}
      <div className="card" style={{ marginTop: 18 }}>
        {loading
          ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
          : expenses.length === 0
            ? <div className="empty-state">No expense transactions match the filters</div>
            : <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Txn #</th>
                      <th>Date</th>
                      <th>Category</th>
                      <th>Payee</th>
                      <th>Description</th>
                      <th>Method</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map(r => (
                      <tr key={r.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: 11 }} className="td-muted">
                          {r.transaction_number || '—'}
                        </td>
                        <td>{fmtDate(r.transaction_date || r.date)}</td>
                        <td><span className="badge badge-danger">{labelize(r.category)}</span></td>
                        <td>{r.payee_name || r.paid_to || '—'}</td>
                        <td className="text-sm">{r.description}</td>
                        <td className="text-sm text-muted">{r.payment_method}</td>
                        <td className="text-right td-danger font-bold">{fmtCedi(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--surface-2)', fontWeight: 700 }}>
                      <td colSpan="6">TOTAL ({expenses.length} records)</td>
                      <td className="text-right">{fmtCedi(total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
        }
      </div>

      {showAdd && <ExpenseModal onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); refresh(); }} />}
    </>
  );
}

// ── Financial Reports ─────────────────────────────────
function FinancialReports() {
  const { currentTerm, settings } = useStore();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const school = settings.school || {};

  async function refresh() {
    if (!currentTerm) { setLoading(false); return; }
    setLoading(true);
    const sum = await window.api.finance.summary(currentTerm.id);
    setSummary(sum);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [currentTerm?.id]);

  if (loading || !summary) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;
  }

  return (
    <div className="financial-reports">
      <div className="card no-print">
        <div className="section-header">
          <div>
            <div className="section-title">Income & Expense Statement</div>
            <div className="text-sm text-muted">Term: {currentTerm?.label}</div>
          </div>
          <button className="btn btn-primary" onClick={() => window.print()}>🖨 Print Statement</button>
        </div>
      </div>

      <div className="card schedule-document" style={{ marginTop: 16, padding: 24 }}>
        <div className="schedule-header">
          <div className="schedule-header-title">{(school.school_name || 'SCHOOL').toUpperCase()}</div>
          <div className="schedule-header-sub">Income & Expenditure Statement — {currentTerm?.label}</div>
        </div>

        <div className="reports-section">
          <h3 className="reports-section-title" style={{ color: 'var(--success)' }}>INCOME</h3>
          <table className="reports-table">
            <tbody>
              {summary.income_by_category.map(c => (
                <tr key={c.category}>
                  <td>{labelize(c.category)}</td>
                  <td className="text-right">{fmtCedi(c.total)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--success)', fontWeight: 700 }}>
                <td>TOTAL INCOME</td>
                <td className="text-right">{fmtCedi(summary.income_total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="reports-section">
          <h3 className="reports-section-title" style={{ color: 'var(--danger)' }}>EXPENDITURE</h3>
          <table className="reports-table">
            <tbody>
              {summary.expense_by_category.map(c => (
                <tr key={c.category}>
                  <td>{labelize(c.category)}</td>
                  <td className="text-right">{fmtCedi(c.total)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--danger)', fontWeight: 700 }}>
                <td>TOTAL EXPENDITURE</td>
                <td className="text-right">{fmtCedi(summary.expense_total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="reports-net-box">
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>
            NET POSITION (Income − Expenditure)
          </div>
          <div style={{
            fontSize: 28,
            fontWeight: 700,
            color: summary.net >= 0 ? 'var(--success)' : 'var(--danger)',
            marginTop: 6
          }}>
            {fmtCedi(summary.net)}
          </div>
          <div className="text-xs text-muted" style={{ marginTop: 4 }}>
            {summary.net >= 0 ? 'Surplus' : 'Deficit'}
          </div>
        </div>

        <div className="schedule-footer" style={{ marginTop: 40 }}>
          <div className="signature-block">
            <div className="signature-line"></div>
            <div className="text-xs text-muted">Prepared by</div>
          </div>
          <div className="signature-block">
            <div className="signature-line"></div>
            <div className="text-xs text-muted">Verified by</div>
          </div>
          <div className="signature-block">
            <div className="signature-line"></div>
            <div className="text-xs text-muted">Approved by</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function labelize(s) {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function IconMinus()   { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>; }
function IconChart()   { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 18l5-5 4 4 9-9" stroke="currentColor" strokeWidth="2" fill="none"/></svg>; }
function IconRank()    { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 20V8M10 20V4M16 20v-9M22 20h-22" stroke="currentColor" strokeWidth="2"/></svg>; }
