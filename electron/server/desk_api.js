// Nickland Edusoft — the office application, over the network.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The installed application in a browser. Not a copy of it, not a version of
// it: the same screens, calling the same channels, answered by the same
// handlers in the same process. What changes is only how the call arrives.
//
//   the office PC      window → preload → ipcRenderer.invoke → handler
//   any other machine  browser → POST /api/v1/desk/call → handler
//
// One route carries all of it, because the alternative — a route per channel —
// is four hundred chances for the browser and the window to disagree about
// what taking a payment does. They cannot disagree here. There is one
// implementation and this reaches it by name.
//
// ── What stops this being a way round the rules ──────────────────────────────
//
// Nothing here decides what anybody may do. The handler this dispatches to was
// wrapped by _guard.js at registration, so the permission and scope policy in
// _policy.js applies exactly as it does to the window — the same check, on the
// same resolved permissions, against the live account. A browser cannot reach
// anything the installed application would refuse, and a channel added next
// month is covered without anybody remembering to cover it.
//
// Three things this adds on top, because a network is not an office:
//
//   • The caller is carried per request (security.runAs). Two people working
//     at once are two identities; without this they would share whichever one
//     signed in last, and every audit row would name the wrong person.
//   • Staff only. A parent's token is refused outright — parents have their
//     own app, and this is the school's office.
//   • A short list of channels that only mean anything on the host machine is
//     refused with an explanation, rather than half-working.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const registry = require('../ipc/_registry');
const security = require('../ipc/_security');
const tokens = require('./tokens');
const media = require('./media');

// ── Channels that stay on the office PC ──────────────────────────────────────
//
// Not a security boundary — the policy is. This is about calls whose answer is
// meaningless anywhere else, and which would otherwise fail in a way that
// looks like a fault in the web app rather than the plain fact that a browser
// in another room cannot open a folder on the office PC.
//
// The app:* channels are not listed because they cannot be reached at all:
// electron/main.js registers them on the real ipcMain, which the registry does
// not record. This list is for channels that ARE recorded and should not
// travel.
const HOST_ONLY = new Map([
  // Signing in is not a channel here; it is the desk login route below, which
  // issues a token instead of changing who this machine thinks is signed in.
  ['auth:login', 'Sign in from the browser rather than through this channel.'],
  ['auth:logout', 'Signing out in the browser forgets the browser’s own session.'],
  ['auth:bootstrap', 'The first administrator is created at the school’s own computer.'],

  // A file chosen or written on the host's disk.
  ['backup:restore', 'Restoring a backup replaces the school’s database and is done at the school’s own computer.'],
  ['backup:factory-reset', 'Erasing the system is done at the school’s own computer.'],
  ['backup:open-folder', 'This opens a folder on the school’s computer.'],
  ['backup:pick-folder', 'This opens a folder chooser on the school’s computer.'],
  ['backup:pick-file', 'This opens a file chooser on the school’s computer.'],
  ['backup:save-copy', 'Saving a copy writes to a folder on the school’s computer.'],
  ['backup:set-primary-folder', 'The backup folder is set at the school’s own computer.'],
  ['workbook:open-folder', 'This opens a folder on the school’s computer.'],
  ['workbook:reveal', 'This opens a folder on the school’s computer.'],
  ['workbook:pick-file', 'This opens a file chooser on the school’s computer.'],
  ['students:bulk-upload', 'Choose the file with the Import button, which uploads it.'],
  ['students:bulk-preview', 'Choose the file with the Import button, which uploads it.'],
  ['exams:import-template', 'Choose the file with the Import button, which uploads it.'],
]);

// ── Files the host produced ──────────────────────────────────────────────────
//
// A report generator answers { ok: true, path } — a path on the host's hard
// disk, which the window opens and a browser cannot. So a path in an answer is
// swapped for a handle before it leaves the building, and the handle is what
// the browser asks for the file by.
//
// The client never names a path and is never believed about one. The host only
// serves handles it issued itself, only to the account it issued them to, and
// only for a few minutes. That is the whole of the file surface: there is no
// route that takes a path.
const HANDLE_TTL_MS = 10 * 60 * 1000;
const handles = new Map();   // handle → { file, userId, at }

function sweepHandles() {
  const cutoff = Date.now() - HANDLE_TTL_MS;
  for (const [k, v] of handles) if (v.at < cutoff) handles.delete(k);
}

function issueHandle(file, userId) {
  sweepHandles();
  const handle = crypto.randomBytes(18).toString('base64url');
  handles.set(handle, { file, userId, at: Date.now() });
  return handle;
}

function resolveHandle(handle, userId) {
  sweepHandles();
  const rec = handles.get(handle);
  if (!rec) return null;
  // Somebody else's report is not yours, even with the handle.
  if (String(rec.userId) !== String(userId)) return null;
  return rec.file;
}

