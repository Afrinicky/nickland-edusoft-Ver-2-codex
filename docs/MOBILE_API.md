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
persisted in secure storage (`mode` = `host` | `cloud`):

| Mode | Reaches | Base + routes | Audience | Writes |
|------|---------|---------------|----------|--------|
| **host** (School Wi-Fi / tunnel) | the desktop host | `http://<ip>:4747/api/v1` — `/auth/*`, `/parent/*`, staff routes | parents **and** staff | full: attendance, scores, canteen, payments |
| **cloud** (Over the internet) | the hosted portal | `https://<portal>/api/v1` — `/portal/*` | parents only | read + profile/notices (thin cloud) |

In cloud mode the client picks a school from `GET /portal/schools`, signs in via
`POST /portal/login` (`{ school_id, identifier, password }`), and reads
`GET /portal/children|receipts|announcements|me`. The API client
(`mobile/src/api.js`) **normalises** the cloud `student_snapshot` (which already
carries fees, canteen, attendance and the academic report) into the same shapes
the host's `/parent/*` replies use, so the parent screens are identical across
modes. Staff and payments are intentionally host-only — the cloud is a read
model, so those controls are hidden when connected over the internet.

## Building the React Native (Expo) client
1. **Connect screen:** choose **School Wi-Fi** (enter/scan the host URL, then
   `GET /info` to confirm and brand) or **Over the internet** (enter the portal
   URL, then `GET /portal/schools` to pick the school).
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
