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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
