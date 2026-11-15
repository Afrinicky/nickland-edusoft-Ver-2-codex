// Nickland Edusoft — a school's credentials are not readable by its staff.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The audit behind these tests found that `settings:get-all` returned every
// row of the settings table, unredacted, to any signed-in account. The school
// keeps its crest and its motto in that table, and beside them it keeps:
//
//   paystack_secret_key     the key that moves the school's fee money
//   sms_api_key             the key that texts every parent in the school
//   school_api_key          read AND write access to the school's cloud data
//
// The channel is in ALWAYS_ALLOWED, which _guard.js honours before it looks at
// a permission, so a class teacher could read all three — at the office PC, in
// a browser on the school Wi-Fi, and through /desk/call on the hosted service.
//
// `cloud-python/tests/test_attack.py` passed throughout. It asks whether an
// OUTSIDER can reach the PLATFORM's secrets, which it cannot; it never asked
// whether an insider can read the school's own. That blind spot is the reason
// this file exists, and the reason it tests the shape of the answer and not
// just the one key that was found first: the next credential somebody adds to
// that table must be caught by a test that was written before it.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`These tests need Node >= 22.5 for node:sqlite (running ${process.versions.node}).`);
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { SCHEMA, runMigrations, seedDefaults } = require(path.join(ROOT, 'electron/db/database.js'));
const security = require(path.join(ROOT, 'electron/ipc/_security.js'));
const secrets = require(path.join(ROOT, 'electron/ipc/_secrets.js'));
const { guardedIpcMain } = require(path.join(ROOT, 'electron/ipc/_guard.js'));
const registerSettings = require(path.join(ROOT, 'electron/ipc/settings.js'));

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

const db = makeDb();

