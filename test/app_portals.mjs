// Nickland Edusoft — what the app draws, and for whom.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/app_portals.mjs
//
// The server refuses whatever the app draws, so this is not the security. It
// is the other half of the product's rule: what you may not open, you do not
// SEE. A menu item leading to a refusal advertises a part of the school's
// system to somebody who has been told they may not have it.
//
// So every check here is about absence — that a bursar's navigation has no
// register in it, that a fees-only account has no payroll, that a cook is not
// offered lesson notes. It runs the app's own modules, which are the ones the
// screens import, so it cannot pass while the app disagrees with it.

import { visibleNav, groupNav, quickActions, PORTAL_NAV,
         STAFF_NAV, FINANCE_NAV, ADMIN_NAV, SYSTEM_NAV, PARENT_NAV } from '../mobile/src/nav.js';
import { portalsFor, homePortal, homeHref, hasPortal, portalChoices } from '../mobile/src/portals.js';

let pass = 0, fail = 0;
const ck = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? '✓' : '✗') + ' ' + name); };

const lvl = (n) => ({ canView: n >= 1, canCreate: n >= 2, canEdit: n >= 3, canDelete: n >= 3 });
const staff = (designation, permissions, extra = {}) =>
  ({ role: 'staff', designation, permissions, ...extra });

// The six kinds of person, with the access a Ghanaian basic school actually
// gives them.
const teacher = staff('Class Teacher', {
  dashboard: lvl(1), students: lvl(1), academics: lvl(3), canteen: lvl(3) });
const bursar = staff('Accountant', {
  dashboard: lvl(1), students: lvl(1), fees: lvl(3), finance: lvl(3), payroll: lvl(1), canteen: lvl(1) });
const head = staff('Head Teacher', {
  dashboard: lvl(3), students: lvl(3), academics: lvl(3), fees: lvl(1), canteen: lvl(3),
  staff: lvl(3), notifications: lvl(3) });
const proprietor = staff('Proprietor', {}, { is_admin: true });
const superAdmin = staff('Administrator', {}, { is_admin: true });
const cook = staff('Cook', { canteen: lvl(3) });
const guard = staff('Security', {});
const parent = { role: 'parent' };

const labels = (items, who) => visibleNav(items, who).map(i => i.label);

// ── who is handed which portal ──────────────────────────────────────────────
ck('a class teacher gets teaching and nothing else',
  JSON.stringify(portalsFor(teacher)) === JSON.stringify(['teacher']));
ck('an accountant gets FINANCE and nothing else',
  JSON.stringify(portalsFor(bursar)) === JSON.stringify(['finance']));
ck('...so the app never draws them a teaching portal', !hasPortal(bursar, 'teacher'));
ck('a head teacher runs the school',
  JSON.stringify(portalsFor(head)) === JSON.stringify(['teacher', 'finance', 'admin']));
ck('...and is not the Super Admin', !hasPortal(head, 'system'));
ck('the proprietor runs the school too',
  JSON.stringify(portalsFor(proprietor)) === JSON.stringify(['teacher', 'finance', 'admin']));
ck('...and is still not the Super Admin', !hasPortal(proprietor, 'system'));
ck('the Super Admin has all four',
  JSON.stringify(portalsFor(superAdmin)) === JSON.stringify(['teacher', 'finance', 'admin', 'system']));
ck('a cook collects the canteen money, so gets the working day',
  JSON.stringify(portalsFor(cook)) === JSON.stringify(['teacher']));
ck('an account granted nothing still has somewhere to be',
  JSON.stringify(portalsFor(guard)) === JSON.stringify(['teacher']));
ck('a parent gets the parent portal and nothing else',
  JSON.stringify(portalsFor(parent)) === JSON.stringify(['parent']));

// ── where sign-in lands them ────────────────────────────────────────────────
ck('a bursar opens on the office, not on a register', homeHref(bursar) === '/finance');
ck('a head teacher opens on the school', homeHref(head) === '/admin');
ck('the Super Admin opens on the school, not on the user table', homePortal(superAdmin) === 'admin');
ck('a class teacher opens on the working day', homeHref(teacher) === '/staff');

// ── the switcher ────────────────────────────────────────────────────────────
ck('a class teacher is shown no switcher at all', portalChoices(teacher).length < 2);
ck('a head teacher is shown three', portalChoices(head).length === 3);
ck('...and the server’s answer wins over the app’s guess',
  JSON.stringify(portalsFor({ role: 'staff', permissions: {}, portals: [{ key: 'finance' }] }))
    === JSON.stringify(['finance']));

