// Nickland Edusoft Cloud — multi-tenant portal + sync API
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Two audiences, two auth schemes:
//   • Desktop host & portal backend → `x-school-key` (per-school API key):
//       /api/v1/sync/*   (ping, push, pull)  and  /api/v1/admin/* (read model, enqueue)
//   • Parents on the website        → portal bearer token (issued at login):
//       /api/v1/portal/* (schools, login are public; me/children/profile need the token)
// The cloud holds only the thin read model + change queue; the desktop stays
// the source of truth.

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const pauth = require('./portal_auth');
const staffApi = require('./staff');
const office = require('./office');
const cloudPayments = require('./payments');
const portalModel = require('./portals');
const ratelimit = require('./ratelimit');
const webapp = require('./webapp');

const SITE = (() => {
  try { return fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'); }
  catch (_) { return '<!doctype html><title>Nickland Edusoft</title><p>Portal site not found.</p>'; }
})();

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-school-key, Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function html(res, body) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); }
// The body as it arrived. A webhook signature covers the bytes that were
// signed; JSON that has been parsed and re-serialised is a different string.
function readRawBody(req) {
  return new Promise((resolve) => {
    let d = ''; let big = false;
    req.on('data', (c) => { d += c; if (d.length > 5e6) { big = true; req.destroy(); } });
    req.on('end', () => resolve(big ? '' : d));
    req.on('error', () => resolve(''));
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = ''; let big = false;
    req.on('data', (c) => { d += c; if (d.length > 5e6) { big = true; req.destroy(); } });
    req.on('end', () => { if (big) return resolve({}); try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function bearer(req) { const a = req.headers['authorization'] || ''; return a.startsWith('Bearer ') ? a.slice(7) : null; }

function createServer(store) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return json(res, 204, {});
      const parsed = url.parse(req.url, true);
      const p = parsed.pathname;
      const q = parsed.query || {};

      if (p === '/health' || p === '/api/v1/health') return json(res, 200, { ok: true, store: store.kind, web_app: webapp.isAvailable() });

      // The legacy hand-written parent page, kept reachable by name so a
      // school can be pointed back at it if the new app misbehaves.
      if (req.method === 'GET' && p === '/legacy') return html(res, SITE);

      // The browser build of the mobile app — parents AND staff, the same
      // screens as the phone. Only answers GET/HEAD outside /api/, so the API
      // keeps priority. Falls through when no build is installed here, which
      // is the normal shape when the static build lives on a CDN.
      if (webapp.serveWebApp(req, res, p)) return;

      // No web build installed: the legacy page still answers at the root.
      if (req.method === 'GET' && (p === '/' || p === '/portal' || p === '/app')) return html(res, SITE);

      // ── Public portal endpoints ──

      // The same path a desktop host answers, so a client can ask one question
      // — "what are you?" — and get the answer, instead of probing endpoint by
      // endpoint. A host returns a `school`; this returns the tenant list.
      if (p === '/api/v1/info' && req.method === 'GET') {
        const schools = await store.listSchools();
        return json(res, 200, { ok: true, mode: 'cloud', portal: true, staff: true, schools });
      }

      if (p === '/api/v1/portal/schools' && req.method === 'GET') {
        const schools = await store.listSchools();
        return json(res, 200, { ok: true, schools });
      }

      // One school's identity — its crest, its name, and the numbers a parent
      // is sent to when they tap "Message the school". Public and answered
      // before sign-in, so the portal opens on the parent's own school rather
      // than a generic page. Projected by the desktop as `school_profile`; a
      // school that has not pushed one falls back to its name.
      if (p === '/api/v1/portal/branding' && req.method === 'GET') {
        const schoolId = (parsed.query && parsed.query.school_id) || '';
        if (!schoolId) return json(res, 400, { ok: false, error: 'school_id is required' });
        const schools = await store.listSchools();
        const found = schools.find(x => String(x.school_id) === String(schoolId));
        if (!found) return json(res, 404, { ok: false, error: 'Unknown school' });
        const snaps = await store.listSnapshots(schoolId, 'school_profile');
        const rec = (snaps.find(x => x.payload) || {}).payload;
        if (!rec) return json(res, 200, { ok: true, school: { name: found.name }, contact: {}, logo: null, currency: 'GHS' });
        return json(res, 200, {
          ok: true,
          school: { name: found.name, ...(rec.school || {}) },
          contact: rec.contact || {},
          logo: rec.logo || null,
          currency: rec.currency || 'GHS',
        });
      }
      if (p === '/api/v1/portal/login' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body.school_id || !body.identifier || !body.password) return json(res, 400, { ok: false, error: 'school, identifier and password are required' });
        if (ratelimit.limited(req, 'parent', body.identifier)) {
          return json(res, 429, { ok: false, error: 'Too many attempts. Try again shortly.' });
        }
        const auths = await store.listSnapshots(body.school_id, 'parent_auth');
        const np = pauth.normPhone(body.identifier);
        const em = String(body.identifier).trim().toLowerCase();
        const rec = auths.map(a => a.payload).find(pl =>
          pl && pl.is_active && (pauth.normPhone(pl.phone) === np || (pl.email || '').toLowerCase() === em));
        if (!rec || !pauth.verifyPassword(body.password, rec.password_hash)) return json(res, 401, { ok: false, error: 'Invalid credentials.' });
        const token = pauth.signToken({ school_id: body.school_id, parent_id: rec.parent_id });
        return json(res, 200, { ok: true, token, parent: { full_name: rec.full_name, phone: rec.phone, email: rec.email } });
      }

      // ── One sign-in box (public) ──
      // The app used to ask "parent or staff?" before it asked who you were.
      // Nobody answers that at the school gate, and getting it wrong reads as a
      // wrong password. A staff username is matched first, then a parent's
      // phone or email, and the reply says which surface the account belongs to.
      // A match ends it, so an account is never authenticated twice against two
      // different passwords.
      if (p === '/api/v1/signin' && req.method === 'POST') {
        const body = await readBody(req);
        const identifier = String(body.identifier || body.username || '').trim();
        if (!body.school_id || !identifier || !body.password) {
          return json(res, 400, { ok: false, error: 'school, identifier and password are required' });
        }
        if (ratelimit.limited(req, 'signin', identifier)) {
          return json(res, 429, { ok: false, error: 'Too many attempts. Try again shortly.' });
        }

        const staffRec = await staffApi.findStaffByUsername(store, body.school_id, identifier);
        if (staffRec && staffApi.verifyStaffPassword(body.password, staffRec.password_hash)) {
          return json(res, 200, {
            ok: true, role: 'staff',
            token: staffApi.signStaffToken(body.school_id, staffRec.user_id),
            user: { id: staffRec.user_id, full_name: staffRec.full_name, username: staffRec.username },
          });
        }

        const auths = await store.listSnapshots(body.school_id, 'parent_auth');
        const np = pauth.normPhone(identifier);
        const em = identifier.toLowerCase();
        const rec = auths.map(a => a.payload).find(pl =>
          pl && pl.is_active && (pauth.normPhone(pl.phone) === np || (pl.email || '').toLowerCase() === em));
        if (rec && pauth.verifyPassword(body.password, rec.password_hash)) {
          return json(res, 200, {
            ok: true, role: 'parent',
            token: pauth.signToken({ school_id: body.school_id, parent_id: rec.parent_id }),
            parent: { full_name: rec.full_name, phone: rec.phone, email: rec.email },
          });
        }

        // One message for both tables. Saying "that username exists but the
        // password is wrong" tells an outsider which accounts are real.
        return json(res, 401, { ok: false, error: 'Those details did not match an account. Check and try again.' });
      }

      // ── Staff sign-in (public) ──
      // What lets a teacher work with the school's desktop switched off. The
      // account, its password hash and its permissions are all projected up by
      // that desktop; the cloud only verifies and issues a session.
      if (p === '/api/v1/staff/login' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body.school_id || !body.username || !body.password) {
          return json(res, 400, { ok: false, error: 'school, username and password are required' });
        }
        if (ratelimit.limited(req, 'staff', body.username)) {
          return json(res, 429, { ok: false, error: 'Too many attempts. Try again shortly.' });
        }
        const rec = await staffApi.findStaffByUsername(store, body.school_id, body.username);
        if (!rec || !staffApi.verifyStaffPassword(body.password, rec.password_hash)) {
          return json(res, 401, { ok: false, error: 'Invalid username or password.' });
        }
        return json(res, 200, {
          ok: true,
          token: staffApi.signStaffToken(body.school_id, rec.user_id),
          user: { id: rec.user_id, full_name: rec.full_name, username: rec.username },
        });
      }

      // ── Staff password reset (public) ──
      // Raising a request and redeeming an approved code both happen before
      // sign-in, so neither can require a token. Approval itself is not here
      // and never will be: an Administrator does that on the school's desktop,
      // face to face, and only the hash of the code they hand over is
      // projected up for this to check against.
      if (p === '/api/v1/staff/password-reset/request' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body.school_id) return json(res, 400, { ok: false, error: 'school is required' });
        if (ratelimit.limited(req, 'staff', body.username)) {
          return json(res, 429, { ok: false, error: 'Too many attempts. Try again shortly.' });
        }
        const r = await staffApi.requestPasswordReset(store, body.school_id, body, body.source);
        return json(res, r.ok ? 200 : (r.status || 400), r.ok ? r : { ok: false, error: r.error });
      }

      if (p === '/api/v1/staff/password-reset/complete' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body.school_id) return json(res, 400, { ok: false, error: 'school is required' });
        if (ratelimit.limited(req, 'staff', body.username)) {
          return json(res, 429, { ok: false, error: 'Too many attempts. Try again shortly.' });
        }
        const r = await staffApi.completePasswordReset(store, body.school_id, body, body.source);
        return json(res, r.ok ? 200 : (r.status || 400), r.ok ? r : { ok: false, error: r.error });
      }

      // ── Staff-token endpoints ──
      if (p.startsWith('/api/v1/staff/')) {
        const claims = staffApi.staffClaims(bearer(req));
        if (!claims) return json(res, 401, { ok: false, error: 'Please sign in.' });
        const rec = await staffApi.loadStaff(store, claims.school_id, claims.user_id);
        // Deactivated on the desktop and re-projected: the session dies with
        // the next request rather than lasting until the token expires.
        if (!rec) return json(res, 401, { ok: false, error: 'Account unavailable.' });

        const sid = claims.school_id;
        const deny = () => json(res, 403, { ok: false, error: 'Access denied.' });
        const send = (r) => json(res, r.ok ? 200 : (r.status || 400), r.status ? { ok: false, error: r.error } : r);

        if (p === '/api/v1/staff/me' && req.method === 'GET') {
          const school = await store.getSchool(sid);
          // Which portals this account holds, from the same rules the desktop
          // applies. Two of them cannot be served from here at all — the app
          // is told which, and why, rather than being handed a door that opens
          // onto an error.
          const held = portalModel.portalListFor(rec).map(x => (
            x.key === 'system'
              ? { ...x, available: false, reason: "Administered on the school's own network." }
              : { ...x, available: true }
          ));
          return json(res, 200, {
            ok: true, role: 'staff', mode: 'cloud',
            user: { id: rec.user_id, full_name: rec.full_name, username: rec.username, staff_id: rec.staff_id },
            designation: rec.designation, is_admin: !!rec.is_admin,
            must_change_password: !!rec.must_change_password,
            permissions: rec.permissions || {}, school,
            portals: held,
            home_portal: portalModel.homePortal(rec),
          });
        }

        // ── The finance office and the administration, off-LAN ──
        // Summaries the desktop projected, and the two approvals that move no
        // money. See src/office.js for what is deliberately absent.
        if (p === '/api/v1/staff/finance/overview' && req.method === 'GET') {
          return send(await office.financeOverview(store, sid, rec));
        }
        if (p === '/api/v1/staff/finance/debtors' && req.method === 'GET') {
          return send(await office.financeDebtors(store, sid, rec));
        }
        if (p === '/api/v1/staff/admin/overview' && req.method === 'GET') {
          return send(await office.adminOverview(store, sid, rec));
        }
        if (p === '/api/v1/staff/admin/approvals' && req.method === 'GET') {
          return send(await office.approvals(store, sid, rec));
        }
        if (p === '/api/v1/staff/admin/leave/decision' && req.method === 'POST') {
          return send(await office.submitDecision(store, sid, rec, 'leave', await readBody(req)));
        }
        if (p === '/api/v1/staff/admin/lesson-note/decision' && req.method === 'POST') {
          return send(await office.submitDecision(store, sid, rec, 'lesson_note', await readBody(req)));
        }

        // Taking money, and the system portal, are not served from here at
        // all. Answered plainly so the app can say why rather than 404.
        if (p.startsWith('/api/v1/staff/finance/collections') || p === '/api/v1/staff/finance/payroll') {
          return json(res, 400, { ok: false, host_only: true,
            error: "The school's own system records money and runs payroll. Connect on the school Wi-Fi." });
        }
        if (p.startsWith('/api/v1/staff/system/')) {
          return json(res, 400, { ok: false, host_only: true,
            error: "Accounts, access and the audit trail are administered on the school's own network." });
        }

        if (p === '/api/v1/staff/dashboard' && req.method === 'GET') {
          if (!staffApi.can(rec, 'dashboard', 'view')) return deny();
          return send(await staffApi.dashboard(store, sid, rec));
        }

        if (p === '/api/v1/staff/students' && req.method === 'GET') {
          if (!staffApi.can(rec, 'students', 'view')) return deny();
          return send(await staffApi.students(store, sid, q.classId, rec));
        }

        if (p === '/api/v1/staff/debtors' && req.method === 'GET') {
          if (!staffApi.can(rec, 'fees', 'view')) return deny();
          return send(await staffApi.debtors(store, sid));
        }

        if (p === '/api/v1/staff/classes' && req.method === 'GET') {
          if (!staffApi.canAny(rec, [['students', 'view'], ['academics', 'view'], ['canteen', 'view']])) return deny();
          return send(await staffApi.classes(store, sid, rec));
        }

        if (p === '/api/v1/staff/attendance' && req.method === 'GET') {
          if (!staffApi.canAny(rec, [['students', 'view'], ['academics', 'view']])) return deny();
          if (!q.classId || !q.date) return json(res, 400, { ok: false, error: 'classId and date are required.' });
          return send(await staffApi.attendanceSheet(store, sid, q.classId, q.date, rec));
        }
        if (p === '/api/v1/staff/attendance' && req.method === 'POST') {
          if (!staffApi.canAny(rec, [['students', 'edit'], ['academics', 'edit']])) return deny();
          return send(await staffApi.submitAttendance(store, sid, rec, await readBody(req)));
        }

        if (p === '/api/v1/staff/scores/subjects' && req.method === 'GET') {
          if (!staffApi.can(rec, 'academics', 'view')) return deny();
          if (!q.classId) return json(res, 400, { ok: false, error: 'classId is required.' });
          return send(await staffApi.scoreSubjects(store, sid, q.classId, rec));
        }
        if (p === '/api/v1/staff/scores' && req.method === 'GET') {
          if (!staffApi.can(rec, 'academics', 'view')) return deny();
          if (!q.classId || !q.subjectId) return json(res, 400, { ok: false, error: 'classId and subjectId are required.' });
          return send(await staffApi.scoreSheet(store, sid, q.classId, q.subjectId, rec));
        }
        if (p === '/api/v1/staff/scores' && req.method === 'POST') {
          if (!staffApi.can(rec, 'academics', 'edit')) return deny();
          return send(await staffApi.submitScores(store, sid, rec, await readBody(req)));
        }

        if (p.startsWith('/api/v1/staff/canteen/student/') && req.method === 'GET') {
          if (!staffApi.can(rec, 'canteen', 'view')) return deny();
          return send(await staffApi.canteenStudent(store, sid, p.split('/').pop(), rec));
        }
        if (p === '/api/v1/staff/canteen/collect' && req.method === 'POST') {
          if (!staffApi.can(rec, 'canteen', 'create')) return deny();
          return send(await staffApi.submitCanteen(store, sid, rec, await readBody(req)));
        }

        if (p === '/api/v1/staff/timetable/mine' && req.method === 'GET') {
          return send(await staffApi.timetableMine(store, sid, rec));
        }

        if (p === '/api/v1/staff/homework' && req.method === 'GET') {
          if (!staffApi.can(rec, 'academics', 'view')) return deny();
          if (!q.classId) return json(res, 400, { ok: false, error: 'classId is required.' });
          return send(await staffApi.homeworkForClass(store, sid, q.classId, rec));
        }
        if (p === '/api/v1/staff/homework' && req.method === 'POST') {
          if (!staffApi.can(rec, 'academics', 'edit')) return deny();
          return send(await staffApi.submitHomework(store, sid, rec, await readBody(req)));
        }

        if (p === '/api/v1/staff/subjects' && req.method === 'GET') {
          if (!staffApi.can(rec, 'academics', 'view')) return deny();
          return send(await staffApi.allSubjects(store, sid, rec, q.classId));
        }

        if (p.startsWith('/api/v1/staff/students/') && p.endsWith('/parents') && req.method === 'GET') {
          // Contacts live on the roster as guardian names and numbers; the
          // portal has no parent accounts to start a thread against, so this
          // answers empty rather than pretending otherwise.
          if (!staffApi.can(rec, 'notifications', 'view')) return deny();
          return json(res, 200, { ok: true, parents: [] });
        }

        if (p.startsWith('/api/v1/staff/students/') && req.method === 'GET') {
          if (!staffApi.can(rec, 'students', 'view')) return deny();
          return send(await staffApi.studentProfile(store, sid, p.split('/').pop(), rec));
        }

        if (p === '/api/v1/staff/attendance/history' && req.method === 'GET') {
          if (!staffApi.canAny(rec, [['students', 'view'], ['academics', 'view']])) return deny();
          if (!q.classId) return json(res, 400, { ok: false, error: 'classId is required.' });
          return send(await staffApi.attendanceHistory(store, sid, q.classId, parseInt(q.days, 10) || 30, rec));
        }

        if (p === '/api/v1/staff/assessments' && req.method === 'GET') {
          if (!staffApi.can(rec, 'academics', 'view')) return deny();
          if (!q.classId || !q.subjectId) return json(res, 400, { ok: false, error: 'classId and subjectId are required.' });
          return send(await staffApi.assessmentSheet(store, sid, q.classId, q.subjectId, rec));
        }
        if (p === '/api/v1/staff/assessments' && req.method === 'POST') {
          if (!staffApi.can(rec, 'academics', 'edit')) return deny();
          return send(await staffApi.submitAssessments(store, sid, rec, await readBody(req)));
        }
        if (p === '/api/v1/staff/assessments/column' && req.method === 'POST') {
          // The desktop numbers the column; marks queued against an id this
          // side invented would arrive pointing at nothing.
          return json(res, 400, {
            ok: false,
            error: "Adding an assessment column needs the school's own system. Connect on the school Wi-Fi to add one; marks against the columns already there save from anywhere.",
          });
        }

        if (p === '/api/v1/staff/results' && req.method === 'GET') {
          if (!staffApi.can(rec, 'academics', 'view')) return deny();
          if (!q.classId) return json(res, 400, { ok: false, error: 'classId is required.' });
          return send(await staffApi.resultsBroadsheet(store, sid, q.classId, rec));
        }
        if (p.startsWith('/api/v1/staff/results/student/') && req.method === 'GET') {
          if (!staffApi.can(rec, 'academics', 'view')) return deny();
          return send(await staffApi.studentReport(store, sid, p.split('/').pop(), rec));
        }
        if (p === '/api/v1/staff/results/remarks' && req.method === 'POST') {
          if (!staffApi.can(rec, 'academics', 'edit')) return deny();
          return send(await staffApi.submitRemarks(store, sid, rec, await readBody(req)));
        }

        if (p === '/api/v1/staff/canteen/class' && req.method === 'GET') {
          if (!staffApi.can(rec, 'canteen', 'view')) return deny();
          if (!q.classId) return json(res, 400, { ok: false, error: 'classId is required.' });
          return send(await staffApi.canteenClass(store, sid, q.classId, rec));
        }

        if (p === '/api/v1/staff/lesson-notes' && req.method === 'GET') {
          return send(await staffApi.lessonNotes(store, sid, rec));
        }
        if (p === '/api/v1/staff/lesson-notes' && req.method === 'POST') {
          return send(await staffApi.submitLessonNote(store, sid, rec, await readBody(req)));
        }
        if (p.startsWith('/api/v1/staff/lesson-notes/') && req.method === 'GET') {
          return send(await staffApi.lessonNote(store, sid, rec, p.split('/').pop()));
        }

        if (p === '/api/v1/staff/hr/me' && req.method === 'GET') {
          return send(await staffApi.staffProfile(store, sid, rec));
        }
        if (p === '/api/v1/staff/hr/attendance' && req.method === 'GET') {
          const prof = await staffApi.staffProfile(store, sid, rec);
          const month = parseInt(q.month, 10) || (new Date().getMonth() + 1);
          const year = parseInt(q.year, 10) || new Date().getFullYear();
          const prefix = `${year}-${String(month).padStart(2, '0')}`;
          const days = (prof.attendance || []).filter(d => String(d.date || '').startsWith(prefix));
          return json(res, 200, {
            ok: true, has_staff: prof.has_staff, month, year, days,
            summary: { present: days.filter(d => d.status === 'present').length, recorded: days.length },
          });
        }
        if (p === '/api/v1/staff/hr/clock' && req.method === 'POST') {
          return send(await staffApi.submitClock(store, sid, rec, await readBody(req)));
        }
        if (p === '/api/v1/staff/hr/leave' && req.method === 'GET') {
          const prof = await staffApi.staffProfile(store, sid, rec);
          return json(res, 200, { ok: true, has_staff: prof.has_staff, requests: prof.leave_requests || [] });
        }
        if (p === '/api/v1/staff/hr/leave' && req.method === 'POST') {
          return send(await staffApi.submitLeave(store, sid, rec, await readBody(req)));
        }
        if (p === '/api/v1/staff/hr/payslips' && req.method === 'GET') {
          const prof = await staffApi.staffProfile(store, sid, rec);
          const year = parseInt(q.year, 10) || null;
          const slips = year ? (prof.payslips || []).filter(x => x.year === year) : (prof.payslips || []);
          return json(res, 200, { ok: true, has_staff: prof.has_staff, payslips: slips });
        }

        if (p === '/api/v1/staff/messages' && req.method === 'GET') {
          return send(await staffApi.staffThreads(store, sid, rec));
        }
        if (p === '/api/v1/staff/messages' && req.method === 'POST') {
          return send(await staffApi.submitMessage(store, sid, rec, await readBody(req)));
        }
        if (p.startsWith('/api/v1/staff/messages/') && req.method === 'GET') {
          return send(await staffApi.staffThread(store, sid, rec, p.split('/').pop()));
        }

        if (p === '/api/v1/staff/announcements' && req.method === 'GET') {
          return send(await staffApi.announcements(store, sid, rec));
        }
        if (p === '/api/v1/staff/announcements' && req.method === 'POST') {
          return send(await staffApi.submitAnnouncement(store, sid, rec, await readBody(req)));
        }

        // Changing your own password. No permission gate: an account is not a
        // module, and every teacher owns theirs.
        if (p === '/api/v1/staff/password' && req.method === 'POST') {
          return send(await staffApi.changePassword(store, sid, rec, await readBody(req), 'mobile'));
        }

        if (p === '/api/v1/staff/pending' && req.method === 'GET') {
          return send(await staffApi.pendingSummary(store, sid, rec));
        }

        return json(res, 404, { ok: false, error: 'not found' });
      }

      // ── Parent-token portal endpoints ──
      if (p.startsWith('/api/v1/portal/')) {
        const claims = pauth.verifyToken(bearer(req));
        // A staff token must never open a parent endpoint. Without the explicit
        // check it would fall through to a lookup for `parent_id: undefined`,
        // which is the kind of thing that matches one day by accident.
        if (!claims || claims.role === 'staff' || !claims.parent_id) {
          return json(res, 401, { ok: false, error: 'Please sign in.' });
        }
        const authRec = (await store.listSnapshots(claims.school_id, 'parent_auth'))
          .map(a => a.payload).find(pl => pl && pl.parent_id === claims.parent_id);
        if (!authRec || !authRec.is_active) return json(res, 401, { ok: false, error: 'Account unavailable.' });

        if (p === '/api/v1/portal/me' && req.method === 'GET') {
          const school = await store.getSchool(claims.school_id);
          return json(res, 200, { ok: true, parent: { full_name: authRec.full_name, phone: authRec.phone, email: authRec.email }, school });
        }

        if (p === '/api/v1/portal/children' && req.method === 'GET') {
          const snaps = await store.listSnapshots(claims.school_id, 'student_snapshot');
          const byKey = new Map(snaps.map(s => [s.entity_key, s.payload]));
          const children = (authRec.student_keys || []).map(k => byKey.get(k)).filter(Boolean);
          return json(res, 200, { ok: true, children });
        }

        if (p === '/api/v1/portal/announcements' && req.method === 'GET') {
          const mine = new Set(authRec.student_keys || []);
          const items = (await store.listSnapshots(claims.school_id, 'announcement'))
            .map(s => s.payload)
            .filter(a => a && a.is_active && (a.audience === 'all' || (a.audience === 'student' && mine.has(`student:${a.student_id}`))))
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
          return json(res, 200, { ok: true, announcements: items });
        }

        if (p === '/api/v1/portal/messages' && req.method === 'GET') {
          const threads = (await store.listSnapshots(claims.school_id, 'message_thread'))
            .map(s => s.payload)
            .filter(t => t && t.parent_id === claims.parent_id)
            .sort((a, b) => String(b.last_message_at || '').localeCompare(String(a.last_message_at || '')));
          return json(res, 200, { ok: true, threads });
        }

        if (p === '/api/v1/portal/receipts' && req.method === 'GET') {
          const mine = new Set(authRec.student_keys || []);
          const rcs = (await store.listSnapshots(claims.school_id, 'receipt'))
            .map(s => s.payload).filter(r => r && mine.has(`student:${r.student_id}`))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)));
          return json(res, 200, { ok: true, receipts: rcs });
        }

        // ── Settling a bill over the internet ──
        // What the parent's app asks before it draws the screen: is there a
        // gateway here at all, what is owed, and what the school's own
        // channels are for a school that has not switched one on.
        if (p === '/api/v1/portal/payment-options' && req.method === 'GET') {
          const sid = String(q.student_id || '');
          if (!sid || !(authRec.student_keys || []).includes(`student:${sid}`)) {
            return json(res, 403, { ok: false, error: 'Not your child.' });
          }
          const snap = (await store.listSnapshots(claims.school_id, 'student_snapshot'))
            .find(x => x.entity_key === `student:${sid}`);
          const child = snap ? snap.payload : null;
          const profile = ((await store.listSnapshots(claims.school_id, 'school_profile'))
            .find(x => x.payload) || {}).payload || {};
          return json(res, 200, {
            ok: true,
            balance: child && child.fees ? Number(child.fees.balance) || 0 : 0,
            currency: profile.currency || 'GHS',
            online: await cloudPayments.availability(store, claims.school_id),
            offline: {
              declare: true,
              whatsapp: (profile.contact || {}).whatsapp || (profile.contact || {}).phone || '',
              phone: (profile.contact || {}).phone || '',
            },
          });
        }

        if (p === '/api/v1/portal/pay' && req.method === 'POST') {
          const body = await readBody(req);
          if (ratelimit.limited(req, 'pay', String(claims.parent_id))) {
            return json(res, 429, { ok: false, error: 'Too many attempts. Try again shortly.' });
          }
          const r = await cloudPayments.createCheckout(store, claims.school_id, {
            parent_id: claims.parent_id,
            student_id: body.student_id,
            amount: body.amount,
            email: authRec.email || undefined,
            studentKeys: new Set(authRec.student_keys || []),
          });
          return json(res, r.ok ? 200 : (r.status || 400), r.ok ? r : { ok: false, error: r.error });
        }

        // Where the app comes back to. It does not take the app's word that
        // the payment worked — it asks the gateway. So a phone that never
        // returns costs nothing: the webhook settles it regardless.
        if (p.startsWith('/api/v1/portal/payments/') && req.method === 'GET') {
          const reference = decodeURIComponent(p.split('/').pop());
          const r = await cloudPayments.status(store, claims.school_id, reference,
            new Set(authRec.student_keys || []));
          return json(res, r.ok ? 200 : (r.status || 400), r.ok ? r : { ok: false, error: r.error });
        }

        // A payment made at the bank, declared. Not a payment: a message with
        // a number on it, which the office confirms against its own statement.
        // It reaches the desktop as a pending intent and nothing more.
        if (p === '/api/v1/portal/declare-payment' && req.method === 'POST') {
          const body = await readBody(req);
          const sid = String(body.student_id || '');
          if (!sid || !(authRec.student_keys || []).includes(`student:${sid}`)) {
            return json(res, 403, { ok: false, error: 'Not your child.' });
          }
          const amount = Number(body.amount);
          if (!Number.isFinite(amount) || amount <= 0) return json(res, 400, { ok: false, error: 'Enter the amount you paid.' });
          const reference = String(body.reference || '').trim().slice(0, 80);
          if (!reference) return json(res, 400, { ok: false, error: 'Enter the transaction or deposit reference, so the office can find it.' });
          if (ratelimit.limited(req, 'declare', String(claims.parent_id))) {
            return json(res, 429, { ok: false, error: 'Too many attempts. Try again shortly.' });
          }
          await store.enqueueChange(claims.school_id, {
            type: 'payment_declared',
            payload: {
              student_id: sid, parent_id: claims.parent_id, amount,
              channel: ['bank', 'mobile_money', 'cash'].includes(body.channel) ? body.channel : 'bank',
              reference, notes: String(body.notes || '').slice(0, 300),
              declared_at: new Date().toISOString(),
            },
          });
          return json(res, 200, {
            ok: true,
            message: 'The office has it. Your account updates once they confirm it against the school’s statement.',
          });
        }

        if (p === '/api/v1/portal/profile' && req.method === 'POST') {
          const body = await readBody(req);
          const patch = {};
          if (typeof body.full_name === 'string') patch.full_name = body.full_name;
          if (typeof body.email === 'string') patch.email = body.email;
          if (!Object.keys(patch).length) return json(res, 400, { ok: false, error: 'Nothing to update.' });
          // Reflect immediately in the read model, and queue for the desktop.
          // The version has to come off the snapshot ROW: `authRec` is a
          // payload, `payload.version` does not exist, and the store keeps the
          // higher version — so this always went up as 2 and was dropped on the
          // floor once the desktop had pushed a third.
          const authRow = (await store.listSnapshots(claims.school_id, 'parent_auth'))
            .find(a => a.entity_key === `parent:${claims.parent_id}`);
          await store.upsertSnapshot(claims.school_id, {
            entity_type: 'parent_auth', entity_key: `parent:${claims.parent_id}`,
            uuid: authRow ? authRow.uuid : undefined,
            op: 'upsert', version: ((authRow && authRow.version) || 1) + 1,
            payload: { ...authRec, ...patch },
          });
          await store.enqueueChange(claims.school_id, { type: 'parent_update', payload: { parent_id: claims.parent_id, ...patch } });
          return json(res, 200, { ok: true });
        }

        return json(res, 404, { ok: false, error: 'not found' });
      }

      // ── The gateway's webhook (public by necessity) ──
      // The gateway has no account here, so this route is open — and therefore
      // the most carefully guarded one in the service. The signature is
      // checked over the RAW bytes against the school's own secret before the
      // body is believed about anything, a bad one is answered 401 and
      // nothing else, and the amount is never read from the body: settlement
      // asks the gateway directly. See src/payments.js.
      if (p.startsWith('/api/v1/payments/webhook/') && req.method === 'POST') {
        const schoolId = decodeURIComponent(p.split('/').pop());
        const raw = await readRawBody(req);
        const cfg = await cloudPayments.config(store, schoolId);
        const signature = req.headers['x-paystack-signature'] || req.headers['x-signature'] || '';
        if (!cfg || !cloudPayments.verifyWebhook(cfg.secret, signature, raw)) {
          return json(res, 401, { ok: false, error: 'Unauthorized' });
        }
        let payload = {};
        try { payload = raw ? JSON.parse(raw) : {}; } catch (_) { payload = {}; }
        // Answer at once. A webhook that times out is a webhook the gateway
        // retries, and retries are how duplicate work gets attempted.
        json(res, 200, { ok: true });
        if (payload && payload.event === 'charge.success' && payload.data && payload.data.reference) {
          try { await cloudPayments.settle(store, schoolId, payload.data.reference); } catch (_) {}
        }
        return undefined;
      }

      // ── School-key endpoints (desktop host + portal backend) ──
      if (p.startsWith('/api/v1/')) {
        const key = req.headers['x-school-key'];
        const school = key ? await store.getSchoolByKey(key) : null;
        if (!school) return json(res, 401, { ok: false, error: 'invalid school key' });

        if (p === '/api/v1/sync/ping' && req.method === 'GET') return json(res, 200, { ok: true, school: { id: school.school_id, name: school.name } });

        if (p === '/api/v1/sync/push' && req.method === 'POST') {
          const body = await readBody(req);
          const records = Array.isArray(body.records) ? body.records : [];
          const accepted = [];
          for (const r of records) {
            if (!r || !r.entity_type || !r.entity_key) continue;
            await store.upsertSnapshot(school.school_id, r);
            if (r.uuid) accepted.push(r.uuid);
          }
          return json(res, 200, { ok: true, accepted });
        }

        if (p === '/api/v1/sync/pull' && req.method === 'GET') {
          const { changes, cursor } = await store.changesSince(school.school_id, q.since || '0');
          return json(res, 200, { ok: true, cursor, changes });
        }

        if (p === '/api/v1/admin/snapshots' && req.method === 'GET') {
          const snaps = await store.listSnapshots(school.school_id, q.type || null);
          return json(res, 200, { ok: true, snapshots: snaps });
        }

        // The school's gateway, pushed by its own desktop when the school
        // switches internet payments on. Write only: there is no route that
        // reads `secret` back, and there must never be one. A school changing
        // its key re-enters it on the desktop, which is where it came from.
        if (p === '/api/v1/admin/payment-config' && req.method === 'POST') {
          const body = await readBody(req);
          if (typeof store.setPaymentConfig !== 'function') {
            return json(res, 501, { ok: false, error: 'This service does not hold gateway configuration.' });
          }
          const gateway = String(body.gateway || 'none');
          if (gateway !== 'none' && !String(body.secret || '')) {
            return json(res, 400, { ok: false, error: 'A gateway needs its secret key.' });
          }
          await store.setPaymentConfig(school.school_id, gateway === 'none' ? null : {
            gateway,
            secret: String(body.secret),
            public_key: String(body.public_key || ''),
            base_url: String(body.base_url || ''),
            currency: String(body.currency || 'GHS'),
            callback_url: String(body.callback_url || ''),
            min_amount: Number(body.min_amount) || 1,
            max_amount: Number(body.max_amount) || 10000,
            enabled: body.enabled !== false,
          });
          return json(res, 200, { ok: true, gateway, configured: gateway !== 'none' });
        }

        if (p === '/api/v1/admin/enqueue-change' && req.method === 'POST') {
          const body = await readBody(req);
          if (!body.type) return json(res, 400, { ok: false, error: 'type required' });
          const id = await store.enqueueChange(school.school_id, { type: body.type, payload: body.payload || {} });
          return json(res, 200, { ok: true, id });
        }

        return json(res, 404, { ok: false, error: 'not found' });
      }

      return json(res, 404, { ok: false, error: 'not found' });
    } catch (e) {
      json(res, 500, { ok: false, error: 'server error' });
    }
  });
}

module.exports = { createServer };
