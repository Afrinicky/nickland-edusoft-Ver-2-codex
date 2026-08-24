# Nickland Edusoft — Cloud (Python / FastAPI)

The **going-forward** implementation of the multi-school portal + sync service,
in Python. It speaks the **identical HTTP contract** as the original Node
service (`../cloud/`), so the desktop sync client and the parent web app work
against it unchanged — verified by a cross-language test (Node desktop client ↔
this Python server).

Thin by design: the cloud holds only a small read model (balances, receipts,
notices) + a change queue per tenant. Each school's desktop SQLite stays the
source of truth (see [`../docs/CLOUD_SYNC.md`](../docs/CLOUD_SYNC.md)).

## Layout
```
app/
  main.py        FastAPI app (create_app) + all routes
  store.py       MemoryStore (dev/tests) + PgStore (Neon/Postgres, psycopg)
  auth.py        per-school API key hashing
  portal_auth.py scrypt verify (matches the desktop hash) + phone norm + tokens
  webapp.py      serves the browser build of the mobile app, when one is installed
public/index.html   the legacy parent page (SPA), shared with the Node version
webapp/             optional: the web app build (see ../docs/WEB_APP.md) — git-ignored
scripts/create_school.py   provision a tenant
schema.sql                 Neon/Postgres DDL
tests/         test_portal.py (FastAPI TestClient) + cross_lang.sh (Node↔Python)
```

## Auth & API
Same as the Node service — see [`../cloud/README.md`](../cloud/README.md) for the
full endpoint list. In short: `x-school-key` for `/api/v1/sync/*` and
`/api/v1/admin/*`; parent bearer tokens for `/api/v1/portal/*` (schools + login
public). Parents authenticate against a `parent_auth` projection the desktop
pushes up (scrypt hash + linked student keys).

`GET /api/v1/info` is public and answers the same question a desktop host does
(`{ ok, mode:'cloud', portal:true, schools }`), so a client discovers what it is
talking to in one request rather than probing endpoint by endpoint.

## The web app
`/` serves the browser build of the mobile app when one is installed under
`webapp/` (or wherever `WEBAPP_DIR` points), with unknown paths falling back to
its shell so client-side routes work; `/legacy` is always the hand-written
parent page. With no build installed — the usual production shape, where the
app is on a CDN and this service is only the API — `/` stays the legacy page.
Build one with `npm run build:web` at the repo root; see
[`../docs/WEB_APP.md`](../docs/WEB_APP.md).

## Required configuration

The service **refuses to start** without these two. Both failures used to be
silent, and both were dangerous:

| Variable | Why it is mandatory |
|---|---|
| `PORTAL_SECRET` | Signs parent session tokens. It previously fell back to a constant published in this repository — anyone who read the source could mint a valid session for any parent of any school. Generate with `openssl rand -hex 32`. |
| `DATABASE_URL` | Postgres/Neon connection string (append `?sslmode=require`). Without it the service used to fall back to in-memory storage: every school, parent and receipt vanished on each restart, and since the image runs several uvicorn workers, each worker held its own copy — so the same request succeeded or 401'd depending on which worker answered. |

For a throwaway local run or a test, opt in explicitly instead:
`ALLOW_DEV_SECRET=1 ALLOW_MEMORY_STORE=1`.

## Run
```bash
cd cloud-python
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

# Dev (in-memory, explicit opt-in — data is discarded on exit):
ALLOW_DEV_SECRET=1 ALLOW_MEMORY_STORE=1 uvicorn app.main:app --reload --port 8080

# Production (Neon):
psql "$DATABASE_URL" -f schema.sql            # once
PORTAL_SECRET="$(openssl rand -hex 32)" DATABASE_URL=postgres://…?sslmode=require \
  uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Keep `PORTAL_SECRET` stable across deploys — changing it signs every parent out.

## Provision a school
```bash
DATABASE_URL=…  python scripts/create_school.py "Ave Maria School Acherensua"
# prints school_id + api_key → enter on the desktop under Settings → Cloud Sync
```

## Test
```bash
python tests/test_portal.py     # FastAPI TestClient: portal + sync + cross-lang scrypt
bash   tests/cross_lang.sh       # boots this server; the REAL Node desktop client drives it
python tests/browser_smoke.py    # optional: real-browser (Playwright) UI smoke of the portal
```

## Deploy
Container image (`Dockerfile`) + one-click configs for **Render** (`render.yaml`)
and **Fly.io** (`fly.toml`). Point it at a **Neon** database via `DATABASE_URL`
and set `PORTAL_SECRET` (signs parent session tokens). `/health` is
DB-independent so platform health checks pass during cold starts.

```bash
# Local container
docker build -t nickland-cloud .
docker run -p 8080:8080 -e PORTAL_SECRET=dev -e DATABASE_URL="postgres://…?sslmode=require" nickland-cloud

# Render:  push repo → New Blueprint → picks up render.yaml (set DATABASE_URL)
# Fly.io:  cd cloud-python && fly launch --copy-config --now
#          fly secrets set PORTAL_SECRET=$(openssl rand -hex 32) DATABASE_URL="postgres://…?sslmode=require"
```
Run `schema.sql` once against Neon before first use, then provision schools with
`scripts/create_school.py`.

The image does **not** build the web app — that keeps deploys fast, and the app
is served by Vercel in the production shape described in
[`../docs/WEB_APP.md`](../docs/WEB_APP.md). To have this service serve it too,
mount a build and set `WEBAPP_DIR` to it.
