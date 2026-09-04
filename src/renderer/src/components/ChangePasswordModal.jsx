// Nickland Edusoft — Change your own password.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Reachable from the sidebar rather than from Settings, because Settings is
// behind the `settings` permission and a Class Teacher does not have it. Your
// own password is not a module — everybody can change theirs.
import React, { useState } from 'react';
import Modal from './Modal.jsx';
import { useStore } from '../store/index.js';

const MIN_PASSWORD = 6;

export default function ChangePasswordModal({ onClose }) {
  const showToast = useStore(s => s.showToast);
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  async function save() {
    setError('');
    if (!form.current) return setError('Enter your current password.');
    if (form.next.length < MIN_PASSWORD) return setError(`New password must be at least ${MIN_PASSWORD} characters.`);
    if (form.next !== form.confirm) return setError('The two new passwords do not match.');
    if (form.next === form.current) return setError('The new password must be different from the current one.');
    setBusy(true);
    // The account comes from the signed-in session in the main process, never
    // from here — this modal cannot be pointed at somebody else.
    const res = await window.api.auth.changePassword({
      oldPassword: form.current,
      newPassword: form.next,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error || 'Could not change your password.');
    showToast('Your password has been changed', 'success');
    onClose();
  }

  return (
    <Modal title="Change your password" size="sm" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </>}>
      <div className="form-group">
        <label>Current password</label>
        <input type="password" value={form.current} onChange={set('current')} autoFocus
          autoComplete="current-password" placeholder="The one you signed in with" />
      </div>
      <div className="form-group">
        <label>New password</label>
        <input type="password" value={form.next} onChange={set('next')}
          autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD} characters`} />
      </div>
      <div className="form-group">
        <label>Confirm new password</label>
        <input type="password" value={form.confirm} onChange={set('confirm')}
          autoComplete="new-password" placeholder="Type it again" />
      </div>
      {error && <div className="auth-error">{error}</div>}
      <p className="text-sm text-muted" style={{ marginTop: 12, lineHeight: 1.6 }}>
        Forgotten it instead? Sign out and use <em>"Forgot your password?"</em> on the sign-in
        screen — the Super Admin or the Proprietor approves the reset.
      </p>
    </Modal>
  );
}
