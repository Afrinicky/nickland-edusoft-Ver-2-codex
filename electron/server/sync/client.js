// Nickland Edusoft — Cloud sync client (desktop side)
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Pushes outbox projections up to the portal and pulls cloud-origin changes
// (parent profile edits, etc.) down, reconciling them locally. Authenticated
// with the per-school API key. Never throws; safe to call on a timer.
//
// Cloud API contract (the Neon-backed portal implements this):
//   POST {base}/api/v1/sync/push   headers: x-school-key
//        body: { school_id, records:[{uuid,entity_type,entity_key,op,payload,version}] }
//        → { ok:true, accepted:[uuid…] }
//   GET  {base}/api/v1/sync/pull?since=<cursor>   headers: x-school-key
//        → { ok:true, cursor:<next>, changes:[{type, payload}] }

const { getSetting, setSetting } = require('../../utils/idgen');
const { httpJson } = require('../gateways/http');
const outbox = require('./outbox');

function config(db) {
  return {
    enabled: getSetting(db, 'cloud_sync_enabled', 'false') === 'true',
    base: (getSetting(db, 'cloud_base_url', '') || '').replace(/\/+$/, ''),
    key: getSetting(db, 'school_api_key', ''),
    schoolId: getSetting(db, 'cloud_school_id', ''),
    cursor: getSetting(db, 'cloud_cursor', '0'),
    batch: Math.max(1, parseInt(getSetting(db, 'cloud_push_batch', '100'), 10) || 100),
  };
}

function retentionDays(db) {
  return Math.max(1, parseInt(getSetting(db, 'cloud_outbox_retention_days', '14'), 10) || 14);
}

// The cloud must be reached over TLS: the school API key and the projected
// parent password hashes both travel in these requests. Plain http is allowed
// only for loopback, which is what the test suites point at.
function insecureBase(base) {
  try {
    const u = new URL(base);
    if (u.protocol === 'https:') return false;
    return !['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname);
  } catch (_) { return true; }
}

function configured(db) {
  const c = config(db);
  return !!(c.base && c.key);
}

// Shared guard for push/pull: returns an error string, or null when good to go.
function blockedReason(db) {
  const c = config(db);
  if (!c.enabled) return 'disabled';
  if (!configured(db)) return 'not_configured';
  if (insecureBase(c.base)) return 'insecure_url';
  return null;
}

async function push(db) {
  const blocked = blockedReason(db);
  if (blocked) return { ok: false, error: blocked };
  const c = config(db);
  const rows = outbox.listUnsynced(db, c.batch);
  if (!rows.length) return { ok: true, pushed: 0 };
  const records = rows.map(r => ({
    uuid: r.uuid, entity_type: r.entity_type, entity_key: r.entity_key,
    op: r.op, version: r.version,
    payload: r.payload_json ? safeParse(r.payload_json) : null,
  }));
  const res = await httpJson(`${c.base}/api/v1/sync/push`, {
    method: 'POST',
    headers: { 'x-school-key': c.key },
    body: { school_id: c.schoolId, records },
  });
  if (res.status >= 200 && res.status < 300 && res.json && res.json.ok) {
    // Mark accepted (by uuid) synced; fall back to all in the batch on a bare ok.
    const accepted = new Set(res.json.accepted || records.map(r => r.uuid));
    const okIds = rows.filter(r => accepted.has(r.uuid)).map(r => r.id);
    outbox.markSynced(db, okIds);
    // Records the cloud silently declined (missing from `accepted`) used to be
    // left untouched, so they were re-sent on every tick forever. Count them as
    // failures so they take the normal backoff and eventually park.
    const rejectedIds = rows.filter(r => !accepted.has(r.uuid)).map(r => r.id);
    if (rejectedIds.length) outbox.markFailed(db, rejectedIds, 'not_accepted_by_cloud');
    try { setSetting(db, 'cloud_last_push_at', new Date().toISOString(), 'cloud'); } catch (_) {}
    try { outbox.pruneSynced(db, retentionDays(db)); } catch (_) {}
    return { ok: true, pushed: okIds.length, rejected: rejectedIds.length };
  }
  outbox.markFailed(db, rows.map(r => r.id), (res.json && res.json.error) || res.error || `http_${res.status}`);
  return { ok: false, error: (res.json && res.json.error) || res.error || `push_failed_${res.status}` };
}

async function pull(db) {
  const blocked = blockedReason(db);
  if (blocked) return { ok: false, error: blocked };
  const c = config(db);
  const res = await httpJson(`${c.base}/api/v1/sync/pull?since=${encodeURIComponent(c.cursor)}`, {
    headers: { 'x-school-key': c.key },
  });
  if (!(res.status >= 200 && res.status < 300 && res.json && res.json.ok)) {
    return { ok: false, error: (res.json && res.json.error) || res.error || `pull_failed_${res.status}` };
  }
  const changes = res.json.changes || [];
  let applied = 0;
  for (const ch of changes) { if (applyChange(db, ch)) applied++; }
  if (res.json.cursor != null) {
    try { setSetting(db, 'cloud_cursor', String(res.json.cursor), 'cloud'); } catch (_) {}
  }
  try { setSetting(db, 'cloud_last_pull_at', new Date().toISOString(), 'cloud'); } catch (_) {}
  return { ok: true, applied, cursor: res.json.cursor };
}

// Apply one cloud-origin change locally. Whitelisted + authority-aware: parent
// profile is cloud-authoritative; school operational data is never overwritten
// from the cloud here.
function applyChange(db, change) {
  try {
    if (!change || !change.type) return false;
    if (change.type === 'parent_update') {
      const p = change.payload || {};
      if (!p.parent_id) return false;
      const fields = []; const vals = [];
      for (const [k, col] of Object.entries({ full_name: 'full_name', phone: 'phone', email: 'email' })) {
        if (p[k] !== undefined) { fields.push(`${col} = ?`); vals.push(p[k]); }
      }
      if (!fields.length) return false;
      vals.push(p.parent_id);
      db.prepare(`UPDATE parents SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
      return true;
    }
    if (change.type === 'student_contact_update') {
      const p = change.payload || {};
      if (!p.student_id) return false;
      const allowed = ['father_contact', 'mother_contact', 'guardian_contact', 'father_email', 'mother_email', 'guardian_email'];
      const fields = []; const vals = [];
      for (const k of allowed) if (p[k] !== undefined) { fields.push(`${k} = ?`); vals.push(p[k]); }
      if (!fields.length) return false;
      vals.push(p.student_id);
      db.prepare(`UPDATE students SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
      return true;
    }
    return false; // unknown types ignored (forward-compatible)
  } catch (_) { return false; }
}

function safeParse(s) { try { return JSON.parse(s); } catch (_) { return null; } }

async function syncOnce(db) {
  const p = await push(db).catch(() => ({ ok: false }));
  const q = await pull(db).catch(() => ({ ok: false }));
  return { push: p, pull: q };
}

module.exports = { config, configured, blockedReason, insecureBase, push, pull, applyChange, syncOnce };
