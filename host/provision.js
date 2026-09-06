#!/usr/bin/env node
// Nickland Edusoft — creating the school's tables in Postgres.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Run once, before the web host is first started against an empty database.
//
//   DATABASE_URL=postgresql://... npm run host:provision
//
// It applies the schema the repository ALREADY generates from the desktop's
// own — scripts/schema-to-postgres.mjs builds the offline database in memory,
// runs every migration exactly as a school's PC runs them, and reads the
// result back out. There is no second schema definition here and there must
// never be one: the online school is the offline school's tables, or the two
// have quietly become different products.
//
// The spike found that file three columns out of date, which would have shown
// up as an admission failing on the day somebody first used it. So this checks
// the generated schema is current before it applies anything, and says how to
// fix it rather than proceeding with a stale one.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_SQL = path.join(ROOT, 'cloud-python', 'schema', 'school.sql');
const SEED_SQL = path.join(ROOT, 'cloud-python', 'schema', 'seed.sql');

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const value = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const CONNECTION = process.env.DATABASE_URL;
const SCHEMA = value('--schema', process.env.DATABASE_SCHEMA || 'public');
const FORCE = has('--force');
const SKIP_SEED = has('--no-seed');

function fail(message) {
  console.error('\n' + message + '\n');
  process.exit(1);
}

// Is the generated schema current? Regenerating is cheap and deterministic, so
// this regenerates into a temporary place and compares rather than trusting a
// timestamp.
function checkSchemaIsCurrent() {
  if (!fs.existsSync(SCHEMA_SQL)) {
    fail(`No generated schema at ${path.relative(ROOT, SCHEMA_SQL)}.\n` +
         'Generate it with:  node scripts/schema-to-postgres.mjs');
  }
  const before = fs.readFileSync(SCHEMA_SQL, 'utf8');
  try {
    execFileSync('node', ['scripts/schema-to-postgres.mjs'], { cwd: ROOT, stdio: 'pipe' });
  } catch (e) {
    fail('Could not regenerate the schema from the desktop\'s own:\n' +
         (e.stderr ? e.stderr.toString() : e.message));
  }
  const after = fs.readFileSync(SCHEMA_SQL, 'utf8');
  if (before !== after) {
    console.log('· The generated schema was out of date and has been regenerated.');
    console.log('  Commit the change to cloud-python/schema/ so the next deploy has it.');
  }
}

async function main() {
  if (!CONNECTION) {
    fail('DATABASE_URL is not set.\n' +
         'Point it at the school\'s Neon database:\n' +
         '  DATABASE_URL=postgresql://user:pass@host/db?sslmode=require npm run host:provision');
  }

  checkSchemaIsCurrent();

  const client = new Client({ connectionString: CONNECTION });
  await client.connect();

  try {
    if (SCHEMA !== 'public') {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${JSON.stringify(SCHEMA).replace(/"/g, '"')}`);
    }
    await client.query(`SET search_path TO ${SCHEMA}`);

    const existing = await client.query(
      'SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1', [SCHEMA]);
    if (existing.rows[0].n > 0 && !FORCE) {
      fail(`That database already holds ${existing.rows[0].n} tables in schema "${SCHEMA}".\n` +
           'Provisioning again would fail part-way through and leave it half-built.\n' +
           'If this is a fresh start and the data can go, pass --force.');
    }

    if (existing.rows[0].n > 0 && FORCE) {
      console.log(`· Dropping schema "${SCHEMA}" and everything in it (--force).`);
      await client.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
      await client.query(`CREATE SCHEMA ${SCHEMA}`);
      await client.query(`SET search_path TO ${SCHEMA}`);
    }

    console.log(`· Creating the school's tables in schema "${SCHEMA}"…`);
    await client.query(fs.readFileSync(SCHEMA_SQL, 'utf8'));

    if (!SKIP_SEED && fs.existsSync(SEED_SQL)) {
      console.log('· Seeding what a new school starts with — the same defaults the installer seeds…');
      await client.query(fs.readFileSync(SEED_SQL, 'utf8'));
    }

    const tables = await client.query(
      'SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1', [SCHEMA]);
    console.log(`\n✓ ${tables.rows[0].n} tables ready.`);
    console.log('\nNext: start the host with the same DATABASE_URL, open /desk, and');
    console.log('create the first administrator. Nothing about the office PC changes.');
  } finally {
    await client.end();
  }
}

main().catch((e) => fail('Provisioning failed: ' + ((e && e.message) || e)));
