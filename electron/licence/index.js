// Nickland Edusoft — is this installation still paid for?
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The desktop is the source of truth and it runs without the internet. That is
// the product's best feature and it is also the hole: a school that stops
// paying could pull out the network cable and keep running forever.
//
// It cannot be closed by asking this machine nicely. Anything decided here can
// be changed here — a flag in the SQLite file is a flag a bursar can edit. So
// the decision is made in the cloud, where the school has no access, and
// arrives as a short-lived lease signed with a key the school does not have:
//
//     {school_id, access, features, not_after}  +  Ed25519 signature
//
// This file carries only the PUBLIC half, which can check a signature and can
// never make one. So a lease can be read, and refused, and not forged.
//
// ── What it actually stops ──────────────────────────────────────────────────
//
// Not a determined person with a debugger. Nothing shipped to somebody else's
// computer stops that, and pretending otherwise leads to spending months on
// obfuscation that buys an afternoon. What it stops is every realistic thing:
//
//   going offline and staying there   the lease expires and will not renew
//   winding the clock back            the high-water mark below
//   copying the folder to another PC  the lease names the machine it is for
//   reinstalling to get a new trial   the cloud remembers the school, not the install
//   editing the licence row by hand   the signature stops matching
//
// ── And it never destroys anything ──────────────────────────────────────────
//
// An expired lease means READ-ONLY, not a locked door. Every record readable,
// every report printable, every export available, and not one new mark,
// payment or pupil. A school that has fallen behind still needs to get its
// data out, and holding it hostage would be both wrong and a reason never to
// buy this software.

const crypto = require('crypto');
const os = require('os');
const { getSetting, setSetting } = require('../utils/idgen');

// The deployment this build talks to. Overridable per install for a private
// deployment (see `licence:public-key` in the settings), because a school on
// somebody else's Edusoft cloud needs that cloud's key, not ours.
const BUILTIN_PUBLIC_KEY = process.env.EDUSOFT_LICENCE_KEY || '';

const SETTINGS = {
  token: 'licence_token',
  key: 'licence_public_key',
  device: 'licence_device_id',
  // The latest moment this installation has ever known about. See `clockOk`.
  highWater: 'licence_high_water',
  // When this installation was first run. See ACTIVATION_DAYS.
  firstRun: 'licence_first_run',
  lastCheck: 'licence_last_check',
  lastError: 'licence_last_error',
};

// A licence that has never been fetched at all. A school that has just
// installed has one of these, and it is not an error — it is the state the
// first sync clears.
const UNLICENSED = 'unlicensed';

// How long a brand-new installation works before it has to have collected a
// licence. Without this, the very first run of the very first install would be
// read-only, which is a terrible way to meet a customer — and an existing
// school updating to this version would arrive on Monday to a system that had
// locked itself overnight, which is worse.
//
// So a month, on the clock, from the first time this code runs on this
// database. It is not a second free trial: the trial is the CLOUD's, counted
// per school, and a school that reinstalls to get another month gets a fresh
// database with none of their pupils in it, which is not a trade anybody makes.
const ACTIVATION_DAYS = 30;

function firstRun(db, now = Date.now()) {
  const stored = Number(getSetting(db, SETTINGS.firstRun, '0')) || 0;
  if (stored) return stored;
  try { setSetting(db, SETTINGS.firstRun, String(now), 'licence'); } catch (_) {}
  return now;
}

function b64url(text) {
  const s = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(s + '='.repeat((4 - (s.length % 4)) % 4), 'base64');
}

// ── Which machine is this ───────────────────────────────────────────────────
// Stable enough to survive a reboot and a Windows update, and different enough
// between two computers that a copied licence folder does not validate. Hashed
// so that what is stored and sent is not itself a MAC address.
function deviceId(db) {
  const stored = db ? getSetting(db, SETTINGS.device, '') : '';
  if (stored) return stored;
  const parts = [os.hostname(), os.platform(), os.arch()];
  try {
    const nets = os.networkInterfaces();
    const macs = Object.keys(nets).sort().flatMap((name) => (nets[name] || [])
      .filter((n) => n.mac && n.mac !== '00:00:00:00:00:00' && !n.internal)
      .map((n) => n.mac));
    if (macs.length) parts.push(macs.sort()[0]);
  } catch (_) { /* a machine with no network still gets an id */ }
  const id = crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
  if (db) { try { setSetting(db, SETTINGS.device, id, 'licence'); } catch (_) {} }
  return id;
}

