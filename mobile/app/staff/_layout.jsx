// The staff area — one shell, every screen inside it.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// This used to be expo-router's `Tabs`, which draws a bottom bar and nothing
// else: on a teacher's laptop the app showed five of its screens along the
// bottom edge of a 1920px window and hid the rest. AppShell decides from the
// window width whether that is a sidebar, a rail or a bottom bar, so the same
// build fits a 320px handset and a desktop monitor.
//
// Routes are unchanged: every screen still has its own URL, still guards itself
// (see src/guard.jsx), and the server still checks the same permissions on
// every request regardless of what the app chose to draw.
import React, { useCallback, useState } from 'react';
import { Redirect, useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/auth';
import { Loading } from '../../src/ui';
import { AppShell } from '../../src/shell';
import { PORTAL_NAV } from '../../src/nav';
import { hasPortal, homeHref } from '../../src/portals';
import { api } from '../../src/api';

const NAV = { ...PORTAL_NAV.teacher, portal: 'teacher' };

export default function StaffLayout() {
  const { ready, token, profile, mode } = useAuth();
  const [pending, setPending] = useState(0);

  // How much of this teacher's work has not reached the school yet. Only
  // meaningful over the internet — on the school Wi-Fi a write has landed by
  // the time the request returns — so it costs a request there and nothing here.
  const poll = useCallback(() => {
    let cancelled = false;
    if (token && mode === 'cloud') {
      api.staffPending(token)
        .then(r => { if (!cancelled) setPending(r.pending || 0); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [token, mode]);
  useFocusEffect(poll);

  // On the web a reload or a bookmarked link mounts a screen before the stored
  // session has been read back, so the shell waits rather than bouncing the
  // teacher to the sign-in page and losing where they were going.
  if (!ready) return <Loading label="Starting…" />;
  if (!token || !profile) return <Redirect href="/" />;
  if (profile.role === 'parent') return <Redirect href="/parent" />;
  // An accountant does not hold the teaching portal, and typing its address
  // should put them back in the office rather than in a register they cannot
  // mark. The server refuses either way; this is what makes the app honest
  // about it.
  if (!hasPortal(profile, 'teacher')) return <Redirect href={homeHref(profile)} />;

  return <AppShell nav={NAV} school={profile?.school?.name} pending={pending} />;
}
