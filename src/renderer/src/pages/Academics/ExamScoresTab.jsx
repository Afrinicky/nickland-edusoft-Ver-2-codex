// Nickland Edusoft — Exam Scores (WHONET-style, all subjects on one sheet)
// Per subject: a 100% column then its converted exam-weight% column.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

export default function ExamScoresTab() {
  const { classes, currentTerm } = useStore();
  const showToast = useStore(s => s.showToast);
  const [classId, setClassId] = useState('');
  const [sheet, setSheet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState({});   // key 'studentId|subjectId' -> value
  const [dirty, setDirty] = useState({});
  const [savingAll, setSavingAll] = useState(false);

  async function loadSheet() {
    if (!classId || !currentTerm) { setSheet(null); return; }
    setLoading(true);
    const data = await window.api.scores.examSheet({ classId, termId: currentTerm.id });
    setSheet(data);
    const seed = {};
    for (const st of data.students) {
      for (const sub of data.subjects) {
        const v = st.exam_scores[sub.id];
        seed[`${st.student_id}|${sub.id}`] = v != null ? String(v) : '';
      }
    }
    setInputs(seed);
    setDirty({});
    setLoading(false);
  }
  useEffect(() => { loadSheet(); }, [classId, currentTerm?.id]);

  function setScore(studentId, subjectId, value) {
    const key = `${studentId}|${subjectId}`;
    setInputs(prev => ({ ...prev, [key]: value }));
    setDirty(prev => ({ ...prev, [key]: true }));
  }

  async function saveAll() {
    const keys = Object.keys(dirty).filter(k => dirty[k]);
    if (keys.length === 0) { showToast('No changes to save', 'info'); return; }
    setSavingAll(true);
    for (const key of keys) {
      const [studentId, subjectId] = key.split('|').map(Number);
      let examScore = parseFloat(inputs[key]) || 0;
      if (examScore > 100) examScore = 100;
      await window.api.scores.saveExamMark({ studentId, subjectId, termId: currentTerm.id, examScore });
    }
    setSavingAll(false);
    showToast(`Saved ${keys.length} exam score${keys.length > 1 ? 's' : ''}`, 'success');
    loadSheet();
  }

  const hasDirty = Object.values(dirty).some(Boolean);

  return (
    <div className="exam-scores-tab">
      <div className="card no-print">
        <div className="section-header">
          <div>
            <div className="section-title">Exam Scores</div>
            <div className="text-sm text-muted">
              Enter each subject's exam mark out of 100. Each converts to {sheet?.exam_weight || 60}% of the final grade.
            </div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => window.print()}>🖨 Print</button>
        </div>
        <div className="form-row" style={{ marginTop: 14 }}>
          <div className="form-group">
            <label>Class</label>
            <select value={classId} onChange={e => setClassId(e.target.value)}>
              <option value="">— Select Class —</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Term</label>
            <div style={{ fontWeight: 600, padding: '8px 0' }}>{currentTerm?.label || '—'}</div>
          </div>
        </div>
      </div>

      {!classId
        ? <div className="card empty-state" style={{ marginTop: 16, padding: 40 }}>Select a class to begin</div>
        : loading
          ? <div className="card" style={{ marginTop: 16, padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
          : sheet && (
            <>
              <div className="card no-print" style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="text-sm text-muted">{sheet.subjects.length} subjects · {sheet.students.length} students</span>
                <div style={{ flex: 1 }} />
                <button className={'btn ' + (hasDirty ? 'btn-success' : 'btn-ghost')}
                  disabled={!hasDirty || savingAll} onClick={saveAll}>
                  {savingAll ? 'Saving…' : hasDirty ? '💾 Save Changes' : 'All Saved'}
                </button>
              </div>

              <div className="card" style={{ marginTop: 16, padding: 0 }}>
                <div className="sheet-wrap">
                  <table className="sheet-table scores-table">
                    <thead>
                      <tr>
                        <th className="sheet-row-num-header" rowSpan="2">#</th>
                        <th style={{ minWidth: 90 }} rowSpan="2">Index No.</th>
                        <th style={{ minWidth: 150 }} rowSpan="2">Name</th>
                        {sheet.subjects.map(sub => (
                          <th key={sub.id} colSpan="2" className="exam-subject-header">{sub.name}</th>
                        ))}
                      </tr>
                      <tr>
                        {sheet.subjects.map(sub => (
                          <React.Fragment key={sub.id}>
                            <th className="exam-sub-col">Exam<br/><span className="text-xs">/100</span></th>
                            <th className="exam-sub-col exam-converted-col">{sheet.exam_weight}%</th>
                          </React.Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.students.map((st, i) => (
                        <tr key={st.student_id}>
                          <td className="sheet-row-num">{i + 1}</td>
                          <td className="sheet-cell" style={{ fontFamily: 'monospace', fontSize: 11 }}>{st.index_number}</td>
                          <td className="sheet-cell"><strong>{st.surname}</strong>, {st.first_name}</td>
                          {sheet.subjects.map(sub => {
                            const key = `${st.student_id}|${sub.id}`;
                            const raw = parseFloat(inputs[key]) || 0;
                            const converted = Math.round((Math.min(raw, 100) / 100) * sheet.exam_weight * 100) / 100;
                            return (
                              <React.Fragment key={sub.id}>
                                <td className="sheet-cell assessment-cell">
                                  <input type="number" min="0" max="100" step="0.5"
                                    value={inputs[key] ?? ''}
                                    onChange={e => setScore(st.student_id, sub.id, e.target.value)}
                                    className={'assessment-mark-input' + (dirty[key] ? ' dirty' : '')}
                                  />
                                </td>
                                <td className="sheet-cell text-center exam-converted-cell"
                                  style={{ fontWeight: 600, color: 'var(--primary)' }}>
                                  {converted}
                                </td>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="sheet-help no-print" style={{ marginTop: 12 }}>
                <strong>How to use:</strong> Enter each exam mark out of 100 · The {sheet.exam_weight}% column converts automatically · Click <strong>Save Changes</strong> (green) to persist · This sheet holds exam scores only — class scores are on the Class Scores tab · The {100 - sheet.exam_weight}/{sheet.exam_weight} split is set in Settings → Grading.
              </div>
            </>
          )
      }
    </div>
  );
}
