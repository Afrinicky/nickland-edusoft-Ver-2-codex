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

## Two ways in, both supported

| | School Wi-Fi (LAN) | Over the internet |
|---|---|---|
| Served by | the school's **desktop**, at `http://<desktop-ip>:4747` | the **portal** (Vercel), at `https://…` |
| Needs internet | **No** — router only | Yes |
| Parents | Everything, including recording a payment | Fees, results, attendance, receipts, notices, messages (read) |
| Teachers / staff | Everything their designation allows — register, scores, canteen, homework | Not yet — see [Teachers over the internet](#teachers-over-the-internet) |
| Installable to home screen | No (plain HTTP is not a secure origin) | Yes |

Nobody has to choose. Both are the same build, and the app works out which one
it is talking to on its own (below), so a school can run the desktop for
teachers on the Wi-Fi and the portal for parents at home, at the same time.

### How it knows where it is

The app asks its own origin one question — `GET /api/v1/info` — and reads the
answer:

- a reply naming a **school** is a desktop host → **host mode**, full features;
- a reply saying **`portal: true`** with a list of schools is the cloud → **cloud
  mode**, parents, read-only. One school is adopted silently; several are
  offered as a picker.

So a teacher who types `192.168.1.20:4747` into Chrome lands on the sign-in
screen, not on a screen asking for the address they just typed. Nothing is
configured per deployment.

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
desktop serves its own copy over HTTP on the same origin as its API. The
Connect screen says so rather than letting the request fail with a bare network
error.

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
phone.

<a name="teachers-over-the-internet"></a>
**Teachers over the internet need a tunnel.** The cloud API is a parent-facing
read model: it has no staff sign-in, and cannot take an attendance register.
A teacher working from home needs a route to the desktop itself — a Cloudflare
Tunnel or similar in front of `http://<desktop-ip>:4747`, entered on the
Connect screen as the school address. Everything then works exactly as it does
on the Wi-Fi, over HTTPS. A native staff surface in the cloud (staff auth,
permissions, a write-back queue for registers and scores) is the next backend
piece, not part of this rollout.

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
