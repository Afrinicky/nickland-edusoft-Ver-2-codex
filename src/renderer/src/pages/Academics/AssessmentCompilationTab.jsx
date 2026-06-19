// Nickland Edusoft — Assessment Compilation Tab (Excel-like foundation sheet)
import React, { useEffect, useMemo, useRef, useState } from 'react';
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

const isEditable = col => col && (col.type === 'number' || col.type === 'text');
const exportLabel = col => (col.subLabel ? `${col.label} ${col.subLabel}` : col.label);

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

  // ── Excel-like selection / editing state ───────────────
  // sel = { ar, ac, fr, fc } — anchor row/col + focus row/col (focus = active cell)
  const [sel, setSel] = useState(null);
  const [editing, setEditing] = useState(null); // { r, c } currently being edited
  const gridRef = useRef(null);
  const editorElRef = useRef(null);
  const draggingRef = useRef(false);
  const editMetaRef = useRef({ select: true });
  const editOriginalRef = useRef('');

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
      setSel(null);
      setEditing(null);
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

  // Apply a batch of { cellKey: value } updates (paste / delete / import).
  function applyUpdates(updates) {
    const keys = Object.keys(updates);
    if (!keys.length) return;
    setInputs(prev => ({ ...prev, ...updates }));
    setDirty(prev => {
      const next = { ...prev };
      for (const k of keys) next[k] = true;
      return next;
    });
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

  // ── Column model — single source of truth for rendering, copy/paste,
  //    export and import. Order mirrors the original on-screen layout. ──
  const columns = useMemo(() => {
    if (!sheet) return [];
    const cols = [];
    cols.push({ id: 'index', label: 'Index No.', type: 'readonly', minWidth: 95, mono: true, get: r => r.index_number });
    cols.push({ id: 'student', label: 'Student', type: 'readonly', minWidth: 180, get: r => `${r.surname}, ${r.first_name}`, render: r => <><strong>{r.surname}</strong>, {r.first_name}</> });
    cols.push({ id: 'days_present', label: 'Attendance Present', type: 'number', minWidth: 100, cellKey: r => `${r.student_id}|summary|days_present` });
    cols.push({ id: 'total_days', label: 'Attendance Total', type: 'number', minWidth: 100, cellKey: r => `${r.student_id}|summary|total_days` });
    for (const sub of sheet.subjects) cols.push({ id: `class:${sub.id}`, label: sub.name, subLabel: 'Class Raw', type: 'number', step: '0.5', min: '0', minWidth: 95, cellKey: r => `${r.student_id}|class|${sub.id}` });
    for (const sub of sheet.subjects) cols.push({ id: `exam:${sub.id}`, label: sub.name, subLabel: 'Exam Raw', type: 'number', step: '0.5', min: '0', max: '100', minWidth: 95, cellKey: r => `${r.student_id}|exam|${sub.id}` });
    for (const sub of sheet.subjects) cols.push({ id: `total:${sub.id}`, label: sub.name, subLabel: 'Total', type: 'readonly', center: true, bold: true, minWidth: 90, get: r => r.subjectTotals[sub.id] });
    cols.push({ id: 'overall', label: 'Overall', type: 'readonly', center: true, bold: true, get: r => r.overall });
    cols.push({ id: 'average', label: 'Average', type: 'readonly', center: true, bold: true, get: r => r.average });
    cols.push({ id: 'position', label: 'Position', type: 'readonly', center: true, get: r => ordinal(r.position), copy: r => r.position });
    cols.push({ id: 'conduct_traits', label: 'Conduct Traits', type: 'text', minWidth: 160, cellKey: r => `${r.student_id}|summary|conduct_traits` });
    cols.push({ id: 'learner_interests', label: 'Learner Interests', type: 'text', minWidth: 160, cellKey: r => `${r.student_id}|summary|learner_interests` });
    cols.push({ id: 'learner_talents', label: 'Learner Talents', type: 'text', minWidth: 160, cellKey: r => `${r.student_id}|summary|learner_talents` });
    cols.push({ id: 'teacher_remarks', label: "Teacher's Remarks", type: 'text', minWidth: 160, cellKey: r => `${r.student_id}|summary|teacher_remarks` });
    return cols;
  }, [sheet]);

  // Text value of a cell (used for copy + export + display of editables).
  function cellText(col, row) {
    if (col.cellKey) { const v = inputs[col.cellKey]; return v == null ? '' : String(v); }
    if (col.copy) { const v = col.copy(row); return v == null ? '' : String(v); }
    const v = col.get(row);
    return v == null ? '' : String(v);
  }

  function bounds() {
    if (!sel) return null;
    return {
      r1: Math.min(sel.ar, sel.fr), r2: Math.max(sel.ar, sel.fr),
      c1: Math.min(sel.ac, sel.fc), c2: Math.max(sel.ac, sel.fc),
    };
  }
  const inRange = (r, c) => { const b = bounds(); return b && r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2; };
  const isActive = (r, c) => sel && sel.fr === r && sel.fc === c;

  function focusGrid() {
    if (gridRef.current) gridRef.current.focus();
  }

  // ── Mouse selection ──
  function onCellMouseDown(e, r, c) {
    if (editing && editing.r === r && editing.c === c) return; // let the input handle it
    e.preventDefault();
    if (e.shiftKey && sel) setSel({ ...sel, fr: r, fc: c });
    else setSel({ ar: r, ac: c, fr: r, fc: c });
    setEditing(null);
    draggingRef.current = true;
    focusGrid();
  }
  function onCellMouseEnter(r, c) {
    if (!draggingRef.current) return;
    setSel(s => (s ? { ...s, fr: r, fc: c } : { ar: r, ac: c, fr: r, fc: c }));
  }
  useEffect(() => {
    const up = () => { draggingRef.current = false; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  function selectColumn(c) { setEditing(null); setSel({ ar: 0, ac: c, fr: computedRows.length - 1, fc: c }); focusGrid(); }
  function selectRow(r) { setEditing(null); setSel({ ar: r, ac: 0, fr: r, fc: columns.length - 1 }); focusGrid(); }
  function selectAll() { setEditing(null); setSel({ ar: 0, ac: 0, fr: computedRows.length - 1, fc: columns.length - 1 }); focusGrid(); }

  // ── Editing ──
  function beginEdit(r, c, { select = true, seed } = {}) {
    const col = columns[c];
    if (!isEditable(col)) return;
    const key = col.cellKey(computedRows[r]);
    editOriginalRef.current = inputs[key] ?? '';
    editMetaRef.current = { select };
    if (seed !== undefined) setCell(key, seed);
    setSel({ ar: r, ac: c, fr: r, fc: c });
    setEditing({ r, c });
  }
  useEffect(() => {
    if (editing && editorElRef.current) {
      const node = editorElRef.current;
      node.focus();
      if (editMetaRef.current.select) { try { node.select(); } catch { /* noop */ } }
      else { const len = node.value.length; try { node.setSelectionRange(len, len); } catch { /* noop */ } }
    }
  }, [editing]);

  function commitEditAndMove(dr, dc) {
    if (!editing) return;
    const { r, c } = editing;
    setEditing(null);
    const nr = Math.max(0, Math.min(computedRows.length - 1, r + dr));
    const nc = Math.max(0, Math.min(columns.length - 1, c + dc));
    setSel({ ar: nr, ac: nc, fr: nr, fc: nc });
    setTimeout(focusGrid, 0);
  }
  function cancelEdit() {
    if (!editing) return;
    const col = columns[editing.c];
    if (col && col.cellKey) setCell(col.cellKey(computedRows[editing.r]), editOriginalRef.current);
    setEditing(null);
    setTimeout(focusGrid, 0);
  }
  function onEditorKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); commitEditAndMove(1, 0); }
    else if (e.key === 'Tab') { e.preventDefault(); commitEditAndMove(0, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  }

  // ── Clipboard ──
  async function copySelection() {
    const b = bounds();
    if (!b) return;
    const lines = [];
    for (let r = b.r1; r <= b.r2; r++) {
      const parts = [];
      for (let c = b.c1; c <= b.c2; c++) parts.push(cellText(columns[c], computedRows[r]));
      lines.push(parts.join('\t'));
    }
    const text = lines.join('\n');
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* noop */ }
      document.body.removeChild(ta);
    }
  }
  async function pasteSelection() {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { showToast('Clipboard read is blocked — use the Import button instead.', 'error'); return; }
    if (!text) return;
    const grid = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (grid.length > 1 && grid[grid.length - 1] === '') grid.pop();
    const matrix = grid.map(l => l.split('\t'));
    const startR = sel.fr, startC = sel.fc;
    const updates = {};
    let widest = 0;
    for (let i = 0; i < matrix.length; i++) {
      const r = startR + i;
      if (r >= computedRows.length) break;
      widest = Math.max(widest, matrix[i].length);
      for (let j = 0; j < matrix[i].length; j++) {
        const c = startC + j;
        if (c >= columns.length) break;
        const col = columns[c];
        if (!isEditable(col)) continue;
        updates[col.cellKey(computedRows[r])] = matrix[i][j];
      }
    }
    applyUpdates(updates);
    const er = Math.min(computedRows.length - 1, startR + matrix.length - 1);
    const ec = Math.min(columns.length - 1, startC + Math.max(1, widest) - 1);
    setSel({ ar: startR, ac: startC, fr: er, fc: ec });
  }
  function clearSelection() {
    const b = bounds();
    if (!b) return;
    const updates = {};
    for (let r = b.r1; r <= b.r2; r++) {
      for (let c = b.c1; c <= b.c2; c++) {
        const col = columns[c];
        if (isEditable(col)) updates[col.cellKey(computedRows[r])] = '';
      }
    }
    applyUpdates(updates);
  }

  // ── Grid keyboard navigation ──
  function onGridKeyDown(e) {
    if (editing) return; // editor owns the keystrokes
    if (!sel || !computedRows.length) return;
    const rows = computedRows.length, ncols = columns.length;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (mod && (key === 'c' || key === 'C')) { e.preventDefault(); copySelection(); return; }
    if (mod && (key === 'v' || key === 'V')) { e.preventDefault(); pasteSelection(); return; }
    if (mod && (key === 'x' || key === 'X')) { e.preventDefault(); copySelection().then(clearSelection); return; }
    if (mod && (key === 'a' || key === 'A')) { e.preventDefault(); setSel({ ar: 0, ac: 0, fr: rows - 1, fc: ncols - 1 }); return; }
    if (key === 'Delete' || key === 'Backspace') { e.preventDefault(); clearSelection(); return; }

    const moveTo = (fr, fc) => {
      fr = Math.max(0, Math.min(rows - 1, fr));
      fc = Math.max(0, Math.min(ncols - 1, fc));
      if (e.shiftKey) setSel(s => ({ ...s, fr, fc }));
      else setSel({ ar: fr, ac: fc, fr, fc });
    };
    switch (key) {
      case 'ArrowUp': e.preventDefault(); moveTo(sel.fr - 1, sel.fc); return;
      case 'ArrowDown': e.preventDefault(); moveTo(sel.fr + 1, sel.fc); return;
      case 'ArrowLeft': e.preventDefault(); moveTo(sel.fr, sel.fc - 1); return;
      case 'ArrowRight': e.preventDefault(); moveTo(sel.fr, sel.fc + 1); return;
      case 'Home': e.preventDefault(); moveTo(sel.fr, 0); return;
      case 'End': e.preventDefault(); moveTo(sel.fr, ncols - 1); return;
      case 'Tab': {
        e.preventDefault();
        const nc = Math.max(0, Math.min(ncols - 1, sel.fc + (e.shiftKey ? -1 : 1)));
        setSel({ ar: sel.fr, ac: nc, fr: sel.fr, fc: nc });
        return;
      }
      case 'Enter': {
        e.preventDefault();
        if (isEditable(columns[sel.fc])) beginEdit(sel.fr, sel.fc, { select: true });
        else moveTo(sel.fr + 1, sel.fc);
        return;
      }
      case 'F2': {
        e.preventDefault();
        if (isEditable(columns[sel.fc])) beginEdit(sel.fr, sel.fc, { select: true });
        return;
      }
      default: {
        if (!mod && key.length === 1) {
          const col = columns[sel.fc];
          if (!isEditable(col)) return;
          if (col.type === 'number' && !/[0-9.\-]/.test(key)) return;
          e.preventDefault();
          beginEdit(sel.fr, sel.fc, { select: false, seed: key });
        }
      }
    }
  }

  // Keep the active cell scrolled into view (not while editing — the input
  // already manages its own caret).
  useEffect(() => {
    if (editing || !sel || !gridRef.current) return;
    const el = gridRef.current.querySelector('.ac-cell-active');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [sel, editing]);

  async function saveChanges() {
    if (!sheet) return;
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
    if (res?.ok) { setDirty({}); showToast('Assessment compilation saved', 'success'); }
    else showToast(res?.error || 'Could not save assessment compilation', 'error');
  }

  // ── Excel export / import ──
  function valueForExport(col, row) {
    if (col.cellKey) {
      const v = inputs[col.cellKey];
      if (v === '' || v == null) return '';
      if (col.type === 'number') { const n = parseFloat(v); return Number.isNaN(n) ? v : n; }
      return v;
    }
    if (col.copy) return col.copy(row);
    return col.get(row);
  }
  async function handleExport() {
    if (!sheet) return;
    const res = await window.api.app.showSaveDialog({
      title: 'Export Assessment Compilation',
      defaultPath: `assessment_compilation_${Date.now()}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (res.canceled || !res.filePath) return;
    const headers = columns.map(exportLabel);
    const rows = computedRows.map(row => columns.map(col => valueForExport(col, row)));
    const meta = {
      className: classes.find(c => String(c.id) === String(classId))?.name || '',
      term: (() => { const t = terms.find(t => String(t.id) === String(termId)); return t ? `${t.label}${t.year_label ? ` (${t.year_label})` : ''}` : ''; })(),
    };
    const out = await window.api.scores.exportAssessmentCompilation({ savePath: res.filePath, headers, rows, meta });
    if (out?.ok) showToast(`Exported ${out.count} student${out.count !== 1 ? 's' : ''} to Excel`, 'success');
    else showToast(out?.error || 'Export failed', 'error');
  }
  async function handleImport() {
    if (!sheet) return;
    const res = await window.api.app.showOpenDialog({
      title: 'Import Assessment Compilation',
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths?.length) return;
    const out = await window.api.scores.importAssessmentCompilation({ filePath: res.filePaths[0] });
    if (!out?.ok) { showToast(out?.error || 'Import failed', 'error'); return; }
    applyImport(out.headers || [], out.rows || []);
  }
  function applyImport(headers, rows) {
    const norm = s => String(s == null ? '' : s).trim().toLowerCase();
    const headerPos = {};
    headers.forEach((h, i) => { const k = norm(h); if (k && headerPos[k] === undefined) headerPos[k] = i; });
    const idxPos = headerPos[norm('Index No.')];
    if (idxPos === undefined) { showToast('Import file is missing an "Index No." column.', 'error'); return; }
    const byIndex = {};
    computedRows.forEach(r => { byIndex[norm(r.index_number)] = r; });
    const editableCols = columns.filter(isEditable).map(col => ({ col, pos: headerPos[norm(exportLabel(col))] })).filter(x => x.pos !== undefined);
    if (!editableCols.length) { showToast('No matching editable columns found in the import file.', 'error'); return; }
    const updates = {};
    let matched = 0, unmatched = 0;
    for (const row of rows) {
      const stRow = byIndex[norm(row[idxPos])];
      if (!stRow) { unmatched++; continue; }
      matched++;
      for (const { col, pos } of editableCols) {
        const val = row[pos];
        if (val === undefined) continue;
        updates[col.cellKey(stRow)] = val === null ? '' : String(val);
      }
    }
    applyUpdates(updates);
    if (matched) showToast(`Imported ${matched} student${matched !== 1 ? 's' : ''}${unmatched ? `, ${unmatched} unmatched` : ''} — review and Save Changes to keep them`, 'success');
    else showToast('No students matched by Index No. — nothing imported.', 'error');
  }

  const hasDirty = Object.values(dirty).some(Boolean);

  function renderCell(col, row, r, c) {
    const active = isActive(r, c);
    const selected = inRange(r, c);
    const editingThis = editing && editing.r === r && editing.c === c;
    const editable = isEditable(col);
    const cls = ['sheet-cell', 'ac-cell'];
    if (editable) cls.push('sheet-cell-editable'); else cls.push('sheet-cell-readonly');
    if (selected) cls.push('ac-cell-selected');
    if (active) cls.push('ac-cell-active');
    if (col.center) cls.push('text-center');
    if (editable && col.cellKey && dirty[col.cellKey(row)]) cls.push('ac-cell-dirty');
    if (editingThis) cls.push('ac-cell-editing');
    const style = {};
    if (col.bold) style.fontWeight = 700;
    if (col.mono) { style.fontFamily = 'monospace'; style.fontSize = 11; }

    let content;
    if (editingThis && editable) {
      const key = col.cellKey(row);
      content = (
        <input
          ref={editorElRef}
          className="ac-cell-editor"
          type={col.type === 'number' ? 'number' : 'text'}
          {...(col.step ? { step: col.step } : {})}
          {...(col.min ? { min: col.min } : {})}
          {...(col.max ? { max: col.max } : {})}
          value={inputs[key] ?? ''}
          onChange={e => setCell(key, e.target.value)}
          onKeyDown={onEditorKeyDown}
          onBlur={() => setEditing(null)}
        />
      );
    } else if (col.render) {
      content = col.render(row);
    } else {
      content = cellText(col, row);
    }

    return (
      <td
        key={col.id}
        className={cls.join(' ')}
        style={style}
        onMouseDown={e => onCellMouseDown(e, r, c)}
        onMouseEnter={() => onCellMouseEnter(r, c)}
        onDoubleClick={() => editable && beginEdit(r, c, { select: true })}
      >
        {content}
      </td>
    );
  }

  return <div className="assessment-compilation-tab">
    <div className="card no-print">
      <div className="section-header">
        <div>
          <div className="section-title">Assessment Compilation</div>
          <div className="text-sm text-muted">Excel-like foundation sheet for the selected class and term — select, copy, paste, delete and edit cells just like a spreadsheet. Use Import / Export for bulk Excel transfer.</div>
        </div>
        <div className="row gap-2">
          <button className="btn btn-outline" disabled={!sheet || loading} onClick={handleExport}>📥 Export Excel</button>
          <button className="btn btn-outline" disabled={!sheet || loading} onClick={handleImport}>📤 Import Excel</button>
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
        <div className="sheet-help no-print" style={{ marginTop: 12 }}><strong>Subjects:</strong> {sheet.subjects.length ? sheet.subjects.map(s => s.name).join(', ') : 'No active subjects found.'} {sheet.used_fallback_subjects ? <span className="text-muted">Mapped subjects were not found for this class, so all active subjects are shown.</span> : null}</div>
        <div className="card" style={{ marginTop: 16, padding: 0 }}>
          <div className="sheet-wrap ac-grid" ref={gridRef} tabIndex={0} onKeyDown={onGridKeyDown}>
            <table className="sheet-table scores-table assessment-compilation-table">
              <thead>
                <tr>
                  <th className="sheet-row-num-header ac-corner" onMouseDown={e => { e.preventDefault(); selectAll(); }} title="Select all">#</th>
                  {columns.map((col, c) => (
                    <th
                      key={col.id}
                      className="ac-col-header"
                      style={{ minWidth: col.minWidth || 90 }}
                      onMouseDown={e => { e.preventDefault(); selectColumn(c); }}
                      title="Click to select column"
                    >
                      {col.label}{col.subLabel ? <><br /><span className="text-xs">{col.subLabel}</span></> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {computedRows.map((row, r) => (
                  <tr key={row.student_id}>
                    <td className="sheet-row-num ac-row-num" onMouseDown={e => { e.preventDefault(); selectRow(r); }} title="Click to select row">{r + 1}</td>
                    {columns.map((col, c) => renderCell(col, row, r, c))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="sheet-help no-print" style={{ marginTop: 12 }}><strong>Tips:</strong> click a cell to select, drag or Shift+Click to select a range, click a header to select a whole column, Ctrl/Cmd+C / V to copy &amp; paste, Delete to clear, double-click or just start typing to edit. <strong>Editable:</strong> attendance, subject class &amp; exam raw, conduct, interests, talents, remarks. <strong>Locked:</strong> identity, subject totals, overall, average, position.</div>
      </>}
  </div>;
}
