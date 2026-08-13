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
        const h = await SecureStore.getItemAsync('host');
        const m = (await SecureStore.getItemAsync('mode')) || 'host';
        const sid = await SecureStore.getItemAsync('schoolId');
        const t = await SecureStore.getItemAsync('token');
        if (h) {
          setHost(h); setMode(m); setSchoolId(sid);
          setConnection({ baseUrl: h, mode: m, schoolId: sid });
        }
        if (h && t) {
          try {
            const me = await api.me(t);
            setToken(t); setProfile(me);
          } catch (_) {
            await SecureStore.deleteItemAsync('token');
          }
        }
      } finally { setReady(true); }
    })();
  }, []);

  // Connect to a school desktop over LAN/tunnel.
  async function saveHost(url) {
    setConnection({ baseUrl: url, mode: 'host' });
    setHost(url); setMode('host'); setSchoolId(null);
    await SecureStore.setItemAsync('host', url);
    await SecureStore.setItemAsync('mode', 'host');
    await SecureStore.deleteItemAsync('schoolId');
  }
  // Connect to the hosted portal over the internet for a chosen school.
  async function saveCloud(url, sid) {
    setConnection({ baseUrl: url, mode: 'cloud', schoolId: sid });
    setHost(url); setMode('cloud'); setSchoolId(sid);
    await SecureStore.setItemAsync('host', url);
    await SecureStore.setItemAsync('mode', 'cloud');
    await SecureStore.setItemAsync('schoolId', String(sid));
  }
  async function signIn(t, prof) {
    setToken(t); setProfile(prof);
    await SecureStore.setItemAsync('token', t);
  }
  async function signOut() {
    try { if (token) await api.logout(token); } catch (_) {}
    setToken(null); setProfile(null);
    await SecureStore.deleteItemAsync('token');
  }

  return (
    <AuthCtx.Provider value={{ ready, host, mode, schoolId, token, profile, saveHost, saveCloud, signIn, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}
