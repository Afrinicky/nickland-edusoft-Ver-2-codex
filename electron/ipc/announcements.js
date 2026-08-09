// Nickland Edusoft — Announcements (school → parents, shown on the web portal)
// Copyright © 2026 Nickland Sales. All rights reserved.
// The desktop owns announcements; each one is projected to the cloud so the
// parent portal can display it (no-op unless cloud sync is enabled).

const { postToOutbox } = require('../server/sync/outbox');

function project(db, id) {
  try {
    const a = db.prepare(`
      SELECT a.*, s.surname, s.first_name FROM announcements a
      LEFT JOIN students s ON s.id = a.target_student_id WHERE a.id = ?
    `).get(id);
    if (!a) return;
    postToOutbox(db, {
      entity_type: 'announcement',
      entity_key: `announcement:${id}`,
      op: a.is_active ? 'upsert' : 'delete',
      payload: {
        id, title: a.title, body: a.body, audience: a.audience,
        student_id: a.target_student_id || null,
        student_name: a.target_student_id ? `${a.surname || ''} ${a.first_name || ''}`.trim() : null,
        created_at: a.created_at, is_active: a.is_active,
      },
    });
  } catch (_) {}
}

module.exports = function registerAnnouncementsHandlers(ipcMain, db) {
  const security = require('./_security');

  ipcMain.handle('announcements:list', () => {
    return db.prepare(`
      SELECT a.*, s.surname, s.first_name, s.index_number, u.full_name AS created_by_name
      FROM announcements a
      LEFT JOIN students s ON s.id = a.target_student_id
      LEFT JOIN users u ON u.id = a.created_by
      ORDER BY a.created_at DESC
    `).all();
  });

  ipcMain.handle('announcements:save', (_e, data) => {
    if (!security.checkPermission(db, 'notifications', 'edit')) {
      return { ok: false, error: 'Access denied. You cannot post announcements.' };
    }
    if (!data.title || !data.body) return { ok: false, error: 'Title and message are required.' };
    let id = data.id;
    if (id) {
      db.prepare(`
        UPDATE announcements SET title = ?, body = ?, audience = ?, target_student_id = ?, is_active = ?
        WHERE id = ?
      `).run(data.title, data.body, data.audience || 'all',
        data.audience === 'student' ? (data.target_student_id || null) : null,
        data.is_active ?? 1, id);
    } else {
      const r = db.prepare(`
        INSERT INTO announcements (title, body, audience, target_student_id, created_by)
        VALUES (?, ?, ?, ?, ?)
      `).run(data.title, data.body, data.audience || 'all',
        data.audience === 'student' ? (data.target_student_id || null) : null,
        security.getCurrentUserId());
      id = r.lastInsertRowid;
    }
    project(db, id);
    return { ok: true, id };
  });

  ipcMain.handle('announcements:delete', (_e, id) => {
    if (!security.checkPermission(db, 'notifications', 'edit')) {
      return { ok: false, error: 'Access denied.' };
    }
    db.prepare('UPDATE announcements SET is_active = 0 WHERE id = ?').run(id);
    project(db, id); // projects a delete op so the portal drops it
    db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
    return { ok: true };
  });
};

module.exports.project = project;
