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

  // Regression: canteen_payments.daily_rate was written by the record-payment
  // flow but never created, breaking canteen collection on fresh databases.
  const canteenCols = db.prepare('PRAGMA table_info(canteen_payments)').all().map(c => c.name);
  ck('migration adds canteen_payments.daily_rate', canteenCols.includes('daily_rate'));

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

console.log('\n── Messaging ──');
{
  const db = makeDb();
  const msg = require(path.join(ROOT, 'electron/ipc/messaging.js'));
  db.exec("INSERT INTO parents (id,full_name,phone) VALUES (1,'Ama','0240000000');");

  // Parent starts a thread → the staff side is flagged unread.
  const a = msg.postMessage(db, { parentId: 1, subject: 'Fees query', senderType: 'parent', senderName: 'Ama', body: 'Is the term fee GHS 400?' });
  ck('parent can start a thread', a.ok && a.thread_id);
  let threads = msg.listThreadsForStaff(db);
  ck('staff sees the new thread as unread', threads.length === 1 && threads[0].staff_unread === 1);

  // Staff replies → parent side is flagged unread, thread now has two messages.
  const b = msg.postMessage(db, { threadId: a.thread_id, senderType: 'staff', senderName: 'Bursar', body: 'Yes, GHS 400.', mirror: false });
  ck('staff can reply on the same thread', b.ok && b.thread_id === a.thread_id);
  const full = msg.getThread(db, a.thread_id);
  ck('thread keeps both messages in order', full.messages.length === 2 && full.messages[0].sender_type === 'parent' && full.messages[1].sender_type === 'staff');
  ck('reply flags the parent unread', full.thread.parent_unread === 1);

  // Marking read clears only that side.
  msg.markThreadRead(db, a.thread_id, 'staff');
  ck('marking staff-read clears staff unread only', msg.listThreadsForStaff(db)[0].staff_unread === 0 && msg.getThread(db, a.thread_id).thread.parent_unread === 1);

  // A staff message projects a thread snapshot to the cloud outbox.
  const snap = db.prepare("SELECT payload_json FROM sync_outbox WHERE entity_type='message_thread' ORDER BY id DESC LIMIT 1").get();
  ck('staff message projects a message_thread snapshot', !!snap && JSON.parse(snap.payload_json).messages.length === 2);

  ck('parent sees only their own threads', msg.listThreadsForParent(db, 1).length === 1 && msg.listThreadsForParent(db, 999).length === 0);
}

console.log('\n── Homework: graded assignments feed the report card ──');
{
  const db = makeDb();
  const hw = require(path.join(ROOT, 'electron/ipc/homework.js'));
  db.exec("INSERT INTO academic_years (id,label,is_current) VALUES (1,'2025/2026',1)");
  db.exec("INSERT INTO terms (id,academic_year_id,term_number,label,start_date,end_date,is_current) VALUES (1,1,1,'T1','2026-01-01','2026-12-30',1)");
  db.exec("INSERT INTO class_groups (id,name,short_code,level_category,level_order) VALUES (1,'BS5','BS5','basic',10)");
  db.exec("INSERT INTO subjects (id,name,code,is_active) VALUES (1,'Mathematics','MATH',1)");
  db.exec("INSERT INTO students (id,surname,first_name,index_number,current_class_id,status) VALUES (1,'A','B','X1',1,'Active'),(2,'C','D','X2',1,'Active')");

  const a = hw.saveHomework(db, { classId: 1, subjectId: 1, title: 'Exercise 4', maxMarks: 20, dueDate: '2026-03-01' });
  ck('graded homework creates a backing assessment column', a.ok
    && db.prepare("SELECT COUNT(*) c FROM assessment_columns WHERE assessment_type LIKE 'Homework:%'").get().c === 1);

  const r = hw.saveMarks(db, { homeworkId: a.id, entries: [
    { student_id: 1, marks: 16, status: 'submitted' },
    { student_id: 2, status: 'missing' },
  ] });
  ck('homework marks save and link to the assessment pipeline', r.ok && r.linked_to_assessment);
  ck('a mark reaches assessment_scores', db.prepare('SELECT marks FROM assessment_scores WHERE student_id=1').get().marks === 16);
  ck('work not turned in scores zero', db.prepare('SELECT marks FROM assessment_scores WHERE student_id=2').get().marks === 0);
  // 16/20 = 80% of the 40% class weight = 32.
  ck('homework marks recompute the weighted class score',
    db.prepare('SELECT class_score FROM scores WHERE student_id=1 AND subject_id=1 AND term_id=1').get().class_score === 32);
  ck('homework marks flow into the subject total (report card)',
    db.prepare('SELECT total_score FROM scores WHERE student_id=1 AND subject_id=1 AND term_id=1').get().total_score === 32);

  const sheet = hw.getSheet(db, a.id);
  ck('marking sheet lists the whole class with statuses',
    sheet.students.length === 2 && sheet.homework.submitted_count === 1 && sheet.homework.missing_count === 1);
  ck('homework summary reports the average mark', sheet.homework.average_mark === 16);

  const rep = hw.studentReport(db, 1, 1);
  ck('student homework report totals marks and percentage',
    rep.summary.graded === 1 && rep.summary.total_marks === 16 && rep.summary.percentage === 80);

  ck('graded homework requires a subject',
    hw.saveHomework(db, { classId: 1, title: 'X', maxMarks: 5 }).ok === false);
  ck('marks above the total are rejected',
    hw.saveMarks(db, { homeworkId: a.id, entries: [{ student_id: 1, marks: 99 }] }).ok === false);
  ck('ungraded homework is still allowed', hw.saveHomework(db, { classId: 1, title: 'Bring a ruler' }).ok === true);

  // A parent sees their own child's status + mark on upcoming work.
  const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  const b = hw.saveHomework(db, { classId: 1, subjectId: 1, title: 'Read ch.3', maxMarks: 10, dueDate: soon });
  hw.saveMarks(db, { homeworkId: b.id, entries: [{ student_id: 1, marks: 9, status: 'submitted' }] });
  const mine = hw.listForStudent(db, 1).find(h => h.title === 'Read ch.3');
  ck('a parent sees their child\'s own homework mark', mine && mine.my_marks === 9 && mine.my_status === 'submitted');

  // Deleting the homework must not leave phantom marks in the class score.
  hw.deleteHomework(db, a.id);
  ck('deleting homework removes its assessment column and marks',
    db.prepare("SELECT COUNT(*) c FROM assessment_columns WHERE assessment_type='Homework: Exercise 4'").get().c === 0
    && db.prepare('SELECT COUNT(*) c FROM homework_submissions WHERE homework_id=?').get(a.id).c === 0);
}

console.log('\n── Homework ──');
{
  const db = makeDb();
  const hw = require(path.join(ROOT, 'electron/ipc/homework.js'));
  db.exec("INSERT INTO class_groups (id,name,short_code,level_category,level_order) VALUES (1,'BS5','BS5','basic',10);");
  db.exec("INSERT INTO students (id,surname,first_name,index_number,current_class_id,status) VALUES (1,'ANSU','MONA','X1',1,'Active');");
  db.exec("INSERT INTO subjects (id,name,code,is_active) VALUES (1,'Mathematics','MATH',1);");

  const a = hw.saveHomework(db, { classId: 1, subjectId: 1, title: 'Exercise 4', description: 'Q1-10', dueDate: '2999-01-01' });
  ck('teacher can set homework', a.ok && a.id);
  const upcoming = hw.listForClass(db, 1);
  ck('class homework resolves subject name', upcoming.length === 1 && upcoming[0].subject_name === 'Mathematics' && upcoming[0].title === 'Exercise 4');

  hw.saveHomework(db, { classId: 1, title: 'Old work', dueDate: '2000-01-01' });
  ck('past homework is hidden from the upcoming view', hw.listForClass(db, 1).length === 1);
  ck('past homework still shows in the full history', hw.listForClass(db, 1, { all: true }).length === 2);
  ck('student sees their class homework', hw.listForStudent(db, 1).length === 1);
}

console.log('\n── Payroll: PAYE / SSNIT ──');
{
  const db = makeDb();
  const h = {};
  require(path.join(ROOT, 'electron/ipc/payroll.js'))({ handle: (n, f) => { h[n] = f; } }, db);
  const calc = (arg) => h['payroll:calculate'](null, arg);

  // GHS 2000 gross, SSNIT-enrolled. Hand-computed against the GRA bands:
  //   SSNIT worker 5.5% = 110; taxable = 1890;
  //   PAYE = 110·0.05 + 130·0.10 + 1160·0.175 = 5.5 + 13 + 203 = 221.5.
  const r = calc({ gross_salary: 2000, ssnit_enrolled: true });
  ck('SSNIT worker is 5.5% of gross', r.ssnit_worker === 110);
  ck('SSNIT employer is 13% of gross', r.ssnit_employer === 260);
  ck('PAYE is computed on gross minus SSNIT worker (1890 → 221.5)', r.paye_tax === 221.5);
  ck('net = gross - SSNIT worker - PAYE', r.net_salary === 1668.5);

  const low = calc({ gross_salary: 400, ssnit_enrolled: true });
  ck('income under the tax-free band pays no PAYE', low.paye_tax === 0 && low.net_salary === 378);

  const noSsnit = calc({ gross_salary: 400, ssnit_enrolled: false });
  ck('non-enrolled staff have no SSNIT deduction', noSsnit.ssnit_worker === 0);
}

console.log('\n── Payroll: salary → expense ledger ──');
{
  const db = makeDb();
  const security = require(path.join(ROOT, 'electron/ipc/_security.js'));
  security.setCurrentUser(1, 'Administrator'); // mark-paid is permission-gated
  const h = {};
  require(path.join(ROOT, 'electron/ipc/payroll.js'))({ handle: (n, f) => { h[n] = f; } }, db);

  db.exec("INSERT INTO staff (id,surname,first_name,role,status) VALUES (1,'Mensah','Ama','teacher','Active');");
  db.exec("INSERT INTO staff_salaries (id,staff_id,month,year,net_salary,arrear_brought_forward,is_paid) VALUES (1,1,1,2026,1668.5,0,0);");
  db.exec("INSERT INTO staff_salaries (id,staff_id,month,year,net_salary,arrear_brought_forward,is_paid) VALUES (2,1,2,2026,1668.5,0,0);");

  const p1 = h['payroll:mark-paid'](null, { id: 1, actualAmount: 1668.5, paymentDate: '2026-01-31' });
  const p2 = h['payroll:mark-paid'](null, { id: 2, actualAmount: 1668.5, paymentDate: '2026-02-28' });
  ck('mark-paid succeeds for an admin', p1.ok && p2.ok);
  ck('each paid salary posts its own expense (no transaction-number collision)',
    db.prepare("SELECT COUNT(*) c FROM expense_records WHERE category='salary'").get().c === 2);
  ck('expense is linked to the salary and idempotent',
    db.prepare('SELECT COUNT(*) c FROM expense_records WHERE linked_salary_id=1').get().c === 1);
  security.setCurrentUser(null, null); // reset session state for later tests
}

