// Nickland Edusoft — Auth IPC Handler
// Copyright © 2026 Nickland Sales. All rights reserved.
// Handles: bootstrap, login, logout, user management, permissions

const bcrypt = require('bcryptjs');
const security = require('./_security');

module.exports = function registerAuthHandlers(ipcMain, db) {

  // ── Bootstrap check ───────────────────────────────────
  ipcMain.handle('auth:bootstrap-status', () => {
    const val = db.prepare("SELECT value FROM settings WHERE key = 'bootstrap_done'").get();
    return { done: val && val.value === 'true' };
  });

  // ── Create first admin account (bootstrap) ────────────
  ipcMain.handle('auth:bootstrap', (_e, { fullName, username, password }) => {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return { ok: false, error: 'Username already exists.' };

    const hash = bcrypt.hashSync(password, 10);
    const adminDesig = db.prepare("SELECT id FROM designations WHERE name = 'Administrator'").get();
    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, designation_id, is_active, must_change_password)
      VALUES (?, ?, ?, ?, 1, 0)
    `).run(username, hash, fullName, adminDesig ? adminDesig.id : null);

    db.prepare("UPDATE settings SET value = 'true' WHERE key = 'bootstrap_done'").run();
    return { ok: true };
  });

  // ── Login ─────────────────────────────────────────────
  ipcMain.handle('auth:login', (_e, { username, password }) => {
    const user = db.prepare(`
      SELECT u.*, d.name AS designation_name
      FROM users u
      LEFT JOIN designations d ON d.id = u.designation_id
      WHERE u.username = ? AND u.is_active = 1
    `).get(username);

    if (!user) return { ok: false, error: 'Invalid username or password.' };
    if (!user.password_hash) return { ok: false, error: 'Account not set up. Contact administrator.' };

    const match = bcrypt.compareSync(password, user.password_hash);
    if (!match) return { ok: false, error: 'Invalid username or password.' };

    // Build effective permissions: designation defaults + overrides
    const desigPerms = user.designation_id
      ? db.prepare('SELECT * FROM designation_permissions WHERE designation_id = ?').all(user.designation_id)
      : [];
    const overrides = db.prepare('SELECT * FROM user_permission_overrides WHERE user_id = ?').all(user.id);
    const permMap = {};
    for (const p of desigPerms) {
      permMap[p.module] = { view: !!p.can_view, create: !!p.can_create, edit: !!p.can_edit, delete: !!p.can_delete };
    }
    for (const o of overrides) {
      permMap[o.module] = {
        view:   !!o.can_view,
        create: !!o.can_create,
        edit:   !!o.can_edit,
        delete: !!o.can_delete,
      };
    }

    // Record login
    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
    db.prepare("INSERT INTO login_sessions (user_id) VALUES (?)").run(user.id);

    // Track for backend permission checks
    security.setCurrentUser(user.id, user.designation_name || null);

    return {
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        designation: user.designation_name || 'Administrator',
        mustChangePassword: !!user.must_change_password,
        permissions: permMap,
      }
    };
  });

  // ── Logout ────────────────────────────────────────────
  ipcMain.handle('auth:logout', (_e, userId) => {
    if (userId) {
      db.prepare(`
        UPDATE login_sessions SET logged_out_at = datetime('now')
        WHERE user_id = ? AND logged_out_at IS NULL
      `).run(userId);
    }
    security.clearCurrentUser();
    return { ok: true };
  });

  // ── List users ────────────────────────────────────────
  ipcMain.handle('auth:list-users', () => {
    return db.prepare(`
      SELECT u.id, u.username, u.full_name, u.is_active, u.last_login, u.created_at,
             u.designation_id, u.staff_id, u.photo_path,
             d.name AS designation_name,
             s.surname || ' ' || s.first_name AS staff_full_name
      FROM users u
      LEFT JOIN designations d ON d.id = u.designation_id
      LEFT JOIN staff s ON s.id = u.staff_id
      ORDER BY u.full_name
    `).all();
  });

  // ── Create user ───────────────────────────────────────
  ipcMain.handle('auth:create-user', (_e, { username, fullName, password, designationId, staffId }) => {
    if (!security.checkPermission(db, 'settings', 'create')) {
      return { ok: false, error: 'Access denied. Only Administrators/Proprietors can manage users.' };
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return { ok: false, error: 'Username already taken.' };
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, designation_id, staff_id, is_active, must_change_password)
      VALUES (?, ?, ?, ?, ?, 1, 1)
    `).run(username, hash, fullName, designationId || null, staffId || null);
    return { ok: true };
  });

  // ── Update user ───────────────────────────────────────
  ipcMain.handle('auth:update-user', (_e, { id, fullName, designationId, isActive, newPassword }) => {
    if (!security.checkPermission(db, 'settings', 'edit')) {
      return { ok: false, error: 'Access denied. Only Administrators/Proprietors can manage users.' };
    }

    if (newPassword) {
      const hash = bcrypt.hashSync(newPassword, 10);
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, id);
    }
    db.prepare('UPDATE users SET full_name = ?, designation_id = ?, is_active = ? WHERE id = ?')
      .run(fullName, designationId, isActive ? 1 : 0, id);
    return { ok: true };
  });

  // ── Admin/Proprietor reset of another user's password ──
  // Sets a new password and forces the user to change it at next login.
  ipcMain.handle('auth:reset-password', (_e, { actorUserId, targetUserId, newPassword }) => {
    // Only Admin or Proprietor designations may reset others' passwords
    const actor = db.prepare(`
      SELECT u.id, d.name AS designation
      FROM users u LEFT JOIN designations d ON d.id = u.designation_id
      WHERE u.id = ?
    `).get(actorUserId);
    const allowed = actor && ['Administrator', 'Proprietor'].includes(actor.designation);
    if (!allowed) {
      return { ok: false, error: 'Only an Administrator or Proprietor can reset passwords.' };
    }
    if (!newPassword || newPassword.length < 6) {
      return { ok: false, error: 'New password must be at least 6 characters.' };
    }
    const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetUserId);
    if (!target) return { ok: false, error: 'User not found.' };

    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
      .run(hash, targetUserId);

    // Audit
    try {
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
        VALUES ('user', ?, 'password_reset', ?, ?, 'high')
      `).run(targetUserId, actorUserId, `Password reset for ${target.username} by user #${actorUserId}`);
    } catch (e) {}

    return { ok: true, username: target.username };
  });

  // ── Set permission override ───────────────────────────
  ipcMain.handle('auth:set-permission-override', (_e, { userId, module, canView, canCreate, canEdit, canDelete }) => {
    if (!security.checkPermission(db, 'settings', 'edit')) {
      return { ok: false, error: 'Access denied. Only Administrators/Proprietors can manage users.' };
    }

    db.prepare(`
      INSERT INTO user_permission_overrides (user_id, module, can_view, can_create, can_edit, can_delete)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, module) DO UPDATE SET
        can_view = excluded.can_view, can_create = excluded.can_create,
        can_edit = excluded.can_edit, can_delete = excluded.can_delete
    `).run(userId, module, canView ? 1 : 0, canCreate ? 1 : 0, canEdit ? 1 : 0, canDelete ? 1 : 0);
    return { ok: true };
  });

  // ── Get designations ──────────────────────────────────
  ipcMain.handle('auth:list-designations', () => {
    return db.prepare('SELECT * FROM designations ORDER BY is_system DESC, name').all();
  });

  ipcMain.handle('auth:get-designation-permissions', (_e, designationId) => {
    return db.prepare('SELECT * FROM designation_permissions WHERE designation_id = ?').all(designationId);
  });

  ipcMain.handle('auth:update-designation-permission', (_e, { designationId, module, canView, canCreate, canEdit, canDelete }) => {
    if (!security.checkPermission(db, 'settings', 'edit')) {
      return { ok: false, error: 'Access denied. Only Administrators/Proprietors can manage users.' };
    }

    db.prepare(`
      INSERT INTO designation_permissions (designation_id, module, can_view, can_create, can_edit, can_delete)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (designation_id, module) DO UPDATE SET
        can_view = excluded.can_view, can_create = excluded.can_create,
        can_edit = excluded.can_edit, can_delete = excluded.can_delete
    `).run(designationId, module, canView ? 1 : 0, canCreate ? 1 : 0, canEdit ? 1 : 0, canDelete ? 1 : 0);
    return { ok: true };
  });

  // ── Change password ───────────────────────────────────
  ipcMain.handle('auth:change-password', (_e, { userId, oldPassword, newPassword }) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return { ok: false, error: 'User not found.' };
    if (user.password_hash && !bcrypt.compareSync(oldPassword, user.password_hash)) {
      return { ok: false, error: 'Current password is incorrect.' };
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, userId);
    return { ok: true };
  });

  // ═══════════════════════════════════════════════════════
  // EFFECTIVE PERMISSIONS — designation defaults + per-user overrides
  // ═══════════════════════════════════════════════════════
  // Returns: { module: { canView, canCreate, canEdit, canDelete } }
  ipcMain.handle('auth:effective-permissions', (_e, userId) => {
    return resolveEffectivePermissions(db, userId);
  });

  // Get one user's permission overrides
  ipcMain.handle('auth:user-overrides', (_e, userId) => {
    return db.prepare(`
      SELECT module, can_view, can_create, can_edit, can_delete
      FROM user_permission_overrides WHERE user_id = ?
    `).all(userId);
  });

  // ── Teacher class / subject assignments (per-user) ─────
  // List a user's assignments (joined to staff via users.staff_id)
  ipcMain.handle('auth:list-user-assignments', (_e, userId) => {
    const u = db.prepare('SELECT staff_id FROM users WHERE id = ?').get(userId);
    if (!u?.staff_id) return [];
    return db.prepare(`
      SELECT sa.id, sa.class_group_id, sa.subject_id, sa.term_id, sa.is_class_teacher,
             cg.name AS class_name, s.name AS subject_name, t.label AS term_label
      FROM staff_assignments sa
      LEFT JOIN class_groups cg ON cg.id = sa.class_group_id
      LEFT JOIN subjects s ON s.id = sa.subject_id
      LEFT JOIN terms t ON t.id = sa.term_id
      WHERE sa.staff_id = ?
      ORDER BY cg.level_order, cg.name, s.name
    `).all(u.staff_id);
  });

  ipcMain.handle('auth:add-user-assignment', (_e, { userId, classGroupId, subjectId, termId, isClassTeacher }) => {
    if (!security.checkPermission(db, 'settings', 'edit')) {
      return { ok: false, error: 'Access denied. Only Administrators/Proprietors can manage users.' };
    }

    const u = db.prepare('SELECT staff_id FROM users WHERE id = ?').get(userId);
    if (!u?.staff_id) return { ok: false, error: 'User must be linked to a staff record before assignments can be added.' };
    const r = db.prepare(`
      INSERT INTO staff_assignments (staff_id, class_group_id, subject_id, term_id, is_class_teacher)
      VALUES (?, ?, ?, ?, ?)
    `).run(u.staff_id, classGroupId || null, subjectId || null, termId || null, isClassTeacher ? 1 : 0);
    return { ok: true, id: r.lastInsertRowid };
  });

  ipcMain.handle('auth:remove-user-assignment', (_e, assignmentId) => {
    if (!security.checkPermission(db, 'settings', 'delete')) {
      return { ok: false, error: 'Access denied. Only Administrators/Proprietors can manage users.' };
    }

    db.prepare('DELETE FROM staff_assignments WHERE id = ?').run(assignmentId);
    return { ok: true };
  });
};

