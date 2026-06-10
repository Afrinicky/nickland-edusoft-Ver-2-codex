// Nickland Edusoft — Students Sheet (WHONET-style editable spreadsheet)
// Copyright © 2026 Nickland Sales. All rights reserved.
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useStore } from '../../store/index.js';
import { displayAge } from '../../lib/format.js';

// Column definitions — order matters for display, width controls column size
const COLUMNS = [
  { field: 'index_number',       label: 'Index No.',        width: 130,  type: 'text',   readonly: false, sticky: true },
  { field: 'surname',            label: 'Surname',          width: 130,  type: 'text',   sticky: true },
  { field: 'first_name',         label: 'First Name',       width: 130,  type: 'text',   sticky: true },
  { field: 'other_names',        label: 'Other Names',      width: 130,  type: 'text' },
  { field: 'class_short',        label: 'Class',            width: 70,   type: 'fk-display' },
  { field: 'gender',             label: 'Sex',              width: 70,   type: 'enum',   values: ['Male', 'Female'] },
  { field: 'date_of_birth',      label: 'Date of Birth',    width: 120,  type: 'date' },
  { field: 'age_computed',       label: 'Age',              width: 60,   type: 'computed', readonly: true },
  { field: 'denomination',       label: 'Denomination',     width: 120,  type: 'text' },
  { field: 'place_of_birth',     label: 'Place of Birth',   width: 140,  type: 'text' },
  { field: 'place_of_residence', label: 'Residence',        width: 140,  type: 'text' },
  { field: 'street_address',     label: 'Street',           width: 140,  type: 'text' },
  { field: 'house_number',       label: 'House No.',        width: 90,   type: 'text' },
  { field: 'digital_address',    label: 'Digital Addr.',    width: 130,  type: 'text' },
  { field: 'nhis_number',        label: 'NHIS No.',         width: 110,  type: 'text' },
  { field: 'father_name',        label: "Father's Name",    width: 160,  type: 'text' },
  { field: 'father_contact',     label: "Father's Contact", width: 130,  type: 'text' },
  { field: 'mother_name',        label: "Mother's Name",    width: 160,  type: 'text' },
  { field: 'mother_contact',     label: "Mother's Contact", width: 130,  type: 'text' },
  { field: 'guardian_name',      label: "Guardian Name",    width: 160,  type: 'text' },
  { field: 'guardian_contact',   label: "Guardian Cont.",   width: 130,  type: 'text' },
  { field: 'status',             label: 'Status',           width: 90,   type: 'enum',   values: ['Active', 'Inactive', 'Graduated'] },
  { field: 'inactive_reason',    label: 'Reason',           width: 130,  type: 'text' },
  { field: 'admission_date',     label: 'Admission Date',   width: 120,  type: 'date' },
  { field: 'notes',              label: 'Notes',            width: 200,  type: 'text' },
];

