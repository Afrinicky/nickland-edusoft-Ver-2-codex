// Working out what to talk to, without making anyone type an address.
//
// Three deployments, three answers:
//   • Served by a school desktop (http://192.168.1.20:4747) — the page's own
//     origin answers /api/v1/info. Host mode: teachers and parents, full
//     features, works with the internet down.
//   • Served by the portal itself — the origin answers /api/v1/portal/schools,
//     or does after a same-origin /api rewrite (how the Vercel build reaches
//     the API on Render). Cloud mode: parents, read-only.
//   • The phone app, or a web build with no API on its own origin — fall back
//     to EXPO_PUBLIC_PORTAL_URL, baked in at build time.
//
// Which endpoint answers decides the mode, so a build never has to be told.
import { Platform } from 'react-native';
import { DEFAULT_PORTAL_URL } from './config';

export function webOrigin() {
  if (Platform.OS !== 'web') return null;
  try {
    const o = window.location.origin;
    return o && o !== 'null' ? o.replace(/\/+$/, '') : null;
  } catch (_) { return null; }
}

// True when the page is on HTTPS: the browser will then refuse plain-HTTP
// requests to a LAN host as mixed content, so the Connect screen says so
// rather than letting the fetch fail with a mystery network error.
export function isSecureOrigin() {
  if (Platform.OS !== 'web') return false;
  try { return window.location.protocol === 'https:'; } catch (_) { return false; }
}

async function probe(baseUrl, path, ms = 6000) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
  try {
    const res = await fetch(`${baseUrl}/api/v1${path}`, { signal: ctl ? ctl.signal : undefined });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.ok ? data : null;
  } catch (_) {
    return null;
  } finally { if (timer) clearTimeout(timer); }
}

// One question — "what are you?" — answered by /info on both a desktop host
// and the portal. A host names its school; the portal says it is one and lists
// its tenants. The /portal/schools fallback is for a portal deployed before
// /info was public there.
async function identify(baseUrl) {
  const info = await probe(baseUrl, '/info');
  if (info && !info.portal && info.school) return { baseUrl, mode: 'host', school: info.school };
  if (info && info.portal) return { baseUrl, mode: 'cloud', schools: info.schools || [] };

  const portal = await probe(baseUrl, '/portal/schools');
  if (portal) return { baseUrl, mode: 'cloud', schools: portal.schools || [] };
  return null;
}

// Resolves to { baseUrl, mode:'host', school } | { baseUrl, mode:'cloud', schools } | null.
export async function discoverConnection() {
  const origin = webOrigin();
  if (origin) {
    const found = await identify(origin);
    if (found) return found;
  }
  if (DEFAULT_PORTAL_URL && DEFAULT_PORTAL_URL !== origin) {
    const found = await identify(DEFAULT_PORTAL_URL);
    if (found) return found;
  }
  return null;
}
