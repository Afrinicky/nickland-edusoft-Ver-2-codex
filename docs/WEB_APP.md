# The web app

The mobile app, in a browser. Same React source as the phone build in
`mobile/`, same eighteen screens, same API — compiled for the web instead of
for Android. Parents and teachers get to it by opening an address; there is
nothing to install and no APK to pass around on WhatsApp.

It is the fastest way to put Nickland Edusoft in people's hands. The phone app
is still the better experience on a phone, and both are built from the same
code, so neither is a fork of the other.

For the phone build see [`MOBILE_BUILD.md`](MOBILE_BUILD.md); for the API it
speaks, [`MOBILE_API.md`](MOBILE_API.md).

---

## Three ways in, one build

The important split is not "on the school Wi-Fi" versus "off it". It is **the
school's own system** versus **the hosted portal** — because that is what
decides whether you can do your job or only read about it.

| | School Wi-Fi | The school, over the internet | The hosted portal |
|---|---|---|---|
| Reaches | the desktop, at `http://<desktop-ip>:4747` | the same desktop, through a tunnel at `https://…` | the cloud API (Render) |
| Served by | the desktop itself | the desktop, through the tunnel | Vercel |
| Needs internet | **No** — router only | Yes, at both ends | Yes |
| Needs the desktop switched on | Yes | Yes | No |
| **Teachers** | Everything their designation allows — register, scores, canteen, homework | **The same, in full** | Cannot sign in |
| **Parents** | Everything, including recording a payment | The same | Fees, results, attendance, receipts, notices, messages (read) |
| Installable to home screen | No (plain HTTP is not a secure origin) | Yes | Yes |

The first two columns are the same thing reached two ways, which is the point:
**a teacher marking a register at home is doing exactly what they do in the
staff room**, against the same database, with no second implementation to keep
in step. See [Reaching the school over the internet](#tunnel) for the setup.

The third column exists because the desktop is not always on, and a parent
checking a fee balance at 9pm should not depend on it being on. The cloud
carries a read model each desktop pushes up, so it answers whether or not the
school's machine is awake.

Nobody has to choose between them, and no build is specific to one. The app
works out which it is talking to on its own (below), and a school can run all
three at once.

### How it knows where it is

The app asks its own origin one question — `GET /api/v1/info` — and reads the
answer:

- a reply naming a **school** is the school's own system → **host mode**, full
  features. It does not matter whether that came over the Wi-Fi or a tunnel;
- a reply saying **`portal: true`** with a list of schools is the cloud → **cloud
  mode**, parents, read-only. One school is adopted silently; several are
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
   Parents, anywhere                     Teachers + parents, school Wi-Fi
          │                                            │
          ▼                                            ▼
   Vercel (static)                          Desktop  http://192.168.1.20:4747
   the web app                              the same web app + the full API
          │  /api/v1/*                                 │
          ▼                                            │  sync
   Render  the cloud API  ──────────────────────────────
          │
          ▼
   Neon  Postgres
```

The desktop stays the source of truth. The cloud holds a thin read model that
each desktop pushes to — see [`CLOUD_SYNC.md`](CLOUD_SYNC.md).

### 1. Neon — the database

Create a project, then load the schema once:

```bash
psql "$DATABASE_URL" -f cloud-python/schema.sql
```

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

Deploy. Parents open the Vercel address, pick their school if the portal hosts
more than one, and sign in.

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

**Sign-ins show up as devices.** A browser sign-in appears in **Settings →
Mobile App → Devices** as `web browser`, and can be revoked there like any
phone. That list is how you cut off a lost phone or a teacher who has left,
and it matters more once the school is reachable over the internet.

---

<a name="tunnel"></a>
## Reaching the school over the internet

A tunnel gives the school desktop an HTTPS address on the public internet.
Point the app at it and everything works exactly as it does in the staff room:
same database, same permissions, teachers marking registers and entering
scores, parents recording payments. One tunnel covers both apps at once — the
web app and the API are on the same origin, so the browser gets the app and the
phone app gets its API from the same address.

This is the answer for **teachers off-site**. The hosted portal cannot be: it
holds a parent-facing read model with no staff sign-in, so a teacher cannot log
into it at all, let alone take a register.

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
  a copy of it. If the office PC is off, the tunnel is dead. Schools that shut
  the office down at 4pm should keep the portal running for parents, which is
  exactly the split in the table above.
- **It is a real door onto the school's data.** The API rate-limits sign-ins and
  scopes every request to the account's permissions, but the tunnel removes
  "you have to be on our Wi-Fi" as a layer. Use strong staff passwords, revoke
  devices in **Settings → Mobile App → Devices** when a teacher leaves, and
  restrict the tunnel with Cloudflare Access if you want a second gate.
- **It is one more thing to keep running.** Worth it for a school where
  teachers work from home; unnecessary for one where they do not.

### The alternative, when the desktop cannot stay on

A staff surface in the cloud — staff auth pushed up like `parent_auth` already
is, a staff read model, and registers and scores queued through the existing
change queue for the desktop to apply when it next syncs. That is a backend
project rather than a setting, and it is not built. The tunnel is what works
today, and for a school with a desktop that stays on it is strictly better:
full features, no read-model lag, nothing new to keep in step.

---

## Checks

```bash
npm test                 # includes test/webapp.js — serving, routing, traversal
npm run build:web        # the build itself; a screen that will not bundle fails here
```

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
