// Nickland Edusoft — Students Admissions Tab
import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/index.js';
import StudentForm from './Form.jsx';

export default function StudentsAdmissionsTab({ onAdmitted }) {
  const showToast = useStore(s => s.showToast);
  const [showForm, setShowForm] = useState(false);
  const [recent, setRecent] = useState([]);
  const [thisYearCount, setThisYearCount] = useState(0);
  const [thisMonthCount, setThisMonthCount] = useState(0);
  const [thisWeekCount, setThisWeekCount] = useState(0);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const all = await window.api.students.list({});
    const now = new Date();
    const todayISO = now.toISOString().slice(0, 10);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const recentSorted = [...all]
      .filter(s => s.admission_date)
      .sort((a, b) => (b.admission_date || '').localeCompare(a.admission_date || ''));

    setRecent(recentSorted.slice(0, 10));
    setThisWeekCount(recentSorted.filter(s => new Date(s.admission_date) >= weekStart).length);
    setThisMonthCount(recentSorted.filter(s => new Date(s.admission_date) >= monthStart).length);
    setThisYearCount(recentSorted.filter(s => new Date(s.admission_date) >= yearStart).length);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

  async function handleSaved(id) {
    showToast('Student admitted successfully', 'success');
    setShowForm(false);
    refresh();
    if (onAdmitted) onAdmitted();
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;
  }

  return (
    <div className="admissions-tab">
      {/* Mini dashboard */}
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 18 }}>
        <div className="metric-card">
          <div className="metric-icon blue"><IconUserPlus /></div>
          <div className="metric-body">
            <div className="metric-label">This Week</div>
            <div className="metric-value">{thisWeekCount}</div>
            <div className="metric-sub">New admissions</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon green"><IconCalendar /></div>
          <div className="metric-body">
            <div className="metric-label">This Month</div>
            <div className="metric-value success">{thisMonthCount}</div>
            <div className="metric-sub">New admissions</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon purple"><IconYear /></div>
          <div className="metric-body">
            <div className="metric-label">This Year</div>
            <div className="metric-value">{thisYearCount}</div>
            <div className="metric-sub">{new Date().getFullYear()}</div>
          </div>
        </div>
      </div>

      {/* Admit New Student CTA */}
      {!showForm && (
        <div className="card admission-cta">
          <div>
            <div className="cta-title">Admit a New Student</div>
            <div className="cta-sub">Add a new student to the school register with full personal, family, and academic details.</div>
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => setShowForm(true)}>
            <IconUserPlus /> &nbsp;Admit New Student
          </button>
        </div>
      )}

      {/* Admission form (inline) */}
      {showForm && (
        <div className="card">
          <div className="section-header">
            <div className="section-title">New Student Admission</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
          <StudentForm onSaved={handleSaved} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {/* Recent admissions log */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="section-header">
          <div className="section-title">Recent Admissions Log</div>
        </div>
        {recent.length === 0
          ? <div className="empty-state">No admissions yet</div>
          : <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Index No.</th>
                    <th>Name</th>
                    <th>Class</th>
                    <th>Gender</th>
                    <th>Admitted On</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map(s => (
                    <tr key={s.id}>
                      <td className="td-muted" style={{ fontFamily: 'monospace' }}>{s.index_number}</td>
                      <td><strong>{s.surname} {s.first_name}</strong> {s.other_names}</td>
                      <td>{s.class_name || 'Unassigned'}</td>
                      <td>{s.gender}</td>
                      <td className="td-muted">{s.admission_date ? new Date(s.admission_date).toLocaleDateString('en-GB') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        }
      </div>
    </div>
  );
}

function IconUserPlus() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="10" cy="8" r="4" fill="currentColor"/><path d="M2 21c0-4 3.5-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" fill="none"/><path d="M19 8v6M16 11h6" stroke="currentColor" strokeWidth="2.5"/></svg>; }
function IconCalendar() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2"/></svg>; }
function IconYear()     { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="currentColor"/><text x="12" y="15.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff">365</text></svg>; }
