// Nickland Edusoft — the chequebook of document seals.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A seal is a short signed statement that Nickland issued a particular receipt
// or report card. It goes on the document and anybody can check it at /verify.
// Minting one needs the private signing key, which is on the service and will
// never be on this computer — so this file does not make seals, it SPENDS them.
//
// Drawn in batches while the school is online and spent while it is not,
// exactly as a chequebook is. That is what keeps the offline product offline:
// a paying school carries hundreds, tops up on any sync, and never learns this
// exists. A school that stops paying stops being issued new ones and spends
// what it has — no cliff, nothing deleted, and a term or so of runway.
//
// It is also the one part of the licensing design that patching this app does
// not defeat. Delete every licence check in the codebase and the application
// runs beautifully; its receipts still will not verify, because the thing that
// makes them verify was never here.

const { getSetting, setSetting } = require('../utils/idgen');

const LOW_WATER = 100;

function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_seals (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      kind        TEXT NOT NULL DEFAULT 'receipt',
      serial      TEXT NOT NULL UNIQUE,
      signature   TEXT NOT NULL DEFAULT '',
      issued_at   TEXT,
      spent_at    TEXT,
      reference   TEXT,
      reported_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_seal_unspent
      ON document_seals (kind, spent_at);
  `);
}

function stock(db, kind = 'receipt') {
  try {
    ensureTable(db);
    return db.prepare(
      'SELECT COUNT(*) AS n FROM document_seals WHERE kind = ? AND spent_at IS NULL'
    ).get(kind).n;
  } catch (_) { return 0; }
}

// Take the next unspent seal and mark it used, in one statement so two
// receipts issued in the same second cannot be handed the same one.
function take(db, kind, reference) {
  ensureTable(db);
  const row = db.prepare(`
    SELECT id, serial, signature, issued_at FROM document_seals
     WHERE kind = ? AND spent_at IS NULL ORDER BY id ASC LIMIT 1
  `).get(kind);
  if (!row) return null;
  const claimed = db.prepare(`
    UPDATE document_seals SET spent_at = datetime('now'), reference = ?
     WHERE id = ? AND spent_at IS NULL
  `).run(reference || '', row.id);
  if (!claimed || !claimed.changes) return take(db, kind, reference);  // somebody else got it
  return { serial: row.serial, signature: row.signature, issued_at: row.issued_at };
}

// What goes on the document. Returns null when the school has run out, and the
// caller decides what to do — which for a receipt is "issue it anyway, unsealed"
// rather than "refuse to take the parent's money".
function sealFor(db, kind, reference) {
  try { return take(db, kind, reference); }
  catch (_) { return null; }
}

function store(db, kind, seals) {
  ensureTable(db);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO document_seals (kind, serial, signature, issued_at)
    VALUES (?, ?, ?, ?)
  `);
  let kept = 0;
  for (const seal of seals || []) {
    if (!seal || !seal.serial) continue;
    const done = insert.run(kind, seal.serial, seal.signature || '', seal.issued_at || '');
    kept += done.changes || 0;
  }
  return kept;
}

function unreported(db, limit = 500) {
  ensureTable(db);
  return db.prepare(`
    SELECT serial, reference FROM document_seals
     WHERE spent_at IS NOT NULL AND reported_at IS NULL
     ORDER BY id ASC LIMIT ?
  `).all(limit);
}

function markReported(db, serials) {
  if (!serials || !serials.length) return;
  const mark = db.prepare(
    "UPDATE document_seals SET reported_at = datetime('now') WHERE serial = ?");
  for (const serial of serials) { try { mark.run(serial); } catch (_) {} }
}

// Top up while we have a connection, and tell the cloud which we have used.
// Called from the sync tick; never throws.
async function replenish(db, { kinds = ['receipt', 'report_card'] } = {}) {
  const { httpJson } = require('../server/gateways/http');
  const base = (getSetting(db, 'cloud_base_url', '') || '').replace(/\/+$/, '');
  const key = getSetting(db, 'school_api_key', '');
  if (!base || !key) return { ok: false, error: 'not_configured' };

  const report = { drawn: {}, reported: 0 };

  // Say what has been used first. A school whose database was restored from a
  // backup will be spending seals it has already spent, and we would rather
  // hear about that than not.
  try {
    const used = unreported(db);
    if (used.length) {
      const res = await httpJson(`${base}/api/v1/seals/spend`, {
        method: 'POST', headers: { 'x-school-key': key },
        body: { spent: used },
      });
      if (res.json && res.json.ok) {
        markReported(db, used.map((u) => u.serial));
        report.reported = used.length;
      }
    }
  } catch (_) { /* it will be reported next time */ }

  for (const kind of kinds) {
    if (stock(db, kind) >= LOW_WATER) continue;
    try {
      const res = await httpJson(`${base}/api/v1/seals/draw`, {
        method: 'POST', headers: { 'x-school-key': key },
        body: { kind, device: require('./index').deviceId(db) },
      });
      if (res.json && res.json.ok) {
        report.drawn[kind] = store(db, kind, res.json.seals);
      } else if (res.status === 402) {
        // Suspended. Not an error to retry loudly — the school knows, and the
        // seals it already holds keep working.
        report.refused = (res.json && res.json.error) || 'suspended';
      }
    } catch (_) { /* offline; spend what we have */ }
  }
  return { ok: true, ...report };
}

module.exports = { LOW_WATER, ensureTable, stock, sealFor, store, replenish,
                   unreported, markReported };
