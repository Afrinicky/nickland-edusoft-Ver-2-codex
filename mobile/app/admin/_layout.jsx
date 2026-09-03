// Running the school.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React from 'react';
import { AppShell } from '../../src/shell';
import { PORTAL_NAV } from '../../src/nav';
import { RequirePortal } from '../../src/office';

export default function AdminLayout() {
  return (
    <RequirePortal portal="admin">
      <AppShell nav={{ ...PORTAL_NAV.admin, portal: 'admin' }} />
    </RequirePortal>
  );
}
