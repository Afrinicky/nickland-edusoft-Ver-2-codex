// Nickland Edusoft — the connection string the host actually dials.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/host_connection.js
//
// No database needed. This is the thing that failed in production: Neon's
// pooled endpoint refuses the `search_path` startup parameter, so the host
// came up, answered every request with that refusal, failed its health check
// for eighteen minutes and the deploy timed out. Each case here is a string a
// school's operator can genuinely be handed.

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const conn = require(path.join(ROOT, 'host/db/connection'));

let pass = 0, fail = 0;
const ck = (n, c, got) => {
  c ? pass++ : fail++;
  console.log((c ? '✓ ' : '✗ ') + n + (c ? '' : '\n     got: ' + got));
};

const POOLED = 'postgresql://school:s3cr3t@ep-quiet-term-a1b2c3-pooler.eu-central-1.aws.neon.tech/edusoft?sslmode=require';
const DIRECT = 'postgresql://school:s3cr3t@ep-quiet-term-a1b2c3.eu-central-1.aws.neon.tech/edusoft?sslmode=require';

// == The failure this exists for ==
{
  const r = conn.resolveConnection(POOLED, { schema: 'school' });
  ck('a pooled Neon string becomes the direct endpoint when a schema is pinned',
    r.connectionString === DIRECT, r.connectionString);
  ck('...and the host says why', r.notes.length === 1 && /pooled/.test(r.notes[0]), JSON.stringify(r.notes));
  ck('...and nothing else about the string is touched',
    r.connectionString.endsWith('/edusoft?sslmode=require') &&
    r.connectionString.includes('school:s3cr3t@'), r.connectionString);
}

// == What must be left alone ==
{
  const r = conn.resolveConnection(POOLED, { schema: null });
  ck('without a schema the pooled endpoint is kept — pooling is not the problem',
    r.connectionString === POOLED && r.notes.length === 0, r.connectionString);
}

{
  const r = conn.resolveConnection(POOLED, { schema: 'public' });
  ck('schema "public" needs no pinning, so the pooled endpoint is kept',
    r.connectionString === POOLED && r.notes.length === 0, r.connectionString);
}

{
  const r = conn.resolveConnection(DIRECT, { schema: 'school' });
  ck('a direct string is already right and is passed through unchanged',
    r.connectionString === DIRECT && r.notes.length === 0, r.connectionString);
}

{
  const plain = 'postgresql://postgres:postgres@localhost:5432/edusoft';
  const r = conn.resolveConnection(plain, { schema: 'school' });
  ck('a local Postgres string is not Neon and is left exactly as it is',
    r.connectionString === plain && r.notes.length === 0, r.connectionString);
}

{
  // A password may hold anything, including the word this rewrites on.
  const odd = 'postgresql://school:a-pooler.pass@ep-x1-pooler.eu-central-1.aws.neon.tech/edusoft';
  const r = conn.resolveConnection(odd, { schema: 'school' });
  ck('only the HOST is rewritten — a password containing "-pooler." survives',
    r.connectionString === 'postgresql://school:a-pooler.pass@ep-x1.eu-central-1.aws.neon.tech/edusoft',
    r.connectionString);
}

// == The same refusal by another route ==
{
  const withOptions = POOLED + '&options=-c%20search_path%3Dschool';
  const r = conn.resolveConnection(withOptions, { schema: 'school' });
  ck('a hand-written `options=` is removed — it is the refused parameter again',
    r.connectionString === DIRECT, r.connectionString);
  ck('...and that is said too', r.notes.some(n => /options/.test(n)), JSON.stringify(r.notes));
}

{
  const r = conn.resolveConnection(DIRECT + '&options=-c%20timezone%3DUTC&application_name=edusoft',
    { schema: 'school' });
  ck('other query parameters are kept when `options` is removed',
    r.connectionString === DIRECT + '&application_name=edusoft', r.connectionString);
}

// == The escape hatch ==
{
  const r = conn.resolveConnection(POOLED, { schema: 'school', keepPooled: true });
  ck('DATABASE_POOLED=keep leaves the string alone',
    r.connectionString === POOLED, r.connectionString);
  ck('...and warns that the schema must then be the role\'s default',
    r.notes.some(n => /default/.test(n)), JSON.stringify(r.notes));
}

ck('DATABASE_POOLED reads keep/1/true and nothing else',
  conn.keepPooledFromEnv({ DATABASE_POOLED: 'keep' }) === true &&
  conn.keepPooledFromEnv({ DATABASE_POOLED: 'true' }) === true &&
  conn.keepPooledFromEnv({}) === false &&
  conn.keepPooledFromEnv({ DATABASE_POOLED: 'no' }) === false);

// == The identifier that goes into SET search_path ==
ck('a plain schema name is used as it is', conn.quoteIdent('school') === 'school', conn.quoteIdent('school'));
ck('anything else is quoted rather than refused',
  conn.quoteIdent('School Two') === '"School Two"', conn.quoteIdent('School Two'));
ck('a quote in a schema name cannot end the identifier',
  conn.quoteIdent('a"b') === '"a""b"', conn.quoteIdent('a"b'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
