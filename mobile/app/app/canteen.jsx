// Canteen.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React from 'react';
import { ModulePage } from '../../src/module';
import { RequireModule } from '../../src/appshell';
import QuickPay from '../../src/screens/staff/canteen';
import {
  CanteenDashboard, CanteenSheet, CanteenDebtors,
} from '../../src/screens/mod/canteen';

export default function Canteen() {
  return (
    <RequireModule moduleKey="canteen">
      <ModulePage moduleKey="canteen" subtitle="The daily collection, the sheet and what is owed · the term’s feeding calendar is under Fees → Bills → Canteen">
        {(tab) => {
          switch (tab) {
            case 'dashboard': return <CanteenDashboard />;
            case 'sheet':     return <CanteenSheet />;
            case 'quickpay':  return <QuickPay />;
            case 'debtors':   return <CanteenDebtors />;
            default:          return null;
          }
        }}
      </ModulePage>
    </RequireModule>
  );
}
