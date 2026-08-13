// Students IPC handlers — all student CRUD and bulk operations.
const fs = require('fs');
const path = require('path');
// ExcelJS is required lazily inside the two import/export helpers so this module
// loads in the plain-Node test harness (no node_modules).
const {
  getAdmissionYear,
  formatIndexNumber,
  parseIndexNumber,
  getSchoolAbbreviation,
  getNextRollNumber,
  setNextRollNumber,
} = require('../utils/idgen');

function registerStudentHandlers(ipcMain, db, userDataPath) {
  // List students with optional filters
  ipcMain.handle('students:list', (_e, filters = {}) => {
    let sql = `
      SELECT s.*,
             c.name AS class_name,
             c.short_code AS class_short,
             CASE
               WHEN s.date_of_birth IS NOT NULL AND s.date_of_birth != ''
               THEN CAST((julianday('now') - julianday(s.date_of_birth)) / 365.25 AS INTEGER)
               ELSE s.age
             END AS computed_age
      FROM students s
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE 1=1
    `;
    const params = [];
    if (filters.classId) { sql += ' AND s.current_class_id = ?'; params.push(filters.classId); }
    if (filters.status) { sql += ' AND s.status = ?'; params.push(filters.status); }
    if (filters.gender) { sql += ' AND s.gender = ?'; params.push(filters.gender); }
    if (filters.search) {
      sql += ' AND (s.surname LIKE ? OR s.first_name LIKE ? OR s.other_names LIKE ? OR s.index_number LIKE ?)';
      const q = `%${filters.search}%`;
      params.push(q, q, q, q);
    }
    sql += ' ORDER BY c.level_order, s.surname, s.first_name';
    const rows = db.prepare(sql).all(...params);
    // Overwrite stored age with computed_age so consumers always see live age
    return rows.map(r => ({ ...r, age: r.computed_age }));
  });

  ipcMain.handle('students:get', (_e, id) => {
    const student = db.prepare(`
      SELECT s.*,
             c.name AS class_name,
             c.short_code AS class_short,
             CASE
               WHEN s.date_of_birth IS NOT NULL AND s.date_of_birth != ''
               THEN CAST((julianday('now') - julianday(s.date_of_birth)) / 365.25 AS INTEGER)
               ELSE s.age
             END AS computed_age
      FROM students s
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE s.id = ?
    `).get(id);
    if (!student) return null;
    student.age = student.computed_age;
    student.history = db.prepare(`
      SELECT h.*, c.name AS class_name, ay.label AS year_label
      FROM student_class_history h
      JOIN class_groups c ON c.id = h.class_group_id
      JOIN academic_years ay ON ay.id = h.academic_year_id
      WHERE h.student_id = ?
      ORDER BY h.enrolled_date DESC
    `).all(id);
    return student;
  });

  ipcMain.handle('students:create', (_e, data) => {
    try {
      const idx = data && data.index_number != null ? String(data.index_number).trim() : '';
      if (idx) {
        const dup = db.prepare('SELECT id FROM students WHERE index_number = ?').get(idx);
        if (dup) return { ok: false, error: `Index number "${idx}" is already used by another student.` };
      }
      return createStudentInternal(db, data);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('students:update', (_e, { id, data }) => {
    try {
      const fields = [
        'surname', 'first_name', 'other_names', 'gender', 'denomination', 'date_of_birth',
        'age', 'place_of_birth', 'place_of_residence', 'street_address', 'house_number',
        'digital_address', 'nhis_number', 'father_name', 'father_contact', 'father_email',
        'mother_name', 'mother_contact', 'mother_email', 'guardian_name', 'guardian_contact',
        'guardian_email', 'current_class_id',
        'status', 'inactive_reason', 'admission_date', 'notes', 'index_number',
      ];
      // Guard the UNIQUE index_number so a clash returns a friendly message
      // instead of a raw SQL constraint error.
      if (data.index_number !== undefined) {
        const idx = data.index_number != null ? String(data.index_number).trim() : '';
        if (idx) {
          const dup = db.prepare('SELECT id FROM students WHERE index_number = ? AND id != ?').get(idx, id);
          if (dup) return { ok: false, error: `Index number "${idx}" is already used by another student.` };
        }
      }
      const setClauses = [];
      const params = [];
      for (const f of fields) {
        if (data[f] !== undefined) {
          setClauses.push(`${f} = ?`);
          params.push(data[f] === '' ? null : data[f]);
        }
      }
      if (setClauses.length === 0) return { ok: true };
      params.push(id);
      db.prepare(
        `UPDATE students SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(...params);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('students:delete', (_e, id) => {
    db.prepare('DELETE FROM students WHERE id = ?').run(id);
    return { ok: true };
  });

  // Upload photo: copy from source path into userData/uploads/students/{id}.{ext}
  ipcMain.handle('students:upload-photo', (_e, { studentId, sourcePath }) => {
    const ext = path.extname(sourcePath) || '.png';
    const dest = path.join(userDataPath, 'uploads', 'students');
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const destPath = path.join(dest, `${studentId}${ext}`);
    fs.copyFileSync(sourcePath, destPath);
    db.prepare('UPDATE students SET photo_path = ? WHERE id = ?').run(destPath, studentId);
    return { ok: true, path: destPath };
  });

  // One-time initial import from the bundled AVE_MARIA_DATABASE.xlsx
  ipcMain.handle('students:run-initial-import', async () => {
    return await runInitialImport(db);
  });

  // Generate Index Numbers for any student missing one
  ipcMain.handle('students:generate-all-ids', () => {
    return generateAllMissingIds(db);
  });

  // Bulk upload from Excel (legacy one-shot path — still fixed to honor
  // provided index numbers and never drop rows silently).
  ipcMain.handle('students:bulk-upload', async (_e, filePath) => {
    return await bulkUploadFromExcel(db, filePath);
  });

  // Phase 1 of the safe import: parse + validate the sheet and return a full,
  // row-by-row preview. NOTHING is written to the database here. Every row is
  // returned — including ones with problems — so the user can review and fix
  // them before committing.
  ipcMain.handle('students:bulk-preview', async (_e, filePath) => {
    return await bulkPreviewFromExcel(db, filePath);
  });

  // Phase 2 of the safe import: commit the (possibly user-edited) rows. Each row
  // is inserted/updated independently so a single bad row can never roll back or
  // drop the others. Rows that still fail validation are returned so the user can
  // fix and retry — no student is ever silently lost.
  ipcMain.handle('students:bulk-commit', (_e, { rows }) => {
    return bulkCommitRows(db, rows || []);
  });

  // Bulk download to Excel
  ipcMain.handle('students:bulk-download', async (_e, { filters = {}, savePath }) => {
    return await bulkDownloadToExcel(db, filters, savePath);
  });

  // Promote students en masse
  ipcMain.handle('students:promote', (_e, mappings) => {
    const stmt = db.prepare('UPDATE students SET current_class_id = ? WHERE id = ?');
    const tx = db.transaction((entries) => {
      for (const m of entries) stmt.run(m.newClassId, m.studentId);
    });
    tx(mappings);
    return { ok: true };
  });
}

// === Helpers ===

function createStudentInternal(db, data) {
  // Determine admission year & roll number
  const classRow = db.prepare('SELECT id, short_code FROM class_groups WHERE id = ?').get(data.current_class_id);
  if (!classRow) throw new Error('Invalid class');

  const currentYearRow = db.prepare(
    "SELECT label FROM academic_years WHERE is_current = 1 ORDER BY id DESC LIMIT 1"
  ).get();
  // Pull the FIRST 4-digit year from the label, e.g. "2025/2026" → 2025 (admission for N1 starts at start year)
  const yearMatch = currentYearRow ? String(currentYearRow.label).match(/(\d{4})/) : null;
  const currentYear = yearMatch ? parseInt(yearMatch[1], 10) + 1 : new Date().getFullYear();
  // We use the LATER year (e.g. 2026 in "2025/2026") as "this year" for new admissions starting in Jan.

  let admissionYear = data.admission_year || getAdmissionYear(classRow.short_code, currentYear);

  // Index number policy:
  //   • If an index number is supplied (from an import sheet or manual entry),
  //     honor it EXACTLY — never regenerate or overwrite it. We only derive the
  //     admission year from it for record-keeping. roll_number is left NULL for
  //     manually-indexed students because roll_number is UNIQUE and deriving it
  //     from an arbitrary index could collide with the auto-allocation counter.
  //   • If no index number is supplied, auto-assign the next sequential one and
  //     advance the shared roll counter.
  let rollNumber = data.roll_number || null;
  let indexNumber = (data.index_number != null && String(data.index_number).trim() !== '')
    ? String(data.index_number).trim()
    : null;

  if (indexNumber) {
    const parsed = parseIndexNumber(indexNumber);
    if (parsed) admissionYear = parsed.year;
  } else {
    rollNumber = getNextRollNumber(db);
    const prefix = getSchoolAbbreviation(db);
    indexNumber = formatIndexNumber(prefix, admissionYear, rollNumber);
    setNextRollNumber(db, rollNumber + 1);
  }

  const result = db.prepare(`
    INSERT INTO students (
      index_number, admission_year, roll_number, surname, first_name, other_names,
      gender, denomination, age, date_of_birth, place_of_birth, place_of_residence,
      street_address, house_number, digital_address, nhis_number,
      father_name, father_contact, father_email, mother_name, mother_contact, mother_email,
      guardian_name, guardian_contact, guardian_email, current_class_id, status,
      admission_date, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    indexNumber, admissionYear, rollNumber,
    data.surname || '', data.first_name || '', data.other_names || '',
    data.gender || '', data.denomination || '', data.age || null,
    data.date_of_birth || null, data.place_of_birth || '', data.place_of_residence || '',
    data.street_address || '', data.house_number || '', data.digital_address || '',
    data.nhis_number || '',
    data.father_name || '', data.father_contact || '', data.father_email || '',
    data.mother_name || '', data.mother_contact || '', data.mother_email || '',
    data.guardian_name || '', data.guardian_contact || '', data.guardian_email || '',
    data.current_class_id, data.status || 'Active',
    data.admission_date || new Date().toISOString().slice(0, 10),
    data.notes || ''
  );
  return { ok: true, id: result.lastInsertRowid, index_number: indexNumber };
}

async function runInitialImport(db) {
  // Look in resources/initial_database.xlsx
  const resourcePath = db._getResourcePath('initial_database.xlsx');
  if (!fs.existsSync(resourcePath)) {
    return { ok: false, error: 'initial_database.xlsx not found in resources' };
  }
  const done = db.prepare("SELECT value FROM settings WHERE key = 'initial_import_done'").get();
  if (done && done.value === 'true') {
    return { ok: false, error: 'Initial import already completed.' };
  }

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(resourcePath);
  const ws = wb.getWorksheet('MERGED  STUDENTS DATA') || wb.worksheets[0];

  // Class short-code → DB class id
  const classes = db.prepare('SELECT id, short_code FROM class_groups').all();
  const cMap = {};
  for (const c of classes) cMap[c.short_code] = c.id;
  // Translate raw Excel CLASS column values to short codes
  const classKeyMap = {
    'N1': 'N1', 'N2': 'N2', 'KG1': 'KG1', 'KG2': 'KG2',
    'PRE': 'PRE',
    '1': 'BS1', '2': 'BS2', '3': 'BS3', '4': 'BS4', '5': 'BS5', '6': 'BS6',
  };

  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, idx) => {
    if (idx === 1) return; // header
    const vals = row.values; // 1-indexed array
    rows.push({
      class_raw: vals[2],
      denomination: vals[3],
      gender: vals[4],
      surname: String(vals[5] || '').trim(),
      first_name: String(vals[6] || '').trim(),
      other_names: vals[7] ? String(vals[7]).trim() : null,
      age: vals[8] || null,
      dob: vals[9] || null,
      place_of_birth: vals[10] || null,
      place_of_residence: vals[11] || null,
      father_name: vals[12] || null,
      father_contact: vals[13] || null,
      mother_name: vals[14] || null,
      mother_contact: vals[15] || null,
      guardian_name: vals[16] || null,
      guardian_contact: vals[17] || null,
      street_address: vals[18] || null,
      house_number: vals[19] || null,
      digital_address: vals[20] || null,
      nhis_number: vals[21] || null,
    });
  });

  // Compute admission year + roll number
  const CURRENT_YEAR = 2026;
  const studentsForId = rows.map(r => {
    const short = classKeyMap[String(r.class_raw)] || null;
    const admYear = short ? getAdmissionYear(short, CURRENT_YEAR) : CURRENT_YEAR;
    return { ...r, short, adm_year: admYear };
  }).filter(r => r.short);

  studentsForId.sort((a, b) => {
    if (a.adm_year !== b.adm_year) return a.adm_year - b.adm_year;
    if (a.surname !== b.surname) return a.surname.localeCompare(b.surname);
    return a.first_name.localeCompare(b.first_name);
  });

  const prefix = getSchoolAbbreviation(db);
  const insert = db.prepare(`
    INSERT INTO students (
      index_number, admission_year, roll_number, surname, first_name, other_names,
      gender, denomination, age, date_of_birth, place_of_birth, place_of_residence,
      street_address, house_number, digital_address, nhis_number,
      father_name, father_contact, mother_name, mother_contact,
      guardian_name, guardian_contact, current_class_id, status, admission_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?)
  `);

  const tx = db.transaction(() => {
    let roll = 1;
    for (const s of studentsForId) {
      const idxNumber = formatIndexNumber(prefix, s.adm_year, roll);
      const classId = cMap[s.short];
      const dobIso = s.dob && s.dob instanceof Date ? s.dob.toISOString().slice(0, 10) :
                     (s.dob ? String(s.dob).slice(0, 10) : null);
      insert.run(
        idxNumber, s.adm_year, roll,
        s.surname || '', s.first_name || '', s.other_names || '',
        s.gender || '', s.denomination || '', s.age || null,
        dobIso, s.place_of_birth, s.place_of_residence,
        s.street_address, s.house_number, s.digital_address, s.nhis_number,
        s.father_name, s.father_contact, s.mother_name, s.mother_contact,
        s.guardian_name, s.guardian_contact, classId,
        `${s.adm_year}-09-01`
      );
      roll++;
    }
    db.prepare("UPDATE settings SET value = ? WHERE key = 'next_roll_number'").run(String(roll));
    db.prepare("UPDATE settings SET value = 'true' WHERE key = 'initial_import_done'").run();
  });
  tx();
  return { ok: true, imported: studentsForId.length };
}

function generateAllMissingIds(db) {
  const prefix = getSchoolAbbreviation(db);
  const missing = db.prepare(`
    SELECT s.id, s.surname, s.first_name, c.short_code
    FROM students s
    LEFT JOIN class_groups c ON c.id = s.current_class_id
    WHERE s.index_number IS NULL OR s.index_number = ''
    ORDER BY s.id
  `).all();
  let roll = getNextRollNumber(db);
  const currentYearRow = db.prepare(
    "SELECT label FROM academic_years WHERE is_current = 1 ORDER BY id DESC LIMIT 1"
  ).get();
  const yearMatch = currentYearRow ? String(currentYearRow.label).match(/\d{4}/g) : null;
  const currentYear = yearMatch ? parseInt(yearMatch[yearMatch.length - 1], 10) : new Date().getFullYear();

  const upd = db.prepare('UPDATE students SET index_number = ?, admission_year = ?, roll_number = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const s of missing) {
      const admYear = getAdmissionYear(s.short_code, currentYear);
      const idxNumber = formatIndexNumber(prefix, admYear, roll);
      upd.run(idxNumber, admYear, roll, s.id);
      roll++;
    }
    setNextRollNumber(db, roll);
  });
  tx();
  return { ok: true, generated: missing.length };
}

// ═══════════════════════════════════════════════════════════════════════
// SHARED IMPORT HELPERS (used by legacy bulk-upload, preview, and commit)
// ═══════════════════════════════════════════════════════════════════════

// Fields we read from a sheet / accept from the review grid.
const IMPORT_FIELDS = [
  'surname', 'first_name', 'other_names', 'gender', 'denomination', 'age',
  'date_of_birth', 'place_of_birth', 'place_of_residence',
  'father_name', 'father_contact', 'mother_name', 'mother_contact',
  'guardian_name', 'guardian_contact', 'street_address', 'house_number',
  'digital_address', 'nhis_number', 'index_number', 'admission_date', 'notes',
];

// Fields copied onto an existing student during an UPDATE (index_number is
// handled separately — an existing index is never overwritten with a blank).
const UPDATABLE_FIELDS = [
  'surname', 'first_name', 'other_names', 'gender', 'denomination',
  'date_of_birth', 'place_of_birth', 'place_of_residence',
  'street_address', 'house_number', 'digital_address', 'nhis_number',
  'father_name', 'father_contact', 'mother_name', 'mother_contact',
  'guardian_name', 'guardian_contact', 'current_class_id',
  'admission_date', 'notes',
];

function buildClassMap(db) {
  const classes = db.prepare('SELECT id, short_code FROM class_groups').all();
  const cMap = {};
  for (const c of classes) cMap[String(c.short_code).toUpperCase()] = c.id;
  return cMap;
}

// Resolve a raw CLASS cell (e.g. "5", "BS5", "KG1") to a class id, or null.
function resolveClassId(cMap, classRaw) {
  const raw = String(classRaw || '').trim().toUpperCase();
  if (!raw) return null;
  return cMap[raw] || cMap[`BS${raw}`] || cMap[`KG${raw}`] || null;
}

// Read every data row from the sheet into a plain object. Nothing is written.
async function readStudentSheet(filePath) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('The Excel file has no worksheets.');
  const headerRow = ws.getRow(1).values;
  const headerIdx = {};
  headerRow.forEach((h, i) => {
    if (h) headerIdx[String(unwrapCell(h)).trim().toUpperCase()] = i;
  });

  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, idx) => {
    if (idx === 1) return;
    const vals = row.values;
    const get = (key) => {
      const i = headerIdx[String(key).toUpperCase()];
      if (i === undefined) return null;
      return unwrapCell(vals[i]);
    };
    const safeGet = (key, transform = (v) => v) => {
      try {
        const raw = get(key);
        return raw === null || raw === undefined || raw === '' ? null : transform(raw);
      } catch (e) {
        return null;
      }
    };
    // Keep the RAW date-of-birth text too, so we can flag values we couldn't
    // parse instead of silently discarding them.
    const dobRaw = safeGet('DATE OF BIRTH', String);
    const data = {
      surname:            safeGet('SURNAME', String),
      first_name:         safeGet('FIRST NAME', String),
      other_names:        safeGet('OTHER NAMES', String),
      gender:             (() => {
                            const raw = (safeGet('GENDER', String) || safeGet('SEX', String) || '').toString().trim().toLowerCase();
                            if (raw === 'm' || raw === 'male' || raw === 'boy') return 'Male';
                            if (raw === 'f' || raw === 'female' || raw === 'girl') return 'Female';
                            return safeGet('GENDER', String) || safeGet('SEX', String) || '';
                          })(),
      denomination:       safeGet('DENOMINATION', String),
      age:                safeGet('AGE', (v) => parseInt(v, 10) || null),
      date_of_birth:      safeGet('DATE OF BIRTH', toIsoDate),
      place_of_birth:     safeGet('PLACE OF BIRTH', String),
      place_of_residence: safeGet('PLACE OF RESIDENCE', String),
      father_name:        safeGet("FATHER'S NAME", String) || safeGet('FATHER NAME', String),
      father_contact:     safeGet("FATHER'S CONTACT", String) || safeGet('FATHER CONTACT', String),
      mother_name:        safeGet("MOTHER'S NAME", String) || safeGet('MOTHER NAME', String),
      mother_contact:     safeGet("MOTHER'S CONTACT", String) || safeGet('MOTHER CONTACT', String),
      guardian_name:      safeGet("GUARDIAN'S NAME", String) || safeGet('GUARDIAN NAME', String),
      guardian_contact:   safeGet("GUARDIAN'S CONTACT", String) || safeGet('GUARDIAN CONTACT', String),
      street_address:     safeGet('STREET ADDRESS', String),
      house_number:       safeGet('HOUSE NO', String) || safeGet('HOUSE NUMBER', String),
      digital_address:    safeGet('DIGITAL ADDRESS', String) || safeGet('GHANA POST GPS', String),
      nhis_number:        safeGet('NHIS NO', String) || safeGet('NHIS NUMBER', String),
      index_number:       safeGet('INDEX NUMBER', String) || safeGet('INDEX NO', String),
      admission_date:     safeGet('ADMISSION DATE', toIsoDate),
      notes:              safeGet('NOTES', String),
    };
    if (data.index_number) data.index_number = String(data.index_number).trim();
    rows.push({
      rowNumber: idx,
      data,
      classRaw: safeGet('CLASS', String) || '',
      dobRaw,
    });
  });
  return rows;
}

