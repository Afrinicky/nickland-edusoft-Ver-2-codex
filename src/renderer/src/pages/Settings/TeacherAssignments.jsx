// Nickland Edusoft — Teaching Assignments
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// One screen answering the question a head teacher actually asks: who is
// answerable for each class, and who has been given nothing yet. Assignments
// could only be reached before by opening Settings → Users, finding a person
// and clicking a small icon on their row — so a class with no class teacher
// was invisible until something that needed one failed.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import Avatar from '../../components/Avatar.jsx';
import UserAssignmentsModal from './UserAssignmentsModal.jsx';

export default function TeacherAssignments() {
  const showToast = useStore(s => s.showToast);
  const [classTeachers, setClassTeachers] = useState([]);
  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const [ct, us] = await Promise.all([
        window.api.auth.classTeachers(),
        window.api.auth.listUsers(),
      ]);
      setClassTeachers(ct || []);
      const staffUsers = (us || []).filter(u => u.is_active && u.staff_id);
      setUsers(staffUsers);
      // One call per teacher: a school has tens of staff, not thousands, and
      // this beats inventing a bulk channel for one screen.
      const map = {};
      await Promise.all(staffUsers.map(async (u) => {
        try { map[u.id] = await window.api.auth.listUserAssignments(u.id); }
        catch (_) { map[u.id] = []; }
      }));
      setAssignments(map);
    } catch (e) {
      showToast('Could not load assignments', 'error');
    }
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  const unstaffed = classTeachers.filter(c => !c.staff_id);

  function describe(rows) {
    if (!rows || !rows.length) return null;
    return rows.map(a => {
      const cls = a.class_name || 'every class';
      const sub = a.subject_name || 'all subjects';
      const label = a.class_name && !a.subject_name ? cls
        : !a.class_name ? `${sub} — every class`
        : `${sub} — ${cls}`;
      return { id: a.id, label, classTeacher: !!a.is_class_teacher };
    });
  }

  return (
    <div>
      <div className="card" style={{ background: 'var(--info-bg)', border: '1px solid var(--info)' }}>
        <strong>Teaching assignments</strong>
        <div className="text-sm" style={{ marginTop: 6, lineHeight: 1.7 }}>
          What each teacher can open. A teacher given a class sees that whole class; one given a
          subject sees that subject in the classes that teach it; and both can apply at once.
          Anything they have not been given is hidden from them, not merely refused when they
          try it. Every class should have exactly one <strong>class teacher</strong> — the person
          answerable for the register, the canteen sheet and the end-of-term report.
        </div>
      </div>

      {!loading && unstaffed.length > 0 && (
        <div className="card" style={{ marginTop: 16, border: '1px solid var(--warning, #C9961A)' }}>
          <div className="section-title">
            Classes with no class teacher
            <span className="badge badge-warning" style={{ marginLeft: 8 }}>{unstaffed.length}</span>
          </div>
          <div className="text-sm text-muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
            Nobody can take the canteen or sign off the end-of-term report for these classes
            until somebody is marked their class teacher.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {unstaffed.map(c => (
              <span key={c.class_id} className="badge badge-muted">{c.class_name}</span>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title">Class teachers</div>
        {loading
          ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
          : <div className="table-wrap">
              <table>
                <thead><tr><th>Class</th><th>Class teacher</th><th></th></tr></thead>
                <tbody>
                  {classTeachers.map(c => (
                    <tr key={c.class_id}>
                      <td><strong>{c.class_name}</strong></td>
                      <td>
                        {c.staff_id
                          ? `${c.surname} ${c.first_name}`
                          : <span className="text-muted">Nobody yet</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {c.user_id && (
                          <button className="btn btn-ghost btn-sm"
                            onClick={() => setEditing(users.find(u => u.id === c.user_id) || null)}>
                            Change
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        }
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title">Every teacher</div>
        {loading
          ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
          : users.length === 0
            ? <div className="empty-state">No staff accounts yet. Add them in Users &amp; Logins.</div>
            : <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th></th><th>Name</th><th>Designation</th><th>Assigned to</th><th></th></tr>
                  </thead>
                  <tbody>
                    {users.map(u => {
                      const rows = describe(assignments[u.id]);
                      return (
                        <tr key={u.id}>
                          <td style={{ width: 50 }}>
                            <Avatar person={{
                              surname: u.full_name, first_name: '', photo_path: u.photo_path,
                            }} size="sm" />
                          </td>
                          <td><strong>{u.full_name}</strong></td>
                          <td className="text-sm text-muted">{u.designation_name || '—'}</td>
                          <td>
                            {!rows
                              ? <span className="text-muted text-sm">
                                  Nothing yet — they can open almost nothing
                                </span>
                              : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {rows.map(r => (
                                    <span key={r.id}
                                      className={'badge ' + (r.classTeacher ? 'badge-primary' : 'badge-muted')}>
                                      {r.label}{r.classTeacher ? ' · class teacher' : ''}
                                    </span>
                                  ))}
                                </div>
                            }
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(u)}>Manage</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
        }
      </div>

      {editing && (
        <UserAssignmentsModal user={editing} onClose={() => { setEditing(null); refresh(); }} />
      )}
    </div>
  );
}
