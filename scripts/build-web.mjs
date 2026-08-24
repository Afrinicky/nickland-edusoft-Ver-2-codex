#!/usr/bin/env node
// Nickland Edusoft — build the web app.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Builds `mobile/` for the browser (the same screens as the phone app) and
// drops the result everywhere it is served from:
//
//   mobile/dist-web/       the build itself — what CI publishes and what a
//                          Vercel deploy uploads
//   resources/webapp/      picked up by electron-builder, so the desktop host
//                          serves it over the school Wi-Fi with no internet
//   cloud/webapp/          the Node cloud service, when it serves the app too
//   cloud-python/webapp/   the FastAPI service, likewise
//
// Options:
//   --portal <url>   bake in a default portal/API address (EXPO_PUBLIC_PORTAL_URL).
//                    Needed when the app is hosted apart from its API — a
//                    Vercel build talking to Render, or the phone APK.
//   --school <id>    pin the build to one school, skipping the school picker.
//   --only-build     just build; do not copy into the servers.
//
// Usage:  npm run build:web -- --portal https://api.example.com

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobile = path.join(repo, 'mobile');
const out = path.join(mobile, 'dist-web');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};

const portal = flag('--portal') || process.env.EXPO_PUBLIC_PORTAL_URL || '';
const school = flag('--school') || process.env.EXPO_PUBLIC_SCHOOL_ID || '';
const onlyBuild = argv.includes('--only-build');

const TARGETS = [
  path.join(repo, 'resources', 'webapp'),
  path.join(repo, 'cloud', 'webapp'),
  path.join(repo, 'cloud-python', 'webapp'),
];

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: mobile, shell: process.platform === 'win32', ...opts });
  if (res.status !== 0) {
    console.error(`\n✖ ${cmd} ${args.join(' ')} failed (exit ${res.status ?? 'signal ' + res.signal}).`);
    process.exit(res.status || 1);
  }
}

if (!fs.existsSync(path.join(mobile, 'node_modules'))) {
  console.log('→ mobile/node_modules missing — installing first.');
  run('npm', ['install', '--no-audit', '--no-fund']);
}

// Never publish a stale build if this one fails half way.
fs.rmSync(out, { recursive: true, force: true });

// `--clear` is not optional. EXPO_PUBLIC_* values are compiled *into* the
// bundle, and Metro's cache does not key on them: without it, changing the
// portal address rebuilds happily and ships the old one, with nothing in the
// output to say so. Ten seconds is cheap against a deploy pointing at the
// wrong API.
console.log('→ Building the web app' + (portal ? ` (portal: ${portal})` : '') + (school ? ` (school: ${school})` : ''));
run('npx', ['expo', 'export', '--platform', 'web', '--output-dir', 'dist-web', '--clear'], {
  env: {
    ...process.env,
    CI: '1',
    ...(portal ? { EXPO_PUBLIC_PORTAL_URL: portal } : {}),
    ...(school ? { EXPO_PUBLIC_SCHOOL_ID: school } : {}),
  },
});

if (!fs.existsSync(path.join(out, 'index.html'))) {
  console.error('✖ Build produced no index.html — refusing to publish it.');
  process.exit(1);
}

if (!onlyBuild) {
  for (const dir of TARGETS) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.cpSync(out, dir, { recursive: true });
    console.log(`→ Copied to ${path.relative(repo, dir)}`);
  }
}

const bytes = (function size(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => {
    const p = path.join(dir, e.name);
    return n + (e.isDirectory() ? size(p) : fs.statSync(p).size);
  }, 0);
})(out);

console.log(`\n✓ Web app built — ${(bytes / 1024 / 1024).toFixed(2)} MB in ${path.relative(repo, out)}`);
