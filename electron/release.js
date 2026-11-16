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

module.exports = { parentPortalEnabled, PARENT_PORTAL_OFF };
