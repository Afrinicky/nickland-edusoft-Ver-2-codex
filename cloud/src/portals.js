// Nickland Edusoft Cloud — portals.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A translation of electron/ipc/_portals.js, which is the original. The cloud
// is deployed on its own and cannot require across the repository, so the
// logic is repeated rather than shared — and because it is repeated, it is
// kept literal: same portals, same order, same tests. If one changes, both
// change, and cloud-python/app/portals.py with them.
//
// Nothing here grants anything. The cloud checks the projected permission map
// on every request exactly as it did before portals existed; this only decides
// what the app is told exists.

const PORTALS = [
  { key: 'parent',  label: 'Parent',         rank: 0, home: '/parent',  tagline: 'Your children' },
  { key: 'teacher', label: 'Teaching',       rank: 1, home: '/staff',   tagline: 'The working day' },
  { key: 'finance', label: 'Finance',        rank: 2, home: '/finance', tagline: 'The school’s money' },
  { key: 'admin',   label: 'Administration', rank: 3, home: '/admin',   tagline: 'Running the school' },
  { key: 'system',  label: 'System',         rank: 4, home: '/system',  tagline: 'The system itself' },
];

// The Super Admin: the one account with overall control of the system itself.
// A designation, not a permission tick. Not the Proprietor — they own the
// school and are elevated over its money, but running the system is a
// different job on purpose. See electron/ipc/_portals.js.
const SUPER_ADMIN = 'Administrator';
const isSuperAdmin = (profile) => !!profile && (
  profile.is_super === true || profile.designation === SUPER_ADMIN
);

const byKey = new Map(PORTALS.map(p => [p.key, p]));
const ACTION_KEY = { view: 'canView', create: 'canCreate', edit: 'canEdit', delete: 'canDelete' };

function allows(profile, module, action = 'view') {
  if (!profile) return false;
  if (profile.is_admin) return true;
  const p = (profile.permissions || {})[module];
  return !!(p && p[ACTION_KEY[action] || 'canView']);
}
const anyOf = (profile, pairs) => pairs.some(([m, a]) => allows(profile, m, a));
const allOf = (profile, pairs) => pairs.every(([m, a]) => allows(profile, m, a));

function portalsFor(profile) {
  if (!profile) return [];
  if (profile.role === 'parent') return ['parent'];
  const out = [];
  // The working day belongs to people who teach or who run the canteen — not
  // to everybody on the payroll. A bursar handed a register they may open and
  // not use is the failure the whole product is written against.
  if (allows(profile, 'academics', 'view') || allows(profile, 'canteen', 'create')) out.push('teacher');
  if (anyOf(profile, [['fees', 'view'], ['finance', 'view'], ['payroll', 'view']])) out.push('finance');
  if (allOf(profile, [['staff', 'view'], ['students', 'edit']]) || allows(profile, 'settings', 'view')) out.push('admin');
  if (isSuperAdmin(profile)) out.push('system');
  // An account with no module at all still has a payslip and a password.
  if (!out.length) out.push('teacher');
  return out.sort((a, b) => byKey.get(a).rank - byKey.get(b).rank);
}

function homePortal(profile) {
  const held = portalsFor(profile);
  if (!held.length) return null;
  const daily = held.filter(k => k !== 'system');
  return (daily.length ? daily : held).reduce((best, k) => (byKey.get(k).rank > byKey.get(best).rank ? k : best));
}

function portalListFor(profile) {
  return portalsFor(profile).map(k => {
    const p = byKey.get(k);
    return { key: p.key, label: p.label, home: p.home, tagline: p.tagline, rank: p.rank };
  });
}

const hasPortal = (profile, key) => portalsFor(profile).includes(key);

module.exports = { PORTALS, SUPER_ADMIN, allows, isSuperAdmin, portalsFor, portalListFor, homePortal, hasPortal };
