# Nickland Edusoft — Mobile Client

A React Native (Expo) app for **parents/guardians, teachers, and other staff**.
It connects to a school's desktop **host** over the local network today
(`http://<desktop-ip>:4747`), and is designed to point at the cloud portal later
without code changes.

## Run it
```bash
cd mobile
npm install
npx expo start        # then press a (Android), i (iOS), or scan the QR in Expo Go
```
On the desktop app, open **Settings → Mobile App**, start the server, and note
the address shown — enter that on the app's Connect screen.

> Android note: LAN access is plain HTTP, so `usesCleartextTraffic` is enabled in
> `app.json`. For internet/production use, front the host with HTTPS (tunnel or
> the cloud relay) and disable cleartext.

## Structure
```
app/                       Expo Router screens
  _layout.jsx              root stack + AuthProvider
  index.jsx                gate → connect / login / role area
  connect.jsx              enter + verify the school host
  login.jsx                parent (with self-register) or staff sign-in
  parent/                  parent tabs
    index.jsx              children + balances
    child/[id].jsx         fees, canteen, attendance, performance, payments
    notifications.jsx      notices
    account.jsx            profile + sign out
  staff/                   staff tabs (permission-scoped)
    index.jsx              dashboard metrics
    students.jsx           roster
    debtors.jsx            outstanding fees
    account.jsx            access summary + sign out
src/
  api.js                   typed-ish API client (matches docs/MOBILE_API.md)
  auth.jsx                 token + host persistence (expo-secure-store)
  ui.jsx                   shared components
  theme.js                 navy/gold tokens
```

## Roles
The host enforces access; the app just renders what it's allowed:
- **Parent** — only their own children (fees, canteen, attendance, performance,
  notices). Self-registers if their phone/email matches a student on file.
- **Staff/Teacher/Admin** — exactly the modules their designation permits, read
  from `/me` after login.

## Contract
All endpoints and the auth model are documented in
[`../docs/MOBILE_API.md`](../docs/MOBILE_API.md). The cloud/multi-school and
two-database sync design is in [`../docs/CLOUD_SYNC.md`](../docs/CLOUD_SYNC.md).

## Not built yet (next)
- Online payment initiation (mobile money / bank) → host records + receipts.
- Attendance marking & scores entry screens for teachers (host endpoints exist
  / are stubbed for attendance).
- Push notifications (Expo push) and offline write queue.
