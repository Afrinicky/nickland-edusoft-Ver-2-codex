# Deploying the web app

The browser app in `mobile/` is one bundle that serves three deployments. This
covers the hosted one: **the cloud service, and Neon for the database.**

The other two are unchanged and need nothing here — the desktop installer ships
its own copy in `resources/webapp/` and serves it over the school Wi-Fi, and the
Android APK is built from the same source with the portal address baked in.

For setting the whole thing up in order, from an empty account, read
[`SETUP.md`](SETUP.md) part C. This document is the detail behind it.

---

## The shape of it

```
   parent's phone  ─┐
   teacher's phone ─┼──►  cloud-python         the app AND its API, one origin
   staffroom PC    ─┘     (Render / Fly)       the read model + the queue of
                              │                things done off-LAN
                              ▼
                            Neon                     Postgres
                              ▲
                              │  sync, both ways
                         the school's desktop         the source of truth
```

**One service.** The image builds `mobile/` and serves it from the same origin
as `/api/v1`, so a school's address is the whole product. That is not only
tidiness: the app works out what to talk to by asking the origin it was served
from (`mobile/src/origin.js`), so a same-origin deployment has no API address
to configure, and therefore none to get wrong on a later move.

The static-hosting shape below — the app on Vercel, this service behind it as
the API — still works and is documented in §3. It costs you the school
subdomains, because those are resolved by the service that serves the page.

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
3. There is no schema to load. The service applies `cloud-python/schema.sql`
   itself the first time it finds the tables missing, under an advisory lock so
   that two workers booting together do not both run it, and says which it did
   in the log. Running it by hand still works and changes nothing — every
   statement in the file is `IF NOT EXISTS`.

4. `?sslmode=require` is not optional. Neon refuses plain connections, and the
   error it gives is not obviously about TLS.

## 2. The service

`cloud-python/` is a FastAPI service, and the image also builds the app.
`render.yaml` and `fly.toml` are both in the repo; either host works. **Build
from the repository root** — `cloud-python/Dockerfile` copies `mobile/`, so a
build whose context is `cloud-python/` fails on the first COPY. Both config
files already say so.

| Variable | | |
|---|---|---|
| `DATABASE_URL` | required | the pooled Neon string, with `?sslmode=require` |
| `PORTAL_SECRET` | required | `openssl rand -hex 32`. Signs parent and teacher sessions — **changing it signs everyone out** |
| `PLATFORM_ADMIN_KEY` | for enrolment | 24 characters or more, or it is treated as unset and the platform routes answer 404 |
| `PORTAL_BASE_DOMAIN` | for addresses | the domain schools live under; see below |
| `ALLOW_MEMORY_STORE` | never set it in production | the in-memory store loses every school, account and receipt on each restart, and each worker keeps its own copy, so the same request succeeds or 401s depending on which one answers |

The service refuses to start without `DATABASE_URL` rather than falling back to
memory, which is deliberate: a silent fallback fails in ways that look like
random breakage rather than misconfiguration.

It reports what it has on the way up, and those five lines are the fastest
check that a deploy is what you meant:

```
[edusoft] store: pg
[edusoft] database: ready
[edusoft] platform administration: on
[edusoft] school addresses: *.edusoft.gh
[edusoft] parents' app: served from this service
```

Then provision the school and keep the key it prints — it is shown once, and it
is what the desktop authenticates with:

```bash
DATABASE_URL="postgres://…" python cloud-python/scripts/create_school.py "Ave Maria Preparatory School"
```

## 3. Vercel — the app on its own, if you want it there

**Optional, and not the default any more.** The service above already serves
the app. Host it separately only if you want a CDN in front of it, and know
what it costs: a page served from another origin is not the origin a school's
subdomain resolves on, so `ave-maria-school.edusoft.gh` stops naming a school
and parents get the picker.

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

## Enrolling a school

A school is **two things** in this service and needs both:

| | |
|---|---|
| a row in `schools` | what the desktop's sync key is checked against, and what the parent portal's school picker lists |
| a Postgres **schema** | the eighty-one tables the hosted office application reads |

