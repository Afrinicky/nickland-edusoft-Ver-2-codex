// Nickland Edusoft — Access-control IPC.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The level-based front for the permission tables: roles (designations) and the
// per-person overrides that let, say, a teacher be granted limited Finance
// access at a school with no dedicated accountant — without making them an
// accountant. All mutations require settings-edit (Proprietor/Administrator, or
// anyone they have explicitly granted that), and every change is audited.

const security = require('./_security');
const access = require('./_access');

function requireSettingsEdit(db, action) {
  if (!security.checkPermission(db, 'settings', 'edit')) {
    try {
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
        VALUES ('access_control', NULL, 'permission_denied', ?, ?, 'high')
      `).run(security.getCurrentUserId(), `Denied ${action}`);
    } catch (_) {}
    return { ok: false, error: 'Only an Administrator or Proprietor can change who can do what.' };
  }
  return null;
}

function audit(db, action, justification, entityId = null) {
  try {
    db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
      VALUES ('access_control', ?, ?, ?, ?, 'medium')
    `).run(entityId, action, security.getCurrentUserId(), justification);
  } catch (_) {}
}

// The level a designation grants for one module, read straight from the stored
// booleans (defaulting to 'no' where no row exists).
function roleLevels(db, designationId) {
  const rows = db.prepare(
    'SELECT module, can_view, can_create, can_edit, can_delete FROM designation_permissions WHERE designation_id = ?'
  ).all(designationId);
  const byModule = {};
  for (const r of rows) byModule[r.module] = access.permsToLevel(r);
  const out = {};
  for (const m of access.MODULE_KEYS) out[m] = byModule[m] || 'no';
  return out;
}

function writeRoleLevel(db, designationId, module, level) {
  const p = access.levelToPerms(level);
  db.prepare(`
    INSERT INTO designation_permissions (designation_id, module, can_view, can_create, can_edit, can_delete)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (designation_id, module) DO UPDATE SET
      can_view = excluded.can_view, can_create = excluded.can_create,
      can_edit = excluded.can_edit, can_delete = excluded.can_delete
  `).run(designationId, module, p.can_view, p.can_create, p.can_edit, p.can_delete);
}

