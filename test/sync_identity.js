// Nickland Edusoft — stable identity, and a journal that can be replayed.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Phase 2 of the cloud-first work. Nothing it adds changes what the
// application does; it changes what the database can say about what was done,
// which is what two-way synchronisation stands on.
//
// Four properties are asserted, because each of them failing would be silent:
//
//   identity   every table that crosses between machines carries a record_uid,
//              unique, allocated by whichever machine made the row
//   capture    every write path produces exactly one journal entry — not two,
//              not none — whichever surface the call arrived on
//   fidelity   the entry carries the row, the actor and the machine, so an
//              offline morning can be replayed and answered for
//   leases     two machines working offline cannot mint the same receipt number
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`These tests need Node >= 22.5 for node:sqlite (running ${process.versions.node}).`);
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { SCHEMA, runMigrations, seedDefaults } = require(path.join(ROOT, 'electron/db/database.js'));
const { SYNCED, NOT_SYNCED, isFinancial } = require(path.join(ROOT, 'electron/db/sync_tables.js'));
const { applySyncSchema, dropSyncTriggers } = require(path.join(ROOT, 'electron/db/sync_schema.js'));
const syncContext = require(path.join(ROOT, 'electron/db/sync_context.js'));
const journal = require(path.join(ROOT, 'electron/db/journal.js'));
const leases = require(path.join(ROOT, 'electron/db/leases.js'));
const { uuidv7, uuidv7Time, isUuid } = require(path.join(ROOT, 'electron/utils/uid.js'));

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

// ── the id itself ───────────────────────────────────────────────────────────
console.log('\n── UUIDv7 ──');
{
  const n = 20000;
  const ids = Array.from({ length: n }, () => uuidv7());
  ck('twenty thousand ids, all distinct', new Set(ids).size === n);
  ck('...all the right shape', ids.every(isUuid));
  ck('...version 7 and a valid variant',
    ids.every(u => u[14] === '7' && '89ab'.includes(u[19])));
  // Ordering is why v7 and not v4: the journal is read in sequence, and an
  // index on a random id scatters inserts across every page it has.
  let ordered = true;
  for (let i = 1; i < ids.length; i++) if (ids[i] <= ids[i - 1]) { ordered = false; break; }
  ck('...and ordered, which is the reason for v7 over v4', ordered);
  ck('the timestamp decodes back to now', Math.abs(Date.now() - uuidv7Time(ids[0])) < 5000);
}

// ── identity across the schema ──────────────────────────────────────────────
console.log('\n── record_uid ──');
const db = makeDb();
{
  const real = new Set(db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name));

  // Every real table is either synced or excluded WITH A REASON. A table that
  // is on neither list is a table nobody decided about, which is how a record
  // silently fails to sync.
  const unaccounted = [...real].filter(t => !SYNCED.includes(t) && !NOT_SYNCED[t]);
  ck('every table in the schema is classified as synced or excluded',
    unaccounted.length === 0, unaccounted.join(', '));

  const noCol = [], noIdx = [], noTrg = [];
  for (const t of SYNCED) {
    if (!real.has(t)) continue;
    if (!db.prepare(`SELECT COUNT(*) c FROM pragma_table_info('${t}') WHERE name='record_uid'`).get().c) noCol.push(t);
    if (!db.prepare(`SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND name='idx_${t}_record_uid'`).get().c) noIdx.push(t);
    const n = db.prepare(
      "SELECT COUNT(*) c FROM sqlite_master WHERE type='trigger' AND tbl_name=? AND name LIKE 'trg_%_sync_%'").get(t).c;
    if (n !== 3) noTrg.push(`${t}=${n}`);
  }
  ck(`all ${SYNCED.length} synced tables carry record_uid`, noCol.length === 0, noCol.join(', '));
  ck('...each with a unique index, so two rows cannot share an identity',
    noIdx.length === 0, noIdx.join(', '));
  ck('...and three journalling triggers each', noTrg.length === 0, noTrg.join(', '));

  // The credential tables must NOT travel.
  ck('api_tokens is deliberately excluded — a device credential means nothing elsewhere',
    !SYNCED.includes('api_tokens') && !!NOT_SYNCED.api_tokens);
  ck('...and every exclusion carries a stated reason',
    Object.values(NOT_SYNCED).every(r => typeof r === 'string' && r.length > 20));

  // Rows that existed before the migration.
  const seeded = db.prepare('SELECT COUNT(*) c FROM designations WHERE record_uid IS NULL').get().c;
  ck('rows that existed before the migration were backfilled', seeded === 0);
  const uids = db.prepare('SELECT record_uid FROM designations').all().map(r => r.record_uid);
  ck('...each with a DISTINCT id, not one id for the whole table',
    new Set(uids).size === uids.length, `${new Set(uids).size}/${uids.length}`);
  ck('...and each a well-formed uuid', uids.every(isUuid));
}

