// Nickland Edusoft — Users & Logins
// Create and manage user accounts. Photo uploader included.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { sanitizeForForm } from '../../lib/formSafe.js';
import PhotoUploader from '../../components/PhotoUploader.jsx';
import UserPermissionsModal from './UserPermissionsModal.jsx';
import UserAssignmentsModal from './UserAssignmentsModal.jsx';

export default function Users() {
  const showToast = useStore(s => s.showToast);
  const { currentUser } = useStore();
  const [users, setUsers] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [editing, setEditing] = useState(null);
  const [permModal, setPermModal] = useState(null);
  const [assignModal, setAssignModal] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const [u, d, s] = await Promise.all([
      window.api.auth.listUsers(),
      window.api.auth.listDesignations(),
      window.api.staff.list({}),
    ]);
    setUsers(u);
    setDesignations(d);
    setStaffList(s);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  async function resetPassword(user) {
    const newPw = prompt(`Reset password for ${user.full_name}.\n\nEnter a new temporary password (min 6 characters).\nThe user will be required to change it at next login.`);
    if (!newPw) return;
    if (newPw.length < 6) { showToast('Password must be at least 6 characters', 'warning'); return; }
    const res = await window.api.auth.resetPassword({
      actorUserId: currentUser?.id,
      targetUserId: user.id,
      newPassword: newPw,
    });
    if (res.ok) {
      showToast(`Password reset for ${res.username}. They must change it at next login.`, 'success');
    } else {
      showToast(res.error || 'Reset failed', 'error');
    }
  }

  async function toggleActive(user) {
    const verb = user.is_active ? 'deactivate' : 'activate';
    if (!confirm(`${verb.charAt(0).toUpperCase() + verb.slice(1)} ${user.full_name}?`)) return;
    await window.api.auth.updateUser({
      id: user.id,
      fullName: user.full_name,
      designationId: user.designation_id,
      isActive: user.is_active ? 0 : 1,
    });
    showToast(`User ${verb}d`, 'success');
    refresh();
  }

  return (
    <div className="users-settings">
      <div className="card" style={{ background: 'var(--info-bg)', borderLeft: '3px solid var(--info)' }}>
        <strong>About user accounts</strong>
        <div className="text-sm" style={{ marginTop: 6, lineHeight: 1.6 }}>
          Each person who logs into Nickland Edusoft needs an account. Choose a designation
          (Proprietor, Head Teacher, Teacher, Bursar, Administrator, etc.) — this controls
          which parts of the app they can access. Link the account to a staff record if applicable.
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-header">
          <div className="section-title">User Accounts ({users.length})</div>
          <button className="btn btn-primary" onClick={() => setEditing({})}>+ Add User</button>
        </div>
        {loading
          ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
          : users.length === 0
            ? <div className="empty-state">No users yet. Click "+ Add User" to create one.</div>
            : <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th>Name</th>
                      <th>Username</th>
                      <th>Designation</th>
                      <th>Linked Staff</th>
                      <th>Last Login</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td style={{ width: 50 }}>
                          {u.photo_path
                            ? <img src={`file://${u.photo_path}`} alt="" style={{
                                width: 36, height: 36, borderRadius: '50%',
                                objectFit: 'cover', border: '1px solid var(--border)',
                              }} />
                            : <div style={{
                                width: 36, height: 36, borderRadius: '50%',
                                background: 'var(--surface-2)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 14, color: 'var(--muted)',
                              }}>
                                {(u.full_name || '?').charAt(0).toUpperCase()}
                              </div>
                          }
                        </td>
                        <td>
                          <strong>{u.full_name}</strong>
                          {u.id === currentUser?.id && (
                            <span className="badge badge-info" style={{ marginLeft: 6, fontSize: 10 }}>You</span>
                          )}
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{u.username}</td>
                        <td>{u.designation_name || '—'}</td>
                        <td className="text-sm text-muted">{u.staff_full_name || '—'}</td>
                        <td className="text-sm text-muted">
                          {u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}
                        </td>
                        <td>
                          {u.is_active
                            ? <span className="badge badge-success">Active</span>
                            : <span className="badge badge-muted">Disabled</span>
                          }
                        </td>
                        <td>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(u)}>Edit</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setPermModal(u)} title="Edit per-user permissions">🔐 Perms</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setAssignModal(u)} title="Class & subject assignments">📚 Classes</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => resetPassword(u)}>Reset PW</button>
                          {u.id !== currentUser?.id && (
                            <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(u)}>
                              {u.is_active ? 'Disable' : 'Enable'}
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

      {editing !== null && (
        <UserFormModal
          user={editing}
          designations={designations}
          staffList={staffList}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); showToast('Saved', 'success'); }}
        />
      )}
      {permModal && (
        <UserPermissionsModal user={permModal} onClose={() => setPermModal(null)} />
      )}
      {assignModal && (
        <UserAssignmentsModal user={assignModal} onClose={() => setAssignModal(null)} />
      )}
    </div>
  );
}

