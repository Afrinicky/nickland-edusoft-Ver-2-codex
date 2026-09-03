// Nickland Edusoft — Portals: which part of the system a person is handed.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The school is one database and one permission model. It is not one screen.
// A bursar opening the same home page as a class teacher and being told "no
// access" eleven times is not access control; it is a maze. So the surfaces
// are divided into PORTALS, each with its own home, its own navigation and its
// own vocabulary:
//
//   parent   — a parent, their own children, nothing else.
//   teacher  — the working day: register, marks, canteen, notes, their record.
//   finance  — money: collections, bills, arrears, expenses, payroll, online.
//   admin    — running the school: pupils, staff, oversight, approvals. This is
//              the head teacher, the management, and the proprietor; a school
//              names that person what it likes and they do the same job.
//   system   — the system itself: accounts, access, audit, settings, backups.
//              The Super Admin alone, and nobody else — see SUPER_ADMIN.
//
// A portal is a VIEW, never a right. Nothing here grants anything. Every
// portal's screens are the same modules the desktop has always enforced, and
// every request is checked against the account's permissions whatever portal
// it was sent from. What a portal decides is only what a person is shown, and
// therefore what they are told exists.
//
// Two rules follow, and both matter:
//
//   • An account sees a portal only if it could do something inside it. The
//     product's rule — what you may not open, you do not see — applies to the
//     portal itself, not just to the items within it.
//
//   • The list is computed HERE, from the resolved permission map, and then
//     projected to the cloud and sent to the app. Three implementations of
//     "may this person see Finance" would be three answers within a year.
//     cloud/src/portals.js and cloud-python/app/portals.py are translations of
//     this file and must not drift from it.

// The Super Admin: the one account with overall control of the system itself.
// It is a designation, not a permission tick, because "who may create accounts
// and rewrite everybody's access" is a decision a school makes about a person
// and not something that should follow from a box somebody ticked.
//
// Note what this is NOT. The Proprietor owns the school and is elevated over
// its money — they may reverse a payment and void a bill (see
// _security.ELEVATED) — but running the SYSTEM is the Super Admin's, and a
// proprietor who wants both is given both accounts or the Administrator
// designation. Keeping them apart is the point: the person who signs the
// cheques should not also be the person who can quietly rewrite who may see
// that they were signed.
const SUPER_ADMIN = 'Administrator';

const isSuperAdmin = (profile) => !!profile && (
  profile.is_super === true || profile.designation === SUPER_ADMIN
);

// Ranked lowest to highest. `rank` decides where an account lands when it
// signs in: the most capable portal it holds, so a head teacher does not begin
// every morning in a class teacher's screen.
const PORTALS = [
  {
    key: 'parent', label: 'Parent', rank: 0, home: '/parent',
    tagline: 'Your children',
    description: "A parent's own children: marks, conduct, reports, the register, the bill and its receipts.",
  },
  {
    key: 'teacher', label: 'Teaching', rank: 1, home: '/staff',
    tagline: 'The working day',
    description: 'The register, class work and exam marks, reports, homework, lesson notes, the canteen and your own record.',
  },
  {
    key: 'finance', label: 'Finance', rank: 2, home: '/finance',
    tagline: 'The school’s money',
    description: 'Collections and receipts, bills and arrears, income and expenses, payroll, and payments taken online.',
  },
  {
    key: 'admin', label: 'Administration', rank: 3, home: '/admin',
    tagline: 'Running the school',
    description: 'Enrolment and pupil records, staff and leave, academic oversight, approvals and notices.',
  },
  {
    key: 'system', label: 'System', rank: 4, home: '/system',
    tagline: 'The system itself',
    description: 'User accounts, access levels, the audit trail, school settings, synchronisation and backups.',
  },
];

const PORTAL_KEYS = PORTALS.map(p => p.key);
const byKey = new Map(PORTALS.map(p => [p.key, p]));

const ACTION_KEY = { view: 'canView', create: 'canCreate', edit: 'canEdit', delete: 'canDelete' };

