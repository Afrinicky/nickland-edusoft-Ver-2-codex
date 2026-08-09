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

      // Website (SPA) — served at the root and /portal.
      if (req.method === 'GET' && (p === '/' || p === '/portal' || p === '/app')) return html(res, SITE);
      if (p === '/health' || p === '/api/v1/health') return json(res, 200, { ok: true, store: store.kind });

      // ── Public portal endpoints ──
      if (p === '/api/v1/portal/schools' && req.method === 'GET') {
        const schools = await store.listSchools();
        return json(res, 200, { ok: true, schools });
      }
      if (p === '/api/v1/portal/login' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body.school_id || !body.identifier || !body.password) return json(res, 400, { ok: false, error: 'school, identifier and password are required' });
        const auths = await store.listSnapshots(body.school_id, 'parent_auth');
        const np = pauth.normPhone(body.identifier);
        const em = String(body.identifier).trim().toLowerCase();
        const rec = auths.map(a => a.payload).find(pl =>
          pl && pl.is_active && (pauth.normPhone(pl.phone) === np || (pl.email || '').toLowerCase() === em));
        if (!rec || !pauth.verifyPassword(body.password, rec.password_hash)) return json(res, 401, { ok: false, error: 'Invalid credentials.' });
        const token = pauth.signToken({ school_id: body.school_id, parent_id: rec.parent_id });
        return json(res, 200, { ok: true, token, parent: { full_name: rec.full_name, phone: rec.phone, email: rec.email } });
      }

      // ── Parent-token portal endpoints ──
      if (p.startsWith('/api/v1/portal/')) {
        const claims = pauth.verifyToken(bearer(req));
        if (!claims) return json(res, 401, { ok: false, error: 'Please sign in.' });
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
          await store.upsertSnapshot(claims.school_id, {
            entity_type: 'parent_auth', entity_key: `parent:${claims.parent_id}`,
            uuid: authRec.uuid, op: 'upsert', version: (authRec.version || 1) + 1,
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
