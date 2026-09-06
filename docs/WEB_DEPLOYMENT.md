# Putting Nickland Edusoft on the web

**Nickland Edusoft · Copyright © 2026 Nickland Sales**

The installed application, running on a server, against a Postgres database.
Not a rewrite of it and not a second version of it: the same handlers, the same
screens, the same rules.

---

## 1. What this is, and what it is not

```
   OFFICE PC                                    THE WEB
   ─────────                                    ───────
   Electron window                              Browser
        │                                          │
   the handlers  ──── local SQLite file       Vercel (optional)
   (electron/ipc)     nickland-edusoft.db          │  the same screens
        │                                          ▼
   LAN clients ── http://<office-pc>:4747/desk   RENDER
                                                 host/server.js
                                                 THE SAME handlers
                                                      │
                                                      ▼
                                                    NEON
                                                 the same 81 tables
```

**The two databases are separate and stay separate.** The office PC's SQLite
file is untouched by any of this and never talks to Neon; `electron/db/database.js`
has no knowledge that Postgres exists. The web copy is a second school holding
its own records.

**They are not synchronised.** That is a later phase, deliberately. Until it
lands, use one or the other for real work — not both.

---

## 2. Neon

1. Create a project. **Note the region** — everything below depends on it.
2. Copy the **pooled** connection string (the one with `-pooler` in the host
   name). It ends `?sslmode=require`.
3. Create the school's tables:

   ```bash
   DATABASE_URL='postgresql://…?sslmode=require' \
   DATABASE_SCHEMA=school \
   npm run host:provision
   ```

   This applies the schema **generated from the desktop's own** — there is no
   second schema definition anywhere, and there must never be one. It checks the
   generated file is current first and regenerates it if not; a stale one is
   what made an admission fail during testing.

   It refuses to run twice against a database that already has tables, rather
   than half-building one. `--force` drops and rebuilds, if that is really what
   you want.

---

## 3. Render

`render.yaml` is a blueprint: **New → Blueprint**, pointed at this repository.

Then set **`DATABASE_URL`** in the dashboard. It is not in the file on purpose:
a database password does not belong in a repository.

**Put Render in the same region as Neon.** This is not a preference. Every
database call blocks the host for one round trip — that is what allows 1,631
synchronous call sites to work unchanged — so latency multiplies by the number
of queries a screen makes:

| Neon is | A screen takes | Eight people at once |
|---|---|---|
| the same region | **~100 ms** | ~75 ms |
| a nearby region | ~320 ms | ~210 ms |
| another continent | **~2.3 s** | ~3 s |

Measured, not estimated. The last row is unusable.

The blueprint also mounts a **disk at `/var/data`**. Report cards, receipts and
photographs are written there. The school's *records* are in Neon; this holds
the files that go with them, and it must survive a restart.

---

## 4. Vercel — optional

Render already serves the office application at `/desk`. Use Vercel only to put
the screens on a CDN:

* New project → this repository
* **Settings → General → Configuration File**: `deploy/vercel-desk.json`
* **Settings → Environment Variables**: `VITE_DESK_HOST` = the Render URL

---

## 5. Keeping Neon usage low

A school's screens make a lot of small reads. The measurements below are one
Students screen: seven channels, forty pupils.

| | Queries |
|---|---|
| Before any of this | 54 |
| Now | **26** |

The saving is not clever query writing — it is not asking the same question
twice. Six of every seven queries were the same per-request reads on *every*
channel: the bearer token, the account behind it, its permissions, its teaching
scope. `settings:list-subjects` runs **one** select of its own and cost seven.

`host/db/cache.js` remembers a read and forgets it the moment anything writes
to a table that read touched. Invalidation is **by table and exact**, because
this host is the only thing writing to this database — so "a permission changed
in the office takes effect on the next request" still holds, which is a promise
the application makes and a test enforces.

What is deliberately never cached: anything reading `MAX(...)`. Receipt and
admission numbers are allocated by reading the last one, and a remembered
answer there issues the same receipt number twice, which an audit of a school's
books treats as a forgery.

Other things that keep usage down:

* **A pool of three.** The host blocks on each query so it can only have one in
  flight; the spare two are for transactions, which hold a connection for their
  duration. A larger pool would be idle connections Neon still counts.
* **Statements translated once** and remembered, so Postgres parses each once.
* **No polling** — with one exception worth knowing about: the sign-in screen
  asks about an approved password reset every four seconds while somebody is
  waiting on one. Harmless against a local file, and worth watching here.

### Before you run more than one instance

`numInstances: 1` in the blueprint is load-bearing. A second instance would not
see the first's writes, and could serve a read up to `DATABASE_CACHE_TTL_MS`
stale. Raising the TTL is safe with one instance and is not safe with two. The
note in `host/db/cache.js` says what would have to change.

---

## 6. What the server needs that a desktop gives free

| | |
|---|---|
| **A persistent disk** | `EDUSOFT_DATA_DIR`. Files, not records. |
| **A headless browser** | Report cards, receipts, payslips. The blueprint installs `puppeteer` at build time. |
| **`sharp`** | Only to attach photographs online. `npm install sharp`. |
| **`EDUSOFT_SECRET_KEY`** | 32+ characters. Without it, backup destination passwords are stored in the clear and the log says so on every start. |

---

## 7. Environment

| Variable | What it does |
|---|---|
| `DATABASE_URL` | Neon. **Absent means local SQLite** — that is the LAN host, unchanged. |
| `DATABASE_SCHEMA` | The Postgres schema the school's tables live in. `school`. |
| `DATABASE_POOL` | Connections. Default 3. |
| `DATABASE_CACHE_TTL_MS` | How long a read may be remembered. Default 5000. |
| `DATABASE_CACHE` | `off` disables the cache entirely, for diagnosis. |
| `EDUSOFT_DATA_DIR` | Where files go. On Render, the mounted disk. |
| `EDUSOFT_SECRET_KEY` | Encrypts stored backup credentials. |
| `EDUSOFT_PORT` / `EDUSOFT_BIND` | Default 4747 and 0.0.0.0. |

---

## 8. Checking it

```bash
node test/host_dialect.js                     # SQL translation, no database needed

DATABASE_URL=… DATABASE_SCHEMA=school \
  node test/host_postgres.js                  # the adapter against a real database

node test/headless_host.js                    # the whole host, on SQLite
```

`test/host_postgres.js` skips without `DATABASE_URL`, as the other online tests
do. Point it at a throwaway database — it creates and deletes rows.