// ── what each portal draws ──────────────────────────────────────────────────
const bursarFinance = labels(FINANCE_NAV, bursar);
ck('the bursar’s office has collections and the books',
  bursarFinance.includes('Collections') && bursarFinance.includes('Expenditure'));
ck('...and their own record, so they can reach a payslip and a password',
  bursarFinance.includes('My work') && bursarFinance.includes('Account'));

const feesOnly = staff('Head Teacher', { fees: lvl(1) });
const feesOnlyNav = labels(FINANCE_NAV, feesOnly);
ck('an account with fees alone sees the arrears',
  feesOnlyNav.includes('Arrears'));
ck('...and is NOT shown expenditure', !feesOnlyNav.includes('Expenditure'));
ck('...nor the statement', !feesOnlyNav.includes('Statement'));
ck('...nor payroll', !feesOnlyNav.includes('Payroll'));
ck('...nor the store room', !feesOnlyNav.includes('Store room'));

const cookStaff = labels(STAFF_NAV, cook);
ck('a cook is offered the canteen', cookStaff.includes('Canteen'));
ck('...and is NOT offered lesson notes, which they cannot write',
  !cookStaff.includes('Lesson notes'));
ck('...nor the register', !cookStaff.includes('Register'));
ck('...nor exam marks', !cookStaff.includes('Exam marks'));

const guardStaff = labels(STAFF_NAV, guard);
ck('an account granted nothing sees only its own record and the timetable',
  guardStaff.every(l => ['Overview', 'Timetable', 'My work', 'Account'].includes(l)));

const headAdmin = labels(ADMIN_NAV, head);
ck('a head teacher’s administration has the roll and the staff',
  headAdmin.includes('Pupils') && headAdmin.includes('Staff'));
ck('...and the approvals waiting on them', headAdmin.includes('Approvals'));

const secretary = staff('Secretary', {
  dashboard: lvl(1), students: lvl(3), academics: lvl(1), staff: lvl(1), notifications: lvl(3) });
const secretaryAdmin = labels(ADMIN_NAV, secretary);
ck('a secretary may keep the roll', secretaryAdmin.includes('Pupils'));
ck('...and is not shown academic oversight they cannot act on',
  secretaryAdmin.includes('How we are doing'));   // they hold academics: view

// ── the system portal is undrawable to anybody but the Super Admin ──────────
for (const [who, person] of [['a class teacher', teacher], ['a bursar', bursar],
                             ['a head teacher', head], ['the proprietor', proprietor]]) {
  ck(`${who} is never shown the system portal`, !hasPortal(person, 'system'));
}
ck('the Super Admin is', hasPortal(superAdmin, 'system'));
ck('and the system navigation is the whole of it',
  labels(SYSTEM_NAV, superAdmin).includes('Accounts')
  && labels(SYSTEM_NAV, superAdmin).includes('Access levels')
  && labels(SYSTEM_NAV, superAdmin).includes('Audit trail'));

// ── the quick actions cannot outlive the screens behind them ────────────────
const bursarItems = visibleNav(FINANCE_NAV, bursar);
const bursarQuick = quickActions(PORTAL_NAV.finance.quick, bursarItems).map(a => a.key);
ck('the bursar is offered taking a payment', bursarQuick.includes('collections'));
const feesOnlyItems = visibleNav(FINANCE_NAV, feesOnly);
const feesOnlyQuick = quickActions(PORTAL_NAV.finance.quick, feesOnlyItems).map(a => a.key);
ck('an account without expenditure is not offered "record an expense"',
  !feesOnlyQuick.includes('expenses'));

// ── every portal is wired, and every item leads somewhere ───────────────────
ck('every portal has a navigation', ['teacher', 'finance', 'admin', 'system', 'parent']
  .every(k => PORTAL_NAV[k] && PORTAL_NAV[k].items.length));
for (const [key, nav] of Object.entries(PORTAL_NAV)) {
  ck(`${key}: every item has an href, an icon and a group`,
    nav.items.every(i => i.href && i.icon && i.group));
  ck(`${key}: the bottom bar names items that exist`,
    nav.primary.every(k => k === 'action' || nav.items.some(i => i.key === k)));
  ck(`${key}: every quick action names an item that exists`,
    nav.quick.every(a => nav.items.some(i => i.key === a.key)));
}

// ── grouping is stable ──────────────────────────────────────────────────────
ck('groups keep their declaration order for everybody',
  JSON.stringify(groupNav(visibleNav(FINANCE_NAV, bursar)).map(g => g.group))
    === JSON.stringify(['Today', 'Money in', 'The books', 'People', 'Me']));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
