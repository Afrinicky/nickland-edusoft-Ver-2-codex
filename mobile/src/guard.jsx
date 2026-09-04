// Nickland Edusoft mobile/web — module access guards.
//
// The rule this enforces: what you do not have access to, you cannot see.
//
// Hiding a tab is most of it, but not all of it. A screen still has a URL, and
// in the browser build that URL can be typed, bookmarked or shared. Reaching
// one you may not open should put you back where you belong — not on an
// "Access denied" page, which tells you the screen exists and invites you to
// keep trying.
//
// This is a courtesy, not the enforcement. The server checks every request
// against the same permission map and answers 403 regardless of what the app
// chose to draw; a projection can be stale, and the desktop has the last word.
import React from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from './auth';
import { Loading } from './ui';

const ACTION_KEY = { view: 'canView', create: 'canCreate', edit: 'canEdit', delete: 'canDelete' };

export function can(profile, module, action = 'view') {
  if (!profile) return false;
  if (profile.is_admin) return true;
  const p = (profile.permissions || {})[module];
  return !!(p && p[ACTION_KEY[action] || 'canView']);
}

// True when ANY of the [module, action] pairs is allowed. Some screens are
// legitimately reachable from more than one permission — a register is
// students-or-academics, exactly as the server has it.
export function canAny(profile, pairs) {
  return pairs.some(([m, a]) => can(profile, m, a));
}

// Wrap a screen's body. `modules` is one [module, action] pair or a list of them.
export function RequireModule({ modules, children }) {
  const { ready, token, profile } = useAuth();
  const pairs = Array.isArray(modules[0]) ? modules : [modules];

  if (!ready) return <Loading label="Starting…" />;
  if (!token || !profile) return <Redirect href="/" />;
  if (!canAny(profile, pairs)) return <Redirect href="/app" />;
  return children;
}
