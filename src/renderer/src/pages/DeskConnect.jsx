// Nickland Edusoft — finding the school's computer.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Shown only in a browser, and only when this copy of the application does not
// yet know which school's computer to talk to. Opening the host's own address
// never reaches this screen: it is served BY that computer, so it already
// knows. This is for the two cases where it cannot:
//
//   • the installed application launched as a client of another PC, before
//     anybody has told it which one;
//   • a copy served from somewhere else — the hosted one — that has to be
//     pointed at a school.
//
// It exists because the alternative is an application that shows an empty
// screen and a console error, and a school that has to be told over the phone
// what a network address is.

import React, { useEffect, useState } from 'react';
import { schoolsToChooseFrom, setDeskSchool } from '../lib/desk.js';

// Accept what somebody actually types. "192.168.1.20" is a valid answer to
// "where is the office PC" and should not have to be "http://192.168.1.20:4747"
// before this application will speak to it.
function normalise(input) {
  let value = String(input || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  value = value.replace(/\/+$/, '');
  // No port given and it is not an https address: the host listens on 4747.
  try {
    const url = new URL(value);
    if (!url.port && url.protocol === 'http:') url.port = '4747';
    return url.origin;
  } catch (_) {
    return value;
  }
}

export default function DeskConnect({ initial, onConnected }) {
  const [address, setAddress] = useState(initial || '');
  const [state, setState] = useState('idle');   // idle | testing | failed
  const [error, setError] = useState('');
  const [found, setFound] = useState(null);
  // Only ever non-empty on the hosted service, which holds more than one
  // school and cannot know which of them this person belongs to.
  const [schools, setSchools] = useState(null);

  useEffect(() => {
    let cancelled = false;
    schoolsToChooseFrom().then((list) => {
      if (!cancelled && list && list.length) setSchools(list);
    });
    return () => { cancelled = true; };
  }, []);

  if (schools) {
    return (
      <div className="auth-bg">
        <div className="auth-card login-card">
          <div className="login-title">Which school?</div>
          <p style={{ color: 'var(--text-muted, #667)', fontSize: 14, lineHeight: 1.6, marginTop: 4 }}>
            Choose yours. You will only be asked once on this device.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
            {schools.map((s) => (
              <button
                key={s.id || s}
                type="button"
                className="btn btn-outline btn-full"
                onClick={() => { setDeskSchool(s.id || s); window.location.reload(); }}
              >
                {s.name || s.id || s}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  async function test(e) {
    e.preventDefault();
    const url = normalise(address);
    if (!url) { setError('Type the address of the school’s computer.'); return; }

    setState('testing'); setError(''); setFound(null);
    try {
      // Eight seconds. An address on the wrong subnet does not refuse, it
      // simply never answers, and a person watching a spinner needs to be told
      // that rather than left with it.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${url}/api/v1/desk/info`, { signal: controller.signal });
      clearTimeout(timer);

      const info = await res.json();
      if (!info || !info.desk) throw new Error('That address answered, but it is not a Nickland Edusoft school.');
      setFound({ url, school: info.school });
      setState('idle');
      onConnected(url, info);
    } catch (err) {
      setState('failed');
      setError(
        err && err.name === 'AbortError'
          ? 'Nothing answered at that address. Check that the school’s computer is switched on, that it is on this same network, and that the office application is running.'
          : (err && err.message) || 'Could not reach that address.'
      );
    }
  }

  return (
    <div className="auth-bg">
      <div className="auth-card login-card">
        <div className="login-title">Connect to your school</div>

        <p style={{ color: 'var(--text-muted, #667)', fontSize: 14, lineHeight: 1.6, marginTop: 4 }}>
          This application works from the school’s own computer. Type its address —
          the office PC shows it under <strong>Settings → Mobile App</strong>.
        </p>

        <form onSubmit={test} className="auth-form">
          <div className="form-group">
            <label>School computer address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="192.168.1.20"
              autoFocus
              spellCheck={false}
            />
          </div>

          {error && <div className="auth-error">{error}</div>}
          {found && <div className="auth-notice">Connected to {found.school}.</div>}

          <button type="submit" className="btn btn-primary btn-full" disabled={state === 'testing'}>
            {state === 'testing' ? 'Looking…' : 'Connect'}
          </button>
        </form>

        <p style={{ color: 'var(--text-muted, #889)', fontSize: 12.5, lineHeight: 1.6, marginTop: 18 }}>
          Nothing is stored on this device but the address and your sign-in.
          The school’s records stay on the school’s computer.
        </p>
      </div>
    </div>
  );
}
