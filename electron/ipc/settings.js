// Settings IPC handlers — covers school identity, classes, terms, subjects, grading, and theming.
const fs = require('fs');
const path = require('path');

function registerSettingsHandlers(ipcMain, db, getResourcePath) {
  // ===== Generic key-value settings =====
  ipcMain.handle('settings:get-all', () => {
    const rows = db.prepare('SELECT key, value, category FROM settings').all();
    const grouped = {};
    for (const r of rows) {
      if (!grouped[r.category]) grouped[r.category] = {};
      grouped[r.category][r.key] = r.value;
    }
    return grouped;
  });

  ipcMain.handle('settings:set', (_e, { key, value }) => {
    // Upsert
    const existing = db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
    if (existing) {
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(String(value ?? ''), key);
    } else {
      db.prepare('INSERT INTO settings (key, value, category) VALUES (?, ?, ?)')
        .run(key, String(value ?? ''), 'custom');
    }
    return { ok: true };
  });

  // Save logo from chosen file path
  ipcMain.handle('settings:upload-logo', (_e, sourcePath) => {
    const ext = path.extname(sourcePath) || '.png';
    const destDir = path.join(db._userDataPath, 'uploads');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, `school_logo${ext}`);
    fs.copyFileSync(sourcePath, destPath);
    db.prepare("UPDATE settings SET value = ? WHERE key = 'school_logo_path'").run(destPath);
    return { ok: true, path: destPath };
  });

  // ===== Signature uploads =====
  // role must be 'proprietor' or 'headmaster'
  ipcMain.handle('settings:upload-signature', (_e, { role, sourcePath, name, userId }) => {
    if (!['proprietor', 'headmaster'].includes(role)) {
      return { ok: false, error: 'Invalid role. Must be proprietor or headmaster.' };
    }
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { ok: false, error: 'File not found' };
    }
    const ext = path.extname(sourcePath) || '.png';
    const destDir = path.join(db._userDataPath, 'uploads', 'signatures');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    // Use timestamp to bust file caches when the user re-uploads
    const destPath = path.join(destDir, `${role}_signature_${Date.now()}${ext}`);
    fs.copyFileSync(sourcePath, destPath);

    // Save path
    db.prepare(`UPDATE settings SET value = ? WHERE key = ?`)
      .run(destPath, `${role}_signature_path`);
    if (name !== undefined) {
      db.prepare(`UPDATE settings SET value = ? WHERE key = ?`)
        .run(name || '', `${role}_name`);
    }
    if (userId !== undefined) {
      db.prepare(`UPDATE settings SET value = ? WHERE key = ?`)
        .run(String(userId || ''), `${role}_user_id`);
    }
    return { ok: true, path: destPath };
  });

  ipcMain.handle('settings:remove-signature', (_e, role) => {
    if (!['proprietor', 'headmaster'].includes(role)) {
      return { ok: false, error: 'Invalid role' };
    }
    const cur = db.prepare("SELECT value FROM settings WHERE key = ?")
      .get(`${role}_signature_path`);
    if (cur?.value && fs.existsSync(cur.value)) {
      try { fs.unlinkSync(cur.value); } catch (e) {}
    }
    db.prepare(`UPDATE settings SET value = '' WHERE key = ?`).run(`${role}_signature_path`);
    db.prepare(`UPDATE settings SET value = 'false' WHERE key = ?`).run(`embed_${role}_signature`);
    return { ok: true };
  });

  // Get the signature for use in document generation
  // Enforces: only the assigned user (by designation) can use their signature
  ipcMain.handle('settings:get-signature-for-use', (_e, { role, currentUserId }) => {
    if (!['proprietor', 'headmaster'].includes(role)) {
      return { ok: false, error: 'Invalid role' };
    }
    const enabled = db.prepare("SELECT value FROM settings WHERE key = ?")
      .get(`embed_${role}_signature`)?.value === 'true';
    if (!enabled) {
      return { ok: false, error: `${role} signature embedding is disabled` };
    }
    const sigPath = db.prepare("SELECT value FROM settings WHERE key = ?")
      .get(`${role}_signature_path`)?.value;
    if (!sigPath) {
      return { ok: false, error: `No ${role} signature uploaded` };
    }
    const assignedUserId = db.prepare("SELECT value FROM settings WHERE key = ?")
      .get(`${role}_user_id`)?.value;
    // Access control: signature can only be embedded if the CURRENT user matches
    // the assigned user OR no specific user is assigned (school-wide signature)
    if (assignedUserId && String(currentUserId) !== String(assignedUserId)) {
      return {
        ok: false,
        error: `Only the assigned ${role} can apply this signature to documents.`,
        restricted: true,
      };
    }
    const name = db.prepare("SELECT value FROM settings WHERE key = ?")
      .get(`${role}_name`)?.value || '';
    return { ok: true, path: sigPath, name };
  });

  // ===== Class management =====
  ipcMain.handle('settings:list-classes', () => {
    return db.prepare(`
      SELECT c.*, p.name AS parent_name, (
        SELECT COUNT(*) FROM students s WHERE s.current_class_id = c.id AND s.status = 'Active'
      ) AS student_count
      FROM class_groups c
      LEFT JOIN class_groups p ON p.id = c.parent_class_id
      ORDER BY c.level_order, c.name
    `).all();
  });

  ipcMain.handle('settings:save-class', (_e, data) => {
    if (data.id) {
      db.prepare(`
        UPDATE class_groups SET name = ?, short_code = ?, level_category = ?,
          level_order = ?, section = ?, parent_class_id = ?, capacity = ?, is_active = ?
        WHERE id = ?
      `).run(
        data.name, data.short_code, data.level_category, data.level_order,
        data.section || null, data.parent_class_id || null,
        data.capacity || null, data.is_active ?? 1, data.id
      );
      return { ok: true, id: data.id };
    } else {
      const result = db.prepare(`
        INSERT INTO class_groups (name, short_code, level_category, level_order,
          section, parent_class_id, capacity, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.name, data.short_code, data.level_category, data.level_order,
        data.section || null, data.parent_class_id || null,
        data.capacity || null, data.is_active ?? 1
      );
      return { ok: true, id: result.lastInsertRowid };
    }
  });

  ipcMain.handle('settings:delete-class', (_e, id) => {
    const inUse = db.prepare('SELECT COUNT(*) AS c FROM students WHERE current_class_id = ?').get(id);
    if (inUse.c > 0) {
      return { ok: false, error: `Cannot delete: ${inUse.c} students are in this class. Reassign first.` };
    }
    db.prepare('DELETE FROM class_groups WHERE id = ?').run(id);
    return { ok: true };
  });

  // ===== Terms & Academic Years =====
  ipcMain.handle('settings:list-academic-years', () => {
    return db.prepare('SELECT * FROM academic_years ORDER BY id DESC').all();
  });

  ipcMain.handle('settings:save-academic-year', (_e, data) => {
    if (data.id) {
      db.prepare(`
        UPDATE academic_years SET label = ?, start_date = ?, end_date = ?, is_current = ?
        WHERE id = ?
      `).run(data.label, data.start_date, data.end_date, data.is_current ? 1 : 0, data.id);
      if (data.is_current) {
        db.prepare('UPDATE academic_years SET is_current = 0 WHERE id != ?').run(data.id);
      }
      return { ok: true, id: data.id };
    } else {
      const result = db.prepare(`
        INSERT INTO academic_years (label, start_date, end_date, is_current)
        VALUES (?, ?, ?, ?)
      `).run(data.label, data.start_date, data.end_date, data.is_current ? 1 : 0);
      if (data.is_current) {
        db.prepare('UPDATE academic_years SET is_current = 0 WHERE id != ?').run(result.lastInsertRowid);
      }
      return { ok: true, id: result.lastInsertRowid };
    }
  });

  ipcMain.handle('settings:list-terms', () => {
    return db.prepare(`
      SELECT t.*, ay.label AS year_label
      FROM terms t
      JOIN academic_years ay ON ay.id = t.academic_year_id
      ORDER BY ay.id DESC, t.term_number
    `).all();
  });

  ipcMain.handle('settings:save-term', (_e, data) => {
    if (data.id) {
      db.prepare(`
        UPDATE terms SET academic_year_id = ?, term_number = ?, label = ?,
          start_date = ?, end_date = ?
        WHERE id = ?
      `).run(data.academic_year_id, data.term_number, data.label,
        data.start_date, data.end_date, data.id);
      return { ok: true, id: data.id };
    } else {
      const result = db.prepare(`
        INSERT INTO terms (academic_year_id, term_number, label, start_date, end_date)
        VALUES (?, ?, ?, ?, ?)
      `).run(data.academic_year_id, data.term_number, data.label, data.start_date, data.end_date);
      return { ok: true, id: result.lastInsertRowid };
    }
  });

  ipcMain.handle('settings:set-current-term', (_e, id) => {
    db.prepare('UPDATE terms SET is_current = 0').run();
    db.prepare('UPDATE terms SET is_current = 1 WHERE id = ?').run(id);
    return { ok: true };
  });

  // ===== Grading bands =====
  ipcMain.handle('settings:list-grading-bands', () => {
    return db.prepare('SELECT * FROM grading_bands ORDER BY display_order').all();
  });

  ipcMain.handle('settings:save-grading-bands', (_e, bands) => {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM grading_bands').run();
      const ins = db.prepare(`
        INSERT INTO grading_bands (min_score, max_score, remark, display_order)
        VALUES (?, ?, ?, ?)
      `);
      bands.forEach((b, i) => ins.run(b.min_score, b.max_score, b.remark, b.display_order || (i + 1)));
    });
    tx();
    return { ok: true };
  });

  // ===== Subjects =====
  ipcMain.handle('settings:list-subjects', () => {
    return db.prepare('SELECT * FROM subjects WHERE is_active = 1 ORDER BY name').all();
  });

  ipcMain.handle('settings:save-subject', (_e, data) => {
    if (data.id) {
      db.prepare(`
        UPDATE subjects SET name = ?, code = ?, class_weight_pct = ?, exam_weight_pct = ?, is_active = ?
        WHERE id = ?
      `).run(data.name, data.code, data.class_weight_pct, data.exam_weight_pct,
        data.is_active ?? 1, data.id);
      return { ok: true, id: data.id };
    } else {
      const result = db.prepare(`
        INSERT INTO subjects (name, code, class_weight_pct, exam_weight_pct)
        VALUES (?, ?, ?, ?)
      `).run(data.name, data.code, data.class_weight_pct || 40, data.exam_weight_pct || 60);
      return { ok: true, id: result.lastInsertRowid };
    }
  });

  ipcMain.handle('settings:delete-subject', (_e, id) => {
    db.prepare('UPDATE subjects SET is_active = 0 WHERE id = ?').run(id);
    return { ok: true };
  });

  // Class ↔ subject mapping
  ipcMain.handle('settings:get-class-subjects', (_e, classId) => {
    return db.prepare(`
      SELECT s.* FROM subjects s
      JOIN class_subjects cs ON cs.subject_id = s.id
      WHERE cs.class_group_id = ? AND s.is_active = 1
      ORDER BY s.name
    `).all(classId);
  });

  ipcMain.handle('settings:set-class-subjects', (_e, { classId, subjectIds }) => {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM class_subjects WHERE class_group_id = ?').run(classId);
      const ins = db.prepare('INSERT INTO class_subjects (class_group_id, subject_id) VALUES (?, ?)');
      for (const sid of subjectIds) ins.run(classId, sid);
    });
    tx();
    return { ok: true };
  });
}

module.exports = registerSettingsHandlers;
