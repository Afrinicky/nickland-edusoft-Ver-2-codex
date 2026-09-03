// The system itself — the Super Admin alone.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Guarded twice on this side and twice again on the server: the portal, and
// then the designation. A `settings` tick somebody was granted by mistake does
// not open this area.
import React from 'react';
import { AppShell } from '../../src/shell';
import { PORTAL_NAV } from '../../src/nav';
import { RequirePortal } from '../../src/office';

export default function SystemLayout() {
  return (
    <RequirePortal portal="system">
      <AppShell nav={{ ...PORTAL_NAV.system, portal: 'system' }} />
    </RequirePortal>
  );
}
