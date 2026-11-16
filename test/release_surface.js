// Nickland Edusoft — the parent portal is off, and staff are untouched.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The parent/student portal is disabled for this release. "Disabled" has to
// mean two things at once, and a test that checks only the first is worse than
// none:
//
//   off     no parent can sign in, no parent token works, and no parent route
//           answers — on the LAN, on the desktop host, or in the cloud
//   intact  the parents table keeps its rows, provisioning still works, and
//           EVERY STAFF SURFACE behaves exactly as before
//
// The second is the one at risk. Staff and parents ship from one Expo bundle
// and share one sign-in box, so a careless switch takes the teachers' app down
// with the parents'.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`These tests need Node >= 22.5 for node:sqlite (running ${process.versions.node}).`);
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { SCHEMA, runMigrations, seedDefaults } = require(path.join(ROOT, 'electron/db/database.js'));
const { createApiServer } = require(path.join(ROOT, 'electron/server/api.js'));
const parentsLib = require(path.join(ROOT, 'electron/server/parents.js'));
const release = require(path.join(ROOT, 'electron/release.js'));
const hashing = require(path.join(ROOT, 'electron/ipc/_hashing.js'));

let pass = 0, fail = 0;
const ck = (n, c, extra) => {
  c ? pass++ : fail++;
  console.log((c ? '✓ ' : '✗ ') + n + (extra !== undefined ? '  ' + extra : ''));
};

function req(base, method, p, { token, body } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(base + p);
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(out); } catch (_) {}
        resolve({ status: res.statusCode, json, body: out });
      });
    });
    r.on('error', () => resolve({ status: 0, json: null, body: '' }));
    if (data) r.write(data);
    r.end();
  });
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

(async () => {
  ck('the parent portal is off in this release', release.parentPortalEnabled() === false);
  ck('...and the refusal tells a parent who to ask, not that they are forbidden',
    /school office/i.test(release.PARENT_PORTAL_OFF));

  const db = makeDb();

  // A school with a pupil, a parent account the office already made, and a
  // member of staff.
  // seedDefaults already ships the classes a real school has, so use one of
  // those rather than inventing a duplicate name.
  const cls = db.prepare("SELECT id FROM class_groups ORDER BY level_order LIMIT 1").get();
  const stu = db.prepare(`INSERT INTO students (index_number, surname, first_name, current_class_id, status, mother_contact)
                          VALUES ('AVE/001','ANSU','Mona',?, 'Active','0244111222') RETURNING id`).get(cls.id);
  const prov = parentsLib.provisionParent(db, {
    full_name: 'Mrs Ansu', phone: '0244111222', password: 'parent1234', studentIds: [stu.id],
  });
  ck('the office can still provision a parent account — the data path is intact',
    prov.ok === true);
  ck('...and the row is really there', db.prepare('SELECT COUNT(*) c FROM parents').get().c === 1);
  ck('...linked to the child', db.prepare('SELECT COUNT(*) c FROM parent_students').get().c >= 1);

  const desig = db.prepare("SELECT id FROM designations WHERE name IN ('Super Admin','Administrator') ORDER BY name LIMIT 1").get();
  db.prepare(`INSERT INTO staff (surname, first_name, role, status, staff_number)
              VALUES ('ADJEI','Grace','Non-Teaching','Active','S/1')`).run();
  const staffId = db.prepare("SELECT id FROM staff WHERE staff_number='S/1'").get().id;
  db.prepare(`INSERT INTO users (username, password_hash, full_name, designation_id, staff_id, is_active)
              VALUES ('adjei', ?, 'Grace Adjei', ?, ?, 1)`)
    .run(hashing.hashPassword('correct horse'), desig.id, staffId);

  const server = createApiServer(db, {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // ── the portal is off ─────────────────────────────────────────────────────
  let r = await req(base, 'POST', '/api/v1/auth/parent/login',
    { body: { identifier: '0244111222', password: 'parent1234' } });
  ck('a parent cannot sign in, even with the right password', r.status === 403);
  ck('...and is told who to ask', /school office/i.test((r.json && r.json.error) || ''));

  r = await req(base, 'POST', '/api/v1/auth/signin',
    { body: { identifier: '0244111222', password: 'parent1234' } });
  ck('nor through the single sign-in box', r.status === 401);
  ck('...which says nothing about whether the account exists',
    !/parent|portal|disabled/i.test((r.json && r.json.error) || ''));

  r = await req(base, 'POST', '/api/v1/auth/parent/register',
    { body: { phone: '0244111222', password: 'parent1234' } });
  ck('and self-registration is still gone', r.status === 403);

  // A token issued BEFORE the switch must stop working, not outlive it.
  const tokens = require(path.join(ROOT, 'electron/server/tokens.js'));
  const legacy = tokens.issueToken(db, 'parent', prov.parent_id, { deviceName: 'old phone' });
  for (const p of ['/api/v1/parent/children', '/api/v1/me']) {
    r = await req(base, 'GET', p, { token: legacy.token });
    ck(`a parent token issued earlier no longer opens ${p}`, r.status === 401, `got ${r.status}`);
  }

  // ── staff are untouched ───────────────────────────────────────────────────
  r = await req(base, 'POST', '/api/v1/auth/signin',
    { body: { identifier: 'adjei', password: 'correct horse' } });
  ck('a member of staff still signs in', r.status === 200 && r.json.role === 'staff', `got ${r.status}`);
  const staffToken = r.json && r.json.token;

  r = await req(base, 'GET', '/api/v1/me', { token: staffToken });
  ck('...and their own record answers', r.status === 200 && r.json.role === 'staff');

  r = await req(base, 'GET', '/api/v1/students', { token: staffToken });
  ck('...and the roll, which is the surface that would break if this were done carelessly',
    r.status === 200 && Array.isArray(r.json.students));

  r = await req(base, 'GET', '/api/v1/classes', { token: staffToken });
  ck('...and the classes', r.status === 200);

  r = await req(base, 'GET', '/api/v1/health');
  ck('the school still answers a health check', r.status === 200 && r.json.ok === true);

  r = await req(base, 'GET', '/api/v1/info');
  ck('...and /info no longer advertises parent self-registration',
    r.status === 200 && r.json.parent_self_register === false);

  server.close();

  // ── the flag really is a flag ─────────────────────────────────────────────
  // Not asserted by flipping the live server — the point is that one
  // environment variable is the whole of it, so the portal can come back
  // without a code change.
  process.env.EDUSOFT_PARENT_PORTAL = '1';
  delete require.cache[require.resolve(path.join(ROOT, 'electron/release.js'))];
  const reloaded = require(path.join(ROOT, 'electron/release.js'));
  ck('one environment variable brings the portal back', reloaded.parentPortalEnabled() === true);
  delete process.env.EDUSOFT_PARENT_PORTAL;

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
