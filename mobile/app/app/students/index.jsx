// Students.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ModulePage } from '../../../src/module';
import { RequireModule } from '../../../src/appshell';
import Register from '../../../src/screens/staff/attendance';
import {
  StudentsDashboard, StudentsRoll, StudentsAdmissions, StudentsStatus, StudentsSheet,
} from '../../../src/screens/mod/students';

export default function Students() {
  // The top bar's search box lands here with what was typed, so a name typed
  // into the chrome finds a pupil rather than opening an empty roll.
  const { q } = useLocalSearchParams();

  return (
    <RequireModule moduleKey="students">
      <ModulePage moduleKey="students"
                  subtitle="Admissions, records, the register and the roll">
        {(tab) => {
          switch (tab) {
            case 'dashboard':  return <StudentsDashboard />;
            case 'roll':       return <StudentsRoll initialQuery={typeof q === 'string' ? q : ''} />;
            case 'register':   return <Register />;
            case 'status':     return <StudentsStatus />;
            case 'admissions': return <StudentsAdmissions />;
            case 'sheet':      return <StudentsSheet />;
            default:           return null;
          }
        }}
      </ModulePage>
    </RequireModule>
  );
}