// ── the migration can be run again ──────────────────────────────────────────
console.log('\n── idempotent and resumable ──');
{
  const before = db.prepare('SELECT record_uid FROM designations ORDER BY id').all().map(r => r.record_uid);
  const rep = applySyncSchema(db);
  const after = db.prepare('SELECT record_uid FROM designations ORDER BY id').all().map(r => r.record_uid);
  ck('running the migration twice reports no errors', rep.errors.length === 0, rep.errors.join('; '));
  ck('...adds no columns the second time', rep.columns === 0);
  ck('...and does NOT reissue identities, which would orphan every reference',
    JSON.stringify(before) === JSON.stringify(after));
}

// ── capture: one write, one entry ───────────────────────────────────────────
console.log('\n── the journal records every write path ──');
{
  syncContext.stamp(db, { userId: 7, source: 'ipc' });
  const deviceId = syncContext.deviceId(db);
  ck('this installation has an identity of its own', isUuid(deviceId), deviceId);

  db.exec('DELETE FROM sync_journal');
  db.prepare(`INSERT INTO students (index_number, surname, first_name, status)
              VALUES ('X/1', 'ANSU', 'Mona', 'Active')`).run();
  let rows = db.prepare('SELECT * FROM sync_journal').all();
  ck('one INSERT produces exactly one entry — not two', rows.length === 1, `${rows.length} entries`);
  ck('...recorded as an insert', rows[0] && rows[0].op === 'insert');
  ck('...carrying the row itself', /ANSU/.test(rows[0].after_json));
  ck('...attributed to the acting user', rows[0].user_id === 7);
  ck('...and to this machine', rows[0].device_id === deviceId);
  ck('...with its own entry id, so a replayed batch is recognisable',
    isUuid(rows[0].entry_uid));
  const recordUid = rows[0].record_uid;
  ck('...naming the row by the id the other machines will know it by',
    recordUid === db.prepare("SELECT record_uid FROM students WHERE index_number='X/1'").get().record_uid);

  db.exec('DELETE FROM sync_journal');
  db.prepare("UPDATE students SET first_name='Monalisa' WHERE index_number='X/1'").run();
  rows = db.prepare('SELECT * FROM sync_journal').all();
  ck('one UPDATE produces exactly one entry', rows.length === 1, `${rows.length} entries`);
  ck('...with the value before it changed', /"first_name":"Mona"/.test(rows[0].before_json));
  ck('...and the value after', /Monalisa/.test(rows[0].after_json));

  db.exec('DELETE FROM sync_journal');
  db.prepare("DELETE FROM students WHERE index_number='X/1'").run();
  rows = db.prepare('SELECT * FROM sync_journal').all();
  ck('a DELETE is journalled as a tombstone', rows.length === 1 && rows[0].op === 'delete');
  ck('...keeping the record, so it can be explained or undone',
    /ANSU/.test(rows[0].before_json));
  ck('...under the same identity the insert used', rows[0].record_uid === recordUid);

  // A write by nobody in particular — a migration, the licence refresh, the
  // sync itself — is recorded honestly rather than attributed to a person.
  syncContext.clear(db);
  db.exec('DELETE FROM sync_journal');
  db.prepare(`INSERT INTO students (index_number, surname, first_name, status)
              VALUES ('X/2', 'SYSTEM', 'Row', 'Active')`).run();
  rows = db.prepare('SELECT * FROM sync_journal').all();
  ck('a write with nobody signed in names no user rather than the last one',
    rows.length === 1 && rows[0].user_id === null);
}

// ── fidelity under a transaction, and under bulk ────────────────────────────
console.log('\n── transactions and bulk writes ──');
{
  syncContext.stamp(db, { userId: 3, source: 'lan' });
  db.exec('DELETE FROM sync_journal');
  const tx = db.transaction(() => {
    for (let i = 0; i < 25; i++) {
      db.prepare(`INSERT INTO students (index_number, surname, first_name, status)
                  VALUES (?, 'BULK', 'P', 'Active')`).run(`B/${i}`);
    }
  });
  tx();
  const n = db.prepare('SELECT COUNT(*) c FROM sync_journal').get().c;
  ck('twenty-five rows in one transaction produce twenty-five entries', n === 25, `${n}`);
  const distinct = db.prepare('SELECT COUNT(DISTINCT record_uid) c FROM sync_journal').get().c;
  ck('...each naming a different row', distinct === 25, `${distinct}`);

  // A rolled-back transaction must leave no journal behind: an entry for a row
  // that does not exist would be replayed into a row that should never exist.
  db.exec('DELETE FROM sync_journal');
  try {
    const bad = db.transaction(() => {
      db.prepare(`INSERT INTO students (index_number, surname, first_name, status)
                  VALUES ('R/1','ROLL','Back','Active')`).run();
      throw new Error('deliberate');
    });
    bad();
  } catch (_) { /* expected */ }
  ck('a rolled-back write leaves no entry behind',
    db.prepare('SELECT COUNT(*) c FROM sync_journal').get().c === 0);
  ck('...and no row', !db.prepare("SELECT 1 FROM students WHERE index_number='R/1'").get());
}

