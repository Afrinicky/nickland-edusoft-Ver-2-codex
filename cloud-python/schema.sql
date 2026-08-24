-- Nickland Edusoft Cloud — Neon/Postgres schema (multi-tenant, thin cloud)
-- Run once against your Neon database, then set DATABASE_URL for the service.

CREATE TABLE IF NOT EXISTS schools (
  school_id  TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  key_hash   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_key ON schools(key_hash);

-- How far this school's desktop has consumed the change queue. Set on every
-- pull, and the only way the service can tell a teacher's write that is still
-- waiting from one the school has already applied — which is what lets a
-- teacher who marked a register last night see their marks this morning
-- rather than a blank sheet. Added after the first release, so it is an
-- ALTER for existing databases rather than part of the CREATE above.
ALTER TABLE schools ADD COLUMN IF NOT EXISTS applied_cursor BIGINT NOT NULL DEFAULT 0;

-- Thin read model: the latest projection per entity, overwrite-on-sync.
CREATE TABLE IF NOT EXISTS snapshots (
  school_id   TEXT NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,          -- student_snapshot | receipt | notification | …
  entity_key  TEXT NOT NULL,          -- e.g. 'student:12'
  uuid        TEXT,
  op          TEXT NOT NULL DEFAULT 'upsert',
  version     INTEGER NOT NULL DEFAULT 1,
  payload     JSONB,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, entity_key)
);
CREATE INDEX IF NOT EXISTS idx_snapshots_type ON snapshots(school_id, entity_type);

-- Cloud→local change queue (parent portal edits, etc.). Desktop pulls by id.
CREATE TABLE IF NOT EXISTS cloud_changes (
  id         BIGSERIAL PRIMARY KEY,
  school_id  TEXT NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_changes_school ON cloud_changes(school_id, id);
-- Serving a teacher their own pending work filters the queue by kind.
CREATE INDEX IF NOT EXISTS idx_changes_pending ON cloud_changes(school_id, type, id);

-- Row-level security is recommended in production so a leaked query can't cross
-- tenants; the app also always scopes by school_id.
