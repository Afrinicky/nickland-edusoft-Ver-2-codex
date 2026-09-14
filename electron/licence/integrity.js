// Nickland Edusoft — is this the application we shipped?
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A licence check is only worth what the code around it is worth. If the
// licence module says "read-only" and somebody edits the ten lines that act on
// that, the lease is perfect and useless. So the question this file answers is
// the one underneath: **is the code running the code we signed?**
//
// Three independent answers, because any one of them is a single thing to
// defeat and three are not:
//
//   1. THE OPERATING SYSTEM. `EnableEmbeddedAsarIntegrityValidation` +
//      `onlyLoadAppFromAsar` (see scripts/fuses.mjs) make Electron itself
//      refuse to load an app.asar whose contents do not match the hash baked
//      into the binary at package time. The fuses are flipped BEFORE signing,
//      so flipping them back breaks the code signature and Gatekeeper or
//      SmartScreen refuses the binary. This is the strongest of the three
//      because it is not our code doing the checking.
//
//   2. THE LEASE. The cloud puts the build's expected hash inside the SIGNED
//      lease (`build`). A modified app cannot produce a lease that names its
//      own hash without the private key, and cannot use a genuine lease
//      because the genuine lease names the real build. See app/billing/licence.py.
//
//   3. THIS FILE. A plain self-hash of the files that matter, compared against
//      what the lease says. Weakest of the three on its own — anybody who can
//      edit the app can edit this — but it costs nothing and it is one more
//      thing that has to be found.
//
// **What this is not.** It is not unbreakable, and no honest document about
// client-side protection says otherwise. Somebody sufficiently determined and
// sufficiently skilled gets through all of it, because the code runs on their
// computer. What it does is move "run it without paying" from something a
// bursar does with a text editor in ten minutes to something that needs a
// reverse engineer, a code-signing bypass, and a fresh effort after every
// release. That is the whole of what any vendor achieves, Adobe included.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// The files whose contents decide whether this copy may be used. Hashed
// together into one value. Deliberately a short list: it has to be stable
// across a rebuild of unrelated code, or every release would look tampered.
const GUARDED = [
  'licence/index.js',
  'licence/refresh.js',
  'ipc/_guard.js',
  'ipc/_policy.js',
  'server/api.js',
];

function appRoot() {
  // __dirname is …/electron/licence inside the asar; the guarded paths are
  // relative to …/electron.
  return path.resolve(__dirname, '..');
}

// The hash of this build's own guarded files. Stable for a given release and
// different for any edit to any of them.
function selfHash() {
  const hash = crypto.createHash('sha256');
  for (const rel of GUARDED) {
    try {
      hash.update(rel);
      hash.update(fs.readFileSync(path.join(appRoot(), rel)));
    } catch (_) {
      // A guarded file that cannot be read is itself a finding — recorded as a
      // distinct value rather than skipped, so deleting a file does not
      // produce the same hash as never having had it.
      hash.update('<missing>');
    }
  }
  return hash.digest('hex').slice(0, 32);
}

let cached = null;
function buildId() {
  if (cached === null) cached = selfHash();
  return cached;
}

// Whether Electron was packaged with the integrity fuses on. Reported to the
// cloud rather than acted on here: a development run legitimately has them off,
// and refusing to start would make the app impossible to work on.
function fuses() {
  try {
    // Present only in a packaged app. In development this throws or is absent,
    // which is the honest answer for a development run.
    const { app } = require('electron');
    if (!app || !app.isPackaged) return { packaged: false };
    return {
      packaged: true,
      // Electron exposes neither fuse state nor the asar hash at runtime, so
      // what is reported is what CAN be checked: that the app really is being
      // served out of an asar, which `onlyLoadAppFromAsar` is what guarantees.
      from_asar: __dirname.includes('app.asar'),
    };
  } catch (_) {
    return { packaged: false };
  }
}

// Does the running code match what the lease says was licensed?
//
// `null` means the lease predates this mechanism or the cloud did not state a
// build — treated as "no opinion" rather than as a failure, so introducing
// this does not lock out every school holding a lease issued yesterday.
function matchesLease(licence) {
  const expected = licence && licence.build;
  if (!expected) return null;
  return expected === buildId();
}

module.exports = { GUARDED, buildId, selfHash, fuses, matchesLease };
