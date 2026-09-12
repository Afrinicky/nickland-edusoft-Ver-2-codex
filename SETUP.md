# Setting up Nickland Edusoft

**Copyright © 2026 Nickland Sales.**

Three things can be set up, and they are independent. A school can run on
nothing but the first, forever, with no internet at all — that is the whole
design, and it is worth knowing before you start:

| | What it is | Needed for |
|---|---|---|
| **A** | The **desktop application** on one office PC | Everything. This is the school. |
| **B** | The **school network**: other computers and phones on the school Wi-Fi | Teachers marking registers from a classroom, parents at the gate |
| **C** | The **cloud**: the internet-facing service | Working with the office computer switched off; many schools on one platform |

**Do A first and stop there if that is all the school needs.** B is twenty
minutes of settings. C is the one with moving parts, and only Nickland sets it
up — once, for every school.

---

## Prerequisites

| For | You need |
|---|---|
| A — desktop | A Windows PC. Nothing else. |
| Building the installer | Node.js 22 (the test suites use `node:sqlite`, which shipped in 22.5), or just let GitHub Actions build it |
| C — cloud | A Postgres database (Neon is what this is written against), somewhere to run a Python service (Render), Node.js 22 |

---

## A · The desktop application

This is the school's own copy. It holds the real record and depends on nobody.

1. **Get the installer.** Either download `Nickland-Edusoft-Setup-2.0.0.exe`
   from the repository's Releases page, or build it — push to the repo and
   GitHub Actions produces it under **Actions → Build Windows Installer →
   Artifacts**. No Windows machine needed to build.

2. **Install it** on the one PC that will live in the school office. This
   machine holds the database; everything else is a window onto it.

3. **First launch** shows a one-time **Create Super Admin Account** screen.
   Fill in the name, username and password. This account controls the system
   itself — accounts, access levels, the audit trail. It is not the
   Proprietor's account; the person who signs the cheques should not also be
   the one who can quietly rewrite who may see that they were signed.

4. **Set the school up** under **Settings**:
   - **School Identity** — name, crest, address, phone. The crest and colours
     travel to every screen and every printed document.
   - **Classes**, **Terms**, **Subjects**, **Grading** — or skip these and use
     the onboarding workbook below, which does them all at once.
   - **Users & Logins** — an account for each member of staff.

5. **Bring the school's existing records in.** **Settings → Onboarding**:
   - **Download the template** — a workbook with twelve tabs.
   - Fill them in **in the order they appear**. They depend on each other: a
     pupil cannot be put in a class that has not been listed yet.
   - **Choose workbook…** and look at the preview. Nothing is written until you
     have seen what it would do.
   - Import. If something came in wrong, fix the file and import it **again** —
     it corrects what is there rather than creating it twice.

6. **Set up backups** — **Settings → Backup**. Do this on day one, not later.

---

## B · The school network

Other computers and phones in the building, with no internet at all.

1. On the office PC: **Settings → Mobile App → Start server**. Note the address
   it shows, e.g. `http://192.168.1.42:4747`.
2. **Parents and teachers** open `http://192.168.1.42:4747` on any phone or
   laptop on the school Wi-Fi. Nothing to install; it can be added to a phone's
   home screen.
3. **The office application on another PC** — open
   `http://192.168.1.42:4747/desk`. Same screens as the office PC, same
   handlers, answered by the office PC over the network.
4. **A second office PC as a proper client** — install the same `.exe` there
   and set `EDUSOFT_HOST_URL=http://192.168.1.42:4747`. It opens no database of
   its own and starts no server; it loads the application from the host, so a
   client is never a version behind.

Full guide: [`docs/CONNECTING.md`](docs/CONNECTING.md).

---

## C · The cloud

Set up **once**, by Nickland, for all schools. Individual schools are then
enrolled into it in one command each.

One service is the whole thing: the parents' and teachers' app, the portal API,
and the online school. The app is built into the image, so there is no second
deployment to keep in step and no API address to compile into a bundle and get
wrong — the app asks the address it was opened from what it is.

