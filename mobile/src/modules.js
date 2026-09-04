// Nickland Edusoft — what the app is made of.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// ONE list of modules, in the desktop installer's order, read by the desktop
// browser's sidebar, the tablet rail, the phone's bottom bar and its drawer.
// Four navigations that disagree is four bugs.
//
// ── Why this replaced the portals ───────────────────────────────────────────
//
// The app used to be four areas — Teaching, Finance, Administration, System —
// with a chip strip for moving between them. That grouping is real: it is how
// the server decides what an account may reach, and it still exists in
// src/portals.js, which the server computes and the app trusts.
//
// But it was never the school's own vocabulary. A head teacher who both teaches
// and keeps the books does not think "I am switching portals"; they think "I am
// opening Fees". Worse, the strip ADVERTISED the shape of the access system to
// people who had been handed one part of it, which is the opposite of the rule
// this product is built on.
//
// So the areas are gone from the front of the app. What is left is the same
// list of modules the desktop has always shown down the left-hand side, and the
// system works out on its own which of them this account holds. A teacher opens
// the app and sees Students, Academics and Canteen. A bursar sees Fees, Finance
// and Payroll. Neither is told the other exists, and neither is asked which
// kind of person they are.
//
// ── The rule ───────────────────────────────────────────────────────────────
//
// `module` is the permission module the server checks — the same ten keys as
// electron/ipc/_access.js and cloud-python/app/school/access.py. What an
// account cannot open, it does not see: a menu item leading to "access denied"
// advertises a part of the school's system to somebody who has been told they
// may not have it.
//
// `tabs` are the sections inside a module, in the desktop's order and with the
// desktop's labels, so somebody who learns one has learned the other. A tab can
// carry its own `need` (an action stronger than view), its own `module` (the
// canteen configuration is a canteen concern, not a settings one), a `feature`
// flag, `elevated: true` for the Proprietor and the Super Admin, or
// `super: true` for the Super Admin alone.

// ── The action a permission level is checked against ────────────────────────
const ACTION_KEY = { view: 'canView', create: 'canCreate', edit: 'canEdit', delete: 'canDelete' };

/**
 * May this account take `action` on `module`?
 *
 * The same answer the server gives, computed from the permission map it sent.
 * `is_admin` is the Proprietor and the Super Admin, who are held back nowhere —
 * checked before the map, so a permission set that came back empty cannot hide
 * the app from the person who owns it.
 */
export function allows(profile, module, action = 'view') {
  if (!profile) return false;
  if (profile.is_admin) return true;
  const p = (profile.permissions || {})[module];
  return !!(p && p[ACTION_KEY[action] || 'canView']);
}

/**
 * Elevated: the Proprietor and the Super Admin.
 *
 * The two designations held back nowhere, and the ones the server means by
 * `is_admin`. It is over and above a module: a bursar with Fees at Full may
 * take money and may not forgive it, withdraw a bill, or raise a new charge
 * against every family in the school.
 */
export function isElevated(profile) {
  return !!profile && (profile.is_admin === true || isSuperAdmin(profile));
}

/** The Super Admin: the one account with overall authority over the system. */
export function isSuperAdmin(profile) {
  if (!profile) return false;
  if (profile.is_super === true) return true;
  const d = String(profile.designation || '').trim().toLowerCase();
  return d === 'super admin' || d === 'superadmin' || d === 'administrator';
}

// ── the modules ─────────────────────────────────────────────────────────────
//
// Order, labels and blurbs are the desktop's. `short` is what fits in a 60px
// cell at the bottom of a phone; `sub` is the line under the name on the Home
// grid, which is the desktop's own wording.

