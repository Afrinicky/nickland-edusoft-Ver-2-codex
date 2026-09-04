// Nickland Edusoft — who runs the school, by name.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The renderer's copy of the answer electron/ipc/_portals.js gives. That file
// is the enforcement; this exists so a screen can decide whether to DRAW a
// control without a round trip, and it can only ever agree with it.
//
// ── The name ────────────────────────────────────────────────────────────────
//
// The top designation was called "Administrator" for the first two releases,
// and it was the wrong word. Every school has administrators — the secretary
// who keeps the roll, the bursar's assistant — so a user list could not be read
// to find out who actually ran the system. It is "Super Admin" now, here, on
// the phone and in the browser.
//
// The old name is still ACCEPTED, everywhere, and always will be: a database
// restored from a backup taken before the upgrade still carries it, and a
// designation is not worth locking a head teacher out of their own school over.

export const SUPER_ADMIN = 'Super Admin';
export const SUPER_ADMIN_LEGACY = 'Administrator';

// Case- and space-insensitive: a school that typed "superadmin" into the
// designation field by hand meant this, and a missing space is not a rule
// anybody would defend out loud.
const normalise = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, '');
const SUPER_NAMES = new Set([SUPER_ADMIN, SUPER_ADMIN_LEGACY].map(normalise));

export const isSuperAdmin = (designation) => SUPER_NAMES.has(normalise(designation));

/** The Proprietor and the Super Admin: held back nowhere. */
export const isElevated = (designation) =>
  designation === 'Proprietor' || isSuperAdmin(designation);

/** Those two plus the Head Teacher, who supervises but does not run the system. */
export const isSupervisor = (designation) =>
  isElevated(designation) || designation === 'Head Teacher';

export const ELEVATED_NAMES = ['Proprietor', SUPER_ADMIN, SUPER_ADMIN_LEGACY];

export default { SUPER_ADMIN, SUPER_ADMIN_LEGACY, ELEVATED_NAMES, isSuperAdmin, isElevated, isSupervisor };
