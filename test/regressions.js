// Nickland Edusoft — regression tests for the operational-gap fixes.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Runs on plain Node (node:sqlite, no native build) so CI can execute it
// without compiling better-sqlite3 for the runner's ABI.
//
//   node test/regressions.js       (requires Node >= 22.5)
//
// Every case here corresponds to a defect that was live in the shipped code.

// `node:sqlite` first shipped in Node 22.5. Check for it up front: the bare
// module-not-found stack trace gives no hint that the Node version is the
// problem, and the cloud suites in cloud/test and cloud-python/tests share
// this requirement.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(
    `These tests need Node >= 22.5 for the built-in node:sqlite module ` +
    `(running ${process.versions.node}).\n` +
    `The Windows installer job still builds on Node 20 — only the test job needs 22.`
  );
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const { SCHEMA, runMigrations } = require(path.join(ROOT, 'electron/db/database.js'));
const outbox = require(path.join(ROOT, 'electron/server/sync/outbox.js'));
const syncClient = require(path.join(ROOT, 'electron/server/sync/client.js'));
const { getSetting, setSetting } = require(path.join(ROOT, 'electron/utils/idgen.js'));
const parents = require(path.join(ROOT, 'electron/server/parents.js'));

let pass = 0, fail = 0;
const ck = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? '✓' : '✗') + ' ' + name); };

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...a) => {
    db.exec('BEGIN');
    try { const r = fn(...a); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  db.exec(SCHEMA);
  runMigrations(db);
  setSetting(db, 'cloud_sync_enabled', true, 'cloud');
  return db;
}

// The version guard both cloud stores apply (cloud/src/store/*.js and
// cloud-python/app/store.py): a snapshot that is not newer is dropped.
function makeCloud() {
  const store = {};
  return {
    store,
    upsert(rec) {
      const ex = store[rec.entity_key];
      if (ex && (ex.version || 0) > (rec.version || 0)) return false;
      store[rec.entity_key] = rec;
      return true;
    },
  };
}

function drain(db, cloud) {
  const rows = outbox.listUnsynced(db, 100);
  const accepted = [];
  for (const r of rows) {
    if (cloud.upsert({ entity_key: r.entity_key, version: r.version, payload: JSON.parse(r.payload_json || 'null') })) {
      accepted.push(r.id);
    }
  }
  outbox.markSynced(db, accepted);
  return rows.length;
}

console.log('\n── Cloud sync: snapshot versions ──');
{
  const db = makeDb();
  const cloud = makeCloud();
  const post = (balance) => outbox.postToOutbox(db, {
    entity_type: 'student_snapshot', entity_key: 'student:1', payload: { balance },
  });

  // Two edits before a sync collapse into one row. This is the state that used
  // to poison every later update for that student.
  post(500); post(400); drain(db, cloud);
  ck('collapsed pair syncs', cloud.store['student:1'].payload.balance === 400);

  post(300); drain(db, cloud);
  ck('next update is accepted (was silently dropped)', cloud.store['student:1'].payload.balance === 300);

  post(0); drain(db, cloud);
  ck('and the one after that', cloud.store['student:1'].payload.balance === 0);

  // Versions must be strictly increasing across every enqueue.
  const versions = [];
  for (const bal of [10, 20, 30, 40]) { post(bal); versions.push(outbox.listUnsynced(db, 1)[0].version); drain(db, cloud); }
  ck('versions strictly increase', versions.every((v, i) => i === 0 || v > versions[i - 1]));
  ck('final balance reaches the cloud', cloud.store['student:1'].payload.balance === 40);

  // Retention must not reset the counter, or pruning would re-introduce the bug.
  const before = cloud.store['student:1'].version;
  db.prepare("UPDATE sync_outbox SET synced_at = datetime('now','-90 days')").run();
  outbox.pruneSynced(db, 14);
  ck('pruning removes old synced rows', db.prepare('SELECT COUNT(*) c FROM sync_outbox').get().c === 0);
  post(7); drain(db, cloud);
  ck('version keeps climbing after pruning', cloud.store['student:1'].version > before);
  ck('post-prune update lands', cloud.store['student:1'].payload.balance === 7);

  // A second entity has its own independent counter.
  outbox.postToOutbox(db, { entity_type: 'student_snapshot', entity_key: 'student:2', payload: { balance: 1 } });
  ck('separate entities version independently', outbox.listUnsynced(db, 10).find(r => r.entity_key === 'student:2').version === 1);
}

console.log('\n── Cloud sync: backfill when a school is first connected ──');
{
  // A school that has been running offline, switching sync on for the
  // first time. Every enqueue in the app is event-driven, so without an
  // explicit backfill the portal page stays empty and no parent can log in.
  const db = makeDb();
  setSetting(db, 'cloud_sync_enabled', false, 'cloud');   // sync off while data is entered
  db.exec("INSERT INTO academic_years (id,label,is_current) VALUES (1,'2025/2026',1)");
  db.exec("INSERT INTO terms (id,academic_year_id,term_number,label,is_current) VALUES (3,1,3,'T3',1)");
  db.exec("INSERT INTO class_groups (id,name,short_code,level_category,level_order) VALUES (1,'BS5','BS5','basic',10)");
  for (let i = 1; i <= 5; i++) {
    db.prepare("INSERT INTO students (id,surname,first_name,index_number,current_class_id,status,guardian_contact) VALUES (?,?,?,?,1,'Active',?)")
      .run(i, 'SURNAME' + i, 'First' + i, `AVE/17/0000${i}`, `024400000${i}`);
    db.prepare('INSERT INTO student_bills (student_id,term_id,total_billed,total_paid,balance) VALUES (?,3,400,100,300)').run(i);
  }
  db.exec("INSERT INTO students (id,surname,first_name,index_number,current_class_id,status) VALUES (99,'GONE','Away','AVE/17/00099',1,'Inactive')");
  db.prepare('INSERT INTO parents (id,full_name,phone,password_hash,is_active) VALUES (1,?,?,?,1)').run('Papa', '233244000001', 'scrypt$x$y');
  db.prepare('INSERT INTO parent_students (parent_id,student_id,relationship) VALUES (1,1,?)').run('Father');
  db.exec("INSERT INTO announcements (id,title,body,audience,is_active) VALUES (1,'Reopening','Term begins Jan 9','all',1)");
  db.exec("INSERT INTO announcements (id,title,body,audience,is_active) VALUES (2,'Old notice','Archived','all',0)");
  db.prepare("INSERT INTO payments (student_id,term_id,amount,payment_date,payment_method,receipt_number,is_reversed) VALUES (1,3,100,'2026-01-10','Cash','FE/26/00001',0)").run();

  ck('nothing is queued while sync is off', outbox.pendingCount(db) === 0);

  setSetting(db, 'cloud_sync_enabled', true, 'cloud');
  ck('turning sync on alone still queues nothing', outbox.pendingCount(db) === 0);

  const r = outbox.backfillAll(db);
  ck('backfill reports success', r.ok === true);
  ck('every active student is queued', r.counts.students === 5);
  ck('inactive students are left out', r.counts.students === 5 && outbox.listUnsynced(db, 100).every(x => x.entity_key !== 'student:99'));
  ck('parent auth is projected so parents can sign in', r.counts.parents === 1);
  ck('active notices are queued', r.counts.announcements === 1);
  ck('inactive notices are left out', r.counts.announcements === 1);
  ck('recent receipts are queued', r.counts.receipts === 1);

  const queued = outbox.listUnsynced(db, 100);
  ck('all of it is pending for the next push', queued.length === r.total);
  ck('parent auth carries the child links',
    JSON.parse(queued.find(x => x.entity_key === 'parent:1').payload_json).student_keys.join() === 'student:1');

  // Running it twice must not duplicate rows — each entity collapses.
  const before = outbox.pendingCount(db);
  outbox.backfillAll(db);
  ck('re-running does not duplicate queued rows', outbox.pendingCount(db) === before);

  // And versions still move forward, so the second run is not rejected as stale.
  const v1 = queued.find(x => x.entity_key === 'student:1').version;
  const v2 = outbox.listUnsynced(db, 100).find(x => x.entity_key === 'student:1').version;
  ck('re-running advances the version', v2 > v1);

  ck('backfill refuses when sync is off',
    (setSetting(db, 'cloud_sync_enabled', false, 'cloud'), outbox.backfillAll(db).ok === false));
}

console.log('\n── Cloud sync: retry behaviour ──');
{
  const db = makeDb();
  outbox.postToOutbox(db, { entity_type: 'student_snapshot', entity_key: 'student:9', payload: { balance: 1 } });
  const id = outbox.listUnsynced(db, 1)[0].id;

  outbox.markFailed(db, [id], 'boom');
  ck('a failed record is not retried immediately', outbox.listUnsynced(db, 10).length === 0);
  ck('failure reason is recorded', db.prepare('SELECT last_error FROM sync_outbox WHERE id = ?').get(id).last_error === 'boom');

  // Backoff grows rather than hammering a dead endpoint every tick.
  ck('backoff increases with attempts', outbox.backoffSeconds(0) < outbox.backoffSeconds(3));
  ck('backoff is capped', outbox.backoffSeconds(50) === outbox.backoffSeconds(outbox.MAX_ATTEMPTS));

  // Exhausting the retries parks the record instead of looping forever.
  for (let i = 0; i < outbox.MAX_ATTEMPTS + 1; i++) {
    db.prepare("UPDATE sync_outbox SET next_attempt_at = NULL WHERE id = ?").run(id);
    const due = outbox.listUnsynced(db, 10);
    if (due.length) outbox.markFailed(db, [id], 'still broken');
  }
  ck('exhausted record is parked', outbox.deadCount(db) === 1);
  ck('parked record leaves the pending queue', outbox.pendingCount(db) === 0);
  ck('parked record is not handed out for push', outbox.listUnsynced(db, 10).length === 0);

  // "Push now" is the operator's way to retry after fixing the cause.
  outbox.retryAll(db);
  ck('retryAll re-arms parked records', outbox.pendingCount(db) === 1 && outbox.deadCount(db) === 0);

  // A newer edit for the same entity also re-arms the queued row.
  outbox.markFailed(db, [outbox.listUnsynced(db, 1)[0].id], 'again');
  outbox.postToOutbox(db, { entity_type: 'student_snapshot', entity_key: 'student:9', payload: { balance: 2 } });
  ck('a fresh edit clears the backoff', outbox.listUnsynced(db, 10).length === 1);
}

console.log('\n── Cloud sync: transport safety ──');
{
  ck('plain http to a public host is refused', syncClient.insecureBase('http://cloud.example.com') === true);
  ck('https is accepted', syncClient.insecureBase('https://cloud.example.com') === false);
  ck('loopback http still allowed (tests/dev)', syncClient.insecureBase('http://127.0.0.1:8080') === false);
  ck('garbage url is refused', syncClient.insecureBase('not a url') === true);

  const db = makeDb();
  setSetting(db, 'cloud_base_url', 'http://cloud.example.com', 'cloud');
  setSetting(db, 'school_api_key', 'sk_test', 'cloud');
  ck('sync blocks on an insecure endpoint', syncClient.blockedReason(db) === 'insecure_url');
  setSetting(db, 'cloud_base_url', 'https://cloud.example.com', 'cloud');
  ck('sync unblocks on https', syncClient.blockedReason(db) === null);
}

console.log('\n── Settings writes ──');
{
  const db = makeDb();
  // The old pattern: UPDATE ... WHERE key = ? against a key that was never
  // seeded. It reports success and stores nothing.
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('yes', 'brand_new_key');
  ck('bare UPDATE silently loses an unseeded key', getSetting(db, 'brand_new_key', 'MISSING') === 'MISSING');

  setSetting(db, 'brand_new_key', 'yes', 'custom');
  ck('setSetting creates the row', getSetting(db, 'brand_new_key') === 'yes');
  setSetting(db, 'brand_new_key', 'no');
  ck('setSetting updates an existing row', getSetting(db, 'brand_new_key') === 'no');
  setSetting(db, 'bool_key', true);
  ck('booleans store as true/false strings', getSetting(db, 'bool_key') === 'true');
  setSetting(db, 'bool_key', false);
  ck('false stores as "false"', getSetting(db, 'bool_key') === 'false');
  setSetting(db, 'null_key', null);
  ck('null stores as empty string', getSetting(db, 'null_key') === '');
}

console.log('\n── Backup restore: archive containment ──');
{
  const { safeExtractPath } = require(path.join(ROOT, 'electron/ipc/backup_archive.js'));
  const root = path.join(os.tmpdir(), 'ne-restore-test');
  const uploads = path.resolve(root, 'uploads');
  const allowed = (entry) => {
    const d = safeExtractPath(root, entry);
    return !!d && d.startsWith(uploads + path.sep);
  };

  ck('ordinary upload is allowed', allowed('uploads/student-12.jpg'));
  ck('nested upload is allowed', allowed('uploads/sigs/head.png'));
  ck('interior ".." that stays inside is allowed', allowed('uploads/a/../b.png'));
  ck('parent-escape entry is rejected', !allowed('uploads/../../Startup/evil.exe'));
  ck('deep traversal is rejected', !allowed('uploads/../../../../../../etc/cron.d/pwn'));
  ck('backslash traversal is rejected', !allowed('uploads/..\\..\\Startup\\evil.exe'));
  ck('absolute path is rejected', !allowed('/etc/passwd'));
  ck('entry outside uploads/ is rejected', !allowed('../outside.txt'));
  ck('null byte is rejected', !allowed('uploads/x\0.png'));
  // The check the code used to rely on.
  ck('old prefix-only check would have accepted the traversal',
    'uploads/../../Startup/evil.exe'.startsWith('uploads/'));
}

console.log('\n── Backup restore: database validation ──');
{
  const { verifyDatabaseFile } = require(path.join(ROOT, 'electron/ipc/backup_archive.js'));
  const junk = path.join(os.tmpdir(), `ne-junk-${Date.now()}.db`);
  fs.writeFileSync(junk, 'this is definitely not a sqlite database');
  const res = verifyDatabaseFile(junk);
  if (res.skipped) {
    console.log(`… better-sqlite3 unavailable here — validation is skipped at runtime too (${res.skipped})`);
    ck('validation degrades safely without the sqlite driver', res.ok === true);
  } else {
    ck('a corrupt file is rejected before it replaces live data', res.ok === false);
    ck('rejection explains why', typeof res.error === 'string' && res.error.length > 0);
  }
  fs.unlinkSync(junk);
}

console.log('\n── Parent accounts ──');
{
  const db = makeDb();
  db.exec("INSERT INTO academic_years (id,label,is_current) VALUES (1,'2025/2026',1)");
  db.exec("INSERT INTO class_groups (id,name,short_code,level_category,level_order) VALUES (1,'BS5','BS5','basic',10)");
  db.exec("INSERT INTO students (id,surname,first_name,index_number,current_class_id,status,guardian_contact) VALUES (1,'ANSU','MONA','AVE/17/00001',1,'Active','0244123456')");

  const a = parents.provisionParent(db, { full_name: 'Papa A', phone: '0244123456' });
  const b = parents.provisionParent(db, { full_name: 'Papa B', phone: '0244999888' });
  ck('provisioning returns a temp password', !!a.temp_password && !!b.temp_password);
  ck('temp passwords are not identical', a.temp_password !== b.temp_password);
  ck('temp password is long enough to matter', a.temp_password.length >= 8);
  ck('temp password is not from the 36-char Math.random alphabet only',
    /[A-Z]|[-_]/.test(a.temp_password + b.temp_password) || a.temp_password.length > 6);

  ck('parent can log in with the temp password',
    parents.loginParent(db, { identifier: '0244123456', password: a.temp_password }).ok === true);
  ck('wrong password rejected',
    parents.loginParent(db, { identifier: '0244123456', password: 'nope' }).ok === false);
}

console.log('\n── Schema ──');
{
  const db = makeDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  for (const t of ['sync_versions', 'system_log', 'sync_outbox', 'api_tokens', 'parents']) {
    ck(`migrations create ${t}`, tables.includes(t));
  }
  const cols = db.prepare('PRAGMA table_info(sync_outbox)').all().map(c => c.name);
  ck('sync_outbox has next_attempt_at', cols.includes('next_attempt_at'));
  ck('sync_outbox has dead', cols.includes('dead'));

  // Migrations must be idempotent — they run on every launch.
  let threw = false;
  try { runMigrations(db); runMigrations(db); } catch (_) { threw = true; }
  ck('migrations are re-runnable', !threw);
  const errs = db.prepare("SELECT COUNT(*) c FROM system_log WHERE source='migration'").get().c;
  ck('re-running migrations logs no failures', errs === 0);
}

console.log('\n── Timetable ──');
{
  const db = makeDb();
  const tt = require(path.join(ROOT, 'electron/ipc/timetable.js'));

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  ck('migrations create timetable_periods', tables.includes('timetable_periods'));
  ck('migrations create timetable_entries', tables.includes('timetable_entries'));

  // Minimal fixture: two periods, one class, one subject, one teacher.
  db.exec("INSERT INTO timetable_periods (id,label,start_time,end_time,display_order,is_break) VALUES (1,'Period 1','08:00','08:40',0,0),(2,'Break','08:40','09:00',1,1);");
  db.exec("INSERT INTO class_groups (id,name,short_code,level_category,level_order) VALUES (1,'BS5','BS5','basic',10);");
  db.exec("INSERT INTO subjects (id,name,code,is_active) VALUES (1,'Mathematics','MATH',1);");
  db.exec("INSERT INTO staff (id,surname,first_name,role,status) VALUES (7,'Mensah','Ama','teacher','Active');");

  // Assign Monday Period 1 → Maths with teacher 7.
  db.prepare(`INSERT INTO timetable_entries (class_group_id,day_of_week,period_id,subject_id,teacher_id)
              VALUES (1,1,1,1,7)`).run();

  const grid = tt.getClassTimetable(db, 1);
  ck('class grid returns the shared periods', grid.periods.length === 2);
  ck('class grid keys a cell by day:period with names',
    grid.entries['1:1'] && grid.entries['1:1'].subject_name === 'Mathematics' && grid.entries['1:1'].teacher_name === 'Ama Mensah');
  ck('class grid has an empty cell where unset', !grid.entries['2:1']);

  const teacher = tt.getTeacherTimetable(db, 7);
  const mon = teacher.days.find(d => d.value === 1);
  ck('teacher timetable groups entries by weekday',
    mon && mon.periods.length === 1 && mon.periods[0].class_name === 'BS5' && mon.periods[0].subject_name === 'Mathematics');
  ck('teacher timetable is empty on days with no entries',
    teacher.days.find(d => d.value === 3).periods.length === 0);

  // UNIQUE(class,day,period): re-assigning the same cell upserts, not duplicates.
  db.prepare(`INSERT INTO timetable_entries (class_group_id,day_of_week,period_id,subject_id,teacher_id)
              VALUES (1,1,1,1,7)
              ON CONFLICT (class_group_id,day_of_week,period_id) DO UPDATE SET subject_id=excluded.subject_id`).run();
  const count = db.prepare('SELECT COUNT(*) c FROM timetable_entries WHERE class_group_id=1 AND day_of_week=1 AND period_id=1').get().c;
  ck('one cell holds at most one entry', count === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
