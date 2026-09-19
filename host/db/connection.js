// Nickland Edusoft — which endpoint the school's database answers on.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The school's tables live in their own Postgres schema ("school"), so every
// connection has to be told where to look. The obvious way to say that is the
// startup parameter every Postgres driver supports:
//
//     options: '-c search_path=school'
//
// Neon's POOLED endpoint — the host with `-pooler` in it — refuses it:
//
//     unsupported startup parameter in options: search_path
//
// It is PgBouncer, and PgBouncer will not carry a startup parameter it does
// not recognise. That refusal happens on the very first query, which is why a
// perfectly good deploy came up, failed its health check for eighteen minutes
// and timed out with nothing wrong but this.
//
// Saying `SET search_path` after connecting does not rescue the pooled
// endpoint either: PgBouncer pools by TRANSACTION, so the next statement is
// likely to be handed a different server connection that never saw the SET.
// A session setting needs a session, and the pooled endpoint does not give
// one.
//
// So when a schema has to be pinned, this host talks to Neon's DIRECT
// endpoint — the same host name without `-pooler`, which is exactly what
// Neon's own error message asks for. That costs this service nothing: the
// main thread blocks on every query (see neon.js), so one instance can only
// ever have a single query in flight and the pool is three connections at its
// widest. Pooling exists for the opposite problem.
//
// Nobody has to change the connection string they were given. The pooled one
// works: it is normalised here, and the log says so.

const POOLER = /-pooler(?=\.|$)/i;

// Split a connection string without URL-parsing it. A Postgres password is
// allowed to contain characters that `new URL()` mangles or rejects, and the
// only part that needs touching is the host.
function split(connectionString) {
  const m = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/?#]*)([\s\S]*)$/.exec(String(connectionString || ''));
  if (!m) return null;
  const authority = m[2];
  const at = authority.lastIndexOf('@');
  return {
    scheme: m[1],
    userinfo: at >= 0 ? authority.slice(0, at + 1) : '',
    hostport: at >= 0 ? authority.slice(at + 1) : authority,
    rest: m[3],
  };
}

function join(p) {
  return p.scheme + p.userinfo + p.hostport + p.rest;
}

function isPooled(connectionString) {
  const p = split(connectionString);
  return !!p && POOLER.test(p.hostport);
}

// The direct endpoint is the pooled one with `-pooler` taken out of the host.
function unpooled(connectionString) {
  const p = split(connectionString);
  if (!p || !POOLER.test(p.hostport)) return String(connectionString || '');
  p.hostport = p.hostport.replace(POOLER, '');
  return join(p);
}

// A hand-written `options=-c search_path=…` in the query string is the same
// startup parameter by another route, and this host sets the search path
// itself. Left in place it would be the identical refusal.
function stripOptions(connectionString) {
  const p = split(connectionString);
  if (!p) return { connectionString: String(connectionString || ''), stripped: false };
  const q = p.rest.indexOf('?');
  if (q < 0) return { connectionString: String(connectionString), stripped: false };
  const head = p.rest.slice(0, q + 1);
  const [query, ...hash] = p.rest.slice(q + 1).split('#');
  const kept = query.split('&').filter(pair => pair && !/^options=/i.test(pair));
  if (kept.length === query.split('&').filter(Boolean).length) {
    return { connectionString: String(connectionString), stripped: false };
  }
  p.rest = (kept.length ? head + kept.join('&') : p.rest.slice(0, q)) +
           (hash.length ? '#' + hash.join('#') : '');
  return { connectionString: join(p), stripped: true };
}

// An identifier the school chose, said safely. `school` passes through as it
// is; anything else is quoted rather than refused, because a schema name is
// configuration and not a place to be clever.
function quoteIdent(name) {
  const s = String(name);
  if (/^[a-z_][a-z0-9_$]*$/.test(s)) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

// What this host should actually connect to, and what to say about it.
//
//   schema      the schema to pin, or null/'public' for none
//   keepPooled  honour the string exactly as given (DATABASE_POOLED=keep)
function resolveConnection(connectionString, options = {}) {
  const given = String(connectionString || '');
  const schema = options.schema && String(options.schema) !== 'public' ? String(options.schema) : null;
  const notes = [];
  let out = given;

  if (schema) {
    const s = stripOptions(out);
    out = s.connectionString;
    if (s.stripped) {
      notes.push('Removed `options` from the database URL — this host sets the search path itself.');
    }
  }

  if (schema && isPooled(out) && !options.keepPooled) {
    out = unpooled(out);
    notes.push(
      'Using Neon\'s direct endpoint rather than the pooled one, because the pooled ' +
      'endpoint cannot hold the school\'s schema (search_path) for a session. ' +
      'This host blocks on every query, so it never needs the pooler.'
    );
  } else if (schema && isPooled(out) && options.keepPooled) {
    notes.push(
      'DATABASE_POOLED=keep — staying on the pooled endpoint. The schema must then be ' +
      'the connecting role\'s default (host/provision.js sets it), or every query will ' +
      'fail to find the school\'s tables.'
    );
  }

  return { connectionString: out, schema, notes, pooled: isPooled(out) };
}

// Whether the operator asked for the string to be left exactly as given.
function keepPooledFromEnv(env = process.env) {
  const v = String(env.DATABASE_POOLED || '').toLowerCase();
  return v === 'keep' || v === '1' || v === 'true' || v === 'yes';
}

module.exports = { resolveConnection, isPooled, unpooled, stripOptions, quoteIdent, keepPooledFromEnv };
