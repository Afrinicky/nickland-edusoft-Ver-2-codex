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
          return json(res, 200, {
            ok: true, role: 'staff', mode: 'cloud',
            user: { id: rec.user_id, full_name: rec.full_name, username: rec.username, staff_id: rec.staff_id },
            designation: rec.designation, is_admin: !!rec.is_admin,
            must_change_password: !!rec.must_change_password,
            permissions: rec.permissions || {}, school,
          });
        }

        if (p === '/api/v1/staff/dashboard' && req.method === 'GET') {
          if (!staffApi.can(rec, 'dashboard', 'view')) return deny();
          return send(await staffApi.dashboard(store, sid, rec));
        }

        if (p === '/api/v1/staff/students' && req.method === 'GET') {
          if (!staffApi.can(rec, 'students', 'view')) return deny();
          return send(await staffApi.students(store, sid, q.classId));
        }

        if (p === '/api/v1/staff/debtors' && req.method === 'GET') {
          if (!staffApi.can(rec, 'fees', 'view')) return deny();
          return send(await staffApi.debtors(store, sid));
        }

        if (p === '/api/v1/staff/classes' && req.method === 'GET') {
          if (!staffApi.canAny(rec, [['students', 'view'], ['academics', 'view'], ['canteen', 'view']])) return deny();
          return send(await staffApi.classes(store, sid));
        }

        if (p === '/api/v1/staff/attendance' && req.method === 'GET') {
          if (!staffApi.canAny(rec, [['students', 'view'], ['academics', 'view']])) return deny();
          if (!q.classId || !q.date) return json(res, 400, { ok: false, error: 'classId and date are required.' });
          return send(await staffApi.attendanceSheet(store, sid, q.classId, q.date));
        }
        if (p === '/api/v1/staff/attendance' && req.method === 'POST') {
          if (!staffApi.canAny(rec, [['students', 'edit'], ['academics', 'edit']])) return deny();
          return send(await staffApi.submitAttendance(store, sid, rec, await readBody(req)));
        }

        if (p === '/api/v1/staff/scores/subjects' && req.method === 'GET') {
          if (!staffApi.can(rec, 'academics', 'view')) return deny();
          if (!q.classId) return json(res, 400, { ok: false, error: 'classId is required.' });
          return send(await staffApi.scoreSubjects(store, sid, q.classId));
        }
        if (p === '/api/v1/staff/scores' && req.method === 'GET') {
          if (!staffApi.can(rec, 'academics', 'view')) return deny();
          if (!q.classId || !q.subjectId) return json(res, 400, { ok: false, error: 'classId and subjectId are required.' });
          return send(await staffApi.scoreSheet(store, sid, q.classId, q.subjectId));
        }
        if (p === '/api/v1/staff/scores' && req.method === 'POST') {
          if (!staffApi.can(rec, 'academics', 'edit')) return deny();
          return send(await staffApi.submitScores(store, sid, rec, await readBody(req)));
        }

        if (p.startsWith('/api/v1/staff/canteen/student/') && req.method === 'GET') {
          if (!staffApi.can(rec, 'canteen', 'view')) return deny();
          return send(await staffApi.canteenStudent(store, sid, p.split('/').pop()));
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
          return send(await staffApi.homeworkForClass(store, sid, q.classId));
        }
        if (p === '/api/v1/staff/homework' && req.method === 'POST') {
          if (!staffApi.can(rec, 'academics', 'edit')) return deny();
          return send(await staffApi.submitHomework(store, sid, rec, await readBody(req)));
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
