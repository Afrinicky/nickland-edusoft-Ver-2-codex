// Nickland Edusoft — Fee Discounts IPC
// Copyright © 2026 Nickland Sales. All rights reserved.

module.exports = function registerDiscountsHandlers(ipcMain, db) {

  // List all discounts (with student details)
  ipcMain.handle('discounts:list', (_e, filters = {}) => {
    let sql = `
      SELECT sd.*,
             s.surname, s.first_name, s.other_names, s.index_number,
             c.name AS class_name, c.short_code,
             u.full_name AS granted_by_name
      FROM student_discounts sd
      JOIN students s ON s.id = sd.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      LEFT JOIN users u ON u.id = sd.granted_by
      WHERE 1=1
    `;
    const params = [];
    if (filters.activeOnly) sql += ' AND sd.is_active = 1';
    if (filters.appliesTo)  { sql += ' AND (sd.applies_to = ? OR sd.applies_to = "both")'; params.push(filters.appliesTo); }
    if (filters.classId)    { sql += ' AND s.current_class_id = ?'; params.push(filters.classId); }
    sql += ' ORDER BY s.surname, s.first_name';
    return db.prepare(sql).all(...params);
  });

  // Get a single student's active discount
  ipcMain.handle('discounts:get-for-student', (_e, studentId) => {
    return db.prepare(`
      SELECT * FROM student_discounts
      WHERE student_id = ? AND is_active = 1
      ORDER BY created_at DESC
      LIMIT 1
    `).get(studentId);
  });

  // Save (create or update) a discount
  ipcMain.handle('discounts:save', (_e, data) => {
    if (!data.student_id) return { ok: false, error: 'student_id required' };
    if (!data.reason || !data.reason.trim()) return { ok: false, error: 'reason is required' };
    if (data.discount_value == null || data.discount_value < 0) {
      return { ok: false, error: 'discount value must be non-negative' };
    }
    if (data.discount_type === 'percent' && data.discount_value > 100) {
      return { ok: false, error: 'percent discount cannot exceed 100' };
    }

    if (data.id) {
      db.prepare(`
        UPDATE student_discounts SET
          discount_type = ?, discount_value = ?, reason = ?,
          applies_to = ?, is_active = ?,
          effective_from = ?, effective_to = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        data.discount_type || 'percent',
        data.discount_value,
        data.reason.trim(),
        data.applies_to || 'fees',
        data.is_active ? 1 : 0,
        data.effective_from || null,
        data.effective_to || null,
        data.id
      );
      return { ok: true, id: data.id };
    } else {
      // Deactivate any existing active discount for this student first
      db.prepare(`
        UPDATE student_discounts SET is_active = 0 WHERE student_id = ?
      `).run(data.student_id);

      const r = db.prepare(`
        INSERT INTO student_discounts
          (student_id, discount_type, discount_value, reason, applies_to,
           is_active, effective_from, effective_to, granted_by)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(
        data.student_id,
        data.discount_type || 'percent',
        data.discount_value,
        data.reason.trim(),
        data.applies_to || 'fees',
        data.effective_from || null,
        data.effective_to || null,
        data.granted_by || null
      );
      return { ok: true, id: r.lastInsertRowid };
    }
  });

  // Revoke (soft-delete) — sets is_active = 0
  ipcMain.handle('discounts:revoke', (_e, { id, reason, revokedBy }) => {
    if (!reason || !reason.trim()) {
      return { ok: false, error: 'revocation reason required' };
    }
    const cur = db.prepare('SELECT * FROM student_discounts WHERE id = ?').get(id);
    if (!cur) return { ok: false, error: 'discount not found' };

    db.prepare('UPDATE student_discounts SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);

    // Audit log
    try {
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, before_data, severity)
        VALUES ('discount', ?, 'revoke', ?, ?, ?, 'normal')
      `).run(id, revokedBy || null, reason.trim(), JSON.stringify(cur));
    } catch (e) {}

    return { ok: true };
  });

  // Compute discount applied to an amount for a student (used by fee bill computations)
  ipcMain.handle('discounts:compute', (_e, { studentId, amount, appliesTo }) => {
    const disc = db.prepare(`
      SELECT * FROM student_discounts
      WHERE student_id = ? AND is_active = 1
        AND (applies_to = ? OR applies_to = 'both')
      ORDER BY created_at DESC LIMIT 1
    `).get(studentId, appliesTo || 'fees');

    if (!disc) return { discount_amount: 0, net_amount: amount, has_discount: false };

    let discountAmount = 0;
    if (disc.discount_type === 'percent') {
      discountAmount = Math.round(amount * (disc.discount_value / 100) * 100) / 100;
    } else {
      discountAmount = Math.min(disc.discount_value, amount);
    }
    return {
      discount_amount: discountAmount,
      net_amount: Math.max(0, amount - discountAmount),
      has_discount: true,
      discount_id: disc.id,
      discount_type: disc.discount_type,
      discount_value: disc.discount_value,
      reason: disc.reason,
    };
  });

  // Audit-log helper for direct call from JS code (not exposed via IPC ideally)
  // Internal — used by other handlers
};
