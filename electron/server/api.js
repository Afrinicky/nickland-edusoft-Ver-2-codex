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
const payments = require('./payments_service');
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

  // ── Public ──
  add('GET', `${API}/health`, async (ctx, req, res) => json(res, 200, { ok: true, name: getSetting(db, 'school_name', 'School'), api: 'v1' }), { public: true });
  add('GET', `${API}/info`, async (ctx, req, res) => json(res, 200, {
    ok: true,
    school: { name: getSetting(db, 'school_name', 'School'), motto: getSetting(db, 'school_motto', ''), phone: getSetting(db, 'school_phone_1', '') },
    parent_self_register: getSetting(db, 'mobile_parent_self_register', 'true') === 'true',
    online_payments: require('./gateways').gatewayEnabled(db),
    payment_currency: getSetting(db, 'payment_currency', 'GHS'),
  }), { public: true });

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
    return json(res, 200, { ok: true, term: { id: term.id, label: term.label }, subjects, summary: summary || null });
  });

  // Parent submits a payment (mobile money / bank / cash-at-office). This
  // creates a PENDING intent; the school acknowledges it (or a gateway webhook
  // does), which records the payment and sends the receipt.
  add('POST', `${API}/parent/children/:id/pay`, async (ctx, req, res, params, body) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const sid = parseInt(params.id, 10);
    if (!ctx.student_ids.includes(sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    const r = payments.createIntent(db, {
      student_id: sid, parent_id: ctx.parent.id,
      amount: body.amount, channel: body.channel || 'mobile',
      reference: body.reference, notes: body.notes,
    });
    if (!r.ok) return json(res, 400, r);
    return json(res, 200, { ok: true, intent_id: r.intent_id, status: 'pending',
      message: 'Payment submitted. You will receive a receipt once the school confirms it.' });
  });

  // Parent starts an ONLINE payment (Paystack by default). Returns a checkout
  // URL the app opens; settlement happens on verify/webhook.
  add('POST', `${API}/parent/children/:id/pay/online`, async (ctx, req, res, params, body) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const sid = parseInt(params.id, 10);
    if (!ctx.student_ids.includes(sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    const r = await payments.createOnlineIntent(db, {
      student_id: sid, parent_id: ctx.parent.id, amount: body.amount,
      email: body.email || ctx.parent.email,
    });
    if (!r.ok) return json(res, 400, r);
    return json(res, 200, { ok: true, authorization_url: r.authorization_url, reference: r.reference });
  });

  // Parent-scoped verification (pull) — called after the checkout returns.
  add('GET', `${API}/parent/pay/verify/:reference`, async (ctx, req, res, params) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const intent = db.prepare('SELECT parent_id FROM payment_intents WHERE gateway_reference = ?').get(params.reference);
    if (!intent) return json(res, 404, { ok: false, error: 'Payment not found.' });
    if (intent.parent_id && intent.parent_id !== ctx.parent.id) return json(res, 403, { ok: false, error: 'Not your payment.' });
    const r = await payments.verifyAndSettle(db, params.reference, {});
    return json(res, r.ok || r.pending ? 200 : 400, r);
  });

  // Parent sees their submitted payment intents + their status.
  add('GET', `${API}/parent/children/:id/intents`, async (ctx, req, res, params) => {
    if (ctx.role !== 'parent') return json(res, 403, { ok: false, error: 'Parents only.' });
    const sid = parseInt(params.id, 10);
    if (!ctx.student_ids.includes(sid)) return json(res, 403, { ok: false, error: 'Not your child.' });
    return json(res, 200, { ok: true, intents: payments.intentsForStudent(db, sid) });
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

  // ── Classes list (for teacher pickers: attendance / scores / canteen) ──
  add('GET', `${API}/classes`, async (ctx, req, res) => {
    if (!can(ctx, 'students', 'view') && !can(ctx, 'academics', 'view') && !can(ctx, 'canteen', 'view')) {
      return json(res, 403, { ok: false, error: 'Access denied.' });
    }
    const classes = db.prepare('SELECT id, name, short_code FROM class_groups ORDER BY level_order, name').all();
    return json(res, 200, { ok: true, classes });
  });

  // ── Attendance register: roster for a class on a date, with any marks set ──
  add('GET', `${API}/attendance`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!can(ctx, 'students', 'view') && !can(ctx, 'academics', 'view')) return json(res, 403, { ok: false, error: 'Access denied.' });
    const classId = parseInt(query.classId, 10);
    const date = query.date;
    if (!classId || !date) return json(res, 400, { ok: false, error: 'classId and date are required.' });
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
    try { const { enqueueStudentSnapshot } = require('./sync/outbox'); for (const m of marks) enqueueStudentSnapshot(db, m.student_id); } catch (_) {}
    return json(res, 200, { ok: true, saved: n });
  });

  // ── Score entry: subjects mapped to a class ──
  add('GET', `${API}/scores/subjects`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!can(ctx, 'academics', 'view')) return json(res, 403, { ok: false, error: 'Access denied.' });
    const classId = parseInt(query.classId, 10);
    if (!classId) return json(res, 400, { ok: false, error: 'classId is required.' });
    let subjects = db.prepare(`
      SELECT s.id, s.name, s.code FROM subjects s
      JOIN class_subjects cs ON cs.subject_id = s.id
      WHERE cs.class_group_id = ? AND s.is_active = 1 ORDER BY s.name
    `).all(classId);
    if (subjects.length === 0) subjects = db.prepare('SELECT id, name, code FROM subjects WHERE is_active = 1 ORDER BY name').all();
    return json(res, 200, { ok: true, subjects });
  });

  // ── Score entry: roster + current exam marks for a class+subject (current term) ──
  add('GET', `${API}/scores`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!can(ctx, 'academics', 'view')) return json(res, 403, { ok: false, error: 'Access denied.' });
    const classId = parseInt(query.classId, 10);
    const subjectId = parseInt(query.subjectId, 10);
    if (!classId || !subjectId) return json(res, 400, { ok: false, error: 'classId and subjectId are required.' });
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
    const { recordCanteenPayment } = require('../ipc/canteen');
    let result;
    try {
      result = recordCanteenPayment(db, {
        student_id: sid,
        amount: body.amount,
        payment_method: body.payment_method || 'Cash',
        notes: body.notes || '',
        received_by: ctx.user.full_name || ctx.user.username || null,
      });
    } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
    if (!result.ok) return json(res, 400, result);
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
    const tt = require('../ipc/timetable');
    return json(res, 200, { ok: true, ...tt.getClassTimetable(db, parseInt(params.id, 10)) });
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

  function readRaw(req) {
    return new Promise((resolve) => {
      let d = ''; let tooBig = false;
      req.on('data', (c) => { d += c; if (d.length > 1e6) { tooBig = true; req.destroy(); } });
      req.on('end', () => resolve(tooBig ? '' : d));
      req.on('error', () => resolve(''));
    });
  }

  // Gateway webhook — public, but authenticated by HMAC signature over the RAW
  // body. Always answers 200 so the gateway stops retrying once received.
  async function handlePaystackWebhook(req, res) {
    const raw = await readRaw(req);
    const g = require('./gateways').getGateway(db);
    const sig = req.headers['x-paystack-signature'];
    if (!g || !g.verifyWebhook(db, sig, raw)) return json(res, 401, { ok: false, error: 'invalid signature' });
    let payload = null; try { payload = JSON.parse(raw); } catch (_) {}
    if (payload && g.webhookIsSuccess(payload)) {
      const ref = g.webhookReference(payload);
      if (ref) { try { await payments.verifyAndSettle(db, ref, {}); } catch (_) {} }
    }
    return json(res, 200, { ok: true });
  }

  // ── request dispatcher ──
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return json(res, 204, {});
    const parsed = url.parse(req.url, true);
    const reqParts = parsed.pathname.split('/').filter(Boolean);
    const ip = req.socket.remoteAddress || '';

    if (req.method === 'POST' && parsed.pathname === `${API}/webhooks/paystack`) {
      return handlePaystackWebhook(req, res);
    }

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
