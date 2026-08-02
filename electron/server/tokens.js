// Nickland Edusoft — Mobile API bearer tokens
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Per-device bearer tokens for the mobile API. The raw token is shown to the
// client exactly once (at login/pairing); only its SHA-256 hash is stored, so
// a database leak cannot reveal usable tokens. Tokens are revocable and expire.

const crypto = require('crypto');
const { getSetting } = require('../utils/idgen');

function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

function issueToken(db, subjectType, subjectId, { deviceName, platform } = {}) {
  const raw = crypto.randomBytes(32).toString('base64url');
  const hash = sha256(raw);
  const ttlDays = parseInt(getSetting(db, 'mobile_token_ttl_days', '30'), 10) || 30;
  const expiresAt = new Date(Date.now() + ttlDays * 86400000).toISOString();
  const r = db.prepare(`
    INSERT INTO api_tokens (token_hash, subject_type, subject_id, device_name, platform, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(hash, subjectType, subjectId, deviceName || null, platform || null, expiresAt);
  return { token: raw, id: r.lastInsertRowid, expires_at: expiresAt };
}

// Returns { subject_type, subject_id, token_id } or null.
function verifyToken(db, rawToken) {
  if (!rawToken) return null;
  const hash = sha256(rawToken);
  const row = db.prepare('SELECT * FROM api_tokens WHERE token_hash = ?').get(hash);
  if (!row || row.revoked) return null;
  if (row.expires_at && row.expires_at < new Date().toISOString()) return null;
  try { db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.id); } catch (_) {}
  return { subject_type: row.subject_type, subject_id: row.subject_id, token_id: row.id };
}

function revokeToken(db, id) {
  db.prepare('UPDATE api_tokens SET revoked = 1 WHERE id = ?').run(id);
  return { ok: true };
}

function revokeAllForSubject(db, subjectType, subjectId) {
  db.prepare('UPDATE api_tokens SET revoked = 1 WHERE subject_type = ? AND subject_id = ?').run(subjectType, subjectId);
  return { ok: true };
}

function listDevices(db) {
  return db.prepare(`
    SELECT t.id, t.subject_type, t.subject_id, t.device_name, t.platform,
           t.created_at, t.last_used_at, t.expires_at, t.revoked,
           CASE t.subject_type WHEN 'parent' THEN p.full_name ELSE u.full_name END AS subject_name
    FROM api_tokens t
    LEFT JOIN parents p ON t.subject_type = 'parent' AND p.id = t.subject_id
    LEFT JOIN users u   ON t.subject_type = 'user'   AND u.id = t.subject_id
    WHERE t.revoked = 0
    ORDER BY t.last_used_at DESC, t.created_at DESC
  `).all();
}

module.exports = { issueToken, verifyToken, revokeToken, revokeAllForSubject, listDevices, sha256 };