// ── Answers that name the host's disk ────────────────────────────────────────
//
// A handler answers with what it has always answered with: `{ ok: true, path }`
// for a report it wrote, `photo_path` on a pupil's row. Both name a file on the
// office PC, and a browser can use neither.
//
// The tempting fix is to rewrite those values on the way out. It is the wrong
// fix, and it broke things quietly when tried: `photos.upload` answers with the
// path of a STAGED photograph which the screen hands straight back as
// `stagedPath` when the record is saved. Rewrite it and the round trip carries
// a data URI where a path belongs — a fault that appears at the moment somebody
// admits a pupil, and nowhere earlier.
//
// So the answer travels untouched, exactly as the window receives it, and what
// a browser needs travels BESIDE it: two small tables keyed by the very paths
// the answer contains. The client looks a path up when it needs to draw it or
// open it, and every existing shape is still the shape it was.
const FILE_KEYS = new Set(['path', 'file', 'filePath', 'outPath']);

// A picture the school stores: sent as bytes, never as an address.
//
// That is the rule server/media.js already set for the mobile API, and it is
// worth restating: a photograph of a child must not be reachable by pasting a
// URL into a browser. A data URI is drawn by the page that asked for it and
// exists nowhere else.
const IMAGE_KEYS = new Set([
  'photo_path', 'photoPath', 'logo_path', 'logoPath',
  'signature_path', 'signaturePath', 'crest_path',
]);

// Walk an answer, collecting what the browser will need. Never rebuilds it.
function companions(value, userId) {
  const mediaTable = {};
  const fileTable = {};

  const walk = (v, depth) => {
    if (depth > 5 || v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const item of v) walk(item, depth + 1); return; }

    for (const [k, item] of Object.entries(v)) {
      if (typeof item === 'string' && item && path.isAbsolute(item)) {
        if (IMAGE_KEYS.has(k) && !(item in mediaTable)) {
          // Missing, too large or not an image: null, and the screen falls
          // back to initials exactly as the phone app does.
          mediaTable[item] = media.dataUri(item);
          continue;
        }
        if (FILE_KEYS.has(k) && !(item in fileTable) && fs.existsSync(item)) {
          const handle = issueHandle(item, userId);
          fileTable[item] = { handle, name: path.basename(item) };
          continue;
        }
      }
      walk(item, depth + 1);
    }
  };

  walk(value, 0);
  return { media: mediaTable, files: fileTable };
}

const DOWNLOAD_TYPES = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.csv': 'text/csv; charset=utf-8',
  '.zip': 'application/zip',
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

// ── A file chosen in a browser ───────────────────────────────────────────────
//
// The installed application picks a file with a dialog and hands the handler a
// path. Forty screens are written that way and none of them should have to
// learn a second way for the sake of the browser.
//
// So the browser sends the bytes, this writes them into a scratch folder on
// the host, and the handler is handed a real path to a real file exactly as
// before. The client never names a path — it names a file it is sending — and
// the extension comes from this list rather than from anything the client
// typed, because a filename is a place to hide `../` and `.js`.
const STAGEABLE = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp',
  '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv', '.zip', '.txt',
]);

// 20MB. A term's spreadsheet of pupils and a scanned certificate both fit;
// a video does not, and nothing here wants one.
const MAX_STAGED_BYTES = 20 * 1024 * 1024;

// Scratch files are the school's, briefly. Anything older than a working day
// is gone: the handler that wanted it has long since copied what it needed
// into uploads/, and what is left is a spreadsheet of every pupil's details
// sitting in a folder for no reason.
const STAGE_TTL_MS = 8 * 60 * 60 * 1000;

function sweepStaging(dir) {
  try {
    const cutoff = Date.now() - STAGE_TTL_MS;
    for (const name of fs.readdirSync(dir)) {
      const f = path.join(dir, name);
      try { if (fs.statSync(f).mtimeMs < cutoff) fs.unlinkSync(f); } catch (_) {}
    }
  } catch (_) { /* nothing staged yet */ }
}

