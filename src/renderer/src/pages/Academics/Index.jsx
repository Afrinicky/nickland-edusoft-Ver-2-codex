// Nickland Edusoft — Academics Module (tabbed)
import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import AcademicsDashboard from './Dashboard.jsx';
import StudentProfileTab from './StudentProfileTab.jsx';
import ClassScoresTab from './ClassScoresTab.jsx';
import ExamScoresTab from './ExamScoresTab.jsx';
import EndOfTermResultsTab from './EndOfTermResultsTab.jsx';
import EndOfTermReportPanel from './EndOfTermReportPanel.jsx';
import ExaminationsTab from './ExaminationsTab.jsx';
import AssessmentCompilationTab from './AssessmentCompilationTab.jsx';
import HomeworkTab from './HomeworkTab.jsx';
import TimetableIndex from '../Timetable/Index.jsx';

// Teaching & planning tools sit next to the scores they feed: homework marks
// become continuous assessment, and the timetable drives who teaches what.
const TABS = [
  { id: 'dashboard',     label: 'Academic Dashboard' },
  { id: 'profile',       label: 'Student Academic Profile' },
  { id: 'timetable',     label: 'Timetable' },
  { id: 'homework',      label: 'Homework' },
  { id: 'classscores',   label: 'Class Scores' },
  { id: 'examscores',    label: 'Exam Scores' },
  { id: 'results',       label: 'End of Term Results' },
  { id: 'compilation',   label: 'Assessment Compilation' },
  { id: 'report',        label: 'End of Term Report' },
  { id: 'examinations',  label: 'Examinations' },
];

export default function AcademicsIndex() {
  const location = useLocation();
  // Allows /academics?tab=timetable — the old standalone routes redirect here.
  const requested = new URLSearchParams(location.search).get('tab');
  const [tab, setTab] = useState(TABS.some(t => t.id === requested) ? requested : 'dashboard');

  return (
    <div className="academics-module">
      <div className="page-header">
        <div>
          <div className="page-title">Academics</div>
          <div className="page-subtitle">Timetable, homework, scores, results, reports and student performance</div>
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
        {tab === 'timetable'    && <TimetableIndex embedded />}
        {tab === 'homework'     && <HomeworkTab />}
        {tab === 'classscores'  && <ClassScoresTab />}
        {tab === 'examscores'   && <ExamScoresTab />}
        {tab === 'results'      && <EndOfTermResultsTab />}
        {tab === 'report'       && <EndOfTermReportPanel />}
        {tab === 'compilation'  && <AssessmentCompilationTab />}
        {tab === 'examinations' && <ExaminationsTab />}
      </div>
    </div>
  );
}
