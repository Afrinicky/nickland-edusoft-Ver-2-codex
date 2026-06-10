// Nickland Edusoft — Students Dashboard Tab
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/index.js';
import { initials } from '../../lib/format.js';

export default function StudentsDashboard({ onSwitchTab }) {
  const classes = useStore(s => s.classes);
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const all = await window.api.students.list({});
      setStudents(all);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;
  }

  // Metrics
  const total = students.length;
  const active = students.filter(s => s.status === 'Active').length;
  const inactive = students.filter(s => s.status === 'Inactive').length;
  const graduated = students.filter(s => s.status === 'Graduated').length;
  const normGender = (g) => {
    const v = (g || '').toString().trim().toLowerCase();
    if (v === 'm' || v === 'male' || v === 'boy') return 'Male';
    if (v === 'f' || v === 'female' || v === 'girl') return 'Female';
    return '';
  };
  const male = students.filter(s => normGender(s.gender) === 'Male' && s.status === 'Active').length;
  const female = students.filter(s => normGender(s.gender) === 'Female' && s.status === 'Active').length;
  const malePct = active > 0 ? Math.round((male / active) * 100) : 0;
  const femalePct = active > 0 ? Math.round((female / active) * 100) : 0;

  // Class distribution (active only)
  const byClass = {};
  for (const s of students) {
    if (s.status !== 'Active') continue;
    const key = s.class_name || 'Unassigned';
    byClass[key] = (byClass[key] || 0) + 1;
  }
  const classDist = Object.entries(byClass)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Recently admitted (last 10)
  const recent = [...students]
    .filter(s => s.admission_date)
    .sort((a, b) => (b.admission_date || '').localeCompare(a.admission_date || ''))
    .slice(0, 6);

  const maxCount = Math.max(...classDist.map(c => c.count), 1);

  return (
    <div className="students-dashboard">
      {/* Top metrics */}
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="metric-card">
          <div className="metric-icon blue"><IconStudents /></div>
          <div className="metric-body">
            <div className="metric-label">Total Students</div>
            <div className="metric-value">{total}</div>
            <div className="metric-sub">All time</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon green"><IconCheck /></div>
          <div className="metric-body">
            <div className="metric-label">Active Students</div>
            <div className="metric-value success">{active}</div>
            <div className="metric-sub">Currently enrolled</div>
            <div className="metric-link" onClick={() => onSwitchTab('status')}>View status →</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon orange"><IconPause /></div>
          <div className="metric-body">
            <div className="metric-label">Inactive</div>
            <div className="metric-value accent">{inactive}</div>
            <div className="metric-sub">Suspended / Transferred</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon purple"><IconGrad /></div>
          <div className="metric-body">
            <div className="metric-label">Graduated</div>
            <div className="metric-value">{graduated}</div>
            <div className="metric-sub">Completed school</div>
          </div>
        </div>
      </div>

      {/* Middle row */}
      <div className="dash-row" style={{ gridTemplateColumns: '1.3fr 1fr', marginTop: 18 }}>
        <div className="card">
          <div className="section-header">
            <div className="section-title">Students by Class</div>
            <span className="text-sm text-muted">{active} active students across {classDist.length} classes</span>
          </div>
          {classDist.length === 0
            ? <div className="empty-state">No students admitted yet</div>
            : <div className="class-bar-list">
                {classDist.map(c => (
                  <div key={c.name} className="class-bar-row">
                    <div className="class-bar-label">{c.name}</div>
                    <div className="class-bar-track">
                      <div
                        className="class-bar-fill"
                        style={{ width: `${(c.count / maxCount) * 100}%` }}
                      />
                    </div>
                    <div className="class-bar-count">{c.count}</div>
                  </div>
                ))}
              </div>
          }
        </div>

        <div className="card">
          <div className="section-header">
            <div className="section-title">Gender Distribution</div>
            <span className="text-sm text-muted">Active students</span>
          </div>
          <div className="gender-stats">
            <GenderRow label="Male" count={male} pct={malePct} color="#3B82F6" />
            <GenderRow label="Female" count={female} pct={femalePct} color="#EC4899" />
          </div>
          <div className="gender-bar">
            <div className="gender-bar-segment" style={{ width: `${malePct}%`, background: '#3B82F6' }} />
            <div className="gender-bar-segment" style={{ width: `${femalePct}%`, background: '#EC4899' }} />
          </div>
        </div>
      </div>

      {/* Recent admissions */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="section-header">
          <div className="section-title">Recent Admissions</div>
          <span className="section-view-all" onClick={() => onSwitchTab('admissions')}>Admit new student →</span>
        </div>
        {recent.length === 0
          ? <div className="empty-state">No admissions yet</div>
          : <div className="recent-admissions">
              {recent.map(s => (
                <div key={s.id} className="admission-row" onClick={() => navigate(`/students/${s.id}`)}>
                  <div className="avatar">{initials(s)}</div>
                  <div className="admission-info">
                    <div className="admission-name">{s.surname} {s.first_name}</div>
                    <div className="admission-meta">
                      <span>{s.index_number || '—'}</span> · <span>{s.class_name || 'Unassigned'}</span>
                    </div>
                  </div>
                  <div className="admission-date">
                    {s.admission_date ? new Date(s.admission_date).toLocaleDateString('en-GB') : '—'}
                  </div>
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  );
}

function GenderRow({ label, count, pct, color }) {
  return (
    <div className="gender-row">
      <div className="gender-row-left">
        <span className="legend-dot" style={{ background: color }} />
        <span>{label}</span>
      </div>
      <div className="gender-row-right">
        <strong>{count}</strong> <span className="text-muted">({pct}%)</span>
      </div>
    </div>
  );
}

function IconStudents() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="4" fill="currentColor"/><circle cx="17" cy="8" r="3" fill="currentColor" opacity="0.7"/><path d="M1 20c0-4 4-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" fill="none"/></svg>; }
function IconCheck()    { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="currentColor"/><path d="M8 12l3 3 5-6" stroke="#fff" strokeWidth="2.5" fill="none"/></svg>; }
function IconPause()    { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="currentColor"/><path d="M10 9v6M14 9v6" stroke="#fff" strokeWidth="2.5"/></svg>; }
function IconGrad()     { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3l10 5-10 5L2 8z" fill="currentColor"/><path d="M5 11v4c0 2 3 4 7 4s7-2 7-4v-4" stroke="currentColor" strokeWidth="2" fill="none"/></svg>; }
