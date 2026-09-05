// The teacher-off-LAN round trip, end to end, against the real cloud server
// and the real desktop database.
//
//   desktop projects staff + rosters  →  teacher signs into the CLOUD
//   →  marks a register, enters scores, collects canteen money, sets homework
//   →  reloads and sees their own pending work
//   →  the desktop comes back, pulls, and applies it to the real tables
//
// The desktop is genuinely offline for the middle of that: nothing in this
// test lets the teacher reach it. Runs on node:sqlite and the in-memory cloud
// store, so it needs no native build and no Postgres.
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
const { getSetting, setSetting } = require(path.join(ROOT, 'electron/utils/idgen.js'));
const outbox = require(path.join(ROOT, 'electron/server/sync/outbox.js'));
const staffProjection = require(path.join(ROOT, 'electron/server/sync/staff_projection.js'));
const syncClient = require(path.join(ROOT, 'electron/server/sync/client.js'));
const bcrypt = require(path.join(ROOT, 'node_modules/bcryptjs'));

let pass = 0, fail = 0;
const ck = (n, c) => { c ? pass++ : fail++; console.log((c ? '✓' : '✗') + ' ' + n); };

function req(base, method, p, { token, body, key } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(base + p);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (key) headers['x-school-key'] = key;
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

(async () => {
  // ── a school, a teacher, a class, three pupils ──
  const db = makeDesktop();

  const desig = db.prepare("SELECT id FROM designations WHERE name = 'Teacher'").get()
             || db.prepare("SELECT id FROM designations WHERE name = 'Administrator'").get();
  db.prepare(`INSERT INTO users (username, password_hash, full_name, designation_id, is_active)
              VALUES (?, ?, ?, ?, 1)`)
    .run('owusu', bcrypt.hashSync('teach123', 8), 'Mr Owusu', desig ? desig.id : null);
  const userId = db.prepare('SELECT id FROM users WHERE username = ?').get('owusu').id;

  // A teacher who can mark registers, enter scores, take canteen money and set
  // homework — granted explicitly so the test does not depend on which
  // designation defaults happen to ship.
  for (const [m, v, c, e] of [['students', 1, 0, 1], ['academics', 1, 1, 1], ['canteen', 1, 1, 1], ['dashboard', 1, 0, 0], ['fees', 1, 0, 0]]) {
    db.prepare(`INSERT INTO user_permission_overrides (user_id, module, can_view, can_create, can_edit, can_delete)
                VALUES (?, ?, ?, ?, ?, 0)`).run(userId, m, v, c, e);
  }

  db.prepare("INSERT INTO class_groups (name, short_code, level_category, level_order) VALUES ('Basic 5', 'B5', 'Primary', 5)").run();
  const classId = db.prepare("SELECT id FROM class_groups WHERE name = 'Basic 5'").get().id;

  // Mr Owusu is the class teacher of Basic 5. A teacher assigned to nothing
  // now reaches nothing — the desktop's rule, and the cloud enforces the same
  // one — so a teacher who is meant to work has to be given their class, which
  // is what a school actually does.
  db.prepare(`INSERT INTO staff (id, surname, first_name, role, status, staff_number)
              VALUES (1, 'OWUSU', 'Kwabena', 'Teaching', 'Active', 'STAFF/0001')`).run();
  db.prepare('UPDATE users SET staff_id = 1 WHERE id = ?').run(userId);
  db.prepare(`INSERT INTO staff_assignments (staff_id, class_group_id, subject_id, is_class_teacher)
              VALUES (1, ?, NULL, 1)`).run(classId);
  db.prepare("INSERT INTO subjects (name, code, is_active) VALUES ('Mathematics', 'MTH', 1)").run();
  const subjectId = db.prepare("SELECT id FROM subjects WHERE code = 'MTH'").get().id;
  db.exec("INSERT INTO academic_years (id, label, is_current) VALUES (1, '2025/2026', 1)");
  db.exec("INSERT INTO terms (id, academic_year_id, term_number, label, is_current) VALUES (3, 1, 3, 'Third Term', 1)");

  const pupils = [];
  for (const [idx, sur, first] of [['AVE/001', 'ANSU', 'Monalisa'], ['AVE/002', 'BOATENG', 'Kwame'], ['AVE/003', 'MENSAH', 'Ama']]) {
    db.prepare(`INSERT INTO students (index_number, surname, first_name, current_class_id, status)
                VALUES (?, ?, ?, ?, 'Active')`).run(idx, sur, first, classId);
    pupils.push(db.prepare('SELECT id FROM students WHERE index_number = ?').get(idx).id);
  }

  // ── the cloud ──
  const store = createMemoryStore();
  const { school_id, api_key } = await store.createSchool({ name: 'Ave Maria School' });
  const server = createServer(store);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  setSetting(db, 'cloud_base_url', base, 'cloud');
  setSetting(db, 'school_api_key', api_key, 'cloud');
  setSetting(db, 'cloud_school_id', school_id, 'cloud');

  // ── the desktop projects itself, then goes off ──
  const backfill = outbox.backfillAll(db);
  ck('backfill projects staff accounts and classes', backfill.ok && backfill.counts.staff >= 1 && backfill.counts.classes >= 1);
  const pushed = await syncClient.push(db);
  ck('projections reach the cloud', pushed.ok && pushed.pushed > 0);

  const snaps = await store.listSnapshots(school_id, 'staff_auth');
  ck('the cloud holds the teacher account', snaps.length === 1 && snaps[0].payload.username === 'owusu');
  ck('the password hash is projected, not the password',
    /^\$2[aby]\$/.test(snaps[0].payload.password_hash) && !JSON.stringify(snaps[0].payload).includes('teach123'));

  // From here until the desktop syncs again, the school's PC is off. Nothing
  // below touches `db` until we say so.

  // ── sign in from home ──
  let r = await req(base, 'POST', '/api/v1/staff/login', { body: { school_id, username: 'owusu', password: 'wrong' } });
  ck('wrong password → 401', r.status === 401);

  r = await req(base, 'POST', '/api/v1/staff/login', { body: { school_id, username: 'owusu', password: 'teach123' } });
  ck('teacher signs in over the internet', r.status === 200 && !!r.json.token);
  const token = r.json.token;

  // These credentials are on the public internet now, so guessing has to cost
  // something. Verified rather than assumed: the desktop's API throttles its
  // login and this one has to as well.
  const ratelimit = require('../src/ratelimit');
  let refused = 0;
  for (let i = 0; i < 40; i++) {
    const a = await req(base, 'POST', '/api/v1/staff/login', { body: { school_id, username: 'owusu', password: 'guess' + i } });
    if (a.status === 429) refused++;
  }
  ck('password guessing is throttled', refused > 0);
  ck('and a correct password is refused too once the limit is hit',
    (await req(base, 'POST', '/api/v1/staff/login', { body: { school_id, username: 'owusu', password: 'teach123' } })).status === 429);
  ratelimit.reset();
  ck('the throttle lifts', (await req(base, 'POST', '/api/v1/staff/login', { body: { school_id, username: 'owusu', password: 'teach123' } })).status === 200);

  r = await req(base, 'GET', '/api/v1/staff/me', { token });
  ck('me returns the staff profile and permissions',
    r.json.ok && r.json.role === 'staff' && r.json.user.full_name === 'Mr Owusu' && r.json.permissions.academics.canEdit === true);

  ck('no token → 401', (await req(base, 'GET', '/api/v1/staff/students')).status === 401);

  // A parent token must not open a staff endpoint, or the other way round.
  const pauth = require('../src/portal_auth');
  const parentToken = pauth.signToken({ school_id, parent_id: 1 });
  ck('a parent token is refused by staff endpoints', (await req(base, 'GET', '/api/v1/staff/me', { token: parentToken })).status === 401);
  ck('a staff token is refused by parent endpoints', (await req(base, 'GET', '/api/v1/portal/children', { token })).status === 401);

  // ── the screens ──
  r = await req(base, 'GET', '/api/v1/staff/classes', { token });
  ck('classes list', r.json.ok && r.json.classes.length === 1 && r.json.classes[0].name === 'Basic 5');

  r = await req(base, 'GET', '/api/v1/staff/students', { token });
  ck('roster lists the class', r.json.ok && r.json.students.length === 3);

  r = await req(base, 'GET', '/api/v1/staff/dashboard', { token });
  ck('dashboard metrics', r.json.ok && r.json.metrics.students === 3);

  const today = new Date().toISOString().slice(0, 10);
  r = await req(base, 'GET', `/api/v1/staff/attendance?classId=${classId}&date=${today}`, { token });
  ck('register starts unmarked', r.json.ok && r.json.students.length === 3 && r.json.students.every(s => s.status === null));

  // ── mark the register, with the school's PC still off ──
  r = await req(base, 'POST', '/api/v1/staff/attendance', {
    token,
    body: { date: today, marks: [
      { student_id: pupils[0], status: 'present' },
      { student_id: pupils[1], status: 'absent', notes: 'Sick' },
      { student_id: pupils[2], status: 'late', notes: 'Funeral at Techiman' },
    ] },
  });
  ck('register submitted and queued', r.json.ok && r.json.queued === true && r.json.saved === 3);

  // The bit that decides whether a teacher trusts the app: reload, see it.
  r = await req(base, 'GET', `/api/v1/staff/attendance?classId=${classId}&date=${today}`, { token });
  const marked = Object.fromEntries(r.json.students.map(s => [s.id, s]));
  ck('the teacher sees their own marks after reloading',
    marked[pupils[0]].status === 'present' && marked[pupils[1]].status === 'absent' && marked[pupils[1]].notes === 'Sick');
  ck('and they are flagged as not yet at the school', r.json.students.every(s => s.pending === true));

  // ── scores ──
  r = await req(base, 'POST', '/api/v1/staff/scores', {
    token, body: { subjectId, marks: [{ student_id: pupils[0], exam_score: 82 }, { student_id: pupils[1], exam_score: 71 }] },
  });
  ck('scores queued', r.json.ok && r.json.saved === 2);

  r = await req(base, 'POST', '/api/v1/staff/scores', { token, body: { subjectId, marks: [{ student_id: pupils[0], exam_score: 140 }] } });
  ck('an impossible score is refused while the teacher is still looking at it', r.status === 400);

  r = await req(base, 'GET', `/api/v1/staff/scores?classId=${classId}&subjectId=${subjectId}`, { token });
  const sheet = Object.fromEntries(r.json.students.map(s => [s.id, s]));
  ck('the score sheet shows the queued marks', sheet[pupils[0]].exam_score === 82 && sheet[pupils[0]].pending === true);
  ck('and no invented total for a mark the school has not weighted yet', sheet[pupils[0]].total_score === null);

  // ── canteen + homework ──
  r = await req(base, 'POST', '/api/v1/staff/canteen/collect', { token, body: { student_id: pupils[0], amount: 25, payment_method: 'Cash' } });
  ck('canteen collection queued', r.json.ok && r.json.queued === true);
  ck('no receipt number is invented for it', r.json.receipt_number === null);

  r = await req(base, 'POST', '/api/v1/staff/homework', { token, body: { classId, subjectId, title: 'Fractions p.42', dueDate: today, maxMarks: 10 } });
  ck('homework queued', r.json.ok && r.json.queued === true);
  r = await req(base, 'GET', `/api/v1/staff/homework?classId=${classId}`, { token });
  ck('the teacher sees the homework they just set', r.json.ok && r.json.homework.some(h => h.title === 'Fractions p.42' && h.pending));

  // Four writes went through; the out-of-range score was refused, not queued.
  r = await req(base, 'GET', '/api/v1/staff/pending', { token });
  ck('the account screen can say how much is waiting', r.json.ok && r.json.pending === 4);

  // ── the school's desktop comes back ──
  const pulled = await syncClient.pull(db);
  ck('the desktop pulls the queued work', pulled.ok && pulled.applied === 4);

  const att = db.prepare('SELECT student_id, status, notes, marked_by FROM student_attendance WHERE date = ?').all(today);
  ck('the register is in the school database', att.length === 3);
  ck('an absence kept its note', att.find(a => a.student_id === pupils[1]).status === 'absent' && att.find(a => a.student_id === pupils[1]).notes === 'Sick');
  // The reason on a LATE pupil used to be dropped by the applier — `status ===
  // 'absent' ? notes : null` — so a note typed in a corridor with no signal
  // never reached the school it was typed for.
  ck('...and so did a late arrival, which used to be dropped on the way in',
    att.find(a => a.student_id === pupils[2]).status === 'late'
    && att.find(a => a.student_id === pupils[2]).notes === 'Funeral at Techiman');
  ck('the work is attributed to the teacher who did it', att.every(a => a.marked_by === userId));

  const sc = db.prepare('SELECT student_id, exam_score, total_score FROM scores WHERE subject_id = ?').all(subjectId);
  ck('the scores are in, and weighted by the desktop', sc.length === 2 && sc.find(x => x.student_id === pupils[0]).exam_score === 82 && sc.find(x => x.student_id === pupils[0]).total_score != null);

  const cant = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(amount),0) t FROM canteen_payments').get();
  ck('the canteen money is banked once', cant.c === 1 && Number(cant.t) === 25);

  const hwRow = db.prepare('SELECT title, class_group_id FROM homework').all();
  ck('the homework is set on the class', hwRow.length === 1 && hwRow[0].title === 'Fractions p.42');

  // ── redelivery must not double anything ──
  setSetting(db, 'cloud_cursor', '0', 'cloud');
  const again = await syncClient.pull(db);
  ck('a redelivered batch applies without error', again.ok);
  const cant2 = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(amount),0) t FROM canteen_payments').get();
  ck('the canteen money is NOT taken twice', cant2.c === 1 && Number(cant2.t) === 25);
  ck('the homework is NOT set twice', db.prepare('SELECT COUNT(*) c FROM homework').get().c === 1);
  ck('the register is unchanged', db.prepare('SELECT COUNT(*) c FROM student_attendance WHERE date = ?').get(today).c === 3);

  // ── the pending list drains once the school has the work ──
  // Push first, so the rebuilt rosters carry the applied marks; then pull
  // again. The cloud only counts a change as delivered when the desktop comes
  // back for the NEXT batch — asking for everything after 4 is the receipt for
  // 1 to 4. Serving a change is not evidence the desktop managed to apply it,
  // so the conservative reading is the correct one: a teacher is told their
  // work is still in flight for one sync cycle longer than it really is,
  // rather than being told it has landed when it has not.
  await syncClient.push(db);
  await syncClient.pull(db);
  r = await req(base, 'GET', '/api/v1/staff/pending', { token });
  ck('nothing is left waiting', r.json.ok && r.json.pending === 0);

  r = await req(base, 'GET', `/api/v1/staff/attendance?classId=${classId}&date=${today}`, { token });
  ck('and the register now reads from the school itself, not the queue',
    r.json.students.every(s => s.status !== null) && r.json.students.every(s => s.pending === undefined));

  // ── a teacher reaches their own classes and no others ──
  // The rule the school asked for, enforced over the internet as well: what
  // you are not assigned to, you cannot see. Without this the cloud served
  // every class in the school to every teacher — the desktop's rule ignored
  // the moment they picked up a phone.
  db.prepare("INSERT INTO class_groups (name, short_code, level_category, level_order) VALUES ('Basic 6', 'B6', 'Primary', 6)").run();
  const otherClassId = db.prepare("SELECT id FROM class_groups WHERE name = 'Basic 6'").get().id;
  db.prepare(`INSERT INTO students (index_number, surname, first_name, current_class_id, status)
              VALUES ('AVE/099', 'OTHER', 'Pupil', ?, 'Active')`).run(otherClassId);
  staffProjection.enqueueClassRoster(db, otherClassId);
  staffProjection.enqueueStaffAuth(db, userId);
  await syncClient.push(db);

  r = await req(base, 'GET', '/api/v1/staff/classes', { token });
  ck('the class list holds only the teacher’s own class',
    r.json.ok && r.json.classes.length === 1 && r.json.classes[0].id === classId);

  r = await req(base, 'GET', `/api/v1/staff/attendance?classId=${otherClassId}&date=${today}`, { token });
  ck('another class’s register is empty, not served', r.json.ok && r.json.students.length === 0);

  r = await req(base, 'GET', '/api/v1/staff/students', { token });
  ck('the roll holds nobody from a class they do not teach',
    r.json.ok && !r.json.students.some(s => s.surname === 'OTHER'));

  r = await req(base, 'POST', '/api/v1/staff/attendance', {
    token, body: { classId: otherClassId, date: today, marks: [{ student_id: 999, status: 'present' }] },
  });
  ck('marking another class’s register is refused outright', r.status === 403);

  // ── revoking an account cuts the session off ──
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(userId);
  staffProjection.enqueueStaffAuth(db, userId);
  await syncClient.push(db);
  ck('a revoked teacher is signed out on their next request',
    (await req(base, 'GET', '/api/v1/staff/me', { token })).status === 401);

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
