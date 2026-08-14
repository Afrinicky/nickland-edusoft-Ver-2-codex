# Getting Nickland Edusoft Running — Step by Step

This is the practical, end-to-end guide to standing up the whole system: the
**PC app**, the **mobile app**, and the **web/cloud portal**. Follow the parts
in order — each part works on its own, so you can stop after Part 1 and still
run a whole school offline.

> New terms used below:
> - **Desktop host** = the Windows PC app. It holds all the data and is the
>   single source of truth.
> - **Mobile app** = the phone app for teachers (on school Wi‑Fi) and parents
>   (Wi‑Fi or internet).
> - **Cloud portal** = the internet service + website that lets parents see
>   their ward's info from anywhere.

---

## The big picture (how the three pieces connect)

```
                    ┌─────────────────────────┐
                    │      DESKTOP HOST        │   ← all data lives here (SQLite)
                    │  (Windows PC in office)  │
                    └───────────┬─────────────┘
              LAN :4747         │ pushes a thin read-model (HTTPS)
        ┌───────────────────────┼────────────────────────┐
        ▼                       ▼                         ▼
  ┌───────────┐         ┌───────────────┐         ┌────────────────┐
  │ MOBILE app │        │  CLOUD PORTAL  │         │  CLOUD PORTAL  │
  │ (teachers, │        │  (web site for │         │  (mobile app in │
  │  parents   │        │   parents over │         │  "internet"     │
  │  on Wi‑Fi) │        │   internet)    │         │   mode)         │
  └───────────┘         └───────────────┘         └────────────────┘
```

- The **desktop** runs the school. Everything else is optional and additive.
- Teachers/parents on the **school Wi‑Fi** talk directly to the desktop.
- Parents **over the internet** talk to the **cloud portal**, which mirrors a
  small read-model the desktop pushes up. The desktop stays authoritative.

---

## Part 1 — The Desktop app (do this first)

This is the only required piece. Once it runs, the school is fully operational
offline.

### 1A. Get the Windows installer (recommended: let GitHub build it)

You do **not** need a Windows machine to build it.

1. Create a free **GitHub account** and a repository (private is fine).
2. Upload this project's files to the repo (everything except `node_modules/`
   and `dist-app/`, which `.gitignore` already excludes).
3. GitHub Actions builds the installer automatically on every push. Open the
   **Actions** tab → the **Build Windows Installer** run (~5–10 min).
4. Download the artifact **nickland-edusoft-windows** — it contains
   `Nickland-Edusoft-Setup-2.0.0.exe`.
5. (Optional, for a permanent link) create a release tagged `v2.0.0`; the build
   attaches the `.exe` to the release.

Full details: [`../GITHUB_BUILD_GUIDE.md`](../GITHUB_BUILD_GUIDE.md) and the
README. To build locally on Windows instead: `npm install && npm run rebuild &&
npm run build:win` (needs Node 20, Python, and VS Build Tools).

### 1B. Install and do first-run setup

1. Run the `.exe` on the office PC and install.
2. On first launch you'll see **Create Administrator Account** — set the admin
   name, username, and password. (This one-time screen never appears again.)
3. Sign in, then configure the school in **Settings**:
   - **School Identity** (name, logo, motto, contacts) and **Branding**.
   - **Terms** (academic year + current term with start/end dates).
   - **Classes**, **Subjects**, and **Class → Subject** mapping.
   - **Grading** bands.
   - **Users & Access** — create accounts for staff and set each
     designation's permissions.
   - (Optional) **Timetable** — set the daily periods (bell schedule), then fill
     each class's weekly grid.

You now have a working school-management system. Students, fees, canteen,
finance, payroll, academics, homework, and reporting all run here.

### 1C. Try the desktop in development (optional, for tinkering)

```bash
npm install
npm run rebuild      # rebuild the SQLite native module for Electron
npm run dev          # hot-reload dev mode
```

---

## Part 2 — The Mobile app over the school Wi‑Fi (teachers + parents on LAN)

This gives teachers a working tool (attendance, scores, canteen, homework, their
timetable, messages) and parents their ward's info — all over the local network.

