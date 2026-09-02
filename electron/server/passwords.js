// Nickland Edusoft — password changes and approved resets.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// One implementation, three callers: the desktop's own IPC (electron/ipc/auth.js),
// the LAN API a phone reaches on the school Wi-Fi (electron/server/api.js), and
// — by way of the projected claim — the cloud. They must not drift: a rule that
// holds on the desktop and not over Wi-Fi is not a rule.
//
// The shape of a reset, and why it is shaped that way:
//
//   A school has no mail server, so "email me a link" does not exist. A person
//   approves instead. But approval alone must not unlock the choose-a-password
//   screen: on a shared office machine, anyone walking past between the
//   approval and the teacher's return would own the account. So approval mints
//   a single-use code, the approver hands it over, and only its holder can
//   finish. The approver never sets or sees the new password.

const crypto = require('crypto');

let _bcrypt = null;
function bcrypt() { return _bcrypt || (_bcrypt = require('bcryptjs')); }

const CLAIM_TTL_HOURS = 24;
const MIN_PASSWORD = 6;
const SOURCES = ['desktop', 'mobile', 'web'];

function hashClaim(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

// Six digits from the CSPRNG: short enough to read across a desk, single-use
// against a 24-hour window and a throttled endpoint.
function newClaimCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function expired(at) {
  if (!at) return false;
  return new Date(String(at).replace(' ', 'T') + 'Z') < new Date();
}

function sameDigest(a, b) {
  try {
    const x = Buffer.from(String(a), 'hex');
    const y = Buffer.from(String(b), 'hex');
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  } catch (_) { return false; }
}

function audit(db, entityId, action, actorId, note, severity) {
  try {
    db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
      VALUES ('user', ?, ?, ?, ?, ?)
    `).run(entityId, action, actorId, String(note).slice(0, 500), severity || 'normal');
  } catch (_) { /* audit is best-effort and must never block the change */ }
}

function project(db, userId) {
  try {
    const sp = require('./sync/staff_projection');
    sp.enqueueStaffAuth(db, userId);
  } catch (_) {}
}

function projectClaim(db, requestId) {
  try { require('./sync/staff_projection').enqueueResetClaim(db, requestId); } catch (_) {}
}

// ── raising a request ───────────────────────────────────────────────────────
// The answer never says whether the username is real. A sign-in screen is
// reachable by anyone in the building, and one that confirms usernames is a
// staff directory.
function requestReset(db, { username, reason, source }) {
  const uname = String(username || '').trim();
  if (!uname) return { ok: false, error: 'Enter your username.' };
  const from = SOURCES.includes(source) ? source : 'desktop';
  const generic = { ok: true, submitted: true };

  let user;
  try { user = db.prepare('SELECT id, username, full_name FROM users WHERE username = ? AND is_active = 1').get(uname); }
  catch (_) { return generic; }
  if (!user) return generic;

  // One open request per account: asking twice should not give the approver two
  // rows, nor mint a second code that invalidates nothing.
  const open = db.prepare(`
    SELECT id FROM password_reset_requests
    WHERE user_id = ? AND status IN ('pending', 'approved')
  `).get(user.id);
  if (open) return generic;

  db.prepare(`
    INSERT INTO password_reset_requests (user_id, username, status, reason, requested_from)
    VALUES (?, ?, 'pending', ?, ?)
  `).run(user.id, user.username, String(reason || '').slice(0, 500) || null, from);

  audit(db, user.id, 'password_reset_requested', null,
    `${user.full_name || user.username} asked for a password reset (${from})`);
  return generic;
}

// ── approving or declining ──────────────────────────────────────────────────
// Returns the code ONCE. Only its hash is stored, so it cannot be recovered.
function decideReset(db, { requestId, approve, note, actorUserId }) {
  if (!actorUserId) return { ok: false, error: 'Please sign in again.' };
  const actor = db.prepare(`
    SELECT d.name AS designation FROM users u
    LEFT JOIN designations d ON d.id = u.designation_id
    WHERE u.id = ? AND u.is_active = 1
  `).get(actorUserId);
  if (!actor || !['Administrator', 'Proprietor'].includes(actor.designation)) {
    return { ok: false, error: 'Only an Administrator or Proprietor can approve password requests.' };
  }

  const req = db.prepare('SELECT * FROM password_reset_requests WHERE id = ?').get(requestId);
  if (!req) return { ok: false, error: 'Request not found.' };
  if (req.status !== 'pending') return { ok: false, error: `This request has already been ${req.status}.` };

  if (!approve) {
    db.prepare(`
      UPDATE password_reset_requests
      SET status = 'denied', decided_by = ?, decided_at = datetime('now'), decision_note = ?
      WHERE id = ?
    `).run(actorUserId, String(note || '').slice(0, 500) || null, requestId);
    projectClaim(db, requestId);
    return { ok: true, approved: false };
  }

  const code = newClaimCode();
  db.prepare(`
    UPDATE password_reset_requests
    SET status = 'approved', decided_by = ?, decided_at = datetime('now'), decision_note = ?,
        claim_hash = ?, claim_expires_at = datetime('now', ?)
    WHERE id = ?
  `).run(actorUserId, String(note || '').slice(0, 500) || null, hashClaim(code),
         `+${CLAIM_TTL_HOURS} hours`, requestId);

  audit(db, req.user_id, 'password_reset_approved', actorUserId,
    `Password reset approved for ${req.username}`, 'high');
  // So the same code works from the phone app. The cloud can check a hash it
  // has been given; it can never grant one.
  projectClaim(db, requestId);
  return { ok: true, approved: true, code, username: req.username, expiresInHours: CLAIM_TTL_HOURS };
}

// ── has my request been dealt with? ─────────────────────────────────────────
// Says only that a decision exists, never the code. Without a code in hand the
// answer is worth nothing to somebody else standing at the machine.
function resetStatus(db, { username }) {
  const uname = String(username || '').trim();
  if (!uname) return { ok: true, status: 'none' };
  const row = db.prepare(`
    SELECT status, claim_expires_at FROM password_reset_requests
    WHERE username = ? ORDER BY requested_at DESC LIMIT 1
  `).get(uname);
  if (!row) return { ok: true, status: 'none' };
  if (row.status === 'approved' && expired(row.claim_expires_at)) return { ok: true, status: 'expired' };
  return { ok: true, status: row.status };
}

// ── redeeming the claim ─────────────────────────────────────────────────────
function completeReset(db, { username, code, newPassword }) {
  const uname = String(username || '').trim();
  if (!uname || !code) return { ok: false, error: 'Enter your username and the approval code.' };
  if (!newPassword || String(newPassword).length < MIN_PASSWORD) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD} characters.` };
  }

  const req = db.prepare(`
    SELECT * FROM password_reset_requests
    WHERE username = ? AND status = 'approved' ORDER BY decided_at DESC LIMIT 1
  `).get(uname);
  if (!req) return { ok: false, error: 'No approved request for that username. Ask an Administrator to approve one.' };
  if (expired(req.claim_expires_at)) {
    db.prepare("UPDATE password_reset_requests SET status = 'cancelled' WHERE id = ?").run(req.id);
    projectClaim(db, req.id);
    return { ok: false, error: 'That approval has expired. Please ask for a new one.' };
  }
  if (!sameDigest(hashClaim(String(code).trim()), req.claim_hash || '')) {
    return { ok: false, error: 'That approval code is not correct.' };
  }

  // must_change_password is cleared: the person has just chosen this password
  // themselves, so asking them to change it at the next screen is a loop.
  const hash = bcrypt().hashSync(String(newPassword), 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, req.user_id);
  db.prepare("UPDATE password_reset_requests SET status = 'used', used_at = datetime('now') WHERE id = ?").run(req.id);
  projectClaim(db, req.id);

  audit(db, req.user_id, 'password_reset_completed', req.user_id,
    `${uname} set a new password after approval`, 'high');
  project(db, req.user_id);
  return { ok: true, user_id: req.user_id };
}

