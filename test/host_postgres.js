// Nickland Edusoft — the school's handlers, against Postgres.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   DATABASE_URL=postgresql://… DATABASE_SCHEMA=school node test/host_postgres.js
//
// The web host runs the installed application's own handlers — 1,631
// synchronous database calls that were written for a local SQLite file — over
// a network database. This is what stands between that working and it being
// wrong in ways nobody notices.
//
// It skips without DATABASE_URL, as the other online tests do. Point it at a
// throwaway database: it creates and deletes rows.
//
// Provision one first:
//   DATABASE_URL=… DATABASE_SCHEMA=school node host/provision.js

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const ck = (n, c, extra) => {
  c ? pass++ : fail++;
  console.log((c ? '✓ ' : '✗ ') + n + (extra !== undefined ? '  ' + extra : ''));
};

if (!process.env.DATABASE_URL) {
  console.log('DATABASE_URL is not set — skipping the Postgres adapter.');
  console.log('  Provision a throwaway database, then:');
  console.log('  DATABASE_URL=… DATABASE_SCHEMA=school node test/host_postgres.js');
  process.exit(0);
}

const { openNeonDatabase } = require(path.join(ROOT, 'host/db/neon'));

const db = openNeonDatabase(process.env.DATABASE_URL, {
  schema: process.env.DATABASE_SCHEMA || null,
  cacheTtlMs: 5000,
});

function cleanup() {
  try { db.prepare("DELETE FROM students WHERE index_number LIKE 'PGT/%'").run(); } catch (_) {}
  try { db.prepare("DELETE FROM settings WHERE key = 'pgtest_marker'").run(); } catch (_) {}
}