Onboarding used to write the first and stop, so an enrolled school could sync
and could not be opened on the web — and nothing said so. Both are now done in
one act, by the command line and the API alike.

### From the command line

```bash
DATABASE_URL="postgres://…?sslmode=require" \
PORTAL_BASE_DOMAIN="edusoft.gh" \
python cloud-python/scripts/create_school.py "Ave Maria School"
```

It prints the school id, the sync key (**once** — it is stored only as a hash)
and the portal address.

### Over the API

Set `PLATFORM_ADMIN_KEY` on the service to a long random string. This is
**Nickland's** key, not a school's: it is the only credential that can bring a
school into existence, which is why it is kept apart from the school keys every
desktop holds. With it unset, the platform routes answer `404` — there is no
fallback to something weaker.

```bash
curl -X POST https://api.example/api/v1/platform/schools \
  -H "x-platform-key: $PLATFORM_ADMIN_KEY" \
  -H 'content-type: application/json' \
  -d '{"name":"Ave Maria School"}'

curl https://api.example/api/v1/platform/schools -H "x-platform-key: $PLATFORM_ADMIN_KEY"
curl -X POST https://api.example/api/v1/platform/schools/ave-maria-school/rotate-key \
  -H "x-platform-key: $PLATFORM_ADMIN_KEY"
```

The listing reads **both** registers and says, per school, whether each half is
there — so a school that "does not work" is explained on the first screen
instead of from a `psql` session.

### The school's own address

`PORTAL_BASE_DOMAIN` holds one domain or several, separated by commas,
semicolons or whitespace:

```
PORTAL_BASE_DOMAIN="edusoft.gh"
PORTAL_BASE_DOMAIN="edusoft.gh, nickland.edu.gh"
PORTAL_BASE_DOMAIN="edusoft.gh nickland.edu.gh localhost"
```

A school is reachable under every one of them, and **the first is canonical** —
the address the platform hands out and prints. Putting a new domain at the
front is therefore how a deployment moves house, and the old address keeps
working for as long as it stays in the list. Nothing is written into the code.

A school's id is a slug of its own name (`ave-maria-school`), so
`ave-maria-school.edusoft.gh` needs no lookup table: resolving a host is string
work, and a school enrolled a second ago is reachable immediately. Point a
wildcard `*.edusoft.gh` record at the service and every school is addressed.

Two rules the resolver will not bend on: the host must sit under one of the
configured domains — anyone pointing their own DNS at the service must not be
able to pick a tenant by name — and exactly one label, so `a.b.edusoft.gh` is
never school `a.b`. Names that already mean something on the domain (`www`,
`api`, `admin`, …) are refused as school ids and as hosts.

With no domain configured the service still works; schools simply have no
address, which is a real state for a deployment reached by IP, and not an
error.

---

## Checking a deploy

```bash
curl https://your-service.example.com/api/v1/health          # the service is up, and whether it carries the app
curl https://your-service.example.com/api/v1/portal/schools  # it can reach Neon
curl -H "Host: ave-maria-school.edusoft.gh" \
     https://your-service.example.com/api/v1/info            # the school's own address names that school
```

`/health` is deliberately database-independent, so it answering tells you the
process is alive and nothing more — except `web_app`, which says whether this
build carries the app or will serve the placeholder page at `/`.
`/portal/schools` is the one that proves the Neon connection works.

`/info` asked with a school's Host answers with that school alone and names it
in `school_id`. An empty `schools` there means the address belongs to no
enrolled school; the full list means the Host did not resolve at all — the
domain does not match `PORTAL_BASE_DOMAIN`.

If the app shows the Connect screen to everyone on a **separately hosted**
build, the API address did not make it into the bundle. Check the Vercel build
log for the line beginning `→ Building the web app (portal: …)` — if it has no
`portal:`, the environment variable was not set for that environment
(Production and Preview are configured separately). A build served by the
service itself has no address to miss.

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
