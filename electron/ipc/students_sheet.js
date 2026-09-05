// Nickland Edusoft — Students Sheet (WHONET-style editable grid)
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A whole class on one screen, corrected in place — the way an office actually
// works through a pile of admission forms, rather than opening four hundred
// records one at a time.
//
// The columns are the admission form's columns. When the form grew — the
// previous school, who the pupil lives with, the emergency contact, the
// medical facts — the sheet did not, so the office could enter those at
// admission and then had no way to correct a typo in any of them without
// opening the pupil's record.
const studentStatus = require('./_student_status');

// Whitelist of fields that the sheet is allowed to edit directly.
// Each entry maps the sheet column → DB column and an optional validator.
const FIELD_MAP = {
  index_number:       { col: 'index_number',       type: 'text' },
  surname:            { col: 'surname',            type: 'text' },
  first_name:         { col: 'first_name',         type: 'text' },
  other_names:        { col: 'other_names',        type: 'text' },
  gender:             { col: 'gender',             type: 'enum', values: ['Male', 'Female'] },
  denomination:       { col: 'denomination',       type: 'text' },
  date_of_birth:      { col: 'date_of_birth',      type: 'date' },
  place_of_birth:     { col: 'place_of_birth',     type: 'text' },
  place_of_residence: { col: 'place_of_residence', type: 'text' },
  street_address:     { col: 'street_address',     type: 'text' },
  house_number:       { col: 'house_number',       type: 'text' },
  digital_address:    { col: 'digital_address',    type: 'text' },
  nhis_number:        { col: 'nhis_number',        type: 'text' },
  father_name:        { col: 'father_name',        type: 'text' },
  father_contact:     { col: 'father_contact',     type: 'text' },
  father_email:       { col: 'father_email',       type: 'text' },
  mother_name:        { col: 'mother_name',        type: 'text' },
  mother_contact:     { col: 'mother_contact',     type: 'text' },
  mother_email:       { col: 'mother_email',       type: 'text' },
  guardian_name:      { col: 'guardian_name',      type: 'text' },
  guardian_contact:   { col: 'guardian_contact',   type: 'text' },
  guardian_email:     { col: 'guardian_email',     type: 'text' },
  current_class_id:   { col: 'current_class_id',   type: 'fk' },
  status:             { col: 'status',             type: 'enum', values: studentStatus.VALUES },
  inactive_reason:    { col: 'inactive_reason',    type: 'text' },
  admission_date:     { col: 'admission_date',     type: 'date' },
  notes:              { col: 'notes',              type: 'text' },

  // What the admission form asks for and the sheet could not correct.
  nationality:            { col: 'nationality',            type: 'text' },
  hometown:               { col: 'hometown',               type: 'text' },
  previous_school:        { col: 'previous_school',        type: 'text' },
  lives_with:             { col: 'lives_with',             type: 'enum',
    values: ['Both parents', 'Father', 'Mother', 'Guardian', 'Other'] },
  guardian_relationship:  { col: 'guardian_relationship',  type: 'text' },
  emergency_contact_name: { col: 'emergency_contact_name', type: 'text' },
  emergency_contact_phone:{ col: 'emergency_contact_phone', type: 'text' },
  blood_group:            { col: 'blood_group',            type: 'enum',
    values: ['O+', 'O−', 'A+', 'A−', 'B+', 'B−', 'AB+', 'AB−'] },
  allergies:              { col: 'allergies',              type: 'text' },
  medical_notes:          { col: 'medical_notes',          type: 'text' },
  special_needs:          { col: 'special_needs',          type: 'text' },
};

function validateValue(field, value) {
  const spec = FIELD_MAP[field];
  if (!spec) throw new Error(`Field "${field}" is not editable from the sheet`);
  if (value === null || value === undefined || value === '') return null;
  if (spec.type === 'enum' && !spec.values.includes(value)) {
    throw new Error(`Value "${value}" not allowed for ${field}. Use: ${spec.values.join(', ')}`);
  }
  if (spec.type === 'date') {
    const s = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      throw new Error(`Date for ${field} must be in YYYY-MM-DD format`);
    }
    return s;
  }
  if (spec.type === 'fk') {
    const n = parseInt(value, 10);
    if (isNaN(n)) throw new Error(`${field} must be an integer ID`);
    return n;
  }
  return value;
}

