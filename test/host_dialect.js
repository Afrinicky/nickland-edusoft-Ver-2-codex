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
// NOT NOW(). `users.last_login` is TEXT, like every date column the offline
// schema has, and Postgres will not put a timestamp in a text column — so this
// statement, which is how a sign-in is recorded, failed against Postgres for
// as long as it said NOW(). See the block near the end of this file.
ck("datetime('now')", t("UPDATE users SET last_login = datetime('now') WHERE id = ?")
  === "UPDATE users SET last_login = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1",
  t("UPDATE users SET last_login = datetime('now') WHERE id = ?"));

ck("datetime('now', '-90 days')",
  /INTERVAL '-90 day'/.test(t("DELETE FROM api_tokens WHERE created_at < datetime('now', '-90 days')")),
  t("DELETE FROM api_tokens WHERE created_at < datetime('now', '-90 days')"));

ck("date('now')", t("SELECT date('now') AS d")
  === "SELECT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d",
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


// == Dates are TEXT, because every column they touch is ==
//
// These went in as NOW() and CURRENT_DATE, which are a timestamp and a date.
// The school's columns are TEXT — the generated schema has no timestamp column
// anywhere — so Postgres refused to write one and refused to compare one, and
// both failures were silent: a token's last-used time inside a try/catch, a
// "due before now" list that simply came back empty.
ck("datetime('now') is written as the text SQLite writes",
  t("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?")
    === "UPDATE api_tokens SET last_used_at = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1",
  t("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?"));

ck("date('now') likewise, to the day",
  /to_char\(NOW\(\) AT TIME ZONE 'UTC', 'YYYY-MM-DD'\)/.test(t("SELECT * FROM t WHERE d = date('now')")),
  t("SELECT * FROM t WHERE d = date('now')"));

ck("a modifier is kept: datetime('now', '-90 days')",
  /INTERVAL '-90 day'/.test(t("SELECT * FROM t WHERE at > datetime('now', '-90 days')")),
  t("SELECT * FROM t WHERE at > datetime('now', '-90 days')"));

ck("a modifier passed as a PARAMETER becomes an interval",
  t("SELECT * FROM attendance WHERE student_id = ? AND date >= date('now', ?)")
    === "SELECT * FROM attendance WHERE student_id = $1 AND date >= to_char((NOW() AT TIME ZONE 'UTC') + ($2)::interval, 'YYYY-MM-DD')",
  t("SELECT * FROM attendance WHERE student_id = ? AND date >= date('now', ?)"));

// == ROUND ==
//
// Postgres has round(numeric, int) and round(double precision) and NOT
// round(double precision, int) — so rounding an average, which is the only
// way anybody rounds anything here, failed outright.
ck('ROUND(x, n) casts to numeric',
  t('SELECT ROUND(AVG(score), 2) AS avg FROM exam_scores')
    === 'SELECT ROUND((AVG(score))::numeric, 2) AS avg FROM exam_scores',
  t('SELECT ROUND(AVG(score), 2) AS avg FROM exam_scores'));

ck('...and does not rewrite its own output for ever',
  (t('SELECT ROUND(AVG(a), 1) FROM t').match(/::numeric/g) || []).length === 1,
  t('SELECT ROUND(AVG(a), 1) FROM t'));

ck('one-argument ROUND is the same in both and is left alone',
  t('SELECT ROUND(x) FROM t') === 'SELECT ROUND(x) FROM t');

ck('two ROUNDs in one statement are both translated',
  (t('SELECT ROUND(AVG(a),1), ROUND(SUM(b),2) FROM t').match(/::numeric/g) || []).length === 2,
  t('SELECT ROUND(AVG(a),1), ROUND(SUM(b),2) FROM t'));

// == date(a column) ==
ck('date(column) becomes a cast, because Postgres has no date(text)',
  t('SELECT source_file, date(imported_at) FROM workbook_import_log')
    === 'SELECT source_file, ((imported_at)::date) FROM workbook_import_log',
  t('SELECT source_file, date(imported_at) FROM workbook_import_log'));


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
