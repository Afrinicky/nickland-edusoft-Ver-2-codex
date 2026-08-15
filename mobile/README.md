# Nickland Edusoft — Mobile Client

A React Native (Expo SDK 51) app for **parents/guardians, teachers and other
staff**. It talks to a school's desktop **host** over the local network
(`http://<desktop-ip>:4747`) or to the hosted **cloud portal** over the
internet — the same screens, either way.

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
npm run prebuild        # regenerates android/ from app.json
```

## Structure

```
assets/                    icon, adaptive icon, splash, notification, favicon
app/                       Expo Router screens
  _layout.jsx              root stack + AuthProvider
  index.jsx                gate → connect / login / role area
  connect.jsx              LAN address or cloud portal + school picker
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
src/
  api.js                   API client — one method surface, host or cloud mode
  auth.jsx                 token + connection persistence (expo-secure-store)
  ui.jsx                   shared components
  theme.js                 navy/gold tokens
eas.json                   build profiles (apk / preview / production)
app.json                   the single source of truth for icon, splash,
                           permissions, package name and version
```

`android/` and `ios/` are **generated** from `app.json` by `expo prebuild` and
are git-ignored — never edit them by hand.

## Roles

The host enforces access; the app renders what it is allowed:

- **Parent** — only their own children: fees, canteen, attendance, performance,
  receipts, notices, messages. Self-registers if their phone or email matches a
  student's guardian contact on file.
- **Staff / Teacher** — exactly the modules their designation permits, read from
  `/me` after login. Teachers mark attendance, enter scores, collect canteen
  money and set homework.

Access levels come from the same model as the desktop — see
[`../docs/ACCESS_CONTROL.md`](../docs/ACCESS_CONTROL.md).

## Contract

Endpoints and the auth model: [`../docs/MOBILE_API.md`](../docs/MOBILE_API.md).
Cloud/multi-school sync design: [`../docs/CLOUD_SYNC.md`](../docs/CLOUD_SYNC.md).

## Not built yet

- Online payment initiation from the app (mobile money / bank) — the host
  records and receipts it today, but the app cannot start one.
- Push notifications (Expo push).
- Offline write queue — a teacher who loses Wi-Fi mid-register has to retry.
