// Timetable IPC handlers — bell schedule (periods) + per-class weekly grid.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
const fs = require('fs');
const path = require('path');
const { getSetting } = require('../utils/idgen');
// ExcelJS + electron are required lazily inside the export handlers so this
// module still loads in the plain-Node test harness (no node_modules).
//
// Data model (see migration 22):
//   timetable_periods  — one school-wide bell schedule (label + start/end,
//                        display_order, is_break). Break/lunch rows line up
//                        across every class.
//   timetable_entries  — one row per (class, weekday, period): subject + teacher.
//
// The read helpers here are also used by the mobile API (electron/server/api.js)
// so the desktop, the teacher's phone, and the parent portal all agree on shape.

const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
];

// A sensible Ghana pre-tertiary default bell schedule, used to seed an empty
// school so the grid isn't blank on first open.
const DEFAULT_PERIODS = [
  { label: 'Period 1', start_time: '08:00', end_time: '08:40', is_break: 0 },
  { label: 'Period 2', start_time: '08:40', end_time: '09:20', is_break: 0 },
  { label: 'Period 3', start_time: '09:20', end_time: '10:00', is_break: 0 },
  { label: 'Break',    start_time: '10:00', end_time: '10:20', is_break: 1 },
  { label: 'Period 4', start_time: '10:20', end_time: '11:00', is_break: 0 },
  { label: 'Period 5', start_time: '11:00', end_time: '11:40', is_break: 0 },
  { label: 'Lunch',    start_time: '11:40', end_time: '12:20', is_break: 1 },
  { label: 'Period 6', start_time: '12:20', end_time: '13:00', is_break: 0 },
  { label: 'Period 7', start_time: '13:00', end_time: '13:40', is_break: 0 },
];

function listPeriods(db) {
  return db.prepare('SELECT * FROM timetable_periods ORDER BY display_order, start_time, id').all();
}

// Full grid for one class: the shared periods + this class's entries keyed by
// `${day}:${periodId}`, each resolved to subject and teacher names.
function getClassTimetable(db, classId) {
  const periods = listPeriods(db);
  const cls = db.prepare('SELECT id, name, short_code FROM class_groups WHERE id = ?').get(classId) || null;
  const entries = db.prepare(`
    SELECT e.id, e.day_of_week, e.period_id, e.subject_id, e.teacher_id, e.notes,
           sub.name AS subject_name,
           TRIM(COALESCE(st.first_name,'') || ' ' || COALESCE(st.surname,'')) AS teacher_name
    FROM timetable_entries e
    LEFT JOIN subjects sub ON sub.id = e.subject_id
    LEFT JOIN staff st ON st.id = e.teacher_id
    WHERE e.class_group_id = ?
  `).all(classId);
  const byCell = {};
  for (const e of entries) byCell[`${e.day_of_week}:${e.period_id}`] = e;
  return { class: cls, days: DAYS, periods, entries: byCell };
}

// One teacher's week: every entry assigned to them, with class + subject +
// period, grouped by weekday. Used by the mobile "My timetable / Today" view.
function getTeacherTimetable(db, staffId) {
  const rows = db.prepare(`
    SELECT e.day_of_week, e.period_id, e.notes,
           c.name AS class_name, c.short_code AS class_short,
           sub.name AS subject_name,
           p.label AS period_label, p.start_time, p.end_time, p.display_order, p.is_break
    FROM timetable_entries e
    JOIN timetable_periods p ON p.id = e.period_id
    LEFT JOIN class_groups c ON c.id = e.class_group_id
    LEFT JOIN subjects sub ON sub.id = e.subject_id
    WHERE e.teacher_id = ?
    ORDER BY e.day_of_week, p.display_order, p.start_time
  `).all(staffId);
  const byDay = DAYS.map(d => ({ ...d, periods: rows.filter(r => r.day_of_week === d.value) }));
  return { days: byDay };
}

