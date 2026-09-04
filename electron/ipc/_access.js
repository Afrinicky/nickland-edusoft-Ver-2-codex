// Nickland Edusoft — Access model.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The permission tables store four independent booleans per (role/user, module):
// can_view / can_create / can_edit / can_delete. That is precise but unreadable
// to a school owner — "does an Accountant need create AND edit AND delete on
// finance?" is not a question anyone should have to answer with four ticks.
//
// So the whole system is presented as ONE ladder of access levels that build on
// each other, exactly like SECH_LIMS:
//
//   No access → View → Contribute → Manage → Full
//
// The ladder maps onto the existing four booleans, so nothing about enforcement
// (electron/ipc/_security.js → checkPermission) changes: a level is just a
// friendlier name for a canonical combination of the same flags. Reads tolerate
// any legacy combination by reducing it to the highest *contiguous* level, which
// never over-reports access.

// The ladder, lowest to highest. `order` drives the reduce below and the UI.
const LEVELS = [
  { key: 'no',         order: 0, label: 'No access',   short: 'None',
    description: 'Hidden entirely — the module does not appear for this person.' },
  { key: 'view',       order: 1, label: 'View',        short: 'View',
    description: 'Can open and read, but not change anything.' },
  { key: 'contribute', order: 2, label: 'Contribute',  short: 'Add',
    description: 'View, plus add new entries (record a payment, enter marks).' },
  { key: 'manage',     order: 3, label: 'Manage',      short: 'Edit',
    description: 'Contribute, plus edit or correct existing entries.' },
  { key: 'full',       order: 4, label: 'Full',        short: 'Full',
    description: 'Manage, plus delete — full control of the module.' },
];

const LEVEL_KEYS = LEVELS.map(l => l.key);

// The modules the app is divided into, with the plain-language description and a
// grouping the UI can lay out by. `sensitive` marks the modules that move money
// or govern the system itself — surfaced so an owner grants them deliberately.
const MODULES = [
  { key: 'dashboard',     label: 'Dashboard',            group: 'Overview',
    description: 'Home dashboard, summaries and charts.' },
  { key: 'students',      label: 'Students',             group: 'Academics',
    description: 'Student records, admissions and profiles.' },
  { key: 'academics',     label: 'Academics',            group: 'Academics',
    description: 'Scores, report cards, attendance, homework and the timetable.' },
  { key: 'canteen',       label: 'Canteen',              group: 'Money',
    description: 'Daily canteen collection and canteen debtors.' },
  { key: 'fees',          label: 'Fees & Bills',         group: 'Money', sensitive: true,
    description: 'Bills, fee payments, templates and debtors.' },
  { key: 'payroll',       label: 'Payroll',              group: 'Money', sensitive: true,
    description: 'Staff salaries, SSNIT/PAYE and payslips.' },
  { key: 'finance',       label: 'Finance & Inventory',  group: 'Money', sensitive: true,
    description: 'Income, expenses, transport, inventory and the finance audit.' },
  { key: 'staff',         label: 'Staff / HR',           group: 'People',
    description: 'Staff records, attendance and HR.' },
  { key: 'notifications', label: 'Notifications',        group: 'People',
    description: 'SMS and email to parents and staff.' },
  { key: 'settings',      label: 'Settings & Users',     group: 'System', sensitive: true,
    description: 'School setup, user accounts and this access-control screen.' },
];

const MODULE_KEYS = MODULES.map(m => m.key);

// Designations that are always granted everything, regardless of stored rows.
// Mirrors the safety net in resolveEffectivePermissions and _security.isElevated
// — surfaced here so the UI can show them as locked "Full" rather than editable.
const { ELEVATED_NAMES } = require('./_portals');
const ALWAYS_FULL = ELEVATED_NAMES;

// level → the four canonical booleans.
function levelToPerms(level) {
  const o = (LEVELS.find(l => l.key === level) || LEVELS[0]).order;
  return {
    can_view:   o >= 1 ? 1 : 0,
    can_create: o >= 2 ? 1 : 0,
    can_edit:   o >= 3 ? 1 : 0,
    can_delete: o >= 4 ? 1 : 0,
  };
}

// four booleans → the highest CONTIGUOUS level. A non-ladder combination (e.g.
// view+delete but not create/edit, which the old checkbox UI allowed) reduces to
// the last level whose every rung is present, so access is never over-reported.
function permsToLevel(p) {
  if (!p || !p.can_view) return 'no';
  if (!p.can_create) return 'view';
  if (!p.can_edit) return 'contribute';
  if (!p.can_delete) return 'manage';
  return 'full';
}

// How many modules a level-map grants at all (level !== 'no'). For the "41 of 98
// areas granted" style summary on the role card.
function grantedCount(levelMap) {
  return MODULE_KEYS.reduce((n, m) => n + ((levelMap[m] && levelMap[m] !== 'no') ? 1 : 0), 0);
}

function isValidLevel(level) { return LEVEL_KEYS.includes(level); }

module.exports = {
  LEVELS, LEVEL_KEYS, MODULES, MODULE_KEYS, ALWAYS_FULL,
  levelToPerms, permsToLevel, grantedCount, isValidLevel,
};