try {
  cleanup();

  // == The five methods the handlers use ==
  const row = db.prepare('SELECT id, name FROM designations WHERE name = ?').get('Super Admin');
  ck('.get() answers one row', !!row && row.name === 'Super Admin');
  ck('...with the id as a NUMBER, not a string', typeof row.id === 'number', `id ${JSON.stringify(row.id)}`);

  ck('.get() with no match answers undefined, as better-sqlite3 does',
    db.prepare('SELECT id FROM designations WHERE name = ?').get('Nobody At All') === undefined);

  const classes = db.prepare('SELECT id, name FROM class_groups WHERE is_active = 1 ORDER BY level_order').all();
  ck('.all() answers an array', Array.isArray(classes) && classes.length > 0, `${classes.length} classes`);

  const ins = db.prepare(
    `INSERT INTO students (index_number, surname, first_name, current_class_id, status, admission_date)
     VALUES (?, ?, ?, ?, 'Active', ?)`
  ).run('PGT/001', 'TESTER', 'One', classes[0].id, '2026-01-10');
  ck('.run() on an INSERT reports one change', ins.changes === 1);
  ck('...and lastInsertRowid, as a number', typeof ins.lastInsertRowid === 'number', ins.lastInsertRowid);

  ck('.run() on an UPDATE reports what it changed',
    db.prepare('UPDATE students SET first_name = ? WHERE id = ?').run('Two', ins.lastInsertRowid).changes === 1);

  // == A COUNT is a number, which a screen then does arithmetic on ==
  const counted = db.prepare("SELECT COUNT(*) AS c FROM students WHERE index_number LIKE 'PGT/%'").get();
  ck('COUNT(*) answers a number, not a string', typeof counted.c === 'number', `c = ${JSON.stringify(counted.c)}`);

  // == Transactions ==
  const both = db.transaction(() => {
    db.prepare(`INSERT INTO students (index_number, surname, first_name, status, admission_date)
                VALUES ('PGT/002', 'TESTER', 'Three', 'Active', '2026-01-10')`).run();
    db.prepare(`INSERT INTO students (index_number, surname, first_name, status, admission_date)
                VALUES ('PGT/003', 'TESTER', 'Four', 'Active', '2026-01-10')`).run();
  });
  both();
  ck('a transaction commits everything in it',
    db.prepare("SELECT COUNT(*) AS c FROM students WHERE index_number LIKE 'PGT/00%'").get().c === 3);

  let rolledBack = false;
  try {
    db.transaction(() => {
      db.prepare(`INSERT INTO students (index_number, surname, first_name, status, admission_date)
                  VALUES ('PGT/999', 'ROLLED', 'Back', 'Active', '2026-01-10')`).run();
      throw new Error('changed our mind');
    })();
  } catch (e) { rolledBack = e.message === 'changed our mind'; }
  ck('a failed transaction leaves nothing behind',
    rolledBack && db.prepare("SELECT COUNT(*) AS c FROM students WHERE index_number = 'PGT/999'").get().c === 0);

  // A read inside a transaction must see that transaction's own writes, or a
  // handler that inserts then reads back — which several do — sees nothing.
  const seesItsOwnWrite = db.transaction(() => {
    db.prepare(`INSERT INTO students (index_number, surname, first_name, status, admission_date)
                VALUES ('PGT/004', 'INSIDE', 'Five', 'Active', '2026-01-10')`).run();
    return db.prepare("SELECT COUNT(*) AS c FROM students WHERE index_number = 'PGT/004'").get().c;
  })();
  ck('a read inside a transaction sees that transaction\'s own writes', seesItsOwnWrite === 1);

  // == The cache, which is the whole Neon-efficiency story ==
  db._resetQueryCount();
  const first = db.prepare('SELECT id, name FROM class_groups ORDER BY level_order').all();
  const after = db._queryCount();
  const second = db.prepare('SELECT id, name FROM class_groups ORDER BY level_order').all();
  ck('the same read twice reaches the database once',
    db._queryCount() === after, `${db._queryCount()} queries for two identical reads`);
  ck('...and answers the same thing', JSON.stringify(first) === JSON.stringify(second));

  // The one that matters: a write must be visible immediately, or a
  // permission changed in the office would not take effect on the next
  // request — which is a promise this application makes.
  db.prepare("INSERT INTO settings (key, value, category) VALUES ('pgtest_marker', 'before', 'test')").run();
  const before = db.prepare("SELECT value FROM settings WHERE key = 'pgtest_marker'").get();
  db.prepare("UPDATE settings SET value = 'after' WHERE key = 'pgtest_marker'").run();
  const afterWrite = db.prepare("SELECT value FROM settings WHERE key = 'pgtest_marker'").get();
  ck('a write is visible to the very next read, cache or no cache',
    before.value === 'before' && afterWrite.value === 'after',
    `${before.value} → ${afterWrite.value}`);

  // A cached row handed to two callers must not be the same object, or one
  // screen sorting a list would reorder another screen's copy of it.
  const a = db.prepare('SELECT id, name FROM class_groups ORDER BY level_order').all();
  const b = db.prepare('SELECT id, name FROM class_groups ORDER BY level_order').all();
  a[0].name = 'MUTATED';
  ck('what the cache hands back cannot be edited by whoever got it',
    b[0].name !== 'MUTATED', b[0].name);

  // Numbers a school allocates by reading the last one must never be cached:
  // a remembered answer issues the same receipt number twice.
  ck('a MAX() read is never served from memory',
    db._cache.cacheable('SELECT MAX(id) FROM receipts') === false);

  // == Errors ==
  let missing = null;
  try { db.prepare('SELECT * FROM no_such_table').all(); } catch (e) { missing = e.message; }
  ck('a bad statement throws rather than answering something odd', /does not exist/i.test(missing || ''));

  let duplicate = null;
  try {
    db.prepare(`INSERT INTO students (index_number, surname, first_name, status, admission_date)
                VALUES ('PGT/001', 'DUPE', 'Six', 'Active', '2026-01-10')`).run();
  } catch (e) { duplicate = e.code; }
  ck('a constraint violation reaches the handler with its SQLSTATE', duplicate === '23505', duplicate);

  // == Deleting ==
  const removed = db.prepare("DELETE FROM students WHERE index_number LIKE 'PGT/%'").run();
  ck('.run() on a DELETE reports how many went', removed.changes >= 4, `${removed.changes} removed`);

  cleanup();
} finally {
  db.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
