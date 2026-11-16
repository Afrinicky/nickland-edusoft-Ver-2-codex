// Nickland Edusoft — a record's name, the same in every database.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// UUIDv7: 48 bits of Unix milliseconds, then 74 bits of randomness, with the
// version and variant bits set as RFC 9562 requires.
//
// ── Why v7 and not v4 ───────────────────────────────────────────────────────
//
// Both are unique; only v7 is ORDERED. That matters three times over here:
//
//   * The journal is read in order. A time-ordered id means "everything after
//     this one" is a range scan rather than a sort of the whole table.
//   * A B-tree index on a random id scatters inserts across every page it has.
//     On a school's laptop with a term of records in it, that is the
//     difference between an index that stays in memory and one that does not.
//   * When something has gone wrong at four in the morning, ids that sort by
//     the time they were made are the difference between reading a log and
//     guessing at one.
//
// ── Why not crypto.randomUUID() ─────────────────────────────────────────────
//
// Node's built-in is v4 — unordered. It is used elsewhere in this codebase for
// the outbox, where order never mattered.

const crypto = require('crypto');

// Monotonic within a millisecond.
//
// Two rows written in the same millisecond would otherwise sort arbitrarily
// against each other, and a journal that cannot say which of two writes came
// first cannot settle a conflict between them. So inside one millisecond the
// random tail is incremented rather than redrawn, which keeps ordering exact
// without a counter anybody has to persist.
let lastMs = 0;
let lastTail = null;

function uuidv7() {
  const now = Date.now();
  let bytes;

  if (now === lastMs && lastTail) {
    // Same millisecond: step the tail. Carry upward; on the (vanishingly
    // unlikely) overflow of all 10 bytes, fall through to a fresh draw.
    bytes = Buffer.from(lastTail);
    let i = bytes.length - 1;
    while (i >= 0) {
      bytes[i] = (bytes[i] + 1) & 0xff;
      if (bytes[i] !== 0) break;
      i--;
    }
    if (i < 0) bytes = crypto.randomBytes(10);
  } else {
    bytes = crypto.randomBytes(10);
    // A clock that has gone backwards — a laptop's clock corrected, or the
    // deliberate wind-back the licence already defends against — must not
    // produce ids that sort before records already written. Hold the last
    // millisecond rather than regress.
    lastMs = now > lastMs ? now : lastMs;
  }
  if (now > lastMs) lastMs = now;
  lastTail = Buffer.from(bytes);

  const ms = lastMs;
  const out = Buffer.alloc(16);
  // 48-bit big-endian timestamp.
  out[0] = (ms / 0x10000000000) & 0xff;
  out[1] = (ms / 0x100000000) & 0xff;
  out[2] = (ms / 0x1000000) & 0xff;
  out[3] = (ms / 0x10000) & 0xff;
  out[4] = (ms / 0x100) & 0xff;
  out[5] = ms & 0xff;
  bytes.copy(out, 6);
  out[6] = (out[6] & 0x0f) | 0x70;   // version 7
  out[8] = (out[8] & 0x3f) | 0x80;   // variant 10
  const h = out.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// The millisecond an id was made, for reading a journal by eye.
function uuidv7Time(uid) {
  const h = String(uid || '').replace(/-/g, '');
  if (h.length !== 32) return null;
  return parseInt(h.slice(0, 12), 16);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

module.exports = { uuidv7, uuidv7Time, isUuid };
