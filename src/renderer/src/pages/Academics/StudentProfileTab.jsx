// Nickland Edusoft — Student Academic Profile Tab
// Cumulative multi-term view with performance graphs
import React, { useEffect, useState, useMemo } from 'react';
import { useStore } from '../../store/index.js';
import { fullName, initials } from '../../lib/format.js';

export default function StudentProfileTab() {
  const classes = useStore(s => s.classes);
  const [classId, setClassId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [students, setStudents] = useState([]);
  const [profile, setProfile] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);

  // Load students of the chosen class
  useEffect(() => {
    if (!classId) { setStudents([]); return; }
    (async () => {
      const list = await window.api.students.list({ classId });
      setStudents(list);
    })();
  }, [classId]);

  // Load profile when student chosen
  useEffect(() => {
    if (!studentId) { setProfile(null); setEvents([]); return; }
    (async () => {
      setLoading(true);
      const [p, e] = await Promise.all([
        window.api.scores.getStudentCumulative(parseInt(studentId)),
        window.api.students.listEvents(parseInt(studentId)),
      ]);
      setProfile(p);
      setEvents(e);
      setLoading(false);
    })();
  }, [studentId]);

  return (
    <div className="student-profile-tab">
      {/* Selectors */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="form-row">
          <div className="form-group">
            <label>Class</label>
            <select value={classId} onChange={e => { setClassId(e.target.value); setStudentId(''); }}>
              <option value="">— Select Class —</option>
              {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Student</label>
            <select value={studentId} onChange={e => setStudentId(e.target.value)} disabled={!classId}>
              <option value="">— Select Student —</option>
              {students.map(s => (
                <option key={s.id} value={s.id ?? ''}>
                  {s.surname} {s.first_name} ({s.index_number})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {!studentId && (
        <div className="card empty-state-card">
          <IconUser size={48} />
          <div style={{ fontSize: 15, fontWeight: 500, marginTop: 12 }}>Select a student to view their academic profile</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Cumulative performance across all terms since admission, with graphs and remarks
          </div>
        </div>
      )}

      {studentId && loading && (
        <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
      )}

      {studentId && !loading && profile && (
        <ProfileView profile={profile} events={events} onAddEvent={(e) => {
          setEvents([e, ...events]);
        }} />
      )}
    </div>
  );
}

// ── Profile View ────────────────────────────────────────
function ProfileView({ profile, events, onAddEvent }) {
  const { student, overall, terms } = profile;
  const [eventModal, setEventModal] = useState(false);
  const showToast = useStore(s => s.showToast);

  return (
    <>
      {/* Header card */}
      <div className="card profile-header-card">
        <div className="profile-photo">
          {student.photo_path
            ? <img src={`file://${student.photo_path}`} alt="" />
            : <div className="avatar avatar-lg">{initials(student)}</div>
          }
        </div>
        <div className="profile-identity">
          <h2 className="profile-name">{fullName(student)}</h2>
          <div className="profile-meta">
            <span><strong>{student.index_number}</strong></span>
            <span> · {student.class_name || 'Unassigned'}</span>
            <span> · {student.gender}</span>
            <span> · Admitted {student.admission_date || '—'}</span>
          </div>
        </div>
        <div className="profile-summary">
          <div className="profile-summary-item">
            <div className="profile-summary-label">Lifetime Avg.</div>
            <div className="profile-summary-value">{overall.lifetime_average?.toFixed(1) || '—'}%</div>
          </div>
          <div className="profile-summary-item">
            <div className="profile-summary-label">Best Rank</div>
            <div className="profile-summary-value">{overall.best_rank || '—'}</div>
          </div>
          <div className="profile-summary-item">
            <div className="profile-summary-label">Terms Recorded</div>
            <div className="profile-summary-value">{overall.terms_recorded || 0}</div>
          </div>
          <div className="profile-summary-item">
            <div className="profile-summary-label">Attendance</div>
            <div className="profile-summary-value">
              {overall.total_school_days
                ? `${Math.round((overall.total_days_present / overall.total_school_days) * 100)}%`
                : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Performance graph */}
      {terms.length > 0 && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="section-header">
            <div className="section-title">Performance Trend</div>
            <span className="text-sm text-muted">Average score per term since admission</span>
          </div>
          <PerformanceGraph terms={terms} />
        </div>
      )}

      {/* Term-by-term breakdown */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="section-header">
          <div className="section-title">Term-by-Term Results</div>
        </div>
        {terms.length === 0
          ? <div className="empty-state">No scores recorded yet</div>
          : <div className="term-results">
              {terms.map(t => (
                <TermBlock key={t.term_id} term={t} />
              ))}
            </div>
        }
      </div>

      {/* Interests, talents, remarks */}
      {terms.length > 0 && (
        <div className="dash-row" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 18 }}>
          <div className="card">
            <div className="section-title">Learner's Interests & Talents</div>
            {terms.filter(t => t.learner_interests || t.learner_talents).slice(-1).map(t => (
              <div key={t.term_id} style={{ marginTop: 10 }}>
                {t.learner_interests && (
                  <>
                    <div className="text-sm text-muted">Interests</div>
                    <p style={{ marginTop: 4 }}>{t.learner_interests}</p>
                  </>
                )}
                {t.learner_talents && (
                  <>
                    <div className="text-sm text-muted" style={{ marginTop: 10 }}>Talents</div>
                    <p style={{ marginTop: 4 }}>{t.learner_talents}</p>
                  </>
                )}
              </div>
            ))}
            {!terms.some(t => t.learner_interests || t.learner_talents) && (
              <div className="empty-state">No interests or talents recorded</div>
            )}
          </div>
          <div className="card">
            <div className="section-title">Teacher Remarks</div>
            {terms.filter(t => t.teacher_remarks).map(t => (
              <div key={t.term_id} className="remark-block">
                <div className="text-sm text-muted">{t.term_label} · {t.year_label}</div>
                <p style={{ marginTop: 4 }}>{t.teacher_remarks}</p>
              </div>
            ))}
            {!terms.some(t => t.teacher_remarks) && (
              <div className="empty-state">No remarks recorded</div>
            )}
          </div>
        </div>
      )}

      {/* Events log: misconduct, achievements, notes */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="section-header">
          <div className="section-title">Misconduct / Achievement Log</div>
          <button className="btn btn-outline btn-sm" onClick={() => setEventModal(true)}>+ Add Entry</button>
        </div>
        {events.length === 0
          ? <div className="empty-state">No log entries yet</div>
          : <div className="event-list">
              {events.map(e => (
                <div key={e.id} className={`event-item event-${e.event_type}`}>
                  <div className="event-badge">
                    {e.event_type === 'achievement' && '🏆'}
                    {e.event_type === 'misconduct'  && '⚠️'}
                    {e.event_type === 'note'        && '📝'}
                  </div>
                  <div className="event-body">
                    <div className="event-title">{e.title}</div>
                    {e.description && <div className="event-desc">{e.description}</div>}
                    <div className="event-meta">{e.date} · by {e.recorded_by_name || 'Unknown'}</div>
                  </div>
                </div>
              ))}
            </div>
        }
      </div>

      {/* Print / generate buttons */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="section-title" style={{ marginBottom: 12 }}>Generate Documents</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={() => showToast('Attestation generation coming soon', 'info')}>
            <IconDoc /> &nbsp;Generate Attestation
          </button>
          <button className="btn btn-outline" onClick={() => showToast('Testimonial generation coming soon', 'info')}>
            <IconDoc /> &nbsp;Generate Testimonial
          </button>
          <button className="btn btn-outline" onClick={() => window.print()}>
            <IconPrint /> &nbsp;Print Academic Profile
          </button>
        </div>
      </div>

      {eventModal && (
        <AddEventModal
          studentId={student.id}
          onClose={() => setEventModal(false)}
          onSaved={(e) => { setEventModal(false); onAddEvent(e); showToast('Entry added', 'success'); }}
        />
      )}
    </>
  );
}

// ── Term Block ─────────────────────────────────────────
function TermBlock({ term }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="term-block">
      <div className="term-block-header" onClick={() => setOpen(!open)}>
        <div>
          <div className="term-block-title">{term.term_label} · {term.year_label}</div>
          <div className="term-block-sub">
            {term.class_name && `${term.class_short} · `}
            {term.subjects?.length || 0} subjects
            {term.class_rank && ` · Rank ${term.class_rank}/${term.number_on_roll}`}
          </div>
        </div>
        <div className="term-block-avg">
          <div className="term-block-avg-val" style={{ color: avgColor(term.average_score) }}>
            {term.average_score?.toFixed(1) || '—'}%
          </div>
          <div className="text-xs text-muted">Average</div>
        </div>
      </div>
      {open && term.subjects && term.subjects.length > 0 && (
        <div className="term-block-body">
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Class Score</th>
                <th>Exam Score</th>
                <th>Total</th>
                <th>Grade</th>
              </tr>
            </thead>
            <tbody>
              {term.subjects.map((s, i) => (
                <tr key={i}>
                  <td>{s.subject_name}</td>
                  <td>{s.class_score?.toFixed(1) || '—'}</td>
                  <td>{s.exam_score?.toFixed(1) || '—'}</td>
                  <td><strong>{s.total_score?.toFixed(1) || '—'}</strong></td>
                  <td><span className="badge badge-muted">{s.grade_remark || '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Performance Graph ──────────────────────────────────
function PerformanceGraph({ terms }) {
  const withData = terms.filter(t => t.average_score != null);
  if (withData.length === 0) return <div className="empty-state">No data to graph</div>;

  const W = 100, H = 40;
  const max = Math.max(...withData.map(t => t.average_score), 100);
  const min = Math.min(...withData.map(t => t.average_score), 0);
  const range = max - min || 1;

  const points = withData.map((t, i) => {
    const x = withData.length === 1 ? W / 2 : (i / (withData.length - 1)) * W;
    const y = H - ((t.average_score - min) / range) * H;
    return { x, y, term: t };
  });

  return (
    <div className="chart-container">
      <div className="chart-svg-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="160">
          {[0.25, 0.5, 0.75].map(y => (
            <line key={y} x1="0" y1={H * y} x2={W} y2={H * y} stroke="#E5E7EB" strokeWidth="0.2" strokeDasharray="0.5,0.5" />
          ))}
          <polygon
            points={`0,${H} ${points.map(p => `${p.x},${p.y}`).join(' ')} ${W},${H}`}
            fill="#1B3A6B" fillOpacity="0.15"
          />
          <polyline
            points={points.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none" stroke="#1B3A6B" strokeWidth="0.5"
          />
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="0.8" fill="#C9961A" />
          ))}
        </svg>
      </div>
      <div className="chart-x-labels">
        {points.map((p, i) => (
          <div key={i} className="chart-x-label" style={{ fontSize: 10 }}>
            {p.term.term_label?.split(' ')[0]} {p.term.year_label?.slice(2, 4) ? "'" + p.term.year_label.slice(2, 4) : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Add Event Modal ────────────────────────────────────
function AddEventModal({ studentId, onClose, onSaved }) {
  const [form, setForm] = useState({
    event_type: 'note',
    title: '',
    description: '',
    date: new Date().toISOString().slice(0, 10),
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true);
    const res = await window.api.students.addEvent({
      student_id: studentId, ...form
    });
    setSaving(false);
    if (res.ok) onSaved({ id: res.id, student_id: studentId, ...form });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Add Log Entry</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form-group">
          <label>Type</label>
          <select value={form.event_type ?? ''} onChange={e => setForm({ ...form, event_type: e.target.value })}>
            <option value="note">Note</option>
            <option value="achievement">Achievement</option>
            <option value="misconduct">Misconduct</option>
          </select>
        </div>
        <div className="form-group">
          <label>Title</label>
          <input type="text" value={form.title ?? ''} onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="Short title for this entry" autoFocus />
        </div>
        <div className="form-group">
          <label>Description (optional)</label>
          <textarea rows="3" value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Date</label>
          <input type="date" value={form.date ?? ''} onChange={e => setForm({ ...form, date: e.target.value })} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !form.title.trim()}>
            {saving ? 'Saving…' : 'Save Entry'}
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
function IconUser({ size = 22 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" fill="none"/>
    <path d="M4 21c0-4 4-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" fill="none"/>
  </svg>;
}
function IconDoc()  { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" fill="none"/><path d="M9 8h6M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.8"/></svg>; }
function IconPrint(){ return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="6" y="3" width="12" height="6" stroke="currentColor" strokeWidth="1.8" fill="none"/><rect x="4" y="9" width="16" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" fill="none"/><rect x="7" y="14" width="10" height="7" stroke="currentColor" strokeWidth="1.8" fill="none"/></svg>; }