// The sheet's own column rules, so the browser's sheet edits exactly what the
// desktop's does rather than keeping a second whitelist.
module.exports = function registerStudentsSheetHandlers(ipcMain, db) {

  // ── Full sheet data (all students with all editable fields + live age) ──
  ipcMain.handle('students:sheet-data', (_e, filters = {}) => sheetData(db, filters));

  // ── Update a single cell ─────────────────────────────
  ipcMain.handle('students:sheet-update-cell', (_e, { studentId, field, value }) =>
    updateCell(db, { studentId, field, value }));

  // ── Batch update (saves an edited buffer at once) ────
  ipcMain.handle('students:sheet-batch-update', (_e, { changes }) => {
    const errors = [];
    let updated = 0;

    const tx = db.transaction(() => {
      for (const change of changes) {
        try {
          const cleanValue = validateValue(change.field, change.value);
          if (change.field === 'index_number' && cleanValue) {
            const dup = db.prepare(
              'SELECT id FROM students WHERE index_number = ? AND id != ?'
            ).get(cleanValue, change.studentId);
            if (dup) {
              errors.push(`Student #${change.studentId}: index number "${cleanValue}" already used`);
              continue;
            }
          }
          const spec = FIELD_MAP[change.field];
          db.prepare(
            `UPDATE students SET ${spec.col} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
          ).run(cleanValue, change.studentId);
          updated++;
        } catch (err) {
          errors.push(`Student #${change.studentId} ${change.field}: ${err.message}`);
        }
      }
    });
    tx();

    return { ok: errors.length === 0, updated, errors };
  });

  // ── Field definitions (so the sheet UI knows column types) ──
  ipcMain.handle('students:sheet-columns', () => sheetColumns());
};

// ── The sheet, as functions ─────────────────────────────────────────────────
//
// Lifted out of the IPC handlers so the HTTP server serves the SAME sheet the
// desktop shows: the same computed age, the same column whitelist, the same
// validation. A browser that queried the ordinary roll instead saw a different
// set of columns and could not correct most of them.

/** The whole sheet, filtered as the office filters it. */
function sheetData(db, filters = {}) {
  let sql = `
    SELECT
      s.id,
      s.index_number,
      s.admission_year,
      s.surname,
      s.first_name,
      s.other_names,
      s.gender,
      s.denomination,
      s.date_of_birth,
      CASE
        WHEN s.date_of_birth IS NOT NULL AND s.date_of_birth != ''
        THEN CAST((julianday('now') - julianday(s.date_of_birth)) / 365.25 AS INTEGER)
        ELSE s.age
      END AS age_computed,
      s.place_of_birth,
      s.place_of_residence,
      s.street_address,
      s.house_number,
      s.digital_address,
      s.nhis_number,
      s.father_name,
      s.father_contact,
      s.father_email,
      s.mother_name,
      s.mother_contact,
      s.mother_email,
      s.guardian_name,
      s.guardian_contact,
      s.guardian_email,
      s.current_class_id,
      c.name AS class_name,
      c.short_code AS class_short,
      s.status,
      s.inactive_reason,
      s.admission_date,
      s.notes,
      s.nationality,
      s.hometown,
      s.previous_school,
      s.lives_with,
      s.guardian_relationship,
      s.emergency_contact_name,
      s.emergency_contact_phone,
      s.blood_group,
      s.allergies,
      s.medical_notes,
      s.special_needs
    FROM students s
    LEFT JOIN class_groups c ON c.id = s.current_class_id
    WHERE 1=1
  `;
  const params = [];
  if (filters.classId) { sql += ' AND s.current_class_id = ?'; params.push(filters.classId); }
  if (filters.status)  { sql += ' AND s.status = ?'; params.push(filters.status); }
  if (filters.search) {
    sql += ' AND (s.surname LIKE ? OR s.first_name LIKE ? OR s.index_number LIKE ?)';
    const q = `%${filters.search}%`;
    params.push(q, q, q);
  }
  sql += ' ORDER BY c.level_order, s.surname, s.first_name';
  return db.prepare(sql).all(...params);
}

/** One corrected cell, validated against the column whitelist. */
function updateCell(db, { studentId, field, value }) {
  try {
    const cleanValue = validateValue(field, value);

    // Check for index_number uniqueness if that's what changed
    if (field === 'index_number' && cleanValue) {
      const dup = db.prepare(
        'SELECT id FROM students WHERE index_number = ? AND id != ?'
      ).get(cleanValue, studentId);
      if (dup) {
        return { ok: false, error: `Index number "${cleanValue}" is already used by another student` };
      }
    }

    const spec = FIELD_MAP[field];
    db.prepare(
      `UPDATE students SET ${spec.col} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(cleanValue, studentId);

    // Return the updated row so the UI can refresh computed fields like age
    const updated = db.prepare(`
      SELECT s.*,
             c.name AS class_name,
             c.short_code AS class_short,
             CASE
               WHEN s.date_of_birth IS NOT NULL AND s.date_of_birth != ''
               THEN CAST((julianday('now') - julianday(s.date_of_birth)) / 365.25 AS INTEGER)
               ELSE s.age
             END AS age_computed
      FROM students s
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE s.id = ?
    `).get(studentId);

    return { ok: true, row: updated };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** What the sheet may edit, and how. Read by the desktop and by the browser. */
function sheetColumns() {
  return Object.entries(FIELD_MAP).map(([field, spec]) => ({
    field,
    type: spec.type,
    values: spec.values || null,
  }));
}

module.exports.FIELD_MAP = FIELD_MAP;
module.exports.sheetData = sheetData;
module.exports.updateCell = updateCell;
module.exports.sheetColumns = sheetColumns;
module.exports.validateValue = validateValue;