// Find the existing student a row refers to. THE KEY RULE: if the row carries
// an index number, we match ONLY by that index. A distinct index number always
// means a distinct student, so we never fall back to name matching (that is what
// used to collapse two same-named students — e.g. twins — into one record).
function resolveExistingStudent(db, data) {
  const idx = data.index_number ? String(data.index_number).trim() : '';
  if (idx) {
    return db.prepare(
      'SELECT id, index_number, surname, first_name FROM students WHERE index_number = ?'
    ).get(idx) || null;
  }
  if (data.surname && data.first_name) {
    if (data.date_of_birth) {
      const m = db.prepare(`
        SELECT id, index_number, surname, first_name FROM students
        WHERE LOWER(surname) = LOWER(?) AND LOWER(first_name) = LOWER(?) AND date_of_birth = ?
      `).get(data.surname, data.first_name, data.date_of_birth);
      if (m) return m;
    }
    if (data.current_class_id) {
      const m = db.prepare(`
        SELECT id, index_number, surname, first_name FROM students
        WHERE LOWER(surname) = LOWER(?) AND LOWER(first_name) = LOWER(?) AND current_class_id = ?
      `).get(data.surname, data.first_name, data.current_class_id);
      if (m) return m;
    }
  }
  return null;
}

// Apply an in-place UPDATE to an existing student. Only non-empty fields are
// written (we never blank out existing data). A blank index is never applied,
// so an existing student's index number can never be wiped by an import.
function applyStudentUpdate(db, existingId, data) {
  const setClauses = [];
  const params = [];
  for (const f of UPDATABLE_FIELDS) {
    if (data[f] !== null && data[f] !== undefined && data[f] !== '') {
      setClauses.push(`${f} = ?`);
      params.push(data[f]);
    }
  }
  // Allow an explicit index-number change from the review grid (uniqueness is
  // validated before we get here), but only when a value is actually provided.
  if (data.index_number && String(data.index_number).trim() !== '') {
    setClauses.push('index_number = ?');
    params.push(String(data.index_number).trim());
  }
  if (setClauses.length === 0) return false;
  params.push(existingId);
  db.prepare(
    `UPDATE students SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(...params);
  return true;
}

// Validate a single resolved row. Returns an array of issues:
//   { level: 'error' | 'warning', field, message }
// 'error' blocks the commit for that row; 'warning' is informational only.
function validateStudentRow(db, { data, classId, existing, rowNumber }, seenIndex) {
  const issues = [];
  const idx = data.index_number ? String(data.index_number).trim() : '';

  if (!data.surname && !data.first_name) {
    issues.push({ level: 'error', field: 'surname', message: 'No name — enter a surname or first name.' });
  }
  if (!existing && !classId) {
    issues.push({ level: 'error', field: 'current_class_id', message: 'Class not recognised — choose a class for this new student.' });
  }
  // A date-of-birth value that was typed but could not be parsed.
  if (!data.date_of_birth && data.dobRaw && String(data.dobRaw).trim() !== '') {
    issues.push({ level: 'error', field: 'date_of_birth', message: `Date of birth "${data.dobRaw}" is not a valid date (use DD/MM/YYYY).` });
  }
  if (idx) {
    // Duplicate index inside the same sheet.
    if (seenIndex && seenIndex.has(idx)) {
      issues.push({ level: 'error', field: 'index_number', message: `Index number "${idx}" appears more than once in this file (also on row ${seenIndex.get(idx)}).` });
    }
    // Index already used by a DIFFERENT existing student (name mismatch).
    if (existing) {
      const sameName = String(existing.surname || '').toLowerCase() === String(data.surname || '').toLowerCase()
                    && String(existing.first_name || '').toLowerCase() === String(data.first_name || '').toLowerCase();
      if (!sameName) {
        issues.push({ level: 'warning', field: 'index_number', message: `Index "${idx}" already belongs to ${existing.surname || ''} ${existing.first_name || ''} — importing will UPDATE that record.` });
      }
    }
  } else {
    // No index supplied → it will be auto-assigned on import.
    issues.push({ level: 'warning', field: 'index_number', message: 'No index number — one will be auto-assigned. Type one to set it manually.' });
  }
  return issues;
}

// Legacy one-shot import. Kept for compatibility, but now (a) honors provided
// index numbers, (b) matches by index only when an index is present, and
// (c) reports every skipped row instead of silently losing it.
async function bulkUploadFromExcel(db, filePath) {
  const rows = await readStudentSheet(filePath);
  const cMap = buildClassMap(db);

  let imported = 0, updated = 0, skipped = 0, duplicates = 0;
  const errors = [];
  const seenIndex = new Map();

  for (const r of rows) {
    const { rowNumber, data, classRaw } = r;
    const classId = resolveClassId(cMap, classRaw);
    data.current_class_id = classId;

    if (!data.surname && !data.first_name) {
      skipped++;
      errors.push(`Row ${rowNumber}: no name provided`);
      continue;
    }

    const existing = resolveExistingStudent(db, data);
    const idx = data.index_number ? String(data.index_number).trim() : '';

    try {
      if (existing) {
        if (applyStudentUpdate(db, existing.id, data)) updated++;
        duplicates++;
      } else {
        if (!classId) {
          skipped++;
          errors.push(`Row ${rowNumber} (${data.surname || ''} ${data.first_name || ''}): class "${classRaw}" not recognised`);
          continue;
        }
        createStudentInternal(db, data);
        imported++;
      }
      if (idx) seenIndex.set(idx, rowNumber);
    } catch (err) {
      skipped++;
      errors.push(`Row ${rowNumber} (${data.surname || ''} ${data.first_name || ''}): ${err.message}`);
    }
  }

  return { ok: true, imported, updated, skipped, duplicates, errors };
}

// PHASE 1 — parse + validate the whole sheet. No database writes. Returns every
// row (with its resolved action and any issues) so the UI can present a review
// grid where the user fixes problems before committing.
async function bulkPreviewFromExcel(db, filePath) {
  let rows;
  try {
    rows = await readStudentSheet(filePath);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const cMap = buildClassMap(db);
  const classList = db.prepare('SELECT id, name, short_code FROM class_groups ORDER BY level_order').all();

  const seenIndex = new Map();
  const out = [];
  for (const r of rows) {
    const { rowNumber, data, classRaw, dobRaw } = r;
    const classId = resolveClassId(cMap, classRaw);
    data.current_class_id = classId;
    data.dobRaw = dobRaw;
    const existing = resolveExistingStudent(db, data);
    const issues = validateStudentRow(db, { data, classId, existing, rowNumber }, seenIndex);

    const idx = data.index_number ? String(data.index_number).trim() : '';
    if (idx && !seenIndex.has(idx)) seenIndex.set(idx, rowNumber);

    const hasError = issues.some(i => i.level === 'error');
    const hasWarning = issues.some(i => i.level === 'warning');
    out.push({
      rowNumber,
      data,
      classRaw,
      class_short: classId ? (classList.find(c => c.id === classId)?.short_code || '') : '',
      action: existing ? 'update' : 'create',
      existingId: existing ? existing.id : null,
      existingName: existing ? `${existing.surname || ''} ${existing.first_name || ''}`.trim() : null,
      issues,
      status: hasError ? 'error' : (hasWarning ? 'warning' : 'ok'),
    });
  }

  return {
    ok: true,
    rows: out,
    classes: classList,
    summary: {
      total: out.length,
      errors: out.filter(r => r.status === 'error').length,
      warnings: out.filter(r => r.status === 'warning').length,
      ready: out.filter(r => r.status !== 'error').length,
    },
  };
}

// PHASE 2 — commit the reviewed rows. Each row is written independently (its own
// try/catch, no shared transaction) so one bad row can never roll back or drop
// the rest. Rows that still fail are returned in `failed` so the user can fix and
// retry — nothing is ever silently lost.
function bulkCommitRows(db, rows) {
  const cMap = buildClassMap(db);
  let created = 0, updated = 0;
  const failed = [];
  const seenIndex = new Map();

  for (const raw of rows) {
    const rowNumber = raw.rowNumber;
    // Normalise the incoming (possibly hand-edited) row into a clean data object.
    const data = {};
    for (const f of IMPORT_FIELDS) {
      let v = raw.data ? raw.data[f] : raw[f];
      if (typeof v === 'string') v = v.trim();
      data[f] = (v === undefined || v === '') ? null : v;
    }
    // Class can arrive as an id (from the grid dropdown) or a raw code.
    let classId = null;
    const rawClassId = raw.data ? raw.data.current_class_id : raw.current_class_id;
    if (rawClassId !== undefined && rawClassId !== null && rawClassId !== '') {
      classId = parseInt(rawClassId, 10) || null;
    }
    if (!classId) classId = resolveClassId(cMap, raw.classRaw);
    data.current_class_id = classId;
    // Re-parse the (possibly edited) date so validation reflects what the user
    // actually left in the cell, not the original sheet text.
    const dobIn = data.date_of_birth;
    const dobParsed = dobIn ? toIsoDate(dobIn) : null;
    data.date_of_birth = dobParsed;
    data.dobRaw = (dobIn && !dobParsed) ? dobIn : null;

    const existing = resolveExistingStudent(db, data);
    const issues = validateStudentRow(db, { data, classId, existing, rowNumber }, seenIndex);
    const blocking = issues.filter(i => i.level === 'error');
    const idx = data.index_number ? String(data.index_number).trim() : '';

    if (blocking.length > 0) {
      failed.push({ rowNumber, data, classRaw: raw.classRaw, reasons: blocking.map(i => i.message) });
      continue;
    }

    try {
      // Extra safety: a manual index that collides with a different existing
      // student (not the one we resolved) must not overwrite them.
      if (idx) {
        const clash = db.prepare('SELECT id FROM students WHERE index_number = ?').get(idx);
        if (clash && (!existing || clash.id !== existing.id)) {
          failed.push({ rowNumber, data, classRaw: raw.classRaw, reasons: [`Index number "${idx}" is already used by another student.`] });
          continue;
        }
      }
      if (existing) {
        if (applyStudentUpdate(db, existing.id, data)) updated++;
      } else {
        createStudentInternal(db, data);
        created++;
      }
      if (idx) seenIndex.set(idx, rowNumber);
    } catch (err) {
      failed.push({ rowNumber, data, classRaw: raw.classRaw, reasons: [err.message] });
    }
  }

  return { ok: failed.length === 0, created, updated, failed };
}

// Cell value unwrapper — handles every type ExcelJS returns
function unwrapCell(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  // Rich text { richText: [...] }
  if (v.richText && Array.isArray(v.richText)) {
    return v.richText.map(rt => rt.text).join('');
  }
  // Formula result { result: ... }
  if (v.result !== undefined) return unwrapCell(v.result);
  // Hyperlink { text: ..., hyperlink: ... }
  if (v.text !== undefined) return v.text;
  // Shared formula or other object — try a plain string
  return String(v);
}

// Robust date parser — accepts Excel Date objects, ISO strings, dd/mm/yyyy,
// dd-mm-yyyy, and Excel serial numbers
function toIsoDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    // Excel serial date (days since 1899-12-30, with leap year bug)
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  // ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // dd/mm/yyyy or dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y, 10) > 50 ? '19' : '20') + y;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  // Fallback — try Date.parse
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

async function bulkDownloadToExcel(db, filters, savePath) {
  const ExcelJS = require('exceljs');
  let sql = `
    SELECT s.index_number, c.short_code AS class, s.denomination, s.gender,
           s.surname, s.first_name, s.other_names, s.age, s.date_of_birth,
           s.place_of_birth, s.place_of_residence,
           s.father_name, s.father_contact, s.mother_name, s.mother_contact,
           s.guardian_name, s.guardian_contact,
           s.street_address, s.house_number, s.digital_address, s.nhis_number,
           s.status
    FROM students s
    LEFT JOIN class_groups c ON c.id = s.current_class_id
    WHERE 1=1
  `;
  const params = [];
  if (filters.classId) { sql += ' AND s.current_class_id = ?'; params.push(filters.classId); }
  if (filters.status) { sql += ' AND s.status = ?'; params.push(filters.status); }
  sql += ' ORDER BY c.level_order, s.surname, s.first_name';
  const rows = db.prepare(sql).all(...params);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Students');
  ws.columns = [
    { header: 'INDEX NUMBER', key: 'index_number', width: 18 },
    { header: 'CLASS', key: 'class', width: 8 },
    { header: 'DENOMINATION', key: 'denomination', width: 14 },
    { header: 'GENDER', key: 'gender', width: 8 },
    { header: 'SURNAME', key: 'surname', width: 16 },
    { header: 'FIRST NAME', key: 'first_name', width: 16 },
    { header: 'OTHER NAMES', key: 'other_names', width: 16 },
    { header: 'AGE', key: 'age', width: 6 },
    { header: 'DATE OF BIRTH', key: 'date_of_birth', width: 14 },
    { header: 'PLACE OF BIRTH', key: 'place_of_birth', width: 16 },
    { header: 'PLACE OF RESIDENCE', key: 'place_of_residence', width: 18 },
    { header: "FATHER'S NAME", key: 'father_name', width: 20 },
    { header: "FATHER'S CONTACT", key: 'father_contact', width: 16 },
    { header: "MOTHER'S NAME", key: 'mother_name', width: 20 },
    { header: "MOTHER'S CONTACT", key: 'mother_contact', width: 16 },
    { header: "GUARDIAN'S NAME", key: 'guardian_name', width: 20 },
    { header: "GUARDIAN'S CONTACT", key: 'guardian_contact', width: 16 },
    { header: 'STREET ADDRESS', key: 'street_address', width: 18 },
    { header: 'HOUSE NO', key: 'house_number', width: 12 },
    { header: 'DIGITAL ADDRESS', key: 'digital_address', width: 16 },
    { header: 'NHIS NO', key: 'nhis_number', width: 14 },
    { header: 'STATUS', key: 'status', width: 10 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A6B' } };
  rows.forEach(r => ws.addRow(r));
  await wb.xlsx.writeFile(savePath);
  return { ok: true, path: savePath, count: rows.length };
}

module.exports = registerStudentHandlers;
