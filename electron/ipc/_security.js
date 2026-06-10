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
  checkPermission,
  requirePerm,
};