// ── bulk import can switch journalling off ──────────────────────────────────
console.log('\n── a bulk import is not a morning of work ──');
{
  const dropped = dropSyncTriggers(db);
  ck('the triggers can be removed for a restore or a bulk import', dropped > 0, `${dropped} dropped`);
  db.exec('DELETE FROM sync_journal');
  db.prepare(`INSERT INTO students (index_number, surname, first_name, status)
              VALUES ('I/1','IMPORT','Row','Active')`).run();
  ck('...and then a write is not journalled',
    db.prepare('SELECT COUNT(*) c FROM sync_journal').get().c === 0);
  applySyncSchema(db);
  db.prepare(`INSERT INTO students (index_number, surname, first_name, status)
              VALUES ('I/2','IMPORT','Two','Active')`).run();
  ck('...and journalling comes back when they are reinstated',
    db.prepare('SELECT COUNT(*) c FROM sync_journal').get().c === 1);
  ck('...and the imported row still got an identity',
    isUuid(db.prepare("SELECT record_uid FROM students WHERE index_number='I/1'").get().record_uid));
}

// ── the journal API ─────────────────────────────────────────────────────────
console.log('\n── pending, acknowledge, prune ──');
{
  db.exec('DELETE FROM sync_journal');
  syncContext.stamp(db, { userId: 1, source: 'ipc' });
  for (let i = 0; i < 10; i++) {
    db.prepare(`INSERT INTO students (index_number, surname, first_name, status)
                VALUES (?, 'P', 'Q', 'Active')`).run(`J/${i}`);
  }
  let out = journal.pending(db, 100);
  ck('everything written is pending', out.length === 10, `${out.length}`);
  ck('...oldest first, because a payment cannot apply before its pupil exists',
    out.every((r, i) => i === 0 || r.seq > out[i - 1].seq));

  // Acknowledge SOME. The partial case is the normal one on a bad connection.
  const taken = out.slice(0, 4).map(r => r.entry_uid);
  ck('four are acknowledged', journal.markPushed(db, taken) === 4);
  ck('...and six remain pending — not "everything up to here"',
    journal.pendingCount(db) === 6, `${journal.pendingCount(db)}`);
  ck('re-acknowledging the same four changes nothing',
    journal.markPushed(db, taken) === 0);

  // Pruning requires BOTH acknowledgement and age.
  ck('pruning removes nothing yet, because nothing is old enough',
    journal.prune(db, 90) === 0);
  db.prepare("UPDATE sync_journal SET happened_at = datetime('now','-200 days') WHERE pushed_at IS NOT NULL").run();
  ck('...and removes the acknowledged ones once they have aged',
    journal.prune(db, 90) === 4);
  ck('...while leaving every unacknowledged entry alone',
    journal.pendingCount(db) === 6);
  db.prepare("UPDATE sync_journal SET happened_at = datetime('now','-500 days')").run();
  ck('an UNacknowledged entry is never pruned, however old — that would be data loss',
    journal.prune(db, 90) === 0 && journal.pendingCount(db) === 6);
}

