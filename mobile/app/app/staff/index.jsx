// Staff Management.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React from 'react';
import { ModulePage } from '../../../src/module';
import { RequireModule } from '../../../src/appshell';
import Approvals from '../../../src/screens/admin/approvals';
import {
  StaffDashboard, StaffRoll, StaffStatus, StaffRegister, LessonNotes, StaffActivities,
} from '../../../src/screens/mod/staff';

export default function Staff() {
  return (
    <RequireModule moduleKey="staff">
      <ModulePage moduleKey="staff" subtitle="Records, attendance, leave and lesson notes">
        {(tab) => {
          switch (tab) {
            case 'dashboard':   return <StaffDashboard />;
            case 'roll':        return <StaffRoll />;
            case 'status':      return <StaffStatus />;
            case 'lessonnotes': return <LessonNotes />;
            case 'activities':  return <StaffActivities />;
            case 'attendance':  return <StaffRegister />;
            case 'leave':       return <Approvals />;
            default:            return null;
          }
        }}
      </ModulePage>
    </RequireModule>
  );
}
