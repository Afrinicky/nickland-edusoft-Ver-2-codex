// Nickland Edusoft — applying the policy to every IPC channel.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// `guardedIpcMain(ipcMain, db)` returns a stand-in for ipcMain whose `handle`
// wraps the real handler in the permission and scope checks declared in
// _policy.js. Modules register exactly as they did; nothing in their bodies
// changes. That matters for two reasons:
//
//   • There were 98 unguarded handlers. Editing each one by hand would have
//     been 98 chances to get it wrong, and would not have covered the ninety
//     ninth added next month.
//
//   • Enforcement is then in ONE readable place. "Which permission does
//     students:sheet-update-cell need" has an answer you can look up, rather
//     than one you have to go and read a handler to discover.
//
// This runs in the main process. The renderer cannot reach around it: opening
// DevTools and calling the channel directly lands here just the same.

const security = require('./_security');
const scopes = require('./_scope');
const { POLICY, ALWAYS_ALLOWED } = require('./_policy');

const ACTION_LABEL = {
  view: 'view', create: 'add to', edit: 'change', delete: 'delete from',
};

function deny(db, channel, message) {
  try {
    db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
      VALUES ('security', NULL, 'permission_denied', ?, ?, 'high')
    `).run(security.getCurrentUserId(), `Denied ${channel}: ${message}`.slice(0, 500));
  } catch (_) { /* auditing a denial must not turn it into a crash */ }
  return { ok: false, error: message, denied: true };
}

// Resolve the scope rule against the call's arguments.
function scopeAllows(db, scope, rule, args) {
  if (!rule || scope.unrestricted) return true;
  if (rule.kind === 'selfFiltered') return true;

  const value = rule.get(args);
  // A missing id means "all of them" — a class-wide list with no class picked,
  // for instance. A restricted user gets the handler's own filtering (which
  // the SELF_FILTERED handlers do) rather than a blanket refusal, because
  // refusing here would break the pickers those screens are built from.
  if (value == null || value === '') return true;

  switch (rule.kind) {
    case 'class':        return scopes.canAccessClass(scope, value);
    case 'classTeacher': return scopes.isClassTeacherOf(scope, value);
    case 'student':      return scopes.canAccessStudent(db, scope, value);
    case 'subject': {
      const subjectId = rule.getSubject(args);
      // No subject named: the call is about the class as a whole.
      if (subjectId == null || subjectId === '') return scopes.canAccessClass(scope, value);
      return scopes.canAccessSubject(scope, value, subjectId);
    }
    default: return true;
  }
}

function guardedIpcMain(ipcMain, db) {
  return {
    handle(channel, handler) {
      return ipcMain.handle(channel, (event, ...args) => {
        // Nobody signed in: only the channels that get somebody signed in.
        const userId = security.getCurrentUserId();
        if (!userId) {
          return ALWAYS_ALLOWED.has(channel)
            ? handler(event, ...args)
            : deny(db, channel, 'Please sign in.');
        }

        const scope = scopes.scopeFor(db, userId);
        // The people who run the school are not scoped, and their permissions
        // are checked by checkPermission as before.
        if (ALWAYS_ALLOWED.has(channel)) return handler(event, ...args);

        const rule = POLICY[channel];
        if (!rule) {
          // Unlisted. Anyone unrestricted carries on — the handlers outside
          // the policy are the office-side ones they already own. Everybody
          // else is refused, so a handler added later is closed by default
          // instead of quietly open.
          if (scope.unrestricted) return handler(event, ...args);
          return deny(db, channel, 'Access denied. Ask an Administrator if you need this.');
        }

        const [module, action, scopeRule] = rule;
        if (!security.checkPermission(db, module, action)) {
          return deny(db, channel,
            `Access denied. You do not have permission to ${ACTION_LABEL[action] || action} ${module}.`);
        }
        if (!scopeAllows(db, scope, scopeRule, args)) {
          return deny(db, channel,
            'That belongs to a class or subject you are not assigned to.');
        }
        return handler(event, ...args);
      });
    },
    // Anything else a module reaches for on ipcMain passes straight through.
    on: (...a) => ipcMain.on(...a),
    once: (...a) => ipcMain.once(...a),
    removeHandler: (...a) => ipcMain.removeHandler(...a),
    removeAllListeners: (...a) => ipcMain.removeAllListeners(...a),
  };
}

module.exports = { guardedIpcMain };
