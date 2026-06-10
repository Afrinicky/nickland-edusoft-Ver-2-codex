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

// ===== Bulk Import =====
function BulkImportModal({ onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const showToast = useStore(s => s.showToast);

  async function pickFile() {
    const res = await window.api.app.showOpenDialog({
      title: 'Select Excel file',
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile'],
    });
    if (res.canceled || res.filePaths.length === 0) return;
    setBusy(true);
    const out = await window.api.students.bulkUpload(res.filePaths[0]);
    setResult(out);
    setBusy(false);
    if (out.ok) showToast(`Imported ${out.imported} students`);
  }

  return (
    <Modal title="Bulk import students" onClose={onClose}
      footer={result && result.ok ? <button className="btn btn-primary" onClick={onDone}>Done</button> : null}>
      <p className="text-muted text-sm mb-4">
        Upload an Excel file. Required columns: <code>CLASS, SURNAME, FIRST NAME, GENDER</code>.<br />
        Optional: <code>OTHER NAMES, AGE, DATE OF BIRTH, DENOMINATION, PLACE OF BIRTH, PLACE OF RESIDENCE,
        FATHER'S NAME, FATHER'S CONTACT, MOTHER'S NAME, MOTHER'S CONTACT,
        GUARDIAN'S NAME, GUARDIAN'S CONTACT, STREET ADDRESS, HOUSE NO, DIGITAL ADDRESS, NHIS NO</code>
      </p>
      <button className="btn btn-primary" onClick={pickFile} disabled={busy}>
        {busy ? <><span className="spinner" /> Importing…</> : '📂 Select Excel file'}
      </button>
      {result && (
        <div className="card mt-4" style={{ background: 'var(--surface-2)' }}>
          <div className="bold">Imported: {result.imported}</div>
          {result.skipped > 0 && <div className="text-sm text-muted">Skipped: {result.skipped}</div>}
          {result.errors && result.errors.length > 0 && (
            <details className="mt-2">
              <summary className="text-sm">View errors ({result.errors.length})</summary>
              <ul style={{ fontSize: 11, color: 'var(--muted)', maxHeight: 180, overflowY: 'auto', margin: '6px 0 0 16px' }}>
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}
        </div>
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
