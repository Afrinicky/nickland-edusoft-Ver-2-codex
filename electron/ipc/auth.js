// Nickland Edusoft — Auth IPC Handler
// Copyright © 2026 Nickland Sales. All rights reserved.
// Handles: bootstrap, login, logout, user management, permissions

// bcryptjs is loaded lazily (and memoised) so modules that require auth.js only
// for its non-hashing exports — e.g. _security → resolveEffectivePermissions —
// load in the plain-Node test harness, which has no node_modules.
let _bcrypt = null;
function bcrypt() { return _bcrypt || (_bcrypt = require('bcryptjs')); }
const passwords = require('../server/passwords');
const security = require('./_security');
const { setSetting } = require('../utils/idgen');

// ── Failed-login throttling ─────────────────────────────
// Per-username, in memory: five wrong passwords buys a 60-second lockout that
// keeps extending while the guessing continues. Cleared on a successful login
// and on app restart, which is the right trade-off for a single-machine app.
const MAX_LOGIN_FAILURES = 5;
const LOCKOUT_MS = 60 * 1000;
const loginFailures = new Map();

function loginLock(username) {
  const rec = loginFailures.get(username);
  if (!rec || rec.count < MAX_LOGIN_FAILURES) return { locked: false };
  const remaining = rec.until - Date.now();
  if (remaining <= 0) { loginFailures.delete(username); return { locked: false }; }
  return { locked: true, seconds: Math.ceil(remaining / 1000) };
}

