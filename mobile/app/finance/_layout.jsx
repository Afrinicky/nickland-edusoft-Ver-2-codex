// The finance office.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The same shell every other area uses, with the finance navigation in it. An
// account without the portal is sent to the one it does hold rather than shown
// a door it cannot open.
import React from 'react';
import { AppShell } from '../../src/shell';
import { PORTAL_NAV } from '../../src/nav';
import { RequirePortal } from '../../src/office';

export default function FinanceLayout() {
  return (
    <RequirePortal portal="finance">
      <AppShell nav={{ ...PORTAL_NAV.finance, portal: 'finance' }} />
    </RequirePortal>
  );
}
