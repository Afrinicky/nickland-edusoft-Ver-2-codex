// Nickland Edusoft — the office application over the network, and what holds.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/desk_api.js
//
// The office application now answers a browser as well as its own window, and
// that changes one thing profoundly: the school's system is no longer being
// used by one person at a time. This suite is about what that breaks if it is
// not thought about, and each case is a thing that would have gone wrong
// quietly and been very hard to explain afterwards.
//
//   • Two people working at once. The signed-in user used to be one variable
//     in the main process — correct for a machine in a locked office, and
//     catastrophic on a network: a bursar's request would be attributed to
//     whoever signed in last, and so would every audit row it wrote.
//   • The rules travelling with the call. A browser must not reach anything
//     the installed application would refuse, and must be refused by the same
//     check rather than by a second one written to agree with the first.
//   • Parents. They have their own app; a parent's token must not open the
//     school office.
//   • The things that only mean something on the office PC, said in words
//     instead of half-working.

const http = require('http');
const path = require('path');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`These tests need Node >= 22.5 for node:sqlite (running ${process.versions.node}).`);
  process.exit(1);
}

const fs = require('fs');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.resolve(__dirname, '..');
const { SCHEMA, runMigrations } = require(path.join(ROOT, 'electron/db/database.js'));
const { setSetting } = require(path.join(ROOT, 'electron/utils/idgen.js'));
const { createApiServer } = require(path.join(ROOT, 'electron/server/api.js'));
const registry = require(path.join(ROOT, 'electron/ipc/_registry.js'));
const security = require(path.join(ROOT, 'electron/ipc/_security.js'));
const { guardedIpcMain } = require(path.join(ROOT, 'electron/ipc/_guard.js'));
const bcrypt = require(path.join(ROOT, 'node_modules/bcryptjs'));

let pass = 0, fail = 0;
const ck = (n, c) => { c ? pass++ : fail++; console.log((c ? '✓' : '✗') + ' ' + n); };

function makeDb(userDataPath) {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...a) => {
    db.exec('BEGIN');
    try { const r = fn(...a); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  db.exec(SCHEMA);
  runMigrations(db);
  db._userDataPath = userDataPath;
  setSetting(db, 'school_name', 'Ave Maria School Acherensua', 'test');
  setSetting(db, 'bootstrap_done', 'true', 'test');
  return db;
}

function req(base, method, p, { token, body } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(base + p);
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        let d = ''; res.on('data', c => { d += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(d) }); }
          catch { resolve({ status: res.statusCode, json: null, text: d }); }
        });
      });
    r.on('error', () => resolve({ status: 0, json: null }));
    if (data) r.write(data);
    r.end();
  });
}

