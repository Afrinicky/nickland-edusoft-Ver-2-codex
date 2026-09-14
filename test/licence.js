// Nickland Edusoft — the licence, on the machine it has to hold up on.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/licence.js       (requires Node >= 22.5)
//
// The cloud half is tested in cloud-python/tests/test_licensing.py. This is the
// half that runs on somebody else's computer, where every assumption is
// somebody's to break, and it is about the four ways a person actually tries:
//
//   stay offline          the lease runs out
//   wind the clock back   the high-water mark catches it
//   copy the folder       the lease names a machine
//   edit the database     the signature stops matching
//
// And the rule none of them may break: an expired licence means READ-ONLY.
// Every record readable, every report printable, nothing deleted, ever. A
// school locked out of its own register is a school that would be right never
// to buy this.

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`These tests need Node >= 22.5 (running ${process.versions.node}).`);
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { SCHEMA, runMigrations } = require(path.join(ROOT, 'electron/db/database.js'));
const { setSetting, getSetting } = require(path.join(ROOT, 'electron/utils/idgen.js'));
const licence = require(path.join(ROOT, 'electron/licence'));
const { licenceRefusal } = require(path.join(ROOT, 'electron/ipc/_guard.js'));

let pass = 0, fail = 0;
const ck = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log((cond ? '✓' : '✗') + ' ' + name);
  if (!cond && extra !== undefined) console.log('    ', extra);
};

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...a) => {
    db.exec('BEGIN');
    try { const r = fn(...a); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  db.exec(SCHEMA);
  runMigrations(db);
  return db;
}

// A stand-in for the cloud's signer. Same algorithm, same encoding — if these
// two ever disagree, this file is where it shows up rather than a school's PC.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'der' }).slice(-32)
  .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64 = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function mint(claims) {
  const payload = {
    v: 1, school_id: 'ave', device: '', access: 'full', status: 'ACTIVE',
    status_label: 'Active', plan_id: 'pro', plan_name: 'Pro', features: [],
    managed: true, issued_at: new Date().toISOString(),
    not_after: new Date(Date.now() + 14 * 86400000).toISOString(),
    offline_grace_days: 7, renew_url: 'https://ave.edusoft.gh/billing?renew=1',
    ...claims,
  };
  const body = JSON.stringify(payload, Object.keys(payload).sort());
  const canonical = Buffer.from(JSON.stringify(
    Object.fromEntries(Object.keys(payload).sort().map((k) => [k, payload[k]]))));
  return { token: `${b64(canonical)}.${b64(crypto.sign(null, canonical, privateKey))}`, payload };
}

const DAY = 86400000;

// ── A fresh install ─────────────────────────────────────────────────────────
{
  const db = makeDb();
  const now = Date.now();
  ck('a brand-new install works, and says it needs connecting',
    licence.state(db, now).access === 'full'
    && licence.state(db, now).reason === 'activation');
  ck('...with a month to do it', licence.state(db, now).days_left === 30);
  ck('...and after that month it is read-only, not broken',
    licence.state(db, now + 31 * DAY).access === 'read_only');
  // The one that matters: a school past its activation window can still READ.
  ck('...where reading still works', licence.allows(db, 'view', now + 31 * DAY).ok);
  ck('...and writing does not', !licence.allows(db, 'edit', now + 31 * DAY).ok);
}

// ── A real lease ────────────────────────────────────────────────────────────
{
  const db = makeDb();
  licence.setPublicKey(db, PUB);
  const device = licence.deviceId(db);
  const { token } = mint({ device });

  ck('a genuine lease installs', licence.install(db, token).ok);
  const state = licence.state(db);
  ck('...and is verified, not merely believed', state.verified === true);
  ck('...and grants what it says', state.access === 'full' && state.reason === 'ok');
  ck('...and carries the address that renews it', /renew=1$/.test(state.renew_url));

  // Offline, inside the grace that follows the lease.
  const justAfter = Date.parse(state.licence.not_after) + 2 * DAY;
  ck('a few days offline past the lease still works',
    licence.state(db, justAfter).access === 'full');
  ck('...and says so, so somebody can act before it bites',
    licence.state(db, justAfter).reason === 'offline_grace');

  // Offline past the grace as well.
  const wayAfter = Date.parse(state.licence.not_after) + 9 * DAY;
  ck('staying offline past the grace drops to read-only',
    licence.state(db, wayAfter).access === 'read_only');
  ck('...for the right reason', licence.state(db, wayAfter).reason === 'lease_expired');
  ck('...and STILL nothing is lost — reading works',
    licence.allows(db, 'view', wayAfter).ok);
}

// ── The four ways people try ────────────────────────────────────────────────
{
  const db = makeDb();
  licence.setPublicKey(db, PUB);
  const device = licence.deviceId(db);
  licence.install(db, mint({ device }).token);

  // 1. Wind the clock back.
  const back = licence.state(db, Date.now() - 10 * DAY);
  ck('winding the clock back is caught', back.access === 'read_only' && back.reason === 'clock');
  ck('...but a day of honest drift is not',
    licence.state(db, Date.now() - 2 * 3600 * 1000).access === 'full');

  // 2. Copy the installation to another computer.
  setSetting(db, licence.SETTINGS.device, 'a-different-computer', 'licence');
  ck('a lease copied to another machine is refused',
    licence.state(db).reason === 'wrong_device');
}
{
  // 3. Edit the licence row by hand.
  const db = makeDb();
  licence.setPublicKey(db, PUB);
  const { token } = mint({ device: licence.deviceId(db), access: 'full' });
  const [body, signature] = token.split('.');
  const raw = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  raw.not_after = new Date(Date.now() + 3650 * DAY).toISOString();
  const edited = b64(Buffer.from(JSON.stringify(
    Object.fromEntries(Object.keys(raw).sort().map((k) => [k, raw[k]])))));
  setSetting(db, licence.SETTINGS.token, `${edited}.${signature}`, 'licence');
  ck('a lease edited to last ten years is refused',
    licence.state(db).reason === 'bad_signature');

  // 4. Sign your own.
  const other = crypto.generateKeyPairSync('ed25519');
  const mine = Buffer.from(JSON.stringify({ access: 'full', school_id: 'ave' }));
  setSetting(db, licence.SETTINGS.token,
    `${b64(mine)}.${b64(crypto.sign(null, mine, other.privateKey))}`, 'licence');
  ck('a lease signed with somebody else’s key is refused',
    licence.state(db).reason === 'bad_signature');
}

// ── Suspension reaches this machine ─────────────────────────────────────────
{
  const db = makeDb();
  licence.setPublicKey(db, PUB);
  licence.install(db, mint({
    device: licence.deviceId(db), access: 'read_only',
    status: 'SUSPENDED', status_label: 'Suspended' }).token);
  const state = licence.state(db);
  ck('a school suspended in the cloud is suspended here too',
    state.access === 'read_only' && state.reason === 'subscription');
  ck('...and is told which, in words', /suspended/i.test(state.message), state.message);
  ck('...and can still read every record it has', licence.allows(db, 'view').ok);
}

// ── The gate the whole application passes through ───────────────────────────
{
  const db = makeDb();
  licence.setPublicKey(db, PUB);
  licence.install(db, mint({ device: licence.deviceId(db), access: 'read_only' }).token);

  ck('reading a class list is allowed', licenceRefusal(db, 'students:list') === null);
  const refused = licenceRefusal(db, 'students:create');
  ck('adding a pupil is not', refused && refused.denied === true);
  ck('...and the refusal says it is about the licence, not permissions',
    refused && refused.licence === true);
  ck('...and carries the address that fixes it', refused && refused.renew_url);

  // The exemptions, each of which exists so a school is not stuck.
  for (const channel of ['auth:login', 'session:get', 'cloud:configure',
                         'licence:activate', 'backup:create', 'dashboard:summary']) {
    ck(`${channel} works regardless — it is how a school gets out`,
      licenceRefusal(db, channel) === null);
  }

  // And the rule an administrator does not outrank.
  ck('an administrator cannot write on an unpaid copy either',
    licenceRefusal(db, 'fees:record-payment') !== null);
}

// ── Talking to the cloud ────────────────────────────────────────────────────
{
  const db = makeDb();
  ck('an install with no portal address cannot activate',
    require(path.join(ROOT, 'electron/licence/refresh.js')).endpoint(db) === null);
  setSetting(db, 'cloud_base_url', 'https://portal.example');
  setSetting(db, 'school_api_key', 'sk_device_token');
  const where = require(path.join(ROOT, 'electron/licence/refresh.js')).endpoint(db);
  ck('...and one with both can', where && where.key === 'sk_device_token');
  // The device token is stored where the school key used to be, because the
  // cloud resolves either — see main.require_school.
  ck('the machine identifies itself with a stable id',
    licence.deviceId(db) === licence.deviceId(db) && licence.deviceId(db).length === 32);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