export const MODULES = [
  {
    key: 'home', href: '/app', label: 'Home', short: 'Home', icon: 'home',
    sub: 'Everything you can open',
    always: true, home: false,
  },
  {
    key: 'dashboard', href: '/app/dashboard', label: 'Dashboard', short: 'Summary', icon: 'grid',
    sub: 'View summary & key statistics',
    module: 'dashboard',
  },
  {
    key: 'students', href: '/app/students', label: 'Students', short: 'Pupils', icon: 'users',
    sub: 'Manage student records',
    module: 'students', match: ['/app/students'],
    tabs: [
      { id: 'dashboard',  label: 'Dashboard' },
      { id: 'roll',       label: 'All Students' },
      { id: 'register',   label: 'Attendance Register' },
      { id: 'status',     label: 'Students Status' },
      { id: 'admissions', label: 'Students Admissions', need: 'create' },
      { id: 'sheet',      label: 'Students Sheet',      need: 'edit' },
    ],
  },
  {
    key: 'academics', href: '/app/academics', label: 'Academics', short: 'Academics', icon: 'cap',
    sub: 'Examinations, Scores and Reports',
    module: 'academics', match: ['/app/academics'],
    tabs: [
      { id: 'dashboard',   label: 'Academic Dashboard' },
      { id: 'profile',     label: 'Student Academic Profile' },
      { id: 'timetable',   label: 'Timetable' },
      { id: 'homework',    label: 'Homework' },
      { id: 'classscores', label: 'Class Scores' },
      { id: 'examscores',  label: 'Exam Scores' },
      { id: 'insight',     label: 'Class Insight' },
      { id: 'results',     label: 'End of Term Results' },
      { id: 'compilation', label: 'Assessment Compilation', need: 'edit' },
      { id: 'report',      label: 'End of Term Report' },
      { id: 'examinations',label: 'Examinations',           need: 'edit' },
    ],
  },
  {
    key: 'fees', href: '/app/fees', label: 'Fees Management', short: 'Fees', icon: 'wallet',
    sub: 'Fees, payments & arrears',
    module: 'fees', match: ['/app/fees'],
    tabs: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'bills',     label: 'Bills' },
      { id: 'templates', label: 'Fee Templates',  need: 'edit' },
      { id: 'payments',  label: 'Payments' },
      { id: 'bulk',      label: 'Bulk Pay Sheet', need: 'create' },
      { id: 'supplementary', label: 'Extra Charges', need: 'edit', elevated: true },
      { id: 'discounts', label: 'Discounts' },
      { id: 'books',     label: 'Books' },
      { id: 'online',    label: 'Online Payments' },
      { id: 'debtors',   label: 'Debtors' },
      { id: 'voided',    label: 'Withdrawn Bills', need: 'edit', elevated: true },
    ],
  },
  {
    key: 'canteen', href: '/app/canteen', label: 'Canteen', short: 'Canteen', icon: 'bowl',
    sub: 'Canteen fees & payments',
    module: 'canteen', feature: 'feature_canteen_enabled', match: ['/app/canteen'],
    tabs: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'sheet',     label: 'Canteen Sheet' },
      { id: 'quickpay',  label: 'Quick Pay (single day)', need: 'create' },
      { id: 'calendar',  label: 'Calendar', module: 'settings' },
      { id: 'debtors',   label: 'Debtors' },
    ],
  },
  {
    key: 'transport', href: '/app/transport', label: 'Transport', short: 'Transport', icon: 'bus',
    sub: 'Routes, riders & transport fees',
    // The desktop puts transport behind the finance module, not one of its own.
    module: 'finance', feature: 'feature_transport_enabled', match: ['/app/transport'],
    tabs: [
      { id: 'routes',   label: 'Routes' },
      { id: 'riders',   label: 'Riders' },
      { id: 'payments', label: 'Payments', need: 'create' },
    ],
  },
  {
    key: 'staff', href: '/app/staff', label: 'Staff Management', short: 'Staff', icon: 'badge',
    sub: 'Manage staff information',
    module: 'staff', match: ['/app/staff'],
    tabs: [
      { id: 'dashboard',   label: 'Dashboard' },
      { id: 'roll',        label: 'All Staff' },
      { id: 'status',      label: 'Staff Status' },
      { id: 'lessonnotes', label: 'Lesson Notes' },
      { id: 'activities',  label: 'Activities' },
      { id: 'attendance',  label: 'Attendance', feature: 'staff_clockin_enabled' },
      { id: 'leave',       label: 'Leave Management', feature: 'feature_leave_management_enabled' },
    ],
  },
  {
    key: 'payroll', href: '/app/payroll', label: 'Payroll', short: 'Payroll', icon: 'payroll',
    sub: 'Manage staff salaries and payroll',
    module: 'payroll', match: ['/app/payroll'],
    tabs: [
      { id: 'run',      label: 'Payroll Run' },
      { id: 'ssnit',    label: 'SSNIT Schedule' },
      { id: 'paye',     label: 'PAYE Schedule' },
      { id: 'payslips', label: 'Payslips' },
    ],
  },
  {
    key: 'finance', href: '/app/finance', label: 'Finance', short: 'Finance', icon: 'chart',
    sub: 'Income, expenses & finance reports',
    module: 'finance', match: ['/app/finance'],
    tabs: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'income',    label: 'Income' },
      { id: 'expenses',  label: 'Expenses & Reports' },
      { id: 'balancing', label: 'Cashbook' },
      { id: 'statement', label: 'Financial Statement' },
      { id: 'audit',     label: 'Audit & Tracker' },
      { id: 'budgets',   label: 'Budgets' },
      { id: 'workbook',  label: 'Workbook' },
    ],
  },
  {
    key: 'inventory', href: '/app/inventory', label: 'Purchasing & Inventory', short: 'Stock', icon: 'box',
    sub: 'Items, stock, purchase tracking',
    module: 'finance', match: ['/app/inventory'],
    tabs: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'items',     label: 'Items' },
      { id: 'movements', label: 'Movements' },
    ],
  },
  {
    key: 'notifications', href: '/app/notifications', label: 'Notifications', short: 'Notices', icon: 'bell',
    sub: 'Send SMS & notifications',
    module: 'notifications', feature: 'feature_notifications_enabled', match: ['/app/notifications'],
    tabs: [
      { id: 'compose', label: 'Send a Notice', need: 'create' },
      { id: 'notices', label: 'Notices' },
      { id: 'history', label: 'History' },
    ],
  },
  {
    key: 'messages', href: '/app/messages', label: 'Messages', short: 'Messages', icon: 'chat',
    sub: 'Conversations with parents and staff',
    module: 'notifications', match: ['/app/messages'],
  },
  {
    key: 'settings', href: '/app/settings', label: 'Settings', short: 'Settings', icon: 'gear',
    sub: 'Configure school preferences',
    module: 'settings', match: ['/app/settings'],
    tabs: [
      { id: 'school',      label: 'School Identity',     group: 'School' },
      { id: 'branding',    label: 'Appearance',          group: 'School' },
      { id: 'terms',       label: 'Terms',               group: 'Academic' },
      { id: 'classes',     label: 'Classes',             group: 'Academic' },
      { id: 'subjects',    label: 'Subjects',            group: 'Academic' },
      { id: 'grading',     label: 'Grading',             group: 'Academic' },
      { id: 'canteen',     label: 'Canteen',             group: 'Finance & Operations', module: 'canteen' },
      { id: 'payroll',     label: 'Payroll',             group: 'Finance & Operations', module: 'payroll' },
      { id: 'payments',    label: 'Online Payments',     group: 'Finance & Operations', module: 'fees' },
      { id: 'notify',      label: 'Notifications',       group: 'Communications', module: 'notifications' },
      { id: 'users',       label: 'Users & Logins',      group: 'Users & Access' },
      { id: 'access',      label: 'Roles & Access',      group: 'Users & Access' },
      { id: 'features',    label: 'Advanced Features',   group: 'Users & Access' },
      { id: 'audit',       label: 'Audit Trail',         group: 'System', super: true },
    ],
  },
];

