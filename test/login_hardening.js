// Nickland Edusoft — the ways into an account, and the brakes on guessing.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The audit behind these tests found three separate implementations of "check
// a password", with three different amounts of protection:
//
//   ipc/auth.js          staff, with a per-USERNAME lockout
//   server/api.js        staff, its own bcrypt call and NO account lockout
//   server/parents.js    parents, no throttle at all and a 4-character minimum
//
// The two without a brake are the two that answer over a network — and
// `host/server.js` puts that same code on the INTERNET. So the weakest of the
// three was the one an outsider could reach.
//
// There is now one staff implementation, and the parent one has a throttle.
// Both count failures per (account, SOURCE) with a higher per-account
// backstop, which is the shape the online service already settled on
// (cloud-python/app/school/session.py) and deliberately not a per-account
// count: that would let anybody on the internet lock out a head teacher by
// guessing at their username five times a minute.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`These tests need Node >= 22.5 for node:sqlite (running ${process.versions.node}).`);
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { SCHEMA, runMigrations, seedDefaults } = require(path.join(ROOT, 'electron/db/database.js'));
const auth = require(path.join(ROOT, 'electron/ipc/auth.js'));
const hashing = require(path.join(ROOT, 'electron/ipc/_hashing.js'));
const parents = require(path.join(ROOT, 'electron/server/parents.js'));

let pass = 0, fail = 0;
const ck = (n, c, extra) => {
  c ? pass++ : fail++;
  console.log((c ? '✓ ' : '✗ ') + n + (extra !== undefined ? '  ' + extra : ''));
};

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

// ── a staff account and a parent account ────────────────────────────────────
db.prepare(`INSERT INTO staff (surname, first_name, role, status, staff_number)
            VALUES ('ADJEI', 'Grace', 'Non-Teaching', 'Active', 'S/1')`).run();
const staffId = db.prepare("SELECT id FROM staff WHERE staff_number = 'S/1'").get().id;
const designation = db.prepare(
  "SELECT id, name FROM designations WHERE name IN ('Super Admin','Administrator') ORDER BY name LIMIT 1").get();
db.prepare(`INSERT INTO users (username, password_hash, full_name, designation_id, staff_id, is_active)
            VALUES ('adjei', ?, 'Grace Adjei', ?, ?, 1)`)
  .run(hashing.hashPassword('correct horse'), designation.id, staffId);

db.prepare(`INSERT INTO students (index_number, surname, first_name, status, mother_contact)
            VALUES ('AVE/001', 'ANSU', 'Monalisa', 'Active', '0244111222')`).run();
const studentId = db.prepare("SELECT id FROM students WHERE index_number = 'AVE/001'").get().id;

// ── the password floor ──────────────────────────────────────────────────────

ck('a parent password of four characters is refused',
  parents.provisionParent(db, { full_name: 'Mrs Ansu', phone: '0244111222', password: 'abcd' }).ok === false);
ck('...and so is one of seven',
  parents.provisionParent(db, { full_name: 'Mrs Ansu', phone: '0244111222', password: 'abcdefg' }).ok === false);
ck(`...and the floor is ${parents.MIN_PARENT_PASSWORD}, the figure the online service already used`,
  parents.MIN_PARENT_PASSWORD === 8);

const prov = parents.provisionParent(db, {
  full_name: 'Mrs Ansu', phone: '0244111222', password: 'parent1234', studentIds: [studentId],
});
ck('a password of eight or more is accepted', prov.ok === true);

ck('an office password reset is held to the same floor',
  parents.setParentPassword(db, prov.parent_id, 'short').ok === false);

// ── the parent throttle ─────────────────────────────────────────────────────

parents.resetParentThrottle();

let r = parents.loginParent(db, { identifier: '0244111222', password: 'parent1234', source: '10.0.0.1' });
ck('the parent can sign in', r.ok === true);

parents.resetParentThrottle();
for (let i = 0; i < 5; i++) {
  r = parents.loginParent(db, { identifier: '0244111222', password: 'wrong', source: '10.0.0.9' });
}
ck('five wrong passwords from one address are refused', r.ok === false);
r = parents.loginParent(db, { identifier: '0244111222', password: 'wrong', source: '10.0.0.9' });
ck('...and the sixth is throttled, not merely refused', r.throttled === true);