// One call to a channel, the way the browser makes it.
const call = (base, token, channel, ...args) =>
  req(base, 'POST', '/api/v1/desk/call', { token, body: { channel, args } });

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-desk-'));
  const db = makeDb(userData);
  const today = new Date().toISOString().slice(0, 10);

  db.exec(`INSERT INTO class_groups (id, name, short_code, level_category, level_order, is_active)
           VALUES (1, 'Basic 5', 'B5', 'Primary', 5, 1), (2, 'Basic 6', 'B6', 'Primary', 6, 1)`);
  db.exec(`INSERT INTO designations (id, name) VALUES
           (1, 'Class Teacher'), (2, 'Super Admin'), (3, 'Accountant')`);
  db.exec(`INSERT INTO staff (id, surname, first_name, role, status, staff_number, base_salary, ssnit_enrolled)
           VALUES (1, 'OWUSU', 'Kwabena', 'Teaching', 'Active', 'S/1', 2000, 1),
                  (2, 'OFORIWAA', 'Genevieve', 'Non-Teaching', 'Active', 'S/2', 1500, 1)`);

  const mkUser = (u, p, dsg, staffId) => {
    db.prepare(`INSERT INTO users (username, password_hash, full_name, designation_id, staff_id, is_active)
                VALUES (?, ?, ?, ?, ?, 1)`).run(u, bcrypt.hashSync(p, 8), u.toUpperCase(), dsg, staffId);
    return db.prepare('SELECT id FROM users WHERE username = ?').get(u).id;
  };
  const adminId = mkUser('nick', 'admin123', 2, null);
  const bursarId = mkUser('bursa', 'bursa123', 3, 2);
  const teacherId = mkUser('owusu', 'teach123', 1, 1);

  const grant = (uid, rows) => {
    for (const [m, v, c, e, d] of rows) {
      db.prepare(`INSERT INTO user_permission_overrides (user_id, module, can_view, can_create, can_edit, can_delete)
                  VALUES (?, ?, ?, ?, ?, ?)`).run(uid, m, v, c, e, d);
    }
  };
  // An accountant keeps the books. Nothing about the roll is theirs to change,
  // and payroll was never granted.
  grant(bursarId, [['fees', 1, 1, 1, 1], ['finance', 1, 1, 1, 1], ['students', 1, 0, 0, 0]]);
  grant(teacherId, [['academics', 1, 1, 1, 1], ['students', 1, 0, 1, 0]]);

  for (const [idx, sur, first, cls] of [
    ['AVE/001', 'ANSU', 'Monalisa', 1], ['AVE/002', 'BOATENG', 'Kwame', 1],
  ]) {
    db.prepare(`INSERT INTO students (index_number, surname, first_name, current_class_id, status, admission_date)
                VALUES (?, ?, ?, ?, 'Active', ?)`).run(idx, sur, first, cls, today);
  }

  // ── The host, registering its handlers exactly as electron/main.js does ────
  //
  // A stand-in for Electron's ipcMain: this suite runs in plain Node, and the
  // point is that the registry — not Electron — is what the network reaches.
  const taken = new Set();
  const fakeIpcMain = {
    // Electron refuses a second handler for a channel by throwing, and
    // _stubs.js depends on that. A stand-in that silently accepted duplicates
    // would hide the very thing the check below is for.
    handle: (channel) => {
      if (taken.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
      taken.add(channel);
    },
    on: () => {}, once: () => {},
    removeHandler: (c) => taken.delete(c), removeAllListeners: () => {},
  };
  registry._resetForTests();
  const recording = registry.recordingIpcMain(fakeIpcMain);
  const guarded = guardedIpcMain(recording, db);

  require(path.join(ROOT, 'electron/ipc/auth.js'))(recording, db);
  require(path.join(ROOT, 'electron/ipc/students.js'))(guarded, db, userData);
  require(path.join(ROOT, 'electron/ipc/dashboard.js'))(guarded, db);
  require(path.join(ROOT, 'electron/ipc/payroll.js'))(guarded, db);
  require(path.join(ROOT, 'electron/ipc/settings.js'))(
    guarded, db, (rel) => path.join(ROOT, 'resources', rel));

  // A probe, registered the same way any module registers, that answers with
  // nothing but who the host believes is calling. It exists to make the next
  // three checks about identity and nothing else.
  recording.handle('test:whoami', async () => {
    // The await matters: the whole question is whether an identity survives
    // one, or leaks into whatever else is in flight.
    await new Promise(r => setTimeout(r, 25));
    return { ok: true, userId: security.getCurrentUserId(), designation: security.getCurrentDesignation() };
  });

  // The stand-in for a channel a real module already took must never displace
  // it. _stubs.js registers one for every channel and lets Electron's refusal
  // skip the taken ones — so if the registry remembered the stub, the browser
  // would be told "not yet implemented" by a feature that works on the office
  // PC, with nothing anywhere to say why.
  try {
    recording.handle('students:list', () => ({ ok: false, error: 'stub' }));
  } catch (_) { /* refused, exactly as Electron refuses it */ }
  ck('a stand-in cannot displace the real handler it was skipped for',
    registry.handlerFor('students:list') !== null &&
    typeof registry.handlerFor('students:list') === 'function');

  const server = createApiServer(db, { userDataPath: userData });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  let r;

  // ══ Getting in ════════════════════════════════════════════════════════════

  r = await req(base, 'GET', '/api/v1/desk/info');
  ck('a browser can ask what it has reached, before signing in',
    r.status === 200 && r.json.desk === true && r.json.school === 'Ave Maria School Acherensua');
  ck('...and is told whether the school has been set up yet', r.json.bootstrap_done === true);

  // The sign-in screen draws the school before anybody has signed in, and the
  // channel that would normally answer that — settings:get-all — holds the
  // school's payment gateway keys. So the public answer is curated, and this
  // is the check that it stays curated.
  ck('the sign-in screen is given the school to draw',
    r.json.settings && r.json.settings.school.school_name === 'Ave Maria School Acherensua');
  ck('...and nothing beyond what a school prints on its letterhead',
    Object.keys(r.json.settings).sort().join(',') === 'branding,school' &&
    !JSON.stringify(r.json.settings).includes('secret') &&
    !Object.keys(r.json.settings.school).some(k => /key|secret|token|password/i.test(k)));

  setSetting(db, 'payment_gateway_secret', 'sk_live_do_not_leak_this', 'payments');
  r = await req(base, 'GET', '/api/v1/desk/info');
  ck('...and a gateway secret is not among it',
    !JSON.stringify(r.json).includes('sk_live_do_not_leak_this'));

  const signIn = async (u, p) => (await req(base, 'POST', '/api/v1/desk/login',
    { body: { username: u, password: p } })).json;

  const admin = await signIn('nick', 'admin123');
  const bursar = await signIn('bursa', 'bursa123');
  const teacher = await signIn('owusu', 'teach123');
  ck('staff sign in from a browser', !!admin.token && !!bursar.token && !!teacher.token);
  ck('...and are handed the same permissions the office PC would hand them',
    !!bursar.user.permissions.fees && bursar.user.permissions.fees.view === true);

  r = await signIn('bursa', 'wrong-password');
  ck('a wrong password is refused', r.ok !== true);

  // Signing in over the network must NOT change who this machine thinks is at
  // it. That is the single-variable problem, and it is what auth:login does.
  ck('...and signing in from a browser does not touch the office PC’s own session',
    security.getCurrentUserId() === null);

  // ══ Two people at once ════════════════════════════════════════════════════

  const [a, b] = await Promise.all([
    call(base, bursar.token, 'test:whoami'),
    call(base, teacher.token, 'test:whoami'),
  ]);
  ck('a request knows who made it', a.json.result.userId === bursarId);
  ck('...and so does the one running beside it', b.json.result.userId === teacherId);
  ck('...with their own designations, not one shared between them',
    a.json.result.designation === 'Accountant' && b.json.result.designation === 'Class Teacher');
  ck('...and neither left anything behind on the machine itself',
    security.getCurrentUserId() === null);

  // ══ The same rules, not a second set of them ══════════════════════════════

  r = await call(base, bursar.token, 'students:list', {});
  ck('an accountant may read the roll', r.status === 200 && Array.isArray(r.json.result));

  r = await call(base, bursar.token, 'students:create', {
    surname: 'MENSAH', first_name: 'Ama', current_class_id: 1, admission_date: today,
  });
  ck('...and may not admit a pupil, because the school did not grant it',
    r.status === 200 && r.json.result.ok === false && r.json.result.denied === true);

  r = await call(base, bursar.token, 'payroll:ssnit-schedule', { month: 1, year: 2026 });
  ck('...and is refused payroll, which was never theirs',
    r.status === 200 && r.json.result && r.json.result.denied === true);

  r = await call(base, admin.token, 'students:create', {
    surname: 'MENSAH', first_name: 'Ama', current_class_id: 1, admission_date: today,
  });
  ck('an administrator may admit a pupil', r.status === 200 && r.json.result.ok === true);

  const denials = db.prepare(
    "SELECT COUNT(*) c FROM audit_log WHERE action = 'permission_denied' AND user_id = ?"
  ).get(bursarId).c;
  ck('a refusal is written to the school’s own audit log, naming the right person', denials >= 1);

  // ══ Who this is for ═══════════════════════════════════════════════════════

  r = await call(base, null, 'students:list', {});
  ck('no token, no office', r.status === 401);

  r = await call(base, 'not-a-real-token', 'students:list', {});
  ck('a made-up token is not a token', r.status === 401);

  // A parent's token opens the parents' app and nothing else.
  const parentToken = (() => {
    const tokens = require(path.join(ROOT, 'electron/server/tokens.js'));
    db.prepare(`INSERT INTO parents (full_name, phone, password_hash)
                VALUES ('Yaa Mensah', '0244000000', ?)`).run(bcrypt.hashSync('parent123', 8));
    const pid = db.prepare("SELECT id FROM parents WHERE phone = '0244000000'").get().id;
    return tokens.issueToken(db, 'parent', pid, { deviceName: 'phone' }).token;
  })();
  r = await call(base, parentToken, 'students:list', {});
  ck('a parent cannot open the school office with the app they were given',
    r.status === 403);

  // Every setting IS reachable once somebody has signed in and holds settings,
  // exactly as on the office PC. The curation above is about the screen that
  // runs before anybody has.
  r = await call(base, admin.token, 'settings:get-all');
  ck('an administrator who has signed in still gets the whole of Settings',
    r.status === 200 && r.json.result.payments &&
    r.json.result.payments.payment_gateway_secret === 'sk_live_do_not_leak_this');

  // ══ What stays at the office PC ═══════════════════════════════════════════

  r = await call(base, admin.token, 'backup:restore', '/anything');
  ck('restoring a backup is refused over the network', r.json.host_only === true);
  ck('...and says where it happens instead',
    /school’s own computer/.test(r.json.error || ''));

  r = await call(base, admin.token, 'auth:login', { username: 'nick', password: 'admin123' });
  ck('signing in is not a channel a browser may call', r.json.host_only === true);
  ck('...and the office PC’s session is still nobody’s', security.getCurrentUserId() === null);

  r = await call(base, admin.token, 'app:show-open-dialog', {});
  ck('a file dialog on the office PC cannot be opened from a browser at all',
    r.status === 404);

  r = await call(base, admin.token, 'nonsense:channel');
  ck('a channel that does not exist says so, rather than answering nothing',
    r.status === 404);

  // ══ A file chosen in a browser ════════════════════════════════════════════

  r = await req(base, 'POST', '/api/v1/desk/stage-file', {
    token: admin.token,
    body: { name: 'roll.xlsx', data: 'data:application/octet-stream;base64,' + Buffer.from('hello').toString('base64') },
  });
  ck('a file sent from a browser lands on the host, with a path a handler can use',
    r.status === 200 && r.json.ok === true && fs.existsSync(r.json.path));
  ck('...under a name this host chose, not one the browser sent',
    !path.basename(r.json.path).includes('roll') && r.json.path.endsWith('.xlsx'));

  r = await req(base, 'POST', '/api/v1/desk/stage-file', {
    token: admin.token,
    body: { name: 'payload.exe', data: 'data:x;base64,' + Buffer.from('MZ').toString('base64') },
  });
  ck('a file the school has no use for is refused', r.status === 400);

  r = await req(base, 'POST', '/api/v1/desk/stage-file', {
    token: admin.token,
    body: { name: '../../escape.csv', data: 'data:x;base64,' + Buffer.from('a,b').toString('base64') },
  });
  ck('a filename cannot climb out of the folder it is written to',
    r.status === 200 && path.dirname(r.json.path) === path.join(userData, 'desk-staging'));

  // ══ A document the host produced ══════════════════════════════════════════

  const { companions, resolveHandle } = require(path.join(ROOT, 'electron/server/desk_api.js'));
  const madeFile = path.join(userData, 'report.pdf');
  fs.writeFileSync(madeFile, '%PDF-1.4 test');

  const beside = companions({ ok: true, path: madeFile, count: 3 }, adminId);
  ck('an answer naming a file on the host comes with a way to fetch it',
    !!beside.files[madeFile] && beside.files[madeFile].name === 'report.pdf');
  ck('...for the person it was made for', resolveHandle(beside.files[madeFile].handle, adminId) === madeFile);
  ck('...and for nobody else', resolveHandle(beside.files[madeFile].handle, bursarId) === null);

  // The answer itself is untouched. A staged photograph's path is handed
  // straight back by the screen that saves the record, so rewriting it would
  // break admissions at the moment somebody uses it.
  const untouched = { ok: true, path: madeFile, staged: true };
  const still = companions(untouched, adminId);
  ck('the answer a handler gave is not rewritten on the way out',
    untouched.path === madeFile && typeof still.files === 'object');

  r = await req(base, 'GET', `/api/v1/desk/file/${beside.files[madeFile].handle}`, { token: admin.token });
  ck('the file itself comes back', r.status === 200);
  r = await req(base, 'GET', `/api/v1/desk/file/${beside.files[madeFile].handle}`, { token: bursar.token });
  ck('...and not to somebody else holding the same handle', r.status === 404);

  // ══ What the host says it can do ══════════════════════════════════════════

  r = await req(base, 'GET', '/api/v1/desk/channels', { token: admin.token });
  ck('the host can list what it answers', r.status === 200 && r.json.channels.length > 20);
  ck('...and names the ones it will not answer over the network',
    r.json.host_only.includes('backup:restore'));
  ck('...and does not list the office PC’s own file dialogs among them',
    !r.json.channels.some(c => c.startsWith('app:')));

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
