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
const parents = require('./parents');
const { getSetting } = require('../utils/idgen');
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
const attempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { n: 0, t: now };
  if (now - rec.t > 60000) { rec.n = 0; rec.t = now; }
  rec.n++; attempts.set(ip, rec);
  return rec.n > 20;
}

function subjectContext(db, subject) {
  if (subject.subject_type === 'parent') {
    const p = db.prepare('SELECT id, full_name, phone, email FROM parents WHERE id = ?').get(subject.subject_id);
    if (!p) return null;
    return { role: 'parent', parent: p, student_ids: parents.studentIdsForParent(db, p.id) };
  }
  const u = db.prepare(`
    SELECT u.id, u.full_name, u.username, u.staff_id, d.name AS designation
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

// ── data helpers (read straight from the canonical DB) ──
function childSummary(db, studentId) {
  const s = db.prepare(`
    SELECT s.id, s.surname, s.first_name, s.other_names, s.index_number, s.photo_path,
           c.name AS class_name FROM students s
    LEFT JOIN class_groups c ON c.id = s.current_class_id WHERE s.id = ?
  `).get(studentId);
  if (!s) return null;
  const term = db.prepare('SELECT * FROM terms WHERE is_current = 1').get();
  const bill = term ? db.prepare('SELECT total_billed, total_paid, balance FROM student_bills WHERE student_id = ? AND term_id = ?').get(studentId, term.id) : null;
  const rate = parseFloat(getSetting(db, 'canteen_daily_rate', '5'));
  const canteenUnpaid = term ? db.prepare(`
    SELECT COUNT(*) c FROM school_calendar sc
    LEFT JOIN canteen_day_status cds ON cds.date = sc.date AND cds.student_id = ?
    WHERE sc.term_id = ? AND sc.day_type = 'school_day' AND (cds.status IS NULL OR cds.status = 'unpaid')
  `).get(studentId, term.id).c : 0;
  return {
    id: s.id, name: `${s.surname} ${s.first_name} ${s.other_names || ''}`.trim(),
    index_number: s.index_number, class_name: s.class_name,
    fees: { billed: bill?.total_billed || 0, paid: bill?.total_paid || 0, balance: bill?.balance || 0 },
    canteen: { unpaid_days: canteenUnpaid, amount_owed: canteenUnpaid * rate, daily_rate: rate },
    term: term ? { id: term.id, label: term.label } : null,
  };
}

function createApiServer(db, opts = {}) {
  const routes = [];
  const add = (method, pattern, handler) => routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });

  const match = (parts, reqParts) => {
    if (parts.length !== reqParts.length) return null;
    const params = {};
    for (let i = 0; i < parts.length; i++) {
      if (parts[i][0] === ':') params[parts[i].slice(1)] = decodeURIComponent(reqParts[i]);
      else if (parts[i] !== reqParts[i]) return null;
    }
    return params;
  };

  // ── Public ──
  add('GET', `${API}/health`, async (ctx, req, res) => json(res, 200, { ok: true, name: getSetting(db, 'school_name', 'School'), api: 'v1' }));
  add('GET', `${API}/info`, async (ctx, req, res) => json(res, 200, {
    ok: true,
    school: { name: getSetting(db, 'school_name', 'School'), motto: getSetting(db, 'school_motto', ''), phone: getSetting(db, 'school_phone_1', '') },
    parent_self_register: getSetting(db, 'mobile_parent_self_register', 'true') === 'true',
  }));

  add('POST', `${API}/auth/login`, async (ctx, req, res, params, body, ip) => {
    if (rateLimited(ip)) return json(res, 429, { ok: false, error: 'Too many attempts. Try again shortly.' });
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
  });

  add('POST', `${API}/auth/parent/register`, async (ctx, req, res, params, body, ip) => {
    if (rateLimited(ip)) return json(res, 429, { ok: false, error: 'Too many attempts.' });
    if (getSetting(db, 'mobile_parent_self_register', 'true') !== 'true') {
      return json(res, 403, { ok: false, error: 'Self-registration is disabled. Ask the school to register you.' });
    }
    const r = parents.registerParent(db, body);
    if (!r.ok) return json(res, 400, r);
    const t = tokens.issueToken(db, 'parent', r.parent_id, { deviceName: body.device, platform: body.platform });
    return json(res, 200, { ok: true, token: t.token, expires_at: t.expires_at, linked: r.linked });
  });

  add('POST', `${API}/auth/parent/login`, async (ctx, req, res, params, body, ip) => {
    if (rateLimited(ip)) return json(res, 429, { ok: false, error: 'Too many attempts.' });
    const r = parents.loginParent(db, body);
    if (!r.ok) return json(res, 401, r);
    const t = tokens.issueToken(db, 'parent', r.parent.id, { deviceName: body.device, platform: body.platform });
    return json(res, 200, { ok: true, token: t.token, expires_at: t.expires_at, parent: r.parent });
  });

  // ── Authed ──
  add('GET', `${API}/me`, async (ctx, req, res) => {
    if (ctx.role === 'parent') return json(res, 200, { ok: true, role: 'parent', parent: ctx.parent, children: ctx.student_ids.length });
    return json(res, 200, { ok: true, role: 'staff', user: ctx.user, designation: ctx.designation, is_admin: ctx.is_admin, permissions: ctx.permissions });
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
    const term = db.prepare('SELECT id FROM terms WHERE is_current = 1').get();
    const attendance = term ? db.prepare(`
      SELECT COUNT(*) FILTER (WHERE status='present') AS present,
             COUNT(*) FILTER (WHERE status='absent') AS absent, COUNT(*) AS total
      FROM student_attendance WHERE student_id = ?
    `).get(sid) : { present: 0, absent: 0, total: 0 };
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
    return json(res, 200, { ok: true, term: { id: term.id, label: term.label }, subjects, summary: summary || null });
  });

  add('GET', `${API}/parent/notifications`, async (ctx, req, res) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const contacts = [ctx.parent.phone, ctx.parent.email].filter(Boolean);
    if (!contacts.length) return json(res, 200, { ok: true, notifications: [] });
    const placeholders = contacts.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT channel, message_body, sent_at, delivery_status FROM notification_log
      WHERE recipient_contact IN (${placeholders}) ORDER BY sent_at DESC LIMIT 50
    `).all(...contacts);
    return json(res, 200, { ok: true, notifications: rows });
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
      outstanding = db.prepare('SELECT COALESCE(SUM(balance),0) t FROM student_bills WHERE term_id=?').get(term.id).t;
    }
    return json(res, 200, { ok: true, term: term ? { id: term.id, label: term.label } : null,
      metrics: { students, staff, fees_collected: collected, fees_outstanding: outstanding } });
  });

  add('GET', `${API}/students`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!can(ctx, 'students', 'view')) return json(res, 403, { ok: false, error: 'Access denied.' });
    let sql = `SELECT s.id, s.index_number, s.surname, s.first_name, s.gender, c.name AS class_name
               FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id WHERE s.status='Active'`;
    const p = [];
    if (query.classId) { sql += ' AND s.current_class_id = ?'; p.push(query.classId); }
    sql += ' ORDER BY s.surname, s.first_name LIMIT 500';
    return json(res, 200, { ok: true, students: db.prepare(sql).all(...p) });
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
      ORDER BY b.balance DESC LIMIT 300
    `).all(term.id);
    return json(res, 200, { ok: true, debtors: rows });
  });

  add('POST', `${API}/attendance`, async (ctx, req, res, params, body) => {
    if (!can(ctx, 'students', 'edit') && !can(ctx, 'academics', 'edit')) return json(res, 403, { ok: false, error: 'Access denied.' });
    const { date, marks } = body; // marks: [{ student_id, status }]
    if (!date || !Array.isArray(marks)) return json(res, 400, { ok: false, error: 'date and marks[] required.' });
    const term = db.prepare('SELECT id FROM terms WHERE is_current = 1').get();
    const up = db.prepare(`
      INSERT INTO student_attendance (student_id, date, status, marked_by, term_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (student_id, date) DO UPDATE SET status = excluded.status, marked_by = excluded.marked_by
    `);
    let n = 0;
    const tx = db.transaction(() => { for (const m of marks) { up.run(m.student_id, date, m.status || 'present', ctx.user.id, term?.id || null); n++; } });
    try { tx(); } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
    return json(res, 200, { ok: true, saved: n });
  });

  // ── request dispatcher ──
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return json(res, 204, {});
    const parsed = url.parse(req.url, true);
    const reqParts = parsed.pathname.split('/').filter(Boolean);
    const ip = req.socket.remoteAddress || '';

    // find route
    let route = null, routeParams = null;
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = match(r.parts, reqParts);
      if (m) { route = r; routeParams = m; break; }
    }
    if (!route) return json(res, 404, { ok: false, error: 'Not found' });

    const isPublic = route.parts.includes('health') || route.parts.includes('info') ||
      (route.parts.includes('auth') && (route.parts.includes('login') || route.parts.includes('register')));

    let ctx = null, tokenId = null;
    if (!isPublic) {
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
