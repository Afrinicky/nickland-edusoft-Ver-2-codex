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

    async getSchool(school_id) {
      const { rows } = await pool.query('SELECT school_id, name FROM schools WHERE school_id = $1', [school_id]);
      return rows[0] || null;
    },

    async listSchools() {
      const { rows } = await pool.query('SELECT school_id, name FROM schools ORDER BY name');
      return rows;
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

    // ── Gateway configuration (write-mostly) ──
    // Its own table rather than a snapshot row: snapshots are what the staff
    // and parent endpoints read from, and a secret kept there is one
    // forgotten filter away from being served to somebody.
    async setPaymentConfig(school_id, cfg) {
      if (!cfg || cfg.gateway === 'none') {
        await pool.query('DELETE FROM school_payments WHERE school_id = $1', [school_id]);
        return true;
      }
      await pool.query(`
        INSERT INTO school_payments (school_id, gateway, secret, public_key, base_url, currency,
          callback_url, min_amount, max_amount, enabled, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
        ON CONFLICT (school_id) DO UPDATE SET
          gateway = EXCLUDED.gateway, secret = EXCLUDED.secret, public_key = EXCLUDED.public_key,
          base_url = EXCLUDED.base_url, currency = EXCLUDED.currency,
          callback_url = EXCLUDED.callback_url, min_amount = EXCLUDED.min_amount,
          max_amount = EXCLUDED.max_amount, enabled = EXCLUDED.enabled, updated_at = now()
      `, [school_id, cfg.gateway, cfg.secret || '', cfg.public_key || '', cfg.base_url || '',
          cfg.currency || 'GHS', cfg.callback_url || '',
          cfg.min_amount || 1, cfg.max_amount || 10000, cfg.enabled !== false]);
      return true;
    },

    async getPaymentConfig(school_id) {
      const { rows } = await pool.query('SELECT * FROM school_payments WHERE school_id = $1', [school_id]);
      return rows[0] || null;
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
      // The desktop asking for everything after `cur` is its receipt for
      // everything up to it — see setAppliedCursor.
      if (cur > 0) { try { await this.setAppliedCursor(school_id, cur); } catch (_) {} }
      return { changes: rows.map(r => ({ type: r.type, payload: r.payload })), cursor: next };
    },

    // How far the desktop has consumed. Recorded on every pull, and the only
    // way the cloud can tell a write that is still waiting from one the school
    // has already applied — which is what lets a teacher who marked a register
    // last night see their marks this morning instead of a blank sheet.
    // GREATEST so an out-of-order or replayed pull cannot wind it backwards.
    async setAppliedCursor(school_id, cursor) {
      const n = parseInt(cursor || '0', 10) || 0;
      await pool.query(
        'UPDATE schools SET applied_cursor = GREATEST(COALESCE(applied_cursor, 0), $2) WHERE school_id = $1',
        [school_id, n]
      );
      return true;
    },

    async appliedCursor(school_id) {
      const { rows } = await pool.query('SELECT COALESCE(applied_cursor, 0) AS c FROM schools WHERE school_id = $1', [school_id]);
      return rows[0] ? Number(rows[0].c) : 0;
    },

    // Changes the desktop has not taken yet, newest last.
    async pendingChanges(school_id, { types = null, limit = 500 } = {}) {
      const cur = await this.appliedCursor(school_id);
      const { rows } = types && types.length
        ? await pool.query(
            'SELECT id, type, payload FROM cloud_changes WHERE school_id = $1 AND id > $2 AND type = ANY($3) ORDER BY id ASC LIMIT $4',
            [school_id, cur, types, limit])
        : await pool.query(
            'SELECT id, type, payload FROM cloud_changes WHERE school_id = $1 AND id > $2 ORDER BY id ASC LIMIT $3',
            [school_id, cur, limit]);
      return rows.map(r => ({ id: Number(r.id), type: r.type, payload: r.payload }));
    },
  };
}

module.exports = { createPgStore };
