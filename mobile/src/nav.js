// Nickland Edusoft — the parent's navigation.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The school's own app is a list of MODULES and lives in src/modules.js — the
// desktop installer's list, handed out by what an account holds. This file is
// what is left over: a parent is not a member of staff, holds no modules and
// never will, so their app is four fixed places and a way to reach a person.
//
// It used to hold four more navigations — Teaching, Finance, Administration,
// System — one per portal, with a chip strip for moving between them. That
// front end is gone: it was never the school's own vocabulary, and the strip
// advertised the shape of the access system to people who had been handed one
// part of it. See src/modules.js for what replaced it, and
// ARCHITECTURE-PORTALS.md §2 for why.

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

// One place a navigation is looked up, so a layout is four lines.
export const PORTAL_NAV = {
  parent: { title: 'Parent', items: PARENT_NAV, primary: PARENT_PRIMARY, quick: PARENT_QUICK,
            accountHref: '/parent/account', actionIcon: 'chat',
            actionLabel: 'Reach the school',
            actionHint: 'A question, an absence, a bill — start here.' },
};

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
// never reorder themselves as permissions differ between two parents.
export function groupNav(items) {
  const out = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else out.push({ group: item.group, items: [item] });
  }
  return out;
}
