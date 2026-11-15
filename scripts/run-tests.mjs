#!/usr/bin/env node
// Nickland Edusoft — run every suite, not just the ones before the first failure.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// `npm test` was a chain of `&&`. One stale suite therefore stopped the run,
// and the twelve suites after it reported nothing at all — which is how a
// date-dependent fixture in test/teacher_api.js came to hide `office_api`,
// `office_parity`, `desk_api`, `webapp`, `headless_host` and seven others. The
// chain said "failed", which was true, and said nothing about the other 600
// assertions, which was the part somebody needed.
//
// So: every suite runs, every result is reported, and the exit code is the
// worst of them. A failure is still a failure — it is just no longer a
// blindfold.
//
//   node scripts/run-tests.mjs                 the Node suites
//   node scripts/run-tests.mjs --cloud         the cloud/ reference suites too
//   node scripts/run-tests.mjs --cloud-only    only those
//   node scripts/run-tests.mjs --only licence  one suite, by name
//
// The Python suites are a separate runtime and stay in `npm run test:online`.

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Suites that must run in a stated order, because a later one reads what an
// earlier one wrote. Everything else is discovered, so a new suite is picked
// up by existing rather than by being remembered.
const FIRST = ['regressions'];

// Not suites: helpers that live in the same folder.
const NOT_A_SUITE = new Set([]);

function nodeSuites() {
  const names = readdirSync(path.join(ROOT, 'test'))
    .filter(f => f.endsWith('.js') || f.endsWith('.mjs'))
    .map(f => f.replace(/\.(js|mjs)$/, ''))
    .filter(n => !NOT_A_SUITE.has(n));
  const ordered = [...FIRST.filter(n => names.includes(n))];
  for (const n of names.sort()) if (!ordered.includes(n)) ordered.push(n);
  return ordered.map(n => ({
    name: n,
    file: names.includes(n) && readdirSync(path.join(ROOT, 'test')).includes(`${n}.mjs`)
      ? path.join('test', `${n}.mjs`)
      : path.join('test', `${n}.js`),
  }));
}

function cloudSuites() {
  return readdirSync(path.join(ROOT, 'cloud', 'test'))
    .filter(f => f.endsWith('.js'))
    .sort()
    .map(f => ({ name: `cloud/${f.replace(/\.js$/, '')}`, file: path.join('cloud', 'test', f) }));
}

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

let suites = args.includes('--cloud-only') ? [] : [...nodeSuites()];
if (args.includes('--cloud') || args.includes('--cloud-only')) suites = [...suites, ...cloudSuites()];
if (only) suites = suites.filter(s => s.name === only || s.name.endsWith(`/${only}`));

if (!suites.length) {
  console.error(only ? `No suite called "${only}".` : 'No suites found.');
  process.exit(2);
}

const results = [];
for (const suite of suites) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [suite.file], { cwd: ROOT, encoding: 'utf8' });
  const out = `${run.stdout || ''}${run.stderr || ''}`;
  const tally = /(\d+) passed, (\d+) failed/.exec([...out.matchAll(/(\d+) passed, (\d+) failed/g)].pop()?.[0] || '');
  const skipped = /skipping/i.test(out) && !tally;
  results.push({
    name: suite.name,
    code: run.status,
    passed: tally ? parseInt(tally[1], 10) : null,
    failed: tally ? parseInt(tally[2], 10) : null,
    skipped,
    ms: Date.now() - started,
    out,
  });
  const mark = run.status === 0 ? (skipped ? '•' : '✓') : '✗';
  const count = tally ? `${tally[1]} passed, ${tally[2]} failed` : (skipped ? 'skipped' : '');
  console.log(`${mark} ${suite.name.padEnd(24)} ${count}`);
  // A failing suite prints its own failures, where they can be read, rather
  // than leaving somebody to re-run it to find out what went wrong.
  if (run.status !== 0) {
    for (const line of out.split('\n').filter(l => /^✗/.test(l)).slice(0, 15)) {
      console.log(`    ${line}`);
    }
    const tail = out.trim().split('\n').slice(-3).join('\n    ');
    if (!out.split('\n').some(l => /^✗/.test(l))) console.log(`    ${tail}`);
  }
}

const failed = results.filter(r => r.code !== 0);
const assertions = results.reduce((n, r) => n + (r.passed || 0), 0);
const skippedSuites = results.filter(r => r.skipped);

console.log('');
console.log(`${results.length} suites, ${assertions} assertions passed, ${failed.length} suites failed`);
if (skippedSuites.length) {
  console.log(`${skippedSuites.length} skipped for want of a database: ${skippedSuites.map(r => r.name).join(', ')}`);
  console.log('  (set DATABASE_URL to run them; EDUSOFT_REQUIRE_PG=1 makes skipping an error)');
}
if (failed.length) console.log(`failed: ${failed.map(r => r.name).join(', ')}`);

process.exit(failed.length ? 1 : 0);
