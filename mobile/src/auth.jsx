// Auth + host context. Persists the connection (host URL + mode + school) and
// bearer token in secure storage and exposes the signed-in profile
// (role: parent | staff).
//
// Two connection modes:
//   • host  — a school desktop over LAN/tunnel (full features).
//   • cloud — the hosted portal over the internet (parent-only, read + notices).
import React, { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { setConnection, api } from './api';

const AuthCtx = createContext(null);
export function useAuth() { return useContext(AuthCtx); }

// Secure storage, wrapped so a failure is never fatal. expo-secure-store is a
// native module: it is absent on the web build, and on a handful of Android
// devices with a damaged keystore every call throws. Signing in again is a far
// better outcome than an app that will not start.
const store = {
  async get(key) {
    try { return await SecureStore.getItemAsync(key); } catch (_) { return null; }
  },
  async set(key, value) {
    try { await SecureStore.setItemAsync(key, value); return true; } catch (_) { return false; }
  },
  async del(key) {
    try { await SecureStore.deleteItemAsync(key); } catch (_) {}
  },
};

export function AuthProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [host, setHost] = useState(null);
  const [mode, setMode] = useState('host');      // 'host' | 'cloud'
  const [schoolId, setSchoolId] = useState(null);
  const [token, setToken] = useState(null);
  const [profile, setProfile] = useState(null);  // { role, ... } from /me

  useEffect(() => {
    (async () => {
      try {
        const h = await store.get('host');
        const m = (await store.get('mode')) || 'host';
        const sid = await store.get('schoolId');
        const t = await store.get('token');
        if (h) {
          setHost(h); setMode(m); setSchoolId(sid);
          setConnection({ baseUrl: h, mode: m, schoolId: sid });
        }
        if (h && t) {
          try {
            const me = await api.me(t);
            setToken(t); setProfile(me);
          } catch (_) {
            await store.del('token');
          }
        }
      } catch (_) {
        // Secure storage can fail outright — a damaged Android keystore, or a
        // platform where it does not exist at all. Losing the saved connection
        // is recoverable (the user re-enters the school address); throwing here
        // is not: `ready` would never be set and the app would hang on the
        // splash screen forever.
      } finally { setReady(true); }
    })();
  }, []);

  // Connect to a school desktop over LAN/tunnel.
  async function saveHost(url) {
    setConnection({ baseUrl: url, mode: 'host' });
    setHost(url); setMode('host'); setSchoolId(null);
    await store.set('host', url);
    await store.set('mode', 'host');
    await store.del('schoolId');
  }
  // Connect to the hosted portal over the internet for a chosen school.
  async function saveCloud(url, sid) {
    setConnection({ baseUrl: url, mode: 'cloud', schoolId: sid });
    setHost(url); setMode('cloud'); setSchoolId(sid);
    await store.set('host', url);
    await store.set('mode', 'cloud');
    await store.set('schoolId', String(sid));
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
    <AuthCtx.Provider value={{ ready, host, mode, schoolId, token, profile, saveHost, saveCloud, signIn, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}
