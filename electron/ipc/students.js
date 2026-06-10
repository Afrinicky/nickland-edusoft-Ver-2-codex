// Students IPC handlers — all student CRUD and bulk operations.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const {
  getAdmissionYear,
  formatIndexNumber,
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
    return createStudentInternal(db, data);
  });

  ipcMain.handle('students:update', (_e, { id, data }) => {
    const fields = [
      'surname', 'first_name', 'other_names', 'gender', 'denomination', 'date_of_birth',
      'age', 'place_of_birth', 'place_of_residence', 'street_address', 'house_number',
      'digital_address', 'nhis_number', 'father_name', 'father_contact', 'mother_name',
      'mother_contact', 'guardian_name', 'guardian_contact', 'current_class_id',
      'status', 'inactive_reason', 'admission_date', 'notes', 'index_number',
    ];
    const setClauses = [];
    const params = [];
    for (const f of fields) {
      if (data[f] !== undefined) {
        setClauses.push(`${f} = ?`);
        params.push(data[f]);
      }
    }
    if (setClauses.length === 0) return { ok: true };
    params.push(id);
    db.prepare(
      `UPDATE students SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(...params);
    return { ok: true };
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

  // Bulk upload from Excel
  ipcMain.handle('students:bulk-upload', async (_e, filePath) => {
    return await bulkUploadFromExcel(db, filePath);
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

  const admissionYear = data.admission_year || getAdmissionYear(classRow.short_code, currentYear);

  // Use provided index/roll or generate next
  let rollNumber = data.roll_number;
  let indexNumber = data.index_number;
  if (!rollNumber || !indexNumber) {
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
      father_name, father_contact, mother_name, mother_contact,
      guardian_name, guardian_contact, current_class_id, status,
      admission_date, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    indexNumber, admissionYear, rollNumber,
    data.surname || '', data.first_name || '', data.other_names || '',
    data.gender || '', data.denomination || '', data.age || null,
    data.date_of_birth || null, data.place_of_birth || '', data.place_of_residence || '',
    data.street_address || '', data.house_number || '', data.digital_address || '',
    data.nhis_number || '',
    data.father_name || '', data.father_contact || '',
    data.mother_name || '', data.mother_contact || '',
    data.guardian_name || '', data.guardian_contact || '',
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

async function bulkUploadFromExcel(db, filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const headerRow = ws.getRow(1).values;
  const headerIdx = {};
  headerRow.forEach((h, i) => {
    if (h) headerIdx[String(unwrapCell(h)).trim().toUpperCase()] = i;
  });

  const classes = db.prepare('SELECT id, short_code FROM class_groups').all();
  const cMap = {};
  for (const c of classes) cMap[c.short_code.toUpperCase()] = c.id;

  let imported = 0, updated = 0, skipped = 0, duplicates = 0;
  const errors = [];

  ws.eachRow({ includeEmpty: false }, (row, idx) => {
    if (idx === 1) return;
    const vals = row.values;

    // Robust cell value extraction — handles strings, numbers, dates,
    // rich text objects, formula results, hyperlinks, and ExcelJS cell objects.
    const get = (key) => {
      const i = headerIdx[String(key).toUpperCase()];
      if (i === undefined) return null;
      return unwrapCell(vals[i]);
    };

    // Read & normalize ALL fields up front (each in its own try/catch so a
    // single bad cell doesn't lose the entire row)
    const safeGet = (key, transform = (v) => v) => {
      try {
        const raw = get(key);
        return raw === null || raw === undefined || raw === '' ? null : transform(raw);
      } catch (e) {
        return null;
      }
    };

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
      // Age is NOT stored — derived from DOB. We accept it from Excel
      // only as a fallback for students without DOB.
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

    // Class lookup
    const classRaw = (safeGet('CLASS', String) || '').trim().toUpperCase();
    const classId = cMap[classRaw] || cMap[`BS${classRaw}`] || cMap[`KG${classRaw}`] || null;
    if (!classId && !data.index_number) {
      skipped++;
      errors.push(`Row ${idx}: class "${classRaw}" not found and no index number provided`);
      return;
    }
    data.current_class_id = classId;

    // Minimum requirement: at least a surname OR first name
    if (!data.surname && !data.first_name) {
      skipped++;
      errors.push(`Row ${idx}: no name provided`);
      return;
    }

    // DUPLICATE DETECTION — three strategies:
    //   1. If row has an index_number, match by that.
    //   2. Otherwise, match by (surname + first_name + DOB) if DOB exists.
    //   3. Otherwise, match by (surname + first_name + current_class_id).
    let existing = null;
    if (data.index_number) {
      existing = db.prepare('SELECT id FROM students WHERE index_number = ?').get(data.index_number);
    }
    if (!existing && data.surname && data.first_name) {
      if (data.date_of_birth) {
        existing = db.prepare(`
          SELECT id FROM students
          WHERE LOWER(surname) = LOWER(?) AND LOWER(first_name) = LOWER(?)
          AND date_of_birth = ?
        `).get(data.surname, data.first_name, data.date_of_birth);
      } else if (data.current_class_id) {
        existing = db.prepare(`
          SELECT id FROM students
          WHERE LOWER(surname) = LOWER(?) AND LOWER(first_name) = LOWER(?)
          AND current_class_id = ?
        `).get(data.surname, data.first_name, data.current_class_id);
      }
    }

    try {
      if (existing) {
        // UPDATE — only fill in fields that have new values; never overwrite
        // with NULL/empty values.
        const setClauses = [];
        const params = [];
        const updatableFields = [
          'surname', 'first_name', 'other_names', 'gender', 'denomination',
          'date_of_birth', 'place_of_birth', 'place_of_residence',
          'street_address', 'house_number', 'digital_address', 'nhis_number',
          'father_name', 'father_contact', 'mother_name', 'mother_contact',
          'guardian_name', 'guardian_contact', 'current_class_id',
          'admission_date', 'notes',
        ];
        for (const f of updatableFields) {
          if (data[f] !== null && data[f] !== undefined && data[f] !== '') {
            setClauses.push(`${f} = ?`);
            params.push(data[f]);
          }
        }
        if (setClauses.length > 0) {
          params.push(existing.id);
          db.prepare(
            `UPDATE students SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
          ).run(...params);
          updated++;
          duplicates++;
        } else {
          duplicates++;
        }
      } else {
        // CREATE
        if (!classId) {
          skipped++;
          errors.push(`Row ${idx}: new student needs a valid class`);
          return;
        }
        createStudentInternal(db, data);
        imported++;
      }
    } catch (err) {
      skipped++;
      errors.push(`Row ${idx} (${data.surname || ''} ${data.first_name || ''}): ${err.message}`);
    }
  });

  return { ok: true, imported, updated, skipped, duplicates, errors };
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
