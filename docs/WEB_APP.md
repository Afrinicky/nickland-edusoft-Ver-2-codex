# The web app

The mobile app, in a browser. Same React source as the phone build in
`mobile/`, same screens, same API — compiled for the web instead of for
Android. Parents and teachers get to it by opening an address; there is nothing
to install and no APK to pass around on WhatsApp.

It is the fastest way to put Nickland Edusoft in people's hands, and for
teachers it is not a fallback: **teachers do not get the desktop at all**, so
the browser and the phone are the whole of their working day.

## It fits the machine it is on

One bundle is opened on a 320-pixel Android handset, a 6.7-inch iPhone, a
staffroom tablet and a 24-inch office monitor. `mobile/src/responsive.js` is
the single place that decides which of those it is, so no screen measures the
window and picks its own thresholds.

| Width | Navigation | Layout |
|---|---|---|
| < 768 | Bottom bar of five, plus a **More** sheet holding everything else | One column, full-bleed cards, large tap targets |
| 768–1179 | A rail of icons down the side | Two or three columns |
| ≥ 1180 | **The installed application's own shell**: crest, sidebar, top bar and status bar | Up to four columns; the content column stops widening at 1240px so a register is not stretched across a cinema screen |

A browser window dragged narrow gets the phone layout, because at 380 pixels it
*is* a phone as far as the layout is concerned. Tables render as tables where
there is room and as stacked, labelled rows where there is not — so a
broadsheet of thirteen subjects is readable on a handset instead of scrolling
sideways forever.

This meant replacing expo-router's `Tabs` for the signed-in areas, which draws
a bottom bar and only a bottom bar: on a laptop it showed five of the app's
screens along the bottom edge of a 1920-pixel window and hid the rest. Routing
is unchanged — every screen still has a URL that can be typed, bookmarked and
shared, and still guards itself.

## On a desktop it is the desktop application

At 1180 pixels and up the browser draws what the installed application draws,
because for a school with one office PC and six teachers, the browser IS the
application:

* **The sidebar** — the crest and the school's name at the top, the module list
  down the side with the active one carrying the gold rule the installer uses,
  the signed-in person and their designation at the bottom, and the clock.
* **The top bar** — the school's name and motto, a search box bound to Ctrl-K,
  the notification bell, messages, and the current term.
* **The status bar** — where this copy is connected, which school, who is
  signed in.
* **Tabs**, not pages. Every module's sections are a strip under its title, in
  the desktop's order and with the desktop's labels — `?tab=` in the URL, so a
  tab can still be bookmarked and shared.

Below 1180 the phone keeps the design it already had. Home is the day — the
clock-in, what today still needs, today's lessons, the notices — with the grid
of modules under it, rather than a menu first and the work second. A teacher at
ten past seven wants the register; somebody at a desk with a mouse wants the
menu.

### What is still done on the office computer

Four things, and each for the same reason: they are about that machine, not
about the school.

* **Backups**, and where they are written to.
* **Cloud sync** — the keys and the schedule for the school's own projection.
* **The mobile server** — starting it, and the devices allowed onto it. It is
  the thing serving the browser app in the first place.
* **The finance workbook**, which exists so a school whose computer has died
  can keep trading in Excel and import the result back. Both halves are files
  on that machine. The tab is there and says so rather than drawing nothing.

Receipt layouts and the signatures printed on report cards are also set on the
desktop. Everything else a school does — billing, the extra charges a term
throws up, withdrawing a bill and putting it back, discounts, book charges, the
store room, the buses, the payroll run and its statutory schedules, staff
records and what each person teaches, the timetable, question papers, notices
and the audit trail — is in the browser.

### The colours are the school's

`Settings → Appearance` writes the school's primary and accent colours, and
they take effect everywhere at once with no rebuild and no reload. On the web
the theme is a set of CSS custom properties (`--nk-*`) written to the document
root, and every colour in `mobile/src/theme.js` is a `var()` referring to one —
so a colour changed in Settings repaints the sidebar, the tabs, the charts and
the buttons immediately. The desktop shell uses the installer's navy and gold
chrome; the phone keeps the app's own palette. Both are derived from the same
two colours a school actually sets.

## The school's own crest, and everybody's face

Both were on the desktop's hard disk all along and neither ever reached a
phone, because the API sent the *file path* each was stored under. The crest,
a pupil's photograph and a teacher's photograph now travel as `data:` URIs
(`electron/server/media.js`), capped in size and cached by path and
modification time — so they cost one read per image per host, not one per
request per teacher.