// A person's own record — a payslip, a clock-in, a password — belongs to
// nobody's module. Every account has one, including a cook granted nothing at
// all, and before this it lived inside the teaching area, so an account that
// could not enter that area could not reach its own employment record.
export const PERSONAL = [
  { key: 'me',      href: '/app/me',      label: 'My work', short: 'Me',      icon: 'badge', always: true, personal: true,
    sub: 'Your timetable, attendance and payslips' },
  { key: 'account', href: '/app/account', label: 'Account', short: 'Account', icon: 'gear',  always: true, personal: true,
    sub: 'Your password and this device' },
];

export const ALL_ITEMS = [...MODULES, ...PERSONAL];

const BY_KEY = new Map(ALL_ITEMS.map(m => [m.key, m]));
export const moduleByKey = (key) => BY_KEY.get(key) || null;

// ── feature flags ───────────────────────────────────────────────────────────
//
// The desktop hides the canteen and the notification sender outright when a
// school has turned them off. The server sends the same flags in `/me`; a flag
// it did not send is ON, because a school that has never touched the switch has
// the feature.
export function featureOn(features, name) {
  if (!name) return true;
  const v = (features || {})[name];
  // Clocking in is the one switch that is OFF until a school turns it on: the
  // desktop shows the tab only when `staff_clockin_enabled` is literally
  // 'true', because a register of arrival times nobody asked for is a
  // surveillance feature that appeared by itself.
  if (name === 'staff_clockin_enabled') return v === true || v === 'true' || v === 1 || v === '1';
  if (v === undefined || v === null || v === '') return true;
  return !(v === false || v === 'false' || v === 0 || v === '0');
}

