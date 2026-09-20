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

  // datetime('now')  /  date('now')  — and the same with a modifier.
  //
  // TEXT, in the shape SQLite writes, and that is the whole point.
  //
  // These used to become NOW() and CURRENT_DATE, which are a timestamp and a
  // date. Every column they are written to is TEXT — the offline schema has no
  // timestamp columns, and the generator renders its defaults as
  // to_char(now(), 'YYYY-MM-DD HH24:MI:SS') for exactly that reason — and
  // Postgres will not put a timestamp in a text column or compare one against
  // it. So `UPDATE api_tokens SET last_used_at = datetime('now')` failed, and
  // so did every "due before now" read. Both are silent: one is inside a
  // try/catch, the other answers an empty list.
  //
  // UTC, like the desktop, so a school's record does not shift by an hour
  // depending on which machine wrote it.
  [/datetime\(\s*'now'\s*,\s*'([+-]?\d+)\s+(day|days|hour|hours|minute|minutes|month|months|year|years)'\s*\)/gi,
   (_m, n, unit) => `to_char((NOW() AT TIME ZONE 'UTC') + INTERVAL '${n} ${unit.replace(/s$/, '')}', 'YYYY-MM-DD HH24:MI:SS')`],
  [/datetime\(\s*'now'\s*\)/gi, "to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')"],

  [/date\(\s*'now'\s*,\s*'([+-]?\d+)\s+(day|days|month|months|year|years)'\s*\)/gi,
   (_m, n, unit) => `to_char((NOW() AT TIME ZONE 'UTC') + INTERVAL '${n} ${unit.replace(/s$/, '')}', 'YYYY-MM-DD')`],
  [/date\(\s*'now'\s*\)/gi, "to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD')"],

  // The modifier as a PARAMETER: date('now', ?) — the staff app asks for "the
  // last N days" that way. SQLite's modifiers ('-30 days') are Postgres
  // intervals word for word, so the parameter travels unchanged.
  // Still a `?` at this point — placeholders are numbered last, see translate().
  [/datetime\(\s*'now'\s*,\s*\?\s*\)/gi,
   "to_char((NOW() AT TIME ZONE 'UTC') + (?)::interval, 'YYYY-MM-DD HH24:MI:SS')"],
  [/date\(\s*'now'\s*,\s*\?\s*\)/gi,
   "to_char((NOW() AT TIME ZONE 'UTC') + (?)::interval, 'YYYY-MM-DD')"],

  [/\bIFNULL\s*\(/gi, 'COALESCE('],
];

