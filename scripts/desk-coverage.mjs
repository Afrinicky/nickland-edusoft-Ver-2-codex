#!/usr/bin/env node
// Nickland Edusoft — what the office application can do, and where.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The installed application has one list of channels (electron/api-surface.js)
// and three places that answer them:
//
//   the office PC        every one of them, always — it IS the application
//   the school network   the same, minus what only means something on that PC
//   hosted               the ones the Python port has reached
//
// The third is the honest one. The port is not finished and will not be for a
// while, and the failure everybody should fear is not that it is unfinished —
// it is that nobody can say WHICH parts are. A screen that quietly returns
// nothing is a support call a year later from a school that gave up on it.
//
// So this counts. It reads the offline list, asks the hosted service what it
// answers, and writes docs/DESK_COVERAGE.md — module by module, channel by
// channel, with a number at the top.
//
//   node scripts/desk-coverage.mjs                    # against the checked-in map
//   node scripts/desk-coverage.mjs --check            # fail if the doc is stale
//   node scripts/desk-coverage.mjs --host https://... # against a running service

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const check = argv.includes('--check');
const hostFlag = (() => {
  const i = argv.indexOf('--host');
  return i >= 0 ? argv[i + 1] : null;
})();

// ── the offline list ────────────────────────────────────────────────────────

const { buildApi } = require(path.join(repo, 'electron/api-surface.js'));
const channels = (() => {
  const seen = [];
  const api = buildApi((c) => { seen.push(c); return Promise.resolve(null); });
  const all = [];
  for (const ns of Object.keys(api)) {
    for (const m of Object.keys(api[ns])) {
      seen.length = 0;
      api[ns][m]();
      all.push(seen[0]);
    }
  }
  return all.sort();
})();

// ── what the office PC will not answer over a network ───────────────────────

const { HOST_ONLY } = require(path.join(repo, 'electron/server/desk_api.js'));
const lanHostOnly = new Set(HOST_ONLY.keys());

// The app:* channels are not registered where the network can reach them at
// all (see electron/ipc/_registry.js), so they are host-only by construction.
for (const c of channels) if (c.startsWith('app:')) lanHostOnly.add(c);

// ── what the hosted service answers ─────────────────────────────────────────

async function hostedCoverage() {
  if (hostFlag) {
    const res = await fetch(`${hostFlag.replace(/\/+$/, '')}/api/v1/desk/coverage`);
    const body = await res.json();
    return { answered: new Set(body.answered), hostOnly: new Set(body.host_only) };
  }
  // No running service: read the map out of the source, which is the thing
  // that would be deployed anyway. Python is asked rather than the file
  // parsed, so a decorator moved or renamed cannot quietly change the answer.
  const py = spawnSync('python3', ['-c', [
    'import sys, json',
    'sys.path.insert(0, "cloud-python")',
    'from app import desk_api',
    'print(json.dumps(desk_api.coverage()))',
  ].join('\n')], {
    cwd: repo, encoding: 'utf8',
    env: { ...process.env, ALLOW_DEV_SECRET: '1', ALLOW_MEMORY_STORE: '1' },
  });
  if (py.status !== 0) {
    console.error('✖ Could not read the hosted service\'s map:\n' + (py.stderr || '').trim());
    process.exit(1);
  }
  const body = JSON.parse(py.stdout);
  return { answered: new Set(body.answered), hostOnly: new Set(body.host_only) };
}

const hosted = await hostedCoverage();

// A channel the hosted map names but the application does not have is a typo,
// and a silent one: it would simply never be called.
const stray = [...hosted.answered, ...hosted.hostOnly].filter(c => !channels.includes(c));

// ── the document ────────────────────────────────────────────────────────────

const MODULE_TITLES = {
  auth: 'Sign-in and accounts', access: 'Roles and access', dashboard: 'Dashboard',
  students: 'Students', staff: 'Staff', payroll: 'Payroll', fees: 'Fees',
  scores: 'Marks', academics: 'Academics', exams: 'Examinations',
  canteen: 'Canteen', finance: 'Finance', inventory: 'Inventory',
  transport: 'Transport', books: 'Books', discounts: 'Discounts',
  timetable: 'Timetable', homework: 'Homework', messages: 'Messages',
  announcements: 'Notices', notifications: 'Notifications',
  settings: 'Settings', reports: 'Printed documents', receipts: 'Receipts',
  photos: 'Photographs', audit: 'Audit trail', backup: 'Backup',
  workbook: 'Finance workbook', session: 'Term and session', app: 'The machine itself',
  'lesson-notes': 'Lesson notes', 'staff-activities': 'Staff activities',
  'mobile-sync': 'Mobile sync', mobile: 'Mobile app', cloud: 'Cloud sync',
  payments: 'The payment desk',
};

