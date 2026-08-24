# Nickland Edusoft — Mobile API (Host) Reference

The desktop app is the **host**. When the mobile server is enabled
(Settings → Mobile App → *Start server*) it exposes a small JSON API over the
LAN that the mobile client (React Native / Expo) consumes. The desktop's
SQLite database remains the single source of truth; the API never ships the
database itself.

- **Base URL (LAN):** `http://<desktop-ip>:<port>/api/v1` (default port `4747`).
  The desktop lists its reachable addresses in Settings → Mobile App.
- **Transport:** HTTP on LAN today. The route contract is designed so a cloud
  relay / reverse proxy (HTTPS) can front it later with **no client changes**.
- **Auth:** per-device **bearer token** in `Authorization: Bearer <token>`.
  Tokens are issued at login, hashed (SHA-256) at rest, expire (default 30
  days), and are revocable from the desktop.

## Roles

| Role | Who | Scope |
|------|-----|-------|
| `parent` | Guardians | Only their own children (fees, canteen, attendance, reports, notices). |
| `staff` | Teachers & other staff | Exactly what their **designation permissions** allow (same matrix as desktop). |
| `staff` + admin | Proprietor / Administrator | All staff modules; structural config stays desktop-only. |

Parents are a **separate identity** (`parents` table) linked to `students` via
`parent_students`. A parent self-registers only if their phone/email matches a
student's guardian contact on file; otherwise an admin provisions the account.

## Endpoints

### Public
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness + school name. |
| GET | `/info` | School identity + whether self-registration is on. |
| POST | `/auth/login` | Staff login `{ username, password, device }` → `{ token }`. |
| POST | `/auth/parent/register` | Parent self-register `{ full_name, phone, email, password }` (must match a student). |
| POST | `/auth/parent/login` | Parent login `{ identifier (phone/email), password }`. |