// A function call's arguments, with nesting respected.
//
// A regular expression cannot do this, and the spike proved it the hard way:
// `strftime('%Y-%m', COALESCE(transaction_date, date))` slipped past a pattern
// that stopped at the first bracket, so the Dashboard failed against Postgres
// while every isolated test passed. The school's SQL nests, so the translator
// has to count brackets.
function splitArguments(text) {
  const args = [];
  let depth = 0, current = '', quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === quote) { if (text[i + 1] === quote) { current += text[++i]; } else { quote = null; } }
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; current += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { args.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

// Rewrite every call to `name(...)`, innermost brackets counted properly.
function replaceCall(sql, name, rewrite) {
  const finder = new RegExp('\\b' + name + '\\s*\\(', 'gi');
  let out = sql;
  let guard = 0;
  for (;;) {
    if (++guard > 200) break;          // a runaway rewrite is worse than none
    finder.lastIndex = 0;
    const m = finder.exec(out);
    if (!m) break;

    const open = m.index + m[0].length - 1;
    let depth = 0, close = -1, quote = null;
    for (let i = open; i < out.length; i++) {
      const ch = out[i];
      if (quote) {
        if (ch === quote) { if (out[i + 1] === quote) i++; else quote = null; }
        continue;
      }
      if (ch === "'" || ch === '"') { quote = ch; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close === -1) break;           // unbalanced; leave it alone

    const replacement = rewrite(splitArguments(out.slice(open + 1, close)));
    if (replacement === null) break;   // cannot translate faithfully; leave it
    out = out.slice(0, m.index) + replacement + out.slice(close + 1);
  }
  return out;
}

// strftime('%Y-%m', anything)  →  to_char(anything::timestamp, 'YYYY-MM')
function translateStrftime(sql) {
  return replaceCall(sql, 'strftime', (args) => {
    if (args.length < 2) return null;
    const fmt = args[0].replace(/^'|'$/g, '');
    const pg = fmt.replace(/%Y/g, 'YYYY').replace(/%m/g, 'MM').replace(/%d/g, 'DD')
                  .replace(/%H/g, 'HH24').replace(/%M/g, 'MI').replace(/%S/g, 'SS');
    return `to_char((${args[1]})::timestamp, '${pg}')`;
  });
}

// ROUND(x, 2)
//
// SQLite rounds a float to a number of places. Postgres has round(numeric, int)
// and round(double precision) — and NOT round(double precision, int), so an
// average of anything, which is a double, fails with "function round(double
// precision, integer) does not exist". That is the whole of what broke the
// academics dashboard. One-argument ROUND is left alone: it is the same
// function in both.
function translateRound(sql) {
  // Written to a name this pass does not look for, then named back at the end.
  // Emitting ROUND( here would be found again on the next turn of the loop,
  // and the guard in replaceCall would stop it 200 casts later.
  const out = replaceCall(sql, 'round', (args) => {
    if (args.length !== 2) return null;
    return `__pg_round__((${args[0]})::numeric, ${args[1]})`;
  });
  return out.replace(/__pg_round__/g, 'ROUND');
}

// date(a_column) — the one-argument form over something that is not 'now'.
//
// The dates are TEXT, and Postgres has no date(text). `(x)::date` is the same
// question asked in its own language. date('now') is already gone by here.
function translateDateCast(sql) {
  return replaceCall(sql, 'date', (args) => {
    if (args.length !== 1) return null;
    const arg = args[0].trim();
    if (/^'/.test(arg)) return null;          // a literal; not ours to touch
    return `((${arg})::date)`;
  });
}

function translateDates(sql) {
  let out = sql;
  for (const [pattern, replacement] of DATE_FUNCTIONS) out = out.replace(pattern, replacement);
  out = translateStrftime(out);
  out = translateDateCast(out);
  out = translateRound(out);
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

// == One thing this deliberately does NOT translate ==
//
// Postgres requires every selected column to be grouped or aggregated; SQLite
// does not, and picks an arbitrary row. Postgres also accepts columns that are
// functionally dependent on a grouped primary key, which covers almost all of
// this application's 51 GROUP BY statements — a sweep of 65 read channels found
// exactly ONE that Postgres rejects:
//
//   electron/ipc/dashboard.js — the canteen debtors list groups by the pupil
//   and also selects cg.short_code, which belongs to the joined class table
//   and so is not dependent on that key.
//
// Rewriting GROUP BY automatically would mean guessing which extra columns are
// safe to add, and a wrong guess silently changes how many rows a school's
// dashboard reports. The honest fix is one column added to that one query,
// which is a no-op on SQLite and correct SQL on both. It is not done here
// because it belongs to a handler, and the handlers are not this adapter's to
// edit.

// ── Named parameters ────────────────────────────────────────────────────────
//
// better-sqlite3 takes `@name` as well as `?`, and this adapter used to refuse
// the named form outright, on the strength of an audit that said the
// application never used it. The audit was out of date by two call sites, and
// both of them are in the LEDGER — so every payment taken on a web host failed
// with "Named parameters are not supported", after the money had been counted
// and while a parent stood at the counter.
//
// So they are supported, because wearing better-sqlite3's shape is this
// adapter's whole job. A name used twice becomes ONE placeholder, as
// better-sqlite3 binds it once.
//
// `@name` only. SQLite also allows `:name` and `$name`; this does not, and
// deliberately: `:` is how Postgres writes a cast (`::numeric` — which this
// very file emits) and `$` is how it writes a placeholder. Refusing to guess
// beats corrupting a statement that looked fine.
const NAMED = /^@([A-Za-z_][A-Za-z0-9_]*)/;

function namedParameters(sql) {
  const names = [];
  const text = mapOutsideStrings(String(sql), (text_, i) => {
    if (text_[i] !== '@') return null;
    const m = NAMED.exec(text_.slice(i));
    if (!m) return null;
    let at = names.indexOf(m[1]);
    if (at === -1) { names.push(m[1]); at = names.length - 1; }
    return { text: `$${at + 1}`, length: m[0].length };
  });
  return { text, names };
}

// What a statement becomes, and what it wants bound to it.
function translateWithNames(sql, hasIdColumn) {
  const named = namedParameters(sql);
  if (named.names.length) {
    // A named statement has no `?` to number, and numbering would renumber the
    // placeholders this just wrote.
    let out = translateInsertOr(named.text);
    out = translateDates(out);
    out = addReturningId(out, hasIdColumn);
    return { text: out, names: named.names };
  }
  return { text: translate(sql, hasIdColumn), names: [] };
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
  translate, translateWithNames, namedParameters, numberPlaceholders, translateDates, translateInsertOr, addReturningId,
  mapOutsideStrings, replaceCall, splitArguments, translateStrftime,
};
