// Nickland Edusoft — Assessment Compilation Tab (End-of-Term layout, editable)
import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/index.js';

const qualitativeFields = [
  ['conduct_traits', 'Conduct'],
  ['learner_interests', 'Interest'],
  ['learner_talents', 'Talent'],
  ['teacher_remarks', "Teacher's Remarks"],
];

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

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
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    (async () => {
      const list = await window.api.settings.listTerms();
      setTerms(list);
      setTermId(String(currentTerm?.id || list.find(t => t.is_current)?.id || list[0]?.id || ''));
    })();
  }, [currentTerm?.id]);

  function seedInputs(data) {
    const seed = {};
    for (const st of data.students) {
      for (const sub of data.subjects) {
        seed[`${st.student_id}|class|${sub.id}`] = st.subject_scores[sub.id]?.class_score ?? '';
        seed[`${st.student_id}|exam|${sub.id}`] = st.subject_scores[sub.id]?.exam_score ?? '';
      }
      seed[`${st.student_id}|summary|days_present`] = st.summary?.days_present ?? '';
      seed[`${st.student_id}|summary|total_days`] = st.summary?.total_days ?? '';
      for (const [field] of qualitativeFields) seed[`${st.student_id}|summary|${field}`] = st.summary?.[field] ?? '';
    }
    setInputs(seed);
    setDirty({});
  }

  async function loadSheet() {
    if (!classId || !termId) { setSheet(null); return; }
    setLoading(true);
    try {
      const data = await window.api.scores.assessmentCompilationSheet({ classId, termId });
      setSheet(data);
      seedInputs(data);
    } catch (err) {
      console.error(err);
      showToast(`Failed to load assessment compilation: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSheet(); }, [classId, termId]);

  function setCell(key, value) {
    setInputs(prev => ({ ...prev, [key]: value }));
    setDirty(prev => ({ ...prev, [key]: true }));
  }

  const computedRows = useMemo(() => {
    if (!sheet) return [];
    const rows = sheet.students.map(st => {
      const perSubject = {};
      let grandTotal = 0;
      let subjectCount = 0;
      for (const sub of sheet.subjects) {
        const classScore = parseFloat(inputs[`${st.student_id}|class|${sub.id}`]) || 0;
        const examScore = parseFloat(inputs[`${st.student_id}|exam|${sub.id}`]) || 0;
        const total = round2(classScore + examScore);
        perSubject[sub.id] = { class_score: round2(classScore), exam_score: round2(examScore), total };
        if (total > 0) { grandTotal += total; subjectCount += 1; }
      }
      return { ...st, perSubject, grand_total: round2(grandTotal), average: subjectCount ? round2(grandTotal / subjectCount) : 0 };
    });
    [...rows].sort((a, b) => b.average - a.average).forEach((row, idx) => { row.position = row.average > 0 ? idx + 1 : ''; });
    return rows;
  }, [sheet, inputs]);

  function validateSheet() {
    if (!classId || !termId) return 'Select both Class and Term before saving.';
    if (!sheet) return 'Load a sheet before saving.';
    for (const row of computedRows) {
      for (const sub of sheet.subjects) {
        const classValue = inputs[`${row.student_id}|class|${sub.id}`];
        const examValue = inputs[`${row.student_id}|exam|${sub.id}`];
        if (classValue !== '' && (Number.isNaN(Number(classValue)) || Number(classValue) < 0 || Number(classValue) > sheet.class_weight)) {
          return `Cls ${sheet.class_weight}% for ${row.surname}, ${row.first_name} in ${sub.name} must be between 0 and ${sheet.class_weight}.`;
        }
        if (examValue !== '' && (Number.isNaN(Number(examValue)) || Number(examValue) < 0 || Number(examValue) > sheet.exam_weight)) {
          return `Exam ${sheet.exam_weight}% for ${row.surname}, ${row.first_name} in ${sub.name} must be between 0 and ${sheet.exam_weight}.`;
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

  function buildSavePayload() {
    return { classId, termId, students: computedRows.map(row => ({
      student_id: row.student_id,
      subjects: sheet.subjects.map(sub => ({
        subject_id: sub.id,
        class_score: inputs[`${row.student_id}|class|${sub.id}`] ?? '',
        exam_score: inputs[`${row.student_id}|exam|${sub.id}`] ?? '',
      })),
      summary: {
        days_present: inputs[`${row.student_id}|summary|days_present`] ?? '',
        total_days: inputs[`${row.student_id}|summary|total_days`] ?? '',
        ...Object.fromEntries(qualitativeFields.map(([field]) => [field, inputs[`${row.student_id}|summary|${field}`] ?? ''])),
      },
    })) };
  }

  async function saveChanges() {
    const validationError = validateSheet();
    if (validationError) { showToast(validationError, 'error'); return; }
    setSaving(true);
    const res = await window.api.scores.saveAssessmentCompilation(buildSavePayload());
    setSaving(false);
    if (res?.ok) {
      showToast('Assessment compilation saved and recalculated', 'success');
      await loadSheet();
    } else {
      showToast(res?.error || 'Could not save assessment compilation', 'error');
    }
  }

  async function exportExcel() {
    if (!classId || !termId) { showToast('Select a class and term before exporting', 'error'); return; }
    setExporting(true);
    try {
      const selectedClass = classes.find(c => String(c.id) === String(classId));
      const selectedTerm = terms.find(t => String(t.id) === String(termId));
      const res = await window.api.app.showSaveDialog({
        title: 'Export Assessment Compilation',
        defaultPath: `assessment_compilation_${selectedClass?.name || 'class'}_${selectedTerm?.label || 'term'}.xlsx`,
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      });
      if (res.canceled || !res.filePath) return;
      const out = await window.api.scores.exportAssessmentCompilation({ classId, termId, savePath: res.filePath });
      if (out?.ok) showToast(`Exported ${out.count} students`, 'success');
      else showToast(out?.error || 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  }

  async function importExcel() {
    if (!classId || !termId) { showToast('Select a class and term before importing', 'error'); return; }
    setImporting(true);
    try {
      const res = await window.api.app.showOpenDialog({
        title: 'Import Assessment Compilation',
        properties: ['openFile'],
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      });
      if (res.canceled || !res.filePaths?.[0]) return;
      const preview = await window.api.scores.importAssessmentCompilation({ classId, termId, filePath: res.filePaths[0], commit: false });
      if (!preview?.ok) { showToast(preview?.error || 'Import validation failed', 'error'); return; }
      const message = `Import ${preview.validCount} valid row(s)` + (preview.errors?.length ? ` with ${preview.errors.length} warning/error(s).` : '.') + '\n\nCommit valid rows now?';
      if (!window.confirm(message)) return;
      const committed = await window.api.scores.importAssessmentCompilation({ classId, termId, filePath: res.filePaths[0], commit: true });
      if (committed?.ok) {
        showToast(`Imported and saved ${committed.savedCount} row(s)`, 'success');
        await loadSheet();
      } else {
        showToast(committed?.error || 'Import failed', 'error');
      }
    } finally {
      setImporting(false);
    }
  }

  const hasDirty = Object.values(dirty).some(Boolean);

  return <div className="assessment-compilation-tab">
    <div className="card no-print">
      <div className="section-header">
        <div>
          <div className="section-title">Assessment Compilation</div>
          <div className="text-sm text-muted">Editable compilation sheet: Cls ({sheet?.class_weight || 40}%) + Exam ({sheet?.exam_weight || 60}%) per mapped subject.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm" disabled={!classId || !termId || exporting} onClick={exportExcel}>📥 {exporting ? 'Exporting…' : 'Export'}</button>
          <button className="btn btn-outline btn-sm" disabled={!classId || !termId || importing} onClick={importExcel}>📤 {importing ? 'Importing…' : 'Import'}</button>
          <button className={'btn ' + (hasDirty ? 'btn-success' : 'btn-ghost')} disabled={!hasDirty || saving} onClick={saveChanges}>{saving ? 'Saving…' : hasDirty ? '💾 Save Changes' : 'All Saved'}</button>
        </div>
      </div>
      <div className="form-row" style={{ marginTop: 14 }}>
        <div className="form-group"><label>Class</label><select value={classId} onChange={e => setClassId(e.target.value)}><option value="">— Select Class —</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="form-group"><label>Term</label><select value={termId} onChange={e => setTermId(e.target.value)}><option value="">— Select Term —</option>{terms.map(t => <option key={t.id} value={t.id}>{t.label} {t.year_label ? `(${t.year_label})` : ''}</option>)}</select></div>
      </div>
    </div>

    {!classId || !termId ? <div className="card empty-state" style={{ marginTop: 16, padding: 40 }}>Select a class and term to open the assessment compilation sheet.</div>
      : loading ? <div className="card" style={{ marginTop: 16, padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
      : sheet && <>
        <div className="sheet-help no-print" style={{ marginTop: 12 }}><strong>Subjects:</strong> {sheet.subjects.length ? sheet.subjects.map(s => s.name).join(', ') : 'No active subjects found.'} {sheet.used_fallback_subjects ? <span className="text-muted">No mapped subjects were found for this class, so all active subjects are shown.</span> : null}</div>
        <div className="card" style={{ marginTop: 16, padding: 0 }}><div className="sheet-wrap"><table className="sheet-table scores-table assessment-compilation-table"><thead><tr><th className="sheet-row-num-header" rowSpan="2">Pos.</th><th style={{ minWidth: 90 }} rowSpan="2">Index No.</th><th style={{ minWidth: 160 }} rowSpan="2">Name</th>{sheet.subjects.map(sub => <th key={sub.id} colSpan="3" className="exam-subject-header">{sub.name}</th>)}<th style={{ minWidth: 90 }} rowSpan="2" className="text-center">Overall Total</th><th style={{ minWidth: 75 }} rowSpan="2" className="text-center">Average</th><th style={{ minWidth: 75 }} rowSpan="2" className="text-center">Rank</th><th style={{ minWidth: 92 }} rowSpan="2" className="text-center">Attendance<br/>Present</th><th style={{ minWidth: 92 }} rowSpan="2" className="text-center">Days<br/>Opened</th>{qualitativeFields.map(([, label]) => <th key={label} style={{ minWidth: 160 }} rowSpan="2">{label}</th>)}</tr><tr>{sheet.subjects.map(sub => <React.Fragment key={sub.id}><th className="exam-sub-col text-xs">Cls<br/>{sheet.class_weight}%</th><th className="exam-sub-col text-xs">Exam<br/>{sheet.exam_weight}%</th><th className="exam-sub-col exam-converted-col text-xs">Total<br/>100%</th></React.Fragment>)}</tr></thead><tbody>{computedRows.map(row => <tr key={row.student_id}><td className="sheet-row-num">{row.position || '—'}</td><td className="sheet-cell sheet-cell-readonly" style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.index_number}</td><td className="sheet-cell sheet-cell-readonly"><strong>{row.surname}</strong>, {row.first_name}</td>{sheet.subjects.map(sub => { const classKey = `${row.student_id}|class|${sub.id}`; const examKey = `${row.student_id}|exam|${sub.id}`; const ps = row.perSubject[sub.id] || { total: 0 }; return <React.Fragment key={sub.id}><td className="sheet-cell assessment-cell"><input type="number" min="0" max={sheet.class_weight} step="0.5" value={inputs[classKey] ?? ''} onChange={e => setCell(classKey, e.target.value)} className={'assessment-mark-input' + (dirty[classKey] ? ' dirty' : '')} /></td><td className="sheet-cell assessment-cell"><input type="number" min="0" max={sheet.exam_weight} step="0.5" value={inputs[examKey] ?? ''} onChange={e => setCell(examKey, e.target.value)} className={'assessment-mark-input' + (dirty[examKey] ? ' dirty' : '')} /></td><td className="sheet-cell text-center exam-converted-cell" style={{ fontWeight: 600 }}>{ps.total}</td></React.Fragment>; })}<td className="sheet-cell sheet-cell-readonly text-center" style={{ fontWeight: 700 }}>{row.grand_total}</td><td className="sheet-cell sheet-cell-readonly text-center" style={{ fontWeight: 700, color: 'var(--primary)' }}>{row.average}</td><td className="sheet-cell sheet-cell-readonly text-center">{row.position || '—'}</td>{['days_present', 'total_days'].map(field => { const key = `${row.student_id}|summary|${field}`; return <td key={field} className="sheet-cell assessment-cell"><input type="number" min="0" step="1" value={inputs[key] ?? ''} onChange={e => setCell(key, e.target.value)} className={'assessment-mark-input' + (dirty[key] ? ' dirty' : '')} /></td>; })}{qualitativeFields.map(([field]) => { const key = `${row.student_id}|summary|${field}`; return <td key={field} className="sheet-cell sheet-cell-editable"><input type="text" value={inputs[key] ?? ''} onChange={e => setCell(key, e.target.value)} className="assessment-text-input" /></td>; })}</tr>)}</tbody></table></div></div>
        <div className="sheet-help no-print" style={{ marginTop: 12 }}><strong>Editable:</strong> Cls {sheet.class_weight}%, Exam {sheet.exam_weight}%, attendance, conduct, interest, talent, and remarks. <strong>Locked:</strong> subject totals, overall total, average, and rank.</div>
      </>}
  </div>;
}
