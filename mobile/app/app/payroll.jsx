// Payroll.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React from 'react';
import { ModulePage } from '../../src/module';
import { RequireModule } from '../../src/appshell';
import { PayrollRun, StatutorySchedule, Payslips } from '../../src/screens/mod/payroll';

export default function Payroll() {
  return (
    <RequireModule moduleKey="payroll">
      <ModulePage moduleKey="payroll" subtitle="Salaries, statutory schedules and payslips">
        {(tab) => {
          switch (tab) {
            case 'run':      return <PayrollRun />;
            case 'ssnit':    return <StatutorySchedule kind="ssnit" />;
            case 'paye':     return <StatutorySchedule kind="paye" />;
            case 'payslips': return <Payslips />;
            default:         return null;
          }
        }}
      </ModulePage>
    </RequireModule>
  );
}
