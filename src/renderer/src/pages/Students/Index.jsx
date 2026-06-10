// Nickland Edusoft — Students Module (tabbed)
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import StudentsDashboard from './Dashboard.jsx';
import AttendanceRegister from './AttendanceRegister.jsx';
import StudentsStatusTab from './StatusTab.jsx';
import StudentsAdmissionsTab from './AdmissionsTab.jsx';
import StudentsSheetTab from './SheetTab.jsx';

const TABS = [
  { id: 'dashboard',  label: 'Dashboard' },
  { id: 'register',   label: 'Attendance Register' },
  { id: 'status',     label: 'Students Status' },
  { id: 'admissions', label: 'Students Admissions' },
  { id: 'sheet',      label: 'Students Sheet' },
];

export default function StudentsIndex() {
  const [tab, setTab] = useState('dashboard');
  const navigate = useNavigate();

  return (
    <div className="students-module">
      <div className="page-header">
        <div>
          <div className="page-title">Students Management</div>
          <div className="page-subtitle">Manage student records, admissions, and status</div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={'tab' + (tab === t.id ? ' active' : '')}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {tab === 'dashboard'  && <StudentsDashboard onSwitchTab={setTab} />}
        {tab === 'register'   && <AttendanceRegister />}
        {tab === 'status'     && <StudentsStatusTab />}
        {tab === 'admissions' && <StudentsAdmissionsTab onAdmitted={() => setTab('status')} />}
        {tab === 'sheet'      && <StudentsSheetTab />}
      </div>
    </div>
  );
}
