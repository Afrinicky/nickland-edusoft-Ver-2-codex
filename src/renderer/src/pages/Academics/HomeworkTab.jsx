// Academics → Homework: set assignments per class/subject, mark them, and let
// graded work count towards the continuous-assessment class score.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

const STATUSES = [
  { key: 'pending',   label: 'Pending' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'late',      label: 'Late' },
  { key: 'missing',   label: 'Not submitted' },
  { key: 'exempt',    label: 'Exempt' },
];

export default function HomeworkTab() {
  const { classes, subjects, currentTerm, currentUser, showToast, can } = useStore();
  const canEdit = can('academics', 'edit');
  const [classId, setClassId] = useState('');
  const [list, setList] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(null);   // homework being created/edited
  const [marking, setMarking] = useState(null);   // homework id being marked

  useEffect(() => { if (classes?.length && !classId) setClassId(classes[0].id); }, [classes]);

  async function load() {
    if (!classId) return;
    setList(await window.api.homework.listClass(classId, showAll, currentTerm?.id));
  }
  useEffect(() => { load(); }, [classId, showAll, currentTerm?.id]);

  async function remove(h) {
    if (!window.confirm(`Delete "${h.title}"? Any marks it contributed to the class score will also be removed.`)) return;
    await window.api.homework.delete(h.id);
    showToast('Homework deleted.', 'success');
    load();
  }

  if (marking) {
    return <MarkingSheet homeworkId={marking} onBack={() => { setMarking(null); load(); }} canEdit={canEdit} showToast={showToast} />;
  }

  return (
    <div>
      <div className="filters-row" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <select className="input" value={classId} onChange={e => setClassId(Number(e.target.value))} style={{ minWidth: 200 }}>
          {(classes || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)' }}>
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          Show all (including past)
        </label>
        <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 13 }}>
          {currentTerm?.label || 'Current term'}
        </span>
        {canEdit && (
          <button className="btn btn-primary" onClick={() => setEditing({ classId })}>+ Set homework</button>
        )}
      </div>

      {list.length === 0 ? (
        <div className="card" style={{ color: 'var(--muted)' }}>
          No homework for this class {showAll ? '' : 'due soon'}. {canEdit && 'Use “Set homework” to add one.'}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Title</th><th>Subject</th><th>Due</th><th className="text-center">Marks</th>
                <th className="text-center">Submitted</th><th className="text-center">Not in</th>
                <th className="text-center">Average</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.map(h => (
                <tr key={h.id}>
                  <td>
                    <strong>{h.title}</strong>
                    {h.status === 'draft' && <span className="badge" style={{ marginLeft: 6 }}>Draft</span>}
                    {h.description && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{h.description}</div>}
                  </td>
                  <td>{h.subject_name || '—'}</td>
                  <td>{h.due_date || '—'}</td>
                  <td className="text-center">
                    {h.is_graded
                      ? <span title="Counts towards the class score">/{h.max_marks} ✓</span>
                      : <span style={{ color: 'var(--muted)' }}>Not graded</span>}
                  </td>
                  <td className="text-center">{h.submitted_count}</td>
                  <td className="text-center" style={{ color: h.missing_count ? 'var(--danger)' : undefined }}>{h.missing_count}</td>
                  <td className="text-center">{h.average_mark ?? '—'}</td>
                  <td className="text-right" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setMarking(h.id)}>
                      {h.is_graded ? 'Mark' : 'Track'}
                    </button>
                    {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ ...h, classId: h.class_group_id })}>Edit</button>}
                    {canEdit && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => remove(h)}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <HomeworkForm
          initial={editing} subjects={subjects || []} currentTerm={currentTerm} currentUser={currentUser}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function HomeworkForm({ initial, subjects, currentTerm, currentUser, onClose, onSaved, showToast }) {
  const [f, setF] = useState({
    id: initial.id || null,
    classId: initial.classId,
    subjectId: initial.subject_id || '',
    title: initial.title || '',
    description: initial.description || '',
    dueDate: initial.due_date || '',
    graded: initial.max_marks != null,
    maxMarks: initial.max_marks ?? 10,
    status: initial.status || 'published',
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  async function save() {
    if (!f.title.trim()) { showToast('A title is required.', 'error'); return; }
    if (f.graded && !f.subjectId) { showToast('Choose a subject — graded homework counts towards that subject\'s class score.', 'error'); return; }
    const r = await window.api.homework.save({
      id: f.id, classId: f.classId, termId: currentTerm?.id,
      subjectId: f.subjectId ? Number(f.subjectId) : null,
      title: f.title, description: f.description, dueDate: f.dueDate || null,
      maxMarks: f.graded ? Number(f.maxMarks) : null,
      status: f.status, teacherId: currentUser?.staffId || null,
    });
    if (r.ok) { showToast(f.id ? 'Homework updated.' : 'Homework set.', 'success'); onSaved(); }
    else showToast(r.error || 'Could not save.', 'error');
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>{f.id ? 'Edit homework' : 'Set homework'}</h3></div>
        <div className="modal-body">
          <label className="label">Title</label>
          <input className="input" value={f.title} onChange={e => set('title', e.target.value)}
            placeholder="e.g. Maths exercise 4, questions 1–10" />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <div>
              <label className="label">Subject</label>
              <select className="input" value={f.subjectId} onChange={e => set('subjectId', e.target.value)}>
                <option value="">— none —</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Due date</label>
              <input className="input" type="date" value={f.dueDate} onChange={e => set('dueDate', e.target.value)} />
            </div>
          </div>

          <label className="label" style={{ marginTop: 12 }}>Details (optional)</label>
          <textarea className="input" rows={3} value={f.description} onChange={e => set('description', e.target.value)} />

          <div style={{ marginTop: 14, padding: 12, background: 'var(--bg)', borderRadius: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              <input type="checkbox" checked={f.graded} onChange={e => set('graded', e.target.checked)} />
              Graded — marks count towards the class score
            </label>
            {f.graded && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="label" style={{ margin: 0 }}>Total marks</span>
                <input className="input" type="number" min="1" style={{ width: 100 }}
                  value={f.maxMarks} onChange={e => set('maxMarks', e.target.value)} />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Appears in Class Scores as an assessment and feeds the end-of-term report.
                </span>
              </div>
            )}
          </div>

          <label className="label" style={{ marginTop: 12 }}>Visibility</label>
          <select className="input" value={f.status} onChange={e => set('status', e.target.value)}>
            <option value="published">Published — parents can see it</option>
            <option value="draft">Draft — not shown to parents</option>
          </select>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>{f.id ? 'Save changes' : 'Set homework'}</button>
        </div>
      </div>
    </div>
  );
}

function MarkingSheet({ homeworkId, onBack, canEdit, showToast }) {
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);

  async function load() {
    const d = await window.api.homework.sheet(homeworkId);
    setData(d);
    setRows(d ? d.students.map(s => ({ ...s })) : []);
  }
  useEffect(() => { load(); }, [homeworkId]);

  function setRow(id, patch) {
    setRows(rs => rs.map(r => (r.student_id === id ? { ...r, ...patch } : r)));
  }
  function markAll(status) { setRows(rs => rs.map(r => ({ ...r, status }))); }

  async function save() {
    setSaving(true);
    try {
      const r = await window.api.homework.saveMarks({
        homeworkId,
        entries: rows.map(r => ({ student_id: r.student_id, status: r.status, marks: r.marks, remarks: r.remarks })),
      });
      if (r.ok) {
        showToast(r.linked_to_assessment
          ? 'Marks saved and added to the class score.'
          : 'Submissions saved.', 'success');
        load();
      } else showToast(r.error || 'Could not save.', 'error');
    } finally { setSaving(false); }
  }

  if (!data) return <div className="card">Loading…</div>;
  const h = data.homework;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" onClick={onBack}>‹ Back</button>
        <div>
          <strong>{h.title}</strong>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {[h.subject_name, h.due_date ? `Due ${h.due_date}` : null,
              h.is_graded ? `Out of ${h.max_marks}` : 'Not graded'].filter(Boolean).join(' · ')}
          </div>
        </div>
        {canEdit && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => markAll('submitted')}>All submitted</button>
            <button className="btn btn-ghost btn-sm" onClick={() => markAll('missing')}>All not submitted</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        )}
      </div>

      {h.is_graded && (
        <div className="card" style={{ marginBottom: 12, borderLeft: '4px solid var(--gold, #C9961A)' }}>
          <div style={{ fontSize: 13 }}>
            These marks are recorded as the assessment <strong>“Homework: {h.title}”</strong> for {h.subject_name}.
            Saving updates each pupil's class score, subject total and end-of-term report. Pupils marked
            <strong> Not submitted</strong> are scored 0.
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>#</th><th>Index No.</th><th>Name</th><th>Status</th>
              {h.is_graded && <th className="text-center">Mark /{h.max_marks}</th>}
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.student_id}>
                <td>{i + 1}</td>
                <td>{r.index_number}</td>
                <td>{r.name}</td>
                <td>
                  <select className="input" value={r.status} disabled={!canEdit}
                    onChange={e => setRow(r.student_id, { status: e.target.value })} style={{ minWidth: 140 }}>
                    {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </td>
                {h.is_graded && (
                  <td className="text-center">
                    <input className="input" type="number" min="0" max={h.max_marks} disabled={!canEdit}
                      style={{ width: 90, textAlign: 'center' }}
                      value={r.marks ?? ''}
                      onChange={e => setRow(r.student_id, { marks: e.target.value === '' ? null : e.target.value })} />
                  </td>
                )}
                <td>
                  <input className="input" value={r.remarks || ''} disabled={!canEdit}
                    onChange={e => setRow(r.student_id, { remarks: e.target.value })} placeholder="Optional" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
