// Passwords, end to end — the two things a teacher away from the school
// actually needs, and the guarantees that make them safe to offer.
//
//   changing one  : verified against the projection, applied there at once so
//                   the next request works, and queued for the desktop as a
//                   hash. The school's own database ends up with it.
//   forgetting one: raised from the phone, approved BY A PERSON on the
//                   desktop, redeemed with a six-digit code the approver read
//                   out. The cloud can check a code; it can never grant one.
//
// The school's computer is genuinely off for the middle of each of these.
const http = require('http');
const path = require('path');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`These tests need Node >= 22.5 for node:sqlite (running ${process.versions.node}).`);
  process.exit(1);
}

process.env.ALLOW_DEV_SECRET = '1';

const { DatabaseSync } = require('node:sqlite');
const ROOT = path.resolve(__dirname, '..', '..');
const { createServer } = require('../src/server');
const { createMemoryStore } = require('../src/store');
const { SCHEMA, runMigrations } = require(path.join(ROOT, 'electron/db/database.js'));
const { setSetting } = require(path.join(ROOT, 'electron/utils/idgen.js'));
const outbox = require(path.join(ROOT, 'electron/server/sync/outbox.js'));
const staffProjection = require(path.join(ROOT, 'electron/server/sync/staff_projection.js'));
const syncClient = require(path.join(ROOT, 'electron/server/sync/client.js'));
const bcrypt = require(path.join(ROOT, 'node_modules/bcryptjs'));
const crypto = require('crypto');

let pass = 0, fail = 0;
const ck = (n, c) => { c ? pass++ : fail++; console.log((c ? '✓' : '✗') + ' ' + n); };

function req(base, method, p, { token, body } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(base + p);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, json: null }); } });
    });
    r.on('error', () => resolve({ status: 0, json: null }));
    if (data) r.write(data); r.end();
  });
}

