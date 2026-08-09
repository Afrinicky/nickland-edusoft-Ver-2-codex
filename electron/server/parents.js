// Nickland Edusoft — Parent identity for the mobile API
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Parents are NOT staff users. A parent account links a phone/email + password
// to one or more students, verified against the guardian contact/email fields
// already stored on each student. Passwords are hashed with scrypt (built-in
// Node crypto — no external dependency, so this layer is fully self-contained
// and testable).

const crypto = require('crypto');
const { postToOutbox, syncEnabled } = require('./sync/outbox');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, expected] = stored.split('$');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(derived, 'hex'); const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normPhone(raw) {
  let s = String(raw || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('0')) s = '233' + s.slice(1);
  else if (s.length === 9) s = '233' + s;
  return s;
}

// Find students whose guardian contact/email matches the given phone/email.
function matchStudentsByContact(db, { phone, email }) {
  const results = new Map();
  if (phone) {
    const np = normPhone(phone);
    const rows = db.prepare(`
      SELECT id, father_contact, mother_contact, guardian_contact,
             father_name, mother_name, guardian_name
      FROM students WHERE status = 'Active'
        AND (father_contact IS NOT NULL OR mother_contact IS NOT NULL OR guardian_contact IS NOT NULL)
    `).all();
    for (const s of rows) {
      const rel =
        normPhone(s.father_contact) === np ? 'Father' :
        normPhone(s.mother_contact) === np ? 'Mother' :
        normPhone(s.guardian_contact) === np ? 'Guardian' : null;
      if (rel) results.set(s.id, rel);
    }
  }
  if (email) {
    const e = String(email).trim().toLowerCase();
    const rows = db.prepare(`
      SELECT id, father_email, mother_email, guardian_email FROM students WHERE status = 'Active'
    `).all();
    for (const s of rows) {
      const rel =
        (s.father_email || '').toLowerCase() === e ? 'Father' :
        (s.mother_email || '').toLowerCase() === e ? 'Mother' :
        (s.guardian_email || '').toLowerCase() === e ? 'Guardian' : null;
      if (rel && !results.has(s.id)) results.set(s.id, rel);
    }
  }
  return [...results.entries()].map(([student_id, relationship]) => ({ student_id, relationship }));
}

function linkStudents(db, parentId, matches) {
  const ins = db.prepare('INSERT OR IGNORE INTO parent_students (parent_id, student_id, relationship) VALUES (?, ?, ?)');
  for (const m of matches) ins.run(parentId, m.student_id, m.relationship);
}

// Self-registration: only succeeds if the phone/email matches a student on file.
function registerParent(db, { full_name, phone, email, password }) {
  if (!password || String(password).length < 4) return { ok: false, error: 'Password must be at least 4 characters.' };
  if (!phone && !email) return { ok: false, error: 'Phone or email is required.' };
  const matches = matchStudentsByContact(db, { phone, email });
  if (matches.length === 0) {
    return { ok: false, error: 'No student found with that phone/email. Ask the school to register you.' };
  }
  const np = phone ? normPhone(phone) : null;
  const existing = np ? db.prepare('SELECT id FROM parents WHERE phone = ?').get(np) : null;
  if (existing) return { ok: false, error: 'An account already exists for this phone. Please log in.' };
  const r = db.prepare(`
    INSERT INTO parents (full_name, phone, email, password_hash) VALUES (?, ?, ?, ?)
  `).run(full_name || 'Parent', np, (email || '').trim().toLowerCase() || null, hashPassword(password));
  linkStudents(db, r.lastInsertRowid, matches);
  enqueueParentAuth(db, r.lastInsertRowid);
  return { ok: true, parent_id: r.lastInsertRowid, linked: matches.length };
}

// Admin-provisioned parent with explicit student links (+ optional contact match).
function provisionParent(db, { full_name, phone, email, password, studentIds = [], createdBy }) {
  const np = phone ? normPhone(phone) : null;
  if (np) {
    const dup = db.prepare('SELECT id FROM parents WHERE phone = ?').get(np);
    if (dup) return { ok: false, error: 'A parent with this phone already exists.' };
  }
  const pass = password || Math.random().toString(36).slice(2, 8);
  const r = db.prepare(`
    INSERT INTO parents (full_name, phone, email, password_hash, must_change_password, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(full_name || 'Parent', np, (email || '').trim().toLowerCase() || null, hashPassword(pass),
         password ? 0 : 1, createdBy || null);
  const parentId = r.lastInsertRowid;
  const explicit = (studentIds || []).map(id => ({ student_id: id, relationship: 'Guardian' }));
  const matched = matchStudentsByContact(db, { phone, email });
  linkStudents(db, parentId, [...explicit, ...matched]);
  enqueueParentAuth(db, parentId);
  return { ok: true, parent_id: parentId, temp_password: password ? undefined : pass };
}

function loginParent(db, { identifier, password }) {
  const np = normPhone(identifier);
  let parent = np ? db.prepare('SELECT * FROM parents WHERE phone = ?').get(np) : null;
  if (!parent && identifier) {
    parent = db.prepare('SELECT * FROM parents WHERE lower(email) = ?').get(String(identifier).trim().toLowerCase());
  }
  if (!parent || !parent.is_active) return { ok: false, error: 'Invalid credentials.' };
  if (!verifyPassword(password, parent.password_hash)) return { ok: false, error: 'Invalid credentials.' };
  db.prepare("UPDATE parents SET last_login = datetime('now') WHERE id = ?").run(parent.id);
  return { ok: true, parent: { id: parent.id, full_name: parent.full_name, phone: parent.phone, email: parent.email, must_change_password: !!parent.must_change_password } };
}

function studentIdsForParent(db, parentId) {
  return db.prepare('SELECT student_id FROM parent_students WHERE parent_id = ?').all(parentId).map(r => r.student_id);
}

// Project a thin parent auth record to the cloud so the web portal can log the
// parent in even when the desktop is offline. No-op unless cloud sync is on.
// The desktop remains the source of truth for the account.
function enqueueParentAuth(db, parentId) {
  try {
    if (!syncEnabled(db)) return null;
    const p = db.prepare('SELECT id, full_name, phone, email, password_hash, is_active FROM parents WHERE id = ?').get(parentId);
    if (!p) return null;
    const studentKeys = studentIdsForParent(db, parentId).map(id => `student:${id}`);
    return postToOutbox(db, {
      entity_type: 'parent_auth',
      entity_key: `parent:${parentId}`,
      op: p.is_active ? 'upsert' : 'delete',
      payload: {
        parent_id: parentId, full_name: p.full_name, phone: p.phone, email: p.email,
        password_hash: p.password_hash, is_active: p.is_active, student_keys: studentKeys,
      },
    });
  } catch (_) { return null; }
}

function listParents(db) {
  return db.prepare(`
    SELECT p.id, p.full_name, p.phone, p.email, p.is_active, p.last_login, p.created_at,
           (SELECT COUNT(*) FROM parent_students ps WHERE ps.parent_id = p.id) AS child_count
    FROM parents p ORDER BY p.created_at DESC
  `).all();
}

function setParentPassword(db, parentId, newPassword) {
  if (!newPassword || String(newPassword).length < 4) return { ok: false, error: 'Password too short.' };
  db.prepare('UPDATE parents SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(hashPassword(newPassword), parentId);
  enqueueParentAuth(db, parentId);
  return { ok: true };
}

module.exports = {
  hashPassword, verifyPassword, normPhone, matchStudentsByContact,
  registerParent, provisionParent, loginParent, studentIdsForParent,
  listParents, setParentPassword, enqueueParentAuth,
};