/**
 * The modules this account can open, in the desktop's order.
 *
 * Home and the personal pair are `always`: an account granted no module at all
 * still has somewhere to be and still has its own record. Everything else is
 * the permission the server will check anyway.
 */
export function visibleModules(profile, features = {}) {
  return ALL_ITEMS.filter((m) => {
    if (!featureOn(features, m.feature)) return false;
    if (m.always) return true;
    if (m.super) return isSuperAdmin(profile);
    return allows(profile, m.module, m.need || 'view');
  });
}

/** The tabs of one module this account can open, in the desktop's order. */
export function visibleTabs(mod, profile, features = {}) {
  if (!mod || !mod.tabs) return [];
  return mod.tabs.filter((t) => {
    if (!featureOn(features, t.feature)) return false;
    if (t.super && !isSuperAdmin(profile)) return false;
    if (t.elevated && !isElevated(profile)) return false;
    return allows(profile, t.module || mod.module, t.need || 'view');
  });
}

/** The first tab of a module this account may actually open. */
export function firstTab(mod, profile, features = {}) {
  const tabs = visibleTabs(mod, profile, features);
  return tabs.length ? tabs[0].id : null;
}

/**
 * Which navigation entry the current path belongs to.
 *
 * The longest match wins, so /app/students/12 lights up Students rather than
 * nothing, and /app on its own does not light up every route beneath it.
 */
export function activeModule(items, pathname) {
  const path = pathname || '';
  let best = null; let bestLen = -1;
  for (const m of items) {
    const prefixes = m.match || (m.href === '/app' ? [] : [m.href]);
    const hit = path === m.href || prefixes.some(p => path === p || path.startsWith(p + '/'));
    if (!hit) continue;
    const len = Math.max(m.href.length, ...prefixes.map(p => p.length), 0);
    if (len > bestLen) { best = m; bestLen = len; }
  }
  return best || null;
}

// ── where an account lands ──────────────────────────────────────────────────
//
// Home, always. The desktop opens on its card grid whoever signs in, and a card
// grid of the four things you can do is a better first screen than a dashboard
// full of figures you may not be allowed to see. A parent is the exception:
// they are not a member of staff and have their own app inside this one.
export function landingHref(profile) {
  if (profile && profile.role === 'parent') return '/parent';
  return '/app';
}

// ── the phone's bottom bar ──────────────────────────────────────────────────
//
// Four cells and the action button between them, chosen from what this account
// actually holds rather than fixed: a bursar's bar is Home, Fees, +, Finance,
// Me and a teacher's is Home, Students, +, Academics, Me, without either being
// told that the other exists.
//
// Home and Me are the anchors. The two in the middle are this account's WORK:
// the first two modules it can actually change something in, in the desktop's
// order, falling back to read-only ones for an account that only watches. A bar
// of Home, Dashboard, Students, Me is four ways of saying "look at things"; a
// bursar's bar should have Fees on it and a teacher's Academics.
export function bottomBar(items, profile) {
  const has = (k) => items.some(i => i.key === k);
  const candidates = items.filter(m => !m.always && !m.personal
    && m.key !== 'home' && m.key !== 'dashboard' && m.key !== 'settings');
  // Within "can change something", the daily modules come before the periodic
  // ones: a bursar takes payments every morning and looks at the transport
  // register once a term, so Fees earns the cell and Transport does not.
  const DAILY = ['academics', 'fees', 'students', 'canteen', 'finance', 'staff',
                 'messages', 'notifications', 'payroll', 'inventory', 'transport'];
  const rank = (m) => {
    const i = DAILY.indexOf(m.key);
    return (allows(profile, m.module, 'create') ? 0 : 100) + (i < 0 ? 50 : i);
  };
  const middle = [...candidates].sort((a, b) => rank(a) - rank(b)).slice(0, 2)
    .sort((a, b) => ALL_ITEMS.indexOf(a) - ALL_ITEMS.indexOf(b));
  const bar = [];
  if (has('home')) bar.push('home');
  if (middle[0]) bar.push(middle[0].key);
  bar.push('action');
  if (middle[1]) bar.push(middle[1].key);
  if (has('me')) bar.push('me');
  return bar;
}