### C1 · The database

Create a Postgres database (Neon: **New Project**) and copy the **pooled**
connection string — the one whose host contains `-pooler`. **Choose the region
first** and put the service in the same one: measured, a screen takes about
100ms with the database in the same region and over two seconds across
continents.

Nothing to load. The service creates its own tables the first time it finds
them missing, and says so in its log. (`cloud-python/schema.sql` is still there
and can still be run by hand — every statement in it is `IF NOT EXISTS`, which
is what makes applying it automatically safe.)

### C2 · The service

Deploy with **New → Blueprint**, pointed at this repository. The blueprint is
`cloud-python/render.yaml`; it builds from the repository root because the
image builds the app out of `mobile/` as well.

| Variable | | What it is |
|---|---|---|
| `DATABASE_URL` | **set it** | The pooled Postgres string, with `?sslmode=require`. Without it the service refuses to start rather than silently losing every school on restart. |
| `PORTAL_SECRET` | generated | Signs parent and teacher sessions. Never change it later: every signed-in parent and teacher is signed out the moment you do. |
| `PLATFORM_ADMIN_KEY` | generated | **Nickland's own key** — the only credential that can bring a school into existence. Copy it out of the dashboard and keep it apart from the school keys every desktop holds. Under 24 characters it is refused and the platform routes stay off. |
| `PORTAL_BASE_DOMAIN` | **set it** | The domain the schools live under: `edusoft.gh`. One or several, comma-separated. |

Generating one by hand, if you are not on Render:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

**Read the first five lines of the log after it starts.** They are there to be
read, and each one is something that has been got wrong on a deploy and found
out later by a parent:

```
[edusoft] store: pg
[edusoft] database: the platform tables were missing and have been created
[edusoft] platform administration: on
[edusoft] school addresses: *.edusoft.gh
[edusoft] parents' app: served from this service
```

`store: memory`, `platform administration: off`, or `parents' app: not in this
build` means stop and fix it now rather than after a school is on it.

### C3 · The schools' addresses

`PORTAL_BASE_DOMAIN` takes **one domain or several**, separated by commas,
semicolons or whitespace:

```
PORTAL_BASE_DOMAIN="edusoft.gh"
PORTAL_BASE_DOMAIN="edusoft.gh, nickland.edu.gh"
PORTAL_BASE_DOMAIN="edusoft.gh nickland.edu.gh localhost"
```

A school answers to **every** one of them, and **the first is canonical** — the
address the platform hands out and prints. Putting a new domain at the front is
how a deployment moves house, and the old address keeps working for as long as
it stays in the list.

Point a **wildcard DNS record** — `*.edusoft.gh` — at the service, and every
school is addressed with no further configuration. A school's id is a slug of
its own name, so `ave-maria-school.edusoft.gh` needs no lookup table and a
school enrolled a second ago is reachable at once. Opening that address shows
that school and no other: the app adopts one school without asking, and offers
a picker only where it was given several.

Leaving it unset is fine: the service works, schools simply have no address.

### C4 · Enrol a school

```bash
curl -X POST https://api.example/api/v1/platform/schools \
  -H "x-platform-key: $PLATFORM_ADMIN_KEY" \
  -H 'content-type: application/json' \
  -d '{"name":"Ave Maria School"}'
```

Or from a machine that can reach the database directly:

```bash
DATABASE_URL="postgres://…?sslmode=require" \
PORTAL_BASE_DOMAIN="edusoft.gh" \
python3 cloud-python/scripts/create_school.py "Ave Maria School"
```

Either prints the **school id**, the **sync key** and the **portal address**.

> **The sync key is shown once.** It is stored only as a hash. A lost key is
> reissued, never recovered:
> `POST /api/v1/platform/schools/<id>/rotate-key`. Tell the school before you
> rotate it, not after — their desktop stops syncing the moment you do.

### C5 · Point the school's desktop at it

