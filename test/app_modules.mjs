// Nickland Edusoft — what the app draws, and for whom.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/app_modules.mjs
//
// The server refuses whatever the app draws, so this is not the security. It is
// the other half of the product's rule: what you may not open, you do not SEE.
// A menu item leading to a refusal advertises a part of the school's system to
// somebody who has been told they may not have it.
//
// So every check here is about ABSENCE — that a class teacher's app has no
// Payroll in it, that a bursar is never shown the register, that a cook is not
// offered lesson notes, that the audit trail exists for one account in the
// school. It runs the app's own module list, which is the one the screens
// import, so it cannot pass while the app disagrees with it.
//
// It replaced test/app_portals.mjs, which tested a front end that no longer
// exists: the four areas and the chip strip for moving between them are gone,
// and the app is the desktop's own list of modules with the system working out
// which of them an account holds.

import {
  MODULES, ALL_ITEMS, QUICK_ACTIONS,
  allows, isSuperAdmin, featureOn, visibleModules, visibleTabs, firstTab,
  activeModule, landingHref, bottomBar, quickActions, groupModules, moduleByKey,
} from '../mobile/src/modules.js';
import { PORTAL_NAV, visibleNav } from '../mobile/src/nav.js';

let pass = 0, fail = 0;
const ck = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? '✓' : '✗') + ' ' + name); };

const lvl = (n) => ({ canView: n >= 1, canCreate: n >= 2, canEdit: n >= 3, canDelete: n >= 3 });
const staff = (designation, permissions, extra = {}) =>
  ({ role: 'staff', designation, permissions, ...extra });

// The people a Ghanaian basic school actually has, with the access it actually
// gives them.
const teacher = staff('Class Teacher', {
  dashboard: lvl(1), students: lvl(3), academics: lvl(3), canteen: lvl(3) });
const bursar = staff('Accountant', {
  dashboard: lvl(1), students: lvl(1), fees: lvl(3), finance: lvl(3), payroll: lvl(1), canteen: lvl(1) });
const head = staff('Head Teacher', {
  dashboard: lvl(3), students: lvl(3), academics: lvl(3), fees: lvl(1), canteen: lvl(3),
  staff: lvl(3), notifications: lvl(3) });
const proprietor = staff('Proprietor', {}, { is_admin: true });
const superAdmin = staff('Super Admin', {}, { is_admin: true, is_super: true });
const legacyAdmin = staff('Administrator', {}, { is_admin: true });
const cook = staff('Cook', { canteen: lvl(3) });
const guard = staff('Security', {});

const keys = (who, features) => visibleModules(who, features).map(m => m.key);
const labels = (who, features) => visibleModules(who, features).map(m => m.label);

// ── the list itself ─────────────────────────────────────────────────────────
ck('the modules are the installed application\'s, in its order',
  JSON.stringify(MODULES.map(m => m.label)) === JSON.stringify([
    'Home', 'Dashboard', 'Students', 'Academics', 'Fees Management', 'Canteen',
    'Transport', 'Staff Management', 'Payroll', 'Finance', 'Purchasing & Inventory',
    'Notifications', 'Messages', 'Settings']));
ck('every module has somewhere to go, an icon and a line describing it',
  ALL_ITEMS.every(m => m.href && m.icon && m.label && m.short && m.sub));
ck('every module names a permission module, or is one everybody has',
  ALL_ITEMS.every(m => m.always || m.module));
ck('every tab of every module names a section of a real screen',
  MODULES.every(m => !m.tabs || m.tabs.every(t => t.id && t.label)));

// ── who is shown what ───────────────────────────────────────────────────────
const t = keys(teacher);
ck('a class teacher is given the school as they meet it',
  t.includes('students') && t.includes('academics') && t.includes('canteen'));
ck('...and is NOT shown the money', !t.includes('fees') && !t.includes('finance'));
ck('...nor payroll', !t.includes('payroll'));
ck('...nor the staff room', !t.includes('staff'));
ck('...nor settings', !t.includes('settings'));
ck('...and still has their own record and a password',
  t.includes('me') && t.includes('account'));

const b = keys(bursar);
ck('a bursar is given the money', b.includes('fees') && b.includes('finance') && b.includes('payroll'));
ck('...and the store room, which the desktop keeps under finance', b.includes('inventory'));
ck('...and the pupils, because a payment is taken against a child',
  b.includes('students'));
