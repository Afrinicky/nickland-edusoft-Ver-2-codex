// Nickland Edusoft — not asking Neon the same question twice.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The spike measured one Students screen at 54 queries, and found that six of
// every seven were not the screen's data at all. They were the same reads on
// every single channel: the bearer token, the account behind it, that
// account's permissions, and its teaching scope. `settings:list-subjects` runs
// ONE select of its own and cost seven.
//
// That is not a fault in the handlers. On the office PC those reads are a
// local file and cost nothing worth measuring, and re-reading them per request
// is deliberate — it is what makes a permission withdrawn in the office take
// effect on somebody's very next tap. Over a network the same habit is the
// difference between a screen that feels instant and one that does not.
//
// So this sits UNDER the handlers, in the adapter, and none of them know about
// it. It remembers what a read answered and forgets it the moment anything
// writes to a table that read touched.
//
// == Why this is safe, and where it would stop being safe ==
//
// Invalidation is by TABLE, and it is exact for one reason: this host is the
// only thing writing to this database. A permission changed through the office
// application is an UPDATE that passes through here, and every cached read
// touching that table is dropped on the spot — so "takes effect on the next
// request" still holds, exactly as the desktop promises.
//
// It would stop being exact with a SECOND writer: another Render instance, or
// somebody editing rows in the Neon console. The short TTL is the backstop for
// that, and it is why the default is seconds rather than minutes. Before this
// host is ever run as more than one instance that needs revisiting, and
// docs/WEB_DEPLOYMENT.md says so where somebody scaling it will look.

// Which tables a statement touches. Deliberately generous: a table this missed
// would mean a stale read, so anything it cannot recognise is not cached.
const TABLE_PATTERN = /\b(?:FROM|JOIN|INTO|UPDATE)\s+"?([a-z_][a-z0-9_]*)"?/gi;

function tablesIn(sql) {
  const found = new Set();
  let m;
  TABLE_PATTERN.lastIndex = 0;
  while ((m = TABLE_PATTERN.exec(sql)) !== null) found.add(m[1].toLowerCase());
  return found;
}

const IS_READ = /^\s*(?:WITH\b[\s\S]*?)?SELECT\b/i;

// Reads that must never be served from memory: they ask "what is true right
// now", and a remembered answer to that is a wrong answer.
const NEVER_CACHE = [
  // Receipt and admission numbers are allocated by reading the last one. A
  // cached read here issues the same number twice, and a duplicated receipt
  // number is what an audit of a school's books treats as a forgery.
  /\bMAX\s*\(/i,
  /\bnextval\b/i,
  // An escape hatch for any statement that must always be fresh.
  /\/\*\s*no-cache\s*\*\//i,
];

function createCache({ ttlMs = 5000, maxEntries = 500, enabled = true } = {}) {
  const entries = new Map();          // key -> { value, expires, tables }
  const stats = { hits: 0, misses: 0, invalidations: 0, skipped: 0 };

  const keyFor = (sql, params) => sql + ' ' + JSON.stringify(params);

  function cacheable(sql) {
    if (!enabled) return false;
    if (!IS_READ.test(sql)) return false;
    for (const pattern of NEVER_CACHE) if (pattern.test(sql)) return false;
    return true;
  }

  function get(sql, params) {
    if (!cacheable(sql)) { stats.skipped++; return undefined; }
    const key = keyFor(sql, params);
    const hit = entries.get(key);
    if (!hit) { stats.misses++; return undefined; }
    if (hit.expires < Date.now()) { entries.delete(key); stats.misses++; return undefined; }
    stats.hits++;
    // Handed back as a copy. A handler that sorts or edits what it was given
    // must not be editing what the next request will be handed.
    return { value: structuredClone(hit.value) };
  }

  function put(sql, params, value) {
    if (!cacheable(sql)) return;
    if (entries.size >= maxEntries) {
      // Oldest out first. A school's working set is small; this is a ceiling,
      // not a strategy.
      const oldest = entries.keys().next();
      if (!oldest.done) entries.delete(oldest.value);
    }
    entries.set(keyFor(sql, params), {
      value: structuredClone(value),
      expires: Date.now() + ttlMs,
      tables: tablesIn(sql),
    });
  }

  // Anything written forgets every read that touched the same table.
  function invalidate(sql) {
    const written = tablesIn(sql);
    stats.invalidations++;
    if (!written.size) { entries.clear(); return; }
    for (const [key, entry] of entries) {
      for (const table of written) {
        if (entry.tables.has(table)) { entries.delete(key); break; }
      }
    }
  }

  // A transaction's writes are invisible to anybody else until it commits, and
  // gone if it rolls back. So the cache is emptied at the END of one rather
  // than trusting statement-by-statement invalidation through the middle.
  function clear() { entries.clear(); }

  function report() {
    const total = stats.hits + stats.misses;
    return { ...stats, size: entries.size,
             hitRate: total ? Math.round((stats.hits / total) * 100) : 0 };
  }

  function resetStats() { stats.hits = stats.misses = stats.invalidations = stats.skipped = 0; }

  return { get, put, invalidate, clear, report, resetStats, tablesIn, cacheable };
}

module.exports = { createCache, tablesIn };
