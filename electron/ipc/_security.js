// Nickland Edusoft — Backend Permission Enforcement
// This is the REAL security layer. Frontend route guards can be bypassed
// by anyone who opens DevTools. These checks run on the Node side and
// cannot be circumvented from the renderer.

const { resolveEffectivePermissions } = require('./auth');

// Tracks the currently authenticated user. Set by auth:login.
// Single-user desktop app, so a module-level variable is fine.
let currentUserId = null;
let currentUserDesignation = null;

function setCurrentUser(userId, designationName) {
  currentUserId = userId;
  currentUserDesignation = designationName;
}

function clearCurrentUser() {
  currentUserId = null;
  currentUserDesignation = null;
}

function getCurrentUserId() {
  return currentUserId;
}

function getCurrentDesignation() {
  return currentUserDesignation;
}

// The two designations that may take destructive/controversial financial
// actions (voiding or deleting a bill). Deliberately narrower than
// checkPermission: an Accountant with fees.delete can still not void a bill,
// because a voided bill rewrites what a parent was told they owe.
const ELEVATED = ['Proprietor', 'Administrator'];

// Resolves elevation from the database rather than trusting the renderer, and
// falls back to the designation captured at login when the user row is gone.
function isElevated(db, userId = currentUserId) {
  if (!userId) return false;
  let designation = userId === currentUserId ? currentUserDesignation : null;
  try {
    const row = db.prepare(`
      SELECT d.name AS designation
      FROM users u LEFT JOIN designations d ON d.id = u.designation_id
      WHERE u.id = ?
    `).get(userId);
    if (row && row.designation) designation = row.designation;
  } catch (_) { /* fall back to the login-time designation */ }
  return ELEVATED.includes(designation);
}

// Returns true if the current user is allowed to perform `action` on `module`.
// Proprietor and Administrator always pass.
function checkPermission(db, module, action = 'view') {
  if (!currentUserId) return false;
  if (['Proprietor', 'Administrator'].includes(currentUserDesignation)) return true;
  const perms = resolveEffectivePermissions(db, currentUserId);
  const p = perms[module];
  if (!p) return false;
  const map = { view: 'canView', create: 'canCreate', edit: 'canEdit', delete: 'canDelete' };
  return !!p[map[action] || 'canView'];
}

// Wraps an ipcMain.handle so it returns a Permission Denied response
// if the current user lacks the permission. Use sparingly — only on
// truly sensitive handlers (payroll, finance write ops, settings).
//
// Usage:
//   ipcMain.handle('payroll:mark-paid',
//     requirePerm(db, 'payroll', 'edit', (_e, data) => { ... }));
function requirePerm(db, module, action, handler) {
  return (event, ...args) => {
    if (!checkPermission(db, module, action)) {
      // Audit the denied attempt
      try {
        db.prepare(`
          INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
          VALUES ('security', NULL, 'permission_denied', ?, ?, 'high')
        `).run(currentUserId, `Denied ${action} on ${module}`);
      } catch (e) {}
      return { ok: false, error: `Access denied. You do not have permission to ${action} ${module}.` };
    }
    return handler(event, ...args);
  };
}

module.exports = {
  setCurrentUser,
  clearCurrentUser,
  getCurrentUserId,
  getCurrentDesignation,
  isElevated,
  ELEVATED,
  checkPermission,
  requirePerm,
};