function registerDeskRoutes({ add, db, json, API, rateLimited, userDataPath }) {
  const auth = require('../ipc/auth');
  const stagingDir = userDataPath ? path.join(userDataPath, 'desk-staging') : null;

  // What this host is, before anybody has signed in. The Connect screen names
  // the school rather than an IP address, so somebody typing an address into
  // Chrome can see they reached the right building.
  add('GET', `${API}/desk/info`, async (ctx, req, res) => {
    const { getSetting } = require('../utils/idgen');
    // Whether anybody has been set up yet, because the sign-in screen asks
    // that before it can decide what to show, and it asks it before it has a
    // token to ask with.
    let bootstrapDone = true;
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'bootstrap_done'").get();
      bootstrapDone = !!(row && String(row.value) === 'true');
    } catch (_) { /* an unopened database is not a signed-in school */ }

    return json(res, 200, {
      ok: true,
      product: 'Nickland Edusoft',
      desk: true,
      school: getSetting(db, 'school_name', 'Nickland Edusoft'),
      logo: getSetting(db, 'school_logo_path', '') ? '/api/v1/media/logo' : null,
      bootstrap_done: bootstrapDone,
    });
  }, { public: true });

  // Signing in from a browser. The same check the office PC makes — the same
  // throttle, the same hashes, the same permissions — but it ends in a token
  // for this browser rather than in this machine changing its mind about who
  // is sitting at it.
  add('POST', `${API}/desk/login`, async (ctx, req, res, params, body, ip) => {
    if (rateLimited(ip, body.username)) {
      return json(res, 429, { ok: false, error: 'Too many attempts. Try again shortly.' });
    }
    const r = auth.authenticate(db, { username: body.username, password: body.password });
    if (!r.ok) return json(res, 401, r);

    const t = tokens.issueToken(db, 'user', r.user.id, {
      deviceName: body.device || 'Browser', platform: body.platform || 'web',
    });
    return json(res, 200, { ok: true, token: t.token, expires_at: t.expires_at, user: r.user });
  }, { public: true });

  // Everything else. One route, every channel.
  add('POST', `${API}/desk/call`, async (ctx, req, res, params, body) => {
    if (!ctx || ctx.role !== 'staff') {
      return json(res, 403, { ok: false, error: 'The office application is for school staff.' });
    }

    const channel = String(body.channel || '');
    const args = Array.isArray(body.args) ? body.args : [];

    if (HOST_ONLY.has(channel)) {
      return json(res, 200, {
        ok: false, host_only: true,
        error: HOST_ONLY.get(channel),
      });
    }
    if (!registry.hasChannel(channel)) {
      return json(res, 404, { ok: false, error: `This version of the school’s system does not answer “${channel}”.` });
    }

    // From here on, this request IS that member of staff — to the permission
    // check, to the scope resolver, and to every audit row written along the
    // way. It stops being them the moment the handler returns.
    const result = await security.runAs(
      { userId: ctx.user.id, designation: ctx.designation },
      () => registry.callChannel(channel, args)
    );

    const beside = companions(result, ctx.user.id);
    return json(res, 200, { ok: true, result, media: beside.media, files: beside.files });
  });

  // A file this host made, for the account it made it for.
  add('GET', `${API}/desk/file/:handle`, async (ctx, req, res, params) => {
    if (!ctx || ctx.role !== 'staff') return json(res, 403, { ok: false, error: 'Forbidden' });
    const file = resolveHandle(params.handle, ctx.user.id);
    if (!file || !fs.existsSync(file)) {
      return json(res, 404, { ok: false, error: 'That file is no longer available. Produce it again.' });
    }
    const ext = path.extname(file).toLowerCase();
    const body = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': DOWNLOAD_TYPES[ext] || 'application/octet-stream',
      'Content-Length': body.length,
      'Content-Disposition': `inline; filename="${path.basename(file).replace(/"/g, '')}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  });

  // Staging a chosen file. Answers with a path on this host, which is what
  // every existing handler expects and what the client could never have
  // supplied itself.
  add('POST', `${API}/desk/stage-file`, async (ctx, req, res, params, body) => {
    if (!ctx || ctx.role !== 'staff') return json(res, 403, { ok: false, error: 'Forbidden' });
    if (!stagingDir) {
      return json(res, 503, { ok: false, error: 'This host cannot accept files. Do this at the school’s own computer.' });
    }

    const declared = String(body.name || 'file');
    const ext = path.extname(declared).toLowerCase();
    if (!STAGEABLE.has(ext)) {
      return json(res, 400, { ok: false, error: `Files of type “${ext || 'unknown'}” are not accepted.` });
    }

    const b64 = String(body.data || '').replace(/^data:[^;]*;base64,/, '');
    let bytes;
    try { bytes = Buffer.from(b64, 'base64'); } catch (_) { bytes = null; }
    if (!bytes || !bytes.length) return json(res, 400, { ok: false, error: 'That file was empty.' });
    if (bytes.length > MAX_STAGED_BYTES) {
      return json(res, 413, { ok: false, error: 'That file is larger than 20MB.' });
    }

    try {
      fs.mkdirSync(stagingDir, { recursive: true });
      sweepStaging(stagingDir);
      // A random basename, this host's extension. Nothing the client typed
      // reaches the filesystem.
      const file = path.join(stagingDir, crypto.randomBytes(12).toString('hex') + ext);
      fs.writeFileSync(file, bytes);
      // The name is echoed back for the screen to show; the PATH is what the
      // handler is given, and it is ours.
      return json(res, 200, { ok: true, path: file, name: path.basename(declared) });
    } catch (e) {
      return json(res, 500, { ok: false, error: 'The school’s computer could not store that file.' });
    }
  }, { maxBody: 28 * 1024 * 1024 });

  // What this host can answer. The parity test reads it, and so does anybody
  // wondering why a button is disabled in the browser.
  add('GET', `${API}/desk/channels`, async (ctx, req, res) => {
    if (!ctx || ctx.role !== 'staff') return json(res, 403, { ok: false, error: 'Forbidden' });
    return json(res, 200, {
      ok: true,
      channels: registry.channels(),
      host_only: [...HOST_ONLY.keys()].sort(),
    });
  });
}

module.exports = { registerDeskRoutes, HOST_ONLY, companions, issueHandle, resolveHandle };
