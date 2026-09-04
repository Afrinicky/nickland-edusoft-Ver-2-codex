// Fees Management.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React from 'react';
import { ModulePage } from '../../../src/module';
import { RequireModule } from '../../../src/appshell';
import Bills from '../../../src/screens/finance/bills';
import Payments from '../../../src/screens/finance/collections';
import OnlinePayments from '../../../src/screens/finance/online';
import Debtors from '../../../src/screens/finance/debtors';
import {
  FeesDashboard, FeeTemplates, Discounts, Books, BulkPaySheet, Supplementary, VoidedBills,
} from '../../../src/screens/mod/fees';

export default function Fees() {
  return (
    <RequireModule moduleKey="fees">
      <ModulePage moduleKey="fees" subtitle="Bills, payments, discounts and arrears">
        {(tab) => {
          switch (tab) {
            case 'dashboard': return <FeesDashboard />;
            case 'bills':     return <Bills />;
            case 'templates': return <FeeTemplates />;
            case 'payments':  return <Payments />;
            case 'bulk':      return <BulkPaySheet />;
            case 'supplementary': return <Supplementary />;
            case 'discounts': return <Discounts />;
            case 'books':     return <Books />;
            case 'online':    return <OnlinePayments />;
            case 'debtors':   return <Debtors />;
            case 'voided':    return <VoidedBills />;
            default:          return null;
          }
        }}
      </ModulePage>
    </RequireModule>
  );
}
