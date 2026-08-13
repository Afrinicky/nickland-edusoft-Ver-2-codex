// End-to-end: the REAL cloud server (memory store) + the REAL desktop sync
// client talking to each other over localhost. Proves both halves interoperate.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

// Tests opt into the shared development signing secret; production refuses it.
process.env.ALLOW_DEV_SECRET = '1';

const { createServer } = require('../src/server');
const { createMemoryStore } = require('../src/store');

const ROOT = path.resolve(__dirname, '..', '..');
const outbox = require(path.join(ROOT, 'electron/server/sync/outbox.js'));
const client = require(path.join(ROOT, 'electron/server/sync/client.js'));

let pass = 0, fail = 0; const ck = (n, c) => { (c ? pass++ : fail++); console.log((c ? '✓' : '✗') + ' ' + n); };

function makeDesktopDb() {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...a) => { db.exec('BEGIN'); try { const r = fn(...a); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  // Build the schema exactly the way the app does — base schema, then the real
  // migrations — so the tests can never pass against a shape production
  // doesn't have (parents, parent_students, sync_outbox and sync_versions all
  // come from the migrations).
  const { SCHEMA, runMigrations } = require(path.join(ROOT, 'electron/db/database.js'));
  db.exec(SCHEMA);
  runMigrations(db);
  db.exec("INSERT INTO academic_years (id,label,is_current) VALUES (1,'2025/2026',1);");
  db.exec("INSERT INTO terms (id,academic_year_id,term_number,label,start_date,end_date,is_current) VALUES (3,1,3,'T3','2026-04-22','2026-07-31',1);");
  db.exec("INSERT INTO class_groups (id,name,short_code,level_category,level_order) VALUES (1,'BS5','BS5','basic',10);");
  db.exec("INSERT INTO students (id,surname,first_name,index_number,current_class_id,status) VALUES (1,'ANSU','MONA','AVE/17/00001',1,'Active');");
  db.exec("INSERT INTO student_bills (id,student_id,term_id,total_billed,total_paid,balance) VALUES (1,1,3,410,150,260);");
  db.exec("INSERT INTO parents (id,full_name,phone) VALUES (1,'Papa','233244123456');");
  // Academic + attendance data so the snapshot's report/attendance projections
  // are exercised end-to-end (not just the fee balance).
  db.exec("INSERT INTO subjects (id,name,code,is_active) VALUES (1,'Mathematics','MATH',1);");
  db.exec("INSERT INTO scores (student_id,term_id,subject_id,class_score,exam_score,total_score,grade_remark) VALUES (1,3,1,30,55,85,'Higher');");
  db.exec("INSERT INTO student_term_summary (student_id,term_id,class_group_id,total_score_all,average_score,class_rank,number_on_roll,teacher_remarks) VALUES (1,3,1,85,85,2,20,'Good work.');");
  db.exec("INSERT INTO student_attendance (student_id,date,status,term_id) VALUES (1,'2026-04-23','present',3),(1,'2026-04-24','absent',3);");
  db.prepare("INSERT OR REPLACE INTO settings (key,value,category) VALUES ('canteen_daily_rate','5','canteen')").run();
  for (const kv of ['cloud_sync_enabled=false','cloud_base_url=','school_api_key=','cloud_school_id=','cloud_cursor=0','cloud_push_batch=100','cloud_last_push_at=','cloud_last_pull_at=']) {
    const [k, v = ''] = kv.split('='); db.prepare("INSERT OR REPLACE INTO settings (key,value,category) VALUES (?,?,'cloud')").run(k, v);
  }
  return db;
}

(async () => {
  const store = createMemoryStore();
  const { school_id, api_key } = await store.createSchool({ name: 'Ave Maria School' });
  const server = createServer(store);

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  const db = makeDesktopDb();
  const setS = (k, v) => db.prepare("UPDATE settings SET value=? WHERE key=?").run(v, k);
  setS('cloud_sync_enabled', 'true'); setS('cloud_base_url', base); setS('school_api_key', api_key); setS('cloud_school_id', school_id);

  ck('desktop client sees it as configured', client.configured(db) === true);

  // Desktop: enqueue a balance snapshot, then push to the real cloud.
  outbox.enqueueStudentSnapshot(db, 1);
  const p = await client.push(db);
  ck('push ok (1 record)', p.ok && p.pushed === 1);

  // Cloud received + stored the thin snapshot.
  const snaps = await store.listSnapshots(school_id, 'student_snapshot');
  ck('cloud stored the student snapshot', snaps.length === 1 && snaps[0].payload.fees.balance === 260);
  ck('desktop outbox drained', outbox.pendingCount(db) === 0);

  // The snapshot must carry attendance + academic performance, not just money —
  // otherwise parents off-LAN can only see balances (the gap this guards).
  const sp = snaps[0].payload;
  ck('snapshot carries attendance summary', sp.attendance && sp.attendance.total === 2 && sp.attendance.present === 1 && sp.attendance.absent === 1);
  ck('snapshot carries academic report', sp.report && Array.isArray(sp.report.subjects) && sp.report.subjects.length === 1
    && sp.report.subjects[0].subject === 'Mathematics' && Number(sp.report.average) === 85 && sp.report.rank === 2);

  // Portal read endpoint returns the same read model (what the web page renders).
  const { httpJson } = require(path.join(ROOT, 'electron/server/gateways/http.js'));
  const portal = await httpJson(`${base}/api/v1/admin/snapshots?type=student_snapshot`, { headers: { 'x-school-key': api_key } });
  ck('admin read endpoint serves the snapshot', portal.json.ok && portal.json.snapshots[0].payload.name.includes('ANSU'));

  // Cloud: a parent edits their profile on the web → enqueue a change.
  await store.enqueueChange(school_id, { type: 'parent_update', payload: { parent_id: 1, full_name: 'Papa Ansu', email: 'papa@mail.com' } });

  // Desktop pulls and reconciles it locally.
  const q = await client.pull(db);
  ck('pull applied 1 change', q.ok && q.applied === 1);
  const parent = db.prepare('SELECT full_name, email FROM parents WHERE id=1').get();
  ck('desktop parent updated from cloud', parent.full_name === 'Papa Ansu' && parent.email === 'papa@mail.com');

  // Idempotent re-pull.
  const q2 = await client.pull(db);
  ck('re-pull applies 0', q2.ok && q2.applied === 0);

  // ── Full chain: desktop provisions a parent → projects auth → website login ──
  const parents = require(path.join(ROOT, 'electron/server/parents.js'));
  const prov = parents.provisionParent(db, { full_name: 'Mama', phone: '0209998887', password: 'pass12', studentIds: [1] });
  ck('desktop provisions a parent', prov.ok);
  await client.push(db); // projects parent_auth (+ the student snapshot is already up)
  const login = await httpJson(`${base}/api/v1/portal/login`, { method: 'POST', body: { school_id, identifier: '0209998887', password: 'pass12' } });
  ck('parent logs into the website (auth projected from desktop)', login.json && login.json.ok && !!login.json.token);
  const kids = await httpJson(`${base}/api/v1/portal/children`, { headers: { Authorization: 'Bearer ' + login.json.token } });
  ck('website shows the child pushed from the desktop', kids.json.ok && kids.json.children.length === 1 && kids.json.children[0].fees.balance === 260);
  const kid = kids.json.children[0];
  ck('website serves attendance to the parent', kid.attendance && kid.attendance.present === 1 && kid.attendance.absent === 1);
  ck('website serves results to the parent', kid.report && kid.report.subjects.length === 1 && Number(kid.report.average) === 85 && kid.report.rank === 2);

  // Wrong key is rejected by the cloud.
  setS('school_api_key', 'sk_wrong');
  outbox.postToOutbox(db, { entity_type: 'receipt', entity_key: 'r1', payload: {} });
  const bad = await client.push(db);
  ck('push with wrong key rejected + kept pending', !bad.ok && outbox.pendingCount(db) === 1);

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
