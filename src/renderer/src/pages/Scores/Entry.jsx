import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fullName } from '../../lib/format.js';

export default function ScoresEntry() {
  const classes = useStore(s => s.classes);
  const currentTerm = useStore(s => s.currentTerm);
  const showToast = useStore(s => s.showToast);
  const [classId, setClassId] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!classId || !currentTerm) return;
    setBusy(true);
    const res = await window.api.scores.listForClass(classId, currentTerm.id);
    // Build lookup map: { [studentId]: { [subjectId]: {class, exam} } }
    const scoreMap = {};
    for (const sc of res.scores) {
      if (!scoreMap[sc.student_id]) scoreMap[sc.student_id] = {};
      scoreMap[sc.student_id][sc.subject_id] = { class: sc.class_score, exam: sc.exam_score };
    }
    setData({ ...res, scoreMap });
    setBusy(false);
  }
  useEffect(() => { load(); }, [classId, currentTerm]);

  function setScore(studentId, subjectId, field, value) {
    const map = { ...data.scoreMap };
    if (!map[studentId]) map[studentId] = {};
    if (!map[studentId][subjectId]) map[studentId][subjectId] = { class: 0, exam: 0 };
    map[studentId][subjectId][field] = parseFloat(value) || 0;
    setData({ ...data, scoreMap: map });
  }

  async function saveAll() {
    const entries = [];
    for (const [studentId, subjects] of Object.entries(data.scoreMap)) {
      for (const [subjectId, scores] of Object.entries(subjects)) {
        if (scores.class > 0 || scores.exam > 0) {
          entries.push({
            student_id: parseInt(studentId),
            subject_id: parseInt(subjectId),
            term_id: currentTerm.id,
            class_score: scores.class || 0,
            exam_score: scores.exam || 0,
          });
        }
      }
    }
    await window.api.scores.saveBulk({ entries, summaries: [] });
    await window.api.scores.rankClass({ classId: parseInt(classId), termId: currentTerm.id });
    showToast('Scores saved & class ranked');
    load();
  }

  async function printReportCards() {
    const res = await window.api.reports.generateReportCards({
      termId: currentTerm.id, scope: 'class', classId: parseInt(classId)
    });
    if (res.ok) showToast(`Generated ${res.count} report cards`);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Scores & Reports</h1>
          <div className="page-subtitle">Enter end-of-term scores by class</div>
        </div>
        <div className="row gap-2">
          <select className="select" value={classId} onChange={e => setClassId(e.target.value)} style={{ minWidth: 220 }}>
            <option value="">— Pick a class —</option>
            {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
          </select>
          {data && data.students.length > 0 && (
            <>
              <button className="btn btn-primary" onClick={saveAll}>💾 Save scores</button>
              <button className="btn btn-accent" onClick={printReportCards}>🖨 Print class report cards</button>
            </>
          )}
        </div>
      </div>

      {!classId && (
        <div className="card empty-state">
          <h3>Pick a class above</h3>
          <p>You'll see all students and subjects in that class for the current term.</p>
        </div>
      )}

      {classId && data && data.subjects.length === 0 && (
        <div className="card empty-state">
          <h3>No subjects mapped to this class</h3>
          <p>Go to Settings → Subjects to map subjects to this class.</p>
        </div>
      )}

      {classId && data && data.students.length > 0 && data.subjects.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: 800 }}>
            <thead>
              <tr>
                <th>Student</th>
                {data.subjects.map(sub => (
                  <th key={sub.id} className="text-center" colSpan="2">{sub.name}</th>
                ))}
              </tr>
              <tr>
                <th></th>
                {data.subjects.map(sub => (
                  <React.Fragment key={sub.id}>
                    <th className="text-center text-sm" style={{ fontWeight: 400 }}>Class</th>
                    <th className="text-center text-sm" style={{ fontWeight: 400 }}>Exam</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.students.map(st => (
                <tr key={st.id}>
                  <td className="bold">{st.surname} {st.first_name}</td>
                  {data.subjects.map(sub => {
                    const entry = data.scoreMap[st.id]?.[sub.id] || {};
                    return (
                      <React.Fragment key={sub.id}>
                        <td><input className="input" type="number" step="0.1" min="0" max="40"
                          style={{ width: 60, padding: 4 }}
                          value={entry.class || ''}
                          onChange={e => setScore(st.id, sub.id, 'class', e.target.value)} /></td>
                        <td><input className="input" type="number" step="0.1" min="0" max="60"
                          style={{ width: 60, padding: 4 }}
                          value={entry.exam || ''}
                          onChange={e => setScore(st.id, sub.id, 'exam', e.target.value)} /></td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-muted text-sm mt-2">
            Class scores out of 40, Exam scores out of 60 (configurable per subject in Settings).
          </div>
        </div>
      )}
    </div>
  );
}