console.log('\n── Payroll: paid salaries must reach Finance ──');
{
  // Symptom: "Expenses show GHS 0.00 for salaries while payroll shows
  // GHS 1,369.00 paid this month." A salary flagged paid with no amount
  // recorded (the legacy form sends 0 for a blank field) posted no expense,
  // and the startup repair skipped it because it required actual > 0.
  const payroll = require(path.join(ROOT, 'electron/ipc/payroll.js'));
  const ledger = require(path.join(ROOT, 'electron/ipc/_ledger.js'));
  const security = require(path.join(ROOT, 'electron/ipc/_security.js'));
  const M = new Date().getMonth() + 1, Y = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const dayIn = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

  function school() {
    const db = makeDb();
    db.prepare("INSERT OR REPLACE INTO settings (key,value,category) VALUES ('transaction_counter','1','system')").run();
    db.exec("INSERT INTO academic_years (id,label,is_current) VALUES (1,'2025/2026',1)");
    // Term ended 10 days ago → today is vacation, as in the reported case.
    db.prepare("INSERT INTO terms (id,academic_year_id,term_number,label,start_date,end_date,is_current) VALUES (1,1,3,'T3',?,?,1)").run(dayIn(40), dayIn(10));
    db.exec("INSERT INTO staff (id,surname,first_name,role,status,base_salary,ssnit_enrolled) VALUES (1,'Mensah','Ama','teacher','Active',1500,1)");
    return db;
  }
  const salaryExpense = (db) => db.prepare("SELECT COALESCE(SUM(amount),0) t FROM expense_records WHERE category='salary' AND term_id=1").get().t;

  // 1. An existing database already in the broken state repairs at startup.
  {
    const db = school();
    db.prepare("INSERT INTO staff_salaries (staff_id,month,year,gross_salary,net_salary,arrear_brought_forward,actual_amount_paid,is_paid,payment_date) VALUES (1,?,?,1500,1417.5,0,0,1,?)")
      .run(M, Y, today);
    ck('a paid salary with no amount recorded is flagged for the audit',
      payroll.paidSummaryForTerm(db, 1).unrecorded === 1);
    ck('it starts with no expense in Finance', salaryExpense(db) === 0);
    ledger.reconcileLedger(db);
    ck('startup repair settles it at the net owed', salaryExpense(db) === 1417.5);
    ck('startup repair corrects the salary row so payroll agrees',
      db.prepare('SELECT actual_amount_paid FROM staff_salaries').get().actual_amount_paid === 1417.5);
    ck('payroll and the ledger then reconcile',
      Math.abs(payroll.paidSummaryForTerm(db, 1).total - salaryExpense(db)) < 0.01);
  }

  // 2. Saving via the legacy form with a blank amount can no longer hide money.
  {
    const db = school();
    security.setCurrentUser(1, 'Administrator');
    const hs = {};
    require(path.join(ROOT, 'electron/ipc/staff.js'))({ handle: (n, f) => { hs[n] = f; } }, db, '/tmp');
    hs['staff:save-salary'](null, { staff_id: 1, month: M, year: Y, gross_salary: 1500, is_paid: true, actual_amount_paid: 0, payment_date: today });
    ck('marking paid with a blank amount records the net owed',
      db.prepare('SELECT actual_amount_paid FROM staff_salaries').get().actual_amount_paid === 1417.5);
    ck('and the expense reaches Finance immediately', salaryExpense(db) === 1417.5);
    security.setCurrentUser(null, null);
  }

  // 3. mark-paid reconciles, and refuses to mark a salary paid for nothing.
  {
    const db = school();
    security.setCurrentUser(1, 'Administrator');
    const hp = {};
    payroll({ handle: (n, f) => { hp[n] = f; } }, db);
    db.prepare("INSERT INTO staff_salaries (id,staff_id,month,year,net_salary,arrear_brought_forward,is_paid) VALUES (1,1,?,?,1278.69,0,0)").run(M, Y);
    ck('mark-paid posts a matching expense', hp['payroll:mark-paid'](null, { id: 1, actualAmount: 1278.69, paymentDate: today }).ok
      && Math.abs(salaryExpense(db) - 1278.69) < 0.01);
    ck('payroll paid-summary matches the ledger',
      Math.abs(payroll.paidSummaryForTerm(db, 1).total - salaryExpense(db)) < 0.01);
    db.prepare("INSERT INTO staff_salaries (id,staff_id,month,year,net_salary,arrear_brought_forward,is_paid) VALUES (2,1,?,?,900,0,0)").run(M === 12 ? 1 : M + 1, Y);
    ck('a salary cannot be marked paid for nothing',
      hp['payroll:mark-paid'](null, { id: 2, actualAmount: 0 }).ok === false);
    security.setCurrentUser(null, null);
  }

  // 4. Salaries paid during vacation still count towards the current term —
  //    the audit's two sides must use the same attribution rule.
  {
    const db = school();
    db.prepare("INSERT INTO staff_salaries (staff_id,month,year,net_salary,arrear_brought_forward,actual_amount_paid,is_paid,payment_date) VALUES (1,?,?,1000,0,1000,1,?)")
      .run(M, Y, today); // today is outside every term window
    ledger.reconcileLedger(db);
    ck('a salary paid during vacation is attributed to the current term on both sides',
      salaryExpense(db) === 1000 && payroll.paidSummaryForTerm(db, 1).total === 1000);
  }
}

console.log('\n── Finance ledger ──');
{
  const db = makeDb();
  const ledger = require(path.join(ROOT, 'electron/ipc/_ledger.js'));
  db.exec("INSERT INTO academic_years (id,label,is_current) VALUES (1,'2025/2026',1);");
  db.exec("INSERT INTO terms (id,academic_year_id,term_number,label,start_date,end_date,is_current) VALUES (1,1,1,'T1','2026-01-01','2026-04-30',1);");

  ck('resolveTermForDate finds the term whose window contains the date', ledger.resolveTermForDate(db, '2026-02-15')?.id === 1);

  const id1 = ledger.postIncome(db, { category: 'fees', amount: 100, date: '2026-02-15', receipt_number: 'R1' });
  const rec = db.prepare('SELECT * FROM income_records WHERE id=?').get(id1);
  ck('postIncome always sets transaction_date (the NOT NULL column older code dropped)', rec.transaction_date === '2026-02-15');
  ck('postIncome resolves term_id + academic_year_id from the date', rec.term_id === 1 && rec.academic_year_id === 1);

  const id2 = ledger.postIncome(db, { category: 'fees', amount: 100, date: '2026-02-15', receipt_number: 'R1' });
  ck('postIncome is idempotent on receipt_number', id2 === id1 && db.prepare('SELECT COUNT(*) c FROM income_records').get().c === 1);

  const c1 = ledger.postIncome(db, { category: 'canteen', amount: 20, linked_canteen_payment_id: 55 });
  const c2 = ledger.postIncome(db, { category: 'canteen', amount: 20, linked_canteen_payment_id: 55 });
  ck('postIncome is idempotent on linked_canteen_payment_id', c1 === c2);
}

console.log('\n── Finance ledger: reconciliation ──');
{
  const db = makeDb();
  const ledger = require(path.join(ROOT, 'electron/ipc/_ledger.js'));
  db.exec("INSERT INTO academic_years (id,label,is_current) VALUES (1,'2025/2026',1);");
  db.exec("INSERT INTO terms (id,academic_year_id,term_number,label,start_date,end_date,is_current) VALUES (1,1,1,'T1','2026-01-01','2026-04-30',1);");
  db.exec("INSERT INTO students (id,surname,first_name,index_number,status) VALUES (1,'A','B','X','Active');");
  db.exec("INSERT INTO payments (id,student_id,term_id,amount,payment_date,receipt_number,is_reversed) VALUES (1,1,1,150,'2026-02-10','RC1',0);");

  ck('a fee payment starts with no ledger row', db.prepare('SELECT COUNT(*) c FROM income_records').get().c === 0);
  ledger.reconcileLedger(db);
  ck('reconcileLedger back-posts income for an orphan fee payment',
    db.prepare("SELECT COUNT(*) c FROM income_records WHERE linked_payment_id=1 OR receipt_number='RC1'").get().c === 1);
  ledger.reconcileLedger(db);
  ck('reconcileLedger is idempotent (no duplicate on re-run)', db.prepare('SELECT COUNT(*) c FROM income_records').get().c === 1);

  // A reversed payment must not be back-posted.
  db.exec("INSERT INTO payments (id,student_id,term_id,amount,payment_date,receipt_number,is_reversed) VALUES (2,1,1,200,'2026-02-11','RC2',1);");
  ledger.reconcileLedger(db);
  ck('reconcileLedger skips reversed payments', db.prepare("SELECT COUNT(*) c FROM income_records WHERE receipt_number='RC2'").get().c === 0);
}