// ─── Permission resolution ──────────────────────────────
// Combines designation defaults with per-user overrides.
// Override row supersedes designation default for that module.
function resolveEffectivePermissions(db, userId) {
  const modules = ['dashboard','students','academics','fees','canteen','staff','payroll','finance','notifications','settings'];
  const result = {};
  for (const m of modules) {
    result[m] = { canView: false, canCreate: false, canEdit: false, canDelete: false };
  }
  if (!userId) return result;

  const user = db.prepare(`
    SELECT u.id, u.designation_id, d.name AS designation_name
    FROM users u LEFT JOIN designations d ON d.id = u.designation_id
    WHERE u.id = ?
  `).get(userId);
  if (!user) return result;

  // 1. Apply designation defaults
  const desigPerms = db.prepare(`
    SELECT module, can_view, can_create, can_edit, can_delete
    FROM designation_permissions WHERE designation_id = ?
  `).all(user.designation_id);
  for (const p of desigPerms) {
    if (result[p.module]) {
      result[p.module] = {
        canView: !!p.can_view,
        canCreate: !!p.can_create,
        canEdit: !!p.can_edit,
        canDelete: !!p.can_delete,
      };
    }
  }

  // 2. Apply per-user overrides
  const overrides = db.prepare(`
    SELECT module, can_view, can_create, can_edit, can_delete
    FROM user_permission_overrides WHERE user_id = ?
  `).all(userId);
  for (const o of overrides) {
    if (result[o.module]) {
      result[o.module] = {
        canView: !!o.can_view,
        canCreate: !!o.can_create,
        canEdit: !!o.can_edit,
        canDelete: !!o.can_delete,
      };
    }
  }

  // 3. Proprietor + Administrator always get full access (safety net)
  if (['Proprietor', 'Administrator'].includes(user.designation_name)) {
    for (const m of modules) {
      result[m] = { canView: true, canCreate: true, canEdit: true, canDelete: true };
    }
  }

  return result;
}

// Export the resolver for use in security middleware
module.exports.resolveEffectivePermissions = resolveEffectivePermissions;