* `GET /api/v1/branding` is public and answers before anyone signs in, so the
  sign-in page shows a parent their own school rather than a generic blue box.
* The desktop projects the same record to the cloud, and the portal serves it
  at `GET /api/v1/portal/branding`, so a parent on the internet sees the same
  crest as a teacher on the school Wi-Fi.
* A photograph that fails to decode falls back to initials, and a school with
  no crest uploaded gets the app's own mark. Nothing renders as a hole.

Set the crest in **Settings → School identity → Logo**, and the WhatsApp number
in the same place. That number is where every "Message the school" button and
every "settle this balance" prompt leads; leaving it blank falls back to
Phone 1.

## Nothing is paid in the app

There is no checkout, no card form and no "tell the school what you paid"
box — the routes behind them were removed, not hidden. A parent sees the bill
line by line, what was carried forward from last term, every receipt the
school has issued and what is still outstanding. When they tap **Settle this
balance**, the app opens the school's WhatsApp with the child, the class, the
term and the figures already written into the message, and the office confirms
the amount and the method.

That is how these schools take money anyway, and it means nothing typed into a
phone can create a payment the school did not receive.

Cash the school takes **in person** is untouched. The teacher's **Quick Pay**
screen — the first tab of the canteen module, because it is what the module is
opened for at eight in the morning — records the real notes handed over at the
gate, running the desktop's own code so the ledger entry and the daily rate are
identical whichever machine took it.

## One sign-in box

There is no "parent or staff?" choice. Nobody answers that question at a school
gate, and getting it wrong came back as *invalid username or password*, which
reads as a forgotten password rather than a wrong tab. The credential decides:
the server matches a staff username first, then a parent's phone or email, and
the app goes where the account belongs.

For the phone build see [`MOBILE_BUILD.md`](MOBILE_BUILD.md); for the API it
speaks, [`MOBILE_API.md`](MOBILE_API.md).

---

## Two ways in, one build

The split is **the school's own system** versus **Nickland Edusoft online**.
Both carry teachers and parents; the difference is what happens when the
school's computer is switched off.

