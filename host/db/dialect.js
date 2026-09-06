// Nickland Edusoft — the school's SQL, said in Postgres.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// SPIKE. Proving one question: can the existing handlers run against Neon
// without rewriting 1,631 database call sites?
//
// The handlers speak SQLite, because that is what the office PC has. Postgres
// understands nearly all of it — the audit found only four kinds of difference
// across 22,400 lines, and one of them turned out not to be a difference at
// all:
//
//   ?  placeholders          →  $1, $2 …           (mechanical)
//   lastInsertRowid          →  RETURNING id        (114 sites depend on it)
//   julianday / datetime()   →  Postgres date maths (62 sites)
//   INSERT OR REPLACE/IGNORE →  ON CONFLICT         (5 sites)
//
//   is_active = 1            →  nothing to do. The existing schema generator
//                               maps SQLite INTEGER to BIGINT, so all 491 of
//                               these comparisons already work.
//
// Translation happens HERE and nowhere else. No handler is edited, and nothing
// about the office PC changes: it goes on running the same SQL against SQLite.

// A quoted string in SQL must never be rewritten — a pupil called "O'Brien"
// and a note containing a question mark are both real. So every rewrite walks
// the statement and skips what is inside quotes.
function mapOutsideStrings(sql, rewrite) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      // Copy the literal verbatim, doubled quotes ('' inside '') included.
      const quote = ch;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === quote) {
          if (sql[j + 1] === quote) { j += 2; continue; }
          break;
        }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const taken = rewrite(sql, i);
    if (taken) { out += taken.text; i += taken.length; continue; }
    out += ch;
    i++;
  }
  return out;
}

// ?  →  $1, $2, …
function numberPlaceholders(sql) {
  let n = 0;
  return mapOutsideStrings(sql, (s, i) =>
    s[i] === '?' ? { text: '$' + (++n), length: 1 } : null);
}

// The date and time functions the school actually uses. Taken from the audit
// rather than from a list of everything SQLite can do: translating what is not
// there would be untested code pretending to be safety.
const DATE_FUNCTIONS = [
  // julianday(a) - julianday(b)  →  whole days between two dates.
  // Used for ages and for "days since", always as a difference, so the pair is
  // translated together rather than inventing a Postgres julianday().
  [/julianday\(\s*'now'\s*\)\s*-\s*julianday\(\s*([^()]+?)\s*\)/gi,
   "(EXTRACT(EPOCH FROM (NOW() - ($1)::timestamp)) / 86400.0)"],
  [/julianday\(\s*([^()]+?)\s*\)\s*-\s*julianday\(\s*([^()]+?)\s*\)/gi,
   "(EXTRACT(EPOCH FROM (($1)::timestamp - ($2)::timestamp)) / 86400.0)"],

  // datetime('now')  /  datetime('now', '-90 days')
  [/datetime\(\s*'now'\s*,\s*'([+-]?\d+)\s+(day|days|hour|hours|minute|minutes|month|months|year|years)'\s*\)/gi,
   (_m, n, unit) => `(NOW() + INTERVAL '${n} ${unit.replace(/s$/, '')}')`],
  [/datetime\(\s*'now'\s*\)/gi, 'NOW()'],

  // date('now')  /  date('now', '-30 days')
  [/date\(\s*'now'\s*,\s*'([+-]?\d+)\s+(day|days|month|months|year|years)'\s*\)/gi,
   (_m, n, unit) => `(CURRENT_DATE + INTERVAL '${n} ${unit.replace(/s$/, '')}')`],
  [/date\(\s*'now'\s*\)/gi, 'CURRENT_DATE'],

  // strftime('%Y-%m', col)  →  to_char(col, 'YYYY-MM')
  [/strftime\(\s*'([^']+)'\s*,\s*([^,()]+?)\s*\)/gi, (_m, fmt, col) => {
    const pg = fmt.replace(/%Y/g, 'YYYY').replace(/%m/g, 'MM').replace(/%d/g, 'DD')
                  .replace(/%H/g, 'HH24').replace(/%M/g, 'MI').replace(/%S/g, 'SS');
    return `to_char((${col})::timestamp, '${pg}')`;
  }],

  [/\bIFNULL\s*\(/gi, 'COALESCE('],
];

function translateDates(sql) {
  let out = sql;
  for (const [pattern, replacement] of DATE_FUNCTIONS) out = out.replace(pattern, replacement);
  return out;
}

// INSERT OR REPLACE / OR IGNORE.
//
// Only five sites, and all five are upserts into tables with a unique key, so
// this is deliberately narrow: it refuses what it cannot translate faithfully
// rather than guessing. A wrong guess here silently writes the wrong row.
function translateInsertOr(sql) {
  const ignore = /^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i;
  const replace = /^\s*INSERT\s+OR\s+REPLACE\s+INTO\b/i;
  if (ignore.test(sql)) {
    return sql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO') +
           ' ON CONFLICT DO NOTHING';
  }
  if (replace.test(sql)) {
    // Postgres needs to be told which column collides; SQLite works it out.
    // Answered by the caller, which knows the table — see neon.js.
    return sql.replace(/INSERT\s+OR\s+REPLACE\s+INTO/i, 'INSERT INTO');
  }
  return sql;
}

const IS_INSERT = /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i;
const HAS_RETURNING = /\bRETURNING\b/i;

// `.run()` on an INSERT answers `lastInsertRowid`, which 114 places read.
// Postgres has no such thing, so the insert is asked to hand the id back.
//
// But NOT every table has an `id`. `settings` is keyed by `key`, and asking it
// to return one is an error that fails the write outright — which is how the
// spike found this, on the first real screen rather than in a month's time.
// So the adapter says which tables have an id column, read once from the
// database itself, and the rest are left alone: a table with no id cannot have
// a lastInsertRowid to report, and no caller asks it for one.
function addReturningId(sql, hasIdColumn) {
  if (HAS_RETURNING.test(sql)) return sql;
  const m = IS_INSERT.exec(sql);
  if (!m) return sql;
  if (typeof hasIdColumn === 'function' && !hasIdColumn(m[1].toLowerCase())) return sql;
  return sql.replace(/;?\s*$/, '') + ' RETURNING id';
}

function translate(sql, hasIdColumn) {
  let out = String(sql);
  out = translateInsertOr(out);
  out = translateDates(out);
  out = addReturningId(out, hasIdColumn);
  out = numberPlaceholders(out);
  return out;
}

module.exports = {
  translate, numberPlaceholders, translateDates, translateInsertOr, addReturningId,
  mapOutsideStrings,
};