On the office PC, **Settings → Cloud Sync**:

- **Portal URL** — the service address. It must be `https://`; the desktop
  refuses plain `http` to anywhere but itself, because the school key and
  parent credentials travel over this link.
- **School ID** and **School API key** — from the step above.
- Switch it **on**. The first time, it sends everything the school already has
  so parents can sign in; after that it pushes only what changed.

### C6 · Check it

```bash
curl https://api.example/api/v1/health
curl https://api.example/api/v1/platform/schools -H "x-platform-key: $PLATFORM_ADMIN_KEY"
curl -H "Host: ave-maria-school.edusoft.gh" https://api.example/api/v1/info
```

`/health` says `web_app: true` when the app is in the build, which is what a
parent opening the address gets.

The listing says, per school, whether **both** halves are there — the registry
row *and* its own database. A school showing `complete: false` tells you which
half is missing, in words. That is worth reading after every enrolment.

`/info` asked with a school's own Host answers with that school alone, and
names it in `school_id`. An empty list there means the address does not belong
to an enrolled school — a typo, or a school not yet enrolled.

Then open the address in a browser and sign in as a parent. It is the only
check that covers the whole path.

---

## Running it locally

```bash
npm install
npm run rebuild          # native modules for Electron
npm run dev              # the desktop app, hot reload

npm test                 # everything
npm run test:regressions  # the desktop suites alone

# the cloud service, against a throwaway store
cd cloud-python
ALLOW_MEMORY_STORE=1 ALLOW_DEV_SECRET=1 uvicorn app.main:app --reload
```

`ALLOW_MEMORY_STORE=1` and `ALLOW_DEV_SECRET=1` are **development only**. The
service refuses both in production on purpose: the first because each worker
would hold its own copy of every school, so the same request would succeed or
fail depending on which worker answered it; the second because a known signing
secret is a way to mint a parent session for any school.

---

## What to do when a term ends

**Settings → Cloud Sync → publish last term's report cards.** A closed term's
card does not change, so it is published once and a parent can open it with the
school's computer switched off. The current term's is never published — it
changes every time a mark is entered, and a stale card missing this morning's
marks is worse than being told to ask the school.

---

## If something is wrong

| What you see | What it is |
|---|---|
| Parents get a plain page with no sign-in | The app is not in that build — the log says `parents' app: not in this build`. Deploy the blueprint rather than the folder: the image builds the app from `mobile/`, so its build context is the repository root. |
| Enrolment answers `404` with "no platform administration configured" | `PLATFORM_ADMIN_KEY` is unset **or under 24 characters** — the log's third line says which. A short key is refused exactly like no key at all. |
| A school's address shows a picker with other schools on it | The Host did not resolve. Check `PORTAL_BASE_DOMAIN` against the domain actually being used, and that the wildcard record points here. |
| A school's address shows no school at all | That address belongs to no enrolled school: a typo, or the school has not been enrolled yet. |
| A school in the platform listing with `complete: false` | Only half enrolled. The `problem` field says which half and what to do. |
| "The cloud address must start with https://" | Sync switched itself off rather than send the school key in clear. Fix the URL. |
| Parents cannot sign in | The school has not pushed yet. **Settings → Cloud Sync → Re-send everything.** |
| A teacher says a mark they entered is missing | **Settings → Cloud Sync**, "Kept this computer's version". Somebody changed it at the school after the teacher read it; the desktop won, and the teacher's figure is recorded there. |
| A pupil who left still shows in a parent's app | Mark them Inactive on the desktop and let it sync. That withdraws them. |
| Sync says "more still to come" | A long outage. It is draining; each cycle takes another batch. |

More detail: [`DEPLOY.md`](DEPLOY.md) · [`docs/CONNECTING.md`](docs/CONNECTING.md) ·
[`ARCHITECTURE-PORTALS.md`](ARCHITECTURE-PORTALS.md) ·
[`ARCHITECTURE-OFFLINE.md`](ARCHITECTURE-OFFLINE.md)