// ── changing your own ───────────────────────────────────────────────────────
// The account is always the caller's own; no path here takes a target id.
function changeOwnPassword(db, userId, { oldPassword, newPassword, source }) {
  if (!userId) return { ok: false, error: 'Please sign in again.' };
  if (!newPassword || String(newPassword).length < MIN_PASSWORD) {
    return { ok: false, error: `New password must be at least ${MIN_PASSWORD} characters.` };
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return { ok: false, error: 'User not found.' };
  if (!user.password_hash) {
    return { ok: false, error: 'This account has no password set. Ask an Administrator to reset it.' };
  }
  if (!bcrypt().compareSync(String(oldPassword || ''), user.password_hash)) {
    return { ok: false, error: 'Current password is incorrect.' };
  }
  if (String(oldPassword) === String(newPassword)) {
    return { ok: false, error: 'The new password must be different from the current one.' };
  }

  const hash = bcrypt().hashSync(String(newPassword), 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, userId);
  if (source && source !== 'desktop') {
    audit(db, userId, 'password_changed_remotely', userId,
      `${user.username} changed their password from the ${source} app`, 'high');
  }
  project(db, userId);
  return { ok: true };
}

function pendingCount(db) {
  try { return db.prepare("SELECT COUNT(*) c FROM password_reset_requests WHERE status = 'pending'").get().c; }
  catch (_) { return 0; }
}

function listRequests(db, status) {
  const sql = `
    SELECT r.*, u.full_name, d.name AS designation
    FROM password_reset_requests r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN designations d ON d.id = u.designation_id
    ${status ? 'WHERE r.status = ?' : ''}
    ORDER BY r.requested_at DESC LIMIT 200
  `;
  const rows = status ? db.prepare(sql).all(status) : db.prepare(sql).all();
  // The stored hash never leaves this module.
  return rows.map(({ claim_hash, ...r }) => r);
}

module.exports = {
  CLAIM_TTL_HOURS, MIN_PASSWORD,
  requestReset, decideReset, resetStatus, completeReset, changeOwnPassword,
  pendingCount, listRequests,
};
