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
2. Copy either connection string, ending `?sslmode=require`. **Either one
   works** — the pooled string (with `-pooler` in the host name) is the one
   Neon offers first, and the host handles it. See *Pooled or direct* below for
   what it does with it and why.
3. Create the school's tables. **On Render this happens by itself** — the
   blueprint runs it before every deploy (`preDeployCommand`) and it does
   nothing once the school is there — so this is only for deploying somewhere
   else, or for running it early:

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

### Pooled or direct

The school's tables live in their own Postgres schema, so **every connection
has to be told where to look** — `search_path`. Neon's pooled endpoint is
PgBouncer, and it will not carry that:

```
unsupported startup parameter in options: search_path
```

It refuses on the first query, which means a perfectly good deploy comes up,
answers every request with that line, fails its health check and times out
after eighteen minutes with nothing else wrong. Saying `SET search_path` after
connecting does not rescue it either: the pooled endpoint pools by
*transaction*, so the next statement is likely handed a different server
connection that never saw the setting. A session setting needs a session.

So when a schema is pinned, the host talks to Neon's **direct** endpoint — the
same host name without `-pooler` — and says so in its log on start-up. Give it
the pooled string; it normalises it. Nothing is lost: the host blocks on every
query (that is what makes 1,631 synchronous call sites work unchanged), so one
instance can only ever have a single query in flight and its pool is three
connections at its widest. The pooler exists for the opposite problem.

`host/provision.js` also makes the schema the connecting role's default search
path, which lives in the database and so survives any endpoint. If you must
stay on the pooled one, set `DATABASE_POOLED=keep` — and provision first, or
nothing will find the school's tables.

---

## 3. Render

**New → Blueprint**, pointed at this repository. `render.yaml` describes the
service.

Then set **`DATABASE_URL`** in the dashboard. It is deliberately not in the
file: a database password does not belong in a repository.

### The tables create themselves, once

```yaml
preDeployCommand: npm run host:provision -- --if-empty
```

An unprovisioned database answers *every* request with `relation "settings"
does not exist`, the health check included, and the deploy times out eighteen
minutes later — so the blueprint provisions before the host starts. `--if-empty`
looks first and does nothing at all when the school is already there, which is
every deploy after the first. Without the flag, provisioning still refuses to
touch a database that has tables; that has not changed.

The host says which it found on start-up — `The school's tables are there: 82`,
or the three lines telling you to provision.

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

**The first administrator is created from a terminal, not from the browser.**

`auth:bootstrap` asks for no credentials — on a desktop, the person running it
is already sitting at the machine — so the browser is refused it
(`electron/server/desk_api.js`). Over the internet that proof has to come from
somewhere else, and running a command on the host is it:

```bash
# Render → the service → Shell, or anywhere with the same DATABASE_URL
npm run host:create-admin -- --username nicholas --name "Nicholas Afrifa"
```

It asks for a password without echoing it, or takes `--generate` and prints a
strong one once. It calls the application's own bootstrap handler, so the rules
are the same ones the installer's first screen applies: Super Admin, the same
bcrypt hash the sign-in checks, and a flat refusal once any account exists.

Then:

1. Open `https://your-service.onrender.com/desk` and sign in.
2. Set the school's name, colours and crest under **Settings**.
3. Add everybody else under **Settings → Users & Access**. The command above is
   only for the very first account.
4. Open `https://your-service.onrender.com/` to see the parents' and teachers'
   app against the same school.

Parents and teachers can add that address to a phone's home screen; it behaves
as an installed app.

---

## 4b. More than one school

One Render **project** holds all of it — the platform service and every
school's host, one bill, one dashboard. One **service** cannot: a process
registers the application's channels once, against one database handle
(`electron/ipc/_registry.js`), so one host is one school and always will be.
Two schools means two services.

The **database** is the part that shares well. Several schools can live in one
Neon project, a schema each — `DATABASE_SCHEMA=ave_maria`,
`DATABASE_SCHEMA=st_johns` — because every connection pins its own schema
(`host/db/worker.js`) and nothing a host reads or writes can reach past it.
That is how the platform holds its schools too.

The one thing that does not share is the role's default search path, so
`host/provision.js` sets it for the first school in a database and leaves it
alone for every school after, and says which it did. In psql, say
`SET search_path TO ave_maria;` before you look, or you will be reading
whichever school was provisioned first.

What each school still needs of its own: a service, a disk (report cards and
photographs), an `EDUSOFT_SECRET_KEY`, and its own tenant on the platform.

---

## 5. The licence clock

