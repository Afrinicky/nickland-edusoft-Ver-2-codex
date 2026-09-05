// Fees Management.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Four sections, matching the installed application: the dashboard, the
// counter, the bills, and the discounts that change them. Payments is second
// because bills are raised three times a year and money is taken every morning
// of the term.
import React from 'react';
import { ModulePage } from '../../../src/module';
import { RequireModule } from '../../../src/appshell';
import PaymentsHub from '../../../src/screens/finance/payments-hub';
import BillsHub from '../../../src/screens/finance/bills-hub';
import { FeesDashboard, Discounts } from '../../../src/screens/mod/fees';

export default function Fees() {
  return (
    <RequireModule moduleKey="fees">
      <ModulePage moduleKey="fees" subtitle="Payments, bills, discounts and arrears">
        {(tab) => {
          switch (tab) {
            case 'dashboard': return <FeesDashboard />;
            case 'payments':  return <PaymentsHub />;
            case 'bills':     return <BillsHub />;
            case 'discounts': return <Discounts />;
            default:          return null;
          }
        }}
      </ModulePage>
    </RequireModule>
  );
}
