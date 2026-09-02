// Nickland Edusoft — Students Module (tabbed)
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/index.js';
import StudentsDashboard from './Dashboard.jsx';
import AttendanceRegister from './AttendanceRegister.jsx';
import StudentsStatusTab from './StatusTab.jsx';
import StudentsAdmissionsTab from './AdmissionsTab.jsx';
import StudentsSheetTab from './SheetTab.jsx';

// `need` is the permission a tab requires. Admissions creates pupils and the
// Students Sheet rewrites them, so neither is a viewing tab: a Class Teacher
// with students.view alone was being shown both, could open them, and could
// edit through them — the main process now refuses those calls, and these
// keep the tabs from being offered in the first place.
const TABS = [
  { id: 'dashboard',  label: 'Dashboard' },
  { id: 'register',   label: 'Attendance Register' },
  { id: 'status',     label: 'Students Status' },
  { id: 'admissions', label: 'Students Admissions', need: 'create' },
  { id: 'sheet',      label: 'Students Sheet',      need: 'edit' },
];

export default function StudentsIndex() {
  const can = useStore(s => s.can);
  const tabs = TABS.filter(t => !t.need || can('students', t.need));
  const [tab, setTab] = useState('dashboard');
  const navigate = useNavigate();

  // A tab reached by a stale link or a dashboard shortcut, after the access
  // was withdrawn, must not stay open.
  const active = tabs.some(t => t.id === tab) ? tab : 'dashboard';

  return (
    <div className="students-module">
      <div className="page-header">
        <div>
          <div className="page-title">Students Management</div>
          <div className="page-subtitle">Manage student records, admissions, and status</div>
        </div>
      </div>

      <div className="tabs">
        {tabs.map(t => (
          <button
            key={t.id}
            className={'tab' + (active === t.id ? ' active' : '')}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {active === 'dashboard'  && <StudentsDashboard onSwitchTab={setTab} />}
        {active === 'register'   && <AttendanceRegister />}
        {active === 'status'     && <StudentsStatusTab />}
        {active === 'admissions' && <StudentsAdmissionsTab onAdmitted={() => setTab('status')} />}
        {active === 'sheet'      && <StudentsSheetTab />}
      </div>
    </div>
  );
}
