// Store selector — Postgres/Neon when DATABASE_URL is set, else in-memory.
const { createMemoryStore } = require('./memory');
const { createPgStore } = require('./pg');

function createStore() {
  const url = process.env.DATABASE_URL;
  if (url) return createPgStore(url);
  return createMemoryStore();
}

module.exports = { createStore, createMemoryStore, createPgStore };
