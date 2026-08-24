# Nickland Edusoft — Mobile Client

A React Native (Expo SDK 51) app for **parents/guardians, teachers and other
staff**. It talks to a school's desktop **host** over the local network
(`http://<desktop-ip>:4747`) or to the hosted **cloud portal** over the
internet — the same screens, either way.

It builds for **three targets from this one source**: an Android APK, an iOS
build, and a **web app** that runs in any browser. The web build is the one
schools get to first — nothing to install, just an address — and is documented
in **[`../docs/WEB_APP.md`](../docs/WEB_APP.md)**.

## Build for the web

```bash
npm run build:web         # from the repo root — output in mobile/dist-web
npm run serve:web         # look at it: http://localhost:4748
```

The desktop host serves it over the school Wi-Fi (no internet needed) and the
portal serves it over HTTPS. See [`../docs/WEB_APP.md`](../docs/WEB_APP.md).

## Build an installable APK

See **[`../docs/MOBILE_BUILD.md`](../docs/MOBILE_BUILD.md)** — the full guide.
The short version:

```bash
cd mobile
npm install
npm run build:apk       # cloud build (free Expo account) → downloadable APK
# or
npm run apk:gradle      # local build (needs the Android SDK)
```

## Run it while developing

```bash
cd mobile
npm install
npx expo start          # press a (Android), i (iOS), or scan the QR in Expo Go
```

On the desktop, open **Settings → Mobile App**, start the server, and enter the
address it shows on the app's Connect screen.

> LAN access is plain HTTP, so `usesCleartextTraffic` is on in `app.json`. That
> is fine inside the school's own Wi-Fi; anything over the internet should go
> through the cloud portal on HTTPS.

## Checks

```bash
npm run bundle:check    # bundles all 18 screens + 3 layouts through Metro
npm run build:web       # the web bundle — same screens, browser target
npm run prebuild        # regenerates android/ from app.json
```

## Structure

```
assets/                    icon, adaptive icon, splash, notification, favicon
app/                       Expo Router screens
  _layout.jsx              root stack + AuthProvider
  index.jsx                gate → connect / login / role area
  connect.jsx              the school's own address, or online + school picker
  login.jsx                parent (with self-register) or staff sign-in
  parent/                  parent tabs
    index.jsx              children + balances
    child/[id].jsx         fees, canteen, attendance, performance, payments
    messages.jsx           threads with the school
    message/[id].jsx       one conversation
    notifications.jsx      notices
    account.jsx            profile + sign out
  staff/                   staff tabs (permission-scoped)
    index.jsx              dashboard metrics
    students.jsx           roster
    attendance.jsx         mark the daily register
    scores.jsx             enter marks
    canteen.jsx            collect canteen money
    homework.jsx           set and mark homework
    timetable.jsx          the week's periods
    debtors.jsx            outstanding fees
    account.jsx            access summary + sign out
public/                    web build only — page shell, manifest, service worker
src/
  api.js                   API client — one method surface, host or cloud mode
  auth.jsx                 token + connection persistence, and first-run discovery
  storage.js               keychain on the phone, localStorage in a browser
  origin.js                works out what the app is talking to, and how
  config.js                build-time defaults (EXPO_PUBLIC_PORTAL_URL etc.)
  ui.jsx                   shared components
  theme.js                 navy/gold tokens
eas.json                   build profiles (apk / preview / production)
app.json                   the single source of truth for icon, splash,
                           permissions, package name and version
```

`android/`, `ios/` and `dist-web/` are **generated** — the first two from
`app.json` by `expo prebuild`, the third by `npm run build:web`. All are
git-ignored; never edit them by hand.

## Roles

The host enforces access; the app renders what it is allowed:

- **Parent** — only their own children: fees, canteen, attendance, performance,
  receipts, notices, messages. Self-registers if their phone or email matches a
  student's guardian contact on file.
- **Staff / Teacher** — exactly the modules their designation permits, read from
  `/me` after login. Teachers mark attendance, enter scores, collect canteen
  money and set homework — on the school Wi-Fi, or over the internet **with the
  school's computer switched off**, in which case the work is saved online and
  reaches the school when it next syncs. Taking a fee payment and marking
  homework still need the school's own system. See
  [`../docs/WEB_APP.md`](../docs/WEB_APP.md).

Access levels come from the same model as the desktop — see
[`../docs/ACCESS_CONTROL.md`](../docs/ACCESS_CONTROL.md).

## Contract

Endpoints and the auth model: [`../docs/MOBILE_API.md`](../docs/MOBILE_API.md).
Cloud/multi-school sync design: [`../docs/CLOUD_SYNC.md`](../docs/CLOUD_SYNC.md).

## Not built yet

- Online payment initiation from the app (mobile money / bank) — the host
  records and receipts it today, but the app cannot start one.
- Marking homework, and taking a fee payment, when connected online rather than
  to the school itself. Both need something only the desktop has: an assignment
  id, and the school's receipt numbering.
- Push notifications (Expo push).
- Offline write queue — a teacher who loses Wi-Fi mid-register has to retry.
