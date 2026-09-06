# Putting Nickland Edusoft on the web

**Nickland Edusoft · Copyright © 2026 Nickland Sales**

**Both** applications, on the internet, from one server:

* **`/`** — the parents' and teachers' app, the same one that runs on a phone
* **`/desk`** — the office application, the installer's own screens

Neither is a rewrite. They are the same two products the office PC already
serves on the school Wi-Fi, running the same handlers against a Postgres
database instead of a local file.

---

## 1. The shape of it

```
   OFFICE PC (unchanged)                     THE WEB
   ─────────────────────                     ───────
   Electron window                    parents & teachers      office staff
        │                                    │                     │
   the handlers                              ▼                     ▼
   electron/ipc/*  ── local SQLite      https://…/          https://…/desk
        │             nickland-edusoft.db    │                     │
        │                                    └──────────┬──────────┘
   LAN, port 4747                                       │
   /      the mobile app                       RENDER · host/server.js
   /desk  the office app                    THE SAME handlers, the same
                                            electron/server/api.js
                                                         │
                                                         ▼
                                                  NEON · Postgres
                                              the same 81 tables
```

**Two databases, and they stay apart.** The office PC's SQLite file is
untouched by any of this and never talks to Neon. `electron/db/database.js`
does not know Postgres exists.

**They are not synchronised.** Deliberately, for now. Until that phase lands,
use the office PC *or* the web copy for real work — not both.

---

## 2. Neon

1. Create a project, and **note the region**. Everything below depends on it.
2. Copy the **pooled** connection string — the one with `-pooler` in the host
   name — ending `?sslmode=require`.
3. Create the school's tables:

   ```bash
   DATABASE_URL='postgresql://…?sslmode=require' \
   DATABASE_SCHEMA=school \
   npm run host:provision
   ```

   This applies the schema **generated from the desktop's own**. There is no
   second schema definition anywhere and there must never be one. It checks the
   generated file is current and regenerates it if not — a stale one is what
   made an admission fail during testing.

   It refuses to run against a database that already has tables rather than
   half-building one. `--force` drops and rebuilds, if that is genuinely what
   you want.

---

## 3. Render

**New → Blueprint**, pointed at this repository. `render.yaml` describes the
service.

Then set **`DATABASE_URL`** in the dashboard. It is deliberately not in the
file: a database password does not belong in a repository.

### Put Render in the same region as Neon

Not a preference. Every database call blocks the host for one round trip —
that is what lets 1,631 synchronous call sites work unchanged — so latency
multiplies by the number of queries a screen makes. Measured:

| Neon is | A screen | Eight people at once |
|---|---|---|
| the same region | **~100 ms** | ~75 ms |
| a nearby region | ~320 ms | ~210 ms |
| another continent | **~2.3 s** | ~3 s |

The last row is unusable. Choose the Neon region first, then match it in
`render.yaml` (it ships set to `frankfurt`).

### What the build does

```
npm ci                          the host and the office application
npm ci --prefix mobile          the parents' app has its own dependencies
npm install --no-save puppeteer report cards, receipts, payslips
npm run build:web               → the parents' app, served at /
npm run build:desk              → the office application, served at /desk
```

Both builds copy themselves to where the host looks. Nothing else to configure.

### The disk

The blueprint mounts one at `/var/data`. Report cards, receipts and
photographs are written there. The school's *records* live in Neon; this holds
the files that go with them, and it must survive a restart.

---

## 4. First run

1. Open `https://your-service.onrender.com/desk`.
2. It will ask you to create the first administrator, exactly as the installer
   does on a new machine.
3. Sign in. Set the school's name, colours and crest under **Settings**.
4. Open `https://your-service.onrender.com/` to see the parents' and teachers'
   app against the same school.

Parents and teachers can add that address to a phone's home screen; it behaves
as an installed app.

---

## 5. Vercel — optional, and probably unnecessary

Render already serves both applications. Vercel only puts the *screens* on a
CDN while the API stays on Render.

**For the office application:**

