// Nickland Edusoft — Login Screen
import React, { useState, useEffect } from 'react';
import { useStore } from '../store/index.js';

export default function Login({ onLogin }) {
  const settings = useStore(s => s.settings);
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const school = settings.school || {};
  const branding = settings.branding || {};
  const logoPath = branding.school_logo_path;
  const logoSrc = logoPath ? `file://${logoPath}` : null;
  const schoolName = school.school_name || 'Your School Name';
  const schoolMotto = school.school_motto || '';

  const update = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.username || !form.password) return setError('Please enter your username and password.');
    setLoading(true);
    const res = await window.api.auth.login({ username: form.username.trim(), password: form.password });
    setLoading(false);
    if (!res.ok) return setError(res.error || 'Login failed.');

    // If admin/proprietor reset the user's password, force a change on first login
    if (res.user.mustChangePassword) {
      const newPw = prompt(
        `Your password has been reset by an administrator.\n\n` +
        `For security, please choose a new password now (minimum 6 characters):`
      );
      if (!newPw || newPw.length < 6) {
        setError('You must set a new password to continue.');
        return;
      }
      const confirmPw = prompt('Confirm your new password:');
      if (newPw !== confirmPw) {
        setError('Passwords did not match. Please try again.');
        return;
      }
      const chg = await window.api.auth.changePassword({
        userId: res.user.id,
        oldPassword: form.password,
        newPassword: newPw,
      });
      if (!chg.ok) {
        setError(chg.error || 'Could not change password.');
        return;
      }
      res.user.mustChangePassword = false;
    }

    onLogin(res.user);
  };

  return (
    <div className="auth-bg">
      <div className="auth-card login-card">
        {/* School identity */}
        <div className="login-school-header">
          {logoSrc
            ? <img src={logoSrc} alt="School Logo" className="login-school-logo" />
            : <div className="login-school-logo-placeholder">
                <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
                  <rect width="52" height="52" rx="12" fill="#E8EFF9"/>
                  <path d="M14 36L26 18L38 36H14Z" fill="#1B3A6B" opacity="0.4"/>
                </svg>
              </div>
          }
          <div>
            <div className="login-school-name">{schoolName}</div>
            {schoolMotto && <div className="login-school-motto">"{schoolMotto}"</div>}
          </div>
        </div>

        <div className="login-divider" />

        <div className="login-title">Sign in to continue</div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>Username</label>
            <input type="text" value={form.username ?? ''} onChange={update('username')}
              placeholder="Enter your username" autoFocus autoComplete="username" />
          </div>
          <div className="form-group">
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <input type={showPass ? 'text' : 'password'} value={form.password ?? ''}
                onChange={update('password')} placeholder="Enter your password"
                autoComplete="current-password"
                style={{ paddingRight: 40 }} />
              <button type="button" className="pass-toggle" onClick={() => setShowPass(v => !v)}>
                {showPass ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="login-powered">
          Powered by <strong>Nickland Edusoft</strong> · © 2026 Nickland Sales
        </div>
      </div>
    </div>
  );
}
