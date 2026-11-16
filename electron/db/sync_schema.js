// Nickland Edusoft — stable record identity and the transaction journal.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Phase 2 of the cloud-first work. Nothing here changes what the application
// does; it changes what the database can say about what was done, which is the
// prerequisite for two-way synchronisation.
//
// Three things are added:
//
//   record_uid    a UUIDv7 on each of the 74 tables that cross between
//                 machines (electron/db/sync_tables.js). Allocated once by
//                 whichever machine created the row. The integer primary key
//                 stays, every foreign key keeps pointing at it, and no
//                 handler is rewritten.
//
//   sync_journal  append-only, one row per row-change, carrying the uid, the
//                 table, the operation, the before and after images, the
//                 device and the user. Never collapsed — which is the whole
//                 difference between this and sync_outbox, whose rows collapse
//                 onto one per entity and therefore cannot reconstruct what
//                 happened offline.
//
//   id_leases     blocks of receipt and admission numbers granted to one
//                 machine, so two machines working offline cannot both mint
//                 receipt 101.
//
// ── Why triggers and not 1,736 edits ────────────────────────────────────────
//
// The audit found the database is reached through `db.prepare(...)` in 1,736
// places across the handlers, and that the SAME handlers answer the Electron
// window, the LAN API and host/server.js. Journalling at the call sites would
// mean 1,736 opportunities to forget, in a file somebody edits next month.
//
// A trigger cannot be forgotten. It fires for every write that reaches the
// table, whichever surface the call came in on and whether the handler knew
// about the journal or not — which is exactly the guarantee the brief asks for
// when it says to establish "all database write paths".
//
// ── The two SQLite constraints that shape the design ────────────────────────
//
//  1. A trigger cannot assign to NEW. (That is MySQL. SQLite has no such
//     statement.) So a row's uid cannot be filled "on the way in".
//  2. `ALTER TABLE ADD COLUMN` rejects a non-constant DEFAULT, so the column
//     cannot default to a freshly generated uid either.
//
// Hence: an AFTER INSERT trigger fills the uid with an UPDATE when the handler
// did not supply one, and then journals. That UPDATE fires the update trigger,
// so the update trigger is guarded with `WHEN OLD.record_uid IS NOT NULL` —
// otherwise every insert would be journalled twice, once as an insert and once
// as a spurious update.

const { SYNCED } = require('./sync_tables');

// A UUIDv7 built in SQL, because the generating machine is the database here
// rather than the application. Shape matches electron/utils/uid.js exactly:
// 48 bits of Unix milliseconds, version 7, variant 10, the rest random.
//
//   chars 1..12  the timestamp, so ids sort by when they were made
//   char  13     '7', the version
//   char  17     '8', a valid variant
//
// `julianday` rather than `unixepoch(...,'subsec')` so this works on the
// SQLite that ships with older Electron builds as well as node:sqlite.
// A UUIDv7 built in SQL, because the generating machine is the database here
// rather than the application. Shape matches electron/utils/uid.js exactly:
// 48 bits of Unix milliseconds, version 7, variant 10, the rest random.
//
// ── Written INLINE, with no wrapping subquery, and that is not a style choice ─
//
// The first version of this wrapped the parts in `(SELECT ... FROM (SELECT
// printf(...) AS ts, hex(randomblob(10)) AS rnd))`. It read better and it was
// wrong: an uncorrelated scalar subquery is evaluated ONCE PER STATEMENT, so
// the backfill gave every row in a table the same uid and died on the unique
// index — which is at least a loud failure, but an UPDATE that silently
// assigned one identity to a whole table would have been a quiet catastrophe.
//
// Written out, each randomblob() call is non-deterministic and SQLite
// evaluates it per row. `julianday('now')` is fixed for the statement, which
// is fine: the timestamp only has to order ids, and the randomness makes them
// unique.
const TS12 = "printf('%012x', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))";
const SQL_UUIDV7 = [
  `(substr(${TS12}, 1, 8)`,
  `|| '-' || substr(${TS12}, 9, 4)`,
  "|| '-7' || substr(lower(hex(randomblob(2))), 1, 3)",
  "|| '-8' || substr(lower(hex(randomblob(2))), 1, 3)",
  "|| '-' || lower(hex(randomblob(6))))",
].join(' ');



