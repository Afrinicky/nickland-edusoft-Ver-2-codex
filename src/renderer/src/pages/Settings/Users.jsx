// Nickland Edusoft — Users & Logins
// Create and manage user accounts. Photo uploader included.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/index.js';
import { sanitizeForForm } from '../../lib/formSafe.js';
import PhotoUploader from '../../components/PhotoUploader.jsx';
import Modal from '../../components/Modal.jsx';
import UserAssignmentsModal from './UserAssignmentsModal.jsx';

export default function Users() {
  const showToast = useStore(s => s.showToast);
  const { currentUser } = useStore();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [editing, setEditing] = useState(null);
  const [assignModal, setAssignModal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(null);   // user whose password an admin is setting
  const [requests, setRequests] = useState([]);       // staff waiting on a reset approval
  const [granted, setGranted] = useState(null);       // the code to read out, shown once

  async function refresh() {
    setLoading(true);
    const [u, d, s, r] = await Promise.all([
      window.api.auth.listUsers(),
      window.api.auth.listDesignations(),
      window.api.staff.list({}),
      window.api.auth.listPasswordResets({ status: 'pending' }),
    ]);
    setUsers(u);
    setDesignations(d);
    setStaffList(s);
    setRequests(r.ok ? r.requests : []);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  // Approving does not set a password — it mints a single-use code the person
  // redeems themselves. Shown once here, because only its hash is stored.
  async function decide(req, approve) {
    const res = await window.api.auth.decidePasswordReset({ requestId: req.id, approve });
    if (!res.ok) { showToast(res.error || 'Could not record the decision', 'error'); return; }
    if (approve) setGranted({ username: res.username, code: res.code, hours: res.expiresInHours });
    else showToast(`Request from ${req.username} declined`, 'success');
    refresh();
  }

  // Opens a modal rather than window.prompt(): Electron does not implement
  // prompt(), so this button threw and did nothing at all.
  function resetPassword(user) { setResetting(user); }

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

      {requests.length > 0 && (
        <div className="card" style={{ marginTop: 16, borderLeft: '3px solid var(--warning, #C9961A)' }}>
          <div className="section-header">
            <div className="section-title">
              Password requests waiting
              <span className="badge badge-warning" style={{ marginLeft: 8 }}>{requests.length}</span>
            </div>
          </div>
          <div className="text-sm text-muted" style={{ marginBottom: 10, lineHeight: 1.6 }}>
            Approving does not set a password. It produces a 6-digit code to give the person —
            they choose their own password with it. Check who you are speaking to before you approve.
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Username</th><th>Asked</th><th>From</th><th>Note</th><th></th></tr>
              </thead>
              <tbody>
                {requests.map(r => (
                  <tr key={r.id}>
                    <td><strong>{r.full_name || '—'}</strong>
                      <div className="text-xs text-muted">{r.designation || '—'}</div>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.username}</td>
                    <td className="text-sm text-muted">
                      {r.requested_at ? new Date(r.requested_at.replace(' ', 'T') + 'Z').toLocaleString() : '—'}
                    </td>
                    <td className="text-sm text-muted">{r.requested_from || 'desktop'}</td>
                    <td className="text-sm text-muted">{r.reason || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-primary btn-sm" onClick={() => decide(r, true)}>Approve</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => decide(r, false)}>Decline</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
                          <button className="btn btn-ghost btn-sm"
                            onClick={() => navigate(`/settings/access?tab=individuals&user=${u.id}`)}
                            title="Set this person's access">🔐 Access</button>
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
      {assignModal && (
        <UserAssignmentsModal user={assignModal} onClose={() => setAssignModal(null)} />
      )}
      {resetting && (
        <AdminResetModal
          user={resetting}
          onClose={() => setResetting(null)}
          onDone={(username) => {
            setResetting(null);
            showToast(`Password reset for ${username}. They must change it at next sign-in.`, 'success');
          }}
        />
      )}
      {granted && (
        <Modal title="Approved — give them this code" size="sm" onClose={() => setGranted(null)}
          footer={<button className="btn btn-primary" onClick={() => setGranted(null)}>Done</button>}>
          <p className="text-sm" style={{ lineHeight: 1.6 }}>
            Read this code to <strong>{granted.username}</strong>. They enter it on the sign-in
            screen under <em>"I have an approval code"</em> and choose their own password.
          </p>
          <div style={{
            fontFamily: 'monospace', fontSize: 34, fontWeight: 700, letterSpacing: 6,
            textAlign: 'center', padding: '18px 0', color: 'var(--primary)',
          }}>{granted.code}</div>
          <p className="text-sm text-muted" style={{ lineHeight: 1.6 }}>
            It works once and expires in {granted.hours} hours. It is not stored anywhere you can
            read it again — if it is lost, decline the request and ask them to send a new one.
          </p>
        </Modal>
      )}
    </div>
  );
}

// An administrator setting a temporary password for somebody. Distinct from the
// approval flow: this is the admin choosing the password, so the account is
// flagged to change it at next sign-in.
function AdminResetModal({ user, onClose, onDone }) {
  const showToast = useStore(s => s.showToast);
  const [pw, setPw] = useState({ next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setError('');
    if (pw.next.length < 6) return setError('Password must be at least 6 characters.');
    if (pw.next !== pw.confirm) return setError('The two passwords do not match.');
    setBusy(true);
    const res = await window.api.auth.resetPassword({ targetUserId: user.id, newPassword: pw.next });
    setBusy(false);
    if (!res.ok) { setError(res.error || 'Reset failed.'); return; }
    onDone(res.username || user.username);
  }

  return (
    <Modal title={`Reset password — ${user.full_name}`} size="sm" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Reset password'}
        </button>
      </>}>
      <p className="text-sm text-muted" style={{ lineHeight: 1.6, marginBottom: 12 }}>
        Set a temporary password for <strong>{user.username}</strong>. They will be asked to
        choose their own the next time they sign in.
      </p>
      <div className="form-group">
        <label>New password</label>
        <input type="password" value={pw.next} autoFocus
          onChange={e => setPw(p => ({ ...p, next: e.target.value }))}
          placeholder="At least 6 characters" />
      </div>
      <div className="form-group">
        <label>Confirm password</label>
        <input type="password" value={pw.confirm}
          onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))}
          placeholder="Type it again" />
      </div>
      {error && <div className="auth-error">{error}</div>}
    </Modal>
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
