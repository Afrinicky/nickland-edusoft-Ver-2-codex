// Nickland Edusoft — shipping the licence core as bytecode, not as source.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node scripts/harden.mjs          compile
//   node scripts/harden.mjs --check  report what would happen, change nothing
//
// An Electron app is a zip of readable JavaScript. `npx asar extract` takes
// thirty seconds, and the file that decides whether a school has paid is then
// sitting in an editor with a comment above it explaining what it does. That
// is the state this repository was in, and no amount of care inside that file
// changes it.
//
// This compiles the files that make the decision to V8 bytecode. What ships is
// a `.jsc` that the same V8 runs and that no editor opens usefully. It is
// **not** encryption and it is not claimed to be: bytecode can be disassembled
// by somebody who wants to, and the strings in it stay readable. What it does
// is remove the easy path — reading the logic and changing one line — and
// leave only a hard one.
//
// Ordered honestly, the desktop's protection is:
//
//   1. Electron fuses (scripts/fuses.mjs)   the OS refuses a modified build
//   2. Server-authoritative seals           a cracked copy cannot make valid
//                                           receipts, ever, at all
//   3. Build hash inside the signed lease   a genuine lease will not load on
//                                           a modified copy
//   4. Scattered independent checks         several things to find, not one
//   5. This                                 the logic is not sitting in plain
//                                           text next to a helpful comment
//
// Only 1 and 2 are load-bearing. 3, 4 and 5 raise the cost. Said in that order
// so nobody later mistakes obfuscation for security and stops doing 1 and 2.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

// The files that decide. Kept short deliberately: every file compiled is a file
// that cannot be read in a stack trace when a school reports a bug, and the
// trade is only worth making where the logic is what is being protected.
const CORE = [
  'electron/licence/index.js',
  'electron/licence/sentinel.js',
  'electron/licence/integrity.js',
];

const check = process.argv.includes('--check');

function loadBytenode() {
  try { return require('bytenode'); }
  catch (_) { return null; }
}

async function main() {
  const bytenode = loadBytenode();
  if (!bytenode) {
    const message = 'bytenode is not installed, so the licence core will ship as '
      + 'readable JavaScript. `npm i -D bytenode` to compile it.';
    if (check) { console.log(`[harden] ${message}`); return; }
    // A warning and not a failure: the fuses and the seals are what actually
    // protect this, and a build must not be blocked on the layer that matters
    // least.
    console.warn(`[harden] WARNING — ${message}`);
    return;
  }

  for (const rel of CORE) {
    const source = path.join(ROOT, rel);
    const out = source.replace(/\.js$/, '.jsc');
    if (!fs.existsSync(source)) {
      console.warn(`[harden] missing, skipped: ${rel}`);
      continue;
    }
    if (check) { console.log(`[harden] would compile ${rel} → ${path.basename(out)}`); continue; }

    await bytenode.compileFile({ filename: source, output: out, electron: true });

    // The loader that replaces the source. `require('./index')` then resolves
    // to this, which registers bytenode and hands back the compiled module —
    // so nothing that requires these files has to know they changed.
    fs.writeFileSync(source, [
      '// Compiled at build time — see scripts/harden.mjs.',
      "require('bytenode');",
      `module.exports = require('./${path.basename(out)}');`,
      '',
    ].join('\n'));
    console.log(`[harden] compiled ${rel}`);
  }
}

main().catch((e) => { console.error('[harden]', e.message); process.exit(1); });
