// Nickland Edusoft — Embedded Mobile API server
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A small HTTP/JSON API (Node built-in `http` — no framework dependency) that
// the desktop HOST exposes so mobile clients (React Native) can reach it over
// LAN. Every request carries a per-device bearer token; access is scoped to
// the SAME role model the desktop uses (staff designations / permissions) plus
// a parent role limited to their own children. Designed to sit behind a cloud
// relay later without changing the route contract.

const http = require('http');
const url = require('url');
const tokens = require('./tokens');
const webapp = require('./webapp');
const parents = require('./parents');
const passwords = require('./passwords');
const media = require('./media');
const { getSetting } = require('../utils/idgen');
const scopeLib = require('../ipc/_scope');
const { registerStaffRoutes } = require('./staff_api');
// Required at call-time (not destructured at load) to avoid a load-order
// circular-dependency warning: auth.js attaches resolveEffectivePermissions
// to module.exports after its main export.
function resolveEffectivePermissions(db, userId) {
  return require('../ipc/auth').resolveEffectivePermissions(db, userId);
}

const API = '/api/v1';

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''; let tooBig = false;
    req.on('data', (c) => { data += c; if (data.length > 1e6) { tooBig = true; req.destroy(); } });
    req.on('end', () => { if (tooBig) return resolve({}); try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// ── very small in-memory rate limiter for auth endpoints ──
// Keyed by IP *and* by the account being targeted: an IP-only limit lets a
// single attacker rotate source addresses, and lets one busy NAT'd school
// network lock everybody out. Entries are swept so the map cannot grow without
// bound on a long-running host.
const WINDOW_MS = 60000;
const MAX_PER_WINDOW = 20;
const attempts = new Map();

function sweepAttempts(now) {
  if (attempts.size < 1000) return;
  for (const [k, v] of attempts) if (now - v.t > WINDOW_MS) attempts.delete(k);
}

function bump(key, now) {
  const rec = attempts.get(key) || { n: 0, t: now };
  if (now - rec.t > WINDOW_MS) { rec.n = 0; rec.t = now; }
  rec.n++;
  attempts.set(key, rec);
  return rec.n > MAX_PER_WINDOW;
}

function rateLimited(ip, identifier) {
  const now = Date.now();
  sweepAttempts(now);
  let limited = bump(`ip:${ip}`, now);
  if (identifier) limited = bump(`id:${String(identifier).toLowerCase().slice(0, 120)}`, now) || limited;
  return limited;
}

function subjectContext(db, subject) {
  if (subject.subject_type === 'parent') {
    const p = db.prepare('SELECT id, full_name, phone, email FROM parents WHERE id = ?').get(subject.subject_id);
    if (!p) return null;
    return { role: 'parent', parent: p, student_ids: parents.studentIdsForParent(db, p.id) };
  }
  const u = db.prepare(`
    SELECT u.id, u.full_name, u.username, u.staff_id, u.must_change_password,
           d.name AS designation
    FROM users u LEFT JOIN designations d ON d.id = u.designation_id
    WHERE u.id = ? AND u.is_active = 1
  `).get(subject.subject_id);
  if (!u) return null;
  const perms = resolveEffectivePermissions(db, u.id);
  const isAdmin = ['Proprietor', 'Administrator'].includes(u.designation);
  return { role: 'staff', user: u, designation: u.designation, is_admin: isAdmin, permissions: perms };
}

function can(ctx, module, action = 'view') {
  if (!ctx || ctx.role !== 'staff') return false;
  if (ctx.is_admin) return true;
  const p = ctx.permissions[module];
  if (!p) return false;
  const map = { view: 'canView', create: 'canCreate', edit: 'canEdit', delete: 'canDelete' };
  return !!p[map[action] || 'canView'];
}

// Permissions say whether an account may touch a module at all. This says
// WHOSE class — the rule the desktop enforces through `_scope.js`, which this
// server was ignoring: a Subject Teacher signing in over the Wi-Fi was handed
// every class in the school. One resolver, both surfaces.

// ── data helpers (read straight from the canonical DB) ──
function childSummary(db, studentId) {
  const s = db.prepare(`
    SELECT s.id, s.surname, s.first_name, s.other_names, s.index_number, s.photo_path,
           c.name AS class_name,
           (SELECT TRIM(st.surname || ' ' || st.first_name) FROM staff_assignments sa
              JOIN staff st ON st.id = sa.staff_id
             WHERE sa.class_group_id = c.id AND sa.is_class_teacher = 1
             LIMIT 1) AS class_teacher
    FROM students s
    LEFT JOIN class_groups c ON c.id = s.current_class_id WHERE s.id = ?
  `).get(studentId);
  if (!s) return null;
  const term = db.prepare('SELECT * FROM terms WHERE is_current = 1').get();
  // Voided bills are excluded everywhere a balance is shown. A bill the
  // school withdrew must never reach a parent's phone as money owed.
  const bill = term ? db.prepare("SELECT total_billed, total_paid, balance FROM student_bills WHERE student_id = ? AND term_id = ? AND COALESCE(status, 'active') = 'active'").get(studentId, term.id) : null;
  const rate = parseFloat(getSetting(db, 'canteen_daily_rate', '5'));
  const canteenUnpaid = term ? db.prepare(`
    SELECT COUNT(*) c FROM school_calendar sc
    LEFT JOIN canteen_day_status cds ON cds.date = sc.date AND cds.student_id = ?
    WHERE sc.term_id = ? AND sc.day_type = 'school_day' AND (cds.status IS NULL OR cds.status = 'unpaid')
  `).get(studentId, term.id).c : 0;
  return {
    id: s.id, name: `${s.surname} ${s.first_name} ${s.other_names || ''}`.trim(),
    index_number: s.index_number, class_name: s.class_name,
    // The child's own face. It was on the school's disk all along; the API
    // simply never sent it, so every parent saw a coloured circle with two
    // letters in it where their child should have been.
    photo: media.dataUri(s.photo_path),
    class_teacher: s.class_teacher || null,
    fees: {
      billed: bill?.total_billed || 0, paid: bill?.total_paid || 0, balance: bill?.balance || 0,
      // What was carried in from last term, and what the books cost. A parent
      // asking "why is this more than the term's fee?" is asking about these.
      arrears: bill?.arrears_from_prev || 0,
      discount: bill?.discount_amount || 0,
      books_total: bill?.books_total || 0,
      books_paid: bill?.books_paid || 0,
      books_balance: Math.max(0, (bill?.books_total || 0) - (bill?.books_paid || 0)),
    },
    canteen: { unpaid_days: canteenUnpaid, amount_owed: canteenUnpaid * rate, daily_rate: rate },
    term: term ? { id: term.id, label: term.label } : null,
  };
}

// ── one shape for "who is this pupil" ──
// The parent's printable profile and the teacher's record were drifting apart
// field by field, which is how a school ends up with two documents that
// disagree about a child's date of birth. Both read this.
//
// Only what a school would put on a profile sheet: identity, class, contacts.
// No fee figure, no mark, no note about the family — those have their own
// routes with their own permission checks.
function studentProfile(db, s) {
  if (!s) return null;
  return {
    id: s.id,
    name: `${s.surname} ${s.first_name} ${s.other_names || ''}`.trim(),
    surname: s.surname, first_name: s.first_name, other_names: s.other_names || null,
    index_number: s.index_number,
    roll_number: s.roll_number || null,
    class_name: s.class_name || null,
    gender: s.gender, age: s.age,
    date_of_birth: s.date_of_birth, place_of_birth: s.place_of_birth,
    denomination: s.denomination, nhis_number: s.nhis_number,
    place_of_residence: s.place_of_residence, street_address: s.street_address,
    house_number: s.house_number, digital_address: s.digital_address,
    admission_date: s.admission_date, admission_year: s.admission_year,
    status: s.status,
    photo: media.dataUri(s.photo_path),
    guardians: [
      { relation: 'Father', name: s.father_name, contact: s.father_contact },
      { relation: 'Mother', name: s.mother_name, contact: s.mother_contact },
      { relation: 'Guardian', name: s.guardian_name, contact: s.guardian_contact },
    ].filter(g => g.name || g.contact),
  };
}

// ── The documents the apps print ────────────────────────────────────────────
// The desktop's own report generator (electron/ipc/reports.js) builds these.
// The phone and the browser hold no templates: they ask for the string and
// print it verbatim, so a report card printed at the school gate is identical
// to the one the office prints — same layout, same crest, same signatures.
//
// `getResourcePath` is how the generator finds the bundled fallback logo. On a
// host started outside Electron (a test, a headless run) it resolves against
// the repo's own resources folder rather than throwing.
function printableDocs() {
  try { return require('../ipc/reports'); } catch (_) { return null; }
}

function resourcePathFor(opts) {
  if (opts && typeof opts.getResourcePath === 'function') return opts.getResourcePath;
  const path = require('path');
  const base = process.resourcesPath
    ? path.join(process.resourcesPath, 'resources')
    : path.resolve(__dirname, '..', '..', 'resources');
  return (name) => path.join(base, name);
}

function createApiServer(db, opts = {}) {
  const routes = [];
  const getResourcePath = resourcePathFor(opts);

  // Both print routes answer HTML, not JSON: the client hands the string
  // straight to the printer. `html()` exists so they are not squeezed through
  // the JSON writer.
  const html = (res, code, body) => {
    res.writeHead(code, {
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  };
  // `public: true` marks a route reachable without a bearer token. It used to
  // be inferred by scanning the pattern for segments named health/info/login/
  // register, which would silently expose any future route that happened to
  // contain one of those words. Authentication is now opt-out, per route.
  const add = (method, pattern, handler, routeOpts = {}) =>
    routes.push({ method, parts: pattern.split('/').filter(Boolean), handler, public: !!routeOpts.public });

  const match = (parts, reqParts) => {
    if (parts.length !== reqParts.length) return null;
    const params = {};
    for (let i = 0; i < parts.length; i++) {
      if (parts[i][0] === ':') params[parts[i].slice(1)] = decodeURIComponent(reqParts[i]);
      else if (parts[i] !== reqParts[i]) return null;
    }
    return params;
  };

  // The signed-in teacher's class/subject scope. Cheap enough per request —
  // a handful of rows — and always re-read, so an assignment changed in the
  // office takes effect on the next tap rather than the next sign-in.
  const scopeOf = (ctx) => scopeLib.scopeFor(db, ctx.user.id);

  // ── Public ──
  add('GET', `${API}/health`, async (ctx, req, res) => json(res, 200, { ok: true, name: getSetting(db, 'school_name', 'School'), api: 'v1' }), { public: true });
  add('GET', `${API}/info`, async (ctx, req, res) => json(res, 200, {
    ok: true,
    school: { name: getSetting(db, 'school_name', 'School'), motto: getSetting(db, 'school_motto', ''), phone: getSetting(db, 'school_phone_1', '') },
    parent_self_register: getSetting(db, 'mobile_parent_self_register', 'true') === 'true',
    // Money is never moved through this app. A balance is shown; settling it
    // happens with the school, in person or on WhatsApp, and `/branding` says
    // where. `online_payments: false` is kept in the shape so an older client
    // that still asks is told plainly rather than left guessing.
    online_payments: false,
    payment_currency: getSetting(db, 'payment_currency', 'GHS'),
  }), { public: true });

  // ── The school's identity ──
  // Its name, its crest and the ways it can be reached. Public, and reachable
  // before sign-in, because the login screen is the first place a parent should
  // recognise their own school rather than a generic blue box.
  //
  // The crest travels as a data URI (see server/media.js). Contact details are
  // what the "Message the school" button and every "settle this balance"
  // prompt resolve to, so they are computed in one place here rather than in
  // four screens that would drift apart.
  add('GET', `${API}/branding`, async (ctx, req, res) => {
    const phone = getSetting(db, 'school_phone_1', '');
    const whatsapp = getSetting(db, 'school_whatsapp', '') || phone;
    return json(res, 200, {
      ok: true,
      school: {
        name: getSetting(db, 'school_name', 'School'),
        short_name: getSetting(db, 'school_abbreviation', ''),
        motto: getSetting(db, 'school_motto', ''),
        type: getSetting(db, 'school_type', ''),
        address: getSetting(db, 'school_address', '') || getSetting(db, 'school_location', ''),
        digital_address: getSetting(db, 'school_digital_address', ''),
        website: getSetting(db, 'school_website', ''),
      },
      contact: {
        phone,
        phone_alt: getSetting(db, 'school_phone_2', ''),
        email: getSetting(db, 'school_email', ''),
        whatsapp,
      },
      logo: media.logoUri(db, getSetting),
      currency: getSetting(db, 'payment_currency', 'GHS'),
    });
  }, { public: true });

  add('POST', `${API}/auth/login`, async (ctx, req, res, params, body, ip) => {
    if (rateLimited(ip, body.username)) return json(res, 429, { ok: false, error: 'Too many attempts. Try again shortly.' });
    let bcrypt; try { bcrypt = require('bcryptjs'); } catch { return json(res, 500, { ok: false, error: 'auth unavailable' }); }
    const u = db.prepare(`
      SELECT u.*, d.name AS designation FROM users u LEFT JOIN designations d ON d.id = u.designation_id
      WHERE u.username = ? AND u.is_active = 1
    `).get(body.username);
    if (!u || !u.password_hash || !bcrypt.compareSync(String(body.password || ''), u.password_hash)) {
      return json(res, 401, { ok: false, error: 'Invalid username or password.' });
    }
    const t = tokens.issueToken(db, 'user', u.id, { deviceName: body.device, platform: body.platform });
    return json(res, 200, { ok: true, token: t.token, expires_at: t.expires_at,
      user: { id: u.id, full_name: u.full_name, designation: u.designation, role: 'staff' } });
  }, { public: true });

  // Passwords, for a phone on the school Wi-Fi. The same module the desktop's
  // own screens use (electron/server/passwords.js), so a rule cannot hold in
  // one place and not the other. Raising a request and redeeming a code both
  // happen before sign-in, so neither can require a token; approving is not
  // here at all, because an Administrator does that on the desktop.
  add('POST', `${API}/auth/password-reset/request`, async (ctx, req, res, params, body, ip) => {
    if (rateLimited(ip, body.username)) return json(res, 429, { ok: false, error: 'Too many attempts. Try again shortly.' });
    return json(res, 200, passwords.requestReset(db, {
      username: body.username, reason: body.reason, source: body.source || 'mobile',
    }));
  }, { public: true });

  add('POST', `${API}/auth/password-reset/status`, async (ctx, req, res, params, body, ip) => {
    if (rateLimited(ip, body.username)) return json(res, 429, { ok: false, error: 'Too many attempts. Try again shortly.' });
    return json(res, 200, passwords.resetStatus(db, { username: body.username }));
  }, { public: true });

  add('POST', `${API}/auth/password-reset/complete`, async (ctx, req, res, params, body, ip) => {
    if (rateLimited(ip, body.username)) return json(res, 429, { ok: false, error: 'Too many attempts. Try again shortly.' });
    const r = passwords.completeReset(db, {
      username: body.username, code: body.code, newPassword: body.newPassword,
    });
    return json(res, r.ok ? 200 : 400, r);
  }, { public: true });

  add('POST', `${API}/auth/parent/register`, async (ctx, req, res, params, body, ip) => {
    if (rateLimited(ip, body.phone || body.email)) return json(res, 429, { ok: false, error: 'Too many attempts.' });
    if (getSetting(db, 'mobile_parent_self_register', 'true') !== 'true') {
      return json(res, 403, { ok: false, error: 'Self-registration is disabled. Ask the school to register you.' });
    }
    const r = parents.registerParent(db, body);
    if (!r.ok) return json(res, 400, r);
    const t = tokens.issueToken(db, 'parent', r.parent_id, { deviceName: body.device, platform: body.platform });
    return json(res, 200, { ok: true, token: t.token, expires_at: t.expires_at, linked: r.linked });
  }, { public: true });

  add('POST', `${API}/auth/parent/login`, async (ctx, req, res, params, body, ip) => {
    if (rateLimited(ip, body.identifier)) return json(res, 429, { ok: false, error: 'Too many attempts.' });
    const r = parents.loginParent(db, body);
    if (!r.ok) return json(res, 401, r);
    const t = tokens.issueToken(db, 'parent', r.parent.id, { deviceName: body.device, platform: body.platform });
    return json(res, 200, { ok: true, token: t.token, expires_at: t.expires_at, parent: r.parent });
  }, { public: true });

  // ── One sign-in box ──
  // The app used to ask "are you a parent or a member of staff?" before it
  // asked who you were. Nobody has ever had to answer that at the school gate,
  // and getting it wrong reads as a wrong password. The credential decides:
  // a staff username is matched first, then a parent's phone or email, and the
  // reply says which surface it belongs to.
  //
  // Order matters. Usernames and phone numbers live in different tables and a
  // school could conceivably issue a username that looks like a phone number,
  // so staff are tried first and a match ends it — an account is never
  // authenticated twice against two different passwords.
  add('POST', `${API}/auth/signin`, async (ctx, req, res, params, body, ip) => {
    const identifier = String(body.identifier || body.username || '').trim();
    if (rateLimited(ip, identifier)) return json(res, 429, { ok: false, error: 'Too many attempts. Try again shortly.' });
    if (!identifier || !body.password) return json(res, 400, { ok: false, error: 'Enter your username or phone, and your password.' });

    let bcrypt = null;
    try { bcrypt = require('bcryptjs'); } catch (_) {}
    if (bcrypt) {
      const u = db.prepare(`
        SELECT u.*, d.name AS designation FROM users u LEFT JOIN designations d ON d.id = u.designation_id
        WHERE u.username = ? AND u.is_active = 1
      `).get(identifier);
      if (u && u.password_hash && bcrypt.compareSync(String(body.password), u.password_hash)) {
        const t = tokens.issueToken(db, 'user', u.id, { deviceName: body.device, platform: body.platform });
        return json(res, 200, {
          ok: true, role: 'staff', token: t.token, expires_at: t.expires_at,
          user: { id: u.id, full_name: u.full_name, designation: u.designation, role: 'staff' },
        });
      }
    }

    const r = parents.loginParent(db, { identifier, password: body.password });
    if (r.ok) {
      const t = tokens.issueToken(db, 'parent', r.parent.id, { deviceName: body.device, platform: body.platform });
      return json(res, 200, { ok: true, role: 'parent', token: t.token, expires_at: t.expires_at, parent: r.parent });
    }

    // Deliberately one message for both tables. Saying "that username exists
    // but the password is wrong" tells an outsider which of the school's
    // accounts are real.
    return json(res, 401, { ok: false, error: 'Those details did not match an account. Check and try again.' });
  }, { public: true });

  // ── Authed ──
  add('GET', `${API}/me`, async (ctx, req, res) => {
    if (ctx.role === 'parent') {
      return json(res, 200, {
        ok: true, role: 'parent', parent: ctx.parent, children: ctx.student_ids.length,
        school: { name: getSetting(db, 'school_name', 'School') },
      });
    }
    // The signed-in person's own photograph, for the chrome. One small read,
    // once per cold start, and it is the difference between a teacher seeing
    // themselves in the corner of their app and seeing two letters.
    let photo = null;
    try {
      const row = ctx.user.staff_id
        ? db.prepare('SELECT photo_path FROM staff WHERE id = ?').get(ctx.user.staff_id)
        : db.prepare('SELECT photo_path FROM users WHERE id = ?').get(ctx.user.id);
      photo = media.dataUri(row && row.photo_path);
    } catch (_) {}

    return json(res, 200, {
      ok: true, role: 'staff', user: ctx.user, designation: ctx.designation,
      is_admin: ctx.is_admin, permissions: ctx.permissions, photo,
      // The app's chrome names the school. Without this the browser build
      // headed a teacher's screen "Nickland Edusoft" rather than their own
      // school, which the cloud's /staff/me has always returned.
      school: { name: getSetting(db, 'school_name', 'School') },
      // So the phone insists on a new password before anything else, the same
      // way the desktop's login screen does.
      must_change_password: !!ctx.user.must_change_password,
    });
  });

  add('POST', `${API}/auth/password`, async (ctx, req, res, params, body) => {
    // Staff only: a parent's password lives in the parents table and has its
    // own route. `ctx.user` is whoever the bearer token resolved to, so this
    // can never be pointed at somebody else's account.
    if (!ctx || ctx.role !== 'staff') return json(res, 403, { ok: false, error: 'Access denied.' });
    const r = passwords.changeOwnPassword(db, ctx.user.id, {
      oldPassword: body.currentPassword ?? body.oldPassword,
      newPassword: body.newPassword,
      source: body.source || 'mobile',
    });
    return json(res, r.ok ? 200 : 400, r);
  });

  add('POST', `${API}/auth/logout`, async (ctx, req, res, params, body, ip, tokenId) => {
    if (tokenId) tokens.revokeToken(db, tokenId);
    return json(res, 200, { ok: true });
  });

  // Parent endpoints
  add('GET', `${API}/parent/children`, async (ctx, req, res) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    return json(res, 200, { ok: true, children: ctx.student_ids.map(id => childSummary(db, id)).filter(Boolean) });
  });

  add('GET', `${API}/parent/children/:id`, async (ctx, req, res, params) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const sid = parseInt(params.id, 10);
    if (!ctx.student_ids.includes(sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    const summary = childSummary(db, sid);
    const payments = db.prepare(`
      SELECT amount, payment_date, payment_method, receipt_number FROM payments
      WHERE student_id = ? AND is_reversed = 0 ORDER BY payment_date DESC LIMIT 20
    `).all(sid);
    // Attendance is reported for the CURRENT TERM. The term was looked up but
    // never used in the filter, so parents were shown a running total across
    // every term the child had ever attended.
    const term = db.prepare('SELECT id FROM terms WHERE is_current = 1').get();
    const attendance = term ? db.prepare(`
      SELECT COUNT(*) FILTER (WHERE status='present') AS present,
             COUNT(*) FILTER (WHERE status='absent') AS absent, COUNT(*) AS total
      FROM student_attendance WHERE student_id = ? AND term_id = ?
    `).get(sid, term.id) : { present: 0, absent: 0, total: 0 };
    return json(res, 200, { ok: true, child: summary, payments, attendance });
  });

  // Child academic performance (report) — current or specified term.
  add('GET', `${API}/parent/children/:id/report`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const sid = parseInt(params.id, 10);
    if (!ctx.student_ids.includes(sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    const term = query.termId
      ? db.prepare('SELECT * FROM terms WHERE id = ?').get(query.termId)
      : db.prepare('SELECT * FROM terms WHERE is_current = 1').get();
    if (!term) return json(res, 200, { ok: true, term: null, subjects: [], summary: null });
    const subjects = db.prepare(`
      SELECT sub.name AS subject, sc.class_score, sc.exam_score, sc.total_score, sc.grade_remark
      FROM scores sc JOIN subjects sub ON sub.id = sc.subject_id
      WHERE sc.student_id = ? AND sc.term_id = ? ORDER BY sub.name
    `).all(sid, term.id);
    const summary = db.prepare('SELECT * FROM student_term_summary WHERE student_id = ? AND term_id = ?').get(sid, term.id);
    // Everything a report card is actually made of, so the app can lay one out
    // and print it rather than showing a bare list of numbers: the grading
    // scale the marks are read against, the term's attendance, and the header
    // any printed copy has to carry.
    const bands = db.prepare('SELECT min_score, max_score, remark FROM grading_bands ORDER BY display_order, min_score DESC').all();
    const attendance = db.prepare(`
      SELECT COUNT(*) FILTER (WHERE status='present') AS present,
             COUNT(*) FILTER (WHERE status='absent') AS absent,
             COUNT(*) AS total
      FROM student_attendance WHERE student_id = ? AND term_id = ?
    `).get(sid, term.id) || { present: 0, absent: 0, total: 0 };
    const child = childSummary(db, sid);
    return json(res, 200, {
      ok: true,
      term: { id: term.id, label: term.label },
      student: child ? {
        id: child.id, name: child.name, index_number: child.index_number,
        class_name: child.class_name, photo: child.photo, class_teacher: child.class_teacher,
      } : null,
      subjects,
      summary: summary || null,
      grading_bands: bands,
      attendance,
      school: {
        name: getSetting(db, 'school_name', 'School'),
        motto: getSetting(db, 'school_motto', ''),
        address: getSetting(db, 'school_address', '') || getSetting(db, 'school_location', ''),
        phone: getSetting(db, 'school_phone_1', ''),
        email: getSetting(db, 'school_email', ''),
        logo: media.logoUri(db, getSetting),
      },
      dates: {
        vacation: getSetting(db, 'vacation_date', ''),
        reopening: getSetting(db, 'reopening_date', ''),
        exam_title: getSetting(db, 'current_exam_title', ''),
      },
    });
  });

  // ── Settling a balance ──
  // There is deliberately no way to move money through this app. The old build
  // carried two: a card/mobile-money checkout, and a "tell the school what you
  // paid" form that created a pending intent somebody at the office then had to
  // reconcile by hand. Both are gone. A school takes payment the way it always
  // has — at the office, or over WhatsApp with the bursar — and the app's job
  // is to show the figure correctly and say exactly who to talk to.
  //
  // So this route settles nothing. It answers the question the parent actually
  // has: how much, for what, and who do I contact. The client turns the reply
  // into a WhatsApp message with the child's name and balance already written.
  add('GET', `${API}/parent/children/:id/settle`, async (ctx, req, res, params) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const sid = parseInt(params.id, 10);
    if (!ctx.student_ids.includes(sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    const child = childSummary(db, sid);
    if (!child) return json(res, 404, { ok: false, error: 'Child not found.' });
    const phone = getSetting(db, 'school_phone_1', '');
    return json(res, 200, {
      ok: true,
      child: { id: child.id, name: child.name, class_name: child.class_name, index_number: child.index_number },
      owed: {
        fees: child.fees.balance || 0,
        canteen: child.canteen.amount_owed || 0,
        books: child.fees.books_balance || 0,
        total: (child.fees.balance || 0) + (child.canteen.amount_owed || 0),
      },
      term: child.term,
      contact: {
        school: getSetting(db, 'school_name', 'the school'),
        phone,
        whatsapp: getSetting(db, 'school_whatsapp', '') || phone,
        email: getSetting(db, 'school_email', ''),
        address: getSetting(db, 'school_address', '') || getSetting(db, 'school_location', ''),
      },
      instructions: 'Payments are arranged with the school directly. Send a message or call, and the office will confirm the amount and how to pay.',
    });
  });

  // ── The bill, itemised ──
  // A balance with no breakdown is an argument waiting to happen. This is the
  // term's bill line by line, what has been paid against it, what was carried
  // forward from a previous term, and the books — the four things a parent
  // queries at the gate.
  add('GET', `${API}/parent/children/:id/fees`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const sid = parseInt(params.id, 10);
    if (!ctx.student_ids.includes(sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    const term = query.termId
      ? db.prepare('SELECT * FROM terms WHERE id = ?').get(query.termId)
      : db.prepare('SELECT * FROM terms WHERE is_current = 1').get();

    const bill = term ? db.prepare(`
      SELECT * FROM student_bills
      WHERE student_id = ? AND term_id = ? AND COALESCE(status, 'active') = 'active'
    `).get(sid, term.id) : null;

    const items = bill ? db.prepare(`
      SELECT description, amount, is_arrear FROM bill_line_items
      WHERE student_bill_id = ? ORDER BY is_arrear, item_number, id
    `).all(bill.id) : [];

    // Every fee payment ever made for this child, newest first. Not capped at
    // the current term: "what did we pay last year?" is a fair question and the
    // app had no answer to it.
    const payments = db.prepare(`
      SELECT p.receipt_number, p.payment_date, p.payment_method, p.amount, p.reference,
             t.label AS term_label
      FROM payments p LEFT JOIN terms t ON t.id = p.term_id
      WHERE p.student_id = ? AND p.is_reversed = 0
      ORDER BY date(p.payment_date) DESC, p.id DESC LIMIT 120
    `).all(sid);

    // Term-by-term history, so a carry-forward can be traced to where it came
    // from rather than appearing from nowhere on this term's bill.
    const history = db.prepare(`
      SELECT t.label AS term_label, t.id AS term_id,
             b.total_billed, b.total_paid, b.balance, b.arrears_from_prev
      FROM student_bills b JOIN terms t ON t.id = b.term_id
      WHERE b.student_id = ? AND COALESCE(b.status, 'active') = 'active'
      ORDER BY t.id DESC LIMIT 12
    `).all(sid);

    const books = db.prepare(`
      SELECT sb.total_amount, sb.total_paid, sb.balance, ay.label AS year_label
      FROM student_books sb LEFT JOIN academic_years ay ON ay.id = sb.academic_year_id
      WHERE sb.student_id = ? ORDER BY sb.academic_year_id DESC LIMIT 1
    `).get(sid) || null;
    const bookItems = books ? db.prepare(`
      SELECT bi.title, bi.amount FROM student_books_items bi
      JOIN student_books sb ON sb.id = bi.student_books_id
      WHERE sb.student_id = ? ORDER BY bi.display_order, bi.id
    `).all(sid) : [];

    return json(res, 200, {
      ok: true,
      term: term ? { id: term.id, label: term.label } : null,
      bill: bill ? {
        total_billed: bill.total_billed || 0,
        total_paid: bill.total_paid || 0,
        balance: bill.balance || 0,
        arrears_from_prev: bill.arrears_from_prev || 0,
        discount_amount: bill.discount_amount || 0,
        discount_reason: bill.discount_reason || null,
      } : null,
      items, payments, history,
      books: books ? { ...books, items: bookItems } : null,
    });
  });

  // ── The canteen, day by day ──
  // How many days are unpaid, what that comes to, and every collection the
  // school has recorded against the child.
  add('GET', `${API}/parent/children/:id/canteen`, async (ctx, req, res, params) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const sid = parseInt(params.id, 10);
    if (!ctx.student_ids.includes(sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    const term = db.prepare('SELECT * FROM terms WHERE is_current = 1').get();
    const rate = parseFloat(getSetting(db, 'canteen_daily_rate', '5'));
    const days = term ? db.prepare(`
      SELECT sc.date, COALESCE(cds.status, 'unpaid') AS status
      FROM school_calendar sc
      LEFT JOIN canteen_day_status cds ON cds.date = sc.date AND cds.student_id = ?
      WHERE sc.term_id = ? AND sc.day_type = 'school_day' AND date(sc.date) <= date('now')
      ORDER BY date(sc.date) DESC LIMIT 90
    `).all(sid, term.id) : [];
    const payments = db.prepare(`
      SELECT payment_date, amount, days_covered, start_date, end_date, notes
      FROM canteen_payments WHERE student_id = ?
      ORDER BY date(payment_date) DESC, id DESC LIMIT 60
    `).all(sid);
    const unpaid = days.filter(d => d.status === 'unpaid').length;
    return json(res, 200, {
      ok: true, daily_rate: rate,
      term: term ? { id: term.id, label: term.label } : null,
      unpaid_days: unpaid, amount_owed: unpaid * rate,
      paid_days: days.filter(d => d.status === 'paid').length,
      exempt_days: days.filter(d => d.status === 'exempt').length,
      days, payments,
    });
  });

  // ── Every report card the school has published for this child ──
  // A parent should be able to open last term's report, and the one before it,
  // without asking the office for a photocopy. The list names the terms; the
  // existing /report route serves any one of them by id.
  add('GET', `${API}/parent/children/:id/reports`, async (ctx, req, res, params) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const sid = parseInt(params.id, 10);
    if (!ctx.student_ids.includes(sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    const terms = db.prepare(`
      SELECT t.id, t.label, sts.average_score, sts.class_rank, sts.number_on_roll,
             sts.days_present, sts.total_days,
             (SELECT COUNT(*) FROM scores sc WHERE sc.student_id = ? AND sc.term_id = t.id) AS subject_count
      FROM terms t
      LEFT JOIN student_term_summary sts ON sts.student_id = ? AND sts.term_id = t.id
      WHERE EXISTS (SELECT 1 FROM scores sc WHERE sc.student_id = ? AND sc.term_id = t.id)
      ORDER BY t.id DESC
    `).all(sid, sid, sid);
    return json(res, 200, { ok: true, terms });
  });

  // ── The register, as the parent sees it ──
  // A running total tells a parent nothing about a pattern. This is the term's
  // days one by one, so three Mondays missed in a row is visible as such.
  add('GET', `${API}/parent/children/:id/attendance`, async (ctx, req, res, params) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const sid = parseInt(params.id, 10);
    if (!ctx.student_ids.includes(sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    const term = db.prepare('SELECT * FROM terms WHERE is_current = 1').get();
    const days = term ? db.prepare(`
      SELECT date, status, notes FROM student_attendance
      WHERE student_id = ? AND term_id = ? ORDER BY date(date) DESC LIMIT 120
    `).all(sid, term.id) : [];
    const totals = {
      present: days.filter(d => d.status === 'present').length,
      absent: days.filter(d => d.status === 'absent').length,
      late: days.filter(d => d.status === 'late').length,
      total: days.length,
    };
    return json(res, 200, {
      ok: true, term: term ? { id: term.id, label: term.label } : null, days, totals,
    });
  });

  // ── The printable documents, exactly as the office prints them ──
  add('GET', `${API}/parent/children/:id/report.html`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const sid = parseInt(params.id, 10);
    if (!ctx.student_ids.includes(sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    const docs = printableDocs();
    if (!docs || !docs.reportCardDocument) return json(res, 501, { ok: false, error: 'This school\u2019s system cannot print report cards yet.' });
    const term = query.termId
      ? db.prepare('SELECT id FROM terms WHERE id = ?').get(parseInt(query.termId, 10))
      : db.prepare('SELECT id FROM terms WHERE is_current = 1').get();
    if (!term) return json(res, 404, { ok: false, error: 'No term to report on.' });
    let r;
    try { r = docs.reportCardDocument(db, getResourcePath, { studentId: sid, termId: term.id, colorMode: query.bw === '1' ? 'bw' : 'color' }); }
    catch (e) { return json(res, 500, { ok: false, error: 'Could not build the report card.' }); }
    if (!r.ok) return json(res, 404, r);
    return html(res, 200, r.document);
  });

  add('GET', `${API}/parent/children/:id/profile.html`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const sid = parseInt(params.id, 10);
    if (!ctx.student_ids.includes(sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    const docs = printableDocs();
    if (!docs || !docs.studentProfileDocument) return json(res, 501, { ok: false, error: 'This school\u2019s system cannot print profiles yet.' });
    let r;
    try { r = docs.studentProfileDocument(db, getResourcePath, sid, { colorMode: query.bw === '1' ? 'bw' : 'color' }); }
    catch (e) { return json(res, 500, { ok: false, error: 'Could not build the profile.' }); }
    if (!r.ok) return json(res, 404, r);
    return html(res, 200, r.document);
  });

  // ── Conduct: what the school has recorded about this child ──
  // Commendations and incidents both. A parent seeing only the good ones would
  // be a record worth nothing; a parent seeing only the bad ones is what makes
  // a portal something families dread opening. Health notes are included
  // because a parent is entitled to know what the school wrote down about
  // their child's wellbeing.
  add('GET', `${API}/parent/children/:id/conduct`, async (ctx, req, res, params) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const sid = parseInt(params.id, 10);
    if (!ctx.student_ids.includes(sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    let events = [];
    try {
      events = db.prepare(`
        SELECT se.id, se.event_type, se.title, se.description, se.date,
               u.full_name AS recorded_by_name
        FROM student_events se
        LEFT JOIN users u ON u.id = se.recorded_by
        WHERE se.student_id = ?
        ORDER BY date(se.date) DESC, se.id DESC LIMIT 60
      `).all(sid);
    } catch (_) {}
    return json(res, 200, { ok: true, events });
  });

  // ── The child's own record, for printing ──
  // The same details the school holds, so a parent can print a profile sheet
  // for a hospital form or a scholarship application without a trip to the
  // office. Nothing here is a figure the school treats as confidential.
  add('GET', `${API}/parent/children/:id/profile`, async (ctx, req, res, params) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const sid = parseInt(params.id, 10);
    if (!ctx.student_ids.includes(sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    const s = db.prepare(`
      SELECT s.*, c.name AS class_name FROM students s
      LEFT JOIN class_groups c ON c.id = s.current_class_id WHERE s.id = ?
    `).get(sid);
    if (!s) return json(res, 404, { ok: false, error: 'Child not found.' });
    return json(res, 200, { ok: true, student: studentProfile(db, s) });
  });

  // Notices, as one list. The app previously showed a parent only the SMS log —
  // so a school that posted a notice on the desktop found that parents on the
  // school Wi-Fi never saw it, while parents on the internet portal did. The
  // two sources are merged here and sorted together, which is what "Notices"
  // was always supposed to mean.
  add('GET', `${API}/parent/notifications`, async (ctx, req, res) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const contacts = [ctx.parent.phone, ctx.parent.email].filter(Boolean);
    const sent = contacts.length ? db.prepare(`
      SELECT channel, message_body, sent_at, delivery_status FROM notification_log
      WHERE recipient_contact IN (${contacts.map(() => '?').join(',')})
      ORDER BY sent_at DESC LIMIT 50
    `).all(...contacts) : [];

    // A notice aimed at one child is only for that child's people.
    const ids = ctx.student_ids || [];
    const scoped = ids.length ? `OR (a.audience = 'student' AND a.target_student_id IN (${ids.map(() => '?').join(',')}))` : '';
    const announcements = db.prepare(`
      SELECT a.id, a.title, a.body, a.created_at, a.audience,
             s.first_name || ' ' || s.surname AS student_name
      FROM announcements a
      LEFT JOIN students s ON s.id = a.target_student_id
      WHERE a.is_active = 1 AND (a.audience = 'all' OR a.audience = 'parents' ${scoped})
      ORDER BY datetime(a.created_at) DESC LIMIT 50
    `).all(...ids);

    const merged = [
      ...announcements.map(a => ({
        kind: 'notice', id: `a${a.id}`, title: a.title, body: a.body,
        student_name: a.student_name || null,
        at: a.created_at, channel: 'notice',
        message_body: a.title ? `${a.title} — ${a.body || ''}` : (a.body || ''),
        sent_at: a.created_at,
      })),
      ...sent.map((n, i) => ({
        kind: 'message', id: `n${i}`, title: null, body: n.message_body,
        at: n.sent_at, channel: n.channel,
        message_body: n.message_body, sent_at: n.sent_at,
        delivery_status: n.delivery_status,
      })),
    ].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

    return json(res, 200, { ok: true, notifications: merged, announcements });
  });

  // ── Messaging (parent side) ──
  add('GET', `${API}/parent/messages`, async (ctx, req, res) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const m = require('../ipc/messaging');
    return json(res, 200, { ok: true, threads: m.listThreadsForParent(db, ctx.parent.id) });
  });

  add('GET', `${API}/parent/messages/:id`, async (ctx, req, res, params) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const m = require('../ipc/messaging');
    const tid = parseInt(params.id, 10);
    const data = m.getThread(db, tid);
    if (!data || data.thread.parent_id !== ctx.parent.id) return json(res, 403, { ok: false, error: 'Not your thread.' });
    m.markThreadRead(db, tid, 'parent');
    return json(res, 200, { ok: true, ...data });
  });

  add('POST', `${API}/parent/messages`, async (ctx, req, res, params, body) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const m = require('../ipc/messaging');
    // A parent may only continue their own thread.
    if (body.threadId) {
      const existing = m.getThread(db, parseInt(body.threadId, 10));
      if (!existing || existing.thread.parent_id !== ctx.parent.id) return json(res, 403, { ok: false, error: 'Not your thread.' });
    }
    // Scope any student context to one of the parent's own children.
    const studentId = body.studentId && ctx.student_ids.includes(parseInt(body.studentId, 10)) ? parseInt(body.studentId, 10) : null;
    const r = m.postMessage(db, {
      threadId: body.threadId ? parseInt(body.threadId, 10) : null,
      parentId: ctx.parent.id, studentId, subject: body.subject,
      senderType: 'parent', senderName: ctx.parent.full_name, body: body.body,
    });
    if (!r.ok) return json(res, 400, r);
    return json(res, 200, r);
  });

  // Staff endpoints (role-scoped)
  add('GET', `${API}/dashboard`, async (ctx, req, res) => {
    if (!can(ctx, 'dashboard', 'view')) return json(res, 403, { ok: false, error: 'Access denied.' });
    const term = db.prepare('SELECT * FROM terms WHERE is_current = 1').get();
    const students = db.prepare("SELECT COUNT(*) c FROM students WHERE status='Active'").get().c;
    const staff = db.prepare("SELECT COUNT(*) c FROM staff WHERE status='Active'").get().c;
    let collected = 0, outstanding = 0;
    if (term && can(ctx, 'fees', 'view')) {
      collected = db.prepare('SELECT COALESCE(SUM(amount),0) t FROM payments WHERE term_id=? AND is_reversed=0').get(term.id).t;
      outstanding = db.prepare("SELECT COALESCE(SUM(balance),0) t FROM student_bills WHERE term_id=? AND COALESCE(status, 'active') = 'active'").get(term.id).t;
    }
    return json(res, 200, { ok: true, term: term ? { id: term.id, label: term.label } : null,
      metrics: { students, staff, fees_collected: collected, fees_outstanding: outstanding } });
  });

  add('GET', `${API}/students`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!can(ctx, 'students', 'view')) return json(res, 403, { ok: false, error: 'Access denied.' });
    let sql = `SELECT s.id, s.index_number, s.surname, s.first_name, s.gender, s.photo_path,
                      s.current_class_id, c.name AS class_name
               FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id WHERE s.status='Active'`;
    const p = [];
    if (query.classId) { sql += ' AND s.current_class_id = ?'; p.push(query.classId); }
    // The roll a teacher may read is the roll of the classes that are theirs.
    // Filtering in SQL rather than after the LIMIT, so a teacher of one class
    // is not handed the first 500 pupils in the school and then shown four.
    const visible = scopeLib.visibleClassIds(db, scopeOf(ctx));
    if (visible) {
      if (visible.size === 0) return json(res, 200, { ok: true, students: [] });
      sql += ` AND s.current_class_id IN (${[...visible].map(() => '?').join(',')})`;
      p.push(...visible);
    }
    if (query.q) {
      sql += ' AND (s.surname LIKE ? OR s.first_name LIKE ? OR s.other_names LIKE ? OR s.index_number LIKE ?)';
      const like = `%${String(query.q).slice(0, 60)}%`;
      p.push(like, like, like, like);
    }
    sql += ' ORDER BY s.surname, s.first_name LIMIT 500';
    const rows = db.prepare(sql).all(...p);

    // Photographs are opt-in and only for a single class. A roll of forty faces
    // is a couple of megabytes, which the school Wi-Fi carries happily; the
    // whole school's five hundred is not something to put on a phone by
    // accident, so a wider query gets names and initials.
    const wantPhotos = String(query.photos || '') === '1' && !!query.classId && rows.length <= 80;
    return json(res, 200, {
      ok: true,
      students: rows.map(({ photo_path, ...r }) => ({
        ...r,
        name: `${r.surname || ''} ${r.first_name || ''}`.trim(),
        has_photo: !!photo_path,
        photo: wantPhotos ? media.dataUri(photo_path) : undefined,
      })),
    });
  });

  add('GET', `${API}/fees/debtors`, async (ctx, req, res) => {
    if (!can(ctx, 'fees', 'view')) return json(res, 403, { ok: false, error: 'Access denied.' });
    const term = db.prepare('SELECT id FROM terms WHERE is_current = 1').get();
    if (!term) return json(res, 200, { ok: true, debtors: [] });
    const rows = db.prepare(`
      SELECT s.index_number, s.surname, s.first_name, c.name AS class_name, b.balance
      FROM student_bills b JOIN students s ON s.id = b.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE b.term_id = ? AND b.balance > 0 AND s.status='Active'
        AND COALESCE(b.status, 'active') = 'active'
      ORDER BY b.balance DESC LIMIT 300
    `).all(term.id);
    return json(res, 200, { ok: true, debtors: rows });
  });

  // ── Classes list (for teacher pickers: attendance / scores / canteen) ──
  add('GET', `${API}/classes`, async (ctx, req, res) => {
    if (!can(ctx, 'students', 'view') && !can(ctx, 'academics', 'view') && !can(ctx, 'canteen', 'view')) {
      return json(res, 403, { ok: false, error: 'Access denied.' });
    }
    const scope = scopeOf(ctx);
    const visible = scopeLib.visibleClassIds(db, scope);
    let classes = db.prepare('SELECT id, name, short_code FROM class_groups ORDER BY level_order, name').all();
    // A teacher is not offered Basic 6 and then told access denied on choosing
    // it. `null` means unrestricted — a head teacher sees the whole school.
    if (visible) classes = classes.filter(c => visible.has(Number(c.id)));
    return json(res, 200, {
      ok: true,
      classes: classes.map(c => ({ ...c, is_class_teacher: scopeLib.isClassTeacherOf(scope, c.id) })),
    });
  });

  // ── Attendance register: roster for a class on a date, with any marks set ──
  add('GET', `${API}/attendance`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!can(ctx, 'students', 'view') && !can(ctx, 'academics', 'view')) return json(res, 403, { ok: false, error: 'Access denied.' });
    const classId = parseInt(query.classId, 10);
    const date = query.date;
    if (!classId || !date) return json(res, 400, { ok: false, error: 'classId and date are required.' });
    // The register belongs to the class teacher; a subject teacher who takes
    // one lesson in the class does not mark who is in school that day.
    if (!scopeLib.canAccessClass(scopeOf(ctx), classId)) return json(res, 403, { ok: false, error: 'That class is not yours.' });
    const students = db.prepare(`
      SELECT id, index_number, surname, first_name, other_names
      FROM students WHERE current_class_id = ? AND status = 'Active'
      ORDER BY surname, first_name
    `).all(classId);
    const ph = students.map(() => '?').join(',') || 'NULL';
    const att = db.prepare(`
      SELECT student_id, status, notes FROM student_attendance
      WHERE date = ? AND student_id IN (${ph})
    `).all(date, ...students.map(s => s.id));
    const attMap = Object.fromEntries(att.map(a => [a.student_id, a]));
    return json(res, 200, {
      ok: true,
      students: students.map(s => ({
        id: s.id, index_number: s.index_number,
        name: `${s.surname} ${s.first_name} ${s.other_names || ''}`.trim(),
        status: attMap[s.id]?.status || null,
        notes: attMap[s.id]?.notes || null,
      })),
    });
  });

  add('POST', `${API}/attendance`, async (ctx, req, res, params, body) => {
    if (!can(ctx, 'students', 'edit') && !can(ctx, 'academics', 'edit')) return json(res, 403, { ok: false, error: 'Access denied.' });
    const { date, marks } = body; // marks: [{ student_id, status, notes }]
    if (!date || !Array.isArray(marks)) return json(res, 400, { ok: false, error: 'date and marks[] required.' });
    // A mark carries a pupil id and nothing else, so the class has to be
    // resolved from the pupil before it can be checked. Refuse the whole batch
    // rather than silently dropping the rows that fall outside: a register
    // that saves "some of it" is worse than one that says no.
    {
      const scope = scopeOf(ctx);
      for (const m of marks) {
        if (!scopeLib.canAccessStudent(db, scope, parseInt(m.student_id, 10))) {
          return json(res, 403, { ok: false, error: 'That class is not yours.' });
        }
      }
    }
    const term = db.prepare('SELECT id FROM terms WHERE is_current = 1').get();
    const up = db.prepare(`
      INSERT INTO student_attendance (student_id, date, status, marked_by, term_id, notes)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (student_id, date) DO UPDATE SET
        status = excluded.status, marked_by = excluded.marked_by, notes = excluded.notes
    `);
    let n = 0;
    const tx = db.transaction(() => {
      for (const m of marks) {
        const status = m.status || 'present';
        const notes = status === 'absent' ? (m.notes || null) : null;
        up.run(m.student_id, date, status, ctx.user.id, term?.id || null, notes);
        n++;
      }
    });
    try { tx(); } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
    try {
      const { enqueueStudentSnapshot } = require('./sync/outbox');
      for (const m of marks) enqueueStudentSnapshot(db, m.student_id);
      // …and the class roster, so a teacher who marks in the staff room and
      // then checks from home sees the register they just took.
      require('./sync/staff_projection').enqueueRostersForStudents(db, marks.map(m => m.student_id));
    } catch (_) {}
    return json(res, 200, { ok: true, saved: n });
  });

  // ── Score entry: subjects mapped to a class ──
  add('GET', `${API}/scores/subjects`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!can(ctx, 'academics', 'view')) return json(res, 403, { ok: false, error: 'Access denied.' });
    const classId = parseInt(query.classId, 10);
    if (!classId) return json(res, 400, { ok: false, error: 'classId is required.' });
    if (!scopeLib.canAccessClass(scopeOf(ctx), classId)) return json(res, 403, { ok: false, error: 'That class is not yours.' });
    let subjects = db.prepare(`
      SELECT s.id, s.name, s.code FROM subjects s
      JOIN class_subjects cs ON cs.subject_id = s.id
      WHERE cs.class_group_id = ? AND s.is_active = 1 ORDER BY s.name
    `).all(classId);
    if (subjects.length === 0) subjects = db.prepare('SELECT id, name, code FROM subjects WHERE is_active = 1 ORDER BY name').all();
    // A subject teacher visiting a class sees their subject and no other.
    const allowed = scopeLib.visibleSubjectIds(db, scopeOf(ctx), classId);
    if (allowed) subjects = subjects.filter(s => allowed.has(Number(s.id)));
    return json(res, 200, { ok: true, subjects });
  });

  // ── Score entry: roster + current exam marks for a class+subject (current term) ──
  add('GET', `${API}/scores`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!can(ctx, 'academics', 'view')) return json(res, 403, { ok: false, error: 'Access denied.' });
    const classId = parseInt(query.classId, 10);
    const subjectId = parseInt(query.subjectId, 10);
    if (!classId || !subjectId) return json(res, 400, { ok: false, error: 'classId and subjectId are required.' });
    if (!scopeLib.canAccessSubject(scopeOf(ctx), classId, subjectId)) {
      return json(res, 403, { ok: false, error: 'That subject is not yours in this class.' });
    }
    const term = db.prepare('SELECT id, label FROM terms WHERE is_current = 1').get();
    if (!term) return json(res, 200, { ok: true, term: null, students: [] });
    const students = db.prepare(`
      SELECT id, index_number, surname, first_name, other_names
      FROM students WHERE current_class_id = ? AND status = 'Active'
      ORDER BY surname, first_name
    `).all(classId);
    const scoreMap = Object.fromEntries(
      db.prepare('SELECT student_id, exam_score, total_score FROM scores WHERE term_id = ? AND subject_id = ?')
        .all(term.id, subjectId).map(r => [r.student_id, r])
    );
    return json(res, 200, {
      ok: true, term: { id: term.id, label: term.label },
      students: students.map(s => ({
        id: s.id, index_number: s.index_number,
        name: `${s.surname} ${s.first_name} ${s.other_names || ''}`.trim(),
        exam_score: scoreMap[s.id]?.exam_score ?? null,
        total_score: scoreMap[s.id]?.total_score ?? null,
      })),
    });
  });

  // ── Score entry: save raw exam marks (0–100) for a class+subject ──
  add('POST', `${API}/scores`, async (ctx, req, res, params, body) => {
    if (!can(ctx, 'academics', 'edit')) return json(res, 403, { ok: false, error: 'Access denied.' });
    const subjectId = parseInt(body.subjectId, 10);
    const marks = body.marks; // [{ student_id, exam_score }]
    if (!subjectId || !Array.isArray(marks)) return json(res, 400, { ok: false, error: 'subjectId and marks[] required.' });
    const term = db.prepare('SELECT id FROM terms WHERE is_current = 1').get();
    if (!term) return json(res, 400, { ok: false, error: 'No current term is set.' });
    {
      const scope = scopeOf(ctx);
      for (const m of marks) {
        const cid = scopeLib.classOfStudent(db, parseInt(m.student_id, 10));
        if (!cid || !scopeLib.canAccessSubject(scope, cid, subjectId)) {
          return json(res, 403, { ok: false, error: 'That subject is not yours in this class.' });
        }
      }
    }
    const { saveExamMark } = require('../ipc/scores');
    let n = 0;
    try {
      const tx = db.transaction(() => {
        for (const m of marks) {
          if (m.exam_score === '' || m.exam_score == null) continue;
          const v = Number(m.exam_score);
          if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error('Exam scores must be between 0 and 100.');
          saveExamMark(db, { studentId: m.student_id, subjectId, termId: term.id, examScore: v });
          n++;
        }
      });
      tx();
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
    try { require('./sync/staff_projection').enqueueRostersForStudents(db, marks.map(m => m.student_id)); } catch (_) {}
    return json(res, 200, { ok: true, saved: n });
  });

  // ── Canteen: a student's collection summary (current term) ──
  add('GET', `${API}/canteen/student/:id`, async (ctx, req, res, params) => {
    if (!can(ctx, 'canteen', 'view')) return json(res, 403, { ok: false, error: 'Access denied.' });
    const sid = parseInt(params.id, 10);
    const s = db.prepare(`
      SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names, c.name AS class_name
      FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE s.id = ? AND s.status = 'Active'
    `).get(sid);
    if (!s) return json(res, 404, { ok: false, error: 'Student not found.' });
    // Which pupils are in another class is not this teacher's to learn either,
    // so an out-of-scope lookup answers not-found rather than forbidden.
    if (!scopeLib.canAccessStudent(db, scopeOf(ctx), sid)) return json(res, 404, { ok: false, error: 'Student not found.' });
    const term = db.prepare('SELECT id, label FROM terms WHERE is_current = 1').get();
    const rate = parseFloat(getSetting(db, 'canteen_daily_rate', '5'));
    const unpaidDays = term ? db.prepare(`
      SELECT COUNT(*) c FROM school_calendar sc
      LEFT JOIN canteen_day_status cds ON cds.date = sc.date AND cds.student_id = ?
      WHERE sc.term_id = ? AND sc.day_type = 'school_day' AND (cds.status IS NULL OR cds.status = 'unpaid')
    `).get(sid, term.id).c : 0;
    return json(res, 200, {
      ok: true,
      student: { id: s.id, index_number: s.index_number, name: `${s.surname} ${s.first_name} ${s.other_names || ''}`.trim(), class_name: s.class_name },
      daily_rate: rate, unpaid_days: unpaidDays, amount_owed: unpaidDays * rate,
      term: term ? { id: term.id, label: term.label } : null,
    });
  });

  // ── Canteen: collect a payment (records payment, marks days, receipts) ──
  add('POST', `${API}/canteen/collect`, async (ctx, req, res, params, body) => {
    if (!can(ctx, 'canteen', 'create')) return json(res, 403, { ok: false, error: 'Access denied.' });
    const sid = parseInt(body.student_id, 10);
    if (!sid) return json(res, 400, { ok: false, error: 'student_id is required.' });
    if (!scopeLib.canAccessStudent(db, scopeOf(ctx), sid)) return json(res, 404, { ok: false, error: 'Student not found.' });
    const { recordCanteenPayment } = require('../ipc/canteen');
    let result;
    try {
      result = recordCanteenPayment(db, {
        student_id: sid,
        amount: body.amount,
        payment_method: body.payment_method || 'Cash',
        notes: body.notes || '',
        received_by: ctx.user.id || null, // users(id) FK — the staff who collected it
      });
    } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
    if (!result.ok) return json(res, 400, result);
    try { require('./sync/staff_projection').enqueueRostersForStudents(db, [sid]); } catch (_) {}
    return json(res, 200, result);
  });

  // ── Timetable: the signed-in teacher's own week (+ today) ──
  add('GET', `${API}/timetable/mine`, async (ctx, req, res) => {
    if (ctx.role !== 'staff') return json(res, 403, { ok: false, error: 'Staff only.' });
    const staffId = ctx.user.staff_id;
    if (!staffId) return json(res, 200, { ok: true, has_staff: false, days: [], today: null });
    const tt = require('../ipc/timetable');
    const data = tt.getTeacherTimetable(db, staffId);
    const jsDay = new Date().getDay(); // 0=Sun … 6=Sat
    const todayVal = (jsDay >= 1 && jsDay <= 5) ? jsDay : null;
    const today = todayVal ? (data.days.find(d => d.value === todayVal) || null) : null;
    return json(res, 200, { ok: true, has_staff: true, days: data.days, today });
  });

  // ── Timetable: a class grid (staff who can view students/academics) ──
  add('GET', `${API}/timetable/class/:id`, async (ctx, req, res, params) => {
    if (ctx.role !== 'staff' || (!can(ctx, 'academics', 'view') && !can(ctx, 'students', 'view'))) {
      return json(res, 403, { ok: false, error: 'Access denied.' });
    }
    const classId = parseInt(params.id, 10);
    if (!scopeLib.canAccessClass(scopeOf(ctx), classId)) return json(res, 403, { ok: false, error: 'That class is not yours.' });
    const tt = require('../ipc/timetable');
    return json(res, 200, { ok: true, ...tt.getClassTimetable(db, classId) });
  });

  // ── Timetable: a parent's child's class grid ──
  add('GET', `${API}/parent/children/:id/timetable`, async (ctx, req, res, params) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const sid = parseInt(params.id, 10);
    if (!ctx.student_ids.includes(sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    const stu = db.prepare('SELECT current_class_id FROM students WHERE id = ?').get(sid);
    if (!stu || !stu.current_class_id) return json(res, 200, { ok: true, class: null, days: [], periods: [], entries: {} });
    const tt = require('../ipc/timetable');
    return json(res, 200, { ok: true, ...tt.getClassTimetable(db, stu.current_class_id) });
  });

  // ── Homework: list for a class (staff) ──
  add('GET', `${API}/homework`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (ctx.role !== 'staff' || !can(ctx, 'academics', 'view')) return json(res, 403, { ok: false, error: 'Access denied.' });
    const classId = parseInt(query.classId, 10);
    if (!classId) return json(res, 400, { ok: false, error: 'classId is required.' });
    if (!scopeLib.canAccessClass(scopeOf(ctx), classId)) return json(res, 403, { ok: false, error: 'That class is not yours.' });
    const hw = require('../ipc/homework');
    return json(res, 200, { ok: true, homework: hw.listForClass(db, classId, { all: query.all === '1' }) });
  });

  // ── Homework: set for a class (staff) ──
  add('POST', `${API}/homework`, async (ctx, req, res, params, body) => {
    if (ctx.role !== 'staff' || !can(ctx, 'academics', 'edit')) return json(res, 403, { ok: false, error: 'Access denied.' });
    const hw = require('../ipc/homework');
    if (!scopeLib.canAccessSubject(scopeOf(ctx), parseInt(body.classId, 10), parseInt(body.subjectId, 10))
        && !scopeLib.canAccessClass(scopeOf(ctx), parseInt(body.classId, 10))) {
      return json(res, 403, { ok: false, error: 'That class is not yours.' });
    }
    const r = hw.saveHomework(db, {
      classId: parseInt(body.classId, 10), subjectId: body.subjectId || null,
      teacherId: ctx.user.staff_id || null, title: body.title,
      description: body.description, dueDate: body.dueDate,
      maxMarks: body.maxMarks,
    });
    if (!r.ok) return json(res, 400, r);
    try { require('./sync/staff_projection').enqueueClassRoster(db, parseInt(body.classId, 10)); } catch (_) {}
    return json(res, 200, r);
  });

  // ── Homework: marking sheet + saving marks (staff) ──
  add('GET', `${API}/homework/:id/sheet`, async (ctx, req, res, params) => {
    if (ctx.role !== 'staff' || !can(ctx, 'academics', 'view')) return json(res, 403, { ok: false, error: 'Access denied.' });
    const hw = require('../ipc/homework');
    const sheet = hw.getSheet(db, parseInt(params.id, 10));
    if (!sheet) return json(res, 404, { ok: false, error: 'Homework not found.' });
    const cid = sheet.homework && sheet.homework.class_group_id;
    if (cid && !scopeLib.canAccessClass(scopeOf(ctx), cid)) return json(res, 404, { ok: false, error: 'Homework not found.' });
    return json(res, 200, { ok: true, ...sheet });
  });

  add('POST', `${API}/homework/:id/marks`, async (ctx, req, res, params, body) => {
    if (ctx.role !== 'staff' || !can(ctx, 'academics', 'edit')) return json(res, 403, { ok: false, error: 'Access denied.' });
    const hw = require('../ipc/homework');
    const r = hw.saveMarks(db, { homeworkId: parseInt(params.id, 10), entries: body.entries });
    if (!r.ok) return json(res, 400, r);
    return json(res, 200, r);
  });

  // ── Homework: a parent's child's class homework ──
  add('GET', `${API}/parent/children/:id/homework`, async (ctx, req, res, params) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const sid = parseInt(params.id, 10);
    if (!ctx.student_ids.includes(sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    const hw = require('../ipc/homework');
    return json(res, 200, { ok: true, homework: hw.listForStudent(db, sid) });
  });

  // ── Transport: a parent's child's route, stop, times and fee balance ──
  add('GET', `${API}/parent/children/:id/transport`, async (ctx, req, res, params) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const sid = parseInt(params.id, 10);
    if (!ctx.student_ids.includes(sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    const tr = require('../ipc/transport');
    return json(res, 200, { ok: true, transport: tr.transportForStudent(db, sid) });
  });

  // Everything a teacher does that the desktop offers and this server did not:
  // a pupil's record, register history, continuous assessment, the broadsheet
  // and the terminal report, lesson notes, messages, notices, the canteen
  // sheet, and their own clock-in, leave and payslips. Kept in its own module
  // so this one stays the router rather than the whole school.
  registerStaffRoutes({ add, db, json, html, can, API, getSetting, media, studentProfile, getResourcePath });

  // There is no payment webhook here any more, and no checkout to answer for.
  // Money is never taken through this app: a balance is shown, and settling it
  // is arranged with the school. Removing the gateway removes the only path by
  // which a card or wallet charge could originate from a parent's phone.

  // ── request dispatcher ──
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return json(res, 204, {});
    const parsed = url.parse(req.url, true);
    const reqParts = parsed.pathname.split('/').filter(Boolean);
    const ip = req.socket.remoteAddress || '';

    // The browser build of the mobile app, served from this same origin so a
    // teacher on the school Wi-Fi can just open the address in Chrome. It only
    // ever answers GET/HEAD outside /api/, so the API keeps priority and this
    // is a no-op when no web build is installed.
    if (webapp.serveWebApp(req, res, parsed.pathname)) return;

    // find route
    let route = null, routeParams = null;
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = match(r.parts, reqParts);
      if (m) { route = r; routeParams = m; break; }
    }
    if (!route) return json(res, 404, { ok: false, error: 'Not found' });

    let ctx = null, tokenId = null;
    if (!route.public) {
      const auth = req.headers['authorization'] || '';
      const raw = auth.startsWith('Bearer ') ? auth.slice(7) : null;
      const subject = tokens.verifyToken(db, raw);
      if (!subject) return json(res, 401, { ok: false, error: 'Unauthorized' });
      ctx = subjectContext(db, subject);
      tokenId = subject.token_id;
      if (!ctx) return json(res, 401, { ok: false, error: 'Account not found' });
    }

    const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : {};
    try {
      await route.handler(ctx, req, res, routeParams, body, ip, tokenId, parsed.query || {});
    } catch (e) {
      json(res, 500, { ok: false, error: 'Server error' });
    }
  });

  return server;
}

module.exports = { createApiServer };
