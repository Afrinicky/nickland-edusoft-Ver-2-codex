// Finance.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React from 'react';
import { ModulePage } from '../../src/module';
import { RequireModule } from '../../src/appshell';
import Position from '../../src/screens/finance/index';
import Expenses from '../../src/screens/finance/expenses';
import Statement from '../../src/screens/finance/statement';
import { Income, Cashbook, FinanceAudit, Budgets, Workbook } from '../../src/screens/mod/finance';

export default function Finance() {
  return (
    <RequireModule moduleKey="finance">
      <ModulePage moduleKey="finance"
                  subtitle="Income, expenses, cashbook, financial statements, audit and budgets">
        {(tab) => {
          switch (tab) {
            case 'dashboard': return <Position />;
            case 'income':    return <Income />;
            case 'expenses':  return <Expenses />;
            case 'balancing': return <Cashbook />;
            case 'statement': return <Statement />;
            case 'audit':     return <FinanceAudit />;
            case 'budgets':   return <Budgets />;
            case 'workbook':  return <Workbook />;
            default:          return null;
          }
        }}
      </ModulePage>
    </RequireModule>
  );
}
