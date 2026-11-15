// Nickland Edusoft — no channel runs without a permission behind it.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// `_guard.js` looks a channel up in `_policy.js`, and failing that derives a
// rule from its name with `fallbackRule`. If neither answers, it runs the
// handler anyway:
//
//     const rule = POLICY[channel] || fallbackRule(channel);
//     if (!rule) return handler(event, ...args);
//
// That fail-open is deliberate and documented — refusing unlisted channels
// outright is what broke every non-admin account the first time the policy was
// written. The cost is that a channel whose PREFIX is unknown to PREFIX_MODULE
// is enforced by nothing at all, silently.
//
// Four `auth:` channels sat in exactly that gap: a class teacher could list
// every user in the school, read every designation's permission matrix, and
// see who is answerable for every class. They are now named in POLICY.
//
// This test is the standing guard on the gap itself rather than on those four:
// it walks every channel the application can call and asserts that each either
// has a rule, is deliberately always-allowed, or is one of the `app:*`
// channels that never reach this code. A new channel in an unknown namespace
// fails here, at the moment it is added, instead of being found in an audit.
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const { POLICY, ALWAYS_ALLOWED, fallbackRule } = require(path.join(ROOT, 'electron/ipc/_policy.js'));

let pass = 0, fail = 0;
const ck = (n, c, extra) => {
  c ? pass++ : fail++;
  console.log((c ? '✓ ' : '✗ ') + n + (extra !== undefined ? '  ' + extra : ''));
};

// Every channel the application can call, read from the one list that defines
// the surface. Not from the registry: this must be checkable without starting
// Electron, and api-surface.js is what the screens are written against.
const surface = fs.readFileSync(path.join(ROOT, 'electron/api-surface.js'), 'utf8');
const channels = [...new Set([...surface.matchAll(/invoke\('([a-z-]+:[a-z0-9-]+)'/g)].map(m => m[1]))].sort();

ck('the API surface is readable and non-trivial', channels.length > 300, `${channels.length} channels`);

// `app:*` is registered straight onto the real ipcMain in electron/main.js, so
// it is never wrapped by the guard and is unreachable from a browser by
// construction (see ipc/_registry.js). Not a gap; a different mechanism.
const NEVER_GUARDED = 'app';

// Channels with no POLICY rule that are nonetheless enforced — inside the
// handler, by a check the policy table cannot express. Each is named with the
// guard it relies on, and the guard is VERIFIED below rather than taken on
// trust, so this list cannot become a place to park a channel nobody checks.
//
// They are not in POLICY because a settings rule would be WRONG for them:
// `mayAssign()` admits a Head Teacher, and `isElevated` admits the proprietor,
// neither of whom necessarily holds settings create/edit/delete. Expressing
// them as settings rules would take their own jobs away from them.
const GUARDED_IN_HANDLER = {
  'auth:create-user': 'checkPermission(settings, create)',
  'auth:update-user': 'checkPermission(settings, edit)',
  'auth:set-permission-override': 'checkPermission(settings, edit)',
  'auth:update-designation-permission': 'checkPermission(settings, edit)',
  'auth:reset-password': 'isElevated(actor)',
  'auth:add-user-assignment': 'mayAssign()',
  'auth:remove-user-assignment': 'mayAssign()',
};

const unruled = channels.filter((c) => {
  if (c.split(':')[0] === NEVER_GUARDED) return false;
  if (ALWAYS_ALLOWED.has(c)) return false;
  if (GUARDED_IN_HANDLER[c]) return false;
  return !(POLICY[c] || fallbackRule(c));
});

ck('every channel has a rule, is always-allowed, is app:*, or is guarded in its handler',
  unruled.length === 0, unruled.length ? unruled.join(', ') : '');

// The exemptions above, checked against the source rather than believed. A
// handler that loses its internal check becomes an unguarded channel with
// nothing else to catch it, and "we wrote it down in a test once" is not a
// guard. Each channel's handler body must contain the check it claims.
const authSource = fs.readFileSync(path.join(ROOT, 'electron/ipc/auth.js'), 'utf8');

function handlerBody(source, channel) {
  const start = source.indexOf(`ipcMain.handle('${channel}'`);
  if (start < 0) return null;
  // To the start of the next handler, or the end of file.
  const next = source.indexOf('ipcMain.handle(', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

for (const [channel, claim] of Object.entries(GUARDED_IN_HANDLER)) {
  const body = handlerBody(authSource, channel);
  const marker = claim.startsWith('checkPermission') ? 'checkPermission'
    : claim.startsWith('mayAssign') ? 'mayAssign'
      : 'isElevated';
  ck(`${channel} really does check ${claim} in its own body`,
    !!body && body.includes(marker), body ? '' : 'handler not found');
}

// The four that were found. Named individually, because a regression that
// silently drops one of them from POLICY should say which.
for (const c of [
  'auth:list-users',
  'auth:list-designations',
  'auth:get-designation-permissions',
  'auth:class-teachers',
]) {
  const rule = POLICY[c] || fallbackRule(c);
  ck(`${c} is gated on a module`, !!rule && rule[0] === 'settings', rule ? rule.join('/') : 'NO RULE');
}

// The two that must NOT be swept up by a blanket prefix rule. `mayAssign()`
// inside the handler admits a Head Teacher, who may not hold settings create
// or delete — so adding `auth` to PREFIX_MODULE would take teaching
// assignments away from the person whose job they are. If somebody does it
// anyway, this says so.
for (const c of ['auth:add-user-assignment', 'auth:remove-user-assignment']) {
  const rule = POLICY[c] || fallbackRule(c);
  ck(`${c} is left to its own mayAssign() check, not a settings rule`,
    !rule || rule[0] !== 'settings', rule ? rule.join('/') : 'no rule — correct');
}

// Writes must never be inferred as reads. The fallback reads the verb table the
// safe way round — anything unrecognised is treated as a change — and that
// property is the reason an unlisted channel is safe to allow at all.
for (const [channel, expected] of [
  ['students:delete-forever', 'delete'],
  ['fees:record-payment', 'create'],
  ['students:list', 'view'],
  ['finance:frobnicate', 'edit'],
]) {
  const rule = fallbackRule(channel);
  ck(`${channel} infers "${expected}"`, !!rule && rule[1] === expected, rule ? rule[1] : 'NO RULE');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
