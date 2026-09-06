// Nickland Edusoft — the office application, in a browser.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The other end of electron/server/desk_api.js. It builds `window.api` from
// the one API surface (electron/api-surface.js) and gives it the network to
// travel on instead of Electron IPC — so every screen in this application runs
// unchanged in a browser, calling the same channels, answered by the same
// handlers on the school's own computer.
//
// Nothing in src/renderer/src/pages knows this file exists. That is the test
// of whether this was done properly: 467 calls across 94 screens, and not one
// of them asks which machine it is on.
//
// ── The four places a browser genuinely differs ─────────────────────────────
//
//   1. Signing in. The window tells the host who is at it; a browser is handed
//      a token and carries it. So auth:login and auth:logout are answered here
//      rather than sent, and auth:bootstrap-status is asked of a public route
//      because it is the question that comes BEFORE having a token.
//   2. Choosing a file. There is no disk to name a file on, so the file is
//      sent and the host answers with a path — which is what every handler
//      already expects.
//   3. Saving and opening a file. The host produced it and answers with a
//      handle; opening it is opening a URL.
//   4. Things that only mean something on the office PC — opening a folder,
//      restoring a backup. The host says so, in words, and the screen shows
//      what it says instead of failing silently.

import { buildApi } from '../../../../electron/api-surface.js';

// Where the host is. Same origin when the host is serving this page (the
// school Wi-Fi case, and the hosted case), and otherwise whatever the person
// typed on the Connect screen or the desktop thin client was launched with.
const STORED_HOST = 'edusoft.desk.host';
const STORED_TOKEN = 'edusoft.desk.token';
const STORED_USER = 'edusoft.desk.user';
// Only the hosted service needs this. A school's own computer holds one school
// and does not ask which; a service on the internet holds many and cannot
// guess. It is the one thing the two backends differ about before sign-in.
const STORED_SCHOOL = 'edusoft.desk.school';

function read(key) {
  try { return window.localStorage.getItem(key) || ''; } catch (_) { return ''; }
}
function write(key, value) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch (_) { /* a browser with storage switched off still works, per session */ }
}

// An address the desktop thin client was launched with beats anything
// remembered, because that install exists to talk to that host.
function launchHost() {
  if (typeof window === 'undefined') return '';
  const injected = window.__EDUSOFT_HOST__;
  if (injected) return String(injected).replace(/\/+$/, '');
  // A build pinned to one API at build time (the hosted deployment).
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_DESK_HOST) {
    return String(import.meta.env.VITE_DESK_HOST).replace(/\/+$/, '');
  }
  return '';
}

let hostUrl = launchHost() || read(STORED_HOST) || '';
let token = read(STORED_TOKEN);
let schoolId = read(STORED_SCHOOL);

function api(path) {
  return `${hostUrl}/api/v1${path}`;
}

export function deskHost() { return hostUrl; }
export function deskToken() { return token; }
export function setDeskHost(url) {
  hostUrl = String(url || '').replace(/\/+$/, '');
  write(STORED_HOST, hostUrl);
}
export function signedInUser() {
  try { return JSON.parse(read(STORED_USER) || 'null'); } catch (_) { return null; }
}
export function deskSchool() { return schoolId; }
export function setDeskSchool(id) {
  schoolId = String(id || '');
  write(STORED_SCHOOL, schoolId);
  hostInfo = null;   // its branding is that school's, so it must be re-asked
}

// What the rest of the app is told when the school's computer cannot be
// reached. Deliberately the shape a handler returns, so a screen that checks
// `res.ok` shows a message rather than throwing where nobody catches it.
function unreachable(detail) {
  return {
    ok: false,
    offline: true,
    error: hostUrl
      ? `Cannot reach the school’s computer at ${hostUrl}. Check that it is switched on and on the same network.`
      : 'Not connected to a school yet.',
    detail: detail || null,
  };
}

let onSignedOut = null;
// The app registers what to do when the host stops recognising this browser —
// a revoked device, an expired token, an account deactivated this morning.
export function whenSignedOut(fn) { onSignedOut = fn; }

