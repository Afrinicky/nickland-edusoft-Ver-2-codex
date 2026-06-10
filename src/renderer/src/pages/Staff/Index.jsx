// Nickland Edusoft — Staff Management Module (tabbed)
import React, { useState } from 'react';
import { useStore } from '../../store/index.js';
import StaffDashboard from './Dashboard.jsx';
import StaffStatusTab from './StatusTab.jsx';
import StaffFilesTab from './FilesTab.jsx';
import StaffAttendanceTab from './AttendanceTab.jsx';
import StaffLeaveTab from './LeaveTab.jsx';
import ActivitiesTab from './ActivitiesTab.jsx';
import LessonNotesTab from './LessonNotesTab.jsx';

export default function StaffIndex() {
  const { settings } = useStore();
  const features = settings.features || {};
  const security = settings.security || {};
  const leaveOn = features.feature_leave_management_enabled !== 'false';
  const clockinOn = security.staff_clockin_enabled === 'true';

  const ALL_TABS = [
    { id: 'dashboard',   label: 'Dashboard', show: true },
    { id: 'status',      label: 'Staff Status', show: true },
    { id: 'lessonnotes', label: 'Lesson Notes', show: true },
    { id: 'activities',  label: 'Activities', show: true },
    { id: 'files',       label: 'Staff Files', show: true },
    { id: 'attendance',  label: 'Attendance', show: clockinOn },
    { id: 'leave',       label: 'Leave Management', show: leaveOn },
  ];
  const TABS = ALL_TABS.filter(t => t.show);

  const [tab, setTab] = useState('dashboard');

  return (
    <div className="staff-module">
      <div className="page-header">
        <div>
          <div className="page-title">Staff Management</div>
          <div className="page-subtitle">Records, documents, attendance, leave, and performance</div>
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
        {tab === 'dashboard'   && <StaffDashboard onSwitchTab={setTab} />}
        {tab === 'status'      && <StaffStatusTab />}
        {tab === 'lessonnotes' && <LessonNotesTab />}
        {tab === 'activities'  && <ActivitiesTab />}
        {tab === 'files'       && <StaffFilesTab />}
        {tab === 'attendance'  && clockinOn && <StaffAttendanceTab />}
        {tab === 'leave'       && leaveOn && <StaffLeaveTab />}
      </div>
    </div>
  );
}