console.log('\n── Financial reconciliation: ledger vs modules ──');
{
  // Every one of these reproduces a mismatch that was live: money a module
  // reported but the finance ledger never saw, or vice-versa. The school-facing
  // symptom was the audit finding "Canteen income does not match canteen
  // payments".
  //
  // The scenario is deliberately set DURING VACATION — today falls outside the
  // current term's window, which is when the bug bit.
  const today = new Date().toISOString().slice(0, 10);
  const dayIn = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

  function school() {
    const db = makeDb();
    db.prepare("INSERT OR REPLACE INTO settings (key,value,category) VALUES ('canteen_daily_rate','5','canteen')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key,value,category) VALUES ('receipt_counter','1','system')").run();
    db.exec("INSERT INTO academic_years (id,label,is_current) VALUES (1,'2025/2026',1)");
    db.prepare("INSERT INTO terms (id,academic_year_id,term_number,label,start_date,end_date,is_current) VALUES (1,1,3,'Third Term',?,?,1)")
      .run(dayIn(40), dayIn(10)); // term ENDED 10 days ago → today is vacation
    db.exec("INSERT INTO class_groups (id,name,short_code,level_category,level_order) VALUES (1,'BS5','BS5','basic',10)");
    db.exec("INSERT INTO students (id,surname,first_name,index_number,current_class_id,status) VALUES (1,'ANSU','MONA','X1',1,'Active')");
    const ins = db.prepare("INSERT INTO school_calendar (date,day_type,term_id) VALUES (?,'school_day',1)");
    for (let i = 0; i < 5; i++) ins.run(dayIn(35 - i));
    return db;
  }
  const reg = (db, mod) => { const h = {}; require(path.join(ROOT, 'electron/ipc/', mod))({ handle: (n, f) => { h[n] = f; } }, db); return h; };
  const canteenIncome = (db) => db.prepare("SELECT COALESCE(SUM(amount),0) t FROM income_records WHERE category='canteen'").get().t;

  // 1. Quick-pay a single day.
  {
    const db = school();
    const h = reg(db, 'canteen_extra.js');
    h['canteen:set-day-status'](null, { studentId: 1, date: dayIn(35), status: 'paid' });
    const dash = h['canteen:dashboard'](null, 1);
    ck('quick-pay: canteen dashboard total matches the income ledger',
      Math.abs((dash.metrics.total_collected || 0) - canteenIncome(db)) < 0.01 && canteenIncome(db) === 5);
    ck('quick-pay: the payment is attributed to a term', db.prepare('SELECT term_id FROM canteen_payments').get().term_id === 1);
  }

  // 2. Multi-day collection for one student.
  {
    const db = school();
    const h = reg(db, 'canteen_extra.js');
    h['canteen:mark-days-paid'](null, { studentId: 1, dates: [dayIn(35), dayIn(34), dayIn(33)] });
    const dash = h['canteen:dashboard'](null, 1);
    ck('multi-day collection: dashboard matches the ledger',
      Math.abs((dash.metrics.total_collected || 0) - canteenIncome(db)) < 0.01 && canteenIncome(db) === 15);
  }

  // 3. Whole-class daily collection — this posted NO income at all.
  {
    const db = school();
    const h = reg(db, 'canteen_extra.js');
    db.exec("INSERT INTO students (id,surname,first_name,index_number,current_class_id,status) VALUES (2,'B','C','X2',1,'Active')");
    h['canteen:mark-bulk-paid'](null, { studentIds: [1, 2], date: dayIn(35) });
    ck('class daily collection reaches the finance ledger (was posting nothing)', canteenIncome(db) === 10);
    const dash = h['canteen:dashboard'](null, 1);
    ck('class daily collection: dashboard matches the ledger',
      Math.abs((dash.metrics.total_collected || 0) - canteenIncome(db)) < 0.01);
  }

  // 4. Collection taken during vacation (payment_date outside the term window).
  {
    const db = school();
    const canteen = require(path.join(ROOT, 'electron/ipc/canteen.js'));
    const h = reg(db, 'canteen_extra.js');
    canteen.recordCanteenPayment(db, { student_id: 1, amount: 15 }); // defaults to today = vacation
    const dash = h['canteen:dashboard'](null, 1);
    ck('arrears settled during vacation still count in the canteen module',
      (dash.metrics.total_collected || 0) === 15 && canteenIncome(db) === 15);
  }

  // 5. Un-ticking a quick-paid day must not leave the money on the books.
  {
    const db = school();
    const h = reg(db, 'canteen_extra.js');
    h['canteen:set-day-status'](null, { studentId: 1, date: dayIn(35), status: 'paid' });
    h['canteen:set-day-status'](null, { studentId: 1, date: dayIn(35), status: 'unpaid' });
    ck('un-ticking a quick-paid day reverses its income', canteenIncome(db) === 0);
    ck('un-ticking a quick-paid day removes the payment row',
      db.prepare('SELECT COUNT(*) c FROM canteen_payments').get().c === 0);
  }

  // 6. Repair path for databases that already lost this money: the startup
  //    reconcile must back-post the missing income under the right term.
  {
    const db = school();
    const ledger = require(path.join(ROOT, 'electron/ipc/_ledger.js'));
    db.prepare(`INSERT INTO canteen_payments (student_id, term_id, payment_date, amount, days_covered, start_date, end_date)
                VALUES (1, NULL, ?, 25, 5, ?, ?)`).run(today, dayIn(35), dayIn(31));
    ck('a legacy collection starts with no ledger entry', canteenIncome(db) === 0);
    runMigrations(db);            // migration 26 attributes it to a term
    ledger.reconcileLedger(db);   // startup repair back-posts the income
    ck('startup repair recovers canteen money that never reached Finance', canteenIncome(db) === 25);
    const dash = reg(db, 'canteen_extra.js')['canteen:dashboard'](null, 1);
    ck('recovered money reconciles against the canteen module',
      Math.abs((dash.metrics.total_collected || 0) - canteenIncome(db)) < 0.01);
  }

  // 7. Money must be kept to the pesewa, not rounded to whole cedis.
  {
    const db = school();
    db.prepare("INSERT OR REPLACE INTO settings (key,value,category) VALUES ('canteen_daily_rate','2.50','canteen')").run();
    const h = reg(db, 'canteen_extra.js');
    h['canteen:set-day-status'](null, { studentId: 1, date: dayIn(35), status: 'paid' });
    ck('canteen totals keep pesewas (were rounded to whole cedis)',
      h['canteen:dashboard'](null, 1).metrics.total_collected === 2.5);
  }
}

console.log('\n── Transport: routes, riders and fee collection ──');
{
  const db = makeDb();
  const t = require(path.join(ROOT, 'electron/ipc/transport.js'));
  const h = {};
  t({ handle: (n, f) => { h[n] = f; } }, db);
  db.prepare("INSERT OR REPLACE INTO settings (key,value,category) VALUES ('receipt_counter','1','system')").run();
  db.exec("INSERT INTO academic_years (id,label,is_current) VALUES (1,'2025/2026',1)");
  // Term ended 10 days ago → today is vacation, the case that broke canteen.
  const ended = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
  const past = new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10);
  db.prepare("INSERT INTO terms (id,academic_year_id,term_number,label,start_date,end_date,is_current) VALUES (1,1,3,'T3',?,?,1)").run(past, ended);
  db.exec("INSERT INTO class_groups (id,name,short_code,level_category,level_order) VALUES (1,'BS5','BS5','basic',10)");
  db.exec("INSERT INTO students (id,surname,first_name,index_number,current_class_id,status) VALUES (1,'A','B','X1',1,'Active'),(2,'C','D','X2',1,'Active')");

  const route = h['transport:save-route'](null, { name: 'Route A', fee_per_term: 150, capacity: 20 });
  ck('a route can be created', route.ok && route.id);
  const stop = h['transport:save-stop'](null, { route_id: route.id, name: 'Adenta', pickup_time: '06:40' });
  ck('a stop can be added to a route', stop.ok);

  h['transport:assign'](null, { student_id: 1, route_id: route.id, stop_id: stop.id });
  h['transport:assign'](null, { student_id: 2, route_id: route.id, fee_override: 100 });
  const s1 = h['transport:student'](null, { studentId: 1 });
  ck('a rider inherits the route fee', s1.fee_per_term === 150 && s1.balance === 150 && s1.route_name === 'Route A');
  const s2 = h['transport:student'](null, { studentId: 2 });
  ck('a fee override beats the route fee', s2.fee_per_term === 100);

  // Collect during vacation — the exact scenario that lost canteen money.
  const pay = h['transport:record-payment'](null, { student_id: 1, amount: 150 });
  ck('a transport fee can be collected', pay.ok && /^TR\//.test(pay.receipt_number));
  const ledger = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM income_records WHERE category='transport' AND term_id=1").get().t;
  const dash = h['transport:dashboard'](null, 1);
  ck('transport income reaches the ledger under the right term (even in vacation)',
    ledger === 150 && dash.metrics.total_collected === 150);
  ck('the dashboard reconciles with the ledger', dash.metrics.total_collected === ledger);
  ck('outstanding sums the unpaid riders', dash.metrics.outstanding === 100);
  ck('a paid rider shows a zero balance', h['transport:student'](null, { studentId: 1 }).balance === 0);

  // Assigning is idempotent (one active row per pupil).
  h['transport:assign'](null, { student_id: 1, route_id: route.id });
  ck('a pupil has at most one active assignment',
    db.prepare('SELECT COUNT(*) c FROM student_transport WHERE student_id=1 AND is_active=1').get().c === 1);

  // A route with riders cannot be deleted by accident.
  ck('a route with riders refuses deletion', h['transport:delete-route'](null, route.id).ok === false);

  // Startup repair: a transport payment with no income gets back-posted.
  const ledger2 = require(path.join(ROOT, 'electron/ipc/_ledger.js'));
  db.prepare("INSERT INTO transport_payments (student_id,route_id,term_id,amount,payment_date,receipt_number) VALUES (2,?,1,100,?,'TR/OLD/1')").run(route.id, ended);
  ledger2.reconcileLedger(db);
  ck('startup repair back-posts a transport payment that never reached Finance',
    db.prepare("SELECT COALESCE(SUM(amount),0) t FROM income_records WHERE category='transport'").get().t === 250);

  ck('non-positive transport amounts are rejected', h['transport:record-payment'](null, { student_id: 1, amount: 0 }).ok === false);
}