async function post(path, body, { auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const sentToken = !!(auth && token);
  if (sentToken) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(api(path), { method: 'POST', headers, body: JSON.stringify(body || {}) });
  } catch (e) {
    return { __transport: 'unreachable', error: (e && e.message) || String(e) };
  }
  if (res.status === 401) {
    // Careful: 401 with no token was never a sign-out. It is simply somebody
    // who has not signed in yet, and treating it as one turned the sign-in
    // screen into a reload loop — the screen asks for the school's crest
    // before anybody has signed in, is told 401, reloads, and asks again.
    if (!sentToken) return { __transport: 'not-signed-in' };
    // The token is no longer good for anything. Forget it here rather than
    // letting every subsequent screen fail on its own.
    clearSession();
    if (onSignedOut) onSignedOut();
    return { __transport: 'signed-out' };
  }
  let payload = null;
  try { payload = await res.json(); } catch (_) { payload = null; }
  return payload || { ok: false, error: `The school’s computer answered ${res.status}.` };
}

function clearSession() {
  token = '';
  write(STORED_TOKEN, '');
  write(STORED_USER, '');
}

// ── Signing in ───────────────────────────────────────────────────────────────

async function deskLogin({ username, password }) {
  const r = await post('/desk/login', {
    username, password,
    device: 'Browser', platform: 'web',
    // Ignored by a school's own computer, required by the hosted service.
    ...(schoolId ? { school_id: schoolId } : {}),
  }, { auth: false });

  if (r.__transport === 'unreachable') return unreachable(r.error);
  if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'Could not sign in.' };

  token = r.token;
  write(STORED_TOKEN, token);
  write(STORED_USER, JSON.stringify(r.user));
  return { ok: true, user: r.user };
}

function deskLogout() {
  clearSession();
  return Promise.resolve({ ok: true });
}

// What the host said about itself. Fetched once — by the gate, before the
// application renders — and kept, because two of the questions the sign-in
// screen asks are answered from it.
let hostInfo = null;
export function rememberHostInfo(info) { hostInfo = info || null; }

async function fetchInfo() {
  if (hostInfo) return hostInfo;
  // The hosted service holds many schools and answers about one at a time;
  // a school's own computer holds one and ignores the question.
  const res = await fetch(api('/desk/info') + (schoolId ? `?school_id=${encodeURIComponent(schoolId)}` : ''));
  hostInfo = await res.json();
  return hostInfo;
}

// Somewhere holding more than one school, with none of them chosen yet. The
// Connect screen asks; a school's own computer never gets here.
export async function schoolsToChooseFrom() {
  try {
    const res = await fetch(api('/desk/info'));
    const info = await res.json();
    if (info && info.online && Array.isArray(info.schools) && !info.school) return info.schools;
    return null;
  } catch (_) {
    return null;
  }
}

// The school's own identity, before anybody has signed in.
//
// On the office PC this is `settings:get-all` and it is free. Here it cannot
// be: that channel answers with every setting the school has, the payment
// gateway's keys included, and it is not something to hand out to whoever
// opens the address. So before sign-in the screen is given the curated public
// set the host publishes for exactly this — its crest, its name, its colours —
// and after sign-in the real channel answers, as it does on the office PC.
async function settingsForSignInScreen() {
  try {
    const info = await fetchInfo();
    return (info && info.settings) || {};
  } catch (_) {
    return {};
  }
}

// Asked before anybody has a token, so it goes to the public route.
async function bootstrapStatus() {
  let info;
  try {
    info = await fetchInfo();
  } catch (e) {
    return unreachable((e && e.message) || String(e));
  }
  // The desktop's own answer to this channel, to the letter: App.jsx reads
  // `done` and nothing else, and it must not learn a second shape.
  return { done: !!info.bootstrap_done };
}

// ── Choosing, saving and opening files ───────────────────────────────────────

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

