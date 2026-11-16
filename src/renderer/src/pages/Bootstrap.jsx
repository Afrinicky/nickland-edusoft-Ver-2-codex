// Nickland Edusoft — First-Run Screen: attaching this computer to its school
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// This screen used to create a school. It asked for a name, a username and a
// password, wrote a Super Admin into the local database and the installation
// was its own school from then on.
//
// That is gone, and the reason is worth stating because it removed more than a
// screen. A school is now set up ONLINE by the Super Admin, who registers it,
// does the initial configuration and hands the school's administrator their
// first credentials. If every school is created in one place, a desktop never
// needs to be able to create one — and the whole question of what happens when
// a desktop and the cloud disagree about who the school's administrator is
// never arises.
//
// So this screen asks the one question that is left: which school is this
// computer, and prove it. The answer is the administrator's own Edusoft email
// and password, which activation exchanges for this machine's own device
// credential, the school's id and a signed licence
// (electron/licence/refresh.js → POST /api/v1/activate).
import React, { useState } from 'react';

export default function Bootstrap({ onDone }) {
  const [form, setForm] = useState({ portal: '', email: '', password: '' });
  const [schools, setSchools] = useState(null);   // set when one email runs several
  const [schoolId, setSchoolId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function activate(e) {
    e.preventDefault();
    setError('');
    if (!form.portal.trim()) return setError('Enter the address your school was given.');
    if (!form.email.trim()) return setError('Enter the administrator’s email address.');
    if (!form.password) return setError('Enter the password.');

    setLoading(true);
    // The address has to be stored before activating: activation posts to it.
    const configured = await window.api.cloud.configure({ baseUrl: form.portal.trim() });
    if (configured && configured.ok === false) {
      setLoading(false);
      return setError(configured.error || 'That address was not accepted.');
    }

    const res = await window.api.licence.activate({
      email: form.email.trim(),
      password: form.password,
      schoolId: schoolId || undefined,
    });
    setLoading(false);

    // One email, several schools — asked rather than guessed.
    if (res && res.choose) {
      setSchools(res.schools || []);
      return setError(res.message || 'Which school is this computer for?');
    }
    if (!res || !res.ok) {
      return setError((res && (res.message || res.error))
        || 'That did not work. Check the details and try again.');
    }
    onDone();
  }

  return (
    <div className="auth-bg">
      <div className="auth-card bootstrap-card">
        <div className="auth-logo-row">
          <div className="auth-app-badge">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="#1B3A6B" />
              <path d="M8 22L16 10L24 22H8Z" fill="#C9961A" />
            </svg>
          </div>
          <div>
            <div className="auth-app-name">Nickland Edusoft</div>
            <div className="auth-app-sub">by Nickland Sales</div>
          </div>
        </div>

        <div className="bootstrap-welcome">
          <h1>Connect this computer to your school</h1>
          <p>Sign in with the administrator’s Edusoft details. This happens once.</p>
        </div>

        <form onSubmit={activate} className="auth-form">
          <div className="form-group">
            <label>School address</label>
            <input type="text" value={form.portal ?? ''} onChange={update('portal')}
              placeholder="https://yourschool.edusoft.gh" autoFocus />
          </div>
          <div className="form-group">
            <label>Administrator email</label>
            <input type="email" value={form.email ?? ''} onChange={update('email')}
              placeholder="head@yourschool.edu.gh" autoComplete="username" />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={form.password ?? ''} onChange={update('password')}
              autoComplete="current-password" />
          </div>

          {/* Only drawn when the cloud says this email runs more than one school. */}
          {schools && schools.length > 0 && (
            <div className="form-group">
              <label>Which school</label>
              <select className="select" value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}>
                <option value="">Choose…</option>
                {schools.map((s) => (
                  <option key={s.school_id || s.id} value={s.school_id || s.id}>
                    {s.name || s.school_id || s.id}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? 'Connecting…' : 'Connect this computer'}
          </button>
        </form>

        <div className="auth-footer-note">
          Your school is set up by Nickland. If you do not have these details yet, ask
          whoever arranged your subscription.
        </div>
      </div>
    </div>
  );
}
