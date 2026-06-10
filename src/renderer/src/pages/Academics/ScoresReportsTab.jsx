// Nickland Edusoft — Scores & Reports Tab (3 sub-tabs)
import React, { useState } from 'react';
import ScoresEntry from '../Scores/Entry.jsx';
import EndOfTermReportPanel from './EndOfTermReportPanel.jsx';

const SUB_TABS = [
  { id: 'class',  label: 'Class Scores' },
  { id: 'exam',   label: 'Exam Scores' },
  { id: 'report', label: 'End of Term Report' },
];

export default function ScoresReportsTab() {
  const [sub, setSub] = useState('class');

  return (
    <div className="scores-reports-tab">
      <div className="sub-tabs">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            className={'sub-tab' + (sub === t.id ? ' active' : '')}
            onClick={() => setSub(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        {sub === 'class'  && <ClassScoresPanel />}
        {sub === 'exam'   && <ExamScoresPanel />}
        {sub === 'report' && <EndOfTermReportPanel />}
      </div>
    </div>
  );
}

function ClassScoresPanel() {
  // Reuses existing ScoresEntry — it already handles class + exam in one grid.
  // For Class Scores specifically we just present the same UI with a contextual note.
  return (
    <>
      <div className="info-banner">
        <strong>Class Scores</strong> — these are continuous assessment scores (assignments, exercises, projects). Use the Class Score column on the right.
      </div>
      <ScoresEntry />
    </>
  );
}

function ExamScoresPanel() {
  return (
    <>
      <div className="info-banner">
        <strong>Exam Scores</strong> — these are end-of-term exam scores. Use the Exam Score column on the right.
      </div>
      <ScoresEntry />
    </>
  );
}
