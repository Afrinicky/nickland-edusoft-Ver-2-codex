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

-- A school's payment gateway, for taking fees over the internet when the
-- school's own desktop is switched off. Written ONLY by that desktop, through
-- the school-key admin route, and only when the school has deliberately turned
-- internet payments on. Read only by the code that calls the gateway.
--
-- It is deliberately NOT a snapshot row. Snapshots are what the parent and
-- staff endpoints read from; a secret kept among them is one forgotten filter
-- away from being served to somebody. No endpoint returns `secret`, and none
-- should ever be added — a school that needs to change its key re-enters it on
-- its own desktop, which is where the key came from.
CREATE TABLE IF NOT EXISTS school_payments (
  school_id    TEXT PRIMARY KEY REFERENCES schools(school_id) ON DELETE CASCADE,
  gateway      TEXT NOT NULL,
  secret       TEXT NOT NULL,
  public_key   TEXT,
  base_url     TEXT,
  currency     TEXT NOT NULL DEFAULT 'GHS',
  callback_url TEXT,
  min_amount   NUMERIC NOT NULL DEFAULT 1,
  max_amount   NUMERIC NOT NULL DEFAULT 10000,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── The platform's own audit trail ──────────────────────────────────────────
-- Every school keeps its own audit log INSIDE its own schema, which is right:
-- who changed a mark is the school's business and nobody else's. But some acts
-- are not any one school's — enrolling one, reissuing its sync key, a key
-- presented that belongs to nobody — and those have nowhere to be written. A
-- school cannot hold the record of its own creation, and an attempt to use a
-- key against a school that rejected it must not be filed under the school the
-- attacker was aiming at.
--
-- So this is deliberately OUTSIDE any tenant. `school_id` is the school an
-- entry is ABOUT and is nullable, because a refused key is about no school.
-- Nothing here is served to a school; it answers only to the platform key.
--
-- No ON DELETE CASCADE on school_id, and that is the point: retiring a school
-- must not erase the record that it existed, was enrolled on a date, and was
-- removed on another.
CREATE TABLE IF NOT EXISTS platform_audit (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  action      TEXT NOT NULL,           -- school_enrolled | key_rotated | key_refused | …
  school_id   TEXT,                    -- the school it is about; NULL when none
  actor       TEXT,                    -- 'platform' | 'school' | 'anonymous'
  outcome     TEXT NOT NULL DEFAULT 'ok',   -- ok | refused | failed
  detail      TEXT,                    -- one sentence, for a person to read
  remote_addr TEXT
);
CREATE INDEX IF NOT EXISTS idx_platform_audit_at ON platform_audit(at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_school ON platform_audit(school_id, at DESC);
-- Refusals are what an operator comes looking for, so they are indexed apart
-- from the ordinary traffic they would otherwise be buried in.
CREATE INDEX IF NOT EXISTS idx_platform_audit_refused ON platform_audit(outcome, at DESC)
  WHERE outcome <> 'ok';
