// Nickland Edusoft app — portals.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The app's copy of electron/ipc/_portals.js, which is the original (see also
// cloud/src/portals.js and cloud-python/app/portals.py). Same portals, same
// order, same answers.
//
// The server sends the list it computed in `/me`, and that is the one the app
// trusts. This exists for the moment before the reply lands, and so a screen
// can ask "does this account have the finance portal" without a round trip.
// It never widens anything: a portal the server did not send is not entered,
// and every request inside a portal is checked against the account's
// permissions regardless of which portal it was sent from.

export const PORTALS = [
  { key: 'parent',  label: 'Parent',         rank: 0, home: '/parent',  tagline: 'Your children',
    blurb: 'Marks, conduct, reports, the register and the bill — for your own children.' },
  { key: 'teacher', label: 'Teaching',       rank: 1, home: '/staff',   tagline: 'The working day',
    blurb: 'Register, class work, exam marks, reports, homework, notes, canteen.' },
  { key: 'finance', label: 'Finance',        rank: 2, home: '/finance', tagline: 'The school’s money',
    blurb: 'Collections, bills, arrears, income and expenses, payroll, online payments.' },
  { key: 'admin',   label: 'Administration', rank: 3, home: '/admin',   tagline: 'Running the school',
    blurb: 'Enrolment, pupil records, staff and leave, oversight, approvals, notices.' },
  { key: 'system',  label: 'System',         rank: 4, home: '/system',  tagline: 'The system itself',
    blurb: 'Accounts, access levels, the audit trail, settings, sync and backups.' },
];

// The Super Admin: the one account with overall control of the system itself.
// A designation, not a permission tick — and not the Proprietor, who owns the
// school and is elevated over its money but does not run the system.
// Renamed from "Administrator" in v2.1: every school has administrators, and
// naming the one account with total authority the same thing made a user list
// unreadable. The old name is still accepted, everywhere and always — a host a
// release behind still sends it.
export const SUPER_ADMIN = 'Super Admin';
export const SUPER_ADMIN_LEGACY = 'Administrator';

const normaliseRole = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, '');
const SUPER_NAMES = new Set([SUPER_ADMIN, SUPER_ADMIN_LEGACY].map(normaliseRole));
export const isSuperAdminName = (name) => SUPER_NAMES.has(normaliseRole(name));

export const isSuperAdmin = (profile) => !!profile && (
  profile.is_super === true || isSuperAdminName(profile.designation)
);

const BY_KEY = new Map(PORTALS.map(p => [p.key, p]));
export const portalMeta = (key) => BY_KEY.get(key) || null;

const ACTION_KEY = { view: 'canView', create: 'canCreate', edit: 'canEdit', delete: 'canDelete' };

export function allows(profile, module, action = 'view') {
  if (!profile) return false;
  if (profile.is_admin) return true;
  const p = (profile.permissions || {})[module];
  return !!(p && p[ACTION_KEY[action] || 'canView']);
}
const anyOf = (profile, pairs) => pairs.some(([m, a]) => allows(profile, m, a));
const allOf = (profile, pairs) => pairs.every(([m, a]) => allows(profile, m, a));

function derive(profile) {
  if (!profile) return [];
  if (profile.role === 'parent') return ['parent'];
  const out = [];
  // Teaching, or the canteen collection. Not everybody on the payroll: a
  // bursar handed a register they may open and not use is exactly the thing
  // the product's rule exists to prevent.
  if (allows(profile, 'academics', 'view') || allows(profile, 'canteen', 'create')) out.push('teacher');
  if (anyOf(profile, [['fees', 'view'], ['finance', 'view'], ['payroll', 'view']])) out.push('finance');
  if (allOf(profile, [['staff', 'view'], ['students', 'edit']]) || allows(profile, 'settings', 'view')) out.push('admin');
  if (isSuperAdmin(profile)) out.push('system');
  // An account with no module at all still has a payslip and a password.
  if (!out.length) out.push('teacher');
  return out.sort((a, b) => BY_KEY.get(a).rank - BY_KEY.get(b).rank);
}

/**
 * The portals this account holds.
 *
 * The server's answer wins where there is one — it was computed against the
 * live account, and this copy could be a build behind. Deriving locally is the
 * fallback for a host that has not been updated yet, and it can only ever
 * agree with or be narrower than what the server will then enforce.
 */
export function portalsFor(profile) {
  const sent = profile && profile.portals;
  if (Array.isArray(sent) && sent.length) {
    return sent.map(p => (typeof p === 'string' ? p : p && p.key)).filter(Boolean);
  }
  return derive(profile);
}

export function hasPortal(profile, key) {
  return portalsFor(profile).includes(key);
}

/** Where this account belongs when it signs in, or lands somewhere it may not be. */
export function homePortal(profile) {
  const held = portalsFor(profile);
  if (!held.length) return null;
  const daily = held.filter(k => k !== 'system');
  return (daily.length ? daily : held).reduce((best, k) =>
    ((BY_KEY.get(k)?.rank ?? -1) > (BY_KEY.get(best)?.rank ?? -1) ? k : best));
}

export function homeHref(profile) {
  const key = homePortal(profile);
  return (BY_KEY.get(key) || {}).home || '/staff';
}

/** The switcher's contents: every portal held, in rank order, with its label. */
export function portalChoices(profile) {
  return portalsFor(profile).map(k => BY_KEY.get(k)).filter(Boolean);
}