function registerTimetableHandlers(ipcMain, db) {
  ipcMain.handle('timetable:list-periods', () => listPeriods(db));

  ipcMain.handle('timetable:seed-default-periods', () => {
    const existing = db.prepare('SELECT COUNT(*) c FROM timetable_periods').get().c;
    if (existing > 0) return { ok: true, seeded: 0 };
    const ins = db.prepare('INSERT INTO timetable_periods (label, start_time, end_time, display_order, is_break) VALUES (?, ?, ?, ?, ?)');
    const tx = db.transaction(() => DEFAULT_PERIODS.forEach((p, i) => ins.run(p.label, p.start_time, p.end_time, i, p.is_break)));
    tx();
    return { ok: true, seeded: DEFAULT_PERIODS.length };
  });

  ipcMain.handle('timetable:save-period', (_e, data) => {
    if (!data || !data.label || !data.start_time || !data.end_time) {
      return { ok: false, error: 'Label, start and end time are required.' };
    }
    if (data.id) {
      db.prepare(`
        UPDATE timetable_periods SET label = ?, start_time = ?, end_time = ?, display_order = ?, is_break = ?
        WHERE id = ?
      `).run(data.label, data.start_time, data.end_time, data.display_order || 0, data.is_break ? 1 : 0, data.id);
      return { ok: true, id: data.id };
    }
    const r = db.prepare(`
      INSERT INTO timetable_periods (label, start_time, end_time, display_order, is_break)
      VALUES (?, ?, ?, ?, ?)
    `).run(data.label, data.start_time, data.end_time, data.display_order || 0, data.is_break ? 1 : 0);
    return { ok: true, id: r.lastInsertRowid };
  });

  ipcMain.handle('timetable:delete-period', (_e, id) => {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM timetable_entries WHERE period_id = ?').run(id);
      db.prepare('DELETE FROM timetable_periods WHERE id = ?').run(id);
    });
    tx();
    return { ok: true };
  });

  ipcMain.handle('timetable:get-class', (_e, { classId }) => getClassTimetable(db, classId));

  // Upsert one cell. A cell with neither subject nor teacher is cleared, so the
  // same editor handles "set" and "remove".
  ipcMain.handle('timetable:save-entry', (_e, { classId, dayOfWeek, periodId, subjectId, teacherId, notes }) => {
    if (!classId || !dayOfWeek || !periodId) return { ok: false, error: 'Class, day and period are required.' };
    if (!subjectId && !teacherId && !notes) {
      db.prepare('DELETE FROM timetable_entries WHERE class_group_id = ? AND day_of_week = ? AND period_id = ?')
        .run(classId, dayOfWeek, periodId);
      return { ok: true, cleared: true };
    }
    db.prepare(`
      INSERT INTO timetable_entries (class_group_id, day_of_week, period_id, subject_id, teacher_id, notes)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (class_group_id, day_of_week, period_id) DO UPDATE SET
        subject_id = excluded.subject_id, teacher_id = excluded.teacher_id, notes = excluded.notes
    `).run(classId, dayOfWeek, periodId, subjectId || null, teacherId || null, notes || null);
    return { ok: true };
  });

  ipcMain.handle('timetable:delete-entry', (_e, { classId, dayOfWeek, periodId }) => {
    db.prepare('DELETE FROM timetable_entries WHERE class_group_id = ? AND day_of_week = ? AND period_id = ?')
      .run(classId, dayOfWeek, periodId);
    return { ok: true };
  });

  ipcMain.handle('timetable:get-teacher', (_e, { staffId }) => getTeacherTimetable(db, staffId));

  ipcMain.handle('timetable:export-class-excel', async (_e, { classId, savePath }) => {
    try { await exportClassExcel(db, classId, savePath); return { ok: true, path: savePath }; }
    catch (err) { return { ok: false, error: err?.message || 'Excel export failed' }; }
  });

  ipcMain.handle('timetable:export-class-pdf', async (_e, { classId, savePath }) => {
    try { await exportClassPdf(db, classId, savePath); return { ok: true, path: savePath }; }
    catch (err) { return { ok: false, error: err?.message || 'PDF export failed' }; }
  });
}

// A cell's printable text: subject on top, teacher beneath. Break rows span.
function cellText(cell) {
  if (!cell) return '';
  return [cell.subject_name, cell.teacher_name].filter(Boolean).join('\n');
}