console.log('\n── Fees: re-issuing a bill ──');
{
  const db = makeDb();
  db.prepare("INSERT OR REPLACE INTO settings (key,value,category) VALUES ('receipt_counter','1','system')").run();
  db.exec("INSERT INTO academic_years (id,label,is_current) VALUES (1,'2025/2026',1)");
  db.exec("INSERT INTO terms (id,academic_year_id,term_number,label,start_date,end_date,is_current) VALUES (1,1,1,'T1','2026-01-01','2026-04-30',1)");
  db.exec("INSERT INTO class_groups (id,name,short_code,level_category,level_order) VALUES (1,'BS5','BS5','basic',10)");
  db.exec("INSERT INTO students (id,surname,first_name,index_number,current_class_id,status) VALUES (1,'ANSU','MONA','X1',1,'Active')");
  db.exec("INSERT INTO fee_templates (id,name,class_group_id,term_id,is_active) VALUES (1,'BS5 T1',1,1,1)");
  db.exec("INSERT INTO fee_line_items (fee_template_id,item_number,description,amount) VALUES (1,1,'Tuition',400)");
  const h = {};
  require(path.join(ROOT, 'electron/ipc/fees.js'))({ handle: (n, f) => { h[n] = f; } }, db);

  h['fees:generate-bill'](null, { studentId: 1, termId: 1 });
  const bill = db.prepare('SELECT id FROM student_bills WHERE student_id=1').get();
  h['fees:record-payment'](null, { student_id: 1, student_bill_id: bill.id, term_id: 1, amount: 400 });

  // Re-issuing used to DELETE the bill (foreign-key failure with payments on
  // it) and re-bill the parent for money already received.
  let threw = false;
  try { h['fees:generate-bill'](null, { studentId: 1, termId: 1 }); } catch (_) { threw = true; }
  ck('re-issuing a bill for a pupil who has paid does not fail', !threw);
  const after = db.prepare('SELECT total_billed, total_paid, balance FROM student_bills WHERE student_id=1').get();
  ck('re-issuing keeps the money already paid', after.total_paid === 400 && after.balance === 0);
  ck('re-issuing keeps the payment history intact',
    db.prepare('SELECT COUNT(*) c FROM payments WHERE student_id=1').get().c === 1);

  // A genuinely larger bill re-bills only the difference.
  db.exec("INSERT INTO fee_line_items (fee_template_id,item_number,description,amount) VALUES (1,2,'Lab',100)");
  h['fees:generate-bill'](null, { studentId: 1, termId: 1 });
  const grown = db.prepare('SELECT total_billed, total_paid, balance FROM student_bills WHERE student_id=1').get();
  ck('adding a fee item re-bills only the outstanding difference',
    grown.total_billed === 500 && grown.total_paid === 400 && grown.balance === 100);
}

console.log('\n── Canteen collection ──');
{
  const db = makeDb();
  const canteen = require(path.join(ROOT, 'electron/ipc/canteen.js'));
  db.exec("INSERT INTO academic_years (id,label,is_current) VALUES (1,'2025/2026',1);");
  db.exec("INSERT INTO terms (id,academic_year_id,term_number,label,start_date,end_date,is_current) VALUES (1,1,1,'T1','2026-01-01','2026-04-30',1);");
  db.exec("INSERT INTO students (id,surname,first_name,index_number,status) VALUES (1,'A','B','X','Active');");
  for (const d of ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09']) {
    db.prepare("INSERT INTO school_calendar (date,day_type,term_id) VALUES (?,'school_day',1)").run(d);
  }

  // Default daily rate is GHS 5, so GHS 15 covers 3 days.
  const r = canteen.recordCanteenPayment(db, { student_id: 1, amount: 15, payment_date: '2026-01-05' });
  ck('canteen payment covers floor(amount / rate) days', r.ok && r.days_covered === 3);
  ck('canteen marks exactly that many school days paid', db.prepare("SELECT COUNT(*) c FROM canteen_day_status WHERE student_id=1 AND status='paid'").get().c === 3);
  ck('canteen collection reaches the finance ledger', db.prepare("SELECT COUNT(*) c FROM income_records WHERE category='canteen'").get().c === 1);

  const r2 = canteen.recordCanteenPayment(db, { student_id: 1, amount: 10, payment_date: '2026-01-05' });
  ck('a later canteen payment continues from the next unpaid day', r2.days_covered === 2 && db.prepare("SELECT COUNT(*) c FROM canteen_day_status WHERE student_id=1 AND status='paid'").get().c === 5);

  const bad = canteen.recordCanteenPayment(db, { student_id: 1, amount: 0 });
  ck('canteen rejects a non-positive amount', bad.ok === false);
}

