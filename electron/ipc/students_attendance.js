// Nickland Edusoft — Student Attendance & Events IPC
// Copyright © 2026 Nickland Sales. All rights reserved.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

module.exports = function registerStudentAttendanceHandlers(ipcMain, db, _userDataPath, getResourcePath) {

  // ── Attendance: list for a student in a term ──────────
  ipcMain.handle('students:list-attendance', (_e, { studentId, termId }) => {
    const term = termId
      ? db.prepare('SELECT * FROM terms WHERE id = ?').get(termId)
      : db.prepare("SELECT * FROM terms WHERE is_current = 1").get();
    if (!term) return [];

    return db.prepare(`
      SELECT sa.*, u.full_name AS marked_by_name
      FROM student_attendance sa
      LEFT JOIN users u ON u.id = sa.marked_by
      WHERE sa.student_id = ? AND sa.date >= ? AND sa.date <= ?
      ORDER BY sa.date DESC
    `).all(studentId, term.start_date, term.end_date);
  });

  // ── Attendance: list for a class on a date ────────────
  ipcMain.handle('students:list-class-attendance', (_e, { classId, date }) => {
    const students = db.prepare(`
      SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names, s.photo_path
      FROM students s
      WHERE s.current_class_id = ? AND s.status = 'Active'
      ORDER BY s.surname, s.first_name
    `).all(classId);

    const att = db.prepare(`
      SELECT student_id, status, notes
      FROM student_attendance
      WHERE student_id IN (${students.map(() => '?').join(',') || 'NULL'}) AND date = ?
    `).all(...students.map(s => s.id), date);
    const attMap = Object.fromEntries(att.map(a => [a.student_id, a]));

    return students.map(s => ({
      ...s,
      attendance_status: attMap[s.id]?.status || null,
      attendance_notes: attMap[s.id]?.notes || null,
    }));
  });

  // ── Mark single attendance ────────────────────────────
  ipcMain.handle('students:mark-attendance', (_e, { studentId, date, status, markedBy, termId, notes }) => {
    db.prepare(`
      INSERT INTO student_attendance (student_id, date, status, marked_by, term_id, notes)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (student_id, date) DO UPDATE SET
        status = excluded.status,
        marked_by = excluded.marked_by,
        notes = excluded.notes
    `).run(studentId, date, status, markedBy || null, termId || null, notes || null);
    return { ok: true };
  });

  // ── Mark bulk attendance (whole class for a date) ─────
  ipcMain.handle('students:mark-bulk-attendance', (_e, { date, markedBy, termId, entries }) => {
    const tx = db.transaction(() => {
      const stmt = db.prepare(`
        INSERT INTO student_attendance (student_id, date, status, marked_by, term_id, notes)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (student_id, date) DO UPDATE SET
          status = excluded.status,
          marked_by = excluded.marked_by,
          notes = excluded.notes
      `);
      for (const e of (entries || [])) {
        stmt.run(e.student_id, date, e.status, markedBy || null, termId || null, e.notes || null);
      }
    });
    tx();
    return { ok: true, count: (entries || []).length };
  });

  // ── Attendance summary for a student ─────────────────
  ipcMain.handle('students:attendance-summary', (_e, { studentId, termId }) => {
    const term = termId
      ? db.prepare('SELECT * FROM terms WHERE id = ?').get(termId)
      : db.prepare("SELECT * FROM terms WHERE is_current = 1").get();
    if (!term) return { present: 0, absent: 0, late: 0, excused: 0, total: 0 };

    const rows = db.prepare(`
      SELECT status, COUNT(*) AS c
      FROM student_attendance
      WHERE student_id = ? AND date >= ? AND date <= ?
      GROUP BY status
    `).all(studentId, term.start_date, term.end_date);

    const summary = { present: 0, absent: 0, late: 0, excused: 0, total: 0 };
    for (const r of rows) {
      if (r.status in summary) summary[r.status] = r.c;
      summary.total += r.c;
    }
    return summary;
  });

  // ── Student Events (misconduct, achievement, note) ────
  ipcMain.handle('students:list-events', (_e, studentId) => {
    return db.prepare(`
      SELECT se.*, u.full_name AS recorded_by_name
      FROM student_events se
      LEFT JOIN users u ON u.id = se.recorded_by
      WHERE se.student_id = ?
      ORDER BY se.date DESC, se.id DESC
    `).all(studentId);
  });

  ipcMain.handle('students:add-event', (_e, data) => {
    const r = db.prepare(`
      INSERT INTO student_events (student_id, event_type, title, description, date, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      data.student_id, data.event_type, data.title,
      data.description || null,
      data.date || new Date().toISOString().slice(0, 10),
      data.recorded_by || null
    );
    return { ok: true, id: r.lastInsertRowid };
  });

  ipcMain.handle('students:delete-event', (_e, id) => {
    db.prepare('DELETE FROM student_events WHERE id = ?').run(id);
    return { ok: true };
  });

  // ── Weekly Attendance Register ────────────────────────
  // Returns every active student in a class with their attendance status
  // for each of the given week's dates, plus accumulated absence reasons.
  ipcMain.handle('students:weekly-register', (_e, { classId, dates }) => {
    if (!classId || !dates || dates.length === 0) return [];
    const students = db.prepare(`
      SELECT id, index_number, surname, first_name, other_names
      FROM students
      WHERE current_class_id = ? AND status = 'Active'
      ORDER BY surname, first_name
    `).all(classId);

    const placeholders = dates.map(() => '?').join(',');
    return students.map(s => {
      const records = db.prepare(`
        SELECT date, status, notes FROM student_attendance
        WHERE student_id = ? AND date IN (${placeholders})
      `).all(s.id, ...dates);
      const byDate = {};
      for (const r of records) byDate[r.date] = { status: r.status, notes: r.notes };
      const presentCount = records.filter(r => r.status === 'present').length;
      // Accumulated reasons across the week
      const reasons = records
        .filter(r => r.status === 'absent' && r.notes)
        .map(r => `${r.date}: ${r.notes}`)
        .join('\n');
      return {
        student_id: s.id,
        index_number: s.index_number,
        surname: s.surname,
        first_name: s.first_name,
        other_names: s.other_names,
        attendance: byDate,          // { '2026-04-27': { status, notes }, ... }
        present_count: presentCount,
        absence_reasons: reasons,
      };
    });
  });


  // ── Attendance Register export (current class/week view) ───────────────
  ipcMain.handle('students:export-attendance-register-excel', async (_e, { classId, dates, termId, savePath }) => {
    try {
      if (!savePath) return { ok: false, error: 'No save path selected' };
      const register = getWeeklyRegisterExportData(db, classId, dates, termId);
      await exportAttendanceRegisterExcel(register, savePath);
      return { ok: true, path: savePath, count: register.rows.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('students:export-attendance-register-pdf', async (_e, { classId, dates, termId, savePath }) => {
    try {
      if (!savePath) return { ok: false, error: 'No save path selected' };
      const register = getWeeklyRegisterExportData(db, classId, dates, termId);
      await exportAttendanceRegisterPdf(register, savePath, getResourcePath);
      return { ok: true, path: savePath, count: register.rows.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Mark a single day for a student. Update existing rows first so already-marked
  // attendance can be changed even in older databases that may contain duplicates.
  ipcMain.handle('students:register-mark', (_e, { studentId, date, status, reason, markedBy, termId }) => {
    const existing = db.prepare('SELECT notes FROM student_attendance WHERE student_id = ? AND date = ?')
      .get(studentId, date);
    const notes = status === 'absent' ? (reason || existing?.notes || null) : null;

    const update = db.prepare(`
      UPDATE student_attendance
      SET status = ?,
          marked_by = ?,
          term_id = ?,
          notes = ?
      WHERE student_id = ? AND date = ?
    `).run(status, markedBy || null, termId || null, notes, studentId, date);

    if (update.changes === 0) {
      db.prepare(`
        INSERT INTO student_attendance (student_id, date, status, marked_by, term_id, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(studentId, date, status, markedBy || null, termId || null, notes);
    }

    return { ok: true, updated: update.changes > 0 };
  });

  // Save just the absence reason for a student on a date
  ipcMain.handle('students:register-save-reason', (_e, { studentId, date, reason, markedBy, termId }) => {
    db.prepare(`
      INSERT INTO student_attendance (student_id, date, status, marked_by, term_id, notes)
      VALUES (?, ?, 'absent', ?, ?, ?)
      ON CONFLICT (student_id, date) DO UPDATE SET notes = excluded.notes, status = 'absent'
    `).run(studentId, date, markedBy || null, termId || null, reason || null);
    return { ok: true };
  });
};


function getSetting(db, key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || fallback;
}

function getWeeklyRegisterExportData(db, classId, dates, termId) {
  if (!classId || !Array.isArray(dates) || dates.length === 0) {
    throw new Error('Class and dates are required for attendance export');
  }

  const classRow = db.prepare('SELECT id, name, short_code FROM class_groups WHERE id = ?').get(classId);
  if (!classRow) throw new Error('Class not found');

  const term = termId
    ? db.prepare('SELECT * FROM terms WHERE id = ?').get(termId)
    : db.prepare('SELECT * FROM terms WHERE is_current = 1').get();

  const students = db.prepare(`
    SELECT id, index_number, surname, first_name, other_names
    FROM students
    WHERE current_class_id = ? AND status = 'Active'
    ORDER BY surname, first_name
  `).all(classId);

  const placeholders = dates.map(() => '?').join(',');
  const rows = students.map((student, index) => {
    const records = db.prepare(`
      SELECT date, status, notes FROM student_attendance
      WHERE student_id = ? AND date IN (${placeholders})
    `).all(student.id, ...dates);
    const attendance = Object.fromEntries(records.map(r => [r.date, r]));
    return {
      no: index + 1,
      indexNumber: student.index_number || '',
      name: [student.surname, student.first_name, student.other_names].filter(Boolean).join(' '),
      attendance,
      presentCount: dates.filter(date => attendance[date]?.status === 'present').length,
      absenceReasons: records
        .filter(r => r.status === 'absent' && r.notes)
        .map(r => `${formatDateLabel(r.date)}: ${r.notes}`)
        .join('\n'),
    };
  });

  return {
    schoolName: getSetting(db, 'school_name', 'Nickland Edusoft'),
    schoolMotto: getSetting(db, 'school_motto', ''),
    schoolAddress: getSetting(db, 'school_address', ''),
    logoPath: getSetting(db, 'school_logo_path', ''),
    className: classRow.name || classRow.short_code || `Class ${classId}`,
    termLabel: term?.name || term?.label || term?.term_name || 'Current Term',
    dates,
    rows,
  };
}

function formatDateLabel(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function statusLabel(status) {
  if (!status) return '';
  const labels = { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused' };
  return labels[status] || String(status).replace(/_/g, ' ');
}

function ensureOutputDir(savePath) {
  const dir = path.dirname(savePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function exportAttendanceRegisterExcel(register, savePath) {
  ensureOutputDir(savePath);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Nickland Edusoft';
  wb.created = new Date();
  const ws = wb.addWorksheet('Attendance Register');
  const dateRange = `${formatDateLabel(register.dates[0])} - ${formatDateLabel(register.dates[register.dates.length - 1])}`;
  const totalColumns = 5 + register.dates.length;

  ws.mergeCells(1, 1, 1, totalColumns);
  ws.getCell(1, 1).value = register.schoolName;
  ws.getCell(1, 1).font = { size: 16, bold: true };
  ws.getCell(1, 1).alignment = { horizontal: 'center' };
  if (register.schoolMotto) {
    ws.mergeCells(2, 1, 2, totalColumns);
    ws.getCell(2, 1).value = register.schoolMotto;
    ws.getCell(2, 1).alignment = { horizontal: 'center' };
  }
  ws.mergeCells(3, 1, 3, totalColumns);
  ws.getCell(3, 1).value = `Attendance Register - ${register.className}`;
  ws.getCell(3, 1).font = { bold: true, size: 13 };
  ws.getCell(3, 1).alignment = { horizontal: 'center' };
  ws.mergeCells(4, 1, 4, totalColumns);
  ws.getCell(4, 1).value = `Term: ${register.termLabel}    Date Range: ${dateRange}`;
  ws.getCell(4, 1).alignment = { horizontal: 'center' };

  const headers = ['#', 'Index No.', 'Name', ...register.dates.map(formatDateLabel), 'Total Present', 'Absence Reasons'];
  ws.addRow([]);
  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A6B' } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  for (const row of register.rows) {
    ws.addRow([
      row.no,
      row.indexNumber,
      row.name,
      ...register.dates.map(date => statusLabel(row.attendance[date]?.status)),
      `${row.presentCount}/${register.dates.length}`,
      row.absenceReasons,
    ]);
  }

  ws.columns.forEach((col, idx) => {
    if (idx === 0) col.width = 6;
    else if (idx === 1) col.width = 16;
    else if (idx === 2) col.width = 28;
    else if (idx >= 3 && idx < 3 + register.dates.length) col.width = 13;
    else col.width = idx === 3 + register.dates.length ? 14 : 30;
  });
  ws.eachRow((row, rowNumber) => {
    if (rowNumber >= 6) {
      row.alignment = { vertical: 'middle', wrapText: true };
      row.eachCell(cell => { cell.border = thinBorder(); });
    }
  });
  ws.views = [{ state: 'frozen', ySplit: 6 }];

  await wb.xlsx.writeFile(savePath);
}

function thinBorder() {
  return {
    top: { style: 'thin', color: { argb: 'FFD9DEE8' } },
    left: { style: 'thin', color: { argb: 'FFD9DEE8' } },
    bottom: { style: 'thin', color: { argb: 'FFD9DEE8' } },
    right: { style: 'thin', color: { argb: 'FFD9DEE8' } },
  };
}

async function exportAttendanceRegisterPdf(register, savePath, getResourcePath) {
  ensureOutputDir(savePath);
  const html = buildAttendanceRegisterHtml(register, getResourcePath);
  await htmlToPdf(html, savePath);
}

function logoDataUri(register, getResourcePath) {
  const fallback = typeof getResourcePath === 'function' ? getResourcePath('logo.png') : '';
  const logoPath = register.logoPath || fallback;
  if (!logoPath || !fs.existsSync(logoPath)) return '';
  const ext = path.extname(logoPath).slice(1).toLowerCase() || 'png';
  return `data:image/${ext};base64,${fs.readFileSync(logoPath).toString('base64')}`;
}

function buildAttendanceRegisterHtml(register, getResourcePath) {
  const dateRange = `${formatDateLabel(register.dates[0])} - ${formatDateLabel(register.dates[register.dates.length - 1])}`;
  const logo = logoDataUri(register, getResourcePath);
  const dateHeaders = register.dates.map(date => `<th>${escapeHtml(formatDateLabel(date))}</th>`).join('');
  const rows = register.rows.map(row => `
    <tr>
      <td class="num">${row.no}</td>
      <td>${escapeHtml(row.indexNumber)}</td>
      <td class="name">${escapeHtml(row.name)}</td>
      ${register.dates.map(date => `<td class="status ${escapeHtml(row.attendance[date]?.status || '')}">${escapeHtml(statusLabel(row.attendance[date]?.status))}</td>`).join('')}
      <td class="num"><strong>${row.presentCount}/${register.dates.length}</strong></td>
      <td class="notes">${escapeHtml(row.absenceReasons).replace(/\n/g, '<br>')}</td>
    </tr>
  `).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: Arial, sans-serif; color: #111827; }
  .header { display: flex; align-items: center; justify-content: center; gap: 18px; text-align: center; border-bottom: 3px solid #1B3A6B; padding-bottom: 8px; margin-bottom: 10px; }
  .logo { width: 58px; height: 58px; object-fit: contain; }
  h1 { margin: 0; color: #1B3A6B; font-size: 22px; letter-spacing: .5px; }
  .motto { color: #9A6B00; font-style: italic; margin-top: 2px; }
  .meta { text-align: center; margin: 8px 0 12px; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th { background: #1B3A6B; color: #fff; padding: 6px 4px; border: 1px solid #d9dee8; }
  td { border: 1px solid #d9dee8; padding: 5px 4px; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  .num, .status { text-align: center; white-space: nowrap; }
  .name { min-width: 150px; }
  .notes { min-width: 160px; }
  .present { color: #15803D; font-weight: 700; }
  .absent { color: #B91C1C; font-weight: 700; }
</style></head><body>
  <div class="header">
    ${logo ? `<img class="logo" src="${logo}" alt="School logo">` : ''}
    <div>
      <h1>${escapeHtml(register.schoolName)}</h1>
      ${register.schoolMotto ? `<div class="motto">${escapeHtml(register.schoolMotto)}</div>` : ''}
      ${register.schoolAddress ? `<div>${escapeHtml(register.schoolAddress)}</div>` : ''}
    </div>
  </div>
  <div class="meta"><strong>Attendance Register</strong> &nbsp; | &nbsp; Class: ${escapeHtml(register.className)} &nbsp; | &nbsp; Term: ${escapeHtml(register.termLabel)} &nbsp; | &nbsp; Date Range: ${escapeHtml(dateRange)}</div>
  <table>
    <thead><tr><th>#</th><th>Index No.</th><th>Name</th>${dateHeaders}<th>Total Present</th><th>Absence Reasons</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function htmlToPdf(html, outPath) {
  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const data = await win.webContents.printToPDF({
    pageSize: 'A4',
    landscape: true,
    printBackground: true,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  fs.writeFileSync(outPath, data);
  win.close();
}
