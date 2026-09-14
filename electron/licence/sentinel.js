// Nickland Edusoft — the checks that are not in one place.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// `licence/index.js` has one function that decides everything, which makes it
// one function to find and one line to change. This file exists so that is not
// the whole story.
//
// What it adds:
//
//   * **A second, independent verification.** It re-derives the answer from the
//     stored token itself rather than calling `state()`, so patching `state()`
//     to return `full` does not satisfy this. Two places have to be found.
//
//   * **Checks at unpredictable moments.** Not on every call — on a small
//     random fraction of them, and on a timer that drifts. A patcher watching
//     what happens when they press a button sees nothing; the refusal arrives
//     minutes later, somewhere else, which is far harder to trace back to the
//     check that caused it.
//
//   * **A consequence that is not immediate.** When a mismatch is found the
//     app does not throw at that moment. It records it, and the NEXT licence
//     refresh reports it, and the cloud can then decline to renew. Delay is
//     deliberate: an error at the moment of tampering is an error that tells
//     the tamperer exactly which line to look at next.
//
//   * **Anti-debugging, honestly weighted.** A devtools check is in here
//     because it costs nothing, and it is worth almost nothing — anybody who
//     can attach a debugger can remove it. It is a speed bump, listed as one.
//
// None of this makes the app uncrackable. Nothing that runs on somebody else's
// computer is. It makes a crack require finding several things rather than
// one, and it makes a crack that misses one of them fail later and elsewhere,
// which is the difference between an afternoon and a serious effort.

const crypto = require('crypto');
const { getSetting, setSetting } = require('../utils/idgen');

const FLAG = 'licence_integrity_flag';
const SEEN = 'licence_integrity_seen';

// How often a guarded call actually re-checks. Low enough to cost nothing,
// high enough that a session of ordinary use hits it many times.
const SAMPLE = 0.04;

let lastDeep = 0;

function note(db, reason) {
  try {
    const existing = getSetting(db, FLAG, '');
    if (existing) return;                       // the first one is the one that matters
    setSetting(db, FLAG, String(reason || 'mismatch').slice(0, 60), 'licence');
    setSetting(db, SEEN, new Date().toISOString(), 'licence');
  } catch (_) { /* a flag we cannot write is a flag the cloud will not hear about */ }
}

function flagged(db) {
  try {
    const reason = getSetting(db, FLAG, '');
    return reason ? { reason, at: getSetting(db, SEEN, '') } : null;
  } catch (_) { return null; }
}

function clear(db) {
  try { setSetting(db, FLAG, '', 'licence'); } catch (_) {}
}

// Re-derive the verdict from the stored token, WITHOUT going through
// licence.state(). Deliberately duplicated logic: the point is that both have
// to be defeated, so sharing a helper between them would defeat the point.
function independentVerdict(db) {
  const licence = require('./index');
  const token = getSetting(db, licence.SETTINGS.token, '');
  if (!token) return 'unlicensed';

  const [body, signature] = String(token).split('.');
  if (!body || !signature) return 'malformed';

  const key = licence.publicKeyPem(db);
  if (!key) return 'unverified';

  const bytes = (text) => {
    const s = String(text).replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(s + '='.repeat((4 - (s.length % 4)) % 4), 'base64');
  };
  let good = false;
  try { good = crypto.verify(null, bytes(body), key, bytes(signature)); }
  catch (_) { good = false; }
  if (!good) return 'bad_signature';

  let claims;
  try { claims = JSON.parse(bytes(body).toString('utf8')); }
  catch (_) { return 'malformed'; }

  if (claims.device && claims.device !== licence.deviceId(db)) return 'wrong_device';
  const notAfter = Date.parse(claims.not_after || '') || 0;
  const grace = Math.max(0, Number(claims.offline_grace_days) || 0) * 86400000;
  if (notAfter && Date.now() > notAfter + grace) return 'lease_expired';
  return claims.access === 'full' ? 'full' : 'restricted';
}

// The cheap check, run on a fraction of guarded calls.
function sample(db) {
  if (Math.random() > SAMPLE) return;
  deep(db);
}

// The real one. Rate-limited so a burst of calls does not verify a signature
// five hundred times, and drifting so it is not on a round number of seconds.
function deep(db) {
  const now = Date.now();
  if (now - lastDeep < 45000 + Math.floor(Math.random() * 30000)) return;
  lastDeep = now;

  try {
    const licence = require('./index');
    const integrity = require('./integrity');

    const mine = independentVerdict(db);
    const theirs = licence.state(db).access;

    // The disagreement that matters: the main path says everything is fine and
    // an independent reading of the same token says it is not. One of the two
    // has been changed.
    if ((theirs === 'full') && !['full', 'unlicensed', 'unverified'].includes(mine)) {
      note(db, `disagreement:${mine}`);
    }

    // And the code itself.
    const claims = licence.state(db).licence;
    if (claims && claims.build && claims.build !== integrity.buildId()) {
      note(db, 'build');
    }
  } catch (_) { /* never break the app to run a check */ }
}

// Is somebody watching? Worth almost nothing on its own, and free.
function observed() {
  try {
    // A debugger attached makes a `debugger` statement take measurable time.
    const started = process.hrtime.bigint();
    // eslint-disable-next-line no-debugger
    debugger;
    return Number(process.hrtime.bigint() - started) > 100_000_000;   // 100ms
  } catch (_) { return false; }
}

module.exports = { FLAG, SEEN, note, flagged, clear, sample, deep,
                   independentVerdict, observed };
