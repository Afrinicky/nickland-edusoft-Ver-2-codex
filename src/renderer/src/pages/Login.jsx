// Nickland Edusoft — Login Screen
import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../store/index.js';
import { mediaUrl } from '../lib/media.js';

// Screens this component can be on. Sign-in is the only one anybody reaches
// without asking for it.
//   signin   — username + password
//   newpass  — an administrator reset this account; choose a password to go on
//   forgot   — ask for a reset, then wait for it to be approved
//   claim    — approved: enter the code the approver read out, and a new password
const MIN_PASSWORD = 6;

export default function Login({ onLogin }) {
  const settings = useStore(s => s.settings);
  const [stage, setStage] = useState('signin');
  const [form, setForm] = useState({ username: '', password: '' });
  const [pw, setPw] = useState({ next: '', confirm: '', code: '', reason: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [resetState, setResetState] = useState('none');   // none|pending|approved|denied|expired
  const pollRef = useRef(null);

  const school = settings.school || {};
  const branding = settings.branding || {};
  const logoPath = branding.school_logo_path;
  const logoSrc = logoPath ? mediaUrl(logoPath) : null;
  const schoolName = school.school_name || 'Your School Name';
  const schoolMotto = school.school_motto || '';

  const update = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const updatePw = k => e => setPw(p => ({ ...p, [k]: e.target.value }));

  // While a request is outstanding, watch for the approver's decision so the
  // person waiting at the screen is moved on rather than left guessing.
  useEffect(() => {
    if (stage !== 'forgot' || resetState !== 'pending') return undefined;
    const tick = async () => {
      try {
        const r = await window.api.auth.passwordResetStatus({ username: form.username.trim() });
        if (r.status === 'approved') {
          setResetState('approved');
          setNotice('Approved. Enter the code the approver gave you, then choose your new password.');
          setStage('claim');
        } else if (r.status === 'denied') {
          setResetState('denied');
        } else if (r.status === 'expired') {
          setResetState('expired');
        }
      } catch (_) { /* the poll is a convenience; the buttons still work */ }
    };
    pollRef.current = setInterval(tick, 4000);
    return () => clearInterval(pollRef.current);
  }, [stage, resetState, form.username]);

  function goto(next) {
    setError(''); setNotice('');
    setStage(next);
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.username || !form.password) return setError('Please enter your username and password.');
    setLoading(true);
    const res = await window.api.auth.login({ username: form.username.trim(), password: form.password });
    setLoading(false);
    if (!res.ok) return setError(res.error || 'Login failed.');

    // An administrator reset this account, so a password has to be chosen
    // before going any further. This used to call window.prompt(), which
    // Electron does not implement — the call threw, sign-in stopped dead, and
    // every account created through Settings → Users (they all start with this
    // flag set) was locked out. Only the very first administrator, created by
    // the bootstrap screen without the flag, could get in.
    if (res.user.mustChangePassword) {
      setNotice('Your password was set by an administrator. Choose your own to continue.');
      setPw({ next: '', confirm: '', code: '', reason: '' });
      setStage('newpass');
      return;
    }
    onLogin(res.user);
  };

  // Choose a new password on first sign-in after an administrator reset.
  const handleNewPassword = async (e) => {
    e.preventDefault();
    setError('');
    if (pw.next.length < MIN_PASSWORD) return setError(`Password must be at least ${MIN_PASSWORD} characters.`);
    if (pw.next !== pw.confirm) return setError('The two passwords do not match.');
    setLoading(true);
    const chg = await window.api.auth.changePassword({
      oldPassword: form.password,
      newPassword: pw.next,
    });
    if (!chg.ok) { setLoading(false); return setError(chg.error || 'Could not change password.'); }
    // Sign in again so the session carries the new password, not the old one.
    const res = await window.api.auth.login({ username: form.username.trim(), password: pw.next });
    setLoading(false);
    if (!res.ok) return setError(res.error || 'Password changed — please sign in again.');
    onLogin(res.user);
  };

  // Ask an Administrator or Proprietor to approve a reset.
  const handleForgot = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.username.trim()) return setError('Enter your username.');
    setLoading(true);
    const r = await window.api.auth.requestPasswordReset({
      username: form.username.trim(), reason: pw.reason, from: 'desktop',
    });
    setLoading(false);
    if (!r.ok) return setError(r.error || 'Could not send the request.');
    setResetState('pending');
    setNotice('Request sent. An Administrator or Proprietor will approve it, then give you a 6-digit code.');
  };

  // Redeem the approval and set the password.
  const handleClaim = async (e) => {
    e.preventDefault();
    setError('');
    if (!pw.code.trim()) return setError('Enter the approval code.');
    if (pw.next.length < MIN_PASSWORD) return setError(`Password must be at least ${MIN_PASSWORD} characters.`);
    if (pw.next !== pw.confirm) return setError('The two passwords do not match.');
    setLoading(true);
    const r = await window.api.auth.completePasswordReset({
      username: form.username.trim(), code: pw.code.trim(), newPassword: pw.next,
    });
    setLoading(false);
    if (!r.ok) return setError(r.error || 'Could not reset the password.');
    setForm(f => ({ ...f, password: '' }));
    setPw({ next: '', confirm: '', code: '', reason: '' });
    setResetState('none');
    setStage('signin');
    setNotice('Your password has been changed. Sign in with it now.');
  };

  const passwordFields = (
    <>
      <div className="form-group">
        <label>New password</label>
        <input type="password" value={pw.next} onChange={updatePw('next')}
          placeholder={`At least ${MIN_PASSWORD} characters`} autoComplete="new-password" autoFocus />
      </div>
      <div className="form-group">
        <label>Confirm new password</label>
        <input type="password" value={pw.confirm} onChange={updatePw('confirm')}
          placeholder="Type it again" autoComplete="new-password" />
      </div>
    </>
  );

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

        <div className="login-title">
          {stage === 'signin'  && 'Sign in to continue'}
          {stage === 'newpass' && 'Choose your password'}
          {stage === 'forgot'  && 'Reset your password'}
          {stage === 'claim'   && 'Set your new password'}
        </div>

        {notice && <div className="auth-notice">{notice}</div>}

        {stage === 'signin' && (
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

            <div className="login-alt-actions">
              <button type="button" className="btn-link" onClick={() => goto('forgot')}>
                Forgot your password?
              </button>
              <button type="button" className="btn-link" onClick={() => goto('claim')}>
                I have an approval code
              </button>
            </div>
          </form>
        )}

        {stage === 'newpass' && (
          <form onSubmit={handleNewPassword} className="auth-form">
            {passwordFields}
            {error && <div className="auth-error">{error}</div>}
            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
              {loading ? 'Saving…' : 'Save and continue'}
            </button>
            <div className="login-alt-actions">
              <button type="button" className="btn-link" onClick={() => { setForm(f => ({ ...f, password: '' })); goto('signin'); }}>
                ← Back to sign in
              </button>
            </div>
          </form>
        )}

        {stage === 'forgot' && (
          <form onSubmit={handleForgot} className="auth-form">
            <div className="form-group">
              <label>Username</label>
              <input type="text" value={form.username ?? ''} onChange={update('username')}
                placeholder="Your username" autoFocus autoComplete="username"
                disabled={resetState === 'pending'} />
            </div>
            {resetState !== 'pending' && (
              <div className="form-group">
                <label>Note for the approver (optional)</label>
                <input type="text" value={pw.reason} onChange={updatePw('reason')}
                  placeholder="e.g. forgot it over the holidays" />
              </div>
            )}

            {resetState === 'pending' && (
              <div className="auth-notice">
                Waiting for approval… you can leave this screen open. Once it is approved you
                will be asked for the code.
              </div>
            )}
            {resetState === 'denied' && (
              <div className="auth-error">That request was declined. Speak to your Administrator.</div>
            )}
            {resetState === 'expired' && (
              <div className="auth-error">That approval expired before it was used. Send a new request.</div>
            )}
            {error && <div className="auth-error">{error}</div>}

            {resetState !== 'pending' && (
              <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                {loading ? 'Sending…' : 'Send request'}
              </button>
            )}

            <div className="login-alt-actions">
              <button type="button" className="btn-link" onClick={() => { setResetState('none'); goto('claim'); }}>
                I already have a code
              </button>
              <button type="button" className="btn-link" onClick={() => { setResetState('none'); goto('signin'); }}>
                ← Back to sign in
              </button>
            </div>
          </form>
        )}

        {stage === 'claim' && (
          <form onSubmit={handleClaim} className="auth-form">
            <div className="form-group">
              <label>Username</label>
              <input type="text" value={form.username ?? ''} onChange={update('username')}
                placeholder="Your username" autoComplete="username" />
            </div>
            <div className="form-group">
              <label>Approval code</label>
              <input type="text" value={pw.code} onChange={updatePw('code')}
                placeholder="6-digit code from your Administrator"
                inputMode="numeric" maxLength={6} />
            </div>
            {passwordFields}
            {error && <div className="auth-error">{error}</div>}
            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
              {loading ? 'Saving…' : 'Set new password'}
            </button>
            <div className="login-alt-actions">
              <button type="button" className="btn-link" onClick={() => { setResetState('none'); goto('signin'); }}>
                ← Back to sign in
              </button>
            </div>
          </form>
        )}

        <div className="login-powered">
          Powered by <strong>Nickland Edusoft</strong> · © 2026 Nickland Sales
        </div>
      </div>
    </div>
  );
}