// ── idempotency for money ───────────────────────────────────────────────────
console.log('\n── money is replay-safe ──');
{
  const a = journal.idempotencyKey({ deviceId: 'dev-A', table: 'payments', recordUid: 'r1', op: 'insert', amount: 50 });
  const b = journal.idempotencyKey({ deviceId: 'dev-A', table: 'payments', recordUid: 'r1', op: 'insert', amount: 50 });
  ck('the same act computes the same key — which is what makes a replay a no-op', a === b);
  const c = journal.idempotencyKey({ deviceId: 'dev-B', table: 'payments', recordUid: 'r1', op: 'insert', amount: 50 });
  ck('...a different machine computes a different key', a !== c);
  const d = journal.idempotencyKey({ deviceId: 'dev-A', table: 'payments', recordUid: 'r1', op: 'insert', amount: 60 });
  ck('...and a different amount computes a different key', a !== d);

  ck('payments is treated as financial', isFinancial('payments'));
  ck('...and so are receipts and the ledger', isFinancial('receipts') && isFinancial('income_records'));
  ck('...while a lesson note is not', !isFinancial('lesson_notes'));

  db.exec('DELETE FROM sync_journal');
  const term = db.prepare('SELECT id FROM terms WHERE is_current = 1').get()
    || db.prepare('SELECT id FROM terms LIMIT 1').get();
  const stu = db.prepare(`INSERT INTO students (index_number, surname, first_name, status)
                          VALUES ('PAY/1','PAYER','One','Active') RETURNING id`).get();
  db.prepare(`INSERT INTO payments (student_id, term_id, amount, payment_date, receipt_number)
              VALUES (?, ?, 250, '2026-02-02', 'R-001')`).run(stu.id, term.id);
  const stamped = journal.stampFinancialKeys(db);
  ck('a payment entry is given an idempotency key', stamped >= 1, `${stamped} stamped`);
  const pay = db.prepare("SELECT idempotency_key FROM sync_journal WHERE table_name='payments'").get();
  ck('...a real one', !!(pay && pay.idempotency_key && pay.idempotency_key.length === 40));
  const note = db.prepare("SELECT idempotency_key FROM sync_journal WHERE table_name='students'").get();
  ck('...and a non-financial entry is not given one', !note || note.idempotency_key === null);

  // The unique index is the enforcement, not the convention.
  let refused = false;
  try {
    db.prepare(`INSERT INTO sync_journal (entry_uid, record_uid, table_name, op, idempotency_key)
                VALUES (?, 'rX', 'payments', 'insert', ?)`).run(uuidv7(), pay.idempotency_key);
  } catch (_) { refused = true; }
  ck('the database itself refuses a second entry with the same key', refused);
}

// ── leases: two machines cannot mint the same receipt number ────────────────
console.log('\n── receipt numbers cannot collide ──');
{
  ck('a machine with no lease is reported as holding none', leases.status(db).receipt.held === false);

  // This is the collision the lease exists to prevent, stated as a test: two
  // machines, each offline, each issuing from its own block.
  const officePc = makeDb();
  const bursar = makeDb();
  leases.grant(officePc, 'receipt', { from: 4001, to: 4005, deviceId: 'office' });
  leases.grant(bursar, 'receipt', { from: 4006, to: 4010, deviceId: 'bursar' });
  const issuedA = [], issuedB = [];
  for (let i = 0; i < 5; i++) issuedA.push(leases.take(officePc, 'receipt').value);
  for (let i = 0; i < 5; i++) issuedB.push(leases.take(bursar, 'receipt').value);
  ck('the office PC issues its own block', JSON.stringify(issuedA) === JSON.stringify([4001, 4002, 4003, 4004, 4005]));
  ck('the bursar issues theirs', JSON.stringify(issuedB) === JSON.stringify([4006, 4007, 4008, 4009, 4010]));
  ck('...and the two sets never overlap',
    issuedA.filter(v => issuedB.includes(v)).length === 0);

  // Exhaustion must not refuse a payment.
  const over = leases.take(officePc, 'receipt');
  ck('an exhausted block still issues a number — a school must be able to take money',
    over.ok === true);
  ck('...visibly different, so somebody knows to reconnect',
    over.suffixed === true && /-/.test(String(over.value)), String(over.value));
  ck('...and the sync screen reports it as exhausted',
    leases.status(officePc).receipt.exhausted === true);

  // A granted block replaces the old one rather than accumulating.
  leases.grant(officePc, 'receipt', { from: 9000, to: 9100, deviceId: 'office' });
  ck('a fresh block replaces the exhausted one', leases.take(officePc, 'receipt').value === 9000);
  ck('...and a nonsense block is refused',
    leases.grant(officePc, 'receipt', { from: 50, to: 10 }).ok === false);

  // The existing counter still works for a school that has no lease, which is
  // every installation until the cloud grants one.
  const idgen = require(path.join(ROOT, 'electron/utils/idgen.js'));
  const plain = makeDb();
  const first = idgen.getNextReceiptNumber(plain);
  const second = idgen.getNextReceiptNumber(plain);
  ck('a school with no lease still gets sequential numbers, exactly as today',
    second === first + 1, `${first} then ${second}`);
  leases.grant(plain, 'receipt', { from: 7000, to: 7100 });
  ck('...and once a block is granted, numbers come from it',
    idgen.getNextReceiptNumber(plain) === 7000);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
