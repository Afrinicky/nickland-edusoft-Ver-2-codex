// Nickland Edusoft — collecting a fresh licence from the portal.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Rides the cloud connection the school has already configured for sync, with
// the same `school_api_key`. Two reasons that matters: there is no second
// credential for anybody to set up or get wrong, and the set of schools that
// can renew a licence is exactly the set that can sync — which is the right
// set.
//
// Called on boot and after every successful sync. Never throws: a portal that
// is down must not stop the office opening, and the lease that is already
// stored covers exactly this (see index.js — a fortnight, by default).

const { httpJson } = require('../server/gateways/http');
const { getSetting } = require('../utils/idgen');
const licence = require('./index');
const sentinel = require('./sentinel');

function endpoint(db) {
  const base = (getSetting(db, 'cloud_base_url', '') || '').replace(/\/+$/, '');
  const key = getSetting(db, 'school_api_key', '');
  return base && key ? { base, key } : null;
}

async function refresh(db, { force = false } = {}) {
  const where = endpoint(db);
  if (!where) return { ok: false, error: 'not_configured' };

  const current = licence.state(db);
  // Nothing is gained by asking every boot while a lease is comfortably
  // current — except load on the portal and a school's mobile data. Asked once
  // a day, and always when something is actually wrong.
  if (!force && current.access === 'full' && current.reason === 'ok') {
    const last = Date.parse(getSetting(db, licence.SETTINGS.lastCheck, '') || '') || 0;
    if (Date.now() - last < 24 * 60 * 60 * 1000) {
      return { ok: true, skipped: 'checked_today', state: current };
    }
  }

  const res = await httpJson(`${where.base}/api/v1/licence`, {
    method: 'POST',
    headers: { 'x-school-key': where.key },
    body: {
      device: licence.deviceId(db),
      build: licence.buildId(),
      // Anything the scattered checks noticed since last time. Reported here
      // rather than acted on locally: the cloud is where a decision cannot be
      // patched out, and a report that arrives minutes after the tampering
      // does not point at the line that produced it.
      integrity: (sentinel.flagged(db) || {}).reason || '',
    },
  });

  if (!(res.status >= 200 && res.status < 300) || !res.json || !res.json.ok) {
    const why = (res.json && res.json.error) || res.error || `http_${res.status}`;
    licence.recordFailure(db, why);
    return { ok: false, error: why, state: licence.state(db) };
  }
  if (!res.json.token) {
    // The portal answered but could not sign — its own signing key is missing.
    // Its problem, not the school's, and the stored lease keeps running.
    licence.recordFailure(db, 'portal_cannot_sign');
    return { ok: false, error: 'portal_cannot_sign', state: licence.state(db) };
  }

  // The cloud has heard about it; stop repeating ourselves. Whatever it
  // decided is in the lease we are about to store.
  sentinel.clear(db);

  const stored = licence.install(db, res.json.token, res.json.licence);
  if (!stored.ok) {
    licence.recordFailure(db, stored.error);
    return { ok: false, error: stored.error, state: licence.state(db) };
  }
  return { ok: true, state: licence.state(db) };
}

// A fresh install has no key to verify with until it has been told which cloud
// it belongs to. Fetched once, unauthenticated, from the portal the school
// already typed in — a public key is public, and a wrong one only ever fails
// closed into read-only.
async function fetchPublicKey(db) {
  const where = endpoint(db);
  if (!where) return { ok: false, error: 'not_configured' };
  const res = await httpJson(`${where.base}/api/v1/licence/key`);
  const key = res.json && res.json.public_key;
  if (!key) return { ok: false, error: 'no_key' };
  licence.setPublicKey(db, key);
  return { ok: true };
}

// Boot, and after each sync. Collects the verifying key first where this
// install has never had one.
async function ensure(db, opts = {}) {
  if (!licence.publicKeyPem(db)) {
    try { await fetchPublicKey(db); } catch (_) { /* offline; the lease stands */ }
  }
  try { return await refresh(db, opts); }
  catch (e) { licence.recordFailure(db, e.message); return { ok: false, error: e.message }; }
}

// ── Activating this installation ────────────────────────────────────────────
// The Adobe and Filmora model, and the whole reason it is a sign-in rather
// than a key to type: the installer is the SAME file for everybody, there is
// nothing secret in it, and what makes a copy legitimate is an account behind
// it. A key printed on an invoice is a key that gets forwarded; an email and
// password are a thing a school does not hand out, because handing them out
// hands out the school.
//
// On success the machine has its own credential — not the school's shared key
// — so deactivating it from Billing cuts off this computer and nothing else.
async function activate(db, { email, password, schoolId, label } = {}) {
  const base = (getSetting(db, 'cloud_base_url', '') || '').replace(/\/+$/, '');
  if (!base) return { ok: false, error: 'no_portal', message: 'Enter the school portal address first.' };

  const os = require('os');
  const res = await httpJson(`${base}/api/v1/activate`, {
    method: 'POST',
    body: {
      email: String(email || '').trim(),
      password: String(password || ''),
      school_id: schoolId || undefined,
      device: licence.deviceId(db),
      build: licence.buildId(),
      label: label || os.hostname(),
      platform: `${os.platform()} ${os.release()}`,
      app: 'desktop',
      app_version: require('../../package.json').version || '',
    },
  });

  const body = res.json || {};
  if (res.status === 300 && body.choose) {
    // This email runs more than one school. Asked rather than guessed.
    return { ok: false, choose: true, schools: body.schools || [], message: body.error };
  }
  if (!(res.status >= 200 && res.status < 300) || !body.ok) {
    return {
      ok: false,
      reason: body.reason || null,
      seats: body.seats || null,
      message: body.error || res.error || 'That did not work. Check the details and try again.',
    };
  }

  // Store what this machine now is. The device token goes in `school_api_key`
  // because that is the header every existing call already sends — the cloud
  // resolves either kind (see main.require_school), so nothing else had to
  // change to make per-device credentials work.
  setSetting(db, 'cloud_base_url', base, 'cloud');
  setSetting(db, 'cloud_school_id', body.school_id || '', 'cloud');
  setSetting(db, 'school_api_key', body.device_token || '', 'cloud');
  if (body.token) licence.install(db, body.token, body.licence);

  return {
    ok: true,
    school: body.school || null,
    returning: !!body.returning,
    seats: body.seats || null,
    state: licence.state(db),
  };
}

module.exports = { refresh, fetchPublicKey, ensure, endpoint, activate };
