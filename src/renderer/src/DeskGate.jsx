// Nickland Edusoft — the step before the application, in a browser.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// In the installed application this is nothing: `window.api` is already there,
// put on the window by the preload script, and this renders its children on the
// first frame. Every line below is about the browser.
//
// A browser has to answer two questions the office PC never has to ask —
// which school's computer am I talking to, and am I still signed in to it —
// and it has to answer them before App.jsx runs, because App.jsx starts by
// calling the API.

import React, { useEffect, useState } from 'react';
import { useStore } from './store/index.js';
import DeskConnect from './pages/DeskConnect.jsx';
import { isBrowser, deskHost, setDeskHost, deskToken, signedInUser, whenSignedOut, rememberHostInfo } from './lib/desk.js';

export default function DeskGate({ children }) {
  const login = useStore(s => s.login);
  // The installed application skips all of this, on the first render, with no
  // flash of a connect screen.
  const [phase, setPhase] = useState(() => (isBrowser() ? 'probing' : 'ready'));

  useEffect(() => {
    if (!isBrowser()) return undefined;

    let cancelled = false;

    // Signed out by the host — a revoked device, an expired token, an account
    // deactivated this morning. Send this browser back to the start rather
    // than letting every screen fail one at a time.
    whenSignedOut(() => { if (!cancelled) window.location.reload(); });

    (async () => {
      const host = deskHost();
      try {
        const res = await fetch(`${host}/api/v1/desk/info`);
        const info = await res.json();
        if (!info || !info.desk) throw new Error('not a school host');
        // The sign-in screen draws the school from this, so it is kept rather
        // than fetched a second time a moment later.
        rememberHostInfo(info);
      } catch (_) {
        if (!cancelled) setPhase('connect');
        return;
      }

      // Still holding a token from last time: put the person back where they
      // were. Permissions are re-read from the host rather than trusted from
      // this browser — an access level changed this morning takes effect on
      // the next page load, not the next sign-in.
      const user = signedInUser();
      if (deskToken() && user) {
        try { await login(user); } catch (_) { /* the sign-in screen will ask again */ }
      }
      if (!cancelled) setPhase('ready');
    })();

    return () => { cancelled = true; };
  }, []);

  if (phase === 'probing') {
    return (
      <div className="auth-bg">
        <div className="auth-card login-card" style={{ textAlign: 'center' }}>
          <div className="login-title">Nickland Edusoft</div>
          <p style={{ color: 'var(--text-muted, #667)', fontSize: 14 }}>Finding your school…</p>
        </div>
      </div>
    );
  }

  if (phase === 'connect') {
    return (
      <DeskConnect
        initial={deskHost()}
        onConnected={(url) => { setDeskHost(url); window.location.reload(); }}
      />
    );
  }

  return children;
}
