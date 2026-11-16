// Nickland Edusoft — what is switched on in this release.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The twin of cloud-python/app/release.py, and it has to stay a twin: a surface
// that is off in the cloud and on over the school Wi-Fi is not off.
//
// ── The parent/student portal is off for this release ───────────────────────
//
// Off, not deleted, and the distinction is the point:
//
//   * `parents` and `parent_students` keep every row. A school that has
//     already provisioned parent accounts loses nothing.
//   * Settings → Mobile App still provisions them, so an office can prepare
//     for the portal coming back.
//   * The projection and the sync paths are untouched.
//
// What is off is the surface. A parent cannot sign in — on the LAN, on the
// desktop host or in the cloud — and the parent routes refuse. Turning it back
// on is this flag and nothing else.
//
// Deleting the code would have been smaller and is the one thing that cannot
// be undone: a pilot school's parent accounts would have gone with it.
//
// THE TEACHERS' AND STAFF APP IS NOT AFFECTED. It ships from the same Expo
// bundle as the parents' app but from different routes, and every staff
// surface — the register, marks, the canteen collection, fees — is reached
// with a staff token, which this does not touch.

function flag(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

/** False for this release. EDUSOFT_PARENT_PORTAL=1 turns it back on. */
function parentPortalEnabled() {
  return flag('EDUSOFT_PARENT_PORTAL', false);
}

// What a refused parent surface says. Deliberately the same sentence
// everywhere, and deliberately not "disabled" or "forbidden": the person
// reading it is a parent who was told to use an app, and the useful thing to
// tell them is who to ask.
const PARENT_PORTAL_OFF =
  'The parent app is not available in this release. The school office can give you your child’s records.';

// ── A desktop no longer creates a school ────────────────────────────────────
//
// Schools are set up online by the Super Admin, who registers the school, does
// the initial configuration and hands the school's administrator their first
// credentials. The desktop then ACTIVATES against that existing setup
// (electron/licence/refresh.js → POST /api/v1/activate), which hands this
// machine its own device credential, the school's id and a signed licence.
//
// So the first-run "Create Super Admin Account" screen is gone, and the
// `auth:bootstrap` channel behind it refuses. That is the single largest
// simplification in this release, and it follows from one sentence: if every
// school was created in the cloud, a desktop never has to be able to create
// one — which removes a whole second way for a school to come into existence,
// and with it the question of what happens when the two disagree about who the
// school's administrator is.
//
// EDUSOFT_ALLOW_LOCAL_SETUP=1 re-enables it, for a support engineer recovering
// a school whose cloud record is gone.
function localSetupEnabled() {
  return flag('EDUSOFT_ALLOW_LOCAL_SETUP', false);
}

const LOCAL_SETUP_OFF =
  'This school is set up online. Open Settings → Cloud Sync and activate this ' +
  'computer with the administrator’s Edusoft email and password.';

module.exports = {
  parentPortalEnabled, PARENT_PORTAL_OFF,
  localSetupEnabled, LOCAL_SETUP_OFF,
};
