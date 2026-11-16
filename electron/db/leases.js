// Nickland Edusoft — numbers a school hands to a person, allocated safely.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A receipt number and an admission number are not database ids. They are
// printed, read aloud across a counter, written in a ledger by hand and quoted
// back weeks later. They have to be unique, and they have to look sequential.
//
// Both came from a counter in the `settings` table — one counter, per
// database. That is correct while a school has one database and becomes a
// guaranteed collision the moment it has two:
//
//   the office PC, offline all morning, issues receipts 101, 102, 103
//   the cloud, meanwhile, issues 101 and 102 to the bursar working from home
//
// `payments.receipt_number` is UNIQUE. So when the morning's work syncs, the
// second 101 cannot be inserted — and a payment that cannot be recorded is
// money the school has taken and cannot account for. Renumbering afterwards is
// not available either: 101 is on a receipt in a parent's hand.
//
// ── Leases ──────────────────────────────────────────────────────────────────
//
// So a machine does not allocate from a shared counter. It is GRANTED a block
// and allocates inside it:
//
//   cloud  ->  office PC   "you have 4001..4500"
//   cloud  ->  the bursar  "you have 4501..5000"
//
// Neither can reach the other's numbers, no coordination is needed while
// offline, and the numbers still read sequentially to the person holding one.
// The cloud is the only allocator of blocks, which is what makes it safe: one
// allocator, asked rarely, instead of one counter contended constantly.
//
// ── Running out while offline ───────────────────────────────────────────────
//
// A block runs out eventually. The answer is NOT to fall back to the shared
// counter — that reintroduces exactly the collision this exists to prevent —
// and it is not to refuse the payment either, because a school that cannot
// take money has a worse problem than an ugly receipt number.
//
// So an exhausted machine issues device-suffixed numbers: `4500-A7F3`. Visibly
// different, obviously still a receipt, and impossible to collide with another
// machine's block. The sync screen says the school is running on borrowed
// numbers so somebody can reconnect and draw a fresh block.

const DEFAULT_BLOCK = 500;

/** The lease for one kind of number, or null when this machine holds none. */
function get(db, kind) {
  try { return db.prepare('SELECT * FROM id_leases WHERE kind = ?').get(kind) || null; }
  catch (_) { return null; }
}

/** Record a block granted by the cloud. Replaces whatever was held: a machine
 *  given a new block has finished with the old one, and keeping both would
 *  mean guessing which to draw from. */
function grant(db, kind, { from, to, deviceId = null }) {
  const start = parseInt(from, 10);
  const end = parseInt(to, 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
    return { ok: false, error: 'A lease needs a start and an end, with the end no lower than the start.' };
  }
  db.prepare(`
    INSERT INTO id_leases (kind, next_value, until_value, device_id, granted_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (kind) DO UPDATE SET
      next_value = excluded.next_value, until_value = excluded.until_value,
      device_id = excluded.device_id, granted_at = CURRENT_TIMESTAMP
  `).run(kind, start, end, deviceId);
  return { ok: true, from: start, to: end };
}

/**
 * Take the next number.
 *
 * Returns `{ value, suffixed }`. `suffixed` is true when the block was
 * exhausted and the number carries a device suffix — the caller shows that
 * differently, because it is a sign the school should reconnect.
 *
 * The whole read-and-advance is one statement, so two requests arriving
 * together on the LAN host cannot both read the same next_value. That is not
 * theoretical: the host answers several desks at once.
 */
function take(db, kind, { deviceId = null } = {}) {
  const lease = get(db, kind);
  if (!lease) return { ok: false, exhausted: true, error: 'no_lease' };

  if (lease.next_value <= lease.until_value) {
    const r = db.prepare(`
      UPDATE id_leases SET next_value = next_value + 1
       WHERE kind = ? AND next_value <= until_value
    `).run(kind);
    if (r.changes === 1) {
      return { ok: true, value: lease.next_value, suffixed: false,
               remaining: lease.until_value - lease.next_value };
    }
    // Somebody else took the last one between the read and the write.
    return take(db, kind, { deviceId });
  }

  // Exhausted. A visibly-different number beats a refused payment.
  const tag = String(deviceId || lease.device_id || 'LOCAL').replace(/-/g, '').slice(-4).toUpperCase();
  return { ok: true, value: `${lease.until_value}-${tag}`, suffixed: true, remaining: 0 };
}

/** What the sync screen shows: whether this machine can still issue numbers
 *  the ordinary way, and how many are left before it cannot. */
function status(db) {
  const out = {};
  for (const kind of ['receipt', 'admission']) {
    const lease = get(db, kind);
    out[kind] = lease
      ? {
          held: true,
          next: lease.next_value,
          until: lease.until_value,
          remaining: Math.max(0, lease.until_value - lease.next_value + 1),
          exhausted: lease.next_value > lease.until_value,
        }
      : { held: false, remaining: 0, exhausted: true };
  }
  return out;
}

module.exports = { get, grant, take, status, DEFAULT_BLOCK };
