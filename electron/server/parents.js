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

// ── Self-registration has been removed ──────────────────────────────────────
//
// There used to be a self-registration function here. A parent typed a phone
// number or an email, it was matched against `students.father_contact` /
// `mother_contact` / `guardian_contact`, and on a match the new account was
// linked to that child and handed a token.
//
// Nothing in that sequence proved the person held the number they typed. A
// parent's phone number is not a secret — it is in the class WhatsApp group, on
// the PTA list, and on the form every other parent filled in — so anybody who
// knew one could read that child's fee ledger, academic record, attendance,
// timetable, homework and teacher contacts. The setting that governed it
// defaulted to ON.
//
// An OTP would have closed the hole and kept the feature. The school asked for
// the feature to go instead, which is the stronger answer: a parent account is
// now only ever created by the school, through `provisionParent` below, by
// somebody who knows which child belongs to whom.
//
// `matchStudentsByContact` is kept — `provisionParent` uses it to suggest the
// children for a parent the OFFICE is setting up, and Settings → Mobile App
// uses it to show those suggestions. The difference is who is asserting the
// relationship.

// Admin-provisioned parent with explicit student links (+ optional contact match).
function provisionParent(db, { full_name, phone, email, password, studentIds = [], createdBy }) {
  // A password the office chose is held to the same floor a parent's own is.
  // The generated one below is well past it.
  if (password && String(password).length < MIN_PARENT_PASSWORD) {
    return { ok: false, error: `A password must be at least ${MIN_PARENT_PASSWORD} characters.` };
  }
  const np = phone ? normPhone(phone) : null;
  if (np) {
    const dup = db.prepare('SELECT id FROM parents WHERE phone = ?').get(np);
    if (dup) return { ok: false, error: 'A parent with this phone already exists.' };
  }
  // Temp passwords are handed to a parent and unlock their children's fee and
  // academic records, so they come from the CSPRNG — Math.random() is seeded
  // predictably enough that concurrently-issued passwords are guessable.
  const pass = password || crypto.randomBytes(6).toString('base64url').slice(0, 8);
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

// ── Throttling a parent sign-in ─────────────────────────────────────────────
//
// There was nothing here. The only brake on guessing a parent's password was
// the API's own 20-requests-a-minute limiter, which is generous for a password
// of four characters — and four was the minimum this file enforced.
//
// It matters more than it looks, because this same function answers
// /api/v1/auth/parent/login on `host/server.js`, which is the installed
// application deployed to the INTERNET. A throttle that is optional on the
// school Wi-Fi is not optional there.
//
// The shape is the one the online service already settled on
// (cloud-python/app/school/session.py), and deliberately NOT the one the
// desktop's staff login uses. Counting failures per account alone is a denial
// of service anybody can arrange from anywhere: guess five times at a parent's
// number every minute and that parent never gets in again. So the count is per
// (account, source) — an attacker locks out their own address — with a much
// higher per-account backstop that still catches a guess spread across many
// addresses, at a threshold no honest person reaches.
const MAX_PARENT_FAILURES = 5;         // from one source, against one account
const MAX_PARENT_ACCOUNT_FAILURES = 50; // from anywhere, against one account
const PARENT_LOCKOUT_MS = 60000;
const parentFailures = new Map();

function failureKey(identifier, source) {
  return `${String(identifier || '').trim().toLowerCase()}|${source || 'unknown'}`;
}

function lockedFor(key, threshold) {
  const rec = parentFailures.get(key);
  if (!rec || rec.count < threshold) return 0;
  const remaining = rec.until - Date.now();
  if (remaining <= 0) { parentFailures.delete(key); return 0; }
  return Math.ceil(remaining / 1000);
}

function recordParentFailure(db, key, identifier, reason) {
  const rec = parentFailures.get(key) || { count: 0, until: 0 };
  rec.count++;
  rec.until = Date.now() + PARENT_LOCKOUT_MS;
  parentFailures.set(key, rec);
  if (parentFailures.size > 2000) {
    const now = Date.now();
    for (const [k, v] of parentFailures) if (v.until < now) parentFailures.delete(k);
  }
  try {
    db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
      VALUES ('security', NULL, 'parent_login_failed', NULL, ?, ?)
    `).run(`Failed parent sign-in for "${String(identifier || '').slice(0, 80)}" (${reason})`,
      rec.count >= MAX_PARENT_FAILURES ? 'high' : 'normal');
  } catch (_) { /* audit is best-effort */ }
  return rec.count;
}

/** Testing seam, and what a restart does anyway. */
function resetParentThrottle() { parentFailures.clear(); }

// A hash to check a password against when there is no account, so that
// "no such parent" costs the same as "wrong password".
//
// Without this, the answer came back before scrypt had run, and the difference
// is measurable from anywhere: it turns the login box into an oracle for "is
// this number a parent at this school?", which is the same question
// self-registration used to answer out loud.
const DUMMY_HASH = hashPassword(crypto.randomBytes(32).toString('hex'));

function loginParent(db, { identifier, password, source } = {}) {
  const sourceKey = failureKey(identifier, source);
  const accountKey = failureKey(identifier, '*');
  const wait = lockedFor(sourceKey, MAX_PARENT_FAILURES)
    || lockedFor(accountKey, MAX_PARENT_ACCOUNT_FAILURES);
  if (wait) {
    return { ok: false, throttled: true, error: `Too many attempts. Try again in ${wait}s.` };
  }

  const np = normPhone(identifier);
  let parent = np ? db.prepare('SELECT * FROM parents WHERE phone = ?').get(np) : null;
  if (!parent && identifier) {
    parent = db.prepare('SELECT * FROM parents WHERE lower(email) = ?').get(String(identifier).trim().toLowerCase());
  }

  // Deliberately not an early return: the work happens either way. See above.
  const stored = (parent && parent.is_active) ? parent.password_hash : DUMMY_HASH;
  const good = verifyPassword(password, stored) && !!(parent && parent.is_active);

  if (!good) {
    recordParentFailure(db, accountKey, identifier, parent ? 'bad_password' : 'unknown_parent');
    recordParentFailure(db, sourceKey, identifier, parent ? 'bad_password' : 'unknown_parent');
    return { ok: false, error: 'Invalid credentials.' };
  }

  parentFailures.delete(sourceKey);
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

// Eight, not four. Four characters is about ten hours of guessing at the old
// rate and minutes at any rate worth worrying about, and the online service has
// always said eight (cloud-python/app/school/parents.py) — so four here meant
// the weaker of the two rules decided, for the same school.
const MIN_PARENT_PASSWORD = 8;

function setParentPassword(db, parentId, newPassword) {
  if (!newPassword || String(newPassword).length < MIN_PARENT_PASSWORD) {
    return { ok: false, error: `A password must be at least ${MIN_PARENT_PASSWORD} characters.` };
  }
  db.prepare('UPDATE parents SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(hashPassword(newPassword), parentId);
  enqueueParentAuth(db, parentId);
  return { ok: true };
}

module.exports = {
  hashPassword, verifyPassword, normPhone, matchStudentsByContact,
  provisionParent, loginParent, studentIdsForParent,
  listParents, setParentPassword, enqueueParentAuth,
  resetParentThrottle, MIN_PARENT_PASSWORD,
};
