// Nickland Edusoft — Fees Management Dashboard
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate, initials } from '../../lib/format.js';

export default function FeesDashboard({ onSwitchTab }) {
  const { currentTerm } = useStore();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [studentProfile, setStudentProfile] = useState(null);
  const [profileStudentId, setProfileStudentId] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await window.api.fees.dashboard(currentTerm?.id);
      setData(res);
      setLoading(false);
    })();
  }, [currentTerm?.id]);

  async function loadProfile(studentId) {
    if (!studentId) { setStudentProfile(null); return; }
    setProfileLoading(true);
    const p = await window.api.fees.studentFinProfile(parseInt(studentId));
    setStudentProfile(p);
    setProfileLoading(false);
  }

  if (loading || !data) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;
  }

  const m = data.metrics;

  return (
    <div className="fees-dashboard">
      {/* Metrics */}
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="metric-card">
          <div className="metric-icon blue"><IconTarget /></div>
          <div className="metric-body">
            <div className="metric-label">Expected Income</div>
            <div className="metric-value">{fmtCedi(m.expected_income)}</div>
            <div className="metric-sub">If all bills are paid</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon green"><IconCheck /></div>
          <div className="metric-body">
            <div className="metric-label">Collected So Far</div>
            <div className="metric-value success">{fmtCedi(m.total_collected)}</div>
            <div className="metric-sub">{m.payment_count} payments</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon red"><IconWarn /></div>
          <div className="metric-body">
            <div className="metric-label">Outstanding</div>
            <div className="metric-value danger">{fmtCedi(m.outstanding)}</div>
            <div className="metric-sub">{m.debtor_count} debtors</div>
            <div className="metric-link" onClick={() => onSwitchTab('debtors')}>View debtors →</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon purple"><IconChart /></div>
          <div className="metric-body">
            <div className="metric-label">Collection Rate</div>
            <div className="metric-value">{m.collection_pct}%</div>
            <div className="metric-sub">{fmtCedi(m.total_billed)} billed</div>
          </div>
        </div>
      </div>

      {/* Per-class breakdown */}
      <div className="dash-row" style={{ gridTemplateColumns: '1.3fr 1fr', marginTop: 18 }}>
        <div className="card">
          <div className="section-header">
            <div className="section-title">Collection by Class</div>
            <span className="text-sm text-muted">{currentTerm?.label}</span>
          </div>
          {data.by_class.length === 0
            ? <div className="empty-state">No bills generated yet</div>
            : <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th>Students</th>
                      <th className="text-right">Billed</th>
                      <th className="text-right">Collected</th>
                      <th className="text-right">Outstanding</th>
                      <th>Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_class.map(c => {
                      const pct = c.total_billed > 0 ? Math.round((c.total_paid / c.total_billed) * 100) : 0;
                      return (
                        <tr key={c.id}>
                          <td><strong>{c.short_code}</strong></td>
                          <td>{c.student_count}</td>
                          <td className="text-right">{fmtCedi(c.total_billed)}</td>
                          <td className="text-right td-success">{fmtCedi(c.total_paid)}</td>
                          <td className="text-right td-danger">{fmtCedi(c.total_outstanding)}</td>
                          <td>
                            <div className="avg-bar">
                              <div
                                className="avg-bar-fill"
                                style={{ width: `${pct}%`, background: pct >= 70 ? '#15803D' : pct >= 40 ? '#B45309' : '#B91C1C' }}
                              />
                            </div>
                            <div className="text-xs text-muted" style={{ marginTop: 2 }}>{pct}%</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
          }
        </div>

        <div className="card">
          <div className="section-header">
            <div className="section-title">Top Debtors</div>
            <span className="section-view-all" onClick={() => onSwitchTab('debtors')}>View all →</span>
          </div>
          {data.top_debtors.length === 0
            ? <div className="empty-state">No outstanding bills</div>
            : <div className="debtors-list">
                {data.top_debtors.slice(0, 7).map(d => (
                  <div key={d.student_id} className="debtor-row" onClick={() => { setProfileStudentId(d.student_id); loadProfile(d.student_id); }}>
                    <div className="avatar avatar-sm">{initials(d)}</div>
                    <div className="debtor-info">
                      <div className="debtor-id">{d.index_number}</div>
                      <div className="debtor-name">{d.surname} {d.first_name}</div>
                      <div className="debtor-class">{d.class_code}</div>
                    </div>
                    <div className="debtor-amount-col">
                      <div className="debtor-amount">{fmtCedi(d.balance)}</div>
                      <div className="debtor-days">{d.days_outstanding} days</div>
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>
      </div>

      {/* Recent payments + student profile lookup */}
      <div className="dash-row" style={{ gridTemplateColumns: '1fr 1.3fr', marginTop: 18 }}>
        <div className="card">
          <div className="section-header">
            <div className="section-title">Recent Payments</div>
          </div>
          {data.recent_payments.length === 0
            ? <div className="empty-state">No payments yet</div>
            : <div className="payments-list">
                {data.recent_payments.slice(0, 8).map(p => (
                  <div key={p.id} className="payment-row">
                    <div className="payment-row-left">
                      <div className="payment-row-meta">{p.receipt_number}</div>
                      <div className="payment-row-name">{p.surname} {p.first_name}</div>
                      <div className="payment-row-type">{p.class_code} · {p.payment_method}</div>
                    </div>
                    <div className="payment-row-right">
                      <div className="payment-row-amount">{fmtCedi(p.amount)}</div>
                      <div className="payment-row-date">{fmtDate(p.payment_date)}</div>
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>

        <div className="card">
          <div className="section-header">
            <div className="section-title">Student Financial Profile</div>
          </div>
          <p className="text-sm text-muted" style={{ marginBottom: 10 }}>
            Click a debtor on the left, or enter an index number to view full payment history.
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input
              type="text"
              placeholder="Enter student index no. or click a debtor"
              value={profileStudentId}
              onChange={e => setProfileStudentId(e.target.value)}
              style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6 }}
            />
            <button className="btn btn-primary btn-sm" onClick={() => loadProfile(profileStudentId)}>Lookup</button>
          </div>

          {profileLoading && <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>}

          {!profileLoading && studentProfile && (
            <StudentFinProfileView profile={studentProfile} onSwitchTab={onSwitchTab} />
          )}
        </div>
      </div>
    </div>
  );
}

function StudentFinProfileView({ profile, onSwitchTab }) {
  const { student, bills, payments, summary } = profile;
  return (
    <div className="fin-profile">
      <div className="fin-profile-header">
        <div className="avatar avatar-lg">{initials(student)}</div>
        <div className="fin-profile-meta">
          <div className="fin-profile-name">{student.surname} {student.first_name}</div>
          <div className="text-sm text-muted">
            {student.index_number} · {student.class_name || 'Unassigned'}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted">Outstanding</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: summary.outstanding > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {fmtCedi(summary.outstanding)}
          </div>
        </div>
      </div>

      <div className="fin-stats">
        <div className="fin-stat">
          <div className="text-xs text-muted">Total Billed</div>
          <div style={{ fontWeight: 600 }}>{fmtCedi(summary.total_billed)}</div>
        </div>
        <div className="fin-stat">
          <div className="text-xs text-muted">Total Paid</div>
          <div style={{ fontWeight: 600, color: 'var(--success)' }}>{fmtCedi(summary.total_paid)}</div>
        </div>
        <div className="fin-stat">
          <div className="text-xs text-muted">Payments</div>
          <div style={{ fontWeight: 600 }}>{summary.payment_count}</div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="text-sm font-bold" style={{ marginBottom: 6 }}>Bills</div>
        {bills.length === 0
          ? <div className="text-sm text-muted">No bills generated yet.</div>
          : <table style={{ fontSize: 12 }}>
              <thead>
                <tr><th>Term</th><th className="text-right">Billed</th><th className="text-right">Paid</th><th className="text-right">Balance</th></tr>
              </thead>
              <tbody>
                {bills.map(b => (
                  <tr key={b.id}>
                    <td>{b.term_label} ({b.year_label})</td>
                    <td className="text-right">{fmtCedi(b.total_billed)}</td>
                    <td className="text-right td-success">{fmtCedi(b.total_paid)}</td>
                    <td className="text-right" style={{ color: b.balance > 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
                      {fmtCedi(b.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        }
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="text-sm font-bold" style={{ marginBottom: 6 }}>Payment History</div>
        {payments.length === 0
          ? <div className="text-sm text-muted">No payments recorded.</div>
          : <table style={{ fontSize: 12 }}>
              <thead>
                <tr><th>Date</th><th>Receipt</th><th>Term</th><th className="text-right">Amount</th></tr>
              </thead>
              <tbody>
                {payments.slice(0, 10).map(p => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.payment_date)}</td>
                    <td className="td-muted" style={{ fontFamily: 'monospace', fontSize: 11 }}>{p.receipt_number}</td>
                    <td>{p.term_label}</td>
                    <td className="text-right td-success">{fmtCedi(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
        }
      </div>
    </div>
  );
}

function IconTarget() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>; }
function IconCheck()  { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="currentColor"/><path d="M8 12l3 3 5-6" stroke="#fff" strokeWidth="2.5" fill="none"/></svg>; }
function IconWarn()   { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3L2 21h20L12 3z" fill="currentColor"/><path d="M12 9v5M12 17v.5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg>; }
function IconChart()  { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none"/><path d="M12 3a9 9 0 019 9h-9V3z" fill="currentColor"/></svg>; }