ck('...but not academics', !b.includes('academics'));
ck('...and not settings', !b.includes('settings'));

ck('a cook is given the canteen and nothing else of the school',
  keys(cook).filter(k => !['home', 'me', 'account'].includes(k)).join() === 'canteen');
ck('an account granted nothing still has somewhere to be and its own record',
  keys(guard).join() === 'home,me,account');

ck('the head teacher runs the school without being handed the system',
  keys(head).includes('staff') && !keys(head).includes('settings'));
ck('the proprietor is held back nowhere', keys(proprietor).length === ALL_ITEMS.length);
ck('...and neither is the Super Admin', keys(superAdmin).length === ALL_ITEMS.length);

// ── the Super Admin, by whichever name the database calls them ──────────────
ck('the Super Admin is recognised', isSuperAdmin(superAdmin));
ck('...under the name the system used to use', isSuperAdmin(legacyAdmin));
ck('...however it was typed', isSuperAdmin(staff('superadmin', {})));
ck('a head teacher is not the Super Admin', !isSuperAdmin(head));
ck('and neither is the proprietor, who owns the school but does not run its system',
  !isSuperAdmin(proprietor));

// ── the tabs inside a module ────────────────────────────────────────────────
const students = moduleByKey('students');
const tabsFor = (mod, who, f) => visibleTabs(mod, who, f).map(x => x.id);
ck('a teacher who may correct a record gets the students sheet',
  tabsFor(students, teacher).includes('sheet'));
ck('...and a bursar who may only look does not',
  !tabsFor(students, bursar).includes('sheet'));
ck('...nor the admissions form', !tabsFor(students, bursar).includes('admissions'));
ck('a module opens on the first tab its holder may actually open',
  firstTab(students, bursar) === 'dashboard');

// Elevation, which is over and above a module. A bursar with Fees at Full may
// take money; they may not forgive it, raise a new charge against every family
// in the school, or take a bill off the books.
const fees = moduleByKey('fees');
ck('a bursar with Fees at Full is not shown the extra charges',
  !tabsFor(fees, staff('Accountant', { fees: lvl(3) })).includes('supplementary'));
ck('...nor the withdrawn bills',
  !tabsFor(fees, staff('Accountant', { fees: lvl(3) })).includes('voided'));
ck('the Proprietor is shown both',
  tabsFor(fees, proprietor).includes('supplementary') && tabsFor(fees, proprietor).includes('voided'));
ck('...and so is the Super Admin',
  tabsFor(fees, superAdmin).includes('supplementary') && tabsFor(fees, superAdmin).includes('voided'));

const settings = moduleByKey('settings');
ck('the audit trail is the Super Admin\'s alone',
  tabsFor(settings, superAdmin).includes('audit')
  && !tabsFor(settings, staff('Head Teacher', { settings: lvl(3) })).includes('audit'));
ck('the canteen settings need the canteen, not settings alone',
  !tabsFor(settings, staff('Head Teacher', { settings: lvl(3) })).includes('canteen'));

// ── feature flags hide what a school has turned off ─────────────────────────
const off = { feature_canteen_enabled: 'false', feature_transport_enabled: false };
ck('a school with no canteen is not shown one', !keys(head, off).includes('canteen'));
ck('...nor a transport register it does not keep', !keys(bursar, off).includes('transport'));
ck('a flag the server never sent means the school has the feature',
  featureOn({}, 'feature_canteen_enabled'));
ck('...except clocking in, which stays off until a school asks for it',
  !featureOn({}, 'staff_clockin_enabled') && featureOn({ staff_clockin_enabled: 'true' }, 'staff_clockin_enabled'));
ck('and the staff attendance tab follows that switch',
  !tabsFor(moduleByKey('staff'), head).includes('attendance')
  && tabsFor(moduleByKey('staff'), head, { staff_clockin_enabled: true }).includes('attendance'));

// ── where sign-in lands everybody ───────────────────────────────────────────
ck('everybody lands on Home — there is no portal to choose any more',
  landingHref(teacher) === '/app' && landingHref(bursar) === '/app' && landingHref(superAdmin) === '/app');
ck('a parent has their own app inside this one', landingHref({ role: 'parent' }) === '/parent');

