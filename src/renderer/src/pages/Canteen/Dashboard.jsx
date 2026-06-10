// Nickland Edusoft — Canteen Dashboard
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate, initials } from '../../lib/format.js';

export default function CanteenDashboard({ onSwitchTab }) {
  const { currentTerm } = useStore();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await window.api.canteen.dashboard(currentTerm?.id);
      setData(res);
      setLoading(false);
    })();
  }, [currentTerm?.id]);

  if (loading || !data) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;
  }

  const m = data.metrics;
  const todayTotal = (m.today_paid || 0) + (m.today_unpaid || 0) + (m.today_exempt || 0);
  const todayPaidPct = todayTotal > 0 ? Math.round((m.today_paid / todayTotal) * 100) : 0;

  return (
    <div className="canteen-dashboard">
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="metric-card">
          <div className="metric-icon green"><IconCash /></div>
          <div className="metric-body">
            <div className="metric-label">Collected This Term</div>
            <div className="metric-value success">{fmtCedi(m.total_collected)}</div>
            <div className="metric-sub">{m.payment_count} payments</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon red"><IconWarn /></div>
          <div className="metric-body">
            <div className="metric-label">Outstanding</div>
            <div className="metric-value danger">{fmtCedi(m.amount_owed)}</div>
            <div className="metric-sub">{m.unpaid_students} students, {m.unpaid_days_total} days</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon blue"><IconCal /></div>
          <div className="metric-body">
            <div className="metric-label">Daily Rate</div>
            <div className="metric-value">{fmtCedi(data.daily_rate)}</div>
            <div className="metric-sub">{m.total_school_days} school days</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon orange"><IconBell /></div>
          <div className="metric-body">
            <div className="metric-label">Today's Status</div>
            <div className="metric-value">{m.today_paid}/{todayTotal}</div>
            <div className="metric-sub">paid ({todayPaidPct}%) · {m.today_exempt} exempt</div>
            <div className="metric-link" onClick={() => onSwitchTab('quickpay')}>Quick Pay →</div>
          </div>
        </div>
      </div>

      {/* Setting note */}
      {m.attendance_exempt_enabled && (
        <div className="info-banner" style={{ marginTop: 16 }}>
          ✓ <strong>Attendance-linked exemption is ON.</strong> Absent students will not be charged canteen fees for that day.
        </div>
      )}

      {/* Two-column: Top debtors + Recent payments */}
      <div className="dash-row" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
        <div className="card">
          <div className="section-header">
            <div className="section-title">Top Canteen Debtors</div>
            <span className="section-view-all" onClick={() => onSwitchTab('debtors')}>View all →</span>
          </div>
          {data.top_debtors.length === 0
            ? <div className="empty-state">No debtors 🎉</div>
            : <div className="debtors-list">
                {data.top_debtors.slice(0, 8).map(d => (
                  <div key={d.student_id} className="debtor-row">
                    <div className="avatar avatar-sm">{initials(d)}</div>
                    <div className="debtor-info">
                      <div className="debtor-id">{d.index_number}</div>
                      <div className="debtor-name">{d.surname} {d.first_name}</div>
                      <div className="debtor-class">{d.class_code}</div>
                    </div>
                    <div className="debtor-amount-col">
                      <div className="debtor-amount">{fmtCedi(d.amount_owed)}</div>
                      <div className="debtor-days">{d.unpaid_days} days</div>
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>

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
                      <div className="payment-row-name">{p.surname} {p.first_name}</div>
                      <div className="payment-row-type">{p.class_code} · {p.days_covered} day{p.days_covered > 1 ? 's' : ''}</div>
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
      </div>
    </div>
  );
}

function IconCash() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="2" y="6" width="20" height="12" rx="2" fill="currentColor"/><circle cx="12" cy="12" r="3" stroke="#fff" strokeWidth="2"/></svg>; }
function IconWarn() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3L2 21h20L12 3z" fill="currentColor"/><path d="M12 9v5M12 17v.5" stroke="#fff" strokeWidth="2.5"/></svg>; }
function IconCal()  { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2"/></svg>; }
function IconBell() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 9c0-4 4-6 8-6s8 2 8 6v7l3 3H1l3-3V9z" fill="currentColor"/><path d="M9 20a3 3 0 006 0" stroke="currentColor" strokeWidth="2" fill="none"/></svg>; }
