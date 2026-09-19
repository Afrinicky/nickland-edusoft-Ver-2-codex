#!/usr/bin/env node
// Nickland Edusoft — a school's own service, written out.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   npm run add-school -- --slug ave-maria --name "Ave Maria Preparatory School"
//
// Writes deploy/schools/<slug>.yaml from deploy/render-school.yaml, and then
// says what to do with it. That is the whole job: the sixth school should be
// the same two minutes as the second, and the thing that makes it two minutes
// is not having to remember which four values change.
//
// It does not touch Render. Nothing here has your credentials, and a script
// that could delete a school's service is not a script worth the convenience.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = resolve(ROOT, 'deploy/render-school.yaml');
const OUT_DIR = resolve(ROOT, 'deploy/schools');

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const value = (flag, fallback = null) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

function fail(message) {
  console.error('\n' + message + '\n');
  process.exit(1);
}

if (has('--help') || !value('--slug')) {
  console.log(`
Write a Render blueprint for one school.

  npm run add-school -- --slug ave-maria --name "Ave Maria Preparatory School"

  --slug NAME      the school's short name: letters, digits and hyphens.
                   It names the service, its disk and its file, and it is
                   what you will type for years. Keep it short and real.
  --name "…"       the school as it writes its own name  (for the comment)
  --region NAME    Render region, matching the database  (default: frankfurt)
  --disk GB        size of the disk for files            (default: 5)
  --schema NAME    Postgres schema                       (default: the slug, hyphens → _)
  --force          overwrite a file that is already there
`);
  process.exit(value('--slug') ? 0 : 1);
}

const slug = String(value('--slug')).trim().toLowerCase();
if (!/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) {
  fail('A slug is 3–40 characters, starts with a letter, ends with a letter or digit,\n' +
       'and holds only lowercase letters, digits and hyphens. It becomes a host name.');
}

const schema = String(value('--schema', slug.replace(/-/g, '_'))).trim();
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) {
  fail(`"${schema}" is not a Postgres identifier this will write unquoted.\n` +
       'Lowercase letters, digits and underscores, starting with a letter or underscore.');
}

const name = String(value('--name', slug)).trim();
const region = String(value('--region', 'frankfurt')).trim();
const diskGB = parseInt(value('--disk', '5'), 10);
if (!Number.isInteger(diskGB) || diskGB < 1) fail('--disk is a whole number of gigabytes.');

if (!existsSync(TEMPLATE)) fail(`The template is missing: ${relative(ROOT, TEMPLATE)}`);

const outPath = resolve(OUT_DIR, `${slug}.yaml`);
if (existsSync(outPath) && !has('--force')) {
  fail(`${relative(ROOT, outPath)} already exists.\n` +
       'A school whose blueprint is already written is a school that already has a\n' +
       'service; changing it here and applying it there is how two of them appear.\n' +
       'Pass --force if you really mean to rewrite it.');
}

let out = readFileSync(TEMPLATE, 'utf8')
  .replace(/SCHOOL-SLUG/g, slug)
  .replace(/SCHOOL_SCHEMA/g, schema)
  .replace(/region: frankfurt/, `region: ${region}`)
  .replace(/sizeGB: 5/, `sizeGB: ${diskGB}`);

// The template's header is about being a template. This file is about a school.
out = out.replace(
  /^# Nickland Edusoft — one school's host, on Render\.[\s\S]*?^services:/m,
  `# Nickland Edusoft — ${name}.
# Copyright © 2026 Nickland Sales. All rights reserved.
#
# GENERATED from deploy/render-school.yaml by scripts/add-school.mjs.
# Change the template when the way a host is built changes; change this file
# only for something true of ${name} alone.
#
#   Render → New → Blueprint → this repository
#           → Blueprint Path: deploy/schools/${slug}.yaml
#           → Apply, in the SAME workspace as everything else.
#
# Then: DATABASE_URL in the dashboard, and the steps this script printed.

services:`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(outPath, out);

const file = relative(ROOT, outPath);
console.log(`\n✓ ${name} → ${file}`);
console.log(`  service  edusoft-${slug}`);
console.log(`  schema   ${schema}`);
console.log(`  region   ${region}, disk ${diskGB}GB\n`);
console.log('Next, in order:\n');
console.log(`  1. Commit it.  git add ${file} && git commit -m "Add ${name}" && git push`);
console.log('  2. Enrol the school on the platform console → Schools → Enrol a school.');
console.log('     Write down its address, tenant id, sync key and the admin password.');
console.log('  3. Render → New → Blueprint → this repository → Blueprint Path:');
console.log(`     ${file}   — in the SAME workspace, so it is the same subscription.`);
console.log('  4. Set DATABASE_URL to the Neon string. The tables create themselves.');
console.log(`     (Sharing a database? Only DATABASE_SCHEMA differs — this school's is "${schema}".)`);
console.log('  5. Render → the new service → Shell:');
console.log('       npm run host:create-admin -- --username <name> --name "<Full Name>"');
console.log('  6. Open /desk, sign in, then Settings → Cloud sync: the platform address,');
console.log('     the tenant id and the sync key. Activate — that clears the licence clock.');
console.log('  7. Settings → Onboarding for the workbook, and set the backups going.\n');
