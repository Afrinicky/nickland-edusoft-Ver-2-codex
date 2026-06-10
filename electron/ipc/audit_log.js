// Nickland Edusoft — Audit Log IPC
// Records sensitive actions: delete, reversal, backdating, large amount changes
// Copyright © 2026 Nickland Sales. All rights reserved.

module.exports = function registerAuditLogHandlers(ipcMain, db) {

  // Write an audit entry (called by other handlers AND the UI)
  ipcMain.handle('audit:log', (_e, data) => {
    if (!data.entity_type || !data.action) {
      return { ok: false, error: 'entity_type and action required' };
    }
    const r = db.prepare(`
      INSERT INTO audit_log
        (entity_type, entity_id, action, user_id, justification,
         before_data, after_data, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.entity_type, data.entity_id || null, data.action,
      data.user_id || null, data.justification || null,
      data.before_data ? JSON.stringify(data.before_data) : null,
      data.after_data ? JSON.stringify(data.after_data) : null,
      data.severity || 'normal'
    );
    return { ok: true, id: r.lastInsertRowid };
  });

  // Read recent entries (newest first)
  ipcMain.handle('audit:list', (_e, filters = {}) => {
    let sql = `
      SELECT a.*, u.full_name AS user_name
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE 1=1
    `;
    const params = [];
    if (filters.entityType) { sql += ' AND a.entity_type = ?'; params.push(filters.entityType); }
    if (filters.action)     { sql += ' AND a.action = ?'; params.push(filters.action); }
    if (filters.severity)   { sql += ' AND a.severity = ?'; params.push(filters.severity); }
    if (filters.fromDate)   { sql += ' AND a.created_at >= ?'; params.push(filters.fromDate); }
    if (filters.userId)     { sql += ' AND a.user_id = ?'; params.push(filters.userId); }
    sql += ' ORDER BY a.created_at DESC';
    if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
    return db.prepare(sql).all(...params);
  });
};
