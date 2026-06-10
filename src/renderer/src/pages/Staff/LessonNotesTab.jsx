// Nickland Edusoft — Lesson Notes Tab
// Ghanaian-style structured lesson notes with review workflow.
// Teachers see only their own; Head Teacher / Admin see all.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { sanitizeForForm } from '../../lib/formSafe.js';

const STATUS_BADGE = {
  draft:    { label: 'Draft',    cls: 'badge-muted' },
  submitted:{ label: 'Submitted',cls: 'badge-warning' },
  reviewed: { label: 'Reviewed', cls: 'badge-success' },
  revise:   { label: 'Needs revision', cls: 'badge-danger' },
};

export default function LessonNotesTab() {
  const { currentUser, currentTerm, classes } = useStore();
  const showToast = useStore(s => s.showToast);
  const [subjects, setSubjects] = useState([]);
  const [notes, setNotes] = useState([]);
  const [filter, setFilter] = useState({ termId: '', subjectId: '', classGroupId: '', status: '', search: '' });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const isSupervisor = ['Administrator', 'Proprietor', 'Head Teacher'].includes(currentUser?.designation);

  async function refresh() {
    setLoading(true);
    const [ns, subs] = await Promise.all([
      window.api.lessonNotes.list({
        termId: filter.termId || currentTerm?.id || undefined,
        subjectId: filter.subjectId || undefined,
        classGroupId: filter.classGroupId || undefined,
        status: filter.status || undefined,
        search: filter.search || undefined,
      }),
      window.api.scores.listSubjects(),
    ]);
    setNotes(ns || []);
    setSubjects(subs || []);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [filter.termId, filter.subjectId, filter.classGroupId, filter.status, filter.search]);

  async function handleDelete(id) {
    if (!confirm('Delete this lesson note? This cannot be undone.')) return;
    const res = await window.api.lessonNotes.delete(id);
    if (res.ok) { showToast('Deleted', 'success'); refresh(); }
    else showToast(res.error || 'Could not delete', 'error');
  }

  if (editing !== null) {
    return (
      <LessonNoteEditor
        note={editing}
        subjects={subjects}
        classes={classes}
        isSupervisor={isSupervisor}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refresh(); }}
      />
    );
  }

  return (
    <div className="lesson-notes-tab">
      <div className="card no-print">
        <div className="section-header">
          <div>
            <div className="section-title">Lesson Notes</div>
            <div className="text-sm text-muted">
              {isSupervisor
                ? 'All staff lesson notes. Click a note to review it.'
                : 'Your structured lesson plans. Heads/Administrators can review and acknowledge.'}
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            + New Lesson Note
          </button>
        </div>

        <div className="form-row" style={{ marginTop: 14 }}>
          <div className="form-group">
            <label>Subject</label>
            <select value={filter.subjectId} onChange={e => setFilter({ ...filter, subjectId: e.target.value })}>
              <option value="">All subjects</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Class</label>
            <select value={filter.classGroupId} onChange={e => setFilter({ ...filter, classGroupId: e.target.value })}>
              <option value="">All classes</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Status</label>
            <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="reviewed">Reviewed</option>
              <option value="revise">Needs revision</option>
            </select>
          </div>
          <div className="form-group" style={{ flex: 2 }}>
            <label>Search topic</label>
            <input type="text" value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })}
              placeholder="e.g. Photosynthesis" />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        {loading
          ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
          : notes.length === 0
            ? <div className="empty-state">
                No lesson notes yet. Click <strong>+ New Lesson Note</strong> to create one.
              </div>
            : <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>Week</th>
                      <th>Date</th>
                      <th>Topic</th>
                      <th>Subject</th>
                      <th>Class</th>
                      {isSupervisor && <th>Teacher</th>}
                      <th>Status</th>
                      <th style={{ width: 110 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {notes.map(n => {
                      const st = STATUS_BADGE[n.status] || STATUS_BADGE.draft;
                      return (
                        <tr key={n.id}>
                          <td style={{ fontWeight: 600 }}>{n.week_number || '—'}</td>
                          <td className="text-sm">{n.lesson_date || '—'}</td>
                          <td>
                            <strong>{n.topic}</strong>
                            {n.sub_topic && <div className="text-xs text-muted">{n.sub_topic}</div>}
                          </td>
                          <td>{n.subject_name || '—'}</td>
                          <td>{n.class_name || '—'}</td>
                          {isSupervisor && <td className="text-sm">{n.teacher_name || '—'}</td>}
                          <td><span className={'badge ' + st.cls}>{st.label}</span></td>
                          <td>
                            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(n)}>
                              {n.status === 'reviewed' && !isSupervisor ? 'View' : 'Open'}
                            </button>
                            {(isSupervisor || n.status !== 'reviewed') && (
                              <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(n.id)}>×</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
        }
      </div>
    </div>
  );
}

// ── Lesson Note Editor (full form) ─────────────────────
function LessonNoteEditor({ note, subjects, classes, isSupervisor, onClose, onSaved }) {
  const { currentUser, currentTerm } = useStore();
  const showToast = useStore(s => s.showToast);
  const [form, setForm] = useState(() => sanitizeForForm(note.id ? note : {
    week_number: '', lesson_date: new Date().toISOString().slice(0, 10),
    duration_minutes: 40, topic: '', sub_topic: '',
    references_text: '', tlms: '', objectives: '', rpk: '',
    introduction: '', presentation: '', activity: '',
    evaluation: '', closure: '', assignment: '', remarks: '',
    class_group_id: '', subject_id: '', term_id: currentTerm?.id || '',
    status: 'draft',
  }));
  const [saving, setSaving] = useState(false);
  const [showReview, setShowReview] = useState(false);

  const readOnly = !isSupervisor && form.status === 'reviewed';

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v ?? '' })); }

  async function save(submitForReview = false) {
    if (!form.topic.trim()) {
      showToast('Topic is required', 'warning');
      return;
    }
    setSaving(true);
    const payload = { ...form };
    if (submitForReview) payload.status = 'submitted';
    const res = await window.api.lessonNotes.save(payload);
    setSaving(false);
    if (res.ok) {
      showToast(submitForReview ? 'Submitted for review' : 'Saved', 'success');
      onSaved();
    } else {
      showToast(res.error || 'Could not save', 'error');
    }
  }

  async function exportPdf() {
    // Build a print-friendly view using window.print() with a temporary scoped layout.
    // (Full PDF generator could be added later — for now, use the print preview window.)
    window.print();
  }

  return (
    <div className="lesson-note-editor">
      <div className="card no-print">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>← Back to Notes</button>
            <h2 style={{ marginTop: 8 }}>
              {note.id ? 'Edit Lesson Note' : 'New Lesson Note'}
              {readOnly && <span className="badge badge-success" style={{ marginLeft: 10, fontSize: 11 }}>Locked — Reviewed</span>}
            </h2>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline" onClick={exportPdf}>🖨 Print</button>
            {!readOnly && (
              <>
                <button className="btn btn-outline" onClick={() => save(false)} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Draft'}
                </button>
                <button className="btn btn-primary" onClick={() => save(true)} disabled={saving}>
                  Save & Submit
                </button>
              </>
            )}
            {isSupervisor && note.id && (
              <button className="btn btn-success" onClick={() => setShowReview(true)}>
                ✓ Review
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card lesson-note-form" style={{ marginTop: 16 }}>
        {/* Header block: week, date, class, subject, duration */}
        <div className="form-row">
          <div className="form-group">
            <label>Week</label>
            <input type="number" min="1" max="20" value={form.week_number ?? ''}
              onChange={e => set('week_number', e.target.value)} disabled={readOnly} />
          </div>
          <div className="form-group">
            <label>Date</label>
            <input type="date" value={form.lesson_date ?? ''}
              onChange={e => set('lesson_date', e.target.value)} disabled={readOnly} />
          </div>
          <div className="form-group">
            <label>Duration (min)</label>
            <input type="number" min="10" max="180" value={form.duration_minutes ?? ''}
              onChange={e => set('duration_minutes', e.target.value)} disabled={readOnly} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Class</label>
            <select value={form.class_group_id ?? ''} onChange={e => set('class_group_id', e.target.value)} disabled={readOnly}>
              <option value="">— Select —</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Subject</label>
            <select value={form.subject_id ?? ''} onChange={e => set('subject_id', e.target.value)} disabled={readOnly}>
              <option value="">— Select —</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label>Topic <span className="text-danger">*</span></label>
            <input type="text" value={form.topic ?? ''}
              onChange={e => set('topic', e.target.value)} disabled={readOnly}
              placeholder="e.g. Photosynthesis" />
          </div>
          <div className="form-group" style={{ flex: 2 }}>
            <label>Sub-topic</label>
            <input type="text" value={form.sub_topic ?? ''}
              onChange={e => set('sub_topic', e.target.value)} disabled={readOnly}
              placeholder="e.g. Light-dependent reactions" />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label>References</label>
            <input type="text" value={form.references_text ?? ''}
              onChange={e => set('references_text', e.target.value)} disabled={readOnly}
              placeholder="e.g. Integrated Science for JHS, Bk 2 pp.45-52" />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Teaching/Learning Materials (TLMs)</label>
            <input type="text" value={form.tlms ?? ''}
              onChange={e => set('tlms', e.target.value)} disabled={readOnly}
              placeholder="e.g. Chart, leaves, magnifying glass" />
          </div>
        </div>

        <LessonNoteSection
          label="Behavioural Objectives"
          hint="By the end of the lesson, pupils will be able to..."
          value={form.objectives} onChange={v => set('objectives', v)} disabled={readOnly} />

        <LessonNoteSection
          label="Relevant Previous Knowledge (RPK)"
          hint="What pupils already know that connects to this lesson"
          value={form.rpk} onChange={v => set('rpk', v)} disabled={readOnly} />

        <LessonNoteSection
          label="Introduction"
          hint="How you'll open the lesson and engage pupils"
          value={form.introduction} onChange={v => set('introduction', v)} disabled={readOnly} />

        <LessonNoteSection
          label="Presentation"
          hint="Main teaching steps — concepts, examples, demonstrations"
          rows={8}
          value={form.presentation} onChange={v => set('presentation', v)} disabled={readOnly} />

        <LessonNoteSection
          label="Class Activity"
          hint="Hands-on or group activity for pupils during the lesson"
          value={form.activity} onChange={v => set('activity', v)} disabled={readOnly} />

        <LessonNoteSection
          label="Evaluation"
          hint="Questions/exercises to check understanding"
          value={form.evaluation} onChange={v => set('evaluation', v)} disabled={readOnly} />

        <LessonNoteSection
          label="Closure / Summary"
          hint="How you'll wrap up and consolidate the lesson"
          value={form.closure} onChange={v => set('closure', v)} disabled={readOnly} />

        <LessonNoteSection
          label="Assignment / Homework"
          value={form.assignment} onChange={v => set('assignment', v)} disabled={readOnly} />

        <LessonNoteSection
          label="Teacher's Remarks (post-lesson)"
          hint="Fill in after the lesson — what worked, what needs reteaching"
          value={form.remarks} onChange={v => set('remarks', v)} disabled={readOnly} />

        {/* Review block — visible if reviewed */}
        {note.id && form.status === 'reviewed' && note.review_comments && (
          <div className="card" style={{
            background: 'var(--success-bg, #dcfce7)',
            borderLeft: '3px solid var(--success)',
            marginTop: 16, padding: 14,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              ✓ Reviewed by {note.reviewer_name || 'Supervisor'}
            </div>
            <div className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{note.review_comments}</div>
            {note.reviewed_at && (
              <div className="text-xs text-muted" style={{ marginTop: 6 }}>
                {new Date(note.reviewed_at).toLocaleString()}
              </div>
            )}
          </div>
        )}
      </div>

      {showReview && (
        <ReviewModal
          noteId={note.id}
          existingComments={note.review_comments}
          onClose={() => setShowReview(false)}
          onSaved={() => { setShowReview(false); onSaved(); }}
        />
      )}
    </div>
  );
}

function LessonNoteSection({ label, hint, value, onChange, disabled, rows = 4 }) {
  return (
    <div className="lesson-note-section">
      <label>{label}{hint && <span className="lesson-note-hint">— {hint}</span>}</label>
      <textarea
        rows={rows} value={value ?? ''}
        onChange={e => onChange(e.target.value)} disabled={disabled}
      />
    </div>
  );
}

function ReviewModal({ noteId, existingComments, onClose, onSaved }) {
  const showToast = useStore(s => s.showToast);
  const [comments, setComments] = useState(existingComments || '');
  const [status, setStatus] = useState('reviewed');
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    const res = await window.api.lessonNotes.review({ id: noteId, status, comments });
    setSaving(false);
    if (res.ok) {
      showToast('Review saved', 'success');
      onSaved();
    } else {
      showToast(res.error || 'Could not save review', 'error');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Review Lesson Note</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form-group">
          <label>Decision</label>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="reviewed">✓ Approved (reviewed & accepted)</option>
            <option value="revise">↺ Needs revision</option>
          </select>
        </div>
        <div className="form-group">
          <label>Comments to teacher</label>
          <textarea rows="6" value={comments} onChange={e => setComments(e.target.value)}
            placeholder="Feedback, suggestions, or commendations…" />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Save Review'}
          </button>
        </div>
      </div>
    </div>
  );
}
