// In-memory store — used for local dev and tests. Same interface as the
// Postgres/Neon store, so the server code is storage-agnostic.
const auth = require('../auth');

function createMemoryStore() {
  const schools = new Map();   // school_id -> { name, key_hash, applied_cursor }
  const snapshots = new Map(); // school_id -> Map(entity_key -> record)
  const changes = new Map();   // school_id -> { seq, items:[{id,type,payload}] }
  let sidSeq = 1;

  function ensure(id) {
    if (!snapshots.has(id)) snapshots.set(id, new Map());
    if (!changes.has(id)) changes.set(id, { seq: 0, items: [] });
  }

  return {
    kind: 'memory',

    async createSchool({ name, school_id }) {
      const id = school_id || `sch_${sidSeq++}`;
      const key = auth.genKey();
      schools.set(id, { name: name || id, key_hash: auth.hashKey(key), applied_cursor: 0 });
      ensure(id);
      return { school_id: id, api_key: key };
    },

    async getSchoolByKey(key) {
      const h = auth.hashKey(key);
      for (const [id, s] of schools) if (s.key_hash === h) return { school_id: id, name: s.name };
      return null;
    },

    async getSchool(school_id) {
      const s = schools.get(school_id);
      return s ? { school_id, name: s.name } : null;
    },

    async listSchools() {
      return [...schools.entries()].map(([id, s]) => ({ school_id: id, name: s.name }));
    },

    // Idempotent upsert of a thin projection, keyed by entity_key; higher/equal
    // version wins so out-of-order retries never regress the read model.
    async upsertSnapshot(school_id, rec) {
      ensure(school_id);
      const m = snapshots.get(school_id);
      const existing = m.get(rec.entity_key);
      if (existing && (existing.version || 0) > (rec.version || 0)) return true;
      m.set(rec.entity_key, {
        uuid: rec.uuid, entity_type: rec.entity_type, entity_key: rec.entity_key,
        op: rec.op || 'upsert', version: rec.version || 1, payload: rec.payload,
        updated_at: new Date().toISOString(),
      });
      return true;
    },

    async listSnapshots(school_id, entity_type) {
      const m = snapshots.get(school_id) || new Map();
      return [...m.values()].filter(r => !entity_type || r.entity_type === entity_type);
    },

    async enqueueChange(school_id, ch) {
      ensure(school_id);
      const c = changes.get(school_id);
      const id = ++c.seq;
      c.items.push({ id, type: ch.type, payload: ch.payload });
      return id;
    },

    async changesSince(school_id, cursor) {
      const c = changes.get(school_id) || { items: [] };
      const cur = parseInt(cursor || '0', 10) || 0;
      const items = c.items.filter(i => i.id > cur);
      const next = items.length ? items[items.length - 1].id : cur;
      // The desktop asking for everything after `cur` is its receipt for
      // everything up to it — see setAppliedCursor.
      const s = schools.get(school_id);
      if (s && cur > (s.applied_cursor || 0)) s.applied_cursor = cur;
      return { changes: items.map(({ id, ...rest }) => rest), cursor: next };
    },

    // How far the desktop has consumed. Recorded on every pull, and the only
    // way the cloud can tell a write that is still waiting from one the school
    // has already applied — which is what lets a teacher who marked a register
    // last night see their marks this morning instead of a blank sheet.
    async setAppliedCursor(school_id, cursor) {
      const s = schools.get(school_id);
      const n = parseInt(cursor || '0', 10) || 0;
      if (s && n > (s.applied_cursor || 0)) s.applied_cursor = n;
      return true;
    },

    async appliedCursor(school_id) {
      return (schools.get(school_id) || {}).applied_cursor || 0;
    },

    // Changes the desktop has not taken yet, newest last. `types` filters to
    // the kinds a caller can make sense of.
    async pendingChanges(school_id, { types = null, limit = 500 } = {}) {
      const c = changes.get(school_id) || { items: [] };
      const cur = (schools.get(school_id) || {}).applied_cursor || 0;
      return c.items
        .filter(i => i.id > cur && (!types || types.includes(i.type)))
        .slice(-limit)
        .map(i => ({ id: i.id, type: i.type, payload: i.payload }));
    },
  };
}

module.exports = { createMemoryStore };
