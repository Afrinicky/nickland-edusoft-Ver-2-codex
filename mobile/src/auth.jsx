// Auth + host context. Persists the host URL and bearer token in secure
// storage and exposes the signed-in profile (role: parent | staff).
import React, { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { setBaseUrl, api } from './api';

const AuthCtx = createContext(null);
export function useAuth() { return useContext(AuthCtx); }

export function AuthProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [host, setHost] = useState(null);
  const [token, setToken] = useState(null);
  const [profile, setProfile] = useState(null); // { role, ... } from /me

  useEffect(() => {
    (async () => {
      try {
        const h = await SecureStore.getItemAsync('host');
        const t = await SecureStore.getItemAsync('token');
        if (h) { setHost(h); setBaseUrl(h); }
        if (h && t) {
          setBaseUrl(h);
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

  async function saveHost(url) {
    setBaseUrl(url); setHost(url);
    await SecureStore.setItemAsync('host', url);
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
    <AuthCtx.Provider value={{ ready, host, token, profile, saveHost, signIn, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}
