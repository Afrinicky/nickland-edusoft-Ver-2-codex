// Nickland Edusoft — Staff Management Dashboard
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/index.js';
import { fmtDate, initials } from '../../lib/format.js';

export default function StaffDashboard({ onSwitchTab }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await window.api.staff.dashboard();
      setData(res);
      setLoading(false);
    })();
  }, []);

  if (loading || !data) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;
  }

  const m = data.metrics;
  const presentPct = m.today_total_marked > 0
    ? Math.round((m.today_present / m.today_total_marked) * 100) : 0;

  return (
    <div className="staff-dashboard">
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="metric-card">
          <div className="metric-icon blue"><IconStaff /></div>
          <div className="metric-body">
            <div className="metric-label">Active Staff</div>
            <div className="metric-value">{m.total_active}</div>
            <div className="metric-sub">{m.total_inactive} inactive · {m.total_all} all-time</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon green"><IconCheck /></div>
          <div className="metric-body">
            <div className="metric-label">Today's Attendance</div>
            <div className="metric-value success">
              {m.clockin_enabled ? `${m.today_present}/${m.today_total_marked || m.total_active}` : '—'}
            </div>
            <div className="metric-sub">
              {m.clockin_enabled
                ? `${presentPct}% present · ${m.today_absent} absent · ${m.today_late} late`
                : 'Clock-in disabled'}
            </div>
            {m.clockin_enabled && (
              <div className="metric-link" onClick={() => onSwitchTab('attendance')}>View attendance →</div>
            )}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon orange"><IconBell /></div>
          <div className="metric-body">
            <div className="metric-label">Leave Requests</div>
            <div className="metric-value accent">{m.pending_leave}</div>
            <div className="metric-sub">Pending review · {m.on_leave_today} on leave today</div>
            <div className="metric-link" onClick={() => onSwitchTab('leave')}>Review →</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon purple"><IconDoc /></div>
          <div className="metric-body">
            <div className="metric-label">Expiring Documents</div>
            <div className="metric-value">{data.expiring_documents.length}</div>
            <div className="metric-sub">In next 90 days</div>
            {data.expiring_documents.length > 0 && (
              <div className="metric-link" onClick={() => onSwitchTab('files')}>Review →</div>
            )}
          </div>
        </div>
      </div>

      {/* Clock-in disabled banner */}
      {!m.clockin_enabled && (
        <div className="info-banner" style={{ marginTop: 16, background: 'var(--warning-bg)', borderLeftColor: 'var(--warning)' }}>
          ⚠ <strong>Staff clock-in is disabled.</strong> Enable it in <strong>Settings → Security</strong> if you want to record daily attendance.
        </div>
      )}

      {/* Two-column row */}
      <div className="dash-row" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
        <div className="card">
          <div className="section-header">
            <div className="section-title">Staff by Role</div>
          </div>
          {data.by_role.length === 0
            ? <div className="empty-state">No staff yet</div>
            : <div className="class-bar-list">
                {data.by_role.map(r => {
                  const max = Math.max(...data.by_role.map(x => x.count));
                  return (
                    <div key={r.role} className="class-bar-row">
                      <div className="class-bar-label">{r.role}</div>
                      <div className="class-bar-track">
                        <div className="class-bar-fill" style={{ width: `${(r.count / max) * 100}%` }} />
                      </div>
                      <div className="class-bar-count">{r.count}</div>
                    </div>
                  );
                })}
              </div>
          }
        </div>

        <div className="card">
          <div className="section-header">
            <div className="section-title">Documents Expiring Soon</div>
            <span className="text-sm text-muted">Next 90 days</span>
          </div>
          {data.expiring_documents.length === 0
            ? <div className="empty-state">No documents expiring soon</div>
            : <div className="expiring-docs-list">
                {data.expiring_documents.map(d => {
                  const daysLeft = Math.ceil((new Date(d.expiry_date) - new Date()) / 86400000);
                  return (
                    <div key={d.id} className="expiring-doc-row" onClick={() => navigate(`/staff/${d.staff_id}`)}>
                      <div className="expiring-doc-info">
                        <div className="expiring-doc-title">{d.title}</div>
                        <div className="expiring-doc-meta">
                          {d.surname} {d.first_name} · {d.doc_type}
                        </div>
                      </div>
                      <div className="expiring-doc-date">
                        <div style={{ fontWeight: 600, color: daysLeft <= 30 ? 'var(--danger)' : 'var(--warning)' }}>
                          {daysLeft} days
                        </div>
                        <div className="text-xs text-muted">{fmtDate(d.expiry_date)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
          }
        </div>
      </div>

      {/* Recent hires */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-header">
          <div className="section-title">Recent Hires</div>
          <span className="text-sm text-muted">Last 6 months</span>
        </div>
        {data.recent_hires.length === 0
          ? <div className="empty-state">No recent hires</div>
          : <div className="recent-hires">
              {data.recent_hires.map(h => (
                <div key={h.id} className="recent-hire-card" onClick={() => navigate(`/staff/${h.id}`)}>
                  <div className="avatar avatar-lg">{initials(h)}</div>
                  <div>
                    <div className="recent-hire-name">{h.surname} {h.first_name}</div>
                    <div className="text-xs text-muted">{h.role}</div>
                    <div className="text-xs text-muted">Hired {fmtDate(h.hire_date)}</div>
                  </div>
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  );
}

function IconStaff() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" fill="none"/></svg>; }
function IconCheck() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="currentColor"/><path d="M8 12l3 3 5-6" stroke="#fff" strokeWidth="2.5" fill="none"/></svg>; }
function IconBell()  { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 9c0-4 4-6 8-6s8 2 8 6v7l3 3H1l3-3V9z" fill="currentColor"/></svg>; }
function IconDoc()   { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="2" fill="currentColor"/><path d="M9 8h6M9 12h6M9 16h4" stroke="#fff" strokeWidth="1.5"/></svg>; }