// The browser's answer to a file dialog. Opens a file input, sends the bytes
// to the host, and answers in the shape the dialog answers in — so the screens
// that call it are unchanged, including the ones that go straight on to pass
// `filePaths[0]` to a handler as `sourcePath`.
function showOpenDialog(opts = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    const exts = (opts.filters || []).flatMap(f => f.extensions || []);
    if (exts.length) input.accept = exts.map(e => '.' + e).join(',');
    if ((opts.properties || []).includes('multiSelections')) input.multiple = true;
    input.style.display = 'none';

    // A cancelled dialog fires no event in some browsers, so the page regains
    // focus with nothing chosen and this must not hang forever.
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      try { input.remove(); } catch (_) {}
      resolve(value);
    };

    input.addEventListener('change', async () => {
      const files = [...(input.files || [])];
      if (!files.length) return done({ canceled: true, filePaths: [] });
      const paths = [];
      for (const file of files) {
        try {
          const data = await readAsDataUrl(file);
          const r = await post('/desk/stage-file', { name: file.name, data });
          if (r && r.ok && r.path) paths.push(r.path);
          else return done({ canceled: true, filePaths: [], error: (r && r.error) || 'That file could not be sent.' });
        } catch (e) {
          return done({ canceled: true, filePaths: [], error: (e && e.message) || String(e) });
        }
      }
      done({ canceled: false, filePaths: paths });
    });
    window.addEventListener('focus', () => {
      // Give the change event its chance first.
      setTimeout(() => done({ canceled: true, filePaths: [] }), 700);
    }, { once: true });

    document.body.appendChild(input);
    input.click();
  });
}

// There is nowhere to save to and nothing to choose: the browser downloads
// what the host produced. Answering `canceled: false` with no path is what the
// screens already handle for "the file was dealt with".
function showSaveDialog(opts = {}) {
  return Promise.resolve({
    canceled: false,
    filePath: null,
    browser: true,
    note: 'The file will download when it is ready.',
  });
}

// ── What a path means here ───────────────────────────────────────────────────
//
// An answer still carries the office PC's own paths, untouched — see
// companions() in electron/server/desk_api.js for why nothing is rewritten.
// What arrives beside it is what this browser needs to make sense of them:
// the bytes of a picture, and a handle for a document.
//
// So a path is not dead here, it is a key. Every screen goes on passing paths
// around exactly as it does on the office PC, and the two places that have to
// DRAW one or OPEN one look it up.
const pictures = new Map();   // host path → data URI (or null: nothing drawable)
const documents = new Map();  // host path → { handle, name }

// Bounded: a term of report cards and a year of class lists would otherwise
// accumulate in a tab somebody never closes. Oldest out first — a path that
// still matters is re-sent with the next answer that mentions it.
const TABLE_MAX = 1500;
function remember(table, key, value) {
  if (table.size >= TABLE_MAX) {
    const oldest = table.keys().next();
    if (!oldest.done) table.delete(oldest.value);
  }
  table.set(key, value);
}

function absorb(payload) {
  if (!payload) return;
  for (const [p, uri] of Object.entries(payload.media || {})) remember(pictures, p, uri);
  for (const [p, ref] of Object.entries(payload.files || {})) remember(documents, p, ref);
}

// What lib/media.js asks when it is handed a path in a browser. Installed on
// the window rather than imported, so media.js does not have to know that a
// transport exists — it asks whether anybody can turn this path into a picture,
// and in the installed application nobody answers.
function installPictureResolver() {
  window.__EDUSOFT_PICTURE__ = (hostPath) => {
    if (!hostPath) return null;
    return pictures.has(hostPath) ? pictures.get(hostPath) : null;
  };
}

