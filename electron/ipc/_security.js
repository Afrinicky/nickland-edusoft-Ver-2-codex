// Nickland Edusoft — Backend Permission Enforcement
// This is the REAL security layer. Frontend route guards can be bypassed
// by anyone who opens DevTools. These checks run on the Node side and
// cannot be circumvented from the renderer.

// Required lazily, and deliberately. auth.js requires this module back, so a
// top-level require here is a cycle: whichever of the two loads second gets a
// half-built copy of the other, and `resolveEffectivePermissions` comes out
// undefined. Node was already warning about it. Resolving the reference at
// call time costs nothing and removes the ordering trap.
function resolveEffectivePermissions(db, userId) {
  return require('./auth').resolveEffectivePermissions(db, userId);
}

// Who is asking.
//
// For most of this application's life there was exactly one answer: the person
// sitting at the office PC, signed in at auth:login and held in a variable
// here. That was true and this file said so.
//
// It stopped being true the moment the host began answering other machines.
// A bursar in the next room and a teacher on the school Wi-Fi both arrive as
// requests to the same Node process, and a single variable would hand both of
// them whoever signed in last — every permission check, every audit row and
// every "whose class" answer in the system attributed to the wrong person. It
// would not look like a fault. It would look like the bursar doing things.
//
// So identity is per-caller. `runAs` puts a request's user into an async
// context that follows it through everything it calls, awaits included;
// anything running outside such a context — the Electron window, the backup
// scheduler, the maintenance sweep — falls back to the signed-in user of this
// machine, which is exactly what it was before. The thirty-eight places that
// ask `getCurrentUserId()` did not change, and neither did any handler.
const { AsyncLocalStorage } = require('async_hooks');

const caller = new AsyncLocalStorage();

// The window's own user. Set by auth:login, and the answer whenever nothing
// more specific is in scope.
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

// Run `fn` as somebody in particular. Returns whatever fn returns, so an async
// handler keeps this identity across every await inside it.
function runAs(identity, fn) {
  return caller.run(
    { userId: identity && identity.userId != null ? identity.userId : null,
      designation: (identity && identity.designation) || null },
    fn
  );
}

// True while a request is being served on somebody else's behalf. The audit
// log says so, because "the office PC did it" and "a browser on the Wi-Fi did
// it" are not the same event to anybody investigating one.
function isScopedCall() {
  return caller.getStore() != null;
}

function getCurrentUserId() {
  const scoped = caller.getStore();
  return scoped ? scoped.userId : currentUserId;
}

function getCurrentDesignation() {
  const scoped = caller.getStore();
  return scoped ? scoped.designation : currentUserDesignation;
}

// The two designations that may take destructive/controversial financial
// actions (voiding or deleting a bill). Deliberately narrower than
// checkPermission: an Accountant with fees.delete can still not void a bill,
// because a voided bill rewrites what a parent was told they owe.
// The name list comes from _portals so "Super Admin" and its legacy spelling
// "Administrator" are recognised in one place rather than eleven.
const { ELEVATED_NAMES, isElevated: isElevatedName } = require('./_portals');
const ELEVATED = ELEVATED_NAMES;

// Resolves elevation from the database rather than trusting the renderer, and
// falls back to the designation captured at login when the user row is gone.
function isElevated(db, userId = getCurrentUserId()) {
  if (!userId) return false;
  let designation = userId === getCurrentUserId() ? getCurrentDesignation() : null;
  try {
    const row = db.prepare(`
      SELECT d.name AS designation
      FROM users u LEFT JOIN designations d ON d.id = u.designation_id
      WHERE u.id = ?
    `).get(userId);
    if (row && row.designation) designation = row.designation;
  } catch (_) { /* fall back to the login-time designation */ }
  return isElevatedName(designation);
}

// Returns true if the current user is allowed to perform `action` on `module`.
// The Proprietor and the Super Admin always pass.
function checkPermission(db, module, action = 'view') {
  const userId = getCurrentUserId();
  if (!userId) return false;
  if (isElevatedName(getCurrentDesignation())) return true;
  const perms = resolveEffectivePermissions(db, userId);
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
        `).run(getCurrentUserId(), `Denied ${action} on ${module}`);
      } catch (e) {}
      return { ok: false, error: `Access denied. You do not have permission to ${action} ${module}.` };
    }
    return handler(event, ...args);
  };
}

module.exports = {
  setCurrentUser,
  clearCurrentUser,
  runAs,
  isScopedCall,
  getCurrentUserId,
  getCurrentDesignation,
  isElevated,
  ELEVATED,
  checkPermission,
  requirePerm,
};
