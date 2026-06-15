// Nickland Edusoft — Assessment Compilation Tab (foundation sheet)
import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/index.js';

const summaryFields = [
  ['days_present', 'Attendance Present', 'number'],
  ['total_days', 'Attendance Total', 'number'],
  ['conduct_traits', 'Conduct Traits', 'text'],
  ['learner_interests', 'Learner Interests', 'text'],
  ['learner_talents', 'Learner Talents', 'text'],
  ['teacher_remarks', "Teacher's Remarks", 'text'],
];

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const ordinal = n => {
  if (!n) return '—';
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
};

export default function AssessmentCompilationTab() {
  const { classes, currentTerm } = useStore();
  const showToast = useStore(s => s.showToast);
  const [terms, setTerms] = useState([]);
  const [classId, setClassId] = useState('');
  const [termId, setTermId] = useState('');
  const [sheet, setSheet] = useState(null);
  const [inputs, setInputs] = useState({});
  const [dirty, setDirty] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const list = await window.api.settings.listTerms();
      setTerms(list);
      setTermId(String(currentTerm?.id || list.find(t => t.is_current)?.id || list[0]?.id || ''));
    })();
  }, [currentTerm?.id]);

  useEffect(() => {
    if (!classId || !termId) { setSheet(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await window.api.scores.assessmentCompilationSheet({ classId, termId });
      if (cancelled) return;
      const seed = {};
      for (const st of data.students) {
        for (const sub of data.subjects) {
          seed[`${st.student_id}|class|${sub.id}`] = st.subject_scores[sub.id]?.class_score ?? '';
          seed[`${st.student_id}|exam|${sub.id}`] = st.subject_scores[sub.id]?.exam_score ?? '';
        }
        for (const [field] of summaryFields) seed[`${st.student_id}|summary|${field}`] = st.summary?.[field] ?? '';
      }
      setSheet(data);
      setInputs(seed);
      setDirty({});
      setLoading(false);
    })().catch(err => {
      console.error(err);
      showToast(`Failed to load assessment compilation: ${err.message}`, 'error');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [classId, termId, showToast]);

  function setCell(key, value) {
    setInputs(prev => ({ ...prev, [key]: value }));
    setDirty(prev => ({ ...prev, [key]: true }));
  }

  const computedRows = useMemo(() => {
    if (!sheet) return [];
    const rows = sheet.students.map(st => {
      const subjectTotals = {};
      let overall = 0;
      let count = 0;
      for (const sub of sheet.subjects) {
        const cls = parseFloat(inputs[`${st.student_id}|class|${sub.id}`]) || 0;
        const examRaw = parseFloat(inputs[`${st.student_id}|exam|${sub.id}`]) || 0;
        const examConverted = round2((examRaw / 100) * sheet.exam_weight);
        const total = round2(cls + examConverted);
        subjectTotals[sub.id] = total;
        if (total > 0) { overall += total; count += 1; }
      }
      return { ...st, subjectTotals, overall: round2(overall), average: count ? round2(overall / count) : 0 };
    });
    [...rows].sort((a, b) => b.average - a.average).forEach((r, idx) => { r.position = idx + 1; });
    return rows;
  }, [sheet, inputs]);

  function validateSheet() {
    if (!classId || !termId) return 'Select both Class and Term before saving.';
    for (const row of computedRows) {
      for (const sub of sheet.subjects) {
        const classValue = inputs[`${row.student_id}|class|${sub.id}`];
        const examValue = inputs[`${row.student_id}|exam|${sub.id}`];
        if (classValue !== '' && (Number.isNaN(Number(classValue)) || Number(classValue) < 0 || Number(classValue) > sheet.class_weight)) {
          return `Class score for ${row.surname}, ${row.first_name} in ${sub.name} must be between 0 and ${sheet.class_weight}.`;
        }
        if (examValue !== '' && (Number.isNaN(Number(examValue)) || Number(examValue) < 0 || Number(examValue) > 100)) {
          return `Exam score for ${row.surname}, ${row.first_name} in ${sub.name} must be between 0 and 100.`;
        }
      }
      for (const field of ['days_present', 'total_days']) {
        const value = inputs[`${row.student_id}|summary|${field}`];
        if (value !== '' && (Number.isNaN(Number(value)) || Number(value) < 0 || !Number.isInteger(Number(value)))) {
          return `${field === 'days_present' ? 'Attendance Present' : 'Attendance Total'} for ${row.surname}, ${row.first_name} must be a whole number of days.`;
        }
      }
      const present = Number(inputs[`${row.student_id}|summary|days_present`] || 0);
      const total = Number(inputs[`${row.student_id}|summary|total_days`] || 0);
      if (present > total && total > 0) return `Attendance Present cannot exceed Attendance Total for ${row.surname}, ${row.first_name}.`;
    }
    return '';
  }

  async function loadSheet() {
    if (!classId || !termId) { setSheet(null); return; }
    setLoading(true);
    const data = await window.api.scores.assessmentCompilationSheet({ classId, termId });
    const seed = {};
    for (const st of data.students) {
      for (const sub of data.subjects) {
        seed[`${st.student_id}|class|${sub.id}`] = st.subject_scores[sub.id]?.class_score ?? '';
        seed[`${st.student_id}|exam|${sub.id}`] = st.subject_scores[sub.id]?.exam_score ?? '';
      }
      for (const [field] of summaryFields) seed[`${st.student_id}|summary|${field}`] = st.summary?.[field] ?? '';
    }
    setSheet(data);
    setInputs(seed);
    setDirty({});
    setLoading(false);
  }

  async function saveChanges() {
    if (!sheet) return;
    const validationError = validateSheet();
    if (validationError) { showToast(validationError, 'error'); return; }
    setSaving(true);
    const payload = { classId, termId, students: computedRows.map(row => ({
      student_id: row.student_id,
      total_score_all: row.overall,
      average_score: row.average,
      class_rank: row.position,
      number_on_roll: computedRows.length,
      subjects: sheet.subjects.map(sub => ({
        subject_id: sub.id,
        class_score: parseFloat(inputs[`${row.student_id}|class|${sub.id}`]) || 0,
        exam_score: parseFloat(inputs[`${row.student_id}|exam|${sub.id}`]) || 0,
        total_score: row.subjectTotals[sub.id] || 0,
      })),
      summary: Object.fromEntries(summaryFields.map(([field]) => [field, inputs[`${row.student_id}|summary|${field}`] ?? ''])),
    })) };
    const res = await window.api.scores.saveAssessmentCompilation(payload);
    setSaving(false);
    if (res?.ok) {
      showToast('Assessment compilation saved and recalculated', 'success');
      await loadSheet();
    } else {
      showToast(res?.error || 'Could not save assessment compilation', 'error');
    }
  }

  const hasDirty = Object.values(dirty).some(Boolean);

  return <div className="assessment-compilation-tab">
    <div className="card no-print">
      <div className="section-header">
        <div>
          <div className="section-title">Assessment Compilation</div>
          <div className="text-sm text-muted">Excel-like foundation sheet for selected class and term. Import, export, and printing are intentionally not included in this phase.</div>
        </div>
        <button className={'btn ' + (hasDirty ? 'btn-success' : 'btn-ghost')} disabled={!hasDirty || saving} onClick={saveChanges}>{saving ? 'Saving…' : hasDirty ? '💾 Save Changes' : 'All Saved'}</button>
      </div>
      <div className="form-row" style={{ marginTop: 14 }}>
        <div className="form-group"><label>Class</label><select value={classId} onChange={e => setClassId(e.target.value)}><option value="">— Select Class —</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="form-group"><label>Term</label><select value={termId} onChange={e => setTermId(e.target.value)}><option value="">— Select Term —</option>{terms.map(t => <option key={t.id} value={t.id}>{t.label} {t.year_label ? `(${t.year_label})` : ''}</option>)}</select></div>
      </div>
    </div>

    {!classId || !termId ? <div className="card empty-state" style={{ marginTop: 16, padding: 40 }}>Select a class and term to open the assessment compilation sheet.</div>
      : loading ? <div className="card" style={{ marginTop: 16, padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
      : sheet && <>
        <div className="sheet-help no-print" style={{ marginTop: 12 }}><strong>Subjects:</strong> {sheet.subjects.length ? sheet.subjects.map(s => s.name).join(', ') : 'No active subjects found.'} {sheet.used_fallback_subjects ? <span className="text-muted">Mapped subjects were not found for this class, so all active subjects are shown.</span> : null}</div>
        <div className="card" style={{ marginTop: 16, padding: 0 }}><div className="sheet-wrap"><table className="sheet-table scores-table assessment-compilation-table"><thead><tr><th className="sheet-row-num-header">#</th><th style={{ minWidth: 95 }}>Index No.</th><th style={{ minWidth: 180 }}>Student</th>{summaryFields.slice(0,2).map(([, label]) => <th key={label} style={{ minWidth: 100 }}>{label}</th>)}{sheet.subjects.map(sub => <th key={`c-${sub.id}`} style={{ minWidth: 95 }}>{sub.name}<br/><span className="text-xs">Class Raw</span></th>)}{sheet.subjects.map(sub => <th key={`e-${sub.id}`} style={{ minWidth: 95 }}>{sub.name}<br/><span className="text-xs">Exam Raw</span></th>)}{sheet.subjects.map(sub => <th key={`t-${sub.id}`} className="sheet-cell-readonly" style={{ minWidth: 90 }}>{sub.name}<br/><span className="text-xs">Total</span></th>)}<th className="sheet-cell-readonly">Overall</th><th className="sheet-cell-readonly">Average</th><th className="sheet-cell-readonly">Position</th>{summaryFields.slice(2).map(([, label]) => <th key={label} style={{ minWidth: 160 }}>{label}</th>)}</tr></thead><tbody>{computedRows.map((st, i) => <tr key={st.student_id}><td className="sheet-row-num">{i + 1}</td><td className="sheet-cell sheet-cell-readonly" style={{ fontFamily: 'monospace', fontSize: 11 }}>{st.index_number}</td><td className="sheet-cell sheet-cell-readonly"><strong>{st.surname}</strong>, {st.first_name}</td>{summaryFields.slice(0,2).map(([field,, type]) => { const key = `${st.student_id}|summary|${field}`; return <td key={field} className="sheet-cell sheet-cell-editable"><input type={type} min="0" value={inputs[key] ?? ''} onChange={e => setCell(key, e.target.value)} className="assessment-mark-input" /></td>; })}{sheet.subjects.map(sub => { const key = `${st.student_id}|class|${sub.id}`; return <td key={key} className="sheet-cell sheet-cell-editable"><input type="number" min="0" step="0.5" value={inputs[key] ?? ''} onChange={e => setCell(key, e.target.value)} className="assessment-mark-input" /></td>; })}{sheet.subjects.map(sub => { const key = `${st.student_id}|exam|${sub.id}`; return <td key={key} className="sheet-cell sheet-cell-editable"><input type="number" min="0" max="100" step="0.5" value={inputs[key] ?? ''} onChange={e => setCell(key, e.target.value)} className="assessment-mark-input" /></td>; })}{sheet.subjects.map(sub => <td key={`total-${sub.id}`} className="sheet-cell sheet-cell-readonly text-center" style={{ fontWeight: 600 }}>{st.subjectTotals[sub.id]}</td>)}<td className="sheet-cell sheet-cell-readonly text-center" style={{ fontWeight: 700 }}>{st.overall}</td><td className="sheet-cell sheet-cell-readonly text-center" style={{ fontWeight: 700 }}>{st.average}</td><td className="sheet-cell sheet-cell-readonly text-center">{ordinal(st.position)}</td>{summaryFields.slice(2).map(([field,, type]) => { const key = `${st.student_id}|summary|${field}`; return <td key={field} className="sheet-cell sheet-cell-editable"><input type={type} value={inputs[key] ?? ''} onChange={e => setCell(key, e.target.value)} className="assessment-text-input" /></td>; })}</tr>)}</tbody></table></div></div>
        <div className="sheet-help no-print" style={{ marginTop: 12 }}><strong>Editable:</strong> attendance, subject class raw, subject exam raw, conduct, interests, talents, and remarks. <strong>Locked:</strong> identity, subject totals, overall total, average, and position.</div>
      </>}
  </div>;
}
