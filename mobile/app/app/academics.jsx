// Academics.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React from 'react';
import { ModulePage } from '../../src/module';
import { RequireModule } from '../../src/appshell';
import AcademicDashboard from '../../src/screens/admin/academics';
import Homework from '../../src/screens/staff/homework';
import ClassScores from '../../src/screens/staff/assessments';
import ExamScores from '../../src/screens/staff/scores';
import Results from '../../src/screens/staff/results';
import Insight from '../../src/screens/staff/insight';
import TimetableTab from '../../src/screens/mod/timetable';
import Examinations from '../../src/screens/mod/examinations';
import {
  AcademicProfile, AssessmentCompilation, EndOfTermReport,
} from '../../src/screens/mod/academics';

export default function Academics() {
  return (
    <RequireModule moduleKey="academics">
      <ModulePage moduleKey="academics"
                  subtitle="Timetable, homework, scores, results, reports and student performance">
        {(tab) => {
          switch (tab) {
            case 'dashboard':   return <AcademicDashboard />;
            case 'profile':     return <AcademicProfile />;
            case 'timetable':   return <TimetableTab />;
            case 'homework':    return <Homework />;
            case 'classscores': return <ClassScores />;
            case 'examscores':  return <ExamScores />;
            case 'insight':     return <Insight />;
            case 'results':     return <Results />;
            case 'compilation': return <AssessmentCompilation />;
            case 'report':      return <EndOfTermReport />;
            case 'examinations':return <Examinations />;
            default:            return null;
          }
        }}
      </ModulePage>
    </RequireModule>
  );
}
