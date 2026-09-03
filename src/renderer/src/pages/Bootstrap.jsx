// Nickland Edusoft — First-Run Bootstrap Screen
// One-time admin account creation before the app is usable
import React, { useState } from 'react';

export default function Bootstrap({ onDone }) {
  const [form, setForm] = useState({ fullName: '', username: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const update = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.fullName.trim()) return setError('Full name is required.');
    if (!form.username.trim()) return setError('Username is required.');
    if (form.password.length < 6) return setError('Password must be at least 6 characters.');
    if (form.password !== form.confirm) return setError('Passwords do not match.');
    setLoading(true);
    const res = await window.api.auth.bootstrap({
      fullName: form.fullName.trim(),
      username: form.username.trim().toLowerCase(),
      password: form.password,
    });
    setLoading(false);
    if (!res.ok) return setError(res.error || 'Setup failed. Please try again.');
    onDone();
  };

  return (
    <div className="auth-bg">
      <div className="auth-card bootstrap-card">
        <div className="auth-logo-row">
          <div className="auth-app-badge">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="#1B3A6B"/>
              <path d="M8 22L16 10L24 22H8Z" fill="#C9961A"/>
            </svg>
          </div>
          <div>
            <div className="auth-app-name">Nickland Edusoft</div>
            <div className="auth-app-sub">by Nickland Sales</div>
          </div>
        </div>

        <div className="bootstrap-welcome">
          <h1>Welcome! Let's get started.</h1>
          <p>Create the Administrator account for this installation. This only happens once.</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>Administrator Full Name</label>
            <input type="text" value={form.fullName ?? ''} onChange={update('fullName')}
              placeholder="e.g. John Mensah" autoFocus />
          </div>
          <div className="form-group">
            <label>Username</label>
            <input type="text" value={form.username ?? ''} onChange={update('username')}
              placeholder="e.g. admin" autoComplete="username" />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={form.password ?? ''} onChange={update('password')}
              placeholder="Minimum 6 characters" autoComplete="new-password" />
          </div>
          <div className="form-group">
            <label>Confirm Password</label>
            <input type="password" value={form.confirm ?? ''} onChange={update('confirm')}
              placeholder="Re-enter password" autoComplete="new-password" />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? 'Setting up…' : 'Create Account & Continue'}
          </button>
        </form>

        <div className="auth-footer-note">
          After setup, you can create accounts for all other staff in Settings → Users.
        </div>
      </div>
      <div className="auth-copyright">© 2026 Nickland Sales. All rights reserved.</div>
    </div>
  );
}