**A new database has 30 days.** `electron/licence/index.js` gives an
installation that has never collected a licence a month of full use from its
first run; after that `licence.allows(db, 'edit')` fails, every request that is
not a GET answers **402**, and the school is read-only — staff can look up a
pupil and cannot record a payment.

That was written for a desktop, where somebody sees the banner. Nobody watches
a server, so the host says it on every start:

```
warn  licence — Not licensed yet — 30 days left, then this school becomes READ-ONLY.
error licence — Not licensed yet — 4 days left, …          (inside a week)
error licence — READ-ONLY (expired). Staff can look but cannot save anything.
```

To clear it, this school has to collect a licence from the platform service —
`cloud-python`, with `LICENCE_SIGNING_KEY` and the school enrolled there (see
`DEPLOY.md`). The collecting itself works from the browser: **/desk → Settings
→ Cloud sync**, because the `licence:*` and `cloud:*` channels are exempt from
the gate they would otherwise be locked behind.

---

## 6. Backups

**The office PC's backup button does not work here, on purpose.** It copies a
SQLite *file* into a zip, and this school has no file — it is in Postgres. Ask
for one and it says so, and names what to do instead.

```bash
DATABASE_URL=… DATABASE_SCHEMA=school npm run host:backup
```

That writes one `.sql` file to `<EDUSOFT_DATA_DIR>/backups`: the schema, every
row, and the identity counters set past the highest id, so a restored school
issues the *next* receipt number rather than one a parent already holds. It
restores into an empty database with a single `psql -f`. Flags: `--gzip`,
`--keep N` (prune older ones), `--out PATH`, `--data-only`.

Three different things, and you want all three:

| | What it covers | How |
|---|---|---|
| **Point in time** | the school as it was at 10:32 this morning | Neon's own restore — check the retention your plan gives you |
| **A copy you hold** | moving provider, an auditor, the day the account is the problem | `npm run host:backup`, kept somewhere else |
| **The files** | report cards, receipts, photographs | the Render disk at `/var/data` — not in either of the above |

The backup prints how many files are on that disk, so their absence from the
`.sql` is never a surprise.

---

## 7. Vercel — optional, and probably unnecessary

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

## 8. Keeping Neon usage low

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

## 9. Environment

| Variable | What it does |
|---|---|
| `DATABASE_URL` | Neon. **Absent means local SQLite** — that is the LAN host, unchanged. |
| `DATABASE_SCHEMA` | The Postgres schema holding the school's tables. `school`. |
| `DATABASE_POOLED` | `keep` to use the connection string exactly as given. Otherwise a pooled Neon string is normalised to the direct endpoint, because the pooled one cannot hold `search_path`. |
| `DATABASE_POOL` | Connections. Default 3. |
| `DATABASE_CACHE_TTL_MS` | How long a read may be remembered. Default 5000. |
| `DATABASE_CACHE` | `off` disables the cache, for diagnosis. |
| `EDUSOFT_DATA_DIR` | Where files go. On Render, the mounted disk. |
| `EDUSOFT_SECRET_KEY` | Encrypts stored backup credentials. 32+ characters. |
| `EDUSOFT_PORT` / `EDUSOFT_BIND` | Default 4747 and 0.0.0.0. |
| `EXPO_PUBLIC_PORTAL_URL` | Only if the parents' app is hosted apart from its API. |

---

## 10. Checking it

```bash
node test/host_dialect.js                       # SQL translation, no database
node test/host_connection.js                    # which endpoint it dials, no database

DATABASE_URL=… DATABASE_SCHEMA=school \
  npm run host:backup                           # a restorable copy, and it says what it wrote

DATABASE_URL=… DATABASE_SCHEMA=school \
  node test/host_postgres.js                    # the adapter, against a real database

node test/headless_host.js                      # the whole host, on SQLite
npm test                                        # everything
```

`test/host_postgres.js` skips without `DATABASE_URL`, as the other online tests
do. Point it at a throwaway database — it creates and deletes rows.

---

## 11. What is known to be true, and what is not

**Verified** against a real PostgreSQL 16 holding the school's own 81-table
schema: all 65 read channels answer; writes, transactions and rollbacks behave;
a pupil admitted through the web reaches the database with a proper admission
number; and one host serves both applications at once.

**Not verified:** any of it against Neon itself. The wire protocol and the SQL
are identical, so it is expected to hold — but the first run against your own
Neon project is the one that proves it. If something does behave differently,
`DATABASE_CACHE=off` is the first thing to try, because it removes a whole
layer from the question.
