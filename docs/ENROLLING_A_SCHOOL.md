# Enrolling a school, from a browser

**Copyright © 2026 Nickland Sales.**

This is the whole path from an empty account to a school using the system,
using **nothing but GitHub and a web browser**. No laptop checkout, no
terminal, no VS Code, nothing installed.

It is written to be followed in order the first time. After that, only
[Part C](#part-c--enrol-a-school) repeats: that is the part you do once per
school, and it takes about two minutes.

| Part | What it is | How often |
|---|---|---|
| [A](#part-a--build-the-things-a-school-downloads) | Build the installer, the app and the web build | Once, then on each release |
| [B](#part-b--stand-the-platform-up) | Stand the platform up | **Once, ever** |
| [C](#part-c--enrol-a-school) | Enrol a school | Once per school |
| [D](#part-d--what-the-school-does) | What the school does | Once per school |

> **A school does not need any of this to run.** The desktop application is the
> school, and it works with no internet at all. Parts B and C are what add the
> parents' portal, teachers working from home, and Nickland being paid. A school
> that only wants the desktop needs [Part A](#part-a--build-the-things-a-school-downloads) and nothing else.

---

## Part A · Build the things a school downloads

GitHub builds all three. You do not need a Windows machine, a Mac, or an
Android phone.

### A1 · Make a release

1. On GitHub, open this repository → **Releases** (right-hand side) → **Draft a
   new release**.
2. **Choose a tag** → type `v2.0.0` → **Create new tag: v2.0.0 on publish**.
3. Give it a title and click **Publish release**.

That tag starts the build. Everything below happens on GitHub's machines.

### A2 · Wait for it

Open the **Actions** tab. A run called **Build & Release** is going. It has
four jobs, and the gating is what matters: **Tests** first, then **Web app**,
and only then the two installers — which run side by side. A broken build
cannot ship, because nothing that ships starts until both gates are green.

| Job | Waits for | Takes | Produces |
|---|---|---|---|
| **Tests** | — | ~10 min | nothing. It is the gate |
| **Web app** | Tests | ~5 min | the browser build |
| **Windows installer** | Tests, Web app | ~10 min | `Nickland-Edusoft-Setup-2.0.0.exe` |
| **Android APK** | Tests, Web app | ~15 min | the teachers' and parents' app |

When it is green, go back to **Releases**. All three files are attached to the
release you published, on a permanent link anybody can download.

> **If Tests fails, stop.** It is not a formality. It runs the desktop's own
> money and grades logic, the sync round trip, and — since a throwaway Postgres
> was added to it — enrolling a school, tenancy, offline licensing and an
> attack suite. A red Tests job means the thing you are about to give a school
> is wrong in a way somebody already wrote down.

### A3 · On every later release

Change `"version"` in `package.json` on GitHub (click the file → the pencil
icon → **Commit changes**), then publish a release tagged to match. Nothing
else changes.

---

## Part B · Stand the platform up

**Once, ever.** Everything here is a web dashboard.

### B1 · The database

1. Go to [neon.tech](https://neon.tech) and create a project.
2. **Choose the region first**, and remember it. A screen takes about 100ms
   with the database in the same region as the service and over two seconds
   across continents. For Ghana, Frankfurt.
3. Copy the **pooled** connection string — the one whose host contains
   `-pooler` — and add `?sslmode=require` to the end if it is not there.

Nothing to load. The service creates its own tables the first time it starts.

### B2 · The service

1. Go to [render.com](https://render.com) → **New** → **Blueprint**.
2. Connect your GitHub account and pick this repository.
3. Render reads `cloud-python/render.yaml` and offers one web service. **Set
   its region to the same one you chose in B1.**
4. It will ask you for the variables marked `sync: false`. Fill in:

| Variable | What to put |
|---|---|
| `DATABASE_URL` | the pooled string from B1 |
| `PORTAL_BASE_DOMAIN` | the schools' domain, e.g. `edusoft.gh` |
| `PUBLIC_SITE_DOMAIN` | the website's domain, e.g. `nicklandedusoft.com` — or leave blank |
| `CONSOLE_DOMAIN` | the console's domain, e.g. `admin.nicklandedusoft.com` — or leave blank |
| `LICENCE_SIGNING_KEY` | see **B3**. Leave it blank for now |

`PORTAL_SECRET`, `PLATFORM_ADMIN_KEY` and `BILLING_CRON_SECRET` are generated
for you. **Copy `PLATFORM_ADMIN_KEY` out of the dashboard now** and keep it
somewhere the school keys are not — it is the only credential that can bring a
school into existence.

5. Click **Apply**. The first build takes about ten minutes, because it builds
   the app into the image.

### B3 · The licence signing key

The service **refuses to start** without `LICENCE_SIGNING_KEY`, deliberately: a
platform that quietly serves every desktop unlicensed looks perfectly healthy,
and is not discovered until the revenue is. So the first deploy will fail, and
its log will say exactly that. That is expected.

It is an Ed25519 private key. Render's **Generate** button makes a random
string, which is *not* the same thing, and the service will reject it and say
so.

**The good way — the service's own shell.** On Render, open the service →
**Shell** (left-hand menu) → and run:

```
python3 -c "from app.billing.licence import generate_key; print(generate_key())"
```

Copy what it prints into **Environment** → `LICENCE_SIGNING_KEY` → **Save**.
The service redeploys and starts. The key was made on the machine that will use
it and never travelled anywhere.

**If your host has no shell.** On GitHub: **Actions** → **Make a licence
signing key** → **Run workflow** → type `yes` → **Run workflow**. When it
finishes, download the `licence-signing-key` artifact from that run's page,
paste its contents into Render, and then **delete the artifact** with the bin
icon beside it. It expires by itself after a day.

> Anybody holding this key can mint a licence granting any school permanent
> full access on any machine for ever, and can forge the seals that make a
> school's receipts verifiable. It is the thing being protected. Do not put it
> in the repository, do not put it in a chat message, and do not rotate it
> casually — every desktop drops to read-only until it collects a fresh lease.

### B4 · Read the boot log

On Render, open the service → **Logs**. The first lines are there to be read,
and each one is something that has been got wrong on a deploy and found out
later by a parent:

```
[edusoft] store: pg
[edusoft] database: the platform tables were missing and have been created
[edusoft] subscriptions: ready
[edusoft] platform administration: on
[edusoft] offline licensing: on
[edusoft] school addresses: *.edusoft.gh
[edusoft] parents' app: served from this service
[edusoft] public website: nicklandedusoft.com (also /welcome)
[edusoft] superadmin console: admin.nicklandedusoft.com (also /console)
```

Stop and fix it now, not after a school is on it, if you see:

| Line | What it means |
|---|---|
| `store: memory` | `DATABASE_URL` is wrong. Every school disappears on each restart |
| `platform administration: off` or `OFF` | `PLATFORM_ADMIN_KEY` is missing, or under 24 characters. Either way you cannot enrol anybody, and the line says which |
| `offline licensing: OFF` | B3 was skipped with the escape hatch. Every desktop runs unlicensed |
| `parents' app: not in this build` | the wrong thing was deployed. Deploy the **blueprint**, not the folder |

### B5 · The addresses

In whatever runs your DNS (Cloudflare, Namecheap, wherever the domain lives),
add records pointing at the Render service — Render's **Settings → Custom
Domains** page tells you exactly what to add for each:

| Record | For |
|---|---|
| `*.edusoft.gh` (wildcard) | every school, forever, with nothing more to configure |
| `edusoft.gh` | the schools' bare domain |
| `nicklandedusoft.com` | the website |
| `admin.nicklandedusoft.com` | the console |

The wildcard is what makes Part C two minutes instead of a support ticket: a
school's address is a slug of its own name, so a school enrolled a second ago
is reachable at once with no lookup table and no DNS change.

You can skip all of this and use the Render URL Render gave you. Everything
works; the schools simply have no address of their own, and the website and
console sit at `/welcome` and `/console`.

### B6 · The first operator account

1. Open `https://admin.nicklandedusoft.com` — or `https://<your-render-url>/console`.
2. Click **Create the first one**.
3. Paste `PLATFORM_ADMIN_KEY` from B2, fill in your name, email and a password
   of at least ten characters, and **Create the account**.
4. Sign in with it.

That bootstrap closes the moment one operator exists. From here on the console
is a normal sign-in, which is what makes its audit trail say *who* suspended a
school or granted an exemption.

### B7 · Prices and plans

In the console:

- **Plans** — set the price of each plan and the price per pupil. Changing a
  price takes effect on every school's next invoice. No deploy, no restart.
- **Features** — which plan holds which module. A feature marked core is held
  by every plan and cannot be withheld.
- **System settings** — currency, tax, trial length, grace periods, what a
  suspended school may do, which pupil statuses are billable.

There is no plan named in the code anywhere. Everything about a plan is a row,
which is why the pricing page, the checkout, the invoice and the console cannot
disagree.

### B8 · Being paid

Console → **Payment gateway**. Paste Nickland's own gateway keys, press **Test
connection**, then **Make this the live one**. A gateway cannot be switched on
until the test passes, and changing any credential clears the pass — so a wrong
key is found by you, and never by a school at ten at night.

Until this is done: schools register, start their trials and use everything,
and no card is taken. That is a fine state to enrol the first school in.

> This is **Nickland's** gateway, for charging schools. A school's own gateway,
> for taking fees from parents, is set up by that school in its own portal and
> never appears here. The two share no key, no table and no reference.

### B9 · The three crons

Render → **New** → **Cron Job**, three times, each running `curl` against your
service with `BILLING_CRON_SECRET` in the header:

| Schedule | Path | Does |
|---|---|---|
| daily | `/api/v1/admin/cron/billing-run` | raises invoices, moves trials and lapses along, sends the day's reminders |
| daily | `/api/v1/admin/cron/reminders` | reminders alone, if you want them on a different schedule |
| every 10 min | `/api/v1/admin/cron/notifications` | pushes the text messages schools have queued to parents |

```
curl -fsS -X POST -H "x-cron-key: $BILLING_CRON_SECRET" \
     https://<your-service>/api/v1/admin/cron/billing-run
```

Running any of them twice does nothing the second time.

### B10 · The download links

Console → **System settings** → set these three to the release links from
Part A:

| Setting | Points at |
|---|---|
| `download_desktop_windows` | the `.exe` on your GitHub release |
| `download_desktop_mac` | leave blank if there is no Mac build |
| `download_android` | the `.apk` on your GitHub release |

Until they are set, the download page says the build is not published yet,
rather than offering a link that 404s.

### B11 · Mail and text messages

Console → **System settings** → the mail server details and the platform SMS
key. Without them, renewal reminders reach nobody. Everything else works.

The platform SMS key is **Nickland's**, not a school's, on purpose: a school
being told its subscription has lapsed must not pay for the message, and a
suspended school may have no credit left to send it with.

---

## Part C · Enrol a school

**This is the part you repeat.** Two minutes, in the console, in a browser.

### C1 · Enrol it

1. Console → **Schools** → **Enrol a school**.
2. Fill in:

| Field | |
|---|---|
| **Name** | as the school writes it. It goes on every report the school prints |
| **Address (tenant id)** | leave blank — it is made from the name, and it is permanent |
| **Plan** | the platform's default is already chosen; change it if this school negotiated |
| **Create an account they can sign in with** | leave this **on** for a new school |
| **Their name / email / password** | the head teacher or bursar who will run the system. **Suggest one** makes a password you can read down a telephone |
| **Phone / region** | optional, and what the renewal reminders go to |

3. **Enrol the school.**

Behind that button: the school's own Postgres schema with its 82 tables is
created and seeded with the designations, classes, subjects and grading bands a
desktop opens with; the administrator account is made **inside the school's own
database**, by the same code the desktop uses, so the offline and online systems
agree about who somebody is; the school is registered on the platform; and its
trial starts.

### C2 · Write down what it gives you

The next screen is the only time you will see some of this.

| | |
|---|---|
| **Its address** | `https://ave-maria-school.edusoft.gh` — the school's own |
| **Tenant id** | `ave-maria-school` — goes into the desktop |
| **Signs in with** | the administrator's email and the password you set |
| **Sync key** | **shown once.** Goes into the desktop beside the tenant id |

The sync key is stored only as a hash. A lost one is reissued from the school's
own page in the console — which stops the desktop using the old one the moment
you do, so tell the school before, not after.

### C3 · Check it

Still in the console, **Schools**. The new school is in the list with a green
**OK** under Health. That column reconciles two separate registers — the
platform's row and the school's own database — so an **Incomplete** here tells
you which half is missing, in words, rather than leaving a school that looks
enrolled and fails at the first read.

Then open the school's address in a browser and sign in as its administrator.
That is the only check that covers the whole path.

### C4 · For a school that already runs on a desktop

Turn **Create an account they can sign in with** off. The school gets its
tenant and its sync key and nothing else: its staff accounts already exist on
its desktop and arrive on the first sync, and making a second account here
would be a second password for the same person.

---

## Part D · What the school does

Give the school four things: **its address**, **its tenant id**, **its sync
key**, and **the email and password** of its administrator.

1. **Install the desktop.** From your download page — or straight from the
   GitHub release. One office PC. That machine holds the real record;
   everything else is a window onto it.
2. **Activate it.** The installed application asks for the same email and
   password. That gives the machine its own credential and a licence lease.
3. **Point it at the platform.** **Settings → Cloud Sync** — the platform
   address (it must be `https://`), the tenant id, the sync key. Switch it on.
   The first sync sends everything the school already has, so parents can sign
   in; after that only what changed.
4. **Bring the school's records across.** **Settings → Onboarding** — download
   the twelve-tab workbook, fill it in **in the order the tabs appear** (a
   pupil cannot go in a class that has not been listed yet), and preview before
   importing. Nothing is written until you have seen what it would do. If
   something came in wrong, fix the file and import it **again**: it corrects
   what is there rather than creating it twice.
5. **Set up backups.** **Settings → Backup**, on day one.
6. **Open the school Wi-Fi.** **Settings → Mobile App → Start server**. Every
   phone and laptop in the building now reaches the school at the address it
   shows, with no internet at all.

---

## If something is wrong

| What you see | What it is |
|---|---|
| The service will not start, log says `LICENCE_SIGNING_KEY is not set` | B3. This is the expected first-deploy failure |
| `LICENCE_SIGNING_KEY is set but is not a valid Ed25519 key` | a random string was pasted in. B3 again — it must be generated, not invented |
| **Enrol a school** is not on the Schools page | you are on an older deploy. Render → **Manual Deploy** → **Deploy latest commit** |
| Enrolment answers "no platform administration configured" | `PLATFORM_ADMIN_KEY` is missing or under 24 characters. A short key is refused exactly like no key |
| A school's address shows a picker with other schools on it | the Host did not resolve. Check `PORTAL_BASE_DOMAIN` against the domain actually in use, and that the wildcard record points here |
| A school's address shows no school at all | that address belongs to no enrolled school: a typo, or not enrolled yet |
| A school listed **Incomplete** | only half enrolled. The message on it says which half |
| "The cloud address must start with https://" on the desktop | sync switched itself off rather than send the school key in clear. Fix the URL |
| Parents cannot sign in | the school has not pushed yet. **Settings → Cloud Sync → Re-send everything** |
| A teacher says a mark they entered is missing | **Settings → Cloud Sync**, "Kept this computer's version". Somebody changed it at the school after the teacher read it; the desktop won, and the teacher's figure is recorded there |

---

## What this does not cover

- **The website's self-service registration.** A school can also register
  itself at the website, choose a plan and be signed in — the same call, the
  same tenant, the same subscription as Part C. Part C is for the school that
  telephoned.
- **Suspending, discounting, exempting, invoicing and the revenue report.**
  All in the console, all documented in
  [`docs/SAAS_PLATFORM.md`](SAAS_PLATFORM.md).
- **What a school's own people can do**, which is
  [`docs/USER_GUIDE.md`](USER_GUIDE.md) and
  [`SETUP.md`](../SETUP.md).

More detail on every part of the platform: [`docs/SAAS_PLATFORM.md`](SAAS_PLATFORM.md) ·
[`docs/BILLING.md`](BILLING.md) · [`DEPLOY.md`](../DEPLOY.md) ·
[`SETUP.md`](../SETUP.md)
