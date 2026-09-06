// Nickland Edusoft — the school's SQL, said in Postgres.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/host_dialect.js
//
// Pure translation, no database needed. Every case here is a statement that
// actually appears in the handlers — taken from the audit, not invented — plus
// the ones that must be left alone, which is where a translator does its real
// damage. Rewriting inside a quoted string would corrupt a pupil's name or a
// note, silently, in a way no test of the happy path would ever show.

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const dialect = require(path.join(ROOT, 'host/db/dialect'));

let pass = 0, fail = 0;
const ck = (n, c, got) => {
  c ? pass++ : fail++;
  console.log((c ? '✓ ' : '✗ ') + n + (c ? '' : '\n     got: ' + got));
};

// Every table has an id except the handful keyed by something else. `settings`
// is keyed by `key`, and appending RETURNING id to a write against it failed
// the write outright — which is how the spike found this.
const hasId = (table) => table !== 'settings';
const t = (sql) => dialect.translate(sql, hasId);

// == Placeholders ==
ck('? becomes $1, $2 in order',
  t('SELECT * FROM students WHERE class_id = ? AND status = ?')
    === 'SELECT * FROM students WHERE class_id = $1 AND status = $2',
  t('SELECT * FROM students WHERE class_id = ? AND status = ?'));

// == What must NOT be touched ==
ck('a question mark inside a string is left alone',
  t("SELECT * FROM notes WHERE body = 'why?' AND id = ?")
    === "SELECT * FROM notes WHERE body = 'why?' AND id = $1",
  t("SELECT * FROM notes WHERE body = 'why?' AND id = ?"));

ck("a doubled quote inside a name is left alone",
  t("SELECT * FROM students WHERE surname = 'O''Brien' AND id = ?")
    === "SELECT * FROM students WHERE surname = 'O''Brien' AND id = $1",
  t("SELECT * FROM students WHERE surname = 'O''Brien' AND id = ?"));

ck("a date function inside a string is not translated",
  t("SELECT * FROM audit_log WHERE note = 'ran datetime(''now'')'")
    === "SELECT * FROM audit_log WHERE note = 'ran datetime(''now'')'",
  t("SELECT * FROM audit_log WHERE note = 'ran datetime(''now'')'"));

ck('the 491 boolean comparisons need no translation at all',
  t('SELECT * FROM users WHERE is_active = 1') === 'SELECT * FROM users WHERE is_active = 1',
  t('SELECT * FROM users WHERE is_active = 1'));

// == lastInsertRowid, which 114 places read ==
ck('an INSERT is asked to hand the id back',
  /RETURNING id$/.test(t("INSERT INTO students (surname) VALUES (?)")),
  t("INSERT INTO students (surname) VALUES (?)"));

ck('...but not for a table that has no id',
  !/RETURNING/.test(t("INSERT INTO settings (key, value) VALUES (?, ?)")),
  t("INSERT INTO settings (key, value) VALUES (?, ?)"));

ck('...and not twice, if the statement already asks',
  (t("INSERT INTO students (surname) VALUES (?) RETURNING id").match(/RETURNING/g) || []).length === 1,
  t("INSERT INTO students (surname) VALUES (?) RETURNING id"));

ck('a SELECT is never given RETURNING',
  !/RETURNING/.test(t('SELECT * FROM students')), t('SELECT * FROM students'));

// == Dates and times, as the handlers actually write them ==
ck("datetime('now')", t("UPDATE users SET last_login = datetime('now') WHERE id = ?")
  === 'UPDATE users SET last_login = NOW() WHERE id = $1',
  t("UPDATE users SET last_login = datetime('now') WHERE id = ?"));

ck("datetime('now', '-90 days')",
  /INTERVAL '-90 day'/.test(t("DELETE FROM api_tokens WHERE created_at < datetime('now', '-90 days')")),
  t("DELETE FROM api_tokens WHERE created_at < datetime('now', '-90 days')"));

ck("date('now')", t("SELECT date('now') AS d") === 'SELECT CURRENT_DATE AS d',
  t("SELECT date('now') AS d"));

ck('julianday difference becomes days between two dates',
  /EXTRACT\(EPOCH FROM/.test(t("SELECT (julianday('now') - julianday(s.date_of_birth)) / 365.25 AS age FROM students s")),
  t("SELECT (julianday('now') - julianday(s.date_of_birth)) / 365.25 AS age FROM students s"));

ck("strftime('%Y-%m', …) becomes to_char",
  /to_char\(.*'YYYY-MM'\)/.test(t("SELECT strftime('%Y-%m', payment_date) AS m FROM payments")),
  t("SELECT strftime('%Y-%m', payment_date) AS m FROM payments"));

ck('IFNULL becomes COALESCE',
  /COALESCE\(/.test(t('SELECT IFNULL(amount, 0) FROM bills')),
  t('SELECT IFNULL(amount, 0) FROM bills'));

// == Upserts ==
ck('INSERT OR IGNORE becomes ON CONFLICT DO NOTHING',
  /ON CONFLICT DO NOTHING/.test(t('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')),
  t('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'));

// == Translation is stable ==
// The adapter caches by statement, so translating twice must give the same
// answer — a translator that numbered placeholders from a running counter
// would not, and the second call would silently ask for the wrong parameters.
const twice = 'SELECT * FROM students WHERE a = ? AND b = ?';
ck('translating the same statement twice gives the same result',
  t(twice) === t(twice), t(twice));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
