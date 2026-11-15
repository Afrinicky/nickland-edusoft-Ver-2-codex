// Nickland Edusoft — how a staff password is stored, said once.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// There were eight `bcrypt.hashSync(password, 10)` calls across four files.
// Eight places to change is one place that gets missed, and a cost factor is
// exactly the kind of number that is right when it is written and quietly
// wrong five years later: 10 was the sensible default when bcrypt was young,
// and hardware has not stood still.
//
// 12 is the figure to use now. It is about four times the work of 10 — a few
// hundred milliseconds on an office PC, once, at sign-in, which nobody
// notices — and four times the cost to somebody grinding a stolen database.
//
// ── Why old hashes are not a problem ────────────────────────────────────────
//
// A cost factor is stored inside the hash, so a hash made at 10 still verifies
// at 10 after this changes; nobody is locked out and no school has to reset
// anything. What WOULD be a problem is leaving them at 10 forever, since a
// school's oldest accounts are usually its most powerful ones. So a hash below
// the current cost is replaced the next time its owner signs in, when the
// password is in hand and already proven correct — see `rehashIfStale`.
//
// Parents are not here: their passwords are scrypt, in
// electron/server/parents.js, with its own parameters.

let _bcrypt = null;
function bcrypt() { return _bcrypt || (_bcrypt = require('bcryptjs')); }

const BCRYPT_COST = 12;

function hashPassword(password) {
  return bcrypt().hashSync(String(password), BCRYPT_COST);
}

// The cost a stored hash was made at, or null if it is not a bcrypt hash this
// understands. The format is `$2<x>$<cost>$<salt+digest>`.
function costOf(hash) {
  const m = /^\$2[aby]?\$(\d{2})\$/.exec(String(hash || ''));
  return m ? parseInt(m[1], 10) : null;
}

function isStale(hash) {
  const cost = costOf(hash);
  return cost !== null && cost < BCRYPT_COST;
}

// Upgrade one account's hash, if it needs it. Called only where the password
// has just been verified — that is the single moment the plaintext is known
// and known to be right.
//
// Never throws and never reports: a failed upgrade must not fail the sign-in
// that prompted it. The account simply stays at its old cost and is offered
// the upgrade again next time.
function rehashIfStale(db, { table, id, hash, password }) {
  try {
    if (!isStale(hash) || !password) return false;
    // The table name is one of two literals chosen by the caller, never input.
    if (table !== 'users') return false;
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
    return true;
  } catch (_) { return false; }
}

module.exports = { BCRYPT_COST, hashPassword, costOf, isStale, rehashIfStale };
