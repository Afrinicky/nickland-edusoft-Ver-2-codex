// Nickland Edusoft — Finance Dashboard
// 4 quick-action buttons + summary metrics
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate } from '../../lib/format.js';
import { IncomeModal, ExpenseModal } from './Modals.jsx';

export default function FinanceDashboard({ onSwitchTab }) {
  const { currentTerm } = useStore();
  const [summary, setSummary] = useState(null);
  const [expected, setExpected] = useState(null);
  const [recentIncome, setRecentIncome] = useState([]);
  const [recentExpense, setRecentExpense] = useState([]);
  const [staffCount, setStaffCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showIncome, setShowIncome] = useState(false);
  const [showExpense, setShowExpense] = useState(false);

  async function refresh() {
    if (!currentTerm) { setLoading(false); return; }
    setLoading(true);
    const [sum, exp, inc, expense, staff] = await Promise.all([
      window.api.finance.summary(currentTerm.id),
      window.api.finance.expectedIncome(currentTerm.id),
      window.api.finance.listIncome({ termId: currentTerm.id, limit: 5 }),
      window.api.finance.listExpense({ termId: currentTerm.id, limit: 5 }),
      window.api.staff.list({ status: 'Active' }),
    ]);
    setSummary(sum);
    setExpected(exp);
    setRecentIncome(inc);
    setRecentExpense(expense);
    setStaffCount(staff.length);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, [currentTerm?.id]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;
  }

  return (
    <div className="finance-dashboard">
      {/* 4 Quick action buttons */}
      <div className="finance-quick-actions">
        <button className="finance-action-card finance-action-income" onClick={() => setShowIncome(true)}>
          <div className="finance-action-icon"><IconPlus /></div>
          <div className="finance-action-text">
            <div className="finance-action-title">Record Income</div>
            <div className="finance-action-sub">Add a new income transaction</div>
          </div>
        </button>
        <button className="finance-action-card finance-action-expense" onClick={() => setShowExpense(true)}>
          <div className="finance-action-icon"><IconMinus /></div>
          <div className="finance-action-text">
            <div className="finance-action-title">Record Expense</div>
            <div className="finance-action-sub">Log a new outgoing payment</div>
          </div>
        </button>
        <button className="finance-action-card finance-action-reports" onClick={() => onSwitchTab('expenses')}>
          <div className="finance-action-icon"><IconChart /></div>
          <div className="finance-action-text">
            <div className="finance-action-title">Financial Reports</div>
            <div className="finance-action-sub">View and print analyses</div>
          </div>
        </button>
        <button className="finance-action-card finance-action-budget" onClick={() => onSwitchTab('budgets')}>
          <div className="finance-action-icon"><IconTarget /></div>
          <div className="finance-action-text">
            <div className="finance-action-title">Budgets</div>
            <div className="finance-action-sub">Plan and track financials</div>
          </div>
        </button>
      </div>

      {/* General metrics */}
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginTop: 18 }}>
        <div className="metric-card">
          <div className="metric-icon blue"><IconTarget /></div>
          <div className="metric-body">
            <div className="metric-label">Expected Income</div>
            <div className="metric-value">{fmtCedi(expected?.total || 0)}</div>
            <div className="metric-sub">If all fees collected</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon green"><IconCash /></div>
          <div className="metric-body">
            <div className="metric-label">Actual Income</div>
            <div className="metric-value success">{fmtCedi(summary?.income_total || 0)}</div>
            <div className="metric-sub">This term</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon red"><IconMinus /></div>
          <div className="metric-body">
            <div className="metric-label">Total Expenses</div>
            <div className="metric-value danger">{fmtCedi(summary?.expense_total || 0)}</div>
            <div className="metric-sub">This term</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon purple"><IconBalance /></div>
          <div className="metric-body">
            <div className="metric-label">Net Position</div>
            <div className="metric-value" style={{ color: (summary?.net || 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {fmtCedi(summary?.net || 0)}
            </div>
            <div className="metric-sub">Income − Expenses</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon orange"><IconStaff /></div>
          <div className="metric-body">
            <div className="metric-label">Active Staff</div>
            <div className="metric-value">{staffCount}</div>
            <div className="metric-sub">Payroll-eligible</div>
          </div>
        </div>
      </div>

      {/* Income vs Expense breakdown */}
      <div className="dash-row" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 18 }}>
        <div className="card">
          <div className="section-header">
            <div className="section-title">Income by Category</div>
            <span className="section-view-all" onClick={() => onSwitchTab('income')}>View all →</span>
          </div>
          {(!summary?.income_by_category || summary.income_by_category.length === 0)
            ? <div className="empty-state">No income recorded</div>
            : <CategoryBars data={summary.income_by_category} color="#15803D" total={summary.income_total} />
          }
        </div>
        <div className="card">
          <div className="section-header">
            <div className="section-title">Expenses by Category</div>
            <span className="section-view-all" onClick={() => onSwitchTab('expenses')}>View all →</span>
          </div>
          {(!summary?.expense_by_category || summary.expense_by_category.length === 0)
            ? <div className="empty-state">No expenses recorded</div>
            : <CategoryBars data={summary.expense_by_category} color="#B91C1C" total={summary.expense_total} />
          }
        </div>
      </div>

      {/* Recent income / expense */}
      <div className="dash-row" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 18 }}>
        <div className="card">
          <div className="section-header">
            <div className="section-title">Recent Income</div>
            <button className="btn btn-outline btn-sm" onClick={() => setShowIncome(true)}>+ Add</button>
          </div>
          {recentIncome.length === 0
            ? <div className="empty-state">No income transactions yet</div>
            : <TxnList rows={recentIncome} dateField="transaction_date" />
          }
        </div>
        <div className="card">
          <div className="section-header">
            <div className="section-title">Recent Expenses</div>
            <button className="btn btn-outline btn-sm" onClick={() => setShowExpense(true)}>+ Add</button>
          </div>
          {recentExpense.length === 0
            ? <div className="empty-state">No expenses recorded yet</div>
            : <TxnList rows={recentExpense} dateField="transaction_date" expense />
          }
        </div>
      </div>

      {showIncome && <IncomeModal onClose={() => setShowIncome(false)} onDone={() => { setShowIncome(false); refresh(); }} />}
      {showExpense && <ExpenseModal onClose={() => setShowExpense(false)} onDone={() => { setShowExpense(false); refresh(); }} />}
    </div>
  );
}

