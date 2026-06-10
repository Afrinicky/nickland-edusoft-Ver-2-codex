// Nickland Edusoft — Academics Module (tabbed)
import React, { useState } from 'react';
import AcademicsDashboard from './Dashboard.jsx';
import StudentProfileTab from './StudentProfileTab.jsx';
import ClassScoresTab from './ClassScoresTab.jsx';
import ExamScoresTab from './ExamScoresTab.jsx';
import EndOfTermResultsTab from './EndOfTermResultsTab.jsx';
import EndOfTermReportPanel from './EndOfTermReportPanel.jsx';
import ExaminationsTab from './ExaminationsTab.jsx';

const TABS = [
  { id: 'dashboard',     label: 'Academic Dashboard' },
  { id: 'profile',       label: 'Student Academic Profile' },
  { id: 'classscores',   label: 'Class Scores' },
  { id: 'examscores',    label: 'Exam Scores' },
  { id: 'results',       label: 'End of Term Results' },
  { id: 'report',        label: 'End of Term Report' },
  { id: 'examinations',  label: 'Examinations' },
];

export default function AcademicsIndex() {
  const [tab, setTab] = useState('dashboard');

  return (
    <div className="academics-module">
      <div className="page-header">
        <div>
          <div className="page-title">Academics</div>
          <div className="page-subtitle">Scores, results, reports, examinations, and student performance</div>
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
        {tab === 'dashboard'    && <AcademicsDashboard onSwitchTab={setTab} />}
        {tab === 'profile'      && <StudentProfileTab />}
        {tab === 'classscores'  && <ClassScoresTab />}
        {tab === 'examscores'   && <ExamScoresTab />}
        {tab === 'results'      && <EndOfTermResultsTab />}
        {tab === 'report'       && <EndOfTermReportPanel />}
        {tab === 'examinations' && <ExaminationsTab />}
      </div>
    </div>
  );
}