function makeDesktop() {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...a) => {
    db.exec('BEGIN');
    try { const r = fn(...a); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  db.exec(SCHEMA);
  runMigrations(db);
  setSetting(db, 'cloud_sync_enabled', true, 'cloud');
  setSetting(db, 'school_name', 'Ave Maria School', 'test');
  return db;
}

const hashOf = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

(async () => {
  const db = makeDesktop();
  const desig = db.prepare("SELECT id FROM designations WHERE name = 'Teacher'").get()
             || db.prepare("SELECT id FROM designations WHERE name = 'Administrator'").get();
  db.prepare(`INSERT INTO users (username, password_hash, full_name, designation_id, is_active, must_change_password)
              VALUES (?, ?, ?, ?, 1, 0)`)
    .run('owusu', bcrypt.hashSync('teach123', 8), 'Mr Owusu', desig ? desig.id : null);
  const userId = db.prepare('SELECT id FROM users WHERE username = ?').get('owusu').id;
  db.prepare(`INSERT INTO user_permission_overrides (user_id, module, can_view, can_create, can_edit, can_delete)
              VALUES (?, 'dashboard', 1, 0, 0, 0)`).run(userId);

  const store = createMemoryStore();
  const { school_id, api_key } = await store.createSchool({ name: 'Ave Maria School' });
  const server = createServer(store);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  setSetting(db, 'cloud_base_url', base, 'cloud');
  setSetting(db, 'school_api_key', api_key, 'cloud');
  setSetting(db, 'cloud_school_id', school_id, 'cloud');

  outbox.backfillAll(db);
  await syncClient.push(db);

  // ══ 1. changing a password from the phone ══
  let r = await req(base, 'POST', '/api/v1/staff/login', { body: { school_id, username: 'owusu', password: 'teach123' } });
  ck('teacher signs in over the internet', r.status === 200 && !!r.json.token);
  const token = r.json.token;

  r = await req(base, 'POST', '/api/v1/staff/password', { token, body: { currentPassword: 'nope', newPassword: 'brandnew1' } });
  ck('the wrong current password is refused', r.status === 401);

  r = await req(base, 'POST', '/api/v1/staff/password', { token, body: { currentPassword: 'teach123', newPassword: 'short' } });
  ck('a password under six characters is refused', r.status === 400);

  r = await req(base, 'POST', '/api/v1/staff/password', { token, body: { currentPassword: 'teach123', newPassword: 'brandnew1' } });
  ck('the password changes', r.status === 200 && r.json.ok);

  // The point of updating the projection rather than only queueing: the
  // teacher does not have to wait for the school to open to use it.
  r = await req(base, 'POST', '/api/v1/staff/login', { body: { school_id, username: 'owusu', password: 'brandnew1' } });
  ck('the new password works at once, with the school still off', r.status === 200);
  r = await req(base, 'POST', '/api/v1/staff/login', { body: { school_id, username: 'owusu', password: 'teach123' } });
  ck('the old one stops working at once', r.status === 401);

  const queued = await store.pendingChanges(school_id, { types: ['staff_password_change'] });
  ck('the change is queued for the desktop', queued.length === 1);
  ck('as a hash — the password itself never reaches the queue',
    /^\$2[aby]\$/.test(queued[0].payload.new_hash) && !JSON.stringify(queued[0].payload).includes('brandnew1'));

  // ── the school's computer comes back ──
  await syncClient.pull(db);
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  ck('the school database now has the new password', bcrypt.compareSync('brandnew1', row.password_hash));
  ck('and not the old one', !bcrypt.compareSync('teach123', row.password_hash));

  // ══ 2. forgetting a password ══
  r = await req(base, 'POST', '/api/v1/staff/password-reset/request', {
    body: { school_id, username: 'owusu', reason: 'forgot over the holidays', source: 'mobile' },
  });
  ck('a reset can be asked for without signing in', r.status === 200 && r.json.ok);

  r = await req(base, 'POST', '/api/v1/staff/password-reset/request', {
    body: { school_id, username: 'nobody-at-all' },
  });
  ck('an unknown username gets the same answer as a real one', r.status === 200 && r.json.ok);

  // Nothing has been granted. Without approval the code space is all that
  // stands between a stranger and the account, so this must fail.
  r = await req(base, 'POST', '/api/v1/staff/password-reset/complete', {
    body: { school_id, username: 'owusu', code: '000000', newPassword: 'hijacked1' },
  });
  ck('no approval means no reset, whatever code is guessed', r.status === 400);

  await syncClient.pull(db);
  const pending = db.prepare("SELECT * FROM password_reset_requests WHERE status = 'pending'").all();
  ck('the request is waiting for a person on the desktop', pending.length === 1 && pending[0].username === 'owusu');
  ck('it says where it came from', pending[0].requested_from === 'mobile');
  ck('the made-up username left no request behind',
    db.prepare('SELECT COUNT(*) c FROM password_reset_requests').get().c === 1);

  // The Administrator approves it, exactly as the Settings screen does.
  const code = '482913';
  db.prepare(`UPDATE password_reset_requests
              SET status = 'approved', claim_hash = ?, claim_expires_at = datetime('now', '+24 hours')
              WHERE id = ?`).run(hashOf(code), pending[0].id);
  staffProjection.enqueueResetClaim(db, pending[0].id);
  await syncClient.push(db);

  r = await req(base, 'POST', '/api/v1/staff/password-reset/complete', {
    body: { school_id, username: 'owusu', code: '111111', newPassword: 'hijacked1' },
  });
  ck('a wrong code is still refused after approval', r.status === 400);

  const claim = (await store.listSnapshots(school_id, 'staff_reset_claim')).map(s => s.payload)[0];
  ck('only the hash of the code is projected, never the code',
    claim && claim.claim_hash === hashOf(code) && !JSON.stringify(claim).includes(code));

  r = await req(base, 'POST', '/api/v1/staff/password-reset/complete', {
    body: { school_id, username: 'owusu', code, newPassword: 'afterreset1' },
  });
  ck('the right code sets the new password', r.status === 200 && r.json.ok);

  r = await req(base, 'POST', '/api/v1/staff/login', { body: { school_id, username: 'owusu', password: 'afterreset1' } });
  ck('the teacher can sign in with it straight away', r.status === 200);

  // A code that stayed spendable would be a standing key to the account.
  r = await req(base, 'POST', '/api/v1/staff/password-reset/complete', {
    body: { school_id, username: 'owusu', code, newPassword: 'again12345' },
  });
  ck('the same code cannot be spent twice', r.status === 400);

  await syncClient.pull(db);
  const after = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  ck('the school database has the reset password too', bcrypt.compareSync('afterreset1', after.password_hash));

  // ══ 3. an expired approval ══
  db.prepare(`INSERT INTO password_reset_requests (user_id, username, status, claim_hash, claim_expires_at)
              VALUES (?, 'owusu', 'approved', ?, datetime('now', '-1 hour'))`).run(userId, hashOf('777777'));
  const stale = db.prepare('SELECT id FROM password_reset_requests ORDER BY id DESC LIMIT 1').get().id;
  staffProjection.enqueueResetClaim(db, stale);
  await syncClient.push(db);
  r = await req(base, 'POST', '/api/v1/staff/password-reset/complete', {
    body: { school_id, username: 'owusu', code: '777777', newPassword: 'toolate123' },
  });
  ck('an approval that ran out of time is refused', r.status === 400);

  // ══ 4. a temporary password an administrator set ══
  db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(userId);
  staffProjection.enqueueStaffAuth(db, userId);
  await syncClient.push(db);
  r = await req(base, 'POST', '/api/v1/staff/login', { body: { school_id, username: 'owusu', password: 'afterreset1' } });
  const me = await req(base, 'GET', '/api/v1/staff/me', { token: r.json.token });
  ck('the phone is told the password must be changed first', me.json.must_change_password === true);

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
