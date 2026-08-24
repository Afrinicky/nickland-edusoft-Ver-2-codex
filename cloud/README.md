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
**Staff** endpoints — teachers working with the school's desktop switched off.
Reads come from the projections the desktop pushes; writes are queued for it to
apply. See [`../docs/WEB_APP.md`](../docs/WEB_APP.md).
```
POST /api/v1/staff/login                   → { ok, token, user }   { school_id, username, password }
GET  /api/v1/staff/me             (Bearer) → profile + resolved permissions
GET  /api/v1/staff/dashboard|students|debtors|classes
GET  /api/v1/staff/attendance?classId=&date=      POST /api/v1/staff/attendance
GET  /api/v1/staff/scores/subjects?classId=
GET  /api/v1/staff/scores?classId=&subjectId=     POST /api/v1/staff/scores
GET  /api/v1/staff/canteen/student/:id            POST /api/v1/staff/canteen/collect
GET  /api/v1/staff/timetable/mine
GET  /api/v1/staff/homework?classId=              POST /api/v1/staff/homework
GET  /api/v1/staff/pending                 → { ok, pending, by_type }
```
Teachers authenticate against a **`staff_auth` projection** the desktop pushes
up — the **bcrypt** hash it already stores, so nobody is re-enrolled. Every
write replies `{ ok, queued: true }` and is merged over the read model until the
desktop takes it, so a `GET` after a write shows the write (flagged `pending`).

**Parent portal** endpoints — the public website:
```
GET  /                                     → the web app if one is installed, else the legacy page
GET  /legacy                               → the legacy hand-written parent page, always
GET  /api/v1/info                          → { ok, mode:'cloud', portal:true, schools }  (public)
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
node test/staff.js   # the teacher-off-LAN round trip
```
The e2e test exercises push (snapshot → cloud read model), the portal read
endpoint, pull (cloud change → applied on the desktop), idempotency, and
key rejection — no Postgres required. `test/staff.js` runs the whole staff
loop against a real desktop database: project, sign in over the internet with
the desktop offline, mark a register, see the pending work, then have the
desktop pull and apply it — and prove a redelivered batch does not take the
canteen money twice.

## Deploy (suggested)
- Host on any Node platform (Render, Railway, Fly, a VPS) or serverless with a
  persistent Node process; point it at a **Neon** database via `DATABASE_URL`.
- Put it behind HTTPS. The desktop's Cloud Sync just needs the base URL + the
  school's key.
- The public **web app** — the browser build of `mobile/`, covering parents and
  (against a desktop host) staff — is the front end now. Build it with
  `npm run build:web` at the repo root; it lands in `cloud/webapp/` and this
  service serves it at `/`, or point `WEBAPP_DIR` at a copy. The usual
  production shape puts it on a CDN (Vercel) with this service behind it as the
  API, in which case nothing is installed here and `/` stays the legacy page.
  See [`../docs/WEB_APP.md`](../docs/WEB_APP.md).
- `/api/v1/info` is public and answers the same question the desktop host does,
  so a client can discover what it is talking to in one request.