function UserFormModal({ user, designations, staffList, onClose, onSaved }) {
  const showToast = useStore(s => s.showToast);
  const isNew = !user.id;
  const [form, setForm] = useState(() => sanitizeForForm({
    id: user.id || null,
    full_name: user.full_name || '',
    username: user.username || '',
    designation_id: user.designation_id || '',
    staff_id: user.staff_id || '',
    password: '',
    confirm_password: '',
    photo_path: user.photo_path || '',
  }));
  const [saving, setSaving] = useState(false);

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v ?? '' })); }

  async function save() {
    if (!form.full_name.trim()) return showToast('Full name required', 'warning');
    if (isNew) {
      if (!form.username.trim()) return showToast('Username required', 'warning');
      if (!form.password) return showToast('Password required', 'warning');
      if (form.password.length < 6) return showToast('Password must be at least 6 characters', 'warning');
      if (form.password !== form.confirm_password) return showToast('Passwords do not match', 'warning');
    } else {
      if (form.password && form.password !== form.confirm_password) {
        return showToast('Passwords do not match', 'warning');
      }
      if (form.password && form.password.length < 6) {
        return showToast('Password must be at least 6 characters', 'warning');
      }
    }

    setSaving(true);
    if (isNew) {
      const res = await window.api.auth.createUser({
        username: form.username.trim(),
        fullName: form.full_name.trim(),
        password: form.password,
        designationId: form.designation_id || null,
        staffId: form.staff_id || null,
      });
      setSaving(false);
      if (res.ok) onSaved();
      else showToast(res.error || 'Failed to create user', 'error');
    } else {
      const res = await window.api.auth.updateUser({
        id: form.id,
        fullName: form.full_name.trim(),
        designationId: form.designation_id || null,
        isActive: user.is_active,
        newPassword: form.password || null,
      });
      setSaving(false);
      if (res.ok) onSaved();
      else showToast(res.error || 'Failed to update user', 'error');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{isNew ? 'Add User' : `Edit User — ${user.full_name}`}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {!isNew && (
          <div style={{ marginBottom: 18, padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 8 }}>
            <PhotoUploader
              entityType="users"
              entityId={form.id}
              currentPath={form.photo_path}
              onChange={(newPath) => set('photo_path', newPath)}
              label="Profile photo"
              size={90}
              shape="circle"
            />
          </div>
        )}

        <div className="form-group">
          <label>Full Name <span className="text-danger">*</span></label>
          <input type="text" value={form.full_name ?? ''}
            onChange={e => set('full_name', e.target.value)}
            placeholder="e.g. Mr. Kwame Mensah" autoFocus />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Username {isNew && <span className="text-danger">*</span>}</label>
            <input type="text" value={form.username ?? ''}
              onChange={e => set('username', e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
              disabled={!isNew}
              placeholder="e.g. kmensah" />
            {!isNew && <div className="form-hint">Username cannot be changed after creation</div>}
          </div>
          <div className="form-group">
            <label>Designation / Role</label>
            <select value={form.designation_id ?? ''} onChange={e => set('designation_id', e.target.value)}>
              <option value="">— Select a role —</option>
              {designations.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <div className="form-hint">Determines what this user can access</div>
          </div>
        </div>

        <div className="form-group">
          <label>Linked Staff Record (optional)</label>
          <select value={form.staff_id ?? ''} onChange={e => set('staff_id', e.target.value)}>
            <option value="">— No staff link —</option>
            {staffList.map(s => (
              <option key={s.id} value={s.id}>
                {s.surname} {s.first_name} ({s.staff_number || 'no number'})
              </option>
            ))}
          </select>
          <div className="form-hint">If this person is on staff, link to their record for unified profile</div>
        </div>

        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div className="text-sm" style={{ fontWeight: 600, marginBottom: 10 }}>
            {isNew ? 'Set Password' : 'Change Password (leave blank to keep current)'}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{isNew ? 'Password' : 'New Password'} {isNew && <span className="text-danger">*</span>}</label>
              <input type="password" value={form.password ?? ''}
                onChange={e => set('password', e.target.value)}
                placeholder="At least 6 characters" />
            </div>
            <div className="form-group">
              <label>Confirm Password</label>
              <input type="password" value={form.confirm_password ?? ''}
                onChange={e => set('confirm_password', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Create User' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
