// Postgres/Neon store — production. Lazily requires `pg` so the memory store
// (tests/dev) has no external dependency. Run schema.sql once against your Neon
// database, then set DATABASE_URL. Multi-tenant: every row carries school_id.
const auth = require('../auth');

function createPgStore(connectionString) {
  let Pool;
  try { ({ Pool } = require('pg')); }
  catch (_) { throw new Error("The 'pg' package is required for the Postgres store. Run: npm install"); }
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

  return {
    kind: 'pg',
    pool,

    async createSchool({ name, school_id }) {
      const id = school_id || 'sch_' + Math.random().toString(36).slice(2, 10);
      const key = auth.genKey();
      await pool.query(
        'INSERT INTO schools (school_id, name, key_hash) VALUES ($1, $2, $3)',
        [id, name || id, auth.hashKey(key)]
      );
      return { school_id: id, api_key: key };
    },

    async getSchoolByKey(key) {
      const { rows } = await pool.query('SELECT school_id, name FROM schools WHERE key_hash = $1', [auth.hashKey(key)]);
      return rows[0] || null;
    },

    async upsertSnapshot(school_id, rec) {
      await pool.query(`
        INSERT INTO snapshots (school_id, entity_type, entity_key, uuid, op, version, payload, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7, now())
        ON CONFLICT (school_id, entity_key) DO UPDATE
          SET uuid = EXCLUDED.uuid, op = EXCLUDED.op, version = EXCLUDED.version,
              payload = EXCLUDED.payload, updated_at = now()
          WHERE snapshots.version <= EXCLUDED.version
      `, [school_id, rec.entity_type, rec.entity_key, rec.uuid, rec.op || 'upsert', rec.version || 1, rec.payload]);
      return true;
    },

    async listSnapshots(school_id, entity_type) {
      const { rows } = entity_type
        ? await pool.query('SELECT entity_type, entity_key, uuid, op, version, payload, updated_at FROM snapshots WHERE school_id = $1 AND entity_type = $2', [school_id, entity_type])
        : await pool.query('SELECT entity_type, entity_key, uuid, op, version, payload, updated_at FROM snapshots WHERE school_id = $1', [school_id]);
      return rows;
    },

    async enqueueChange(school_id, ch) {
      const { rows } = await pool.query(
        'INSERT INTO cloud_changes (school_id, type, payload) VALUES ($1,$2,$3) RETURNING id',
        [school_id, ch.type, ch.payload]
      );
      return rows[0].id;
    },

    async changesSince(school_id, cursor) {
      const cur = parseInt(cursor || '0', 10) || 0;
      const { rows } = await pool.query(
        'SELECT id, type, payload FROM cloud_changes WHERE school_id = $1 AND id > $2 ORDER BY id ASC LIMIT 500',
        [school_id, cur]
      );
      const next = rows.length ? rows[rows.length - 1].id : cur;
      return { changes: rows.map(r => ({ type: r.type, payload: r.payload })), cursor: next };
    },
  };
}

module.exports = { createPgStore };
