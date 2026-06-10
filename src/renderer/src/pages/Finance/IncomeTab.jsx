// Nickland Edusoft — Income Tab (receipts, classification, expected income calculator)
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate } from '../../lib/format.js';
import { IncomeModal } from './Modals.jsx';

export default function IncomeTab() {
  const { currentTerm } = useStore();
  const showToast = useStore(s => s.showToast);
  const [income, setIncome] = useState([]);
  const [expected, setExpected] = useState(null);
  const [filter, setFilter] = useState({ category: '', fromDate: '', toDate: '' });
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  async function refresh() {
    setLoading(true);
    const [inc, exp] = await Promise.all([
      window.api.finance.listIncome({
        termId: currentTerm?.id,
        category: filter.category || undefined,
        fromDate: filter.fromDate || undefined,
        toDate: filter.toDate || undefined,
      }),
      window.api.finance.expectedIncome(currentTerm?.id),
    ]);
    setIncome(inc);
    setExpected(exp);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [currentTerm?.id, filter]);

  const totalCollected = income.reduce((s, r) => s + (r.amount || 0), 0);
  const byCategory = {};
  for (const r of income) {
    byCategory[r.category] = (byCategory[r.category] || 0) + r.amount;
  }
  const sortedCategories = Object.entries(byCategory)
    .map(([cat, total]) => ({ cat, total }))
    .sort((a, b) => b.total - a.total);

  return (
    <div className="income-tab">
      {/* Summary cards */}
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="metric-card">
          <div className="metric-icon green"><IconCash /></div>
          <div className="metric-body">
            <div className="metric-label">Collected</div>
            <div className="metric-value success">{fmtCedi(totalCollected)}</div>
            <div className="metric-sub">{income.length} transactions</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon blue"><IconTarget /></div>
          <div className="metric-body">
            <div className="metric-label">Expected (Bills)</div>
            <div className="metric-value">{fmtCedi(expected?.total || 0)}</div>
            <div className="metric-sub">From fee templates × active students</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon orange"><IconGap /></div>
          <div className="metric-body">
            <div className="metric-label">Performance</div>
            <div className="metric-value">
              {expected?.total ? Math.round((totalCollected / expected.total) * 100) : 0}%
            </div>
            <div className="metric-sub">Of expected income realized</div>
          </div>
        </div>
      </div>

      {/* Expected Income Calculator */}
      {expected && expected.breakdown.length > 0 && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Expected Income Calculator</div>
              <div className="text-sm text-muted">
                Calculated as: <strong>fee template amount × active students per class</strong>
              </div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => window.print()}>🖨 Print</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  <th className="text-right">Active Students</th>
                  <th className="text-right">Fee per Student</th>
                  <th className="text-right">Expected Income</th>
                </tr>
              </thead>
              <tbody>
                {expected.breakdown.map(b => (
                  <tr key={b.class_id}>
                    <td><strong>{b.class_name}</strong></td>
                    <td className="text-right">{b.active_students}</td>
                    <td className="text-right">{fmtCedi(b.template_amount)}</td>
                    <td className="text-right"><strong>{fmtCedi(b.expected)}</strong></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--surface-2)', fontWeight: 700 }}>
                  <td colSpan="3">TOTAL EXPECTED</td>
                  <td className="text-right">{fmtCedi(expected.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Filter / Add */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="section-header">
          <div className="section-title">Income Transactions</div>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Record Income</button>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Category</label>
            <select value={filter.category ?? ''} onChange={e => setFilter({ ...filter, category: e.target.value })}>
              <option value="">All Categories</option>
              <option value="fees">School Fees</option>
              <option value="canteen">Canteen</option>
              <option value="admission">Admission</option>
              <option value="donation">Donation</option>
              <option value="grant">Grant</option>
              <option value="sales">Sales</option>
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

      {/* Category breakdown */}
      {sortedCategories.length > 0 && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="section-header">
            <div className="section-title">Income Classification</div>
            <span className="text-sm text-muted">Filtered period</span>
          </div>
          <div className="class-bar-list">
            {sortedCategories.map(c => {
              const max = sortedCategories[0].total;
              const pct = totalCollected > 0 ? Math.round((c.total / totalCollected) * 100) : 0;
              return (
                <div key={c.cat} className="class-bar-row">
                  <div className="class-bar-label">{labelize(c.cat)}</div>
                  <div className="class-bar-track">
                    <div className="class-bar-fill" style={{
                      width: `${(c.total / max) * 100}%`,
                      background: 'linear-gradient(90deg, #15803D, #22C55E)'
                    }} />
                  </div>
                  <div className="class-bar-count" style={{ minWidth: 140, textAlign: 'right' }}>
                    {fmtCedi(c.total)} <span className="text-xs text-muted">({pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Transactions table */}
      <div className="card" style={{ marginTop: 18 }}>
        {loading
          ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
          : income.length === 0
            ? <div className="empty-state">No income transactions match the filters</div>
            : <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Receipt</th>
                      <th>Date</th>
                      <th>Category</th>
                      <th>Payer</th>
                      <th>Description</th>
                      <th>Method</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {income.map(r => (
                      <tr key={r.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: 11 }} className="td-muted">
                          {r.receipt_number || '—'}
                        </td>
                        <td>{fmtDate(r.transaction_date || r.date)}</td>
                        <td><span className="badge badge-success">{labelize(r.category)}</span></td>
                        <td>{r.payer_name || '—'}</td>
                        <td className="text-sm">{r.description || '—'}</td>
                        <td className="text-sm text-muted">{r.payment_method}</td>
                        <td className="text-right td-success font-bold">{fmtCedi(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--surface-2)', fontWeight: 700 }}>
                      <td colSpan="6">TOTAL ({income.length} records)</td>
                      <td className="text-right">{fmtCedi(totalCollected)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
        }
      </div>

      {showAdd && <IncomeModal onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); refresh(); }} />}
    </div>
  );
}

function labelize(s) {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function IconCash()   { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="2" y="6" width="20" height="12" rx="2" fill="currentColor"/><circle cx="12" cy="12" r="3" stroke="#fff" strokeWidth="2"/></svg>; }
function IconTarget() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none"/><circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>; }
function IconGap()    { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none"/><path d="M12 7v10M8 12h8" stroke="currentColor" strokeWidth="2"/></svg>; }