// The point of counting per source: the real parent is unaffected.
r = parents.loginParent(db, { identifier: '0244111222', password: 'parent1234', source: '10.0.0.1' });
ck('...while the parent signing in from their own phone still gets in', r.ok === true,
  'this is what a per-account-only lockout would have broken');

ck('a failed parent sign-in is written to the security log',
  db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE action = 'parent_login_failed'`).get().c > 0);
ck('...and the run of them is marked high severity',
  db.prepare(`SELECT COUNT(*) c FROM audit_log
               WHERE action = 'parent_login_failed' AND severity = 'high'`).get().c > 0);

// An unknown identifier must not be distinguishable from a wrong password.
parents.resetParentThrottle();
const unknown = parents.loginParent(db, { identifier: '0209999999', password: 'whatever', source: '10.0.0.2' });
const known = parents.loginParent(db, { identifier: '0244111222', password: 'whatever', source: '10.0.0.3' });
ck('an account that does not exist answers exactly as a wrong password does',
  unknown.ok === false && known.ok === false && unknown.error === known.error);

// ── the staff throttle, per (account, source) ───────────────────────────────

auth.resetLoginThrottle();

ck('a member of staff can sign in',
  auth.authenticate(db, { username: 'adjei', password: 'correct horse', source: '10.0.0.1' }).ok === true);

auth.resetLoginThrottle();
let s = null;
for (let i = 0; i < 6; i++) {
  s = auth.authenticate(db, { username: 'adjei', password: 'no', source: '10.0.0.9' });
}
ck('six wrong passwords from one address lock that address out', /too many/i.test(s.error || ''));

// THE point of the change. Before it, the line below failed: an attacker
// anywhere could lock the school's own administrator out of their own system.
s = auth.authenticate(db, { username: 'adjei', password: 'correct horse', source: '10.0.0.1' });
ck('...and the real administrator, on their own connection, still signs in', s.ok === true,
  'a per-account lockout would have made this a denial of service');

// The backstop still catches a guess spread across many addresses.
auth.resetLoginThrottle();
for (let i = 0; i < 51; i++) {
  auth.authenticate(db, { username: 'adjei', password: 'no', source: `10.1.0.${i}` });
}
s = auth.authenticate(db, { username: 'adjei', password: 'correct horse', source: '10.2.0.1' });
ck('fifty-one wrong guesses from fifty-one addresses still meet the backstop',
  /too many/i.test(s.error || ''), 'distributed guessing is not a way round it');

// With no source — the office PC's own window — behaviour is what it always was.
auth.resetLoginThrottle();
for (let i = 0; i < 6; i++) s = auth.authenticate(db, { username: 'adjei', password: 'no' });
ck('at the office PC, with no source, the account still locks as it always did',
  /too many/i.test(s.error || ''));

// ── the cost factor, and moving old hashes up ───────────────────────────────

ck(`a new hash is made at cost ${hashing.BCRYPT_COST}`,
  hashing.costOf(hashing.hashPassword('abcdefgh')) === hashing.BCRYPT_COST);
ck('...and 12 is at least the 12 this file claims', hashing.BCRYPT_COST >= 12);

const legacy = require('bcryptjs').hashSync('correct horse', 10);
ck('a hash made at the old cost is recognised as stale', hashing.isStale(legacy) === true);
ck('...and a current one is not', hashing.isStale(hashing.hashPassword('x')) === false);

db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(legacy, 'adjei');
auth.resetLoginThrottle();
ck('an account on an old hash still signs in — nobody is locked out by the change',
  auth.authenticate(db, { username: 'adjei', password: 'correct horse', source: '10.0.0.1' }).ok === true);
ck('...and its hash has been quietly moved up to the current cost',
  hashing.costOf(db.prepare("SELECT password_hash h FROM users WHERE username = 'adjei'").get().h)
    === hashing.BCRYPT_COST);

// ── self-registration is gone ───────────────────────────────────────────────

ck('there is no parent self-registration function to call any more',
  typeof parents.registerParent === 'undefined');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
