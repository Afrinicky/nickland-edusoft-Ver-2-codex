// The parent area — the same shell the staff area uses.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Parents open this in a browser as often as on a phone, so it gets the same
// treatment: a sidebar where there is room, a bottom bar where there is not.
import React from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '../../src/auth';
import { Loading } from '../../src/ui';
import { AppShell } from '../../src/shell';
import { PORTAL_NAV } from '../../src/nav';
import { landingHref } from '../../src/modules';

const NAV = { ...PORTAL_NAV.parent, portal: 'parent' };

export default function ParentLayout() {
  const { ready, token, profile } = useAuth();

  // On the phone every visit starts at the index gate, which waits for the
  // stored session before routing. In a browser it does not: a reload or a
  // bookmarked link (/parent/child/7) mounts this screen cold, and without
  // this guard the screen fetched with no token and showed "Please sign in."
  // to somebody who was signed in perfectly well.
  if (!ready) return <Loading label="Starting…" />;
  if (!token || !profile) return <Redirect href="/" />;
  // A member of staff who lands on a parent URL belongs in their own area.
  if (profile.role !== 'parent') return <Redirect href={landingHref(profile)} />;

  return <AppShell nav={NAV} school={profile?.school?.name} />;
}