### Authenticated (Bearer)
| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/me` | any | Current subject + scope/permissions. |
| POST | `/auth/logout` | any | Revoke the calling token. |
| GET | `/parent/children` | parent | Children with fee + canteen balances. |
| GET | `/parent/children/:id` | parent | One child: payments, attendance summary. |
| GET | `/parent/children/:id/report` | parent | Academic performance (scores + summary). |
| POST | `/parent/children/:id/pay` | parent | Submit a manual payment (office/bank/momo) → pending intent. |
| POST | `/parent/children/:id/pay/online` | parent | Start a gateway checkout → `{ authorization_url, reference }`. |
| GET | `/parent/pay/verify/:reference` | parent | Verify + settle an online payment (pull). |
| GET | `/parent/children/:id/intents` | parent | Track submitted payments + status. |
| GET | `/parent/notifications` | parent | Messages sent to the parent's contacts. |
| GET | `/parent/children/:id/timetable` | parent | The child's class timetable (bell schedule + weekly grid). |
| GET | `/parent/messages` | parent | The parent's message threads with the school. |
| GET | `/parent/messages/:id` | parent | One thread with its messages (marks it read for the parent). |
| POST | `/parent/messages` | parent | `{ threadId?, studentId?, subject?, body }` — start or continue a thread. |
| GET | `/parent/children/:id/homework` | parent | The child's class homework (upcoming + recently due). |
| GET | `/parent/children/:id/transport` | parent | The child's bus route, stop, pickup time and transport-fee balance. |

### Payment gateway (Paystack by default; pluggable per school)
- Configured in Settings → Online Payments (`payment_gateway`, `paystack_secret_key`, …).
- **Online flow:** parent → `pay/online` → open `authorization_url` → after checkout
  the app calls `pay/verify/:reference`, which verifies with the gateway and, if
  paid, records the payment + sends the receipt. Settlement is idempotent.
- **Webhook (public tier):** `POST /webhooks/paystack` — authenticated by the
  gateway's HMAC-SHA512 signature over the raw body (`x-paystack-signature`);
  on `charge.success` it verifies and settles. Not needed on LAN (the app
  verifies directly). Other providers plug in as adapters with the same
  interface.
| GET | `/dashboard` | staff (`dashboard.view`) | Term metrics (students, staff, fees). |
| GET | `/classes` | staff (`students`/`academics`/`canteen` view) | Class list for the teacher pickers. |
| GET | `/students?classId=` | staff (`students.view`) | Student roster. |
| GET | `/fees/debtors` | staff (`fees.view`) | Outstanding balances. |
| GET | `/attendance?classId=&date=` | staff (`students`/`academics` view) | Register roster for a class on a date, with any marks already set. |
| POST | `/attendance` | staff (`students`/`academics` edit) | `{ date, marks:[{student_id,status,notes}] }`. `notes` are kept only for `absent`. |
| GET | `/scores/subjects?classId=` | staff (`academics.view`) | Subjects mapped to the class (falls back to all active subjects). |
| GET | `/scores?classId=&subjectId=` | staff (`academics.view`) | Roster + current raw exam mark / total for the current term. |
| POST | `/scores` | staff (`academics.edit`) | `{ subjectId, marks:[{student_id,exam_score}] }` (raw 0–100). Host converts + totals with the school's weighting and refreshes the cloud snapshot. |
| GET | `/canteen/student/:id` | staff (`canteen.view`) | A student's canteen balance for the current term (daily rate, unpaid days, amount owed). |
| POST | `/canteen/collect` | staff (`canteen.create`) | `{ student_id, amount, payment_method, notes }`. Records the payment, marks covered days paid, posts to Finance, and generates + delivers a receipt. |
| GET | `/timetable/mine` | staff | The signed-in teacher's own week, grouped by weekday, plus `today`. |
| GET | `/timetable/class/:id` | staff (`academics`/`students` view) | A class's timetable grid (periods + entries). |
| GET | `/homework?classId=` | staff (`academics.view`) | Homework for a class (`&all=1` for full history). |
| POST | `/homework` | staff (`academics.edit`) | `{ classId, subjectId?, title, description?, dueDate? }` — set homework. |

Every response is `{ ok: boolean, ... }`. Errors use HTTP status codes
(`401` unauthorized, `403` forbidden/out-of-scope, `429` rate-limited).

## Security notes
- Tokens are per device and individually revocable (Settings → Mobile App →
  Paired devices). Disabling a parent revokes all their tokens.
- Auth endpoints are rate-limited per IP.
- Parents can never reach `/students`, `/dashboard`, or another family's child.
- Structural configuration (database/backup, branding, terms, grading,
  users/permissions, receipt templates, factory reset) is **desktop-only** and
  intentionally has no mobile endpoints.

## Connection modes (the client speaks two APIs, one build)

The Expo client connects one of two ways, chosen on the **Connect** screen and
persisted (`mode` = `host` | `cloud`) — in the device keychain on a phone, in
`localStorage` in a browser, since there is no keychain there.

| Mode | Reaches | Base + routes | Audience | Writes |
|------|---------|---------------|----------|--------|
| **host** (the school itself — its Wi-Fi address or a tunnel) | the desktop | `http(s)://<address>/api/v1` — `/auth/*`, `/parent/*`, staff routes | parents **and** staff | everything, immediately: attendance, scores, canteen, homework marking, fee payments |
| **cloud** (Online) | the hosted service | `https://<portal>/api/v1` — `/portal/*` for parents, `/staff/*` for teachers | parents **and** staff | parents read; teachers queue attendance, scores, canteen and homework for the desktop to apply |

In cloud mode the client picks a school from `GET /portal/schools` (or from
`GET /info`), then signs in as a parent via `POST /portal/login`
(`{ school_id, identifier, password }`) or as a teacher via
`POST /staff/login` (`{ school_id, username, password }`).

The API client (`mobile/src/api.js`) **normalises** cloud replies into the same
shapes the host's routes return, so no screen knows which mode it is in. A
staff route that is `/attendance` on the desktop is `/staff/attendance` on the
cloud, and one helper picks between them.