* New project → this repository
* **Settings → General → Configuration File**: `deploy/vercel-desk.json`
* **Settings → Environment Variables**: `VITE_DESK_HOST` = the Render URL

**For the parents' app:** the repository root `vercel.json` already describes
it. Set `EXPO_PUBLIC_PORTAL_URL` to the Render URL so it knows where its API
is — unset, it asks its own origin, which is only right when Render serves it.

Unless you have a reason, skip this. One service is simpler to reason about and
one fewer thing to keep in step.

---

## 6. Keeping Neon usage low

One Students screen — seven channels, forty pupils:

| | Queries |
|---|---|
| Before | 54 |
| Now | **26** |

The saving is not clever SQL. It is not asking the same question twice. Six of
every seven queries were the same per-request reads on *every* channel: the
bearer token, the account behind it, its permissions, its teaching scope.
`settings:list-subjects` runs **one** select of its own and cost seven.

`host/db/cache.js` remembers a read and forgets it the moment anything writes
to a table that read touched. Invalidation is **by table and exact**, because
this host is the only thing writing to this database — so "a permission changed
in the office takes effect on the next request" still holds. There is a test
for that.

Never cached, on purpose: anything reading `MAX(...)`. Receipt and admission
numbers are allocated by reading the last one, and a remembered answer there
issues the same receipt number twice — which an audit of a school's books
treats as a forgery.

Also keeping usage down:

* **A pool of three.** The host blocks on each query so it can only have one in
  flight; the spare two are for transactions, which hold a connection for their
  duration. A bigger pool would be idle connections Neon still counts.
* **Statements translated once** and remembered, so Postgres parses each once.
* **No polling**, with one exception worth knowing: the sign-in screen asks
  about an approved password reset every four seconds while somebody waits on
  one. Harmless against a local file; worth watching here.

### Before running more than one instance

`numInstances: 1` is load-bearing. A second instance would not see the first's
writes and could serve a read up to `DATABASE_CACHE_TTL_MS` stale. Raising the
TTL is safe with one instance and is not safe with two. The note in
`host/db/cache.js` says what would have to change.

---

## 7. Environment

| Variable | What it does |
|---|---|
| `DATABASE_URL` | Neon. **Absent means local SQLite** — that is the LAN host, unchanged. |
| `DATABASE_SCHEMA` | The Postgres schema holding the school's tables. `school`. |
| `DATABASE_POOL` | Connections. Default 3. |
| `DATABASE_CACHE_TTL_MS` | How long a read may be remembered. Default 5000. |
| `DATABASE_CACHE` | `off` disables the cache, for diagnosis. |
| `EDUSOFT_DATA_DIR` | Where files go. On Render, the mounted disk. |
| `EDUSOFT_SECRET_KEY` | Encrypts stored backup credentials. 32+ characters. |
| `EDUSOFT_PORT` / `EDUSOFT_BIND` | Default 4747 and 0.0.0.0. |
| `EXPO_PUBLIC_PORTAL_URL` | Only if the parents' app is hosted apart from its API. |

---

## 8. Checking it

```bash
node test/host_dialect.js                       # SQL translation, no database

DATABASE_URL=… DATABASE_SCHEMA=school \
  node test/host_postgres.js                    # the adapter, against a real database

node test/headless_host.js                      # the whole host, on SQLite
npm test                                        # everything
```

`test/host_postgres.js` skips without `DATABASE_URL`, as the other online tests
do. Point it at a throwaway database — it creates and deletes rows.

---

## 9. What is known to be true, and what is not

**Verified** against a real PostgreSQL 16 holding the school's own 81-table
schema: all 65 read channels answer; writes, transactions and rollbacks behave;
a pupil admitted through the web reaches the database with a proper admission
number; and one host serves both applications at once.

**Not verified:** any of it against Neon itself. The wire protocol and the SQL
are identical, so it is expected to hold — but the first run against your own
Neon project is the one that proves it. If something does behave differently,
`DATABASE_CACHE=off` is the first thing to try, because it removes a whole
layer from the question.