// ── the phone's bottom bar ──────────────────────────────────────────────────
const bar = (who) => bottomBar(visibleModules(who), who);
ck('a teacher\'s bar is their work, not a menu',
  JSON.stringify(bar(teacher)) === JSON.stringify(['home', 'students', 'action', 'academics', 'me']));
ck('a bursar\'s is theirs',
  JSON.stringify(bar(bursar)) === JSON.stringify(['home', 'fees', 'action', 'finance', 'me']));
ck('a cook gets the one thing they do',
  JSON.stringify(bar(cook)) === JSON.stringify(['home', 'canteen', 'action', 'me']));
ck('an account granted nothing gets a bar it can use',
  JSON.stringify(bar(guard)) === JSON.stringify(['home', 'action', 'me']));
ck('every cell of every bar names a module that account actually holds',
  [teacher, bursar, head, cook, guard, superAdmin].every((who) => {
    const held = new Set(visibleModules(who).map(m => m.key));
    return bar(who).every(k => k === 'action' || held.has(k));
  }));

// ── the quick actions cannot outlive the screens behind them ────────────────
const qa = (who, f) => quickActions(who, f).map(a => a.key);
ck('a teacher is offered the register and the marks',
  qa(teacher).includes('register') && qa(teacher).includes('marks'));
ck('...and is not offered an expense they cannot record', !qa(teacher).includes('expense'));
ck('a bursar is offered taking a payment and raising the bills',
  qa(bursar).includes('payment') && qa(bursar).includes('bill'));
ck('...and is not offered the register', !qa(bursar).includes('register'));
ck('an account granted nothing is offered nothing', qa(guard).length === 0);
ck('every action leads to a tab that exists on the module it names',
  QUICK_ACTIONS.every(a => {
    const m = moduleByKey(a.module);
    return m && m.tabs && m.tabs.some(x => x.id === a.tab);
  }));
ck('...and a school with the canteen off is not offered the collection',
  !qa(head, { feature_canteen_enabled: 'false' }).includes('collect'));

// ── which item the current page belongs to ──────────────────────────────────
const all = visibleModules(superAdmin);
ck('a pupil\'s record lights up Students',
  activeModule(all, '/app/students/12')?.key === 'students');
ck('the store room is not Finance, though it is the finance module',
  activeModule(all, '/app/inventory')?.key === 'inventory');
ck('Home does not light up everything beneath it',
  activeModule(all, '/app/fees')?.key === 'fees');
ck('Home lights up on Home', activeModule(all, '/app')?.key === 'home');

// ── the drawer's grouping is the same for everybody ─────────────────────────
const HEADINGS = ['Overview', 'The school', 'Money', 'People', 'Talking', 'You'];
ck('the drawer\'s headings are the school\'s own words, in one order',
  JSON.stringify(groupModules(visibleModules(head)).map(g => g.group)) === JSON.stringify(HEADINGS));
// A heading with nothing under it is not drawn — a bursar has no Talking —
// but the ones that ARE drawn never change places, so two people at the same
// school still find Fees in the same part of the same list.
ck('...and everybody else sees those same headings in those same places, minus the empty ones',
  [teacher, bursar, cook, guard, proprietor].every((who) => {
    const shown = groupModules(visibleModules(who)).map(g => g.group);
    return JSON.stringify(shown) === JSON.stringify(HEADINGS.filter(h => shown.includes(h)));
  }));
ck('everything visible is placed in some group',
  groupModules(all).flatMap(g => g.items).length === all.length);

// ── the parent's app, which is not a module list ────────────────────────────
// A parent is not a member of staff and never was: they have their own
// navigation, and it is the one part of the portal era that stays.
ck('a parent still has their own navigation',
  PORTAL_NAV.parent && PORTAL_NAV.parent.items.length > 0);
ck('...and it is drawn without asking the permission map anything',
  visibleNav(PORTAL_NAV.parent.items, { role: 'parent' }).length === PORTAL_NAV.parent.items.length);

// ── the rule, stated once ───────────────────────────────────────────────────
ck('nothing is ever drawn that the account may not open',
  [teacher, bursar, head, cook, guard, proprietor, superAdmin].every(who =>
    visibleModules(who).every(m => m.always || allows(who, m.module, m.need || 'view'))));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
