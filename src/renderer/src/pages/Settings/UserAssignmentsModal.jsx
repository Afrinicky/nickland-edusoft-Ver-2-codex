// Nickland Edusoft — Teacher Class/Subject Assignments
// Lets an Admin assign which classes and subjects a teacher is responsible for.
// Used to gate teacher access to specific class data.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

export default function UserAssignmentsModal({ user, onClose }) {
  const showToast = useStore(s => s.showToast);
  const classes = useStore(s => s.classes);
  const currentTerm = useStore(s => s.currentTerm);
  const [subjects, setSubjects] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [classGroupId, setClassGroupId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [isClassTeacher, setIsClassTeacher] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const [subs, assigns] = await Promise.all([
      window.api.scores.listSubjects(),
      window.api.auth.listUserAssignments(user.id),
    ]);
    setSubjects(subs);
    setAssignments(assigns);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [user.id]);

  async function add() {
    if (!classGroupId) {
      showToast('Pick a class', 'warning');
      return;
    }
    setSaving(true);
    const res = await window.api.auth.addUserAssignment({
      userId: user.id,
      classGroupId: parseInt(classGroupId),
      subjectId: subjectId ? parseInt(subjectId) : null,
      termId: currentTerm?.id || null,
      isClassTeacher,
    });
    setSaving(false);
    if (res.ok) {
      showToast('Assignment added', 'success');
      setClassGroupId(''); setSubjectId(''); setIsClassTeacher(false);
      refresh();
    } else {
      showToast(res.error || 'Could not add assignment', 'error');
    }
  }

  async function remove(id) {
    if (!confirm('Remove this assignment?')) return;
    const res = await window.api.auth.removeUserAssignment(id);
    if (res.ok) { showToast('Removed', 'success'); refresh(); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Class & Subject Assignments — {user.full_name}</div>
            <div className="text-sm text-muted">
              Determines which classes / subjects this teacher has access to.
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {!user.staff_id && (
          <div className="card" style={{
            background: 'var(--warning-bg, #FEF3C7)',
            borderLeft: '3px solid var(--warning)', marginBottom: 14, padding: 14,
          }}>
            <strong>Heads up:</strong> This user is not linked to a staff record yet.
            Edit the user first and link them to staff — only then can you assign classes/subjects.
          </div>
        )}

        {user.staff_id && (
          <>
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="section-title" style={{ marginBottom: 10 }}>Add Assignment</div>
              <div className="form-row">
                <div className="form-group">
                  <label>Class <span className="text-danger">*</span></label>
                  <select value={classGroupId} onChange={e => setClassGroupId(e.target.value)}>
                    <option value="">— Select Class —</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Subject (optional)</label>
                  <select value={subjectId} onChange={e => setSubjectId(e.target.value)}>
                    <option value="">— All subjects in class —</option>
                    {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <div className="form-hint">Leave blank to assign all subjects in the class</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={isClassTeacher}
                    onChange={e => setIsClassTeacher(e.target.checked)} />
                  <span>Is class teacher (responsible for the whole class)</span>
                </label>
                <div style={{ flex: 1 }} />
                <button className="btn btn-primary" onClick={add} disabled={saving || !classGroupId}>
                  {saving ? 'Adding…' : '+ Add Assignment'}
                </button>
              </div>
            </div>

            <div className="section-title" style={{ marginBottom: 10 }}>
              Current Assignments ({assignments.length})
            </div>
            {loading
              ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
              : assignments.length === 0
                ? <div className="empty-state">No assignments yet</div>
                : <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Class</th>
                          <th>Subject</th>
                          <th>Term</th>
                          <th>Role</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {assignments.map(a => (
                          <tr key={a.id}>
                            <td><strong>{a.class_name || '—'}</strong></td>
                            <td>{a.subject_name || <span className="text-muted">All subjects</span>}</td>
                            <td className="text-sm text-muted">{a.term_label || '—'}</td>
                            <td>
                              {a.is_class_teacher
                                ? <span className="badge badge-primary">Class Teacher</span>
                                : <span className="badge badge-muted">Subject</span>
                              }
                            </td>
                            <td>
                              <button className="btn btn-ghost btn-sm" onClick={() => remove(a.id)}>×</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
            }
          </>
        )}

        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