const byModule = new Map();
for (const c of channels) {
  const mod = c.split(':')[0];
  if (!byModule.has(mod)) byModule.set(mod, []);
  byModule.get(mod).push(c);
}

const state = (c) => {
  if (hosted.answered.has(c)) return 'online';
  if (lanHostOnly.has(c) || hosted.hostOnly.has(c)) return 'host';
  return 'notyet';
};

const counts = { online: 0, host: 0, notyet: 0 };
for (const c of channels) counts[state(c)]++;

const lanCount = channels.length - lanHostOnly.size;
const pct = (n) => `${Math.round((n / channels.length) * 100)}%`;

const lines = [];
lines.push('# Where each part of the office application works');
lines.push('');
lines.push('**Nickland Edusoft · Copyright © 2026 Nickland Sales**');
lines.push('');
lines.push('> Generated by `node scripts/desk-coverage.mjs`. Do not edit it by hand —');
lines.push('> it is regenerated from the application\'s own channel list and from the');
lines.push('> hosted service\'s map, so it cannot drift away from either.');
lines.push('');
lines.push('The office application is one application with three ways in. This says');
lines.push('which of them answers what, because "it works on the office computer but');
lines.push('not on the website" is a thing a school should be able to look up rather');
lines.push('than discover.');
lines.push('');
lines.push('| | What it is | Answers |');
lines.push('|---|---|---|');
lines.push(`| **The installed application** | The school's own computer | all ${channels.length} |`);
lines.push(`| **A browser on the school network** | Any machine on the school Wi-Fi, and the installed application in client mode | ${lanCount} of ${channels.length} (${pct(lanCount)}) |`);
lines.push(`| **Hosted** | The internet, with the school's computer switched off | ${counts.online} of ${channels.length} (${pct(counts.online)}) |`);
lines.push('');
lines.push('Three things a channel can be:');
lines.push('');
lines.push('* **✓ online** — the hosted service answers it.');
lines.push('* **office PC** — it only means something on the school\'s own machine: opening a');
lines.push('  folder, restoring a backup, a file dialog. Not missing; located.');
lines.push('* **not yet** — the hosted port has not reached it. The screen says so in');
lines.push('  words and points at the school\'s computer, rather than failing.');
lines.push('');
lines.push('Everything not marked **office PC** works over the school network today.');
lines.push('');

for (const [mod, list] of [...byModule].sort()) {
  const title = MODULE_TITLES[mod] || mod;
  const online = list.filter(c => state(c) === 'online').length;
  const reachable = list.filter(c => state(c) !== 'host').length;
  lines.push(`## ${title}`);
  lines.push('');
  lines.push(reachable
    ? `${online} of ${reachable} online.`
    : 'The school\'s own computer only.');
  lines.push('');
  lines.push('| Channel | Hosted |');
  lines.push('|---|---|');
  for (const c of list) {
    const s = state(c);
    lines.push(`| \`${c}\` | ${s === 'online' ? '✓ online' : s === 'host' ? 'office PC' : 'not yet' } |`);
  }
  lines.push('');
}

if (stray.length) {
  lines.push('## Named by the hosted service but not by the application');
  lines.push('');
  lines.push('These would never be called. They are typos, or channels that were renamed');
  lines.push('offline without the hosted map being told.');
  lines.push('');
  for (const c of stray) lines.push(`* \`${c}\``);
  lines.push('');
}

const out = lines.join('\n') + '\n';
const target = path.join(repo, 'docs', 'DESK_COVERAGE.md');

if (check) {
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (existing !== out) {
    console.error('✖ docs/DESK_COVERAGE.md is out of date. Run: node scripts/desk-coverage.mjs');
    process.exit(1);
  }
  if (stray.length) {
    console.error(`✖ The hosted service names ${stray.length} channel(s) the application does not have: ${stray.join(', ')}`);
    process.exit(1);
  }
  console.log(`✓ Coverage is current — ${counts.online}/${channels.length} online, ${lanCount}/${channels.length} on the school network.`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, out);
console.log(`✓ docs/DESK_COVERAGE.md — ${channels.length} channels: ` +
  `${counts.online} online, ${counts.host} office-PC-only, ${counts.notyet} not online yet.`);
if (stray.length) {
  console.log(`\n⚠ The hosted map names ${stray.length} channel(s) that do not exist: ${stray.join(', ')}`);
  process.exit(1);
}