module.exports = function registerAccessHandlers(ipcMain, db) {

  // ── Catalogue: the modules and the level ladder ──────────────────────
  ipcMain.handle('access:catalogue', () => ({
    modules: access.MODULES,
    levels: access.LEVELS,
    always_full: access.ALWAYS_FULL,
    can_manage: security.checkPermission(db, 'settings', 'edit'),
  }));

  // ── Roles: every designation with its per-module level ───────────────
  ipcMain.handle('access:role-matrix', () => {
    const roles = db.prepare('SELECT * FROM designations ORDER BY is_system DESC, name').all();
    const userCounts = db.prepare(
      'SELECT designation_id, COUNT(*) AS n FROM users GROUP BY designation_id'
    ).all().reduce((m, r) => { m[r.designation_id] = r.n; return m; }, {});

    return roles.map(r => {
      const alwaysFull = access.ALWAYS_FULL.includes(r.name);
      const levels = alwaysFull
        ? Object.fromEntries(access.MODULE_KEYS.map(m => [m, 'full']))
        : roleLevels(db, r.id);
      return {
        id: r.id, name: r.name, description: r.description,
        is_system: !!r.is_system,
        always_full: alwaysFull,
        user_count: userCounts[r.id] || 0,
        levels,
        granted_count: alwaysFull ? access.MODULE_KEYS.length : access.grantedCount(levels),
        module_count: access.MODULE_KEYS.length,
      };
    });
  });

  ipcMain.handle('access:set-role-level', (_e, { designationId, module, level }) => {
    const denied = requireSettingsEdit(db, `set role ${module}=${level}`); if (denied) return denied;
    if (!access.isValidLevel(level)) return { ok: false, error: 'Unknown access level.' };
    if (!access.MODULE_KEYS.includes(module)) return { ok: false, error: 'Unknown module.' };
    const role = db.prepare('SELECT * FROM designations WHERE id = ?').get(designationId);
    if (!role) return { ok: false, error: 'Role not found.' };
    if (access.ALWAYS_FULL.includes(role.name)) {
      return { ok: false, error: `${role.name} always has full access — that cannot be reduced.` };
    }
    writeRoleLevel(db, designationId, module, level);
    audit(db, 'role_level_set', `${role.name}: ${module} → ${level}`, designationId);
    return { ok: true };
  });

  // "Set all" — put every module on one level at once.
  ipcMain.handle('access:set-role-all', (_e, { designationId, level }) => {
    const denied = requireSettingsEdit(db, `set role all=${level}`); if (denied) return denied;
    if (!access.isValidLevel(level)) return { ok: false, error: 'Unknown access level.' };
    const role = db.prepare('SELECT * FROM designations WHERE id = ?').get(designationId);
    if (!role) return { ok: false, error: 'Role not found.' };
    if (access.ALWAYS_FULL.includes(role.name)) {
      return { ok: false, error: `${role.name} always has full access.` };
    }
    const tx = db.transaction(() => {
      for (const m of access.MODULE_KEYS) writeRoleLevel(db, designationId, m, level);
    });
    tx();
    audit(db, 'role_all_set', `${role.name}: all modules → ${level}`, designationId);
    return { ok: true };
  });

  // ── Custom roles ─────────────────────────────────────────────────────
  ipcMain.handle('access:create-role', (_e, { name, description, copyFromId } = {}) => {
    const denied = requireSettingsEdit(db, 'create role'); if (denied) return denied;
    const clean = String(name || '').trim();
    if (clean.length < 2) return { ok: false, error: 'Give the role a name.' };
    if (db.prepare('SELECT id FROM designations WHERE name = ? COLLATE NOCASE').get(clean)) {
      return { ok: false, error: `A role called "${clean}" already exists.` };
    }
    const tx = db.transaction(() => {
      const r = db.prepare('INSERT INTO designations (name, description, is_system) VALUES (?, ?, 0)')
        .run(clean, description || null);
      const id = r.lastInsertRowid;
      // A new role starts from a copy of an existing one when asked (so "like a
      // Class Teacher but…" is two clicks), otherwise from no access everywhere.
      const seed = copyFromId ? roleLevels(db, copyFromId) : null;
      for (const m of access.MODULE_KEYS) writeRoleLevel(db, id, m, seed ? seed[m] : 'no');
      return id;
    });
    const id = tx();
    audit(db, 'role_created', `Created role "${clean}"`, id);
    return { ok: true, id };
  });

  ipcMain.handle('access:update-role', (_e, { designationId, name, description } = {}) => {
    const denied = requireSettingsEdit(db, 'rename role'); if (denied) return denied;
    const role = db.prepare('SELECT * FROM designations WHERE id = ?').get(designationId);
    if (!role) return { ok: false, error: 'Role not found.' };
    // System roles keep their name (other code matches on it — e.g. ALWAYS_FULL,
    // isElevated) but their description can be reworded.
    if (role.is_system) {
      db.prepare('UPDATE designations SET description = ? WHERE id = ?').run(description || null, designationId);
      return { ok: true, renamed: false };
    }
    const clean = String(name || '').trim();
    if (clean.length < 2) return { ok: false, error: 'Give the role a name.' };
    const clash = db.prepare('SELECT id FROM designations WHERE name = ? COLLATE NOCASE AND id != ?').get(clean, designationId);
    if (clash) return { ok: false, error: `A role called "${clean}" already exists.` };
    db.prepare('UPDATE designations SET name = ?, description = ? WHERE id = ?')
      .run(clean, description || null, designationId);
    audit(db, 'role_updated', `Renamed role #${designationId} to "${clean}"`, designationId);
    return { ok: true, renamed: true };
  });

  ipcMain.handle('access:delete-role', (_e, { designationId } = {}) => {
    const denied = requireSettingsEdit(db, 'delete role'); if (denied) return denied;
    const role = db.prepare('SELECT * FROM designations WHERE id = ?').get(designationId);
    if (!role) return { ok: false, error: 'Role not found.' };
    if (role.is_system) return { ok: false, error: 'Built-in roles cannot be deleted.' };
    const users = db.prepare('SELECT COUNT(*) AS n FROM users WHERE designation_id = ?').get(designationId).n;
    const tx = db.transaction(() => {
      // Users on a deleted role are left with no role (no access) rather than
      // silently inheriting someone else's — safer to under-grant.
      db.prepare('UPDATE users SET designation_id = NULL WHERE designation_id = ?').run(designationId);
      db.prepare('DELETE FROM designation_permissions WHERE designation_id = ?').run(designationId);
      db.prepare('DELETE FROM designations WHERE id = ?').run(designationId);
    });
    tx();
    audit(db, 'role_deleted', `Deleted role "${role.name}"${users ? ` (${users} user(s) left with no role)` : ''}`, designationId);
    return { ok: true, users_unassigned: users };
  });

  // ── Individuals: one person's access, role default vs override ────────
  ipcMain.handle('access:user-access', (_e, userId) => {
    const user = db.prepare(`
      SELECT u.id, u.full_name, u.username, u.designation_id, d.name AS designation_name
      FROM users u LEFT JOIN designations d ON d.id = u.designation_id
      WHERE u.id = ?
    `).get(userId);
    if (!user) return { ok: false, error: 'User not found.' };

    const alwaysFull = access.ALWAYS_FULL.includes(user.designation_name);
    const roleMap = user.designation_id ? roleLevels(db, user.designation_id) : null;
    const overrides = db.prepare(
      'SELECT module, can_view, can_create, can_edit, can_delete FROM user_permission_overrides WHERE user_id = ?'
    ).all(userId).reduce((m, r) => { m[r.module] = access.permsToLevel(r); return m; }, {});

    const rows = access.MODULE_KEYS.map(m => {
      const roleLevel = alwaysFull ? 'full' : (roleMap ? roleMap[m] : 'no');
      const overrideLevel = Object.prototype.hasOwnProperty.call(overrides, m) ? overrides[m] : null;
      return {
        module: m,
        role_level: roleLevel,
        override_level: overrideLevel,
        effective_level: overrideLevel != null ? overrideLevel : roleLevel,
      };
    });

    return {
      ok: true,
      user: { id: user.id, full_name: user.full_name, username: user.username,
              designation_name: user.designation_name || null },
      always_full: alwaysFull,
      rows,
    };
  });

  // Set (or clear) one module's override for a person. level === null | 'inherit'
  // removes the override so they fall back to their role.
  ipcMain.handle('access:set-user-level', (_e, { userId, module, level } = {}) => {
    const denied = requireSettingsEdit(db, `set user ${module}=${level}`); if (denied) return denied;
    if (!access.MODULE_KEYS.includes(module)) return { ok: false, error: 'Unknown module.' };
    const user = db.prepare(`
      SELECT u.id, d.name AS designation_name FROM users u
      LEFT JOIN designations d ON d.id = u.designation_id WHERE u.id = ?
    `).get(userId);
    if (!user) return { ok: false, error: 'User not found.' };
    if (access.ALWAYS_FULL.includes(user.designation_name)) {
      return { ok: false, error: `${user.designation_name} accounts always have full access; overrides do not apply.` };
    }

    if (level == null || level === 'inherit') {
      db.prepare('DELETE FROM user_permission_overrides WHERE user_id = ? AND module = ?').run(userId, module);
      audit(db, 'user_override_cleared', `#${userId}: ${module} → role default`, userId);
      return { ok: true, cleared: true };
    }
    if (!access.isValidLevel(level)) return { ok: false, error: 'Unknown access level.' };
    const p = access.levelToPerms(level);
    db.prepare(`
      INSERT INTO user_permission_overrides (user_id, module, can_view, can_create, can_edit, can_delete, granted_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, module) DO UPDATE SET
        can_view = excluded.can_view, can_create = excluded.can_create,
        can_edit = excluded.can_edit, can_delete = excluded.can_delete, granted_by = excluded.granted_by
    `).run(userId, module, p.can_view, p.can_create, p.can_edit, p.can_delete, security.getCurrentUserId());
    audit(db, 'user_override_set', `#${userId}: ${module} → ${level} (role default overridden)`, userId);
    return { ok: true };
  });

  // Drop every override so a person is back to exactly their role.
  ipcMain.handle('access:reset-user', (_e, { userId } = {}) => {
    const denied = requireSettingsEdit(db, 'reset user overrides'); if (denied) return denied;
    const r = db.prepare('DELETE FROM user_permission_overrides WHERE user_id = ?').run(userId);
    audit(db, 'user_overrides_reset', `#${userId}: cleared ${r.changes} override(s)`, userId);
    return { ok: true, cleared: r.changes };
  });
};

// Exposed for the plain-Node test harness.
module.exports.__roleLevels = roleLevels;