function CategoryBars({ data, color, total }) {
  const max = Math.max(...data.map(d => d.total));
  return (
    <div className="class-bar-list">
      {data.map(d => (
        <div key={d.category} className="class-bar-row">
          <div className="class-bar-label">{labelize(d.category)}</div>
          <div className="class-bar-track">
            <div className="class-bar-fill" style={{ width: `${(d.total / max) * 100}%`, background: color }} />
          </div>
          <div className="class-bar-count" style={{ minWidth: 100, textAlign: 'right' }}>
            {fmtCedi(d.total)}
          </div>
        </div>
      ))}
      <div className="text-xs text-muted text-right" style={{ marginTop: 8 }}>
        Total: <strong>{fmtCedi(total)}</strong>
      </div>
    </div>
  );
}

function TxnList({ rows, dateField, expense }) {
  return (
    <div className="payments-list">
      {rows.map(r => (
        <div key={r.id} className="payment-row">
          <div className="payment-row-left">
            <div className="payment-row-meta">{r.receipt_number || r.transaction_number || ''}</div>
            <div className="payment-row-name">
              {expense ? r.payee_name : r.payer_name || labelize(r.category)}
            </div>
            <div className="payment-row-type">{r.description || labelize(r.category)}</div>
          </div>
          <div className="payment-row-right">
            <div className="payment-row-amount"
              style={{ color: expense ? 'var(--danger)' : 'var(--success)' }}>
              {expense ? '−' : '+'}{fmtCedi(r.amount)}
            </div>
            <div className="payment-row-date">
              {fmtDate(r[dateField] || r.date || r.created_at)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function labelize(s) {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function IconPlus()    { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>; }
function IconMinus()   { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>; }
function IconChart()   { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 18l5-5 4 4 9-9" stroke="currentColor" strokeWidth="2" fill="none"/></svg>; }
function IconTarget()  { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none"/><circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>; }
function IconCash()    { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="2" y="6" width="20" height="12" rx="2" fill="currentColor"/><circle cx="12" cy="12" r="3" stroke="#fff" strokeWidth="2"/></svg>; }
function IconBalance() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3v18M3 8l9-3 9 3M5 18h6l-3-6-3 6zM13 18h6l-3-6-3 6z" stroke="currentColor" strokeWidth="2" fill="none"/></svg>; }
function IconStaff()   { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" fill="none"/></svg>; }
