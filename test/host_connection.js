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
const DIRECT = 'postgresql://school:s3cr3t@ep-quiet-term-a1b2c3.eu-central-1.aws.neon.tech/edusoft?sslmode=verify-full';
// The same pooled string once the sslmode has been made explicit, which
// happens to every Neon string whether or not a schema is pinned.
const POOLED_STRICT = POOLED.replace('sslmode=require', 'sslmode=verify-full');

// == The failure this exists for ==
{
  const r = conn.resolveConnection(POOLED, { schema: 'school' });
  ck('a pooled Neon string becomes the direct endpoint when a schema is pinned',
    r.connectionString === DIRECT, r.connectionString);
  ck('...and the host says why', r.notes.some(n => /pooled/.test(n)), JSON.stringify(r.notes));
  ck('...and nothing else about the string is touched',
    r.connectionString.endsWith('/edusoft?sslmode=verify-full') &&
    r.connectionString.includes('school:s3cr3t@'), r.connectionString);
}

// == What must be left alone ==
{
  const r = conn.resolveConnection(POOLED, { schema: null });
  ck('without a schema the pooled endpoint is kept — pooling is not the problem',
    r.connectionString === POOLED_STRICT && r.pooled === true, r.connectionString);
}

{
  const r = conn.resolveConnection(POOLED, { schema: 'public' });
  ck('schema "public" needs no search path, so the pooled endpoint is kept',
    r.connectionString === POOLED_STRICT && r.pooled === true, r.connectionString);
}

{
  const r = conn.resolveConnection(DIRECT, { schema: 'school' });
  ck('a direct string that is already strict is passed through unchanged',
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

// == sslmode, said plainly ==
{
  const r = conn.resolveConnection(POOLED, { schema: 'school' });
  ck('sslmode=require becomes verify-full on Neon — what the driver does today',
    /sslmode=verify-full/.test(r.connectionString) && !/sslmode=require/.test(r.connectionString),
    r.connectionString);
  ck('...and that is said too', r.notes.some(n => /verify-full/.test(n)), JSON.stringify(r.notes));
}

{
  const local = 'postgresql://postgres:postgres@localhost:5432/edusoft?sslmode=require';
  ck('a database that is not Neon keeps the sslmode it was given',
    conn.resolveConnection(local, { schema: 'school' }).connectionString === local);
}

{
  const chosen = 'postgresql://school:s3cr3t@ep-quiet-term-a1b2c3.eu-central-1.aws.neon.tech/edusoft?sslmode=verify-ca';
  ck('an sslmode the operator chose deliberately is left alone',
    conn.resolveConnection(chosen, { schema: 'school' }).connectionString === chosen,
    conn.resolveConnection(chosen, { schema: 'school' }).connectionString);
}

ck('pinning only ever touches sslmode=require',
  conn.pinSsl('postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/db').pinned === false &&
  conn.pinSsl('postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/db?sslmode=disable').pinned === false &&
  conn.pinSsl('postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/db?sslmode=require').pinned === true);

// == The escape hatch ==
{
  const r = conn.resolveConnection(POOLED, { schema: 'school', keepPooled: true });
  ck('DATABASE_POOLED=keep leaves the endpoint alone',
    r.connectionString === POOLED_STRICT && r.pooled === true, r.connectionString);
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
