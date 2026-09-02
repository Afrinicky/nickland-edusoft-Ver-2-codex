// Nickland Edusoft — Academics Module (tabbed)
import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from '../../store/index.js';
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
// `need` is the academics permission a tab requires; `classTeacher` marks the
// ones that belong to the person answerable for a class rather than to anyone
// who teaches a subject in it. End-of-term results and the report are a single
// judgement about a pupil's year, and the assessment compilation is the
// spreadsheet those are built from — a visiting subject teacher has no
// business rewriting either.
const TABS = [
  { id: 'dashboard',     label: 'Academic Dashboard' },
  { id: 'profile',       label: 'Student Academic Profile' },
  { id: 'timetable',     label: 'Timetable' },
  { id: 'homework',      label: 'Homework' },
  { id: 'classscores',   label: 'Class Scores' },
  { id: 'examscores',    label: 'Exam Scores' },
  { id: 'results',       label: 'End of Term Results',   classTeacher: true },
  { id: 'compilation',   label: 'Assessment Compilation', need: 'edit', classTeacher: true },
  { id: 'report',        label: 'End of Term Report',    classTeacher: true },
  { id: 'examinations',  label: 'Examinations',          need: 'edit' },
];

export default function AcademicsIndex() {
  const location = useLocation();
  const can = useStore(s => s.can);
  const hasAnyClassTeacherRole = useStore(s => s.hasAnyClassTeacherRole);

  const tabs = TABS.filter(t => {
    if (t.need && !can('academics', t.need)) return false;
    if (t.classTeacher && !hasAnyClassTeacherRole()) return false;
    return true;
  });

  // Allows /academics?tab=timetable — the old standalone routes redirect here.
  const requested = new URLSearchParams(location.search).get('tab');
  const [tab, setTab] = useState(tabs.some(t => t.id === requested) ? requested : 'dashboard');
  // A tab whose access was withdrawn must not stay open behind a stale link.
  const active = tabs.some(t => t.id === tab) ? tab : 'dashboard';

  return (
    <div className="academics-module">
      <div className="page-header">
        <div>
          <div className="page-title">Academics</div>
          <div className="page-subtitle">Timetable, homework, scores, results, reports and student performance</div>
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
        {active === 'dashboard'    && <AcademicsDashboard onSwitchTab={setTab} />}
        {active === 'profile'      && <StudentProfileTab />}
        {active === 'timetable'    && <TimetableIndex embedded />}
        {active === 'homework'     && <HomeworkTab />}
        {active === 'classscores'  && <ClassScoresTab />}
        {active === 'examscores'   && <ExamScoresTab />}
        {active === 'results'      && <EndOfTermResultsTab />}
        {active === 'report'       && <EndOfTermReportPanel />}
        {active === 'compilation'  && <AssessmentCompilationTab />}
        {active === 'examinations' && <ExaminationsTab />}
      </div>
    </div>
  );
}