/**
 * Does this permission map allow `action` on `module`?
 *
 * Takes the resolved map rather than a database handle so the identical
 * function serves the desktop, the LAN API, the cloud and the app. `is_admin`
 * is the same safety net the rest of the system applies: an Administrator or
 * Proprietor is never locked out of their own school by a missing row.
 */
function allows(profile, module, action = 'view') {
  if (!profile) return false;
  if (profile.is_admin) return true;
  const p = (profile.permissions || {})[module];
  return !!(p && p[ACTION_KEY[action] || 'canView']);
}

const anyOf = (profile, pairs) => pairs.some(([m, a]) => allows(profile, m, a));
const allOf = (profile, pairs) => pairs.every(([m, a]) => allows(profile, m, a));

/**
 * Which portals this account may enter.
 *
 * `profile` is { is_admin, permissions, role }. A parent gets exactly one and
 * it is never any of the staff portals — the two live in different tables and
 * a parent token cannot address a staff route at all.
 */
function portalsFor(profile) {
  if (!profile) return [];
  if (profile.role === 'parent') return ['parent'];

  const out = [];

  // The working day belongs to people who teach or who run the canteen.
  //
  // This used to be given to every member of staff, and it was wrong in a way
  // that showed the moment a bursar signed in: they were handed a register, a
  // mark sheet and a broadsheet they could open and not use. Seeing a thing
  // you may not do is the failure the whole product is written against.
  //
  // `academics: view` is teaching. `canteen: create` is the morning collection,
  // which is a cook's job and a class teacher's — and it is deliberately
  // `create` rather than `view`, because an accountant who may look at canteen
  // takings is not thereby somebody who collects them.
  if (allows(profile, 'academics', 'view') || allows(profile, 'canteen', 'create')) out.push('teacher');

  // Money, in any of its three shapes. An accountant holds fees and finance; a
  // head teacher usually holds fees alone; a class teacher holds none of them
  // and is never shown that the portal exists.
  if (anyOf(profile, [['fees', 'view'], ['finance', 'view'], ['payroll', 'view']])) out.push('finance');

  // Running the school, as opposed to teaching in it: someone who may change
  // pupil records AND see the staff register, or who may open Settings at all.
  // A subject teacher with academics passes neither test. The head teacher, the
  // management and the proprietor all land here.
  if (allOf(profile, [['staff', 'view'], ['students', 'edit']]) || allows(profile, 'settings', 'view')) {
    out.push('admin');
  }

  // The system itself: the Super Admin and nobody else.
  if (isSuperAdmin(profile)) out.push('system');

  // Somebody with no module at all — a security man, a cleaner — still has an
  // account, a payslip, a leave request and a password to change. They get the
  // working-day portal with nothing in it but their own record, rather than a
  // redirect loop between portals they may not enter.
  if (!out.length) out.push('teacher');

  return out.sort((a, b) => byKey.get(a).rank - byKey.get(b).rank);
}

/** Where this account lands when it signs in: the most capable portal it holds. */
function homePortal(profile) {
  const held = portalsFor(profile);
  if (!held.length) return null;
  // System is a destination somebody goes TO, not a place to start the morning:
  // an administrator wants the school, not the user table. Highest below it.
  const daily = held.filter(k => k !== 'system');
  const pick = (daily.length ? daily : held).reduce(
    (best, k) => (byKey.get(k).rank > byKey.get(best).rank ? k : best));
  return pick;
}

/** The full record for a portal key, for a client that wants labels. */
function portal(key) { return byKey.get(key) || null; }

/** `portalsFor`, resolved to full records — what /me sends the app. */
function portalListFor(profile) {
  return portalsFor(profile).map(k => {
    const p = byKey.get(k);
    return { key: p.key, label: p.label, home: p.home, tagline: p.tagline, rank: p.rank };
  });
}

/** May this account enter this portal? The check a route makes before its own. */
function hasPortal(profile, key) {
  return portalsFor(profile).includes(key);
}

module.exports = {
  PORTALS, PORTAL_KEYS, SUPER_ADMIN,
  allows, isSuperAdmin, portalsFor, portalListFor, homePortal, hasPortal, portal,
};
