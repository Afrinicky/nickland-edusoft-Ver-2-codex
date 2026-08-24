// Nickland Edusoft mobile/web — persisted connection + session storage.
//
// One key/value surface, two backends:
//   • native — expo-secure-store (Keychain / Android Keystore).
//   • web    — localStorage. SecureStore is a native module and every call
//              throws on the web build, which silently signed people out on
//              every page reload. Browsers have no keychain to reach; the
//              same origin that serves the app is the only reader, which is
//              what the legacy parent portal already relied on.
//
// Every call is wrapped: storage failing is never fatal. A damaged Android
// keystore, or a browser with cookies/site data blocked, costs the user a
// re-login — it must never stop the app from starting.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const PREFIX = 'nickland.';   // web only — keeps the origin's keys ours

const web = {
  get(key) {
    try { return window.localStorage.getItem(PREFIX + key); } catch (_) { return null; }
  },
  set(key, value) {
    try { window.localStorage.setItem(PREFIX + key, value); return true; } catch (_) { return false; }
  },
  del(key) {
    try { window.localStorage.removeItem(PREFIX + key); } catch (_) {}
  },
};

const native = {
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

const backend = Platform.OS === 'web' ? web : native;

export const storage = {
  get: async (key) => backend.get(key),
  set: async (key, value) => backend.set(key, value),
  del: async (key) => backend.del(key),
};

export const isWeb = Platform.OS === 'web';