Host-only, and they say so rather than failing: **taking a fee payment** (it
writes a receipt against the school's own numbering) and **marking homework**
(it needs an assignment id that only exists once the desktop has created the
assignment).

### Discovery: one request, not a guess

The **web build** is served by the very thing it talks to — the desktop host at
`http://<ip>:4747`, or the portal — so it does not ask for an address. It calls
`GET /api/v1/info` on its own origin and reads the answer:

| Reply | Meaning |
|---|---|
| `{ ok, school: {…}, parent_self_register, … }` | a desktop host → **host** mode |
| `{ ok, mode: 'cloud', portal: true, schools: […] }` | the cloud portal → **cloud** mode |
| anything else, or unreachable | no API here → fall back to `EXPO_PUBLIC_PORTAL_URL`, then the Connect screen |

The portal answers `/info` publicly for exactly this reason: one question
instead of probing endpoint by endpoint. A portal hosting one school is adopted
silently; several are offered as a picker.

A build hosted **apart** from its API (the Vercel deploy talking to Render) has
no API on its own origin, so `EXPO_PUBLIC_PORTAL_URL` is compiled in at build
time and used instead. See [`WEB_APP.md`](WEB_APP.md).

### Staff over the internet

`/api/v1/staff/*` is what lets a teacher work with the school's desktop
switched off. Reads come from projections the desktop pushes; writes are queued
for it to apply.

| | Endpoint | Notes |
|---|---|---|
| Sign in | `POST /staff/login` | `{ school_id, username, password }` → `{ token, user }`. Verifies the **bcrypt** hash the desktop projects — the same one it stores, so no teacher is re-enrolled |
| Profile | `GET /staff/me` | user, designation, `is_admin`, the resolved permission map |
| Dashboard | `GET /staff/dashboard` | the four numbers; fee figures blanked for a teacher without `fees.view` |
| Roster | `GET /staff/students[?classId=]` | |
| Debtors | `GET /staff/debtors` | needs `fees.view` |
| Classes | `GET /staff/classes` | |
| Register | `GET /staff/attendance?classId=&date=` · `POST /staff/attendance` | |
| Scores | `GET /staff/scores/subjects?classId=` · `GET /staff/scores?classId=&subjectId=` · `POST /staff/scores` | |
| Canteen | `GET /staff/canteen/student/:id` · `POST /staff/canteen/collect` | |
| Timetable | `GET /staff/timetable/mine` | |
| Homework | `GET /staff/homework?classId=` · `POST /staff/homework` | setting only; marking is host-only |
| Still waiting | `GET /staff/pending` | how much of this teacher's work the school has not taken yet |

Every write replies `{ ok: true, queued: true }`. Nothing is invented in the
reply — a canteen collection returns `receipt_number: null`, because the
desktop issues receipt numbers and putting a made-up one on a parent's phone
would not match the school's books.

**A `GET` after a write shows the write.** Queued-but-unapplied changes are
merged over the projected register or score sheet and flagged `pending: true`
per student. Without that, marking a register and reloading would show a blank
sheet and the teacher would mark it twice.

Permissions are enforced twice: here, from the projection, and again on the
desktop against the live account before anything is written. Tokens do not
cross roles — a staff token carries `role: 'staff'` and is refused by
`/portal/*`; a parent token has no role and is refused by `/staff/*`.

### The host serves the app as well as the API

Anything that is not `/api/*` on the desktop host is the **web app**: the
browser build of these same screens, on the same origin as the API. That is
deliberate — a browser on an HTTPS page cannot call a plain-HTTP LAN address at
all (mixed content), so a portal-hosted copy could never reach a desktop on the
school Wi-Fi, and a host-served one has no CORS or mixed-content problem to
solve. GET and HEAD only; the API keeps priority on every path.

## Building the React Native (Expo) client
1. **Connect screen:** choose **School Wi-Fi** (enter/scan the host URL, then
   `GET /info` to confirm and brand) or **Over the internet** (enter the portal
   URL, then `GET /portal/schools` to pick the school). Skipped entirely on the
   web, where the connection is discovered from the serving origin (above).
2. **Auth:** parent vs staff login; store the token in secure storage.
3. **Parent tabs:** Children → per-child fees/canteen/attendance/reports,
   Notifications, Pay (initiates a payment the host records + receipts).
4. **Staff tabs:** role-driven — Dashboard (with quick actions), Students,
   Debtors, Account. The dashboard surfaces **Take Attendance**, **Enter
   Scores**, and **Collect Canteen** actions based on `/me` permissions
   (`students`/`academics` edit, `academics` edit, `canteen` create), each
   opening a task screen that writes back to the host.
5. Keep all writes idempotent and queue them offline; reconcile to the host.

## Roadmap → multi-school website (SaaS)
LAN-first today, cloud-ready by design:

1. **Phase 1 (done):** embedded host API + parent identity + role scoping (LAN).
2. **Phase 2 (done):** off-LAN two ways — a secure tunnel (Cloudflare Tunnel /
   ngrok) reaches the host with full features, **and** the client's native
   **cloud mode** reaches the hosted portal directly (parent read model). See
   "Connection modes" above.
3. **Phase 3 — hosted portal (in progress):** a multi-tenant cloud service
   (`app.example.com/<school-slug>`), one tenant per school. Each desktop host
   pushes a **scoped, one-way snapshot** (balances, receipts, report cards,
   notices) to its tenant so parents/staff can read when the desktop is offline;
   writes queue and reconcile to the host. Node + Postgres backend, the same
   React client reskinned as the tenant portal, Stripe/Paystack subscriptions,
   per-school API key. Keeping this a separate cloud product isolates the
   security blast radius and uptime from the offline desktop core.
