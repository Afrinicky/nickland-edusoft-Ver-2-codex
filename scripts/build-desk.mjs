#!/usr/bin/env node
// Nickland Edusoft — build the office application for a browser.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The installed application's own screens (src/renderer), compiled to run in
// a browser, and dropped everywhere it is served from:
//
//   dist-desk/            the build itself
//   resources/desk/       picked up by electron-builder, so the installed host
//                         serves it at /desk over the school Wi-Fi
//   cloud-python/desk/    the hosted service, when it serves it too
//   cloud/desk/           likewise, for the Node service
//
// Options:
//   --host <url>     bake in the school host this build talks to. Only needed
//                    when the build is served from somewhere other than the
//                    host itself — a hosted deployment pointed at one school.
//                    Left out, the build talks to whoever served it, which is
//                    what the school's own computer wants.
//   --base <path>    where it will be served from. Defaults to /desk/.
//   --only-build     just build; do not copy into the servers.
//
// Usage:  npm run build:desk

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(repo, 'dist-desk');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};

const host = flag('--host') || process.env.EDUSOFT_DESK_HOST || '';
const base = flag('--base') || process.env.EDUSOFT_DESK_BASE || '/desk/';
const onlyBuild = argv.includes('--only-build');

const TARGETS = [
  path.join(repo, 'resources', 'desk'),
  path.join(repo, 'cloud', 'desk'),
  path.join(repo, 'cloud-python', 'desk'),
];

function run(cmd, args, env = {}) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit', cwd: repo,
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  if (res.status !== 0) {
    console.error(`\n✖ ${cmd} ${args.join(' ')} failed (exit ${res.status ?? 'signal ' + res.signal}).`);
    process.exit(res.status || 1);
  }
}

// Never publish a stale build if this one fails half way.
fs.rmSync(out, { recursive: true, force: true });

console.log('→ Building the office application for a browser' +
  (host ? ` (host: ${host})` : ' (talks to whoever serves it)') +
  ` (base: ${base})`);

run('npx', ['vite', 'build', '--config', 'vite.desk.config.js'], {
  EDUSOFT_DESK_BASE: base,
  ...(host ? { VITE_DESK_HOST: host } : {}),
});

// The entry is desk.html, so that the installed application's index.html — the
// one electron-builder packages and the window loads — is left exactly as it
// was. A browser expects the shell at index.html, so it is renamed here rather
// than by adding a second index.html to the source tree that somebody would
// later edit and wonder why nothing changed.
const built = path.join(out, 'desk.html');
const shell = path.join(out, 'index.html');
if (fs.existsSync(built)) fs.renameSync(built, shell);

if (!fs.existsSync(shell)) {
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

console.log(`\n✓ Office application built for the browser — ${(bytes / 1024 / 1024).toFixed(2)} MB in ${path.relative(repo, out)}`);