| | The school itself | Online |
|---|---|---|
| Reaches | the desktop — `http://<ip>:4747` on the school Wi-Fi, or an HTTPS [tunnel](#tunnel) to the same machine | the cloud API (Render) |
| Served by | the desktop | Vercel |
| Needs internet | **No** on the Wi-Fi; yes through a tunnel | Yes |
| **Needs the school's computer on** | **Yes** | **No** |
| **Teachers** | Everything — the register and its history, class work, exam marks, the broadsheet and report cards, homework and its marking, lesson notes, the canteen sheet, messages, notices, clock-in, leave, payslips | All of it except two things: adding an assessment column, and starting a brand-new conversation. Saved instantly, reach the school when it next syncs |
| **Parents** | Everything, including paying fees | Fees, results, attendance, receipts, notices, messages (read) |
| Installable to home screen | Only over a tunnel (plain HTTP is not a secure origin) | Yes |

**A teacher can do their job from home with the school's computer off.** That
is the point of the online column, and it is not a read-only consolation
prize: the register, class work and exam marks, the broadsheet, lesson notes,
leave, payslips and a reply to a parent all work.

Five things stay with the school, and each says so plainly rather than failing
with a network error:

- **The daily canteen collection** — it reads the register live and takes real
  cash, so it belongs on the school's own network.
- **The class contact book** — guardian phone numbers are read from the
  school's own system rather than projected over the internet.
- **Marking homework** — it needs an assignment the desktop actually created.
- **Adding an assessment column** — the desktop numbers it, and marks queued
  against an id the cloud invented would arrive pointing at nothing.
- **Starting a brand-new conversation** — it needs a parent record the cloud
  does not hold. Replying to an existing thread works from anywhere.

### How that works, and why it is safe

The school's desktop stays the source of truth. It **projects** what teachers
need — accounts with their permissions *and their teaching scope*, class
rosters with pupils, guardian contacts, subjects, recent registers, the marks
already entered, continuous assessment, term summaries, canteen balances, the
dashboard numbers, the debtor list, each teacher's timetable, and a
`staff_profile` record carrying their own employment (assignments, lesson
notes, leave, clock-ins and **paid** payslips only) — and the cloud serves
those. A teacher's
writes are **queued** on the cloud, and the desktop applies them on its next
sync through the very same functions its own LAN API uses. There is one
implementation of "what marking a register means", not two.

Three details make it honest rather than a trick:

- **A teacher sees their own pending work.** Marks that are queued but not yet
  applied are merged over the projected register before it is served. Without
  that, marking a register and reloading would show a blank sheet, and the
  teacher would mark it again. The account screen says how many entries are
  still waiting.
- **The desktop has the last word on permissions.** The cloud checks them from
  the projection; the desktop checks them again, against the live account,
  before writing anything. A revoked teacher's queued work is refused even if
  the projection had not caught up. Their session dies on their next request.
- **Money cannot be taken twice.** Every canteen collection carries a uuid, and
  the desktop keeps a ledger of the ones it has applied. A redelivered change —
  which happens if the desktop applies a batch and then fails before saving its
  cursor — issues no second receipt. Registers and scores are upserts, so
  replaying them is harmless by construction.

The tunnel is still worth having: it is immediate rather than eventual, and it
covers the two things the cloud cannot do. But it is no longer the only way a
teacher works off-site.

### How it knows where it is

The app asks its own origin one question — `GET /api/v1/info` — and reads the
answer:

- a reply naming a **school** is the school's own system → **host mode**, full
  features. It does not matter whether that came over the Wi-Fi or a tunnel;
- a reply saying **`portal: true`** with a list of schools is the cloud → **cloud
  mode**, teachers and parents. One school is adopted silently; several are
  offered as a picker.

So a teacher who types `192.168.1.20:4747` into Chrome — or opens the school's
tunnel address from home — lands on the sign-in screen, not on a screen asking
for the address they just typed. Nothing is configured per deployment.

When the app is hosted **apart** from its API — the Vercel build talking to
Render — there is no API on its own origin to ask, so the address is baked in
at build time instead (`EXPO_PUBLIC_PORTAL_URL`, below).

---

## Build it

```bash
npm run build:web
```

From the repo root. Output lands in `mobile/dist-web/`, and is copied into
every place that serves it:

| Copy | Served by |
|---|---|
| `mobile/dist-web/` | the build itself — what CI publishes and Vercel uploads |
| `resources/webapp/` | the desktop host (electron-builder packages it) |
| `cloud/webapp/` | the Node cloud service, if it serves the app too |
| `cloud-python/webapp/` | the FastAPI service, likewise |

All four are git-ignored: the web app is a build artefact, never a commit.

To see it before it ships:

```bash
npm run serve:web        # http://localhost:4748
```

### Build-time options

| Flag | Environment variable | What it does |
|---|---|---|
| `--portal <url>` | `EXPO_PUBLIC_PORTAL_URL` | The API address to fall back to when the app's own origin has no API. Required for the Vercel build; useful in the APK. |
| `--school <id>` | `EXPO_PUBLIC_SCHOOL_ID` | Pin the build to one school, skipping the picker. For a single-school deployment. |
| `--only-build` | — | Build only; skip the copies. What CI and Vercel use. |

```bash
npm run build:web -- --portal https://nickland-edusoft-cloud.onrender.com
```

Both are compiled **into** the bundle, so a change means a rebuild. Neither is
a secret — they are addresses a user would otherwise type.

---

## Deploy it

The production shape: **Vercel** serves the app, **Render** runs the API,
**Neon** holds the data.

```
  Teachers + parents, anywhere            Teachers + parents, school Wi-Fi
  (works with the school PC off)                        │
          │                                             ▼
          ▼                                  Desktop  http://192.168.1.20:4747
   Vercel (static)                           the same web app + the full API
   the web app                                          │
          │  /api/v1/*                                  │
          ▼                                             │
   Render  the cloud API  ◀── projections ───────────────┤
          │               ──── queued writes ───────────▶│
          ▼                                          (source of truth)
   Neon  Postgres
```

The desktop stays the source of truth. It pushes a thin read model up and pulls
queued writes back down — see [`CLOUD_SYNC.md`](CLOUD_SYNC.md).

### 1. Neon — the database

Create a project, then load the schema once:

```bash
psql "$DATABASE_URL" -f cloud-python/schema.sql
```

It is safe to re-run against an existing database — every statement is
`IF NOT EXISTS` or an `ADD COLUMN IF NOT EXISTS` — and you **must** re-run it
when upgrading a deployment that predates the staff surface, which added a
column for tracking how far each school's desktop has consumed the queue.

Keep the connection string; it goes into Render as `DATABASE_URL` (include
`?sslmode=require`).

### 2. Render — the API

`cloud-python/render.yaml` is a Render blueprint: point Render at this repo and
it builds `cloud-python/` from its Dockerfile. Set:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string |
| `PORTAL_SECRET` | generated once — **never regenerate it**; it signs parent session tokens, and changing it signs every parent out |

Provision each school and note the key the desktop needs:

```bash
DATABASE_URL=… python3 cloud-python/scripts/create_school.py "Ave Maria School Acherensua"
```

Enter that key on the desktop under **Settings → Cloud Sync**.

### 3. Vercel — the web app

Import the repo. `vercel.json` at the root already sets the build command,
output directory, single-page rewrite and cache headers, so the only thing to
add is one environment variable:

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_PORTAL_URL` | your Render URL, e.g. `https://nickland-edusoft-cloud.onrender.com` |

Deploy. Teachers and parents open the Vercel address, pick their school if the
service hosts more than one, and sign in — parents with their phone or email,
teachers with the username the school gave them.

> **Same-origin instead.** If you would rather the app and API share an origin —
> no cross-origin requests at all, and origin detection working without
> `EXPO_PUBLIC_PORTAL_URL` — add a rewrite **above** the catch-all in
> `vercel.json`:
>
> ```json
> { "source": "/api/(.*)", "destination": "https://YOUR-APP.onrender.com/api/$1" }
> ```
>
> Every API call then goes through Vercel, which costs a hop and an invocation
> but removes CORS from the picture entirely.

### 4. The desktop — the LAN copy

Nothing to deploy: the installer carries it. CI builds the web app and the
Windows job packages it into `resources/webapp`, so any desktop running
**Settings → Mobile App → Start server** is already serving it. That page shows
the address and says so.

This is the copy that works with the school's internet down, and the only one
teachers can use today.

---

## Installing it to a phone's home screen

Served over HTTPS, the app is installable: Chrome on Android offers **Add to
Home screen** (the three-dot menu), and Safari on iOS has **Share → Add to Home
Screen**. It then opens full-screen with its own icon, with no browser chrome —
close enough to the APK that most parents will not notice the difference.

The app shell is cached by a service worker, so it opens on a bad connection
and tells you it cannot reach the school, rather than showing a dead page.
**School data is never cached.** A parent shown last week's fee balance because
a service worker served it from disk is worse off than one who is told they are
offline.

Install prompts need a secure origin, so this applies to the portal, not to the
plain-HTTP desktop host on the school Wi-Fi. Teachers on the Wi-Fi should
bookmark the address, or use the APK.

---

## Things worth knowing

**A browser on HTTPS cannot reach a plain-HTTP LAN address.** That is a browser
rule (mixed content), not something the app can work around: the portal copy
can never talk to a desktop on the school Wi-Fi. It is precisely why the
desktop serves its own copy over HTTP on the same origin as its API, and why a
[tunnel](#tunnel) — which makes the school's own address HTTPS — sidesteps the
rule rather than fighting it. The Connect screen warns about the combination
instead of letting the request fail with a bare network error.

**The session lives in `localStorage`.** The phone app uses the device keychain
via `expo-secure-store`, which does not exist in a browser; before this it
failed silently and signed people out on every page reload. Same origin, same
browser, same reader — which is what the previous parent portal already relied
on.

**A page reload lands on the same screen.** Routes are real URLs
(`/parent/child/7`), so they can be bookmarked and shared, and every server
here answers an unknown path with the app shell so the router can take over.

**Sign-ins show up as devices — on the school's own system.** A browser
sign-in there appears in **Settings → Mobile App → Devices** as `web browser`,
and can be revoked like any phone.

**Sign-in is throttled.** Both login endpoints refuse after 20 attempts a
minute, keyed by source address and by the account being targeted. It matters
more than it did: a staff account can read a school's roster and write its
registers, and it is now reachable from anywhere. The counter is per process,
so a service running several workers allows that many times more — still far
below what guessing a password needs.

**Cutting off a teacher who has left is done on the account, not the device.**
An Online session is a signed token the cloud issues, so there is no device row
to revoke. Deactivate the account under **Settings → Users & Access**: the
change is projected up, and their next request — Online or on the Wi-Fi — is
refused. Anything they had queued and unapplied is refused too, because the
desktop re-checks the account before writing.

---

<a name="tunnel"></a>
## Reaching the school over the internet

A tunnel gives the school desktop an HTTPS address on the public internet.
Point the app at it and everything works exactly as it does in the staff room:
same database, same permissions, writes landing immediately rather than being
queued, and the things the cloud cannot do — the daily canteen collection,
marking homework, the class contact book — available. One tunnel covers both
apps at once, because the web app and the API are on the same origin.

It is **not** required for teachers to work off-site any more; the online
service carries them. Set one up when a school wants off-site work to land
instantly, or wants the morning canteen collection to work from a phone that
is not on the school Wi-Fi. Its cost is that the desktop has to stay switched
on.

### Cloudflare Tunnel (free, no fixed IP, no router changes)

On the school desktop, once:

```bash
# 1. Install cloudflared (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
# 2. Log in — opens a browser to pick the domain you own
cloudflared tunnel login

# 3. Create the tunnel and give it a name
cloudflared tunnel create nickland-edusoft

# 4. Route a hostname to it
cloudflared tunnel route dns nickland-edusoft school.yourdomain.com

# 5. Run it, pointed at the mobile server
cloudflared tunnel run --url http://localhost:4747 nickland-edusoft
```

Install it as a Windows service so it starts with the machine
(`cloudflared service install`), and make sure **Settings → Mobile App → Start
server** is on and set to start automatically too.

Teachers and parents then use `https://school.yourdomain.com` — in a browser,
or typed into the phone app's Connect screen under **My school**.

### What it costs you

- **The desktop must be switched on.** A tunnel is a route to that machine, not
  a copy of it. If the office PC is off, the tunnel is dead — and this is
  exactly the case the online service exists for. A school that shuts the
  office down at 4pm should point its teachers at Online, not at a tunnel.
- **It is a real door onto the school's data.** The API rate-limits sign-ins and
  scopes every request to the account's permissions, but the tunnel removes
  "you have to be on our Wi-Fi" as a layer. Use strong staff passwords, revoke
  devices in **Settings → Mobile App → Devices** when a teacher leaves, and
  restrict the tunnel with Cloudflare Access if you want a second gate.
- **It is one more thing to keep running.** Worth it for a school where
  teachers work from home; unnecessary for one where they do not.

### Which to tell a school to use

| The school | Point teachers at |
|---|---|
| Office PC runs all day and teachers only work on site | the school's Wi-Fi address; no tunnel, no cloud needed |
| Teachers work from home, PC stays on | either. A tunnel lands work instantly; Online needs no setup |
| PC is switched off outside school hours | **Online** |
| No reliable internet at the school at all | the Wi-Fi address on site, and Online from teachers' own data |

Parents are simpler: **Online**, always. It answers whether or not the school's
computer is on, and it is the only one that installs to a phone's home screen
without a tunnel.

---

## Checks

```bash
npm test                 # includes test/app_modules.mjs — what the app draws and
                         # for whom; test/office_api.js — the office over the
                         # school's own network; cloud/test/staff.js — the whole
                         # teacher-off-LAN round trip; and test/webapp.js for
                         # serving and routing
npm run build:web        # the build itself; a screen that will not bundle fails here

cd cloud-python && python3 tests/test_staff.py   # the same surface on the Python service
```

`test/app_modules.mjs` is the front end's half of the access rule: it runs the
app's own module list against the six kinds of person a school has and checks
what is **absent** — that a class teacher's app has no Payroll in it, that a
bursar is never offered the register, that the audit trail exists for one
account in the school.

`test/office_api.js` is the other half, against a real server and the real
schema: that a bursar who may take a payment still cannot grant a discount,
that a class teacher cannot reach the store room at all, that stock cannot be
issued below zero, and that a person may always read their own payslip.

CI builds the web app on every branch, so a broken screen is caught on the pull
request rather than at deploy time.

---

## What is generated vs what is source

`mobile/dist-web/` and the three copies are **generated**. The source is:

| File | What it controls |
|---|---|
| `mobile/app/`, `mobile/src/` | the screens — shared with the phone app |
| `mobile/public/index.html` | the page shell, boot splash, service-worker registration |
| `mobile/public/manifest.json` | name, icons, colours for home-screen install |
| `mobile/public/sw.js` | what is cached offline (the shell; never school data) |
| `mobile/app.json` → `web` | title, theme colour, single-page output |
| `vercel.json` | the Vercel build, rewrite and cache headers |
| `scripts/build-web.mjs` | the build and where the copies go |