function recordLoginFailure(db, username, reason) {
  const rec = loginFailures.get(username) || { count: 0, until: 0 };
  rec.count++;
  rec.until = Date.now() + LOCKOUT_MS;
  loginFailures.set(username, rec);
  // Keep the map from growing without bound on a long-running install.
  if (loginFailures.size > 500) {
    const now = Date.now();
    for (const [k, v] of loginFailures) if (v.until < now) loginFailures.delete(k);
  }
  try {
    db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
      VALUES ('security', NULL, 'login_failed', NULL, ?, ?)
    `).run(`Failed sign-in for "${username}" (${reason})`, rec.count >= MAX_LOGIN_FAILURES ? 'high' : 'normal');
  } catch (_) { /* audit is best-effort */ }
}

function clearLoginFailures(username) { loginFailures.delete(username); }

module.exports = function registerAuthHandlers(ipcMain, db) {

  // ── Bootstrap check ───────────────────────────────────
  ipcMain.handle('auth:bootstrap-status', () => {
    const val = db.prepare("SELECT value FROM settings WHERE key = 'bootstrap_done'").get();
    return { done: val && val.value === 'true' };
  });

  // ── Create first admin account (bootstrap) ────────────
  // Runs exactly once, on a brand-new database. It creates an Administrator
  // without asking for any credentials, so it must refuse to run again once
  // setup is complete — otherwise anyone able to reach this channel could mint
  // themselves a full-access account on a live school database.
  ipcMain.handle('auth:bootstrap', (_e, { fullName, username, password }) => {
    const done = db.prepare("SELECT value FROM settings WHERE key = 'bootstrap_done'").get();
    const anyUser = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    if ((done && done.value === 'true') || anyUser > 0) {
      return { ok: false, error: 'Setup has already been completed. Sign in, then use Settings → Users & Access to add accounts.' };
    }
    if (!username || !String(username).trim()) return { ok: false, error: 'Username is required.' };
    if (!password || String(password).length < 6) {
      return { ok: false, error: 'Password must be at least 6 characters.' };
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return { ok: false, error: 'Username already exists.' };

    const hash = bcrypt().hashSync(password, 10);
    const adminDesig = db.prepare("SELECT id FROM designations WHERE name = 'Administrator'").get();
    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, designation_id, is_active, must_change_password)
      VALUES (?, ?, ?, ?, 1, 0)
    `).run(username, hash, fullName, adminDesig ? adminDesig.id : null);

    setSetting(db, 'bootstrap_done', true, 'system');
    return { ok: true };
  });

  // ── Login ─────────────────────────────────────────────
  ipcMain.handle('auth:login', (_e, { username, password }) => {
    // Office machines are shared. Without a throttle, anyone left alone with a
    // logged-out app could guess another member of staff's password at full
    // speed, which is how a teacher account becomes a Proprietor account.
    const uname = String(username || '');
    const lock = loginLock(uname);
    if (lock.locked) {
      return { ok: false, error: `Too many failed attempts. Try again in ${lock.seconds}s.` };
    }

    const user = db.prepare(`
      SELECT u.*, d.name AS designation_name
      FROM users u
      LEFT JOIN designations d ON d.id = u.designation_id
      WHERE u.username = ? AND u.is_active = 1
    `).get(username);

    if (!user) { recordLoginFailure(db, uname, 'unknown_user'); return { ok: false, error: 'Invalid username or password.' }; }
    if (!user.password_hash) return { ok: false, error: 'Account not set up. Contact administrator.' };

    const match = bcrypt().compareSync(String(password || ''), user.password_hash);
    if (!match) { recordLoginFailure(db, uname, 'bad_password'); return { ok: false, error: 'Invalid username or password.' }; }
    clearLoginFailures(uname);

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

    if (!username || !String(username).trim()) return { ok: false, error: 'Username is required.' };
    if (!password || String(password).length < 6) {
      return { ok: false, error: 'Password must be at least 6 characters.' };
    }
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return { ok: false, error: 'Username already taken.' };
    const hash = bcrypt().hashSync(password, 10);
    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, designation_id, staff_id, is_active, must_change_password)
      VALUES (?, ?, ?, ?, ?, 1, 1)
    `).run(username, hash, fullName, designationId || null, staffId || null);
    const created = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (created) projectStaff(db, created.id);
    return { ok: true };
  });

  // ── Update user ───────────────────────────────────────
  ipcMain.handle('auth:update-user', (_e, { id, fullName, designationId, isActive, newPassword }) => {
    if (!security.checkPermission(db, 'settings', 'edit')) {
      return { ok: false, error: 'Access denied. Only Administrators/Proprietors can manage users.' };
    }

    if (newPassword) {
      if (String(newPassword).length < 6) {
        return { ok: false, error: 'Password must be at least 6 characters.' };
      }
      const hash = bcrypt().hashSync(newPassword, 10);
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, id);
    }
    db.prepare('UPDATE users SET full_name = ?, designation_id = ?, is_active = ? WHERE id = ?')
      .run(fullName, designationId, isActive ? 1 : 0, id);
    projectStaff(db, id);
    return { ok: true };
  });

  // ── Admin/Proprietor reset of another user's password ──
  // Sets a new password and forces the user to change it at next login.
  ipcMain.handle('auth:reset-password', (_e, { targetUserId, newPassword }) => {
    // The actor is taken from the signed-in session, never from the caller.
    // Reading it from the payload let any signed-in user claim to be the
    // Administrator and reset the Administrator's own password.
    const actorUserId = security.getCurrentUserId();
    if (!actorUserId) return { ok: false, error: 'Please sign in again.' };

    // Only Admin or Proprietor designations may reset others' passwords
    const actor = db.prepare(`
      SELECT u.id, d.name AS designation
      FROM users u LEFT JOIN designations d ON d.id = u.designation_id
      WHERE u.id = ? AND u.is_active = 1
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

    const hash = bcrypt().hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
      .run(hash, targetUserId);

    // Audit
    try {
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
        VALUES ('user', ?, 'password_reset', ?, ?, 'high')
      `).run(targetUserId, actorUserId, `Password reset for ${target.username} by user #${actorUserId}`);
    } catch (e) {}

    projectStaff(db, targetUserId);
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
    projectStaff(db, userId);
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
    // A designation change moves every account that holds it, so all of them
    // have to be re-projected — otherwise a teacher whose access was just
    // widened or withdrawn keeps the old rights until something else touches
    // their account.
    try {
      for (const u of db.prepare('SELECT id FROM users WHERE designation_id = ?').all(designationId)) {
        projectStaff(db, u.id);
      }
    } catch (_) {}
    return { ok: true };
  });

  // ── Change password ───────────────────────────────────
  // Change your OWN password. The account is taken from the session rather than
  // the payload: accepting a caller-supplied userId meant a signed-in user
  // could target somebody else's account, and any account whose password_hash
  // was still NULL could be taken over outright because the old-password check
  // was skipped for it. Administrators reset other people via auth:reset-password.
  ipcMain.handle('auth:change-password', (_e, { oldPassword, newPassword }) =>
    passwords.changeOwnPassword(db, security.getCurrentUserId(), { oldPassword, newPassword, source: 'desktop' }));

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

  // ══════════════════════════════════════════════════════
  // PASSWORD RESET REQUESTS
  // ══════════════════════════════════════════════════════
  // The rules live in electron/server/passwords.js, shared with the LAN API a
  // phone reaches on the school Wi-Fi and — through the projected claim — with
  // the cloud. A reset rule that holds here and not over Wi-Fi is not a rule.

  function isDecider(userId) {
    if (!userId) return false;
    const actor = db.prepare(`
      SELECT d.name AS designation FROM users u
      LEFT JOIN designations d ON d.id = u.designation_id
      WHERE u.id = ? AND u.is_active = 1
    `).get(userId);
    return !!(actor && ['Administrator', 'Proprietor'].includes(actor.designation));
  }

  ipcMain.handle('auth:request-password-reset', (_e, { username, reason, from } = {}) =>
    passwords.requestReset(db, { username, reason, source: from || 'desktop' }));

  ipcMain.handle('auth:pending-password-resets', () => {
    // The count drives a badge only an approver ever sees.
    if (!isDecider(security.getCurrentUserId())) return { ok: true, count: 0 };
    return { ok: true, count: passwords.pendingCount(db) };
  });

  ipcMain.handle('auth:list-password-resets', (_e, { status } = {}) => {
    if (!isDecider(security.getCurrentUserId())) {
      return { ok: false, error: 'Only an Administrator or Proprietor can review password requests.', requests: [] };
    }
    return { ok: true, requests: passwords.listRequests(db, status) };
  });

  ipcMain.handle('auth:decide-password-reset', (_e, { requestId, approve, note } = {}) =>
    passwords.decideReset(db, { requestId, approve, note, actorUserId: security.getCurrentUserId() }));

  ipcMain.handle('auth:password-reset-status', (_e, { username } = {}) =>
    passwords.resetStatus(db, { username }));

  ipcMain.handle('auth:complete-password-reset', (_e, { username, code, newPassword } = {}) => {
    const r = passwords.completeReset(db, { username, code, newPassword });
    if (r.ok) clearLoginFailures(String(username || '').trim());
    return r.ok ? { ok: true } : r;
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

  // Who may decide what a teacher teaches. Deliberately its own check rather
  // than `settings.edit`: a Head Teacher runs the timetable and the staffing,
  // but has settings.view only, so the permission that fits the job is the
  // designation, not a settings flag.
  const ASSIGNERS = ['Administrator', 'Proprietor', 'Head Teacher'];
  function mayAssign() {
    const actorId = security.getCurrentUserId();
    if (!actorId) return false;
    const row = db.prepare(`
      SELECT d.name AS designation FROM users u
      LEFT JOIN designations d ON d.id = u.designation_id
      WHERE u.id = ? AND u.is_active = 1
    `).get(actorId);
    return !!(row && ASSIGNERS.includes(row.designation));
  }

  // Three shapes, and all three are real:
  //
  //   class, no subject   the whole class — every subject taught in it
  //   class + subject     that subject in that class only
  //   subject, no class   that subject wherever it is taught, for a
  //                       specialist who takes French across the school
  //
  // Only the first two could be expressed before: a class was required, so a
  // subject specialist had to be given a row per class and any class added
  // later silently left them out.
  ipcMain.handle('auth:add-user-assignment', (_e, { userId, classGroupId, subjectId, termId, isClassTeacher }) => {
    if (!mayAssign()) {
      return { ok: false, error: 'Only an Administrator, Proprietor or Head Teacher can set teaching assignments.' };
    }

    const cid = classGroupId ? parseInt(classGroupId, 10) : null;
    const sid = subjectId ? parseInt(subjectId, 10) : null;
    if (!cid && !sid) return { ok: false, error: 'Choose a class, a subject, or both.' };
    if (!cid && isClassTeacher) {
      return { ok: false, error: 'A class teacher has to be the teacher of a particular class.' };
    }

    const u = db.prepare('SELECT staff_id FROM users WHERE id = ?').get(userId);
    if (!u?.staff_id) return { ok: false, error: 'User must be linked to a staff record before assignments can be added.' };

    // One class, one class teacher. The register, the canteen sheet and the
    // end-of-term summary all hang off this, and "who is answerable for Basic
    // 5" cannot have two answers.
    if (cid && isClassTeacher) {
      const held = db.prepare(`
        SELECT s.surname, s.first_name FROM staff_assignments sa
        JOIN staff s ON s.id = sa.staff_id
        WHERE sa.class_group_id = ? AND sa.is_class_teacher = 1 AND sa.staff_id != ?
        LIMIT 1
      `).get(cid, u.staff_id);
      if (held) {
        return {
          ok: false,
          error: `${held.surname} ${held.first_name} is already the class teacher for that class. `
               + 'Remove that assignment first.',
        };
      }
    }

    // Adding the same thing twice is a no-op rather than a second row.
    const dup = db.prepare(`
      SELECT id FROM staff_assignments
      WHERE staff_id = ? AND IFNULL(class_group_id, -1) = IFNULL(?, -1)
        AND IFNULL(subject_id, -1) = IFNULL(?, -1)
    `).get(u.staff_id, cid, sid);
    if (dup) {
      if (isClassTeacher) {
        db.prepare('UPDATE staff_assignments SET is_class_teacher = 1 WHERE id = ?').run(dup.id);
      }
      projectStaff(db, userId);
      return { ok: true, id: dup.id, existing: true };
    }

    const r = db.prepare(`
      INSERT INTO staff_assignments (staff_id, class_group_id, subject_id, term_id, is_class_teacher)
      VALUES (?, ?, ?, ?, ?)
    `).run(u.staff_id, cid, sid, termId || null, isClassTeacher ? 1 : 0);
    // What a teacher may reach changes with this, so the cloud has to be told
    // — otherwise they keep last night's classes on the phone.
    projectStaff(db, userId);
    return { ok: true, id: r.lastInsertRowid };
  });

  // Every class, and who is answerable for it. Drives the Settings screen that
  // shows a school which classes still have nobody.
  ipcMain.handle('auth:class-teachers', () => {
    return db.prepare(`
      SELECT c.id AS class_id, c.name AS class_name, c.level_order,
             s.id AS staff_id, s.surname, s.first_name, u.id AS user_id
      FROM class_groups c
      LEFT JOIN staff_assignments sa ON sa.class_group_id = c.id AND sa.is_class_teacher = 1
      LEFT JOIN staff s ON s.id = sa.staff_id
      LEFT JOIN users u ON u.staff_id = s.id
      ORDER BY c.level_order, c.name
    `).all();
  });

  ipcMain.handle('auth:remove-user-assignment', (_e, assignmentId) => {
    if (!mayAssign()) {
      return { ok: false, error: 'Only an Administrator, Proprietor or Head Teacher can set teaching assignments.' };
    }
    const row = db.prepare(`
      SELECT u.id AS user_id FROM staff_assignments sa
      LEFT JOIN users u ON u.staff_id = sa.staff_id WHERE sa.id = ?
    `).get(assignmentId);
    db.prepare('DELETE FROM staff_assignments WHERE id = ?').run(assignmentId);
    if (row && row.user_id) projectStaff(db, row.user_id);
    return { ok: true };
  });
};

// ─── Permission resolution ──────────────────────────────
// Combines designation defaults with per-user overrides.
// Override row supersedes designation default for that module.
// Any change to who may sign in, or to what they may do, has to reach the cloud
// or a teacher working off-LAN keeps the access they had last night. Cheap and
// safe to call on every user mutation: the outbox collapses repeats onto one
// queued row per account.
function projectStaff(db, userId) {
  try {
    const sp = require('../server/sync/staff_projection');
    sp.enqueueStaffAuth(db, userId);
    sp.enqueueStaffTimetable(db, userId);
  } catch (_) {}
}

function resolveEffectivePermissions(db, userId) {
  // Single source of truth for the module list (electron/ipc/_access.js), so the
  // resolver, the access-control UI and the seeds can never drift apart.
  const modules = require('./_access').MODULE_KEYS;
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