function publicKeyPem(db) {
  const raw = (db && getSetting(db, SETTINGS.key, '')) || BUILTIN_PUBLIC_KEY;
  if (!raw) return null;
  try {
    const key = b64url(raw);
    if (key.length !== 32) return null;
    // Ed25519 raw public key wrapped in the SPKI header Node's KeyObject wants.
    const der = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'), key,
    ]);
    return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch (_) { return null; }
}

// ── Has somebody wound the clock back? ──────────────────────────────────────
// Every licence check records the latest moment this installation has seen —
// from the server's own `issued_at`, which cannot be influenced from here.
// A system clock EARLIER than that has moved backwards, and the only ordinary
// reason for that is somebody trying to make an expired lease look current.
function highWater(db) {
  return Number(getSetting(db, SETTINGS.highWater, '0')) || 0;
}

function noteTime(db, moment) {
  const at = Number(moment) || 0;
  if (at > highWater(db)) {
    try { setSetting(db, SETTINGS.highWater, String(at), 'licence'); } catch (_) {}
  }
}

function clockOk(db, now = Date.now()) {
  // A day of slack: a laptop that has been off over a holiday, a timezone
  // corrected by hand, an NTP step. A day is far too small to outrun a lease
  // and far too large to trip over honestly.
  return now >= highWater(db) - 24 * 60 * 60 * 1000;
}

// ── Reading the lease ───────────────────────────────────────────────────────
function verify(db, token) {
  if (!token) return { ok: false, reason: UNLICENSED };
  const [body, signature] = String(token).split('.');
  if (!body || !signature) return { ok: false, reason: 'malformed' };

  let payload;
  try { payload = JSON.parse(b64url(body).toString('utf8')); }
  catch (_) { return { ok: false, reason: 'malformed' }; }

  const key = publicKeyPem(db);
  if (!key) {
    // This build does not know which cloud to trust. Refusing every school
    // because OUR build was shipped without a key would be our mistake
    // punishing them, so it runs — and says, in the diagnostics, that the
    // licence is unverified.
    return { ok: true, verified: false, licence: payload, reason: 'no_public_key' };
  }
  let good = false;
  try { good = crypto.verify(null, b64url(body), key, b64url(signature)); }
  catch (_) { good = false; }
  if (!good) return { ok: false, reason: 'bad_signature' };

  if (payload.device && payload.device !== deviceId(db)) {
    // The lease is genuine and it is not this machine's. Somebody has copied
    // an installation, which is the one case here that is deliberate.
    return { ok: false, reason: 'wrong_device', licence: payload };
  }
  return { ok: true, verified: true, licence: payload };
}

