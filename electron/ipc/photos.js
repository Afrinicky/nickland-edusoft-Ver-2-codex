// Nickland Edusoft — Profile Photo Upload IPC
// Generic photo handler used by students, staff, and users.
// Photos stored under %APPDATA%/NicklandEdusoft/uploads/photos/<entity_type>/<id>_<timestamp>.<ext>
// Copyright © 2026 Nickland Sales. All rights reserved.

const fs = require('fs');
const path = require('path');

const VALID_ENTITY_TYPES = ['students', 'staff', 'users'];
const VALID_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

module.exports = function registerPhotosHandlers(ipcMain, db, userDataPath) {

  ipcMain.handle('photos:upload', (_e, { entityType, entityId, sourcePath }) => {
    if (!VALID_ENTITY_TYPES.includes(entityType)) {
      return { ok: false, error: `Invalid entity type: ${entityType}` };
    }
    if (!entityId) return { ok: false, error: 'entityId required' };
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { ok: false, error: 'source file not found' };
    }

    const ext = path.extname(sourcePath).toLowerCase();
    if (!VALID_EXTENSIONS.includes(ext)) {
      return { ok: false, error: `Invalid image format. Allowed: ${VALID_EXTENSIONS.join(', ')}` };
    }

    const stat = fs.statSync(sourcePath);
    if (stat.size > MAX_FILE_SIZE) {
      return { ok: false, error: 'Image too large. Maximum 5MB.' };
    }

    const destDir = path.join(userDataPath, 'uploads', 'photos', entityType);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const filename = `${entityId}_${Date.now()}${ext}`;
    const destPath = path.join(destDir, filename);

    try {
      fs.copyFileSync(sourcePath, destPath);
    } catch (e) {
      return { ok: false, error: `Could not save photo: ${e.message}` };
    }

    // Delete old photo if exists (look it up by ID)
    let oldPath = null;
    try {
      const tableMap = { students: 'students', staff: 'staff', users: 'users' };
      const table = tableMap[entityType];
      const cur = db.prepare(`SELECT photo_path FROM ${table} WHERE id = ?`).get(entityId);
      if (cur?.photo_path) oldPath = cur.photo_path;
    } catch (e) {}

    // Update the entity's photo_path
    try {
      const tableMap = { students: 'students', staff: 'staff', users: 'users' };
      db.prepare(`UPDATE ${tableMap[entityType]} SET photo_path = ? WHERE id = ?`).run(destPath, entityId);
    } catch (e) {
      try { fs.unlinkSync(destPath); } catch (_) {}
      return { ok: false, error: `Could not update record: ${e.message}` };
    }

    // Clean up old photo
    if (oldPath && oldPath !== destPath && fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath); } catch (e) {}
    }

    return { ok: true, path: destPath };
  });

  ipcMain.handle('photos:remove', (_e, { entityType, entityId }) => {
    if (!VALID_ENTITY_TYPES.includes(entityType)) return { ok: false, error: 'Invalid entity type' };
    const tableMap = { students: 'students', staff: 'staff', users: 'users' };
    const table = tableMap[entityType];
    const cur = db.prepare(`SELECT photo_path FROM ${table} WHERE id = ?`).get(entityId);
    if (cur?.photo_path && fs.existsSync(cur.photo_path)) {
      try { fs.unlinkSync(cur.photo_path); } catch (e) {}
    }
    db.prepare(`UPDATE ${table} SET photo_path = NULL WHERE id = ?`).run(entityId);
    return { ok: true };
  });
};
