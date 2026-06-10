// Nickland Edusoft — Attendance Register (classical Ghanaian weekly format)
// Students × 5 weekdays + weekly total + absence-reason column.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

// Get Monday of the week containing the given date
function getWeekStart(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();              // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day; // back to Monday
  d.setDate(d.getDate() + diff);
  return d;
}
function fmtISO(d) { return d.toISOString().slice(0, 10); }
function weekDates(weekStart) {
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return fmtISO(d);
  });
}
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
function fmtDayLabel(iso) {
  const d = new Date(iso);
  const day = DAY_NAMES[(d.getDay() + 6) % 7] || '';
  const date = d.getDate();
  const month = d.toLocaleString('en-GB', { month: 'short' });
  return `${day} ${date} ${month}`;
}

export default function AttendanceRegister() {
  const { classes, currentTerm, currentUser } = useStore();
  const showToast = useStore(s => s.showToast);
  const [classId, setClassId] = useState('');
  const [anchorDate, setAnchorDate] = useState(fmtISO(new Date()));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  // selectedDays: { studentId: Set(dateISO) } — which day-cells are ticked
  const [selected, setSelected] = useState({});
  // reasonInputs: { 'studentId|date': text }
  const [reasonInputs, setReasonInputs] = useState({});
  const [savingReason, setSavingReason] = useState(null);
  const [exporting, setExporting] = useState(null);

  const weekStart = getWeekStart(anchorDate);
  const dates = weekDates(weekStart);

  async function refresh() {
    if (!classId) { setRows([]); return; }
    setLoading(true);
    const data = await window.api.students.weeklyRegister({ classId, dates });
    setRows(data);
    setSelected({});
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [classId, anchorDate]);

  function toggleDay(studentId, date) {
    setSelected(prev => {
      const set = new Set(prev[studentId] || []);
      if (set.has(date)) set.delete(date); else set.add(date);
      return { ...prev, [studentId]: set };
    });
  }
  function isSelected(studentId, date) {
    return (selected[studentId] || new Set()).has(date);
  }
  function isRowSelected(studentId) {
    const set = selected[studentId] || new Set();
    return dates.length > 0 && dates.every(date => set.has(date));
  }
  function isEverythingSelected() {
    return rows.length > 0 && rows.every(row => isRowSelected(row.student_id));
  }
  function toggleRow(studentId) {
    setSelected(prev => {
      const next = { ...prev };
      const set = new Set(prev[studentId] || []);
      const fullySelected = dates.every(date => set.has(date));
      if (fullySelected) {
        delete next[studentId];
      } else {
        next[studentId] = new Set(dates);
      }
      return next;
    });
  }
  function toggleAllRows() {
    if (isEverythingSelected()) deselectAll();
    else selectAll();
  }
  function selectAll() {
    const all = {};
    for (const r of rows) all[r.student_id] = new Set(dates);
    setSelected(all);
  }
  function selectDate(date) {
    const oneDate = {};
    for (const r of rows) oneDate[r.student_id] = new Set([date]);
    setSelected(oneDate);
  }
  function deselectAll() { setSelected({}); }

  async function markSelected(status) {
    const ops = [];
    for (const r of rows) {
      const set = selected[r.student_id];
      if (!set) continue;
      for (const date of set) {
        ops.push({ studentId: r.student_id, date, status });
      }
    }
    if (ops.length === 0) {
      showToast('Tick the day cells you want to mark first', 'warning');
      return;
    }
    for (const op of ops) {
      await window.api.students.registerMark({
        ...op, markedBy: currentUser?.id, termId: currentTerm?.id,
      });
    }
    showToast(`Marked ${ops.length} entr${ops.length > 1 ? 'ies' : 'y'} ${status}`, 'success');
    setSelected({});
    refresh();
  }

  async function saveReason(studentId, date) {
    const key = `${studentId}|${date}`;
    const reason = reasonInputs[key];
    if (!reason || !reason.trim()) return;
    setSavingReason(key);
    await window.api.students.registerSaveReason({
      studentId, date, reason: reason.trim(),
      markedBy: currentUser?.id, termId: currentTerm?.id,
    });
    setSavingReason(null);
    setReasonInputs(prev => { const n = { ...prev }; delete n[key]; return n; });
    showToast('Reason saved', 'success');
    refresh();
  }

  function shiftWeek(deltaDays) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + deltaDays);
    setAnchorDate(fmtISO(d));
  }

  function safeFilePart(value) {
    return String(value || 'attendance')
      .replace(/[^a-z0-9_-]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'attendance';
  }

  async function exportRegister(format) {
    if (!classId) {
      showToast('Select a class before exporting the attendance register', 'warning');
      return;
    }
    const currentClass = classes.find(c => String(c.id) === String(classId));
    const ext = format === 'excel' ? 'xlsx' : 'pdf';
    const label = `${safeFilePart(currentClass?.name || 'class')}_${dates[0]}_${dates[dates.length - 1]}`;
    const res = await window.api.app.showSaveDialog({
      title: `Export Attendance Register as ${format === 'excel' ? 'Excel' : 'PDF'}`,
      defaultPath: `attendance_register_${label}.${ext}`,
      filters: [{ name: format === 'excel' ? 'Excel Workbook' : 'PDF Document', extensions: [ext] }],
    });
    if (res.canceled || !res.filePath) return;

    setExporting(format);
    try {
      const payload = { classId, dates, termId: currentTerm?.id, savePath: res.filePath };
      const out = format === 'excel'
        ? await window.api.students.exportAttendanceRegisterExcel(payload)
        : await window.api.students.exportAttendanceRegisterPdf(payload);

      if (!out.ok) {
        showToast(out.error || 'Attendance register export failed', 'error');
        return;
      }
      showToast(`Attendance register exported to ${ext.toUpperCase()}`, 'success');
    } catch (err) {
      showToast(err?.message || 'Attendance register export failed', 'error');
    } finally {
      setExporting(null);
    }
  }

  // For each student, find which dates they were absent (to show reason cell)
  function studentAbsentDates(row) {
    return dates.filter(d => row.attendance[d]?.status === 'absent');
  }

  return (
    <div className="attendance-register">
      <div className="card no-print">
        <div className="section-header">
          <div>
            <div className="section-title">Attendance Register</div>
            <div className="text-sm text-muted">
              Tick the day cells, then mark Present or Absent. Reasons for absence are kept on each student's profile.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => exportRegister('excel')}
              disabled={!classId || exporting}
            >
              {exporting === 'excel' ? 'Exporting…' : '📊 Export Excel'}
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => exportRegister('pdf')}
              disabled={!classId || exporting}
            >
              {exporting === 'pdf' ? 'Exporting…' : '📄 Export PDF'}
            </button>
          </div>
        </div>
        <div className="form-row" style={{ marginTop: 14, alignItems: 'flex-end' }}>
          <div className="form-group">
            <label>Class</label>
            <select value={classId} onChange={e => setClassId(e.target.value)}>
              <option value="">— Select Class —</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Week</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => shiftWeek(-7)}>‹ Prev</button>
              <input type="date" value={anchorDate} onChange={e => setAnchorDate(e.target.value)} />
              <button className="btn btn-ghost btn-sm" onClick={() => shiftWeek(7)}>Next ›</button>
            </div>
          </div>
          <div className="form-group">
            <label>Week of</label>
            <div style={{ fontWeight: 600, padding: '8px 0' }}>
              {fmtDayLabel(dates[0])} – {fmtDayLabel(dates[4])}
            </div>
          </div>
        </div>
        {classId && rows.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={selectAll}>Select All</button>
            <button className="btn btn-ghost btn-sm" onClick={deselectAll}>Deselect All</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-success" onClick={() => markSelected('present')}>✓ Mark Present</button>
            <button className="btn btn-danger" onClick={() => markSelected('absent')}>✗ Mark Absent</button>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        {!classId
          ? <div className="empty-state" style={{ padding: 40 }}>Select a class to view the register</div>
          : loading
            ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
            : rows.length === 0
              ? <div className="empty-state" style={{ padding: 30 }}>No active students in this class</div>
              : <div className="sheet-wrap">
                  <table className="sheet-table register-table">
                    <thead>
                      <tr>
                        <th className="sheet-row-num-header">
                          <input
                            type="checkbox"
                            checked={isEverythingSelected()}
                            onChange={toggleAllRows}
                            title="Select all students for all dates"
                          />
                        </th>
                        <th className="sheet-row-num-header" style={{ left: 36 }}>#</th>
                        <th style={{ minWidth: 90 }}>Index No.</th>
                        <th style={{ minWidth: 160 }}>Name</th>
                        {dates.map(d => (
                          <th key={d} className="register-date-header">
                            <div className="register-date-vertical">{fmtDayLabel(d)}</div>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs no-print"
                              onClick={() => selectDate(d)}
                              title={`Select all students for ${fmtDayLabel(d)}`}
                              style={{ marginTop: 6, padding: '2px 4px', fontSize: 10 }}
                            >
                              All
                            </button>
                          </th>
                        ))}
                        <th style={{ minWidth: 70 }} className="text-center">Total</th>
                        <th style={{ minWidth: 240 }} className="no-print">Reason for Absence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => {
                        const absentDates = studentAbsentDates(row);
                        return (
                          <tr key={row.student_id}>
                            <td className="sheet-row-num">
                              <input
                                type="checkbox"
                                checked={isRowSelected(row.student_id)}
                                onChange={() => toggleRow(row.student_id)}
                                title={`Select all dates for ${row.surname}, ${row.first_name}`}
                              />
                            </td>
                            <td className="sheet-row-num" style={{ left: 36 }}>{i + 1}</td>
                            <td className="sheet-cell" style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.index_number}</td>
                            <td className="sheet-cell"><strong>{row.surname}</strong>, {row.first_name}</td>
                            {dates.map(d => {
                              const rec = row.attendance[d];
                              const sel = isSelected(row.student_id, d);
                              const status = rec?.status;
                              return (
                                <td key={d}
                                  className={'register-day-cell' +
                                    (sel ? ' register-selected' : '') +
                                    (status === 'present' ? ' register-present' : '') +
                                    (status === 'absent' ? ' register-absent' : '')}
                                  onClick={() => toggleDay(row.student_id, d)}
                                  title={status ? `Marked ${status}` : 'Click to select'}
                                >
                                  {status === 'present' ? '✓' : status === 'absent' ? '✗' : (sel ? '•' : '')}
                                </td>
                              );
                            })}
                            <td className="sheet-cell text-center" style={{ fontWeight: 700 }}>
                              {row.present_count}/5
                            </td>
                            <td className="sheet-cell no-print">
                              {absentDates.length === 0
                                ? <span className="text-xs text-muted">—</span>
                                : absentDates.map(d => {
                                    const key = `${row.student_id}|${d}`;
                                    const existing = row.attendance[d]?.notes || '';
                                    const inputVal = reasonInputs[key] ?? '';
                                    return (
                                      <div key={d} className="register-reason-row">
                                        <span className="register-reason-date">{new Date(d).getDate()}</span>
                                        <input
                                          type="text"
                                          className="register-reason-input"
                                          placeholder={existing || 'Reason…'}
                                          value={inputVal}
                                          onChange={e => setReasonInputs(prev => ({ ...prev, [key]: e.target.value }))}
                                          onKeyDown={e => { if (e.key === 'Enter') saveReason(row.student_id, d); }}
                                        />
                                        <button
                                          className={'btn btn-sm ' + (inputVal.trim() ? 'btn-success' : 'btn-ghost')}
                                          disabled={!inputVal.trim() || savingReason === key}
                                          onClick={() => saveReason(row.student_id, d)}
                                        >
                                          {savingReason === key ? '…' : '💾'}
                                        </button>
                                      </div>
                                    );
                                  })
                              }
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
        }
      </div>

      <div className="sheet-help no-print" style={{ marginTop: 12 }}>
        <strong>How to use:</strong> Click day-cells to tick them (•) · Use <strong>Select All</strong> / <strong>Deselect All</strong> to work fast · Click <strong>Mark Present</strong> (green ✓) or <strong>Mark Absent</strong> (red ✗) · For absent students a reason box appears — type the reason and press Enter or 💾 · You can re-mark any cell at any time.
      </div>
    </div>
  );
}
