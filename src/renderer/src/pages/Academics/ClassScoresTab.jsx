// Nickland Edusoft — Class Scores (WHONET-style, per subject)
// Configurable assessment columns; each hosts marks; auto-sum; auto-convert to class-weight%.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

const ASSESSMENT_TYPES = ['Assignment', 'Quiz', 'Class Test', 'Mid-Sem Exams', 'Project', 'Group Work', 'Practical', 'Homework'];

export default function ClassScoresTab() {
  const { classes, currentTerm } = useStore();
  const showToast = useStore(s => s.showToast);
  const [subjects, setSubjects] = useState([]);
  const [availableSubjects, setAvailableSubjects] = useState([]);
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [sheet, setSheet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [markInputs, setMarkInputs] = useState({});  // key 'studentId|colId' -> value
  const [dirty, setDirty] = useState({});             // key -> true when changed
  const [savingAll, setSavingAll] = useState(false);

  useEffect(() => {
    (async () => {
      const allSubjects = await window.api.scores.listSubjects();
      setSubjects(allSubjects);
      setAvailableSubjects(allSubjects);
    })();
  }, []);

  useEffect(() => {
    if (!classId) {
      setAvailableSubjects(subjects);
      return;
    }

    let cancelled = false;
    (async () => {
      const mappedSubjects = await window.api.settings.getClassSubjects(classId);
      const nextSubjects = mappedSubjects.length > 0 ? mappedSubjects : subjects;
      if (cancelled) return;
      setAvailableSubjects(nextSubjects);
      if (subjectId && !nextSubjects.some(s => String(s.id) === String(subjectId))) {
        setSubjectId('');
      }
    })();

    return () => { cancelled = true; };
  }, [classId, subjects, subjectId]);

  async function loadSheet() {
    if (!classId || !subjectId || !currentTerm) { setSheet(null); return; }
    setLoading(true);
    const data = await window.api.scores.classSheet({ classId, subjectId, termId: currentTerm.id });
    setSheet(data);
    // Seed mark inputs from existing marks
    const seed = {};
    for (const st of data.students) {
      for (const col of data.columns) {
        seed[`${st.student_id}|${col.id}`] = st.marks[col.id] != null ? String(st.marks[col.id]) : '';
      }
    }
    setMarkInputs(seed);
    setDirty({});
    setLoading(false);
  }
  useEffect(() => { loadSheet(); }, [classId, subjectId, currentTerm?.id]);

  function setMark(studentId, colId, value) {
    const key = `${studentId}|${colId}`;
    setMarkInputs(prev => ({ ...prev, [key]: value }));
    setDirty(prev => ({ ...prev, [key]: true }));
  }

  async function saveAll() {
    const keys = Object.keys(dirty).filter(k => dirty[k]);
    if (keys.length === 0) { showToast('No changes to save', 'info'); return; }
    setSavingAll(true);
    for (const key of keys) {
      const [studentId, colId] = key.split('|').map(Number);
      const marks = parseFloat(markInputs[key]) || 0;
      await window.api.scores.saveAssessmentMark({ columnId: colId, studentId, marks });
    }
    setSavingAll(false);
    showToast(`Saved ${keys.length} mark${keys.length > 1 ? 's' : ''}`, 'success');
    loadSheet();
  }

  async function addColumn() {
    await window.api.scores.addAssessmentColumn({
      classId, subjectId, termId: currentTerm.id,
      assessmentType: 'Assignment', maxMarks: 10,
      displayOrder: (sheet?.columns.length || 0),
    });
    loadSheet();
  }
  async function updateColumn(colId, field, value) {
    const col = sheet.columns.find(c => c.id === colId);
    await window.api.scores.updateAssessmentColumn({
      id: colId,
      assessmentType: field === 'type' ? value : col.assessment_type,
      maxMarks: field === 'max' ? parseFloat(value) || 0 : col.max_marks,
    });
    loadSheet();
  }
  async function deleteColumn(colId) {
    if (!confirm('Delete this assessment column and all its marks?')) return;
    await window.api.scores.deleteAssessmentColumn(colId);
    loadSheet();
  }

  const hasDirty = Object.values(dirty).some(Boolean);

  return (
    <div className="class-scores-tab">
      <div className="card no-print">
        <div className="section-header">
          <div>
            <div className="section-title">Class Scores</div>
            <div className="text-sm text-muted">
              Continuous assessment — converts to {sheet?.class_weight || 40}% of the final grade. Each subject has its own sheet.
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
            <label>Subject</label>
            <select value={subjectId} onChange={e => setSubjectId(e.target.value)}>
              <option value="">— Select Subject —</option>
              {availableSubjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Term</label>
            <div style={{ fontWeight: 600, padding: '8px 0' }}>{currentTerm?.label || '—'}</div>
          </div>
        </div>
      </div>

      {!classId || !subjectId
        ? <div className="card empty-state" style={{ marginTop: 16, padding: 40 }}>Select a class and subject to begin</div>
        : loading
          ? <div className="card" style={{ marginTop: 16, padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
          : sheet && (
            <>
              {/* Save bar */}
              <div className="card no-print" style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button className="btn btn-outline btn-sm" onClick={addColumn}>+ Add Assessment Column</button>
                <div style={{ flex: 1 }} />
                <button
                  className={'btn ' + (hasDirty ? 'btn-success' : 'btn-ghost')}
                  disabled={!hasDirty || savingAll}
                  onClick={saveAll}
                >
                  {savingAll ? 'Saving…' : hasDirty ? '💾 Save Changes' : 'All Saved'}
                </button>
              </div>

              <div className="card" style={{ marginTop: 16, padding: 0 }}>
                <div className="sheet-wrap">
                  <table className="sheet-table scores-table">
                    <thead>
                      <tr>
                        <th className="sheet-row-num-header">#</th>
                        <th style={{ minWidth: 90 }}>Index No.</th>
                        <th style={{ minWidth: 150 }}>Name</th>
                        {sheet.columns.map(col => (
                          <th key={col.id} className="assessment-col-header">
                            <select
                              className="assessment-type-select"
                              value={col.assessment_type}
                              onChange={e => updateColumn(col.id, 'type', e.target.value)}
                            >
                              {ASSESSMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                              {!ASSESSMENT_TYPES.includes(col.assessment_type) && (
                                <option value={col.assessment_type}>{col.assessment_type}</option>
                              )}
                            </select>
                            <div className="assessment-col-max">
                              <span>/</span>
                              <input
                                type="number" min="1" step="1"
                                value={col.max_marks}
                                onChange={e => updateColumn(col.id, 'max', e.target.value)}
                                className="assessment-max-input"
                              />
                              <button className="assessment-col-delete" onClick={() => deleteColumn(col.id)} title="Delete column">×</button>
                            </div>
                          </th>
                        ))}
                        <th style={{ minWidth: 70 }} className="text-center">Total<br/><span className="text-xs">/{sheet.total_max}</span></th>
                        <th style={{ minWidth: 80 }} className="text-center">
                          Class Score<br/><span className="text-xs">({sheet.class_weight}%)</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.students.map((st, i) => {
                        // Live recompute as user types
                        let rawTotal = 0;
                        for (const col of sheet.columns) {
                          rawTotal += parseFloat(markInputs[`${st.student_id}|${col.id}`]) || 0;
                        }
                        const converted = sheet.total_max > 0
                          ? Math.round((rawTotal / sheet.total_max) * sheet.class_weight * 100) / 100
                          : 0;
                        return (
                          <tr key={st.student_id}>
                            <td className="sheet-row-num">{i + 1}</td>
                            <td className="sheet-cell" style={{ fontFamily: 'monospace', fontSize: 11 }}>{st.index_number}</td>
                            <td className="sheet-cell"><strong>{st.surname}</strong>, {st.first_name}</td>
                            {sheet.columns.map(col => {
                              const key = `${st.student_id}|${col.id}`;
                              return (
                                <td key={col.id} className="sheet-cell assessment-cell">
                                  <input
                                    type="number" min="0" max={col.max_marks} step="0.5"
                                    value={markInputs[key] ?? ''}
                                    onChange={e => setMark(st.student_id, col.id, e.target.value)}
                                    className={'assessment-mark-input' + (dirty[key] ? ' dirty' : '')}
                                  />
                                </td>
                              );
                            })}
                            <td className="sheet-cell text-center" style={{ fontWeight: 600 }}>{rawTotal}</td>
                            <td className="sheet-cell text-center" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                              {converted}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="sheet-help no-print" style={{ marginTop: 12 }}>
                <strong>How to use:</strong> Pick the assessment type from each column header dropdown and set its max marks · Add more columns with <strong>+ Add Assessment Column</strong> · Enter each student's marks · The <strong>Total</strong> and <strong>Class Score ({sheet.class_weight}%)</strong> compute live · Click <strong>Save Changes</strong> (green) to persist · The {sheet.class_weight}/{100 - sheet.class_weight} split is set in Settings → Grading.
              </div>
            </>
          )
      }
    </div>
  );
}
