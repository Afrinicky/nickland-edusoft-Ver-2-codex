// Nickland Edusoft — Auth IPC Handler
// Copyright © 2026 Nickland Sales. All rights reserved.
// Handles: bootstrap, login, logout, user management, permissions

// bcryptjs is loaded lazily (and memoised) so modules that require auth.js only
// for its non-hashing exports — e.g. _security → resolveEffectivePermissions —
// load in the plain-Node test harness, which has no node_modules.
let _bcrypt = null;
function bcrypt() { return _bcrypt || (_bcrypt = require('bcryptjs')); }
const crypto = require('crypto');
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
  ipcMain.handle('auth:change-password', (_e, { oldPassword, newPassword }) => {
    const userId = security.getCurrentUserId();
    if (!userId) return { ok: false, error: 'Please sign in again.' };
    if (!newPassword || String(newPassword).length < 6) {
      return { ok: false, error: 'New password must be at least 6 characters.' };
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return { ok: false, error: 'User not found.' };
    if (!user.password_hash) {
      return { ok: false, error: 'This account has no password set. Ask an Administrator to reset it.' };
    }
    if (!bcrypt().compareSync(String(oldPassword || ''), user.password_hash)) {
      return { ok: false, error: 'Current password is incorrect.' };
    }
    const hash = bcrypt().hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, userId);
    projectStaff(db, userId);
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

  // ══════════════════════════════════════════════════════
  // PASSWORD RESET REQUESTS
  // ══════════════════════════════════════════════════════
  // A school has no mail server and the phone app talks to a read model, so
  // "email me a reset link" is not available. Instead the request is recorded
  // and an Administrator or Proprietor approves it face to face.
  //
  // Approval does NOT set a password. It mints a single-use claim code that the
  // account holder redeems by choosing their own password. That matters on a
  // shared office machine: if approval alone unlocked the "choose a new
  // password" screen, anyone who walked past between the approval and the
  // teacher's return could take the account. The approver reads the code out;
  // only somebody holding it can complete the reset.

  const RESET_CLAIM_TTL_HOURS = 24;
  const RESET_SOURCES = ['desktop', 'mobile', 'web'];

  function hashClaim(code) {
    return crypto.createHash('sha256').update(String(code)).digest('hex');
  }
  // Six digits, drawn from the CSPRNG and read aloud by the approver. Short
  // enough to say over a desk, and single-use against a 24-hour window.
  function newClaimCode() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  }
  function isDecider(userId) {
    if (!userId) return false;
    const actor = db.prepare(`
      SELECT d.name AS designation FROM users u
      LEFT JOIN designations d ON d.id = u.designation_id
      WHERE u.id = ? AND u.is_active = 1
    `).get(userId);
    return !!(actor && ['Administrator', 'Proprietor'].includes(actor.designation));
  }

  // ── Raise a request (public — reachable from the login screen) ──
  ipcMain.handle('auth:request-password-reset', (_e, { username, reason, from } = {}) => {
    const uname = String(username || '').trim();
    if (!uname) return { ok: false, error: 'Enter your username.' };
    const source = RESET_SOURCES.includes(from) ? from : 'desktop';

    const user = db.prepare('SELECT id, username, full_name FROM users WHERE username = ? AND is_active = 1').get(uname);

    // Deliberately the same answer whether or not the account exists. The login
    // screen is reachable by anyone in the building; telling them which
    // usernames are real turns this into a staff directory.
    const generic = { ok: true, submitted: true };
    if (!user) return generic;

    // One open request per account. Asking twice should not give an approver
    // two rows to work through, or mint a second code that invalidates nothing.
    const open = db.prepare(`
      SELECT id FROM password_reset_requests
      WHERE user_id = ? AND status IN ('pending', 'approved')
    `).get(user.id);
    if (open) return generic;

    db.prepare(`
      INSERT INTO password_reset_requests (user_id, username, status, reason, requested_from)
      VALUES (?, ?, 'pending', ?, ?)
    `).run(user.id, user.username, String(reason || '').slice(0, 500) || null, source);

    try {
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
        VALUES ('user', ?, 'password_reset_requested', NULL, ?, 'normal')
      `).run(user.id, `${user.full_name || user.username} asked for a password reset (${source})`);
    } catch (_) { /* audit is best-effort */ }

    return generic;
  });

  // ── How many are waiting (drives the badge an approver sees) ──
  ipcMain.handle('auth:pending-password-resets', () => {
    if (!isDecider(security.getCurrentUserId())) return { ok: true, count: 0 };
    const row = db.prepare("SELECT COUNT(*) c FROM password_reset_requests WHERE status = 'pending'").get();
    return { ok: true, count: row.c };
  });

  // ── The approver's queue ──
  ipcMain.handle('auth:list-password-resets', (_e, { status } = {}) => {
    if (!isDecider(security.getCurrentUserId())) {
      return { ok: false, error: 'Only an Administrator or Proprietor can review password requests.', requests: [] };
    }
    const rows = status
      ? db.prepare(`
          SELECT r.*, u.full_name, d.name AS designation
          FROM password_reset_requests r
          JOIN users u ON u.id = r.user_id
          LEFT JOIN designations d ON d.id = u.designation_id
          WHERE r.status = ? ORDER BY r.requested_at DESC LIMIT 200
        `).all(status)
      : db.prepare(`
          SELECT r.*, u.full_name, d.name AS designation
          FROM password_reset_requests r
          JOIN users u ON u.id = r.user_id
          LEFT JOIN designations d ON d.id = u.designation_id
          ORDER BY r.requested_at DESC LIMIT 200
        `).all();
    // The stored hash never leaves the main process.
    return { ok: true, requests: rows.map(({ claim_hash, ...r }) => r) };
  });

  // ── Approve or deny ──
  // Approving returns the claim code ONCE, for the approver to hand over. It is
  // stored only as a hash, so it cannot be recovered afterwards — a lost code
  // means denying the request and asking the person to raise a fresh one.
  ipcMain.handle('auth:decide-password-reset', (_e, { requestId, approve, note } = {}) => {
    const actorUserId = security.getCurrentUserId();
    if (!actorUserId) return { ok: false, error: 'Please sign in again.' };
    if (!isDecider(actorUserId)) {
      return { ok: false, error: 'Only an Administrator or Proprietor can approve password requests.' };
    }
    const req = db.prepare("SELECT * FROM password_reset_requests WHERE id = ?").get(requestId);
    if (!req) return { ok: false, error: 'Request not found.' };
    if (req.status !== 'pending') return { ok: false, error: `This request has already been ${req.status}.` };

    if (!approve) {
      db.prepare(`
        UPDATE password_reset_requests
        SET status = 'denied', decided_by = ?, decided_at = datetime('now'), decision_note = ?
        WHERE id = ?
      `).run(actorUserId, String(note || '').slice(0, 500) || null, requestId);
      return { ok: true, approved: false };
    }

    const code = newClaimCode();
    db.prepare(`
      UPDATE password_reset_requests
      SET status = 'approved', decided_by = ?, decided_at = datetime('now'), decision_note = ?,
          claim_hash = ?, claim_expires_at = datetime('now', ?)
      WHERE id = ?
    `).run(actorUserId, String(note || '').slice(0, 500) || null, hashClaim(code),
           `+${RESET_CLAIM_TTL_HOURS} hours`, requestId);

    try {
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
        VALUES ('user', ?, 'password_reset_approved', ?, ?, 'high')
      `).run(req.user_id, actorUserId, `Password reset approved for ${req.username}`);
    } catch (_) {}

    return { ok: true, approved: true, code, username: req.username, expiresInHours: RESET_CLAIM_TTL_HOURS };
  });

  // ── Has my request been dealt with? (login screen polls this) ──
  // Says only whether a decision has been made, never the code. Without a code
  // in hand the answer is not worth anything to somebody else at the machine.
  ipcMain.handle('auth:password-reset-status', (_e, { username } = {}) => {
    const uname = String(username || '').trim();
    if (!uname) return { ok: true, status: 'none' };
    const row = db.prepare(`
      SELECT status, claim_expires_at FROM password_reset_requests
      WHERE username = ? ORDER BY requested_at DESC LIMIT 1
    `).get(uname);
    if (!row) return { ok: true, status: 'none' };
    if (row.status === 'approved' && row.claim_expires_at &&
        new Date(row.claim_expires_at.replace(' ', 'T') + 'Z') < new Date()) {
      return { ok: true, status: 'expired' };
    }
    return { ok: true, status: row.status };
  });

  // ── Redeem the claim and choose a new password ──
  ipcMain.handle('auth:complete-password-reset', (_e, { username, code, newPassword } = {}) => {
    const uname = String(username || '').trim();
    if (!uname || !code) return { ok: false, error: 'Enter your username and the approval code.' };
    if (!newPassword || String(newPassword).length < 6) {
      return { ok: false, error: 'Password must be at least 6 characters.' };
    }
    const req = db.prepare(`
      SELECT * FROM password_reset_requests
      WHERE username = ? AND status = 'approved' ORDER BY decided_at DESC LIMIT 1
    `).get(uname);
    if (!req) return { ok: false, error: 'No approved request for that username. Ask an Administrator to approve one.' };
    if (req.claim_expires_at && new Date(req.claim_expires_at.replace(' ', 'T') + 'Z') < new Date()) {
      db.prepare("UPDATE password_reset_requests SET status = 'cancelled' WHERE id = ?").run(req.id);
      return { ok: false, error: 'That approval has expired. Please ask for a new one.' };
    }

    const given = hashClaim(String(code).trim());
    let match = false;
    try {
      const a = Buffer.from(given, 'hex');
      const b = Buffer.from(String(req.claim_hash || ''), 'hex');
      match = a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (_) { match = false; }
    if (!match) return { ok: false, error: 'That approval code is not correct.' };

    // The reset clears must_change_password: the person has just chosen this
    // password themselves, so making them change it again at the next screen
    // would be a loop with no purpose.
    const hash = bcrypt().hashSync(String(newPassword), 10);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, req.user_id);
    db.prepare("UPDATE password_reset_requests SET status = 'used', used_at = datetime('now') WHERE id = ?").run(req.id);
    clearLoginFailures(uname);

    try {
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
        VALUES ('user', ?, 'password_reset_completed', ?, ?, 'high')
      `).run(req.user_id, req.user_id, `${uname} set a new password after approval`);
    } catch (_) {}

    projectStaff(db, req.user_id);
    return { ok: true };
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
