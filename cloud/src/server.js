// Nickland Edusoft Cloud — multi-tenant portal + sync API
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Implements the contract the desktop sync client talks to (see
// docs/CLOUD_SYNC.md). Every request is scoped to a tenant (school) by the
// per-school API key. The cloud holds only the thin read model + a change
// queue — the desktop remains the source of truth.

const http = require('http');
const url = require('url');

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-school-key, Content-Type', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = ''; let big = false;
    req.on('data', (c) => { d += c; if (d.length > 5e6) { big = true; req.destroy(); } });
    req.on('end', () => { if (big) return resolve({}); try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function createServer(store) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return json(res, 204, {});
      const parsed = url.parse(req.url, true);
      const p = parsed.pathname;

      if (p === '/health' || p === '/api/v1/health') return json(res, 200, { ok: true, store: store.kind });

      // All /api/v1/sync/* and /api/v1/portal/* require a valid school key.
      if (p.startsWith('/api/v1/')) {
        const key = req.headers['x-school-key'];
        const school = key ? await store.getSchoolByKey(key) : null;
        if (!school) return json(res, 401, { ok: false, error: 'invalid school key' });

        if (p === '/api/v1/sync/ping' && req.method === 'GET') {
          return json(res, 200, { ok: true, school: { id: school.school_id, name: school.name } });
        }

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
          const { changes, cursor } = await store.changesSince(school.school_id, parsed.query.since || '0');
          return json(res, 200, { ok: true, cursor, changes });
        }

        // Portal read model — what the school's web page renders.
        if (p === '/api/v1/portal/snapshots' && req.method === 'GET') {
          const snaps = await store.listSnapshots(school.school_id, parsed.query.type || null);
          return json(res, 200, { ok: true, snapshots: snaps });
        }

        // Queue a cloud→local change (e.g. a parent edited their profile on the
        // web). The portal backend calls this; the desktop picks it up on pull.
        if (p === '/api/v1/portal/enqueue-change' && req.method === 'POST') {
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