### 2A. Turn on the host server (on the desktop)

1. Open the desktop → **Settings → Mobile App**.
2. **Start server**. Note the address it shows, e.g. `http://192.168.1.20:4747`.
3. Provision parent accounts under **Settings → Users & Access / Parents**, or
   let a parent self-register in the app if their phone/email matches a
   student's guardian contact on file.

### 2B. Run the mobile app

The mobile app is a React Native / **Expo** project in `mobile/`.

**For testing (fastest):**
```bash
cd mobile
npm install
npx expo start        # press a (Android) / i (iOS), or scan the QR in the Expo Go app
```
Install **Expo Go** on the phone (from the Play Store / App Store), make sure the
phone is on the **same Wi‑Fi** as the desktop, then scan the QR.

**For a real installable app (production):**
- You'll need a free **Expo account** and the EAS CLI (`npm i -g eas-cli`,
  `eas login`).
- Android: `eas build -p android` → produces an `.apk`/`.aab` you can install or
  put on the Play Store.
- iOS: `eas build -p ios` → requires a paid **Apple Developer account**
  ($99/yr) to install on devices / TestFlight / the App Store.

### 2C. Connect and sign in

1. Open the app → **Connect** → **School Wi‑Fi** tab → enter the host address
   from step 2A → **Connect**.
2. Sign in as **Parent** (phone/email + password, or self-register) or
   **Staff/Teacher** (username + password).
3. Teachers get a dashboard with quick actions: **Take Attendance**, **Enter
   Scores**, **Collect Canteen**, **Set Homework**, **My Timetable** (each shown
   only if their permissions allow). Parents get children, fees/canteen,
   attendance, results, timetable, homework, messages, and payments.

---

## Part 3 — The Cloud portal (parents over the internet + the web student portal)

This is what lets parents reach their ward's info **from anywhere**, and gives
you the public website. It's optional — the school runs fine without it — but
it's the "reach-anywhere" half of the vision.

There are two identical implementations; pick one:
- **`cloud/`** — Node (no framework). Simple to run anywhere Node runs.
- **`cloud-python/`** — Python/FastAPI (same API), with `Dockerfile`,
  `render.yaml`, and `fly.toml` for one-click-ish deploys.

### 3A. Get a database and a host

1. Create a **Neon** (or any Postgres) database → copy its connection string
   (`DATABASE_URL`).
2. Pick a hosting platform that keeps a process running: **Render**, **Railway**,
   **Fly.io**, or a small VPS. Make sure it serves over **HTTPS** (the desktop
   refuses a plain-`http://` cloud URL except localhost).

### 3B. Deploy the service

**Node (`cloud/`):**
```bash
cd cloud
npm install
psql "$DATABASE_URL" -f schema.sql           # once, to create the tables
DATABASE_URL=postgres://…  PORT=8080  npm start
```

**Python (`cloud-python/`):** use the included `Dockerfile` / `render.yaml` /
`fly.toml`; set `DATABASE_URL` as an environment variable on the platform, and
apply `cloud-python/schema.sql` once.

You now have a URL like `https://portal.yourschool.com`. Visiting it in a browser
serves the **parent website** (the student portal).

### 3C. Register each school (tenant)

```bash
cd cloud
DATABASE_URL=…  npm run create-school -- "Ave Maria School Acherensua"
# prints:  school_id + api_key   ← copy these
```

### 3D. Point the desktop at the cloud

On the desktop → **Settings → Cloud Sync**:
1. Enter the **cloud base URL** (`https://…`), the **school_id**, and the
   **api_key** from step 3C.
2. **Test**, then **Enable**.
3. Click **Push now** (or **Backfill**) to send the current read-model up. From
   then on it syncs automatically (every ~5 minutes and on changes).

### 3E. Parents use it

- **Web:** parents open the portal URL, pick the school, and sign in with the
  phone/email + password the school set (or they registered on the LAN app).
  They see fees, receipts, attendance, results, timetable, homework, and school
  messages.
- **Mobile over the internet:** in the app → **Connect** → **Over the internet**
  tab → enter the portal URL → pick the school → sign in. (In this mode the app
  is parent-only and read-focused; staff features and payments stay on the LAN.)