// The infrastructure tables. Deliberately NOT in SYNCED — see sync_tables.js.
const INFRASTRUCTURE = `
  -- This installation's own identity. One row, written once, never synced.
  CREATE TABLE IF NOT EXISTS sync_device (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    device_id     TEXT NOT NULL,
    label         TEXT,
    kind          TEXT,              -- desktop | lan-host | cloud
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- What the triggers stamp onto a journal entry: who is acting, right now, on
  -- this machine. One row, overwritten constantly.
  --
  -- A trigger cannot read a session variable, and SQLite has no equivalent of
  -- one — so the acting user is parked here by ipc/_security.js (which already
  -- tracks exactly this, per request, for the audit log) and read back by the
  -- triggers. When nothing has been set the entry simply records no user,
  -- which is the honest answer for a migration or a background task.
  CREATE TABLE IF NOT EXISTS sync_context (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    device_id  TEXT,
    user_id    INTEGER,
    txn_id     TEXT,
    source     TEXT                  -- ipc | lan | cloud | sync | migration
  );

  -- The journal. Append-only: there is no UPDATE and no DELETE on this table
  -- anywhere in the application, only the pruning of entries both acknowledged
  -- and aged.
  CREATE TABLE IF NOT EXISTS sync_journal (
    seq             INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_uid       TEXT NOT NULL,     -- this ENTRY's own id, for idempotent replay
    record_uid      TEXT NOT NULL,     -- the row it is about
    table_name      TEXT NOT NULL,
    op              TEXT NOT NULL,     -- insert | update | delete
    before_json     TEXT,
    after_json      TEXT,
    device_id       TEXT,
    user_id         INTEGER,
    txn_id          TEXT,
    source          TEXT,
    idempotency_key TEXT,              -- money only; unique per logical act
    happened_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    pushed_at       TEXT               -- NULL until the cloud has it
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entry ON sync_journal(entry_uid);
  CREATE INDEX IF NOT EXISTS idx_journal_unpushed ON sync_journal(pushed_at, seq);
  CREATE INDEX IF NOT EXISTS idx_journal_record ON sync_journal(record_uid, seq);
  -- Money: the same logical payment can never be journalled twice, whatever
  -- replays it. Partial so the 60-odd non-financial tables pay nothing for it.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_idem
    ON sync_journal(idempotency_key) WHERE idempotency_key IS NOT NULL;

  -- How far this machine has got, in each direction. Durable, so an
  -- interrupted sync resumes where it stopped rather than starting again.
  CREATE TABLE IF NOT EXISTS sync_cursor (
    name       TEXT PRIMARY KEY,       -- 'upload' | 'download'
    position   TEXT NOT NULL DEFAULT '0',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- Blocks of human-facing numbers granted to this machine by the cloud.
  --
  -- This is what stops two machines minting receipt 101. "receipt_number" is
  -- UNIQUE on payments, so without it the second one to sync simply fails to
  -- insert — and a payment that cannot be recorded is money the school has
  -- taken and cannot account for.
  CREATE TABLE IF NOT EXISTS id_leases (
    kind        TEXT PRIMARY KEY,      -- 'receipt' | 'admission'
    next_value  INTEGER NOT NULL,
    until_value INTEGER NOT NULL,      -- inclusive; exhausted when next > until
    device_id   TEXT,
    granted_at  TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

// One table's worth of identity + journalling.
function tableStatements(table) {
  const t = table;
  // The column list is read at migration time so before/after images carry the
  // real row rather than a hand-maintained list that drifts.
  return {
    column: `ALTER TABLE ${t} ADD COLUMN record_uid TEXT`,
    index: `CREATE UNIQUE INDEX IF NOT EXISTS idx_${t}_record_uid ON ${t}(record_uid)`,
    backfill: `UPDATE ${t} SET record_uid = ${SQL_UUIDV7} WHERE record_uid IS NULL`,
  };
}

function triggerStatements(db, table) {
  const t = table;
  const cols = db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all().map(r => r.name);
  // json_object('col', NEW.col, …) for the whole row. Built from the live
  // column list, so a column added later appears in the journal without
  // anybody updating a list.
  const img = (ref) => cols.map(c => `'${c}', ${ref}."${c}"`).join(', ');
  const ctx = `(SELECT device_id FROM sync_context WHERE id = 1)`;
  const usr = `(SELECT user_id FROM sync_context WHERE id = 1)`;
  const txn = `(SELECT txn_id FROM sync_context WHERE id = 1)`;
  const src = `(SELECT source FROM sync_context WHERE id = 1)`;

  return [
    `DROP TRIGGER IF EXISTS trg_${t}_sync_ins`,
    `DROP TRIGGER IF EXISTS trg_${t}_sync_upd`,
    `DROP TRIGGER IF EXISTS trg_${t}_sync_del`,

    // INSERT: fill the uid if the handler did not, then journal.
    `CREATE TRIGGER trg_${t}_sync_ins AFTER INSERT ON ${t}
     BEGIN
       UPDATE ${t} SET record_uid = ${SQL_UUIDV7}
        WHERE rowid = NEW.rowid AND record_uid IS NULL;
       INSERT INTO sync_journal
         (entry_uid, record_uid, table_name, op, after_json, device_id, user_id, txn_id, source)
       SELECT ${SQL_UUIDV7}, record_uid, '${t}', 'insert',
              json_object(${cols.map(c => `'${c}', "${c}"`).join(', ')}),
              ${ctx}, ${usr}, ${txn}, ${src}
         FROM ${t} WHERE rowid = NEW.rowid;
     END`,

    // UPDATE: guarded, so the uid-filling UPDATE above is not journalled as a
    // change the school made. Without this guard every insert produces two
    // entries and the second one claims the row was edited.
    `CREATE TRIGGER trg_${t}_sync_upd AFTER UPDATE ON ${t}
     WHEN OLD.record_uid IS NOT NULL
     BEGIN
       INSERT INTO sync_journal
         (entry_uid, record_uid, table_name, op, before_json, after_json, device_id, user_id, txn_id, source)
       VALUES (${SQL_UUIDV7}, NEW.record_uid, '${t}', 'update',
               json_object(${img('OLD')}), json_object(${img('NEW')}),
               ${ctx}, ${usr}, ${txn}, ${src});
     END`,

    // DELETE: the before image IS the record. A tombstone with no contents
    // cannot be undone and cannot be explained.
    `CREATE TRIGGER trg_${t}_sync_del AFTER DELETE ON ${t}
     WHEN OLD.record_uid IS NOT NULL
     BEGIN
       INSERT INTO sync_journal
         (entry_uid, record_uid, table_name, op, before_json, device_id, user_id, txn_id, source)
       VALUES (${SQL_UUIDV7}, OLD.record_uid, '${t}', 'delete',
               json_object(${img('OLD')}), ${ctx}, ${usr}, ${txn}, ${src});
     END`,
  ];
}

/**
 * Apply the identity and journal schema. Idempotent and resumable: run it
 * twice, or on a database that was interrupted halfway, and it finishes the
 * job without disturbing what is already there.
 *
 * Returns a report rather than throwing, because a school's database being
 * upgraded must not be left half-migrated by one bad table — and an operator
 * needs to know which one it was.
 */
function applySyncSchema(db, { withTriggers = true } = {}) {
  const report = { columns: 0, backfilled: 0, triggers: 0, skipped: [], errors: [] };

  db.exec(INFRASTRUCTURE);

  const existing = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));

  for (const table of SYNCED) {
    if (!existing.has(table)) { report.skipped.push(table); continue; }
    const st = tableStatements(table);
    const has = db.prepare(`SELECT COUNT(*) c FROM pragma_table_info('${table}') WHERE name = 'record_uid'`).get().c;
    try {
      if (!has) { db.exec(st.column); report.columns++; }
      db.exec(st.index);
      const r = db.prepare(st.backfill).run();
      report.backfilled += r.changes || 0;
    } catch (e) {
      report.errors.push(`${table}: ${e.message}`);
      continue;
    }
    if (!withTriggers) continue;
    try {
      for (const sql of triggerStatements(db, table)) db.exec(sql);
      report.triggers++;
    } catch (e) {
      report.errors.push(`${table} triggers: ${e.message}`);
    }
  }

  // Cursors exist from the start so "never synced" and "lost the cursor" are
  // different states.
  db.exec(`INSERT OR IGNORE INTO sync_cursor (name, position) VALUES ('upload', '0'), ('download', '0')`);
  return report;
}

/** Remove the journalling triggers — used when restoring a backup or importing
 *  in bulk, where a journal entry per row is noise rather than history. */
function dropSyncTriggers(db) {
  let n = 0;
  for (const t of SYNCED) {
    for (const suffix of ['ins', 'upd', 'del']) {
      try { db.exec(`DROP TRIGGER IF EXISTS trg_${t}_sync_${suffix}`); n++; } catch (_) {}
    }
  }
  return n;
}

module.exports = { applySyncSchema, dropSyncTriggers, SQL_UUIDV7, triggerStatements, INFRASTRUCTURE };
