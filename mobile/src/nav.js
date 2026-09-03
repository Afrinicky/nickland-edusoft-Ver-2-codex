// Nickland Edusoft — what the app is made of, and who may open each part.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// One list, read by the sidebar, the tablet rail, the phone's bottom bar and
// its "More" sheet. Four navigations that disagree is four bugs; this is the
// single answer to "what is in this app, and may this account see it".
//
// `modules` is the same [module, action] pairs the server checks. What an
// account cannot open, it does not see — a menu item leading to "access
// denied" advertises a part of the school's system to somebody who has been
// told they may not have it.

export const STAFF_NAV = [
  { key: 'dashboard', href: '/staff', label: 'Overview', short: 'Home', icon: 'grid', group: 'Today', always: true },
  { key: 'timetable', href: '/staff/timetable', label: 'Timetable', icon: 'calendar', group: 'Today', always: true },

  { key: 'attendance', href: '/staff/attendance', label: 'Register', short: 'Register', icon: 'check', group: 'Teaching',
    modules: [['students', 'edit'], ['academics', 'edit']] },
  { key: 'scores', href: '/staff/scores', label: 'Exam marks', icon: 'chart', group: 'Teaching',
    modules: [['academics', 'view']] },
  { key: 'assessments', href: '/staff/assessments', label: 'Class work', icon: 'layers', group: 'Teaching',
    modules: [['academics', 'view']] },
  { key: 'results', href: '/staff/results', label: 'Results', icon: 'award', group: 'Teaching',
    modules: [['academics', 'view']] },
  // How the class is doing, and how to reach its parents. Read-only, and built
  // from marks and registers the teacher can already see, so it needs no
  // permission of its own beyond those.
  { key: 'insight', href: '/staff/insight', label: 'Class insight', icon: 'trend', group: 'Teaching',
    modules: [['academics', 'view'], ['students', 'view']] },
  { key: 'homework', href: '/staff/homework', label: 'Homework', icon: 'book', group: 'Teaching',
    modules: [['academics', 'view']] },
  { key: 'notes', href: '/staff/notes', label: 'Lesson notes', icon: 'note', group: 'Teaching', always: true },

  { key: 'students', href: '/staff/students', label: 'Pupils', icon: 'users', group: 'School',
    // A pupil's record has no entry of its own; it belongs under Pupils.
    match: ['/staff/student'], modules: [['students', 'view']] },
  { key: 'canteen', href: '/staff/canteen', label: 'Canteen', short: 'Canteen', icon: 'bowl', group: 'School',
    modules: [['canteen', 'view']] },
  { key: 'debtors', href: '/staff/debtors', label: 'Fee arrears', icon: 'wallet', group: 'School',
    modules: [['fees', 'view']] },

  { key: 'messages', href: '/staff/messages', label: 'Messages', icon: 'chat', group: 'Talking',
    match: ['/staff/message'], modules: [['notifications', 'view']] },
  { key: 'notices', href: '/staff/notices', label: 'Notices', icon: 'bell', group: 'Talking',
    modules: [['notifications', 'view']] },

  { key: 'me', href: '/staff/me', label: 'My work', short: 'Me', icon: 'badge', group: 'Me', always: true },
  { key: 'account', href: '/staff/account', label: 'Account', icon: 'gear', group: 'Me', always: true },
];

// What sits across the bottom of a phone: four destinations with the action
// button between them. Four, not five — a bar of five 60px cells has labels
// nobody can read, and the drawer now carries the whole app anyway, so nothing
// is hidden by keeping this short.
export const STAFF_PRIMARY = ['dashboard', 'attendance', 'action', 'canteen', 'me'];

// What the button in the middle offers. Not destinations — the jobs a teacher
// opened the app to do. Filtered against what the account may actually see, so
// a teacher without the canteen never sees a canteen action.
export const STAFF_QUICK = [
  { key: 'attendance', label: 'Take the register', hint: "Mark today's class" },
  { key: 'scores',     label: 'Enter exam marks', hint: 'A class and a subject' },
  { key: 'assessments',label: 'Enter class work', hint: 'Assignments, tests and quizzes' },
  { key: 'canteen',    label: 'Collect canteen money', hint: "The morning's daily collection" },
  { key: 'homework',   label: 'Set homework', hint: 'For one of your classes' },
  { key: 'notes',      label: 'Write a lesson note', hint: 'And submit it for approval' },
  { key: 'results',    label: 'Write end-of-term remarks', hint: 'Conduct and the report card' },
];

export const PARENT_NAV = [
  { key: 'children', href: '/parent', label: 'My children', short: 'Children', icon: 'users', group: 'Home', match: ['/parent/child'], always: true },
  { key: 'notifications', href: '/parent/notifications', label: 'Notices', short: 'Notices', icon: 'bell', group: 'Home', always: true },
  { key: 'messages', href: '/parent/messages', label: 'Messages', short: 'Messages', icon: 'chat', group: 'Home', match: ['/parent/message'], always: true },
  { key: 'account', href: '/parent/account', label: 'Account', short: 'Account', icon: 'gear', group: 'Me', always: true },
];

export const PARENT_PRIMARY = ['children', 'notifications', 'action', 'messages', 'account'];

// A parent's middle button is not "add" — a parent creates nothing here. It is
// the thing they open the app to do when something is wrong: reach a person.
export const PARENT_QUICK = [
  { key: 'messages',      label: 'Message a teacher', hint: 'Start or continue a conversation' },
  { key: 'notifications', label: "Read the school's notices", hint: 'The latest first' },
  { key: 'children',      label: "Open a child's record", hint: 'Marks, register, bill, conduct' },
];

/**
 * The quick actions this account can actually reach.
 *
 * `spec` names navigation keys rather than URLs, so an action cannot outlive
 * the screen behind it, and an account that may not open a screen is never
 * offered the shortcut to it.
 */
export function quickActions(spec, visibleItems) {
  if (!spec || !spec.length) return [];
  const byKey = new Map((visibleItems || []).map(i => [i.key, i]));
  return spec
    .map(a => {
      const item = byKey.get(a.key);
      return item ? { ...a, href: item.href, icon: a.icon || item.icon } : null;
    })
    .filter(Boolean);
}

const ACTION_KEY = { view: 'canView', create: 'canCreate', edit: 'canEdit', delete: 'canDelete' };

function allowed(profile, module, action) {
  if (!profile) return false;
  if (profile.is_admin) return true;
  const p = (profile.permissions || {})[module];
  return !!(p && p[ACTION_KEY[action] || 'canView']);
}

export function visibleNav(items, profile) {
  return items.filter(i => i.always || (i.modules || []).some(([m, a]) => allowed(profile, m, a)));
}

// Group the visible items in declaration order, so the sidebar's headings
// never reorder themselves as permissions differ between two teachers.
export function groupNav(items) {
  const out = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else out.push({ group: item.group, items: [item] });
  }
  return out;
}