// ── the quick-action button ─────────────────────────────────────────────────
//
// Not destinations — the jobs of a school day. Each names a module and a tab,
// so an action cannot outlive the screen behind it, and an account that may not
// open a screen is never offered the shortcut to it.
export const QUICK_ACTIONS = [
  { key: 'register',  module: 'students',  tab: 'register',   need: 'edit',
    label: 'Take the register',        hint: "Mark today's class" },
  { key: 'marks',     module: 'academics', tab: 'examscores', need: 'create',
    label: 'Enter exam marks',         hint: 'A class and a subject' },
  { key: 'classwork', module: 'academics', tab: 'classscores',need: 'create',
    label: 'Enter class work',         hint: 'Assignments, tests and quizzes' },
  { key: 'collect',   module: 'canteen',   tab: 'quickpay',   need: 'create',
    label: 'Collect canteen money',    hint: "The morning's daily collection" },
  { key: 'payment',   module: 'fees',      tab: 'payments',   need: 'create',
    label: 'Take a fee payment',       hint: 'Against a pupil’s bill, receipted' },
  { key: 'bill',      module: 'fees',      tab: 'bills',      need: 'create',
    label: 'Generate bills',           hint: 'A whole class, from a template' },
  { key: 'admit',     module: 'students',  tab: 'admissions', need: 'create',
    label: 'Admit a pupil',            hint: 'A name, a class, and a number is issued' },
  { key: 'expense',   module: 'finance',   tab: 'expenses',   need: 'create',
    label: 'Record an expense',        hint: 'Somebody else approves it' },
  { key: 'homework',  module: 'academics', tab: 'homework',   need: 'create',
    label: 'Set homework',             hint: 'For one of your classes' },
  { key: 'notice',    module: 'notifications', tab: 'compose', need: 'create',
    label: 'Post a notice',            hint: 'Every parent and every teacher sees it' },
];

/** The quick actions this account can actually reach, in declaration order. */
export function quickActions(profile, features = {}) {
  const open = new Set(visibleModules(profile, features).map(m => m.key));
  return QUICK_ACTIONS
    .filter(a => open.has(a.module) && allows(profile, moduleByKey(a.module).module, a.need))
    .map(a => ({ ...a, href: `${moduleByKey(a.module).href}?tab=${a.tab}`,
                 icon: moduleByKey(a.module).icon }));
}

// ── grouping, for the drawer and the rail ───────────────────────────────────
//
// The desktop sidebar is one flat list and this matches it, but a phone drawer
// of fifteen undifferentiated rows is a wall. These are the school's own words
// for what the parts of it are, and the order never changes with permissions,
// so two teachers with different access still see the same headings in the same
// places.
const GROUPS = [
  { title: 'Overview', keys: ['home', 'dashboard'] },
  { title: 'The school', keys: ['students', 'academics'] },
  { title: 'Money', keys: ['fees', 'canteen', 'transport', 'finance', 'inventory'] },
  { title: 'People', keys: ['staff', 'payroll'] },
  { title: 'Talking', keys: ['notifications', 'messages'] },
  { title: 'You', keys: ['me', 'account', 'settings'] },
];

export function groupModules(items) {
  const byKey = new Map(items.map(i => [i.key, i]));
  const out = [];
  for (const g of GROUPS) {
    const found = g.keys.map(k => byKey.get(k)).filter(Boolean);
    if (found.length) out.push({ group: g.title, items: found });
  }
  // Anything not named above still has to appear somewhere.
  const placed = new Set(out.flatMap(g => g.items.map(i => i.key)));
  const rest = items.filter(i => !placed.has(i.key));
  if (rest.length) out.push({ group: 'More', items: rest });
  return out;
}

export default {
  MODULES, PERSONAL, ALL_ITEMS, QUICK_ACTIONS,
  allows, isSuperAdmin, isElevated, featureOn,
  visibleModules, visibleTabs, firstTab, activeModule,
  landingHref, bottomBar, quickActions, groupModules, moduleByKey,
};