// ── What may this installation do, right now ────────────────────────────────
function state(db, now = Date.now()) {
  const token = getSetting(db, SETTINGS.token, '');
  const read = verify(db, token);

  if (!read.ok) {
    // Never licensed, and still inside the activation window: full use, with a
    // notice that gets more pointed as the month runs down.
    if (read.reason === UNLICENSED) {
      const since = firstRun(db, now);
      const left = Math.ceil((since + ACTIVATION_DAYS * 86400000 - now) / 86400000);
      if (left > 0 && clockOk(db, now)) {
        return {
          access: 'full', reason: 'activation', verified: false,
          days_left: left,
          message: `This copy has not been connected to the school portal yet. `
            + `Connect it within ${left} day${left === 1 ? '' : 's'} — Settings → `
            + `Cloud sync — or it will become read-only.`,
          licence: null,
        };
      }
    }
    return {
      access: 'read_only',
      reason: read.reason,
      verified: false,
      message: MESSAGES[read.reason] || MESSAGES.read_only,
      licence: read.licence || null,
    };
  }

  const licence = read.licence || {};
  noteTime(db, Date.parse(licence.issued_at || '') || 0);

  if (!clockOk(db, now)) {
    return {
      access: 'read_only', reason: 'clock', verified: read.verified,
      message: MESSAGES.clock, licence,
    };
  }

  const notAfter = Date.parse(licence.not_after || '') || 0;
  const graceMs = Math.max(0, Number(licence.offline_grace_days) || 0) * 86400000;

  if (notAfter && now > notAfter + graceMs) {
    return {
      access: 'read_only', reason: 'lease_expired', verified: read.verified,
      message: MESSAGES.lease_expired, licence,
      renew_url: licence.renew_url || '',
    };
  }

  // The lease itself is current. What it SAYS is then the answer — a school
  // that is suspended in the cloud is suspended here, which is what makes
  // suspension mean the same thing on all three of the portal, the phone and
  // this machine.
  const access = licence.access === 'blocked' ? 'blocked'
    : licence.access === 'read_only' ? 'read_only' : 'full';

  const stale = notAfter && now > notAfter;
  return {
    access,
    reason: access === 'full' ? (stale ? 'offline_grace' : 'ok') : 'subscription',
    verified: read.verified,
    message: access === 'full'
      ? (stale ? MESSAGES.offline_grace : '')
      : (licence.status_label ? `This subscription is ${String(licence.status_label).toLowerCase()}.`
         : MESSAGES.read_only),
    licence,
    renew_url: licence.renew_url || '',
    expires_at: licence.not_after || '',
  };
}

const MESSAGES = {
  unlicensed: 'This installation has not been activated yet. Connect it to the '
    + 'school portal once — Settings → Cloud sync — and it will collect its licence.',
  malformed: 'The licence on this computer could not be read. It will be replaced '
    + 'the next time this computer reaches the portal.',
  bad_signature: 'The licence on this computer is not one we issued. Connect to the '
    + 'portal to collect a genuine one.',
  wrong_device: 'This licence was issued to a different computer. Each computer '
    + 'collects its own — connect this one to the portal.',
  clock: 'This computer’s clock is set earlier than it should be. Correct the date '
    + 'and time, then connect to the portal.',
  lease_expired: 'This copy has not reached the portal in a while and can only be '
    + 'read until it does. Nothing has been lost. Connect it to the internet, or '
    + 'renew the subscription, and everything comes straight back.',
  offline_grace: 'This copy has not reached the portal recently. Connect it to the '
    + 'internet soon so it can renew its licence.',
  read_only: 'This subscription is not active, so the system can be read but not '
    + 'changed. Nothing has been deleted.',
};

// ── Storing one ─────────────────────────────────────────────────────────────
function install(db, token, licence) {
  const read = verify(db, token);
  if (!read.ok) return { ok: false, error: read.reason };
  try {
    setSetting(db, SETTINGS.token, token, 'licence');
    setSetting(db, SETTINGS.lastCheck, new Date().toISOString(), 'licence');
    setSetting(db, SETTINGS.lastError, '', 'licence');
  } catch (_) { return { ok: false, error: 'not_stored' }; }
  noteTime(db, Date.parse((licence || read.licence || {}).issued_at || '') || Date.now());
  return { ok: true, licence: read.licence };
}

function recordFailure(db, error) {
  try {
    setSetting(db, SETTINGS.lastCheck, new Date().toISOString(), 'licence');
    setSetting(db, SETTINGS.lastError, String(error || '').slice(0, 200), 'licence');
  } catch (_) {}
}

function setPublicKey(db, raw) {
  setSetting(db, SETTINGS.key, String(raw || '').trim(), 'licence');
}

// Whether a given action may proceed. `view` always may — see the header:
// read-only means readable, and a school locked out of its own register is a
// school that cannot even work out what it owes.
function allows(db, action, now = Date.now()) {
  const current = state(db, now);
  if (current.access === 'full') return { ok: true, state: current };
  if (current.access === 'blocked') return { ok: false, state: current };
  return { ok: action === 'view', state: current };
}

module.exports = {
  SETTINGS, UNLICENSED, MESSAGES, ACTIVATION_DAYS, firstRun,
  deviceId, publicKeyPem, verify, state, install, recordFailure, setPublicKey,
  allows, clockOk, highWater, noteTime,
};
