// Nickland Edusoft — a school is created in one place, and only one.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The release model, stated as tests:
//
//   * A school is set up ONLINE by the Super Admin. Nothing else creates one.
//   * The school's administrator gets their first credentials from that act,
//     and must replace the password, because somebody else chose it.
//   * A desktop does not create a school. It ATTACHES to one that exists, by
//     activating with the administrator's own credentials.
//
// The last of those is what removes a whole class of problem rather than a
// screen: with one place that creates schools, there is never a desktop and a
// cloud disagreeing about who the school's administrator is.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`These tests need Node >= 22.5 for node:sqlite (running ${process.versions.node}).`);
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { SCHEMA, runMigrations, seedDefaults } = require(path.join(ROOT, 'electron/db/database.js'));
const release = require(path.join(ROOT, 'electron/release.js'));
const { buildApi } = require(path.join(ROOT, 'electron/api-surface.js'));

let pass = 0, fail = 0;
const ck = (n, c, extra) => {
  c ? pass++ : fail++;
  console.log((c ? '✓ ' : '✗ ') + n + (extra !== undefined ? '  ' + extra : ''));
};

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, fn) { handlers.set(channel, fn); },
    on() {}, once() {}, removeHandler() {}, removeAllListeners() {},
  };
}

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...a) => {
    db.exec('BEGIN');
    try { const r = fn(...a); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  db.exec(SCHEMA);
  runMigrations(db);
  seedDefaults(db);
  return db;
}

// ── the release says so ─────────────────────────────────────────────────────
console.log('\n── what this release allows ──');
ck('a desktop may not set up a school', release.localSetupEnabled() === false);
ck('...and says what to do instead, naming the screen',
  /Cloud Sync/.test(release.LOCAL_SETUP_OFF) && /activate/i.test(release.LOCAL_SETUP_OFF));

// ── the desktop refuses to create one ───────────────────────────────────────
console.log('\n── the desktop attaches, it does not create ──');
{
  const db = makeDb();
  const ipc = fakeIpcMain();
  require(path.join(ROOT, 'electron/ipc/auth.js'))(ipc, db);
  const call = (ch, ...a) => ipc.handlers.get(ch)({}, ...a);

  const before = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const r = call('auth:bootstrap', { fullName: 'Someone', username: 'admin', password: 'password123' });
  ck('creating the first administrator on a desktop is refused', r.ok === false);
  ck('...and the refusal points at activation', r.needs_activation === true);
  ck('...and no account was created', db.prepare('SELECT COUNT(*) c FROM users').get().c === before);

  const status = call('auth:bootstrap-status');
  ck('a fresh desktop reports that it needs activating, not setting up',
    status.needs_activation === true && status.done === false);
  ck('...and does not claim local setup is available', status.local_setup_allowed === false);

  // Once attached, the screen must stop asking.
  db.prepare(`INSERT INTO settings (key, value, category) VALUES ('cloud_school_id','ave-maria','cloud')
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
  ck('a desktop already attached to a school no longer asks to be activated',
    call('auth:bootstrap-status').needs_activation === false);
}

// ── activation is reachable ─────────────────────────────────────────────────
console.log('\n── activation is reachable from the user interface ──');
{
  // All three licence channels were registered in ipc/cloud_sync.js and named
  // nowhere on the API surface, so no renderer and no browser could call them:
  // activation — the only way a desktop attaches to a school — was unreachable
  // from the interface entirely. This is the test that keeps it reachable.
  const called = [];
  const api = buildApi((channel, ...args) => { called.push(channel); return Promise.resolve({ ok: true }); });
  ck('the application surface exposes licence.activate', typeof api.licence?.activate === 'function');
  ck('...and licence.status', typeof api.licence?.status === 'function');
  ck('...and licence.refresh', typeof api.licence?.refresh === 'function');
  api.licence.activate({ email: 'a@b.c', password: 'x' });
  api.licence.status();
  api.licence.refresh();
  ck('...each reaching the channel the backend actually registers',
    called.join(',') === 'licence:activate,licence:status,licence:refresh', called.join(','));

  // And the backend really does register them, so the surface is not pointing
  // at nothing.
  const db = makeDb();
  const ipc = fakeIpcMain();
  require(path.join(ROOT, 'electron/ipc/cloud_sync.js'))(ipc, db);
  for (const ch of ['licence:activate', 'licence:status', 'licence:refresh']) {
    ck(`the backend registers ${ch}`, ipc.handlers.has(ch));
  }
}

// ── the first-run screen asks the right question ────────────────────────────
console.log('\n── the first-run screen ──');
{
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer/src/pages/Bootstrap.jsx'), 'utf8');
  ck('the first-run screen activates rather than creating an account',
    /licence\.activate/.test(src));
  ck('...and no longer calls auth.bootstrap at all', !/auth\.bootstrap\(/.test(src));
  ck('...asks for the administrator\'s own credentials', /email/i.test(src) && /password/i.test(src));
  ck('...handles one email running several schools, rather than guessing',
    /choose/.test(src) && /schools/.test(src));
}

// ── the cloud: self-registration is closed ──────────────────────────────────
console.log('\n── the cloud ──');
{
  const fs = require('fs');
  const pub = fs.readFileSync(path.join(ROOT, 'cloud-python/app/public_api.py'), 'utf8');
  ck('the public website cannot register a school',
    /self_registration_enabled\(\)/.test(pub));
  ck('...and is refused before anything is written',
    pub.indexOf('self_registration_enabled()') < pub.indexOf('identity.register('));

  const rel = fs.readFileSync(path.join(ROOT, 'cloud-python/app/release.py'), 'utf8');
  ck('...with self-registration off by default',
    /EDUSOFT_SELF_REGISTRATION", False/.test(rel));

  const ident = fs.readFileSync(path.join(ROOT, 'cloud-python/app/identity.py'), 'utf8');
  // The security detail: when the Super Admin chose the password, the school's
  // administrator must replace it. That password has been read by somebody at
  // Nickland, written in a handover note and very likely sent over WhatsApp.
  ck('an administrator the Super Admin created must change the password',
    /chose_own_password/.test(ident)
    && /"must_change_password": 0 if chose_own_password else 1/.test(ident));
  ck('...and a temporary password is generated rather than invented by the operator',
    /secrets\.token_urlsafe/.test(ident));
  ck('...and handed back exactly once, since only its hash is stored',
    /"temporary_password": generated_password/.test(ident));
  ck('...while a school that typed its own password at a form is not nagged',
    /chose_own_password = actor == "public"/.test(ident));
}

// ── activation leaves a desktop that can actually be used ─────────────────
//
// Attaching the machine is not the whole job. The first version of this stored
// the school id, the device token and the licence and stopped — which left a
// desktop with NOBODY TO SIGN IN AS, because the staff arrive with the first
// sync. Worse, it never marked the installation as set up, so the first-run
// screen came back on the next launch and asked to activate a machine that
// already had. Both are asserted here.
console.log('\n── what activation leaves behind ──');
{
  const db = makeDb();
  const refresh = require(path.join(ROOT, 'electron/licence/refresh.js'));
  const { setSetting, getSetting } = require(path.join(ROOT, 'electron/utils/idgen.js'));
  setSetting(db, 'cloud_base_url', 'https://ave-maria.edusoft.test', 'cloud');

  // What the cloud answers /api/v1/activate with, now that it names the
  // administrator it just authenticated.
  const body = {
    ok: true,
    school: { id: 'ave-maria', name: 'Ave Maria School' },
    school_id: 'ave-maria',
    device_token: 'dev-token-abc',
    user: { username: 'Grace.Adjei', fullName: 'Grace Adjei', designation: 'Super Admin' },
    designation: 'Super Admin',
    must_change_password: true,
  };

  // Exercised through the exported helper rather than over the network: the
  // network half is refresh.activate(), which this suite cannot reach without
  // a live cloud, and the half worth pinning is what it writes locally.
  const ok = refresh.__materialiseAdministratorForTest(db, body, 'the-password-they-typed');
  ck('activation creates the one account the desktop starts with', ok === true);

  const row = db.prepare("SELECT * FROM users WHERE username = 'grace.adjei'").get();
  ck('...under the administrator\'s own username, lower-cased', !!row);
  ck('...named', row && row.full_name === 'Grace Adjei');
  ck('...as the school\'s Super Admin, matched by NAME not by the cloud\'s integer id',
    !!row && row.designation_id === db.prepare(
      "SELECT id FROM designations WHERE name = 'Super Admin'").get().id);
  ck('...active', row && row.is_active === 1);
  ck('...and required to replace the password the Super Admin chose',
    row && row.must_change_password === 1);

  // The password they typed is the one that works, offline, from here on.
  const auth = require(path.join(ROOT, 'electron/ipc/auth.js'));
  const signedIn = auth.authenticate(db, { username: 'grace.adjei', password: 'the-password-they-typed' });
  ck('the administrator can sign in on this desktop with that password', signedIn.ok === true);
  ck('...and a wrong one is refused',
    auth.authenticate(db, { username: 'grace.adjei', password: 'nope' }).ok === false);

  // Activating twice — a reinstall — must update rather than collide on the
  // unique username.
  const again = refresh.__materialiseAdministratorForTest(db, body, 'a-new-password');
  ck('activating again after a reinstall updates rather than failing', again === true);
  ck('...leaving exactly one account, not two',
    db.prepare("SELECT COUNT(*) c FROM users WHERE username = 'grace.adjei'").get().c === 1);
  ck('...and the newer password is the one that works',
    auth.authenticate(db, { username: 'grace.adjei', password: 'a-new-password' }).ok === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
