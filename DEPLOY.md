# Deploying the web app

The browser app in `mobile/` is one bundle that serves three deployments. This
covers the hosted one: **Vercel for the app, Neon for the database.**

The other two are unchanged and need nothing here — the desktop installer ships
its own copy in `resources/webapp/` and serves it over the school Wi-Fi, and the
Android APK is built from the same source with the portal address baked in.

---

## The shape of it

```
   parent's phone  ─┐
   teacher's phone ─┼──►  Vercel        the app itself: HTML, JS, images
   staffroom PC    ─┘     (static)      no database, no secrets
                              │
                              │  /api/v1/…
                              ▼
                         cloud-python                the read model + the queue
                         (Render / Fly)              of things done off-LAN
                              │
                              ▼
                            Neon                     Postgres
                              ▲
                              │  sync, both ways
                         the school's desktop         the source of truth
```

The desktop host stays the source of truth. The cloud holds a thin read model
and a queue of changes made while the desktop was unreachable; the desktop
drains that queue when it next comes online. Nothing in the cloud is
authoritative.

---

## 1. Neon

1. Create a project. Any region — pick the one nearest the school; for Ghana
   that is `eu-central-1` (Frankfurt), which is a shorter round trip than
   anything in the US.
2. Copy the **pooled** connection string, the one whose host contains
   `-pooler`. The unpooled one runs out of connections as soon as the service
   scales past one instance.
3. Load the schema once:

   ```bash
   psql "postgres://…-pooler…?sslmode=require" -f cloud-python/schema.sql
   ```

4. `?sslmode=require` is not optional. Neon refuses plain connections, and the
   error it gives is not obviously about TLS.

## 2. The API

`cloud-python/` is a FastAPI service. `render.yaml` and `fly.toml` are both in
the repo; either host works.

| Variable | | |
|---|---|---|
| `DATABASE_URL` | required | the pooled Neon string, with `?sslmode=require` |
| `PORTAL_SECRET` | required | `openssl rand -hex 32`. Signs parent and teacher sessions — **changing it signs everyone out** |
| `ALLOW_MEMORY_STORE` | never set it in production | the in-memory store loses every school, account and receipt on each restart, and each worker keeps its own copy, so the same request succeeds or 401s depending on which one answers |

The service refuses to start without `DATABASE_URL` rather than falling back to
memory, which is deliberate: a silent fallback fails in ways that look like
random breakage rather than misconfiguration.

Then provision the school and keep the key it prints — it is shown once, and it
is what the desktop authenticates with:

```bash
DATABASE_URL="postgres://…" python cloud-python/scripts/create_school.py "Ave Maria Preparatory School"
```

## 3. Vercel

Import the repository. `vercel.json` already sets the build, the install, the
output directory, the cache headers and the SPA rewrite, so the only thing to
set by hand is where the API is.

**Project → Settings → Environment Variables:**

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_PORTAL_URL` | `https://your-api.onrender.com` — no trailing slash |
| `EXPO_PUBLIC_SCHOOL_ID` | *optional.* The `school_id` from step 2. Set it and the app skips the school picker; leave it out and a one-school portal auto-picks anyway |

**A Vercel build fails** if neither `EXPO_PUBLIC_PORTAL_URL` nor
`EXPO_PUBLIC_SAME_ORIGIN_API=1` is set. That is on purpose. Without an address
the app builds green, deploys, finds no API on its own origin, falls back to an
empty default, and shows every user the Connect screen — with nothing in the
build log to say why. Better to fail at the point the mistake was made.

Only Vercel is held to this, on the `VERCEL` environment variable it sets
itself. A build with no portal address is otherwise perfectly valid — it is the
copy the desktop host serves over the school Wi-Fi, which answers for itself —
and it is what the Actions workflow produces.

`EXPO_PUBLIC_*` values are compiled **into** the bundle, so changing one needs a
redeploy, not a restart. The build passes `--clear` for the same reason: Metro's
cache does not key on these, so without it a changed address rebuilds happily
and ships the old one.

### About the rewrite

```json
{ "source": "/((?!api/).*)", "destination": "/index.html" }
```

Everything that is not a real file becomes `index.html`, because expo-router
routes `/staff/scores` in the browser and Vercel would otherwise 404 it.

`/api` is excluded on purpose. Without the exclusion, a same-origin API — a
Vercel function, or a proxy added later — is swallowed by this rule and answers
every call with the HTML of the app, which the client then fails to parse as
JSON. The exclusion costs nothing while there is no API on this domain.

## 4. Point the desktop at it

On the school's machine, **Settings → Cloud sync**: the portal URL from step 3
and the school key from step 2. The desktop pushes its read model up and drains
the change queue on a timer.

---

## Checking a deploy

```bash
curl https://your-api.example.com/api/v1/health          # the service is up
curl https://your-api.example.com/api/v1/portal/schools  # it can reach Neon
curl -I https://your-app.vercel.app/                     # the app is served
curl -s https://your-app.vercel.app/ | grep -o 'EXPO_PUBLIC_PORTAL_URL[^"]*'
```

`/health` is deliberately database-independent, so it answering tells you the
process is alive and nothing more. `/portal/schools` is the one that proves the
Neon connection works.

If the app shows the Connect screen to everyone, the API address did not make it
into the bundle. Check the Vercel build log for the line beginning
`→ Building the web app (portal: …)` — if it has no `portal:`, the environment
variable was not set for that environment (Production and Preview are
configured separately).

---

## Running it locally against a real Neon

```bash
cd cloud-python
DATABASE_URL="postgres://…?sslmode=require" PORTAL_SECRET=dev uvicorn app.main:app --reload
```

and in another terminal:

```bash
EXPO_PUBLIC_PORTAL_URL=http://127.0.0.1:8000 npm run build:web -- --only-build
npx serve mobile/dist-web
```

The test suite does not need any of this — it runs against the in-memory store.
