// Store selector — Postgres/Neon when DATABASE_URL is set, else in-memory.
const { createMemoryStore } = require('./memory');
const { createPgStore } = require('./pg');

// The in-memory store is for tests and local runs only. Falling back to it
// silently on a deployment loses every school, parent account and receipt on
// each restart, so require an explicit opt-in instead.
function createStore() {
  const url = process.env.DATABASE_URL;
  if (url) return createPgStore(url);
  if (process.env.ALLOW_MEMORY_STORE === '1') return createMemoryStore();
  throw new Error(
    'DATABASE_URL is not set. The cloud service needs Postgres/Neon — without it ' +
    'nothing is persisted. Set DATABASE_URL (with ?sslmode=require), or set ' +
    'ALLOW_MEMORY_STORE=1 for a throwaway local/test run.'
  );
}

module.exports = { createStore, createMemoryStore, createPgStore };
