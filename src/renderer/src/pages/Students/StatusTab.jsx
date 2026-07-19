import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useStore } from '../../store/index.js';
import { fullName, initials } from '../../lib/format.js';
import Modal from '../../components/Modal.jsx';
import StudentForm from './Form.jsx';

export default function StudentsStatusTab() {
  const classes = useStore(s => s.classes);
  const showToast = useStore(s => s.showToast);
  const [params] = useSearchParams();
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState(params.get('class') || '');
  const [statusFilter, setStatusFilter] = useState('Active');
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showPromote, setShowPromote] = useState(false);
  const navigate = useNavigate();

  async function refresh() {
    const list = await window.api.students.list({
      classId: classFilter || undefined,
      status: statusFilter || undefined,
      search: search || undefined,
    });
    setStudents(list);
  }
  useEffect(() => { refresh(); }, [classFilter, statusFilter, search]);

  async function handlePrintClassList() {
    if (!classFilter) return;
    const res = await window.api.reports.generateClassList(parseInt(classFilter), {});
    if (res.ok) showToast(`Class list PDF saved`);
  }


  async function handleStatusChange(studentId, nextStatus) {
    const res = await window.api.students.update(studentId, { status: nextStatus });
    if (!res.ok) {
      showToast('Status update failed', 'error');
      return;
    }
    setStudents(prev => prev.map(s => (
      s.id === studentId ? { ...s, status: nextStatus } : s
    )));
    showToast(`Student status saved as ${nextStatus}`, 'success');
  }

  async function handleDownload() {
    const res = await window.api.app.showSaveDialog({
      title: 'Save students as Excel',
      defaultPath: `students_${Date.now()}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (res.canceled || !res.filePath) return;
    const out = await window.api.students.bulkDownload(
      { classId: classFilter || undefined, status: statusFilter || undefined },
      res.filePath
    );
    if (out.ok) showToast(`Exported ${out.count} students`);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Students</h1>
          <div className="page-subtitle">{students.length} student{students.length !== 1 ? 's' : ''} shown</div>
        </div>
        <div className="row gap-2">
          <button className="btn btn-outline" onClick={handleDownload}>📥 Export</button>
          <button className="btn btn-outline" onClick={() => setShowImport(true)}>📤 Import</button>
          {classFilter && <button className="btn btn-outline" onClick={handlePrintClassList}>🖨 Class list</button>}
          <button className="btn btn-outline" onClick={() => setShowPromote(true)}>🎓 Promote</button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Student</button>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="search-wrap">
            <input className="search-input" placeholder="Search by name or Index No…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="select" style={{ maxWidth: 200 }}
            value={classFilter} onChange={e => setClassFilter(e.target.value)}>
            <option value="">All classes</option>
            {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
          </select>
          <select className="select" style={{ maxWidth: 140 }}
            value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="Active">Active</option>
            <option value="">All status</option>
            <option value="Inactive">Inactive</option>
            <option value="Graduated">Graduated</option>
            <option value="Transferred">Transferred</option>
          </select>
        </div>

        <table className="table table-clickable">
          <thead>
            <tr>
              <th></th><th>Index No</th><th>Name</th><th>Class</th>
              <th>Sex</th><th>Age</th><th>Contact</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {students.map(s => (
              <tr key={s.id} onClick={() => navigate(`/students/${s.id}`)}>
                <td><div className="avatar">{initials(s)}</div></td>
                <td className="bold">{s.index_number || '—'}</td>
                <td>{fullName(s)}</td>
                <td>{s.class_name}</td>
                <td>{s.gender}</td>
                <td>{s.age}</td>
                <td>{s.father_contact || s.mother_contact || s.guardian_contact || '—'}</td>
                <td onClick={e => e.stopPropagation()}>
                  <select
                    className="select"
                    value={s.status || 'Active'}
                    onChange={e => handleStatusChange(s.id, e.target.value)}
                    style={{ maxWidth: 130 }}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Graduated">Graduated</option>
                    <option value="Transferred">Transferred</option>
                  </select>
                </td>
              </tr>
            ))}
            {students.length === 0 && (
              <tr><td colSpan="8">
                <div className="empty-state">
                  <h3>No students found</h3>
                  <p>Try clearing filters or adding a new student.</p>
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <Modal title="Add new student" onClose={() => setShowAdd(false)} size="lg">
          <StudentForm
            onSaved={(id) => { setShowAdd(false); refresh(); showToast('Student added'); navigate(`/students/${id}`); }}
            onCancel={() => setShowAdd(false)}
          />
        </Modal>
      )}
      {showImport && <BulkImportModal onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); refresh(); }} />}
      {showPromote && <PromoteModal classes={classes} onClose={() => setShowPromote(false)} onDone={() => { setShowPromote(false); refresh(); showToast('Students promoted successfully'); }} />}
    </div>
  );
}

// ===== Bulk Import (two-phase: preview → review & fix → commit) =====

// Best-effort client-side status so the review grid gives live feedback as the
// user edits. The server re-validates authoritatively on commit.
function computeRowStatus(row, allRows) {
  const d = row.data || {};
  const errs = [];
  if (!d.surname && !d.first_name) errs.push({ field: 'surname', message: 'Enter a surname or first name.' });
  if (row.action === 'create' && !d.current_class_id) errs.push({ field: 'current_class_id', message: 'Choose a class for this new student.' });
  const idx = (d.index_number || '').trim();
  if (idx) {
    const dupRow = allRows.find(r => r !== row && ((r.data.index_number || '').trim() === idx));
    if (dupRow) errs.push({ field: 'index_number', message: `Index "${idx}" is also on row ${dupRow.rowNumber}.` });
  }
  // Carry through any server warnings (e.g. "will update existing record").
  const warns = (row.issues || []).filter(i => i.level === 'warning').map(i => ({ field: i.field, message: i.message }));
  return { errs, warns, status: errs.length ? 'error' : (warns.length || !idx ? 'warning' : 'ok') };
}

function BulkImportModal({ onClose, onDone }) {
  const showToast = useStore(s => s.showToast);
  const classes = useStore(s => s.classes);
  const [step, setStep] = useState('pick');       // 'pick' | 'review'
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState(null);

  async function pickFile() {
    const res = await window.api.app.showOpenDialog({
      title: 'Select Excel file',
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile'],
    });
    if (res.canceled || res.filePaths.length === 0) return;
    setBusy(true);
    const out = await window.api.students.bulkPreview(res.filePaths[0]);
    setBusy(false);
    if (!out.ok) { showToast(out.error || 'Could not read that file', 'error'); return; }
    setRows(out.rows.map(r => ({ ...r, data: { ...r.data } })));
    setSummary(out.summary);
    setCommitResult(null);
    setStep('review');
  }

  function updateCell(rowIndex, field, value) {
    setRows(prev => {
      const next = [...prev];
      const row = { ...next[rowIndex], data: { ...next[rowIndex].data } };
      row.data[field] = value === '' ? null : value;
      if (field === 'current_class_id') {
        row.data.current_class_id = value ? parseInt(value, 10) : null;
        row.class_short = classes.find(c => c.id === row.data.current_class_id)?.short_code || '';
      }
      next[rowIndex] = row;
      return next;
    });
  }

  async function commit() {
    setCommitting(true);
    const payload = rows.map(r => ({ rowNumber: r.rowNumber, classRaw: r.classRaw, data: r.data }));
    const res = await window.api.students.bulkCommit(payload);
    setCommitting(false);
    setCommitResult(res);

    if (res.failed && res.failed.length > 0) {
      // Keep ONLY the rows that still failed, so the user can fix & retry the
      // rest without re-importing the ones that already saved.
      const failedRows = res.failed.map(f => ({
        rowNumber: f.rowNumber,
        data: { ...f.data },
        classRaw: f.classRaw,
        class_short: classes.find(c => c.id === f.data.current_class_id)?.short_code || '',
        action: f.data.index_number ? 'create' : 'create',
        existingId: null,
        issues: (f.reasons || []).map(m => ({ level: 'error', field: '', message: m })),
        status: 'error',
      }));
      setRows(failedRows);
      showToast(`${res.created + res.updated} saved · ${res.failed.length} still need fixing`, 'error');
    } else {
      showToast(`Import complete — ${res.created} added, ${res.updated} updated`);
    }
  }

  const errorCount = rows.filter(r => computeRowStatus(r, rows).status === 'error').length;
  const allDone = commitResult && (!commitResult.failed || commitResult.failed.length === 0);

  // ── Step 1: pick a file ──
  if (step === 'pick') {
    return (
      <Modal title="Bulk import students" onClose={onClose} size="md">
        <p className="text-muted text-sm mb-4">
          Upload an Excel file. Recognised columns: <code>INDEX NUMBER, CLASS, SURNAME, FIRST NAME, OTHER NAMES,
          GENDER, DATE OF BIRTH, DENOMINATION, PLACE OF BIRTH, PLACE OF RESIDENCE, FATHER'S NAME, FATHER'S CONTACT,
          MOTHER'S NAME, MOTHER'S CONTACT, GUARDIAN'S NAME, GUARDIAN'S CONTACT, STREET ADDRESS, HOUSE NO,
          DIGITAL ADDRESS, NHIS NO</code>.
        </p>
        <div className="card mb-4" style={{ background: 'var(--surface-2)', fontSize: 12, lineHeight: 1.6 }}>
          <div className="bold" style={{ marginBottom: 4 }}>How this works</div>
          • Index numbers on your sheet are kept <b>exactly as-is</b> — the system never changes them.<br />
          • Rows without an index number get one auto-assigned (you can type your own instead).<br />
          • You'll review every row and fix any flagged problems <b>before</b> anything is saved — no student is dropped.
        </div>
        <button className="btn btn-primary" onClick={pickFile} disabled={busy}>
          {busy ? <><span className="spinner" /> Reading file…</> : '📂 Select Excel file'}
        </button>
      </Modal>
    );
  }

  // ── Step 2: review & fix ──
  const inputStyle = { width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 5px', fontSize: 11, background: 'var(--surface)' };
  return (
    <Modal
      title="Review import"
      onClose={onClose}
      size="lg"
      footer={
        allDone ? (
          <button className="btn btn-primary" onClick={onDone}>Done</button>
        ) : (
          <div className="row" style={{ justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
            <span className="text-sm" style={{ color: errorCount ? 'var(--danger, #c0392b)' : 'var(--muted)' }}>
              {errorCount > 0
                ? `${errorCount} row${errorCount === 1 ? '' : 's'} still need fixing`
                : `${rows.length} row${rows.length === 1 ? '' : 's'} ready to import`}
            </span>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setStep('pick')} disabled={committing}>← Choose another file</button>
              <button className="btn btn-primary" onClick={commit} disabled={committing || rows.length === 0}>
                {committing ? <><span className="spinner" /> Importing…</> : `Import ${rows.length} student${rows.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )
      }
    >
      {commitResult && (
        <div className="card mb-3" style={{ background: 'var(--surface-2)' }}>
          <div className="bold">{commitResult.created} added · {commitResult.updated} updated
            {commitResult.failed && commitResult.failed.length > 0 && ` · ${commitResult.failed.length} still need fixing`}</div>
          {allDone && <div className="text-sm text-muted">All rows imported successfully.</div>}
        </div>
      )}

      {!allDone && (
        <>
          <p className="text-sm text-muted" style={{ marginTop: 0 }}>
            Fix any highlighted cells, then import. Rows highlighted red must be corrected;
            amber rows are fine to import (e.g. an index number will be auto-assigned).
          </p>
          <div style={{ overflowX: 'auto', maxHeight: '55vh', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, background: 'var(--surface-2)', zIndex: 1 }}>
                  {['Row', 'Index No.', 'Surname', 'First Name', 'Other Names', 'Class', 'Sex', 'Date of Birth', 'Denomination', 'Action', 'Notes'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const st = computeRowStatus(row, rows);
                  const bg = st.status === 'error' ? 'rgba(192,57,43,0.08)' : (st.status === 'warning' ? 'rgba(243,156,18,0.08)' : 'transparent');
                  const cellErr = (field) => st.errs.some(e => e.field === field);
                  const d = row.data;
                  return (
                    <tr key={i} style={{ background: bg, borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 8px', color: 'var(--muted)' }}>{row.rowNumber}</td>
                      <td style={{ padding: '4px 6px', minWidth: 120 }}>
                        <input style={{ ...inputStyle, fontFamily: 'monospace', borderColor: cellErr('index_number') ? 'var(--danger, #c0392b)' : undefined }}
                          value={d.index_number || ''} placeholder="auto"
                          onChange={e => updateCell(i, 'index_number', e.target.value)} />
                      </td>
                      <td style={{ padding: '4px 6px', minWidth: 110 }}>
                        <input style={{ ...inputStyle, borderColor: cellErr('surname') ? 'var(--danger, #c0392b)' : undefined }}
                          value={d.surname || ''} onChange={e => updateCell(i, 'surname', e.target.value)} />
                      </td>
                      <td style={{ padding: '4px 6px', minWidth: 110 }}>
                        <input style={inputStyle} value={d.first_name || ''} onChange={e => updateCell(i, 'first_name', e.target.value)} />
                      </td>
                      <td style={{ padding: '4px 6px', minWidth: 110 }}>
                        <input style={inputStyle} value={d.other_names || ''} onChange={e => updateCell(i, 'other_names', e.target.value)} />
                      </td>
                      <td style={{ padding: '4px 6px', minWidth: 90 }}>
                        <select style={{ ...inputStyle, borderColor: cellErr('current_class_id') ? 'var(--danger, #c0392b)' : undefined }}
                          value={d.current_class_id || ''} onChange={e => updateCell(i, 'current_class_id', e.target.value)}>
                          <option value="">{row.classRaw ? `? ${row.classRaw}` : '—'}</option>
                          {classes.map(c => <option key={c.id} value={c.id}>{c.short_code || c.name}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '4px 6px', minWidth: 74 }}>
                        <select style={inputStyle} value={d.gender || ''} onChange={e => updateCell(i, 'gender', e.target.value)}>
                          <option value="">—</option>
                          <option>Male</option>
                          <option>Female</option>
                        </select>
                      </td>
                      <td style={{ padding: '4px 6px', minWidth: 130 }}>
                        <input type="date" style={inputStyle} value={d.date_of_birth || ''} onChange={e => updateCell(i, 'date_of_birth', e.target.value)} />
                      </td>
                      <td style={{ padding: '4px 6px', minWidth: 110 }}>
                        <input style={inputStyle} value={d.denomination || ''} onChange={e => updateCell(i, 'denomination', e.target.value)} />
                      </td>
                      <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                        <span className="badge badge-muted">{row.action === 'update' ? 'Update' : 'New'}</span>
                      </td>
                      <td style={{ padding: '4px 8px', minWidth: 180, color: 'var(--muted)', fontSize: 10.5 }}>
                        {[...st.errs, ...st.warns].map((m, k) => (
                          <div key={k} style={{ color: st.errs.includes(m) ? 'var(--danger, #c0392b)' : 'var(--muted)' }}>{m.message}</div>
                        ))}
                        {row.action === 'update' && row.existingName && <div>↻ Updates: {row.existingName}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

// ===== Promote Students =====
function PromoteModal({ classes, onClose, onDone }) {
  // Build ordered list: each class with its "next class" suggestion
  const orderedClasses = [...classes].sort((a, b) => a.level_order - b.level_order);
  const [mappings, setMappings] = useState(() => {
    // Default: each class maps to the next class in level_order
    const m = {};
    orderedClasses.forEach((c, i) => {
      const next = orderedClasses[i + 1];
      m[c.id] = next ? next.id : '__graduate__';
    });
    return m;
  });
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

  async function loadPreview() {
    // Count students per class
    const allStudents = await window.api.students.list({ status: 'Active' });
    const counts = {};
    for (const s of allStudents) {
      counts[s.current_class_id] = (counts[s.current_class_id] || 0) + 1;
    }
    setPreview(counts);
  }
  useEffect(() => { loadPreview(); }, []);

  async function doPromote() {
    setBusy(true);
    // Collect all active students, determine their new class, and batch-promote
    const allStudents = await window.api.students.list({ status: 'Active' });
    const promotions = [];
    const graduates = [];
    for (const s of allStudents) {
      const target = mappings[s.current_class_id];
      if (!target) continue;
      if (target === '__graduate__') {
        graduates.push(s.id);
      } else {
        promotions.push({ studentId: s.id, newClassId: parseInt(target) });
      }
    }
    if (promotions.length > 0) await window.api.students.promote(promotions);
    // Mark graduates as Graduated
    for (const id of graduates) {
      await window.api.students.update(id, { status: 'Graduated' });
    }
    setBusy(false);
    onDone();
  }

  return (
    <Modal title="Promote students to next class" onClose={onClose} size="lg"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={doPromote} disabled={busy}>
          {busy ? <><span className="spinner" /> Promoting…</> : 'Promote all students'}
        </button>
      </>}>
      <p className="text-muted text-sm mb-3">
        This moves all <strong>Active</strong> students to their next class at once. 
        Review the mapping below before proceeding. Students mapped to <em>Graduate</em> will be marked as Graduated.
      </p>
      <table className="table">
        <thead><tr><th>From class</th><th>Students</th><th>→ Promote to</th></tr></thead>
        <tbody>
          {orderedClasses.map(c => (
            <tr key={c.id}>
              <td className="bold">{c.name}</td>
              <td>{preview ? (preview[c.id] || 0) : '…'}</td>
              <td>
                <select className="select" value={mappings[c.id] || ''}
                  onChange={e => setMappings({ ...mappings, [c.id]: e.target.value })}>
                  <option value="">— Skip / no change —</option>
                  {orderedClasses.map(nc => (
                    <option key={nc.id} value={nc.id ?? ''}>{nc.name}</option>
                  ))}
                  <option value="__graduate__">Graduate (remove from active)</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-muted text-sm mt-3">
        ⚠ This action cannot be undone. Make sure your current term's reports and payments are finalised first.
      </div>
    </Modal>
  );
}
