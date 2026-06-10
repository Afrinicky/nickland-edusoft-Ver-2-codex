// Nickland Edusoft — Students Sheet (WHONET-style editable grid)
// Copyright © 2026 Nickland Sales. All rights reserved.

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
  mother_name:        { col: 'mother_name',        type: 'text' },
  mother_contact:     { col: 'mother_contact',     type: 'text' },
  guardian_name:      { col: 'guardian_name',      type: 'text' },
  guardian_contact:   { col: 'guardian_contact',   type: 'text' },
  current_class_id:   { col: 'current_class_id',   type: 'fk' },
  status:             { col: 'status',             type: 'enum', values: ['Active', 'Inactive', 'Graduated', 'Transferred'] },
  inactive_reason:    { col: 'inactive_reason',    type: 'text' },
  admission_date:     { col: 'admission_date',     type: 'date' },
  notes:              { col: 'notes',              type: 'text' },
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

module.exports = function registerStudentsSheetHandlers(ipcMain, db) {

  // ── Full sheet data (all students with all editable fields + live age) ──
  ipcMain.handle('students:sheet-data', (_e, filters = {}) => {
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
        s.mother_name,
        s.mother_contact,
        s.guardian_name,
        s.guardian_contact,
        s.current_class_id,
        c.name AS class_name,
        c.short_code AS class_short,
        s.status,
        s.inactive_reason,
        s.admission_date,
        s.notes
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
  });

  // ── Update a single cell ─────────────────────────────
  ipcMain.handle('students:sheet-update-cell', (_e, { studentId, field, value }) => {
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
  });

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
  ipcMain.handle('students:sheet-columns', () => {
    return Object.entries(FIELD_MAP).map(([field, spec]) => ({
      field,
      type: spec.type,
      values: spec.values || null,
    }));
  });
};
