// Nickland Edusoft Cloud — sign-in throttle.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The desktop's own API throttles its login endpoint, for a reason that
// applies far more strongly here: these endpoints are on the public internet,
// and one of them now takes STAFF credentials — an account that can read a
// school's roster and write its registers. Unthrottled, a school's teacher
// passwords are a weekend's work for anyone who finds the portal.
//
// Keyed by source AND by the account being targeted, deliberately:
//   • IP alone lets an attacker rotate addresses, and locks out a whole
//     school behind one NAT'd connection when the day's first parent
//     mistypes their password;
//   • account alone lets one attacker lock every teacher out of the system
//     by failing against each username in turn — but paired with the IP
//     limit it is the thing that actually stops a slow distributed guess.
//
// In-memory, per process. Render runs several uvicorn/node workers, so the
// real limit is this times the worker count — still three orders of magnitude
// below what a password guess needs, and without the operational weight of
// putting a shared counter in Postgres on the login path.

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

const attempts = new Map();

// Behind Render or Vercel the socket address is the proxy's, so the caller's
// address is the first entry of X-Forwarded-For. It is spoofable by anyone
// talking to the service directly — which is why the per-account limit exists
// and does not depend on it.
function clientIp(req) {
  const fwd = req && req.headers && req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req && req.socket && req.socket.remoteAddress) || '';
}

function sweep(now) {
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

// True when this attempt should be refused. Call once per sign-in attempt.
function limited(req, scope, identifier) {
  const now = Date.now();
  sweep(now);
  let hit = bump(`ip:${scope}:${clientIp(req)}`, now);
  if (identifier) {
    hit = bump(`id:${scope}:${String(identifier).toLowerCase().slice(0, 120)}`, now) || hit;
  }
  return hit;
}

// Tests need a clean slate between cases.
function reset() { attempts.clear(); }

module.exports = { limited, reset, clientIp, WINDOW_MS, MAX_PER_WINDOW };