export default function StudentsSheetTab() {
  const classes = useStore(s => s.classes);
  const showToast = useStore(s => s.showToast);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ classId: '', status: '', search: '' });
  const [loading, setLoading] = useState(true);
  const [activeCell, setActiveCell] = useState(null);       // { rowIndex, field }
  const [editingValue, setEditingValue] = useState('');     // current editor value
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);
  const tableRef = useRef(null);

  async function refresh() {
    setLoading(true);
    const data = await window.api.students.sheetData({
      classId: filters.classId || undefined,
      status: filters.status || undefined,
      search: filters.search || undefined,
    });
    setRows(data);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, [filters.classId, filters.status]);

  // Re-search with debounce
  useEffect(() => {
    const t = setTimeout(() => refresh(), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  // Auto-focus the editor input when active cell changes
  useEffect(() => {
    if (activeCell && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current.select) inputRef.current.select();
    }
  }, [activeCell]);

  function startEdit(rowIndex, field, currentValue) {
    const col = COLUMNS.find(c => c.field === field);
    if (col?.readonly) return;
    if (field === 'class_short') {
      // Editing class via the short_code column actually edits current_class_id
      setActiveCell({ rowIndex, field: 'current_class_id', sourceField: 'class_short' });
      setEditingValue(rows[rowIndex].current_class_id || '');
    } else {
      setActiveCell({ rowIndex, field });
      setEditingValue(currentValue == null ? '' : String(currentValue));
    }
  }

  function cancelEdit() {
    setActiveCell(null);
    setEditingValue('');
  }

  async function commitEdit() {
    if (!activeCell) return;
    const row = rows[activeCell.rowIndex];
    if (!row) return;

    const currentVal = activeCell.field === 'current_class_id'
      ? row.current_class_id
      : row[activeCell.field];
    const newVal = editingValue === '' ? null : editingValue;

    // Skip if unchanged
    if (String(currentVal || '') === String(newVal || '')) {
      cancelEdit();
      return;
    }

    setSaving(true);
    const res = await window.api.students.sheetUpdateCell({
      studentId: row.id,
      field: activeCell.field,
      value: newVal,
    });
    setSaving(false);

    if (!res.ok) {
      showToast(res.error || 'Update failed', 'error');
      // Keep the cell active so user can fix the value
      return;
    }

    // Merge the returned row into state (for live age + class label)
    setRows(prev => {
      const next = [...prev];
      next[activeCell.rowIndex] = {
        ...next[activeCell.rowIndex],
        ...res.row,
        class_short: classes.find(c => c.id === res.row.current_class_id)?.short_code || next[activeCell.rowIndex].class_short,
        class_name: classes.find(c => c.id === res.row.current_class_id)?.name || next[activeCell.rowIndex].class_name,
      };
      return next;
    });
    cancelEdit();
  }

  function handleKeyDown(e) {
    if (!activeCell) return;
    if (e.key === 'Enter')   { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape')  { e.preventDefault(); cancelEdit(); }
    if (e.key === 'Tab')     {
      e.preventDefault();
      commitEdit();
      // Move to next editable cell on same row
      const idx = COLUMNS.findIndex(c => c.field === activeCell.field);
      for (let i = idx + 1; i < COLUMNS.length; i++) {
        if (!COLUMNS[i].readonly && COLUMNS[i].type !== 'computed') {
          setTimeout(() => startEdit(activeCell.rowIndex, COLUMNS[i].field, rows[activeCell.rowIndex][COLUMNS[i].field]), 50);
          break;
        }
      }
    }
  }

  function renderCell(row, rowIndex, col) {
    const isEditing = activeCell?.rowIndex === rowIndex &&
                      (activeCell.field === col.field || activeCell.sourceField === col.field);
    const value = row[col.field];

    if (isEditing) {
      // Render editor based on column type
      if (col.type === 'enum' || col.field === 'class_short') {
        const options = col.field === 'class_short'
          ? classes.map(c => ({ value: c.id, label: c.name }))
          : col.values.map(v => ({ value: v, label: v }));
        return (
          <select
            ref={inputRef}
            value={editingValue}
            onChange={(e) => setEditingValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            className="sheet-cell-editor"
            disabled={saving}
          >
            <option value="">—</option>
            {options.map(o => <option key={o.value} value={o.value ?? ''}>{o.label}</option>)}
          </select>
        );
      }
      if (col.type === 'date') {
        return (
          <input
            ref={inputRef}
            type="date"
            value={editingValue}
            onChange={(e) => setEditingValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            className="sheet-cell-editor"
            disabled={saving}
          />
        );
      }
      return (
        <input
          ref={inputRef}
          type="text"
          value={editingValue}
          onChange={(e) => setEditingValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          className="sheet-cell-editor"
          disabled={saving}
        />
      );
    }

    // Display formatting
    let display = value;
    if (col.field === 'age_computed') display = displayAge({ date_of_birth: row.date_of_birth, age: row.age_computed });
    if (col.field === 'date_of_birth' && value) display = value;
    if (value === null || value === undefined || value === '') display = '';
    if (col.field === 'status' && value) {
      const cls = value === 'Active' ? 'sheet-pill-success'
                : value === 'Inactive' ? 'sheet-pill-danger'
                : 'sheet-pill-muted';
      return <span className={'sheet-pill ' + cls}>{value}</span>;
    }
    return <span className="sheet-cell-value">{display}</span>;
  }

  const stickyOffsets = (() => {
    const offsets = {};
    let acc = 36; // row-number column width
    for (const col of COLUMNS) {
      if (col.sticky) {
        offsets[col.field] = acc;
        acc += col.width;
      }
    }
    return offsets;
  })();

  return (
    <div className="students-sheet-tab">
      {/* Toolbar */}
      <div className="sheet-toolbar">
        <div className="sheet-toolbar-left">
          <div className="sheet-info">
            <strong>Number of records = {rows.length}</strong>
          </div>
        </div>
        <div className="sheet-toolbar-filters">
          <select value={filters.classId ?? ''} onChange={e => setFilters({ ...filters, classId: e.target.value })}>
            <option value="">All Classes</option>
            {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
          </select>
          <select value={filters.status ?? ''} onChange={e => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Graduated">Graduated</option>
          </select>
          <input
            type="text"
            placeholder="Search by name or index no…"
            value={filters.search ?? ''}
            onChange={e => setFilters({ ...filters, search: e.target.value })}
            className="sheet-search-input"
          />
        </div>
      </div>

      {loading
        ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
        : (
          <div className="sheet-wrap" ref={tableRef}>
            <table className="sheet-table">
              <thead>
                <tr>
                  <th className="sheet-row-num-header">#</th>
                  {COLUMNS.map(col => (
                    <th
                      key={col.field}
                      className={col.sticky ? 'sheet-sticky' : ''}
                      style={{
                        width: col.width,
                        minWidth: col.width,
                        left: col.sticky ? stickyOffsets[col.field] : undefined,
                      }}
                    >
                      {col.label}
                      {col.readonly && <span className="sheet-readonly-mark"> 🔒</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0
                  ? <tr><td colSpan={COLUMNS.length + 1} className="sheet-empty">No students match the current filters</td></tr>
                  : rows.map((row, rowIndex) => (
                    <tr key={row.id}>
                      <td className="sheet-row-num">{rowIndex + 1}</td>
                      {COLUMNS.map(col => (
                        <td
                          key={col.field}
                          className={
                            'sheet-cell ' +
                            (col.sticky ? 'sheet-sticky ' : '') +
                            (col.readonly ? 'sheet-cell-readonly ' : 'sheet-cell-editable ') +
                            (activeCell?.rowIndex === rowIndex &&
                              (activeCell.field === col.field || activeCell.sourceField === col.field)
                              ? 'sheet-cell-active' : '')
                          }
                          style={{
                            width: col.width,
                            minWidth: col.width,
                            left: col.sticky ? stickyOffsets[col.field] : undefined,
                          }}
                          onDoubleClick={() => !col.readonly && startEdit(rowIndex, col.field, row[col.field])}
                          onClick={() => !col.readonly && col.type !== 'computed' && startEdit(rowIndex, col.field, row[col.field])}
                        >
                          {renderCell(row, rowIndex, col)}
                        </td>
                      ))}
                    </tr>
                  ))
                }
              </tbody>
            </table>
            {saving && <div className="sheet-saving-banner">Saving…</div>}
          </div>
        )
      }

      <div className="sheet-help">
        <strong>Tips:</strong> Click any cell to edit. Press <kbd>Enter</kbd> to save, <kbd>Esc</kbd> to cancel, <kbd>Tab</kbd> for next field. Age and Class label are computed automatically. Changes save instantly to each student's profile.
      </div>
    </div>
  );
}
