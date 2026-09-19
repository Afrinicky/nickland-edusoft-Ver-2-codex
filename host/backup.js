#!/usr/bin/env node
// Nickland Edusoft — a copy of the school, off the server.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   DATABASE_URL=postgresql://… DATABASE_SCHEMA=school npm run host:backup
//
// The office PC's backup (electron/ipc/backup.js) copies a SQLite FILE into a
// zip. There is no such file here — the school lives in Postgres — so that
// button refuses on this host and says to run this instead.
//
// What this writes is one .sql file that restores into an empty Postgres with
// a single command: the school's tables, then every row in them, then the
// identity counters set past the highest id so the next admission number is
// the next one and not a duplicate. It is plain text on purpose. A backup
// nobody can read is a backup nobody checks, and the first time you find out
// it was empty should not be the day the database is gone.
//
// This is NOT a replacement for Neon's own point-in-time recovery, which is
// what restores the school to 10:32 this morning. It is the copy you hold
// yourself — for moving to another provider, for an auditor, and for the day
// the account itself is the problem.
//
// It does not hold the FILES: report cards, receipts and photographs live on
// the host's disk (EDUSOFT_DATA_DIR), and are copied separately. The summary
// at the end says how many there are so their absence is never a surprise.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { Client } = require('pg');
const { resolveConnection, quoteIdent, keepPooledFromEnv } = require('./db/connection');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_SQL = path.join(ROOT, 'cloud-python', 'schema', 'school.sql');

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const value = (flag, fallback = null) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

if (has('--help') || has('-h')) {
  console.log(`
Write a restorable copy of the school's database.

  DATABASE_URL=… DATABASE_SCHEMA=school npm run host:backup

  --out PATH     where to write it   (default: <EDUSOFT_DATA_DIR>/backups)
  --gzip         compress it
  --keep N       delete all but the newest N backups in that folder
  --data-only    leave out the CREATE TABLEs — rows only
  --help
`);
  process.exit(0);
}

const CONNECTION = process.env.DATABASE_URL;
const SCHEMA = value('--schema', process.env.DATABASE_SCHEMA || 'public');
const DATA_DIR = process.env.EDUSOFT_DATA_DIR || path.join(ROOT, '.host-data');
const GZIP = has('--gzip');
const DATA_ONLY = has('--data-only');
const KEEP = parseInt(value('--keep', '0'), 10) || 0;

// Rows per INSERT. Large enough that a table of ten thousand pupils is not ten
// thousand statements; small enough that psql is never handed a line it has to
// hold entirely in memory to parse.
const BATCH = 250;

function fail(message) {
  console.error('\n' + message + '\n');
  process.exit(1);
}