// The host wrote a file and named it. Opening it is fetching it with this
// browser's token and handing the bytes to a new tab.
async function openHostFile(hostPath) {
  const ref = hostPath ? documents.get(hostPath) : null;
  if (!ref) {
    return { ok: false, error: 'That file is no longer available. Produce it again.' };
  }
  // A new tab cannot carry an Authorization header, so the file is fetched
  // here — with this browser's token — and the tab is handed bytes it already
  // has. Nothing about the file is reachable from an address alone.
  try {
    const res = await fetch(`${hostUrl}/api/v1/desk/file/${encodeURIComponent(ref.handle)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return { ok: false, error: 'That file is no longer available. Produce it again.' };
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    window.open(objectUrl, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    return { ok: true, name: ref.name };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

// Things that only mean something at the office PC. Said plainly rather than
// hidden, because a member of staff who used this yesterday at the office
// should be told where it lives, not left thinking the web version is broken.
function atTheOfficePc(what) {
  return Promise.resolve({
    ok: false,
    host_only: true,
    error: `${what} happens at the school’s own computer.`,
  });
}

// ── The transport ────────────────────────────────────────────────────────────

const LOCAL = {
  'auth:login': (data) => deskLogin(data || {}),
  'auth:logout': () => deskLogout(),
  'auth:bootstrap-status': () => bootstrapStatus(),

  'app:show-open-dialog': (opts) => showOpenDialog(opts || {}),
  'app:show-save-dialog': (opts) => showSaveDialog(opts || {}),
  'app:open-file': (handle) => openHostFile(handle),
  'app:open-pdf-preview': (handle) => openHostFile(handle),
  'app:open-folder': () => atTheOfficePc('Opening a folder'),
  'app:open-logs': () => atTheOfficePc('Opening the log folder'),
  'app:print-to-pdf': () => {
    // The browser has a printer dialog of its own and it is the right one.
    window.print();
    return Promise.resolve({ ok: true, printed: 'browser' });
  },
  'app:get-paths': () => Promise.resolve({ browser: true, userData: null, uploads: null, logs: null }),
  'app:diagnostics': () => Promise.resolve({
    ok: true, browser: true, host: hostUrl,
    note: 'Full diagnostics are available at the school’s own computer.',
  }),
};

// Answered here only while nobody is signed in, and sent to the host the
// moment somebody is. Exactly one channel qualifies, and it is declared rather
// than buried in a condition inside invoke() — the point of naming every
// channel in one place is lost if a second one can hide in an `if`.
const BEFORE_SIGN_IN = {
  'settings:get-all': () => settingsForSignInScreen(),
};

async function invoke(channel, ...args) {
  const local = LOCAL[channel];
  if (local) return local(...args);

  const early = !token && BEFORE_SIGN_IN[channel];
  if (early) return early(...args);

  if (!hostUrl && typeof window !== 'undefined' && window.location) {
    // Served by the host itself: same origin, nothing to configure.
    hostUrl = '';
  }

  const r = await post('/desk/call', { channel, args });
  if (r.__transport === 'unreachable') return unreachable(r.error);
  if (r.__transport === 'signed-out') {
    return { ok: false, error: 'You have been signed out. Sign in again.' };
  }
  if (r.__transport === 'not-signed-in') {
    return { ok: false, error: 'Please sign in.' };
  }
  // A refusal from the host — no such channel, not staff, host-only — is
  // already in the shape a handler answers in, so it is passed straight on.
  if (!r.ok) return r;
  absorb(r);
  // The answer itself: byte for byte what the office PC's own window receives.
  return r.result;
}

// Is this a browser, or the installed application?
//
// Decided ONCE, when this module is first evaluated, and deliberately not
// computed on demand. The test is whether the preload script has put
// `window.api` on the window — which it does before any renderer script runs —
// and asking that question later gets the wrong answer, because by then this
// file has installed a `window.api` of its own. That is not a subtle bug: it
// made the Connect screen unreachable, stopped a signed-in browser from being
// put back where it was, and left the application to fail three steps later
// on a list that was really a refusal.
const IS_BROWSER = typeof window !== 'undefined' && !window.api;

export function isBrowser() { return IS_BROWSER; }

// Install the surface. Called once, before React renders anything.
export function installDeskApi() {
  if (!IS_BROWSER) return false;
  window.api = buildApi(invoke);
  window.__EDUSOFT_TRANSPORT__ = 'desk';
  installPictureResolver();
  return true;
}

export default { installDeskApi, isBrowser, deskHost, setDeskHost, deskToken, signedInUser, whenSignedOut };
