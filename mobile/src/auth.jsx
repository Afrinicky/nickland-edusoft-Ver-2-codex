// Auth + host context. Persists the connection (host URL + mode + school) and
// bearer token, and exposes the signed-in profile (role: parent | staff).
//
// Two connection modes:
//   • host  — a school desktop over LAN/tunnel (full features).
//   • cloud — the hosted portal over the internet (parent-only, read + notices).
//
// If nothing is saved yet the connection is discovered rather than asked for:
// a web build is usually served by the very thing it talks to, and a phone
// build can carry a default portal baked in (see src/config.js).
import React, { createContext, useContext, useEffect, useState } from 'react';
import { setConnection, api } from './api';
import { storage as store } from './storage';
import { discoverConnection } from './origin';
import { DEFAULT_SCHOOL_ID } from './config';

const AuthCtx = createContext(null);
export function useAuth() { return useContext(AuthCtx); }

export function AuthProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [host, setHost] = useState(null);
  const [mode, setMode] = useState('host');      // 'host' | 'cloud'
  const [schoolId, setSchoolId] = useState(null);
  const [token, setToken] = useState(null);
  const [profile, setProfile] = useState(null);  // { role, ... } from /me
  // Set on the web when the serving origin is a cloud portal hosting more than
  // one school: the connection is known, the school still has to be picked.
  const [detectedSchools, setDetectedSchools] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        let h = await store.get('host');
        let m = (await store.get('mode')) || 'host';
        let sid = await store.get('schoolId');

        // Nothing saved: work out where we are before asking anyone to type an
        // address. In a browser that is the serving origin; on the phone it is
        // the portal baked in at build time. A desktop host means full features
        // on the school Wi-Fi; a portal means parent mode, and a single school
        // can be adopted without a prompt.
        if (!h) {
          const found = await discoverConnection();
          if (found && found.mode === 'host') {
            h = found.baseUrl; m = 'host'; sid = null;
            await persistConnection(h, m, sid);
          } else if (found && found.mode === 'cloud') {
            const pinned = DEFAULT_SCHOOL_ID
              ? found.schools.find(s => String(s.school_id) === DEFAULT_SCHOOL_ID)
              : null;
            const only = pinned || (found.schools.length === 1 ? found.schools[0] : null);
            if (only) {
              h = found.baseUrl; m = 'cloud'; sid = String(only.school_id);
              await persistConnection(h, m, sid);
            } else {
              // Keep the address for the Connect screen's picker, but do not
              // treat it as connected — no school has been chosen yet.
              setDetectedSchools({ baseUrl: found.baseUrl, schools: found.schools });
            }
          }
        }

        if (h) {
          setHost(h); setMode(m); setSchoolId(sid);
          setConnection({ baseUrl: h, mode: m, schoolId: sid });
        }

        const t = h ? await store.get('token') : null;
        if (h && t) {
          try {
            const me = await api.me(t);
            setToken(t); setProfile(me);
          } catch (_) {
            await store.del('token');
          }
        }
      } catch (_) {
        // Storage can fail outright — a damaged Android keystore, or a browser
        // with site data blocked. Losing the saved connection is recoverable
        // (the user re-enters the school address); throwing here is not:
        // `ready` would never be set and the app would hang on the splash
        // screen forever.
      } finally { setReady(true); }
    })();
  }, []);

  async function persistConnection(url, m, sid) {
    await store.set('host', url);
    await store.set('mode', m);
    if (sid) await store.set('schoolId', String(sid)); else await store.del('schoolId');
  }

  // Connect to a school desktop over LAN/tunnel.
  async function saveHost(url) {
    setConnection({ baseUrl: url, mode: 'host' });
    setHost(url); setMode('host'); setSchoolId(null); setDetectedSchools(null);
    await persistConnection(url, 'host', null);
  }
  // Connect to the hosted portal over the internet for a chosen school.
  async function saveCloud(url, sid) {
    setConnection({ baseUrl: url, mode: 'cloud', schoolId: sid });
    setHost(url); setMode('cloud'); setSchoolId(sid); setDetectedSchools(null);
    await persistConnection(url, 'cloud', sid);
  }
  // Drop the saved connection and start over at the Connect screen.
  async function forgetConnection() {
    setConnection({ baseUrl: null, mode: 'host', schoolId: null });
    setHost(null); setMode('host'); setSchoolId(null);
    setToken(null); setProfile(null);
    await store.del('host'); await store.del('mode');
    await store.del('schoolId'); await store.del('token');
  }
  async function signIn(t, prof) {
    setToken(t); setProfile(prof);
    await store.set('token', t);
  }
  async function signOut() {
    try { if (token) await api.logout(token); } catch (_) {}
    setToken(null); setProfile(null);
    await store.del('token');
  }

  return (
    <AuthCtx.Provider value={{
      ready, host, mode, schoolId, token, profile, detectedSchools,
      saveHost, saveCloud, forgetConnection, signIn, signOut,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}