---

## Part 4 — Optional add-ons

Configure these in **Settings** on the desktop when you want them:

- **Online payments** (mobile money / card): **Settings → Online Payments** —
  add your **Paystack** secret key. Parents can then pay in-app and get an
  automatic receipt.
- **SMS notifications**: **Settings → Notifications** — add an **Arkesel** (or
  equivalent) API key + sender ID. Fee receipts, reminders, and staff replies go
  out by SMS.
- **Email notifications**: **Settings → Notifications** — choose **Resend**
  (API key + verified `from` address) or **SMTP**.
- **Backups**: **Settings → Backup** — turn on scheduled backups and point them
  at a local/network folder and/or a cloud-sync folder (Google Drive Desktop,
  OneDrive, Dropbox) for off-site safety.

---

## Accounts / services you'll need to sign up for

| For… | You need | Cost |
|------|----------|------|
| Building the Windows installer | GitHub account | Free |
| Testing the mobile app | Expo Go app on a phone | Free |
| A real Android app | Expo account (EAS) | Free tier works |
| A real iOS app | Apple Developer account | $99/yr |
| Publishing to Play Store | Google Play Developer account | $25 once |
| The cloud portal host | Render / Railway / Fly / VPS | Free–small tiers exist |
| The cloud database | Neon (or any Postgres) | Free tier exists |
| Online payments (optional) | Paystack account | Pay per transaction |
| SMS (optional) | Arkesel (or similar) account | Pay per SMS |
| Email (optional) | Resend account or an SMTP mailbox | Free tier exists |

---

## Recommended order of operations (checklist)

1. [ ] Build + install the **desktop** app; complete first-run admin setup.
2. [ ] Configure school identity, terms, classes, subjects, grading, users.
3. [ ] (If teachers/parents want phone access on-site) start the **Mobile App**
       server; provision parents; run the mobile app and connect over Wi‑Fi.
4. [ ] (If parents need internet access) deploy the **cloud portal**, register
       the school, and enable **Cloud Sync** on the desktop.
5. [ ] (Optional) turn on **payments**, **SMS/email**, and **backups**.
6. [ ] Build a real mobile app with **EAS** and distribute it.

---

## What is NOT built yet / known caveats

Be aware of these before going live:

- **Mobile/desktop UI hasn't been run in this workspace.** The desktop pages and
  mobile screens (including the recent timetable, messaging, homework, and
  cloud-mode work) are written and the backend is unit-tested, but the React /
  React Native UI needs a real `npm run dev` and `expo start` pass to eyeball and
  shake out any runtime issues. **Do a full click-through before relying on it.**
- **Parent replies over the internet** aren't wired yet. Messaging is fully
  two-way on the LAN; over the cloud portal parents can *read* school messages
  (and are reachable by the SMS mirror), but replying from the web/cloud is a
  planned follow-up.
- **Online payments run through the LAN/host or a tunnel**, not the hosted cloud
  portal directly.
- **Push notifications** (phone alerts) and an **offline write queue** for the
  mobile app are not built.
- **Multi-school SaaS control plane** (self-service onboarding, billing) isn't
  built — you provision each school with the `create-school` script.
- Modules a mature SMS might add later: **library circulation, transport, online
  admissions, ID cards/certificates**. See
  [`GAP_ANALYSIS.md`](GAP_ANALYSIS.md) for the full picture and priorities.

---

## Where to read more

- [`../README.md`](../README.md) — build overview + tech stack.
- [`../GITHUB_BUILD_GUIDE.md`](../GITHUB_BUILD_GUIDE.md) — building the installer.
- [`INSTALLATION.md`](INSTALLATION.md) — installation notes.
- [`USER_GUIDE.md`](USER_GUIDE.md) — day-to-day desktop usage.
- [`MOBILE_API.md`](MOBILE_API.md) — the mobile/cloud API contract + connection modes.
- [`CLOUD_SYNC.md`](CLOUD_SYNC.md) — the two-database sync design.
- [`GAP_ANALYSIS.md`](GAP_ANALYSIS.md) — current gaps, priorities, and what's done.