// A value, said in SQL. The generated schema is TEXT, BIGINT and DOUBLE
// PRECISION and nothing else, so this is the whole of it — and the dump sets
// standard_conforming_strings so a backslash in a pupil's note stays a
// backslash instead of becoming an escape.
function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (Buffer.isBuffer(v)) return `'\\x${v.toString('hex')}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// Parents before children, so a restore never inserts a row pointing at one
// that is not there yet. Kahn's algorithm over the foreign keys the database
// itself reports; a cycle (none today) falls back to alphabetical and says so.
function inDependencyOrder(tables, edges) {
  const remaining = new Set(tables);
  const out = [];
  while (remaining.size) {
    const free = [...remaining].filter((t) =>
      !(edges.get(t) || []).some((parent) => parent !== t && remaining.has(parent)));
    if (!free.length) {
      console.log('· These tables reference each other in a loop and are written in ' +
                  'name order; a restore may need constraints deferred: ' + [...remaining].join(', '));
      return out.concat([...remaining].sort());
    }
    free.sort();
    for (const t of free) { out.push(t); remaining.delete(t); }
  }
  return out;
}

function countFiles(dir) {
  let files = 0, bytes = 0;
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else { try { files++; bytes += fs.statSync(full).size; } catch (_) {} }
    }
  };
  walk(dir);
  return { files, bytes };
}

function prune(dir, keep) {
  const mine = fs.readdirSync(dir)
    .filter((n) => /^school-.*\.sql(\.gz)?$/.test(n))
    .map((n) => ({ name: n, at: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const old of mine.slice(keep)) {
    fs.unlinkSync(path.join(dir, old.name));
    console.log(`· Removed an older backup: ${old.name}`);
  }
}

async function main() {
  if (!CONNECTION) {
    fail('DATABASE_URL is not set.\n' +
         'This backs up the Postgres the web host runs on:\n' +
         '  DATABASE_URL=postgresql://… DATABASE_SCHEMA=school npm run host:backup');
  }

  const resolved = resolveConnection(CONNECTION, { schema: SCHEMA, keepPooled: keepPooledFromEnv() });
  resolved.notes.forEach((n) => console.log('· ' + n));

  const outDir = value('--out') || path.join(DATA_DIR, 'backups');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `school-${stamp()}.sql${GZIP ? '.gz' : ''}`);

  const client = new Client({ connectionString: resolved.connectionString });
  await client.connect();

  const ident = quoteIdent(SCHEMA);
  const sink = fs.createWriteStream(outPath);
  const out = GZIP ? zlib.createGzip() : null;
  if (out) out.pipe(sink);
  const write = (s) => new Promise((resolve, reject) => {
    (out || sink).write(s, (e) => (e ? reject(e) : resolve()));
  });

  let tableCount = 0, rowCount = 0;

  try {
    await client.query(`SET search_path TO ${ident}`);

    const tables = (await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`, [SCHEMA]
    )).rows.map((r) => r.table_name);
    if (!tables.length) fail(`There are no tables in schema "${SCHEMA}". Nothing to back up.`);

    const fks = (await client.query(
      `SELECT tc.table_name AS child, ccu.table_name AS parent
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1`, [SCHEMA]
    )).rows;
    const edges = new Map();
    for (const { child, parent } of fks) {
      if (!edges.has(child)) edges.set(child, []);
      edges.get(child).push(parent);
    }

    const identities = (await client.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = $1 AND is_identity = 'YES'`, [SCHEMA]
    )).rows;

    const ordered = inDependencyOrder(tables, edges);

    await write(`-- Nickland Edusoft — the school's database, ${new Date().toISOString()}\n`);
    await write(`-- Schema "${SCHEMA}", ${ordered.length} tables.\n--\n`);
    await write('-- Restore into an EMPTY database:\n');
    await write(`--   psql "postgresql://…" ${GZIP ? '-f - <(gunzip -c this-file.sql.gz)' : `-f ${path.basename(outPath)}`}\n`);
    await write('--\n-- It creates the schema, the tables and every row, and leaves the id\n');
    await write('-- counters past the highest id in each table. Restoring over a school that\n');
    await write('-- already has rows is not what this is for: make a new database.\n\n');
    await write('SET standard_conforming_strings = on;\n');
    await write('SET client_min_messages = warning;\n');
    await write(`CREATE SCHEMA IF NOT EXISTS ${ident};\n`);
    await write(`SET search_path TO ${ident};\n\n`);

    if (!DATA_ONLY) {
      if (fs.existsSync(SCHEMA_SQL)) {
        await write("-- ── The school's tables " + "─".repeat(36) + "\n");
        await write(fs.readFileSync(SCHEMA_SQL, 'utf8'));
        await write('\n');
      } else {
        console.log('· The generated schema is missing, so this holds rows only. ' +
                    'Regenerate it with: node scripts/schema-to-postgres.mjs');
      }
    }

    for (const table of ordered) {
      const t = quoteIdent(table);
      const res = await client.query(`SELECT * FROM ${ident}.${t}`);
      tableCount++;
      if (!res.rows.length) continue;

      const columns = res.fields.map((f) => f.name);
      const columnList = columns.map(quoteIdent).join(', ');
      await write(`\n-- ${table}: ${res.rows.length} row${res.rows.length === 1 ? '' : 's'}\n`);

      for (let i = 0; i < res.rows.length; i += BATCH) {
        const slice = res.rows.slice(i, i + BATCH);
        const values = slice
          .map((row) => '  (' + columns.map((c) => literal(row[c])).join(', ') + ')')
          .join(',\n');
        await write(`INSERT INTO ${t} (${columnList}) VALUES\n${values};\n`);
      }
      rowCount += res.rows.length;
    }

    // The next receipt number must not be one already on a parent's receipt.
    if (identities.length) {
      await write("\n-- Where each table's counter carries on from.\n");
      for (const { table_name, column_name } of identities) {
        if (!ordered.includes(table_name)) continue;
        const t = quoteIdent(table_name);
        const c = quoteIdent(column_name);
        await write(
          `SELECT setval(pg_get_serial_sequence('${SCHEMA}.${table_name}', '${column_name}'), ` +
          `COALESCE((SELECT MAX(${c}) FROM ${t}), 1), true);\n`);
      }
    }
  } finally {
    await client.end();
    await new Promise((resolve, reject) => {
      sink.on('finish', resolve);
      sink.on('error', reject);
      if (out) out.end(); else sink.end();
    });
  }

  const size = fs.statSync(outPath).size;
  const files = countFiles(path.join(DATA_DIR, 'uploads'));

  console.log(`\n✓ ${rowCount.toLocaleString()} rows from ${tableCount} tables → ${outPath}`);
  console.log(`  ${(size / 1024).toFixed(1)} KB${GZIP ? ' (gzipped)' : ''}`);

  if (KEEP > 0) prune(outDir, KEEP);

  console.log(`\nThis file is the RECORDS. The school's FILES — report cards, receipts,`);
  console.log(`photographs — are ${files.files} file${files.files === 1 ? '' : 's'}, ` +
              `${(files.bytes / 1048576).toFixed(1)} MB, in ${path.join(DATA_DIR, 'uploads')},`);
  console.log('and are not in it. On Render that is the mounted disk; copy it separately.');
  console.log('\nNeon\'s own point-in-time recovery is what restores this morning at 10:32.');
  console.log('This is the copy you hold yourself.');
}

main().catch((e) => fail('The backup did not finish: ' + ((e && e.message) || e)));