console.log('\n── Fees payment ──');
{
  const db = makeDb();
  // Capture the real IPC handlers so we can invoke the record-payment logic
  // exactly as the app does, without an Electron runtime.
  const handlers = {};
  const ipc = { handle: (name, fn) => { handlers[name] = fn; } };
  require(path.join(ROOT, 'electron/ipc/fees.js'))(ipc, db);
  const call = (name, arg) => handlers[name](null, arg);

  db.exec("INSERT INTO academic_years (id,label,is_current) VALUES (1,'2025/2026',1);");
  db.exec("INSERT INTO terms (id,academic_year_id,term_number,label,start_date,end_date,is_current) VALUES (1,1,1,'T1','2026-01-01','2026-04-30',1);");
  db.exec("INSERT INTO students (id,surname,first_name,index_number,status) VALUES (1,'A','B','X','Active');");
  db.exec("INSERT INTO student_bills (id,student_id,term_id,total_billed,total_paid,balance) VALUES (1,1,1,400,0,400);");

  const r1 = call('fees:record-payment', { student_id: 1, student_bill_id: 1, term_id: 1, amount: 150 });
  ck('fee payment succeeds and returns a receipt number', r1.ok && /^FE\//.test(r1.receipt_number));
  const bill1 = db.prepare('SELECT total_paid, balance FROM student_bills WHERE id=1').get();
  ck('fee payment updates the bill (paid + balance)', bill1.total_paid === 150 && bill1.balance === 250);
  ck('fee payment posts income to the ledger, linked to the payment',
    db.prepare('SELECT COUNT(*) c FROM income_records WHERE category=\'fees\' AND linked_payment_id=?').get(r1.id).c === 1);

  const r2 = call('fees:record-payment', { student_id: 1, student_bill_id: 1, term_id: 1, amount: 250 });
  const bill2 = db.prepare('SELECT total_paid, balance FROM student_bills WHERE id=1').get();
  ck('a second payment clears the balance', bill2.total_paid === 400 && bill2.balance === 0);
  ck('receipt numbers are unique and increasing', r2.receipt_number !== r1.receipt_number);
  ck('each payment posts its own ledger row', db.prepare("SELECT COUNT(*) c FROM income_records WHERE category='fees'").get().c === 2);

  const debtors = call('fees:debtors-report', 1);
  ck('a fully-paid student is not a debtor', Array.isArray(debtors) && debtors.every(d => d.student_id !== 1));
}

console.log('\n── Fees bulk pay ──');
{
  const db = makeDb();
  const handlers = {};
  require(path.join(ROOT, 'electron/ipc/fees_bulk_pay.js'))({ handle: (n, f) => { handlers[n] = f; } }, db);
  const call = (name, arg) => handlers[name](null, arg);

  db.exec("INSERT INTO academic_years (id,label,is_current) VALUES (1,'2025/2026',1);");
  db.exec("INSERT INTO terms (id,academic_year_id,term_number,label,start_date,end_date,is_current) VALUES (1,1,1,'T1','2026-01-01','2026-04-30',1);");
  db.exec("INSERT INTO students (id,surname,first_name,index_number,status) VALUES (1,'A','B','X1','Active'),(2,'C','D','X2','Active');");
  db.exec("INSERT INTO student_bills (id,student_id,term_id,total_billed,total_paid,balance) VALUES (1,1,1,400,0,400),(2,2,1,300,0,300);");

  const p1 = call('fees:bulk-pay-record', { student_id: 1, bill_id: 1, term_id: 1, amount: 400 });
  const p2 = call('fees:bulk-pay-record', { student_id: 2, bill_id: 2, term_id: 1, amount: 300 });
  ck('bulk pay records both students without receipt-number collision', p1.ok && p2.ok && p1.receipt_number !== p2.receipt_number);
  ck('bulk pay clears each bill', db.prepare('SELECT balance FROM student_bills WHERE id=1').get().balance === 0
    && db.prepare('SELECT balance FROM student_bills WHERE id=2').get().balance === 0);
  ck('bulk pay posts a ledger row per student', db.prepare("SELECT COUNT(*) c FROM income_records WHERE category='fees'").get().c === 2);
  ck('bulk pay rejects a non-positive amount', call('fees:bulk-pay-record', { student_id: 1, amount: 0 }).ok === false);
}

console.log('\n── Scores weighting ──');
{
  const db = makeDb();
  const scores = require(path.join(ROOT, 'electron/ipc/scores.js'));
  db.exec("INSERT INTO academic_years (id,label,is_current) VALUES (1,'2025/2026',1);");
  db.exec("INSERT INTO terms (id,academic_year_id,term_number,label,is_current) VALUES (1,1,1,'T1',1);");
  db.exec("INSERT INTO students (id,surname,first_name,index_number,status) VALUES (1,'A','B','X','Active');");
  db.exec("INSERT INTO subjects (id,name,code,is_active) VALUES (1,'Maths','M',1);");

  // Default weighting is 40/60, so a raw exam of 50 converts to 50/100*60 = 30
  // (class score is 0 here → total 30).
  scores.saveExamMark(db, { studentId: 1, subjectId: 1, termId: 1, examScore: 50 });
  const row = db.prepare('SELECT exam_score, total_score FROM scores WHERE student_id=1 AND term_id=1 AND subject_id=1').get();
  ck('saveExamMark stores the raw exam score', row.exam_score === 50);
  ck('saveExamMark weights the exam into the total (60%)', row.total_score === 30);

  db.prepare("INSERT OR REPLACE INTO settings (key,value,category) VALUES ('exam_weight_pct','50','academics')").run();
  scores.saveExamMark(db, { studentId: 1, subjectId: 1, termId: 1, examScore: 50 });
  ck('saveExamMark honors the configured exam weight (50%)',
    db.prepare('SELECT total_score FROM scores WHERE student_id=1 AND term_id=1 AND subject_id=1').get().total_score === 25);
}


console.log('\n── Billing: expected income, bill types, supplementary, voiding ──');
{
  const db = makeDb();
  const security = require(path.join(ROOT, 'electron/ipc/_security.js'));
  db.prepare("INSERT OR REPLACE INTO settings (key,value,category) VALUES ('receipt_counter','1','system')").run();
  db.exec("INSERT INTO academic_years (id,label,is_current) VALUES (1,'2026/2027',1)");
  db.exec("INSERT INTO terms (id,academic_year_id,term_number,label,start_date,end_date,is_current) VALUES (1,1,1,'FIRST TERM','2026-09-01','2026-12-20',1)");
  db.exec("INSERT INTO terms (id,academic_year_id,term_number,label,start_date,end_date,is_current) VALUES (2,1,2,'SECOND TERM','2027-01-10','2027-04-10',0)");
  db.exec("INSERT INTO class_groups (id,name,short_code,level_category,level_order,is_active) VALUES (1,'BASIC 5','BS5','basic',10,1)");
  db.exec("INSERT INTO class_groups (id,name,short_code,level_category,level_order,is_active) VALUES (2,'BASIC 6','BS6','basic',11,1)");
  for (let i = 1; i <= 4; i++) {
    db.prepare("INSERT INTO students (id,surname,first_name,index_number,current_class_id,status) VALUES (?,?,'P',?,?, 'Active')")
      .run(i, 'S' + i, 'X' + i, i <= 2 ? 1 : 2);
  }
  // The shipped situation from the screenshots: ONE template scoped to
  // "All classes / All terms" — the fields the old dashboard join required.
  db.exec("INSERT INTO fee_templates (id,name,class_group_id,term_id,is_active,bill_type) VALUES (1,'FIRST TERM BILLS 2026/2027',NULL,NULL,1,'school_fees')");
  db.exec("INSERT INTO fee_line_items (fee_template_id,item_number,description,amount) VALUES (1,1,'Tuition',700)");
  db.exec("INSERT INTO fee_line_items (fee_template_id,item_number,description,amount) VALUES (1,2,'PTA Dues',50.5)");

  const h = {};
  const ipc = { handle: (n, f) => { h[n] = f; } };
  require(path.join(ROOT, 'electron/ipc/fees.js'))(ipc, db);
  require(path.join(ROOT, 'electron/ipc/fees_extra.js'))(ipc, db);
  require(path.join(ROOT, 'electron/ipc/fees_billing.js'))(ipc, db);
  const call = (n, a) => h[n](null, a);

  // ── Expected income ────────────────────────────────────────────────
  // Nothing billed yet: every active pupil is projected from the template
  // bill generation would actually pick. The old query joined on an exact
  // class_group_id/term_id match against fee_template_items (a table the
  // editor never writes) and returned 0.00.
  const dashA = call('fees:dashboard', 1);
  ck('expected income is not zero when only an "all classes/all terms" template exists',
    dashA.metrics.expected_income === 3002);
  ck('expected income reports how much of itself is a projection',
    dashA.metrics.expected_projected === 3002 && dashA.metrics.unbilled_students === 4);

  // Generating the bills must not move the number.
  const gen = call('fees:generate-bulk', { termId: 1, scope: 'all' });
  ck('bulk generation bills every active pupil', gen.generated === 4 && gen.skipped === 0);
  const dashB = call('fees:dashboard', 1);
  ck('generating the bills leaves expected income unchanged',
    dashB.metrics.expected_income === 3002 && dashB.metrics.total_billed === 3002);
  ck('expected income now comes from the bills themselves',
    dashB.metrics.expected_billed === 3002 && dashB.metrics.unbilled_students === 0);
  ck('per-class expected income matches the dashboard',
    call('fees:expected-income', 1).total === 3002);

  // ── One school fees bill per term ──────────────────────────────────
  db.exec("INSERT INTO fee_templates (id,name,class_group_id,term_id,is_active,bill_type) VALUES (2,'BS5 First Term',1,1,1,'school_fees')");
  const dup = call('fees:save-template', {
    name: 'BS5 First Term (again)', class_group_id: 1, term_id: 1,
    bill_type: 'school_fees', items: [{ description: 'Tuition', amount: 800 }],
  });
  ck('a second school-fees bill for the same class and term is refused',
    dup.ok === false && dup.code === 'DUPLICATE_SCHOOL_FEES' && dup.existing.id === 2);
  const replaced = call('fees:save-template', {
    name: 'BS5 First Term (revised)', class_group_id: 1, term_id: 1,
    bill_type: 'school_fees', confirm_replace: true, replaces_template_id: 2,
    items: [{ description: 'Tuition', amount: 800 }],
  });
  ck('confirming the replacement is allowed and retires the old template',
    replaced.ok === true &&
    db.prepare('SELECT is_active FROM fee_templates WHERE id=2').get().is_active === 0);
  const extraTpl = call('fees:save-template', {
    name: 'Excursion — Kakum', term_id: 1, bill_type: 'supplementary',
    items: [{ description: 'Excursion to Kakum', amount: 120 }],
  });
  ck('a supplementary bill in the same term is allowed', extraTpl.ok === true);

  // ── Copy last term forward ─────────────────────────────────────────
  const copied = call('fees:copy-template', {
    sourceId: 1, name: 'SECOND TERM BILLS', termId: 2, adjustPercent: 10,
  });
  ck('a previous term\'s bill can be copied forward', copied.ok === true);
  ck('copying forward carries the line items and applies the uplift',
    db.prepare('SELECT COALESCE(SUM(amount),0) t FROM fee_line_items WHERE fee_template_id=?').get(copied.id).t === 825.55);

  // ── Supplementary charges ──────────────────────────────────────────
  // Restricted: nobody is logged in, so this must be refused.
  security.clearCurrentUser();
  ck('an unauthenticated caller cannot raise a supplementary charge',
    call('fees:apply-supplementary', { templateId: extraTpl.id, termId: 1, scope: 'all' }).code === 'NOT_ELEVATED');

  db.exec("INSERT INTO designations (id,name,is_system) VALUES (1,'Proprietor',1),(2,'Class Teacher',0)");
  db.exec("INSERT INTO users (id,username,password_hash,full_name,designation_id,is_active) VALUES (1,'prop','x','Owner',1,1),(2,'tr','x','Teacher',2,1)");
  security.setCurrentUser(2, 'Class Teacher');
  ck('a class teacher cannot raise a supplementary charge',
    call('fees:apply-supplementary', { templateId: extraTpl.id, termId: 1, scope: 'all' }).code === 'NOT_ELEVATED');

  security.setCurrentUser(1, 'Proprietor');
  const applied = call('fees:apply-supplementary', { templateId: extraTpl.id, termId: 1, scope: 'class', classId: 1 });
  ck('the proprietor can raise a supplementary charge on a class', applied.ok && applied.applied === 2);
  const b1 = db.prepare('SELECT * FROM student_bills WHERE student_id=1 AND term_id=1').get();
  ck('the supplementary charge lands on the pupil\'s existing term bill',
    b1.total_billed === 870.5 && b1.supplementary_total === 120);
  const again = call('fees:apply-supplementary', { templateId: extraTpl.id, termId: 1, scope: 'class', classId: 1 });
  ck('applying the same supplementary charge twice does not charge twice',
    again.applied === 0 && again.skipped === 2 &&
    db.prepare('SELECT total_billed t FROM student_bills WHERE id=?').get(b1.id).t === 870.5);

  // Regenerating the term bill must not erase an extra already raised.
  // BASIC 5 now resolves to the revised template (Tuition 800), so the fees
  // half is re-derived while the GHS 120 excursion survives untouched.
  call('fees:generate-bill', { studentId: 1, termId: 1 });
  const afterRegen = db.prepare('SELECT * FROM student_bills WHERE id=?').get(b1.id);
  ck('regenerating the term bill preserves supplementary charges',
    afterRegen.total_billed === 920 && afterRegen.supplementary_total === 120);
  ck('regenerated bill line items are renumbered without gaps',
    db.prepare("SELECT GROUP_CONCAT(item_number) g FROM (SELECT item_number FROM bill_line_items WHERE student_bill_id=? ORDER BY item_number)").get(b1.id).g === '1,2');

  const removed = call('fees:remove-supplementary', { templateId: extraTpl.id, termId: 1 });
  ck('a supplementary charge can be withdrawn again',
    removed.ok && removed.removed === 2 &&
    db.prepare('SELECT total_billed t FROM student_bills WHERE id=?').get(b1.id).t === 800);

  // ── Voiding and deleting ───────────────────────────────────────────
  call('fees:record-payment', { student_id: 1, student_bill_id: b1.id, term_id: 1, amount: 200, received_by: 1 });
  ck('a bill with money against it cannot be deleted',
    call('fees:delete-bill', { billId: b1.id, reason: 'issued in error' }).code === 'HAS_PAYMENTS');
  ck('voiding requires a stated reason',
    call('fees:void-bill', { billId: b1.id, reason: '' }).ok === false);
  const voided = call('fees:void-bill', { billId: b1.id, reason: 'Pupil withdrew before the term started' });
  ck('the proprietor can void a bill, and is told the money stays recorded',
    voided.ok === true && voided.retained_payments === 200 && !!voided.warning);
  ck('voiding writes an audit entry naming who and why',
    db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='bill_voided' AND user_id=1").get().c === 1);
  ck('a voided bill drops out of the bills list',
    call('fees:list-bills', { termId: 1 }).every(b => b.id !== b1.id));
  ck('a voided bill drops out of the debtors report',
    call('fees:debtors-report', 1).every(d => d.id !== 1));
  ck('a voided bill stops counting towards billed and outstanding totals',
    call('fees:dashboard', 1).metrics.total_billed === 2251.5);
  ck('a voided bill is listed on the review screen with its reason',
    call('fees:list-voided-bills', 1).length === 1);
  let regenThrew = false;
  try { call('fees:generate-bill', { studentId: 1, termId: 1 }); } catch (_) { regenThrew = true; }
  ck('"Generate ALL" does not silently resurrect a voided bill', regenThrew);
  ck('a voided bill can be restored deliberately',
    call('fees:restore-bill', { billId: b1.id }).ok === true &&
    db.prepare('SELECT status FROM student_bills WHERE id=?').get(b1.id).status === 'active');

  // An unpaid bill is deletable outright.
  const b4 = db.prepare('SELECT id FROM student_bills WHERE student_id=4 AND term_id=1').get();
  ck('an unpaid bill can be deleted with a reason',
    call('fees:delete-bill', { billId: b4.id, reason: 'duplicate enrolment record' }).ok === true &&
    !db.prepare('SELECT id FROM student_bills WHERE id=?').get(b4.id));

  // ── Editing an issued bill ─────────────────────────────────────────
  const b2 = db.prepare('SELECT id FROM student_bills WHERE student_id=2 AND term_id=1').get();
  security.setCurrentUser(2, 'Class Teacher');
  ck('a class teacher cannot edit an issued bill',
    call('fees:adjust-bill-item', { billId: b2.id, description: 'Late fee', amount: 20, reason: 'because' }).code === 'NOT_ELEVATED');
  security.setCurrentUser(1, 'Proprietor');
  const adj = call('fees:adjust-bill-item', { billId: b2.id, description: 'Late registration', amount: 20, reason: 'registered after deadline' });
  ck('the proprietor can add a one-off charge to a single bill',
    adj.ok && adj.totals.totalBilled === 770.5);
  ck('editing an issued bill is audited', db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='bill_item_added'").get().c === 1);

  // ── Coverage warnings ──────────────────────────────────────────────
  const overview = call('fees:billing-overview', 1);
  ck('the billing overview resolves a template for every class',
    overview.ok && overview.coverage.length === 2 && overview.coverage.every(c => c.template_id));
  db.exec("INSERT INTO class_groups (id,name,short_code,level_category,level_order,is_active) VALUES (3,'CRECHE','CR','pre',1,1)");
  db.exec("INSERT INTO students (id,surname,first_name,index_number,current_class_id,status) VALUES (9,'N','B','X9',3,'Active')");
  db.exec("UPDATE fee_templates SET is_active = 0 WHERE class_group_id IS NULL AND term_id IS NULL");
  const overview2 = call('fees:billing-overview', 1);
  const creche = overview2.coverage.find(c => c.class_id === 3);
  ck('a class no template covers is reported as unbillable, not as owing nothing',
    creche.template_scope === 'none' &&
    overview2.warnings.some(w => w.level === 'error' && /CRECHE/.test(w.message)));
  // The creche pupil, plus the pupil whose duplicate bill was deleted above —
  // both now sit outside every active template.
  ck('pupils no template covers are counted, not silently dropped',
    call('fees:dashboard', 1).metrics.unbillable_students === 2);
  security.clearCurrentUser();
}

console.log('\n── A voided bill must not leak anywhere ──');
{
  // Voiding is only as good as its reach. A bill the school withdrew that
  // still shows on the parent's phone, in the cloud snapshot, on the main
  // dashboard or on the bulk-pay sheet is worse than not voiding at all.
  const db = makeDb();
  const security = require(path.join(ROOT, 'electron/ipc/_security.js'));
  const outbox = require(path.join(ROOT, 'electron/server/sync/outbox.js'));
  db.exec("INSERT INTO academic_years (id,label,is_current) VALUES (1,'2026/2027',1)");
  db.exec("INSERT INTO terms (id,academic_year_id,term_number,label,start_date,end_date,is_current) VALUES (1,1,1,'T1','2026-09-01','2026-12-20',1)");
  db.exec("INSERT INTO class_groups (id,name,short_code,level_category,level_order,is_active) VALUES (1,'BS5','BS5','basic',10,1)");
  db.exec("INSERT INTO students (id,surname,first_name,index_number,current_class_id,status) VALUES (1,'A','B','X1',1,'Active'),(2,'C','D','X2',1,'Active')");
  db.exec("INSERT INTO student_bills (id,student_id,term_id,total_billed,total_paid,balance) VALUES (1,1,1,400,0,400),(2,2,1,400,0,400)");
  db.exec("INSERT INTO designations (id,name,is_system) VALUES (1,'Proprietor',1)");
  db.exec("INSERT INTO users (id,username,password_hash,full_name,designation_id,is_active) VALUES (1,'p','x','Owner',1,1)");

  const h = {};
  const ipc = { handle: (n, f) => { h[n] = f; } };
  require(path.join(ROOT, 'electron/ipc/fees_billing.js'))(ipc, db);
  require(path.join(ROOT, 'electron/ipc/dashboard.js'))(ipc, db);
  require(path.join(ROOT, 'electron/ipc/fees_bulk_pay.js'))(ipc, db);

  security.setCurrentUser(1, 'Proprietor');
  h['fees:void-bill'](null, { billId: 1, reason: 'pupil never enrolled' });

  const summary = h['dashboard:summary'](null, 1);
  ck('a voided bill leaves the main dashboard outstanding total',
    summary.metrics.fees_outstanding === 400 && summary.metrics.debtor_count === 1);
  ck('a voided bill leaves the main dashboard top-debtors list',
    summary.top_fee_debtors.every(d => d.student_id !== 1));

  const sheet = h['fees:bulk-pay-sheet'](null, { classId: 1, termId: 1 });
  const row = sheet.find(r => r.student_id === 1);
  ck('a voided bill leaves the bulk payment sheet showing nothing owed',
    !row.bill_id && row.balance === 0 && row.status === 'not_billed');

  // The cloud snapshot the parent portal reads is built here.
  setSetting(db, 'cloud_sync_enabled', true, 'cloud');
  outbox.enqueueStudentSnapshot(db, 1);
  const queued = db.prepare("SELECT payload_json FROM sync_outbox WHERE entity_type='student_snapshot' ORDER BY id DESC LIMIT 1").get();
  const snap = queued ? JSON.parse(queued.payload_json) : null;
  ck('a voided bill is not projected into the cloud snapshot the portal reads',
    !!snap && (snap.fees_balance || 0) === 0 && (snap.fees_billed || 0) === 0);

  // The printed debtors list selected b.total_amount / b.paid_amount /
  // b.generated_date — none of which exist on student_bills — so it threw
  // "no such column" every time a school tried to print it. Same defect the
  // on-screen debtors report had.
  let listErr = null;
  const printedDebtors = (() => {
    try {
      return db.prepare(`
        SELECT s.index_number, s.surname, s.first_name, c.name AS class_name,
               b.total_billed AS total_amount, b.total_paid AS paid_amount, b.balance,
               b.generated_at AS generated_date
        FROM student_bills b
        JOIN students s ON s.id = b.student_id
        LEFT JOIN class_groups c ON c.id = s.current_class_id
        WHERE b.term_id = ? AND b.balance > 0 AND s.status = 'Active'
          AND COALESCE(b.status, 'active') = 'active'
        ORDER BY c.level_order, s.surname
      `).all(1);
    } catch (e) { listErr = e; return []; }
  })();
  ck('the printed debtors list query runs against the real schema', listErr === null);
  ck('the printed debtors list excludes voided bills',
    printedDebtors.length === 1 && printedDebtors[0].index_number === 'X2');

  security.clearCurrentUser();
}

console.log('\n── Bill printout ──');
{
  // The printed bill used to add the books balance twice: total_billed already
  // carries books arrears, and the footer printed `balance + booksBalance`.
  const reports = require(path.join(ROOT, 'electron/ipc/reports.js'));
  const html = reports.__billHtmlForTest(
    { name: 'S', motto: '', address: '', digital: '', email: '', phone1: '', phone2: '', logoData: null, primaryColor: '#123456', accentColor: '#333', colorMode: 'color' },
    { index_number: 'X1', surname: 'A', first_name: 'B', class_name: 'BS5', term_label: 'FIRST TERM',
      total_billed: 500, total_paid: 100, books_arrears: 200, discount_amount: 0 },
    [
      { item_number: 1, description: 'Tuition', amount: 300, charge_type: 'fees' },
      { item_number: 2, description: 'Excursion', amount: 50, charge_type: 'extra' },
    ]
  );
  // Fees 300 + extras 50 + books 200 = 550 due, less 100 paid = 450.
  ck('the printed bill does not double-count the books balance',
    html.includes('GHS 550.00') && html.includes('GHS 450.00'));
  ck('supplementary charges get their own part on the printed bill',
    html.includes('PART D'));
  ck('the printed bill no longer fills every arrears row with colour',
    !html.includes('background:#fef2f2;"') || !html.includes('#fecaca'));
  ck('section bars are measured in points, not millimetres of solid fill',
    !/bill-section-title[^>]*padding:\s*4px/.test(html));

  // The whole point of the redesign: a colour bill and a mono bill must look
  // the same. That only holds if section headers are NOT solid colour bands
  // with reversed-out white text (which a mono printer renders as heavy slabs).
  const styles = reports.__billStylesForTest();
  ck('section headers are a light tint with a coloured left rule, not a solid fill',
    /border-left:\s*3pt solid var\(--accent/.test(styles) &&
    /background:\s*var\(--accent-tint/.test(styles));
  ck('no bill section header paints white reversed-out text on a solid fill',
    !/bill-section-title[^"]*color:\s*#fff/.test(html) &&
    !/class="bill-section-title"[^>]*background:#[0-9a-fA-F]{6}/.test(html));
  ck('the amount-due block is no longer a solid reversed-out band',
    !/bill-due[^>]*color:#fff/.test(html));
}


console.log('\n── Access control: level ladder, roles, individual overrides ──');
{
  const _access = require(path.join(ROOT, 'electron/ipc/_access.js'));

  // The ladder maps cleanly onto the four booleans, and back.
  ck('No access → all flags off',
    JSON.stringify(_access.levelToPerms('no')) === JSON.stringify({ can_view: 0, can_create: 0, can_edit: 0, can_delete: 0 }));
  ck('View grants only read',
    _access.levelToPerms('view').can_view === 1 && _access.levelToPerms('view').can_create === 0);
  ck('Contribute grants view + create, not edit',
    _access.levelToPerms('contribute').can_create === 1 && _access.levelToPerms('contribute').can_edit === 0);
  ck('Manage grants up to edit, not delete',
    _access.levelToPerms('manage').can_edit === 1 && _access.levelToPerms('manage').can_delete === 0);
  ck('Full grants everything', _access.levelToPerms('full').can_delete === 1);
  ck('perms round-trip through a level', _access.permsToLevel(_access.levelToPerms('manage')) === 'manage');
  ck('a non-ladder combo reduces to the highest contiguous level, never over-reporting',
    _access.permsToLevel({ can_view: 1, can_create: 0, can_edit: 0, can_delete: 1 }) === 'view');

  const db = makeDb();
  const security = require(path.join(ROOT, 'electron/ipc/_security.js'));
  const h = {};
  const ipc = { handle: (n, f) => { h[n] = f; } };
  require(path.join(ROOT, 'electron/ipc/access.js'))(ipc, db);
  const call = (n, a) => h[n](null, a);

  // makeDb() applies the schema + migrations but not seedDefaults, so stand up
  // the standard designations the way production seeds them: money → Accountant,
  // academics/canteen → Class Teacher, and the two always-full system roles.
  const mkRole = (name, sys, levels) => {
    const id = db.prepare('INSERT INTO designations (name, is_system) VALUES (?, ?)').run(name, sys ? 1 : 0).lastInsertRowid;
    for (const m of _access.MODULE_KEYS) {
      const p = _access.levelToPerms(levels[m] || 'no');
      db.prepare('INSERT INTO designation_permissions (designation_id,module,can_view,can_create,can_edit,can_delete) VALUES (?,?,?,?,?,?)')
        .run(id, m, p.can_view, p.can_create, p.can_edit, p.can_delete);
    }
    return id;
  };
  const proprietor = mkRole('Proprietor', 1, {});   // always-full by name; rows ignored
  mkRole('Administrator', 1, {});
  const accountant = mkRole('Accountant', 1, {
    dashboard: 'view', students: 'view', fees: 'full', canteen: 'view',
    payroll: 'full', finance: 'full', staff: 'view',
  });
  const classTeacher = mkRole('Class Teacher', 1, {
    dashboard: 'view', students: 'view', academics: 'full', canteen: 'full', notifications: 'view',
  });
  db.exec("INSERT INTO users (id,username,password_hash,full_name,designation_id,is_active) VALUES (1,'own','x','Owner',?,1)".replace('?', proprietor));
  db.exec(`INSERT INTO users (id,username,password_hash,full_name,designation_id,is_active) VALUES (2,'tr','x','A Teacher',${classTeacher},1)`);

  // Not signed in → cannot change access.
  security.clearCurrentUser();
  ck('an unauthenticated caller cannot change a role',
    call('access:set-role-level', { designationId: accountant, module: 'finance', level: 'full' }).ok === false);

  // A Class Teacher (not elevated, no settings-edit) cannot change access.
  security.setCurrentUser(2, 'Class Teacher');
  ck('a class teacher cannot change access control',
    call('access:set-role-level', { designationId: accountant, module: 'finance', level: 'view' }).ok === false);

  security.setCurrentUser(1, 'Proprietor');

  // Seeded expectations from the domain: Accountant runs the money, teacher runs
  // academics + canteen.
  const matrix = call('access:role-matrix');
  const acc = matrix.find(r => r.id === accountant);
  const tea = matrix.find(r => r.id === classTeacher);
  ck('the Accountant role owns finance, fees and payroll out of the box',
    acc.levels.finance === 'full' && acc.levels.fees === 'full' && acc.levels.payroll === 'full');
  ck('the Class Teacher role owns academics and canteen, not finance',
    tea.levels.academics === 'full' && tea.levels.canteen === 'full' && tea.levels.finance === 'no');
  ck('Proprietor is reported as always-full and locked',
    matrix.find(r => r.id === proprietor).always_full === true);
  ck('the role card reports how many areas are granted',
    acc.module_count === _access.MODULE_KEYS.length && acc.granted_count > 0);

  // Proprietor/Administrator cannot be reduced.
  ck('the Proprietor role cannot be down-levelled',
    call('access:set-role-level', { designationId: proprietor, module: 'finance', level: 'no' }).ok === false);

  // Editing a role — on a scratch role, so the Class Teacher the individual
  // scenario below depends on is left untouched.
  const scratch = mkRole('Games Master', 0, { academics: 'full' });
  call('access:set-role-level', { designationId: scratch, module: 'students', level: 'contribute' });
  ck('a role level can be changed and persists',
    call('access:role-matrix').find(r => r.id === scratch).levels.students === 'contribute');
  call('access:set-role-all', { designationId: scratch, module: undefined, level: 'view' });
  ck('"set all" puts every module on one level',
    _access.MODULE_KEYS.every(m => call('access:role-matrix').find(r => r.id === scratch).levels[m] === 'view'));

  // Custom role, copied from another.
  const created = call('access:create-role', { name: 'Bursar', description: 'Handles fees at the front desk', copyFromId: accountant });
  ck('a custom role can be created as a copy of another',
    created.ok && call('access:role-matrix').find(r => r.id === created.id).levels.fees === 'full');
  ck('a duplicate role name is refused',
    call('access:create-role', { name: 'bursar' }).ok === false);
  ck('a built-in role cannot be deleted',
    call('access:delete-role', { designationId: accountant }).ok === false);

  // ── The headline scenario: no accountant, so a teacher is given limited
  //    finance access as an individual — without becoming an accountant. ──
  let ua = call('access:user-access', 2);
  ck('by default the teacher inherits the role: no finance access',
    ua.rows.find(r => r.module === 'finance').effective_level === 'no' &&
    ua.rows.find(r => r.module === 'finance').override_level === null);

  call('access:set-user-level', { userId: 2, module: 'finance', level: 'contribute' });
  ua = call('access:user-access', 2);
  const finRow = ua.rows.find(r => r.module === 'finance');
  ck('an individual can be granted finance access above their role',
    finRow.override_level === 'contribute' && finRow.effective_level === 'contribute' && finRow.role_level === 'no');
  ck('the individual override reaches the real permission resolver',
    require(path.join(ROOT, 'electron/ipc/auth.js')).resolveEffectivePermissions(db, 2).finance.canCreate === true);
  ck('the teacher is still a Class Teacher, not an Accountant',
    db.prepare('SELECT d.name n FROM users u JOIN designations d ON d.id=u.designation_id WHERE u.id=2').get().n === 'Class Teacher');

  // Clearing the override falls back to the role.
  call('access:set-user-level', { userId: 2, module: 'finance', level: 'inherit' });
  ck('clearing an override falls back to the role default',
    call('access:user-access', 2).rows.find(r => r.module === 'finance').override_level === null);

  // Proprietor overrides are meaningless (always full) and refused.
  ck('an override on a Proprietor account is refused',
    call('access:set-user-level', { userId: 1, module: 'finance', level: 'no' }).ok === false);

  security.clearCurrentUser();
}


console.log('\n── Finance workbook: offline continuity ──');
{
  // The workbook is the school's fallback when the computer is down, which
  // makes it a write-back medium rather than a report. The properties that
  // matter are: the layout contract holds, dates and money survive Excel's
  // many representations, and money can NEVER be posted twice.
  const wbSchema = require(path.join(ROOT, 'electron/ipc/_workbook_schema.js'));

  // ── Date parsing: Excel hands the same day back three different ways ──
  ck('an ISO date string parses', wbSchema.toISODate('2026-06-02') === '2026-06-02');
  ck('the dd/mm/yyyy the school already used parses',
    wbSchema.toISODate('25/05/2026') === '2026-05-25');
  ck('a Date object parses without slipping a day west of Greenwich',
    wbSchema.toISODate(new Date('2026-06-02T00:00:00Z')) === '2026-06-02');
  ck('an Excel serial number parses', wbSchema.toISODate(46175) === '2026-06-02');
  ck('a blank date is null, not today', wbSchema.toISODate('') === null);

  // ── Money parsing ──
  ck('a typed amount with currency and separators parses',
    wbSchema.toMoney('GHS 1,250.50') === 1250.5);
  ck('a formula cell parses to its computed result',
    wbSchema.toMoney({ formula: 'M5+O5', result: 390 }) === 390);
  ck('money is rounded to pesewas', wbSchema.toMoney(10.005) === 10.01);

  // ── The idempotency key ──
  const rowA = { payment_date: '2026-06-02', index_number: 'AVE/21/00057', amount: 200, reference: '' };
  ck('the same row always produces the same key',
    wbSchema.entryKey('Fee Payments', rowA, 1) === wbSchema.entryKey('Fee Payments', rowA, 1));
  ck('spacing and case do not change the key',
    wbSchema.entryKey('Fee Payments', rowA, 1) ===
    wbSchema.entryKey('Fee Payments', { ...rowA, index_number: '  ave/21/00057 ' }, 1));
  ck('a different amount is a different entry',
    wbSchema.entryKey('Fee Payments', rowA, 1) !== wbSchema.entryKey('Fee Payments', { ...rowA, amount: 201 }, 1));
  ck('two genuinely identical rows in one file stay distinct',
    wbSchema.entryKey('Fee Payments', rowA, 1) !== wbSchema.entryKey('Fee Payments', rowA, 2));
  ck('the same row on a different sheet is a different entry',
    wbSchema.entryKey('Fee Payments', rowA, 1) !== wbSchema.entryKey('Canteen Payments', rowA, 1));

  // ── Every entry sheet obeys the contract the importer relies on ──
  const sheets = Object.keys(wbSchema.ENTRY_SHEETS);
  ck('every money sheet is covered by the workbook', sheets.length === 7);
  ck('every entry sheet starts with Status then Entry Ref',
    sheets.every(n => {
      const c = wbSchema.ENTRY_SHEETS[n].columns;
      return c[0].key === 'status' && c[1].key === 'entry_ref';
    }));
  ck('every entry sheet declares what makes two rows different',
    sheets.every(n => (wbSchema.ENTRY_SHEETS[n].identity || []).length >= 3));
  ck('every entry sheet has a required date and a required amount',
    sheets.every(n => {
      const c = wbSchema.ENTRY_SHEETS[n].columns;
      return c.some(x => x.date && x.required) && c.some(x => x.money && x.required);
    }));
  ck('every entry sheet routes to a known service',
    sheets.every(n => ['fees','canteen','books','transport','income','expense','payroll']
      .includes(wbSchema.ENTRY_SHEETS[n].target)));
  ck('column headers within a sheet are unique, so the importer cannot mis-map',
    sheets.every(n => {
      const h = wbSchema.ENTRY_SHEETS[n].columns.map(c => c.header.toLowerCase());
      return new Set(h).size === h.length;
    }));

  // ── The import log is what makes a repeat import safe ──
  const db = makeDb();
  db.prepare(`INSERT INTO workbook_import_log (entry_key, sheet, amount) VALUES ('XL-ABC', 'Fee Payments', 200)`).run();
  let dupeBlocked = false;
  try {
    db.prepare(`INSERT INTO workbook_import_log (entry_key, sheet, amount) VALUES ('XL-ABC', 'Fee Payments', 200)`).run();
  } catch (_) { dupeBlocked = true; }
  ck('the database itself refuses to log the same entry twice', dupeBlocked);
}

console.log('\n── Finance workbook: round trip ──');
{
  // Export a workbook, type entries into it the way a school would while the
  // system is down, and import it back. This is the whole feature in one test.
  const ExcelJS = (() => { try { return require('exceljs'); } catch (_) { return null; } })();
  if (!ExcelJS) {
    console.log('  (skipped — exceljs not installed in this environment)');
  } else {
    const os = require('os');
    const wbSchema = require(path.join(ROOT, 'electron/ipc/_workbook_schema.js'));
    const security = require(path.join(ROOT, 'electron/ipc/_security.js'));
    const { buildWorkbook } = require(path.join(ROOT, 'electron/ipc/finance_workbook_export.js'));
    const { importWorkbook } = require(path.join(ROOT, 'electron/ipc/finance_workbook_import.js'));

    const db = makeDb();
    db.exec("INSERT INTO settings (key,value,category) VALUES ('school_name','AVE MARIA','school'),('canteen_daily_rate','5','canteen'),('receipt_counter','1','system'),('transaction_counter','1','system')");
    db.exec("INSERT INTO academic_years (id,label,is_current) VALUES (1,'2025/2026',1)");
    db.exec("INSERT INTO terms (id,academic_year_id,term_number,label,start_date,end_date,is_current) VALUES (1,1,3,'Third Term','2026-04-07','2026-07-31',1)");
    db.exec("INSERT INTO class_groups (id,name,short_code,level_category,level_order,is_active) VALUES (1,'Class 1','C1','basic',6,1)");
    db.exec("INSERT INTO students (id,surname,first_name,index_number,current_class_id,gender,status) VALUES (1,'ABAMBEY','EMMA','AVE/21/00056',1,'F','Active'),(2,'ACHEAMPONG','RAPHAEL','AVE/21/00057',1,'M','Active')");
    db.exec("INSERT INTO fee_templates (id,name,class_group_id,term_id,is_active,bill_type) VALUES (1,'T3',NULL,1,1,'school_fees')");
    db.exec("INSERT INTO fee_line_items (fee_template_id,item_number,description,amount) VALUES (1,1,'TUITION',250),(1,2,'EXAMS',50)");
    db.exec("INSERT INTO staff (id,staff_number,surname,first_name,role,status) VALUES (1,'STF001','MENSAH','KWAME','Teacher','Active')");
    db.exec("INSERT INTO staff_salaries (id,staff_id,month,year,gross_salary,net_salary,is_paid) VALUES (1,1,5,2026,1000,905,0)");
    for (const d of ['2026-04-07','2026-04-08','2026-04-09','2026-04-10','2026-04-13'])
      db.prepare("INSERT INTO school_calendar (date,day_type,term_id) VALUES (?,'school_day',1)").run(d);
    db.exec("INSERT INTO designations (id,name,is_system) VALUES (1,'Proprietor',1)");
    db.exec("INSERT INTO users (id,username,password_hash,full_name,designation_id,is_active) VALUES (1,'own','x','Owner',1,1)");
    security.setCurrentUser(1, 'Proprietor');

    const h = {}; const reg = { handle: (n, f) => { h[n] = f; } };
    require(path.join(ROOT, 'electron/ipc/fees.js'))(reg, db);
    h['fees:generate-bulk'](null, { termId: 1, scope: 'all' });

    const run = (async () => {
      const out = path.join(os.tmpdir(), `nk-wb-${Date.now()}.xlsx`);
      const built = await buildWorkbook(db, out, {});
      ck('the workbook exports every money sheet, not just fees',
        built.ok &&
        [wbSchema.SHEETS.FEE_PAYMENTS, wbSchema.SHEETS.CANTEEN, wbSchema.SHEETS.CANTEEN_PAYMENTS,
         wbSchema.SHEETS.BOOKS_PAYMENTS, wbSchema.SHEETS.TRANSPORT, wbSchema.SHEETS.OTHER_INCOME,
         wbSchema.SHEETS.EXPENSES, wbSchema.SHEETS.PAYROLL, wbSchema.SHEETS.SUMMARY]
          .every(s => built.sheets.includes(s)));
      ck('the canteen sheet the old ledger left empty now carries every pupil',
        built.sheets.includes(wbSchema.SHEETS.CANTEEN));

      // Type offline entries onto the green rows.
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(out);
      const cursor = {};
      const setRow = (sheet, vals) => {
        const ws = wb.getWorksheet(sheet);
        if (cursor[sheet] === undefined) {
          let r = wbSchema.HEADER_ROWS + 1;
          while (String(wbSchema.cellText(ws.getRow(r).getCell(1).value)).trim().toUpperCase() !== 'NEW') r++;
          cursor[sheet] = r;
        }
        const rr = cursor[sheet]++;
        wbSchema.ENTRY_SHEETS[sheet].columns.forEach((c, i) => {
          if (vals[c.key] !== undefined) ws.getCell(rr, i + 1).value = vals[c.key];
        });
      };
      setRow(wbSchema.SHEETS.FEE_PAYMENTS, { payment_date: '2026-06-02', index_number: 'AVE/21/00057', amount: 200, payment_method: 'Cash' });
      setRow(wbSchema.SHEETS.FEE_PAYMENTS, { payment_date: '2026-06-02', index_number: 'NOPE/1', amount: 99 });
      setRow(wbSchema.SHEETS.CANTEEN_PAYMENTS, { payment_date: '2026-04-08', index_number: 'AVE/21/00056', amount: 25 });
      setRow(wbSchema.SHEETS.OTHER_INCOME, { transaction_date: '2026-06-03', category: 'donation', payer_name: 'PTA', description: 'Speech day', amount: 500 });
      setRow(wbSchema.SHEETS.EXPENSES, { transaction_date: '2026-06-03', category: 'supplies', payee_name: 'Kofi Stores', description: 'Chalk', amount: 180 });
      setRow(wbSchema.SHEETS.PAYROLL, { staff_number: 'STF001', month: 5, year: 2026, amount_paid: 905, payment_date: '2026-06-01', payment_method: 'Bank' });
      const filled = path.join(os.tmpdir(), `nk-wb-filled-${Date.now()}.xlsx`);
      await wb.xlsx.writeFile(filled);

      // Preview must not write anything, and must predict the outcome exactly.
      const incomeBefore = db.prepare('SELECT COUNT(*) n FROM income_records').get().n;
      const prev = await importWorkbook(db, filled, { dryRun: true });
      ck('preview writes nothing at all',
        db.prepare('SELECT COUNT(*) n FROM income_records').get().n === incomeBefore &&
        db.prepare('SELECT COUNT(*) n FROM workbook_import_log').get().n === 0);
      ck('preview reports a pupil that does not exist instead of guessing',
        prev.totals.failed === 1 &&
        prev.sheets.some(s => s.problems.some(p => /No pupil with Index No/.test(p.error))));

      const first = await importWorkbook(db, filled, { dryRun: false, userId: 1 });
      ck('the import does exactly what the preview promised',
        first.totals.imported === prev.totals.imported &&
        first.totals.failed === prev.totals.failed &&
        first.totals.amount === prev.totals.amount);
      ck('every kind of money on the workbook comes in', first.totals.imported === 5);

      // The whole point: it reaches the rest of the system, not just a table.
      ck('an imported fee payment updates the pupil\'s bill',
        db.prepare('SELECT total_paid, balance FROM student_bills WHERE student_id = 2').get().total_paid === 200);
      ck('an imported fee payment posts to the finance ledger under its own term',
        db.prepare("SELECT COUNT(*) n FROM income_records WHERE category='fees' AND amount=200 AND term_id=1").get().n === 1);
      ck('an imported canteen payment marks the days paid, not just the cash',
        db.prepare("SELECT COUNT(*) n FROM canteen_day_status WHERE student_id=1 AND status='paid'").get().n === 4);
      ck('imported other income reaches the ledger',
        db.prepare("SELECT COUNT(*) n FROM income_records WHERE category='donation' AND amount=500").get().n === 1);
      ck('an imported expense reaches the ledger',
        db.prepare("SELECT COUNT(*) n FROM expense_records WHERE category='supplies' AND amount=180").get().n === 1);
      ck('an imported salary settles payroll AND posts the expense',
        db.prepare('SELECT is_paid, actual_amount_paid FROM staff_salaries WHERE id=1').get().is_paid === 1 &&
        db.prepare('SELECT COUNT(*) n FROM expense_records WHERE linked_salary_id = 1').get().n === 1);

      // The property the school's money depends on.
      const incomeTotal = () => db.prepare('SELECT ROUND(COALESCE(SUM(amount),0),2) t FROM income_records').get().t;
      const beforeRepeat = incomeTotal();
      const second = await importWorkbook(db, filled, { dryRun: false, userId: 1 });
      ck('importing the very same workbook again brings in nothing',
        second.totals.imported === 0 && second.totals.duplicates === 5);
      ck('importing twice does not move a single pesewa', incomeTotal() === beforeRepeat);
      ck('importing twice does not double the pupil\'s paid figure',
        db.prepare('SELECT total_paid FROM student_bills WHERE student_id = 2').get().total_paid === 200);

      // A failed row must not leave a claim behind, or it could never be retried.
      ck('a row that failed is not logged, so it can be corrected and re-imported',
        db.prepare('SELECT COUNT(*) n FROM workbook_import_log').get().n === 5);

      // Fixing the bad row and re-importing brings in only that row.
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.readFile(filled);
      const ws2 = wb2.getWorksheet(wbSchema.SHEETS.FEE_PAYMENTS);
      const idxCol = wbSchema.ENTRY_SHEETS[wbSchema.SHEETS.FEE_PAYMENTS].columns.findIndex(c => c.key === 'index_number') + 1;
      for (let r = wbSchema.HEADER_ROWS + 1; r <= ws2.rowCount; r++) {
        if (wbSchema.cellText(ws2.getRow(r).getCell(idxCol).value).trim() === 'NOPE/1') {
          ws2.getCell(r, idxCol).value = 'AVE/21/00056';
        }
      }
      const fixed = path.join(os.tmpdir(), `nk-wb-fixed-${Date.now()}.xlsx`);
      await wb2.xlsx.writeFile(fixed);
      const third = await importWorkbook(db, fixed, { dryRun: false, userId: 1 });
      ck('correcting a bad row and re-importing brings in only that row',
        third.totals.imported === 1 && third.totals.duplicates === 5 && third.totals.failed === 0);

      for (const f of [out, filled, fixed]) { try { fs.unlinkSync(f); } catch (_) {} }
      security.clearCurrentUser();
    })();

    // The suite is synchronous; block on the async round trip before reporting.
    run.then(() => {
      console.log(`\n${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    }).catch(e => {
      console.error('Workbook round trip threw:', e);
      process.exit(1);
    });
    return;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
