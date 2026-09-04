// Settings.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React from 'react';
import { ModulePage } from '../../src/module';
import { RequireModule } from '../../src/appshell';
import {
  SchoolIdentity, Appearance, Terms, Classes, Subjects, Grading,
  CanteenSettings, PayrollSettings, PaymentSettings, NotificationSettings,
  Users, AccessControl, Features, AuditTrail,
} from '../../src/screens/mod/settings';

export default function Settings() {
  return (
    <RequireModule moduleKey="settings">
      <ModulePage moduleKey="settings" subtitle="The school's own setup, and who may do what">
        {(tab) => {
          switch (tab) {
            case 'school':   return <SchoolIdentity />;
            case 'branding': return <Appearance />;
            case 'terms':    return <Terms />;
            case 'classes':  return <Classes />;
            case 'subjects': return <Subjects />;
            case 'grading':  return <Grading />;
            case 'canteen':  return <CanteenSettings />;
            case 'payroll':  return <PayrollSettings />;
            case 'payments': return <PaymentSettings />;
            case 'notify':   return <NotificationSettings />;
            case 'users':    return <Users />;
            case 'access':   return <AccessControl />;
            case 'features': return <Features />;
            case 'audit':    return <AuditTrail />;
            default:         return null;
          }
        }}
      </ModulePage>
    </RequireModule>
  );
}
