// Nickland Edusoft — Route Guard
//
// The rule: what you do not have access to, you cannot see.
//
// This used to render an "Access Restricted" page naming the module. The
// sidebar and the homepage already hide what an account may not open, so the
// only way to land here is a stale link or a redirect — and answering it with
// a page that names the module tells somebody who has been refused exactly
// what the school's system contains. It sends them home instead.
//
// It is a courtesy, not the enforcement. Every IPC handler behind these pages
// checks the same permissions in the main process (electron/ipc/_security.js),
// so a page reached some other way still cannot read or write anything.
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useStore } from '../store/index.js';

export default function RequirePermission({ module, action = 'view', children }) {
  const can = useStore(s => s.can);
  const currentUser = useStore(s => s.currentUser);

  // Signed out with a route still mounted — during the moment between clearing
  // the session and the shell returning to the login screen. Rendering null
  // here is what left a blank window behind a stale sidebar.
  if (!currentUser) return <Navigate to="/" replace />;
  if (can(module, action)) return children;
  return <Navigate to="/" replace />;
}
