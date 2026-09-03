// Nickland Edusoft — Academics Dashboard Tab
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/index.js';

export default function AcademicsDashboard({ onSwitchTab }) {
  const { currentTerm } = useStore();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await window.api.academics.dashboard(currentTerm?.id);
      setData(res);
      setLoading(false);
    })();
  }, [currentTerm?.id]);

  if (loading || !data) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;
  }

  const m = data.metrics || {};

  return (
    <div className="academics-dashboard">
      {/* Metrics */}
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="metric-card">
          <div className="metric-icon blue"><IconClipboard /></div>
          <div className="metric-body">
            <div className="metric-label">Scores Entered</div>
            <div className="metric-value">{m.scores_entered || 0}</div>
            <div className="metric-sub">This term</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon green"><IconStudent /></div>
          <div className="metric-body">
            <div className="metric-label">Students Assessed</div>
            <div className="metric-value success">{m.students_with_scores || 0}</div>
            <div className="metric-sub">At least one score</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon orange"><IconExam /></div>
          <div className="metric-body">
            <div className="metric-label">Exam Papers</div>
            <div className="metric-value accent">{m.exam_papers_total || 0}</div>
            <div className="metric-sub">
              {m.exam_papers_published || 0} published, {m.exam_papers_draft || 0} drafts
            </div>
            <div className="metric-link" onClick={() => onSwitchTab('examinations')}>Open examinations →</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon purple"><IconBank /></div>
          <div className="metric-body">
            <div className="metric-label">Question Bank</div>
            <div className="metric-value">{m.question_bank_size || 0}</div>
            <div className="metric-sub">Questions stored</div>
          </div>
        </div>
      </div>

      {/* Class performance + Top students */}
      <div className="dash-row" style={{ gridTemplateColumns: '1.3fr 1fr', marginTop: 18 }}>
        <div className="card">
          <div className="section-header">
            <div className="section-title">Class Performance Averages</div>
            <span className="text-sm text-muted">This term</span>
          </div>
          {data.class_performance.length === 0
            ? <div className="empty-state">No class averages computed yet</div>
            : <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Class</th><th>Students Assessed</th><th>Class Average</th><th></th></tr>
                  </thead>
                  <tbody>
                    {data.class_performance.map(c => (
                      <tr key={c.id}>
                        <td><strong>{c.short_code}</strong> — {c.class_name}</td>
                        <td>{c.students_assessed}</td>
                        <td>
                          <strong style={{ color: avgColor(c.class_average) }}>
                            {c.class_average?.toFixed(1) || '—'}%
                          </strong>
                        </td>
                        <td>
                          <div className="avg-bar">
                            <div className="avg-bar-fill" style={{ width: `${c.class_average || 0}%`, background: avgColor(c.class_average) }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          }
        </div>

        <div className="card">
          <div className="section-header">
            <div className="section-title">Top 10 Students This Term</div>
          </div>
          {data.top_students.length === 0
            ? <div className="empty-state">No rankings yet</div>
            : <div className="ranking-list">
                {data.top_students.map((s, i) => (
                  <div key={s.student_id} className="ranking-row" onClick={() => navigate(`/students/${s.student_id}`)}>
                    <div className={'rank-badge' + (i < 3 ? ' rank-top' : '')}>{i + 1}</div>
                    <div className="ranking-info">
                      <div className="ranking-name">{s.surname} {s.first_name}</div>
                      <div className="ranking-class">{s.class_name}</div>
                    </div>
                    <div className="ranking-score">{s.average_score?.toFixed(1)}%</div>
                  </div>
                ))}
              </div>
          }
        </div>
      </div>

      {/* Quick links */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="section-title" style={{ marginBottom: 14 }}>Quick Actions</div>
        <div className="quick-actions">
          <button className="quick-action-btn" onClick={() => onSwitchTab('scores')}>
            <IconClipboard /> <span>Enter Class Scores</span>
          </button>
          <button className="quick-action-btn" onClick={() => onSwitchTab('profile')}>
            <IconStudent /> <span>View Student Profile</span>
          </button>
          <button className="quick-action-btn" onClick={() => onSwitchTab('examinations')}>
            <IconExam /> <span>Build New Exam Paper</span>
          </button>
          <button className="quick-action-btn" onClick={() => onSwitchTab('examinations')}>
            <IconBank /> <span>Manage Question Bank</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function avgColor(avg) {
  if (avg == null) return 'var(--muted)';
  if (avg >= 80) return '#15803D';
  if (avg >= 70) return '#0369A1';
  if (avg >= 60) return '#B45309';
  return '#B91C1C';
}

function IconClipboard() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="6" y="4" width="12" height="18" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/><rect x="9" y="2" width="6" height="4" rx="1" fill="currentColor"/><path d="M9 11h6M9 15h4" stroke="currentColor" strokeWidth="1.8"/></svg>; }
function IconStudent()   { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" fill="none"/></svg>; }
function IconExam()      { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.8"/></svg>; }
function IconBank()      { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/><path d="M3 10h18M8 14h2M8 17h2M14 14h2M14 17h2" stroke="currentColor" strokeWidth="1.8"/></svg>; }
