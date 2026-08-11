// Cross-language proof: the REAL Node desktop sync client driving the running
// PYTHON FastAPI cloud. Usage: node cross_client.js <base> <schoolId> <apiKey>
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const [base, schoolId, apiKey] = process.argv.slice(2);
const ROOT = path.resolve(__dirname, '..', '..');
const outbox = require(path.join(ROOT, 'electron/server/sync/outbox.js'));
const client = require(path.join(ROOT, 'electron/server/sync/client.js'));
const { httpJson } = require(path.join(ROOT, 'electron/server/gateways/http.js'));

let pass = 0, fail = 0; const ck = (n, c) => { (c ? pass++ : fail++); console.log((c ? '✓' : '✗') + ' ' + n); };

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...a) => { db.exec('BEGIN'); try { const r = fn(...a); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  // Same schema construction as the app: base schema + the real migrations.
  const { SCHEMA, runMigrations } = require(path.join(ROOT, 'electron/db/database.js'));
  db.exec(SCHEMA);
  runMigrations(db);
  db.exec("INSERT INTO academic_years (id,label,is_current) VALUES (1,'2025/2026',1);");
  db.exec("INSERT INTO terms (id,academic_year_id,term_number,label,start_date,end_date,is_current) VALUES (3,1,3,'T3','2026-04-22','2026-07-31',1);");
  db.exec("INSERT INTO class_groups (id,name,short_code,level_category,level_order) VALUES (1,'BS5','BS5','basic',10);");
  db.exec("INSERT INTO students (id,surname,first_name,index_number,current_class_id,status) VALUES (1,'ANSU','MONA','AVE/17/00001',1,'Active');");
  db.exec("INSERT INTO student_bills (id,student_id,term_id,total_billed,total_paid,balance) VALUES (1,1,3,410,150,260);");
  db.exec("INSERT INTO parents (id,full_name,phone) VALUES (1,'Papa','233244123456');");
  db.prepare("INSERT OR REPLACE INTO settings (key,value,category) VALUES ('canteen_daily_rate','5','canteen')").run();
  for (const kv of ['cloud_sync_enabled=true', `cloud_base_url=${base}`, `school_api_key=${apiKey}`, `cloud_school_id=${schoolId}`, 'cloud_cursor=0', 'cloud_push_batch=100', 'cloud_last_push_at=', 'cloud_last_pull_at=']) {
    const [k, v = ''] = kv.split('='); db.prepare("INSERT OR REPLACE INTO settings (key,value,category) VALUES (?,?,'cloud')").run(k, v);
  }
  return db;
}

(async () => {
  const db = makeDb();

  const ping = await httpJson(`${base}/api/v1/sync/ping`, { headers: { 'x-school-key': apiKey } });
  ck('Node client pings Python cloud', ping.json && ping.json.ok);

  // Desktop pushes a snapshot to the Python cloud.
  outbox.enqueueStudentSnapshot(db, 1);
  const p = await client.push(db);
  ck('Node push → Python push ok (1)', p.ok && p.pushed === 1);

  // Python read model has it.
  const snaps = await httpJson(`${base}/api/v1/admin/snapshots?type=student_snapshot`, { headers: { 'x-school-key': apiKey } });
  ck('Python cloud stored the snapshot (balance 260)', snaps.json.ok && snaps.json.snapshots[0].payload.fees.balance === 260);

  // Python cloud enqueues a change; Node desktop pulls + reconciles it.
  await httpJson(`${base}/api/v1/admin/enqueue-change`, { method: 'POST', headers: { 'x-school-key': apiKey }, body: { type: 'parent_update', payload: { parent_id: 1, full_name: 'Papa Ansu', email: 'papa@mail.com' } } });
  const q = await client.pull(db);
  ck('Node pull ← Python applied 1', q.ok && q.applied === 1);
  const parent = db.prepare('SELECT full_name, email FROM parents WHERE id=1').get();
  ck('desktop parent updated from Python cloud', parent.full_name === 'Papa Ansu' && parent.email === 'papa@mail.com');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