// The credentials a real school has set, as they are actually stored.
const PLANTED = {
  paystack_secret_key: 'sk_live_PLANTED_PAYSTACK',
  flutterwave_secret_key: 'FLWSECK-PLANTED',
  flutterwave_secret_hash: 'PLANTED_HASH',
  hubtel_client_id: 'PLANTED_HUBTEL_ID',
  hubtel_client_secret: 'PLANTED_HUBTEL_SECRET',
  expresspay_api_key: 'PLANTED_EXPRESSPAY',
  sms_api_key: 'PLANTED_ARKESEL',
  resend_api_key: 're_PLANTED',
  email_smtp_pass: 'PLANTED_SMTP',
  school_api_key: 'PLANTED_SCHOOL_KEY',
};
const upsert = db.prepare(`INSERT INTO settings (key, value, category) VALUES (?, ?, 'payments')
                           ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
for (const [k, v] of Object.entries(PLANTED)) upsert.run(k, v);
db.prepare(`INSERT INTO settings (key, value, category) VALUES ('school_name', 'Ave Maria School', 'school')
            ON CONFLICT (key) DO UPDATE SET value = excluded.value`).run();

// A class teacher: the lowest-privileged account that can sign in at all.
const classTeacherDesignation = db.prepare("SELECT id FROM designations WHERE name = 'Class Teacher'").get();
db.prepare(`INSERT INTO staff (surname, first_name, role, status, staff_number)
            VALUES ('OWUSU', 'Justice', 'Teaching', 'Active', 'S/1')`).run();
const staffId = db.prepare("SELECT id FROM staff WHERE staff_number = 'S/1'").get().id;
db.prepare(`INSERT INTO users (username, password_hash, full_name, designation_id, staff_id, is_active)
            VALUES ('owusu', 'x', 'Justice Owusu', ?, ?, 1)`)
  .run(classTeacherDesignation ? classTeacherDesignation.id : null, staffId);
const teacherId = db.prepare("SELECT id FROM users WHERE username = 'owusu'").get().id;

const ipc = fakeIpcMain();
registerSettings(guardedIpcMain(ipc, db), db, () => null);
const call = (channel, ...args) => ipc.handlers.get(channel)({}, ...args);

security.setCurrentUser(teacherId, 'Class Teacher');

// ── the leak itself ─────────────────────────────────────────────────────────

const grouped = call('settings:get-all');
const flat = JSON.stringify(grouped);

ck('a class teacher can still read the school\'s own name — the sign-in screen needs it',
  grouped.school && grouped.school.school_name === 'Ave Maria School');

// One assertion per credential, named, so a failure says WHICH key leaked
// rather than that something did.
for (const [key, planted] of Object.entries(PLANTED)) {
  ck(`${key} is not readable through settings:get-all`, !flat.includes(planted));
}

// And the catch-all: nothing the policy calls a secret may appear anywhere in
// the answer, whatever it is called and wherever it is nested. This is the one
// that will catch the key somebody adds next year.
let leaked = null;
for (const key of secrets.WRITE_ONLY) {
  const value = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (value && value.value && flat.includes(value.value)) { leaked = key; break; }
}
ck('no value the policy calls a secret appears in the answer at all', leaked === null, leaked || '');

ck('...and the screen is still told which credentials ARE set, without being told them',
  grouped._secrets_configured
  && grouped._secrets_configured.paystack_secret_key === true
  && grouped._secrets_configured.school_api_key === true);

// ── the half that makes redaction safe ──────────────────────────────────────
//
// Settings → Payments and Settings → Notifications load every field into a
// form and write every field back on Save. If an empty secret overwrote the
// stored one, redaction would silently destroy a school's gateway key the
// first time anybody opened that screen and pressed Save.

// First: this teacher cannot write settings at all, which is the guard doing
// its job and is worth asserting while we are here. A credential the office
// sets is not a credential a class teacher can replace or remove.
const teacherSet = call('settings:set', { key: 'paystack_secret_key', value: 'sk_live_TEACHER' });
ck('a class teacher cannot replace a credential', teacherSet && teacherSet.denied === true);
const teacherClear = call('settings:clear-secret', 'paystack_secret_key');
ck('...nor remove one', teacherClear && teacherClear.denied === true);
ck('...and the stored key is untouched by either attempt',
  db.prepare("SELECT value FROM settings WHERE key = 'paystack_secret_key'").get().value
    === PLANTED.paystack_secret_key);

// Now as somebody who may: the Super Admin, who _guard.js treats as elevated
// and lets past the permission table entirely.
db.prepare(`INSERT INTO staff (surname, first_name, role, status, staff_number)
            VALUES ('MENSAH', 'Grace', 'Non-Teaching', 'Active', 'S/2')`).run();
const adminStaffId = db.prepare("SELECT id FROM staff WHERE staff_number = 'S/2'").get().id;
const adminDesignation = db.prepare(
  "SELECT id, name FROM designations WHERE name IN ('Super Admin', 'Administrator') ORDER BY name LIMIT 1").get();
db.prepare(`INSERT INTO users (username, password_hash, full_name, designation_id, staff_id, is_active)
            VALUES ('grace', 'x', 'Grace Mensah', ?, ?, 1)`)
  .run(adminDesignation.id, adminStaffId);
const adminId = db.prepare("SELECT id FROM users WHERE username = 'grace'").get().id;
security.setCurrentUser(adminId, adminDesignation.name);

call('settings:set', { key: 'paystack_secret_key', value: '' });
ck('an empty secret means "the one already saved", not "no key"',
  db.prepare("SELECT value FROM settings WHERE key = 'paystack_secret_key'").get().value
    === PLANTED.paystack_secret_key);

call('settings:set', { key: 'sms_api_key', value: undefined });
ck('...and so does a missing one',
  db.prepare("SELECT value FROM settings WHERE key = 'sms_api_key'").get().value
    === PLANTED.sms_api_key);

call('settings:set', { key: 'paystack_secret_key', value: 'sk_live_REPLACED' });
ck('a real value still replaces it',
  db.prepare("SELECT value FROM settings WHERE key = 'paystack_secret_key'").get().value
    === 'sk_live_REPLACED');

call('settings:set', { key: 'school_motto', value: '' });
ck('an ordinary setting can still be emptied — this rule is only for credentials',
  db.prepare("SELECT value FROM settings WHERE key = 'school_motto'").get().value === '');

// Clearing one has to remain possible, and has to be deliberate.
const cleared = call('settings:clear-secret', 'paystack_secret_key');
ck('a credential can be removed on purpose',
  cleared && cleared.ok
  && db.prepare("SELECT value FROM settings WHERE key = 'paystack_secret_key'").get().value === '');

ck('...and that is audited at high severity, because it stops the school taking money',
  db.prepare(`SELECT COUNT(*) c FROM audit_log
               WHERE action = 'clear_secret' AND severity = 'high'`).get().c === 1);

const refused = call('settings:clear-secret', 'school_name');
ck('and it refuses to clear something that is not a credential',
  refused && refused.ok === false
  && db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get().value === 'Ave Maria School');

// ── the two lists must agree ────────────────────────────────────────────────
const adminApi = require(path.join(ROOT, 'electron/server/admin_api.js'));
ck('every secret the system settings route writes is one the policy redacts',
  adminApi.SETTINGS_WRITE_ONLY.every(k => secrets.isSecret(k)));
ck('and nothing that route reads back is a secret',
  adminApi.SETTINGS_READABLE.every(k => !secrets.isSecret(k)));

security.clearCurrentUser();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
