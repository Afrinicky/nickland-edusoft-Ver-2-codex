# Nickland Edusoft — Cloud (multi-school portal + sync API)

> **Note:** a Python/FastAPI port (the going-forward implementation for the
> team's Python migration) lives in [`../cloud-python/`](../cloud-python/) and
> speaks the identical contract. This Node version remains as reference.

The hosted service each school's desktop syncs to, and the backend for the
multi-school website. It is deliberately **thin**: it holds only a small read
model (balances, receipts, notices) + a change queue per tenant — never the
full dataset. Each desktop stays the source of truth (see
[`../docs/CLOUD_SYNC.md`](../docs/CLOUD_SYNC.md)).

## Design
- **Multi-tenant.** One row per school; every table carries `school_id`. Auth is
  a per-school API key (`x-school-key`), stored only as a SHA-256 hash.
- **Storage-agnostic.** `DATABASE_URL` set → Postgres/Neon (`pg`); unset →
  in-memory (dev/tests). Same interface either way.
- **No framework.** Node's built-in `http`, matching the desktop's dependency
  discipline. `pg` is the only production dependency and is lazily required.

## API
**School-key** endpoints (`x-school-key`) — desktop host + portal backend:
```
GET  /health
GET  /api/v1/sync/ping                     → { ok, school }
POST /api/v1/sync/push                     → { ok, accepted:[uuid] }
GET  /api/v1/sync/pull?since=<cursor>      → { ok, cursor, changes }
GET  /api/v1/admin/snapshots[?type=]       → { ok, snapshots }   (read model)
POST /api/v1/admin/enqueue-change          → { ok, id }          (queue a cloud→local change)
```
**Parent portal** endpoints — the public website:
```
GET  /                                     → the parent web app (SPA)
GET  /api/v1/portal/schools                → { ok, schools }     (login picker)
POST /api/v1/portal/login                  → { ok, token, parent }   { school_id, identifier, password }
GET  /api/v1/portal/me            (Bearer) → { ok, parent, school }
GET  /api/v1/portal/children      (Bearer) → { ok, children }    (thin snapshots)
GET  /api/v1/portal/receipts      (Bearer) → { ok, receipts }
POST /api/v1/portal/profile       (Bearer) → { ok }              (queues parent_update to desktop)
```
Parents authenticate against a **`parent_auth` projection** the desktop pushes
up (scrypt hash + linked student keys) — the account stays owned by the school's
desktop; the cloud only verifies and issues a signed session token.

## Run
```bash
cd cloud
npm install                       # only needed for Postgres (pg)
# Dev (in-memory):
npm start
# Production (Neon):
psql "$DATABASE_URL" -f schema.sql   # once
DATABASE_URL=postgres://…  PORT=8080  npm start
```

## Provision a school
```bash
DATABASE_URL=…  npm run create-school -- "Ave Maria School Acherensua"
# prints school_id + api_key → enter on the desktop under Settings → Cloud Sync
```

## Test
```bash
npm test     # boots the real server (in-memory) + the real desktop sync client
```
The e2e test exercises push (snapshot → cloud read model), the portal read
endpoint, pull (cloud change → applied on the desktop), idempotency, and
key rejection — no Postgres required.

## Deploy (suggested)
- Host on any Node platform (Render, Railway, Fly, a VPS) or serverless with a
  persistent Node process; point it at a **Neon** database via `DATABASE_URL`.
- Put it behind HTTPS. The desktop's Cloud Sync just needs the base URL + the
  school's key.
- The public multi-school **website/portal frontend** (parent login, child
  pages) reads the `snapshots` read model and enqueues parent edits via
  `portal/enqueue-change`; build it as a separate app against this same API.