function ensureOutputDir(savePath) {
  const dir = path.dirname(savePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function exportClassExcel(db, classId, savePath) {
  ensureOutputDir(savePath);
  const ExcelJS = require('exceljs');
  const grid = getClassTimetable(db, classId);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Nickland Edusoft';
  const ws = wb.addWorksheet('Timetable');
  const cols = grid.days.length + 1;
  const schoolName = getSetting(db, 'school_name', 'Nickland Edusoft');

  ws.mergeCells(1, 1, 1, cols);
  ws.getCell(1, 1).value = schoolName;
  ws.getCell(1, 1).font = { size: 16, bold: true };
  ws.getCell(1, 1).alignment = { horizontal: 'center' };
  ws.mergeCells(2, 1, 2, cols);
  ws.getCell(2, 1).value = `Class Timetable — ${grid.class?.name || ''}`;
  ws.getCell(2, 1).font = { bold: true, size: 13 };
  ws.getCell(2, 1).alignment = { horizontal: 'center' };
  ws.addRow([]);

  const header = ws.addRow(['Period', ...grid.days.map(d => d.label)]);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A6B' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  for (const p of grid.periods) {
    if (p.is_break) {
      const r = ws.addRow([`${p.label} (${p.start_time}–${p.end_time})`, ...grid.days.map(() => '')]);
      ws.mergeCells(r.number, 2, r.number, cols);
      r.getCell(1).value = `${p.label} (${p.start_time}–${p.end_time})`;
      r.eachCell(c => { c.alignment = { horizontal: 'center', vertical: 'middle' }; c.font = { italic: true, color: { argb: 'FF9A6B00' } }; });
      continue;
    }
    const row = ws.addRow([
      `${p.label}\n${p.start_time}–${p.end_time}`,
      ...grid.days.map(d => cellText(grid.entries[`${d.value}:${p.id}`])),
    ]);
    row.alignment = { vertical: 'middle', wrapText: true };
  }

  ws.getColumn(1).width = 16;
  for (let i = 2; i <= cols; i++) ws.getColumn(i).width = 22;
  ws.eachRow((row, n) => { if (n >= 4) row.eachCell(c => { c.border = thin(); }); });

  await wb.xlsx.writeFile(savePath);
}

function thin() {
  const s = { style: 'thin', color: { argb: 'FFD9DEE8' } };
  return { top: s, left: s, bottom: s, right: s };
}

async function exportClassPdf(db, classId, savePath) {
  ensureOutputDir(savePath);
  const grid = getClassTimetable(db, classId);
  const schoolName = getSetting(db, 'school_name', 'Nickland Edusoft');
  const motto = getSetting(db, 'school_motto', '');
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const head = grid.days.map(d => `<th>${esc(d.label)}</th>`).join('');
  const rows = grid.periods.map(p => {
    if (p.is_break) {
      return `<tr><td class="pd">${esc(p.label)}<div class="t">${esc(p.start_time)}–${esc(p.end_time)}</div></td>
        <td class="brk" colspan="${grid.days.length}">${esc(p.label)}</td></tr>`;
    }
    const cells = grid.days.map(d => {
      const c = grid.entries[`${d.value}:${p.id}`];
      return `<td>${c ? `<div class="sub">${esc(c.subject_name || '')}</div><div class="tch">${esc(c.teacher_name || '')}</div>` : ''}</td>`;
    }).join('');
    return `<tr><td class="pd">${esc(p.label)}<div class="t">${esc(p.start_time)}–${esc(p.end_time)}</div></td>${cells}</tr>`;
  }).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: Arial, sans-serif; color:#111827; }
    h1 { color:#1B3A6B; text-align:center; margin:0; font-size:22px; }
    .motto { text-align:center; color:#9A6B00; font-style:italic; margin:2px 0 2px; }
    h2 { text-align:center; font-size:14px; margin:4px 0 12px; }
    table { width:100%; border-collapse:collapse; font-size:11px; table-layout:fixed; }
    th { background:#1B3A6B; color:#fff; padding:8px 4px; border:1px solid #d9dee8; }
    td { border:1px solid #d9dee8; padding:6px 5px; vertical-align:top; height:42px; }
    .pd { background:#F8FAFC; font-weight:700; width:110px; }
    .pd .t { font-weight:400; color:#94A3B8; font-size:10px; }
    .sub { font-weight:700; } .tch { color:#64748B; font-size:10px; }
    .brk { text-align:center; color:#9A6B00; font-weight:700; background:#FFFBEB; }
  </style></head><body>
    <h1>${esc(schoolName)}</h1>
    ${motto ? `<div class="motto">${esc(motto)}</div>` : ''}
    <h2>Class Timetable — ${esc(grid.class?.name || '')}</h2>
    <table><thead><tr><th>Period</th>${head}</tr></thead><tbody>${rows}</tbody></table>
  </body></html>`;

  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const data = await win.webContents.printToPDF({ pageSize: 'A4', landscape: true, printBackground: true });
  fs.writeFileSync(savePath, data);
  win.close();
}

module.exports = registerTimetableHandlers;
module.exports.getClassTimetable = getClassTimetable;
module.exports.getTeacherTimetable = getTeacherTimetable;
module.exports.listPeriods = listPeriods;
module.exports.DAYS = DAYS;
