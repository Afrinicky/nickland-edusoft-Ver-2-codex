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
public/index.html   the parent web app (SPA), shared with the Node version
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

## Run
```bash
cd cloud-python
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
# Dev (in-memory):
uvicorn app.main:app --reload --port 8080
# Production (Neon):
psql "$DATABASE_URL" -f schema.sql            # once
DATABASE_URL=postgres://…  uvicorn app.main:app --host 0.0.0.0 --port 8080
```

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
