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
| `staff` + admin | Proprietor / Super Admin | All staff modules; structural config stays desktop-only. |

Parents are a **separate identity** (`parents` table) linked to `students` via
`parent_students`. A parent self-registers only if their phone/email matches a
student's guardian contact on file; otherwise an admin provisions the account.

## Endpoints

### Public
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness + school name. |
| GET | `/info` | School identity + whether self-registration is on. `online_payments` is always `false`: no money moves through this API. |
| GET | `/branding` | The school's crest, name, motto, address and contact numbers — including the WhatsApp number every "Message the school" button leads to. Public on purpose: the sign-in screen shows a parent their own school before they type anything. Images travel as `data:` URIs (see `electron/server/media.js`). |
| POST | `/auth/signin` | **One sign-in box** `{ identifier, password, device }` → `{ role, token, … }`. Matches a staff username first, then a parent's phone or email. One message for both failures, so an outsider cannot learn which accounts are real. |
| POST | `/auth/login` | Staff login `{ username, password, device }` → `{ token }`. Kept for older clients. |
| POST | `/auth/parent/register` | Parent self-register `{ full_name, phone, email, password }` (must match a student). |
| POST | `/auth/parent/login` | Parent login `{ identifier (phone/email), password }`. |

### Authenticated (Bearer)
| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/me` | any | Current subject + scope/permissions. |
| POST | `/auth/logout` | any | Revoke the calling token. |
| GET | `/parent/children` | parent | Children with fee + canteen balances, the class teacher's name, and the child's photograph. |
| GET | `/parent/children/:id` | parent | One child: recent receipts, attendance summary. |
| GET | `/parent/children/:id/report` | parent | One term's report card — marks, summary, the grading scale they are read against, the term's attendance, and the school header a printed copy carries. `?termId=` for a past term. |
| GET | `/parent/children/:id/reports` | parent | Every term the school has published marks for, with its average and position. |
| GET | `/parent/children/:id/fees` | parent | The bill line by line, the carry-forward, the discount, the books, every receipt ever issued, and a term-by-term history. `?termId=` for a past term. |
| GET | `/parent/children/:id/canteen` | parent | Days paid, owed and excused, day by day, plus every collection recorded. |
| GET | `/parent/children/:id/attendance` | parent | The term's register, day by day, with totals. |
| GET | `/parent/children/:id/conduct` | parent | The conduct log the school keeps — commendations and incidents both. |
| GET | `/parent/children/:id/profile` | parent | The child's record, laid out for printing. |
| GET | `/parent/children/:id/settle` | parent | **Settles nothing.** The amounts owed and the school's contact details, so the app can open WhatsApp with the child, class, term and figures already written into the message. |
| GET | `/parent/notifications` | parent | The school's notices and the messages sent to the parent's contacts, merged and sorted. |
| GET | `/parent/children/:id/timetable` | parent | The child's class timetable (bell schedule + weekly grid). |
| GET | `/parent/messages` | parent | The parent's message threads with the school. |
| GET | `/parent/messages/:id` | parent | One thread with its messages (marks it read for the parent). |
| POST | `/parent/messages` | parent | `{ threadId?, studentId?, subject?, body }` — start or continue a thread. |
| GET | `/parent/children/:id/homework` | parent | The child's class homework (upcoming + recently due). |
| GET | `/parent/children/:id/transport` | parent | The child's bus route, stop, pickup time and transport-fee balance. |

### Staff — teaching
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/classes` | The classes this teacher may open, each flagged `is_class_teacher`. |
| GET | `/subjects?classId=` | Subjects — narrowed to what they teach in that class. |
| GET | `/terms` | Terms, most recent first. |
| GET | `/students?classId=&q=` | The roll, scoped to their classes, searchable. |
| GET | `/students/:id` | A pupil's record: guardians, attendance, marks, homework, and fees/canteen where the account may see money. |
| GET | `/students/:id/parents` | Parent accounts linked to a pupil, for starting a conversation. |
| GET | `/attendance?classId=&date=` | The register for a day. |
| POST | `/attendance` | Save it. A batch reaching outside the teacher's classes is refused whole. |
| GET | `/attendance/history?classId=&days=` | Day-by-day totals and per-pupil absences. |
| GET | `/scores/subjects?classId=` | Subjects with score entry open to this teacher. |
| GET | `/scores?classId=&subjectId=` | Exam marks for a class + subject. |
| POST | `/scores` | Save raw exam marks (0–100). |
| GET | `/assessments?classId=&subjectId=` | Continuous assessment: the term's columns, the marks in them, and the weighting. |
| POST | `/assessments/column` | Add an assignment / test / quiz with its own total. |
| POST | `/assessments` | Save class-work marks; the weighted class score is recomputed through the desktop's own function. |
| GET | `/results?classId=&termId=` | The broadsheet — every pupil against every subject, with average and position. |
| GET | `/results/student/:id` | One pupil's terminal report, with the grading bands. |
| POST | `/results/remarks` | Conduct, interests, talents and the class teacher's remark. **Class teacher only.** |
| GET | `/homework?classId=&all=` | Homework set for a class. |
| POST | `/homework` | Set homework; give it marks and it feeds the class score. |
| GET | `/homework/:id/sheet` | The marking sheet. |
| POST | `/homework/:id/marks` | Save who handed in what, and their marks. |
| DELETE | `/homework/:id` | Withdraw an assignment (and the marks that hung off it). |
| GET | `/lesson-notes?status=&classId=` | The teacher's own lesson notes. |
| GET | `/lesson-notes/:id` | One note in full. |
| POST | `/lesson-notes` | Write or edit one; `status: 'submitted'` sends it for review. An approved note is no longer theirs to change. |
| DELETE | `/lesson-notes/:id` | Delete a note that has not been approved. |
| GET | `/timetable/mine` | Their own week, today first. |
| GET | `/timetable/class/:id` | A class grid, for a class they teach. |
| GET | `/canteen/student/:id` | One pupil's canteen balance. |
| POST | `/canteen/collect` | Take canteen money and issue a receipt. |
| GET | `/canteen/class?classId=` | The morning sheet: who owes, and how much. **Class teacher only.** |

### Staff — talking to parents
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/messages` | Every parent↔school thread, with the unread count. |
| GET | `/messages/:id` | One thread (and marks it read for staff). |
| POST | `/messages` | Reply or start a thread; mirrored to the parent's SMS or email. |
| GET | `/announcements` | Active notices. |
| POST | `/announcements` | Post one (needs `notifications` → Manage). |

### Staff — the office

The browser app is the desktop application now, so the school's own server has
to answer for the whole office and not only for the teaching day. These are the
routes that used to live behind an IPC handler on the one PC in the office
(`electron/server/office_api.js`), and they are the same operations the online
school performs (`cloud-python/app/school/*.py`) against SQLite instead of
Postgres, so the two answer the same shapes.

Every one of them names its module and its action and is refused by the same
`can()` the rest of the API uses. **None of them is a bridge to an arbitrary
IPC channel** — that would be a hole in the middle of the access system,
however convenient.

| Method | Path | Needs | Purpose |
|--------|------|-------|---------|
| GET/POST | `/fees/templates`, `/fees/templates/:id` | `fees` / `fees:edit` | The bill a class is charged, and its line items. A second school-fees template for the same class and term is refused. |
| POST | `/fees/bills` | `fees:create` | Raise the bills for a whole class from its template — arrears carried forward, discounts applied, anybody already billed skipped. |
| GET/POST | `/discounts` | `fees` / **elevated** | Who has been forgiven what, and by whom. Granting one needs the Proprietor or the Super Admin: a bursar with Fees at Full may take money and may not forgive it. |
| GET/POST | `/books/:id`, `/books/:id/payment` | `fees` / `fees:edit`, `fees:create` | Book charges against a pupil, and paying them off. |
| GET/POST | `/inventory`, `/inventory/movement`, `/inventory/movements` | `finance` | The store room: items, stock in and out, and every movement logged. Issuing more than is on the books is refused with the figure that is. |
| GET/POST | `/transport`, `/transport/:id`, `/transport/riders`, `/transport/payment` | `finance` | Routes, who rides them and what they owe. Assigning a pupil again moves them; nobody is ever on two buses. |
| GET | `/canteen/debtors` | `canteen` | Canteen arrears at the rate the school set. |
| GET | `/admin/staff-register` | `staff` | Who is in today. |
| GET/POST | `/activities`, `/activities/:id/acknowledge` | `staff` | Staff activities and duties, and acknowledging one. |
| POST | `/payroll/run`, `/payroll/:id/paid` | `payroll:create`, `payroll:edit` | Run the month, and mark a salary paid. |
| GET | `/payroll/schedule/ssnit\|paye` | `payroll` | The two statutory schedules a school files monthly. |
| GET | `/payroll/:staffId/payslip` | own, or `payroll` | **A person may always read their own payslip**, whatever their modules say. Anybody else's needs payroll. |
| POST | `/finance/income`, `/finance/expenses/:id/approve` | `finance:create`, `finance:edit` | Money in, and approving money out — never your own. |
| GET | `/finance/audit`, `/finance/cashbook` | `finance` | Receipts against the ledger, and both sides in date order. |
| GET/POST | `/budgets` | `finance` | The term's budget and how it is running. |
| GET/POST | `/notifications`, `/announcements/:id/withdraw` | `notifications` / `notifications:create` | The notice board, the SMS sender and the log of what was sent. |
| POST | `/system/users/:id/password` | Super Admin | Set an account's password. |
| GET/POST | `/timetable/periods`, `/timetable/class` | `academics` / `academics:edit` | The bell schedule, and a class's whole week saved in one act. |
| GET/POST | `/exams/papers`, `/exams/sections`, `/exams/questions`, `/exams/papers/:id/from-bank` | `academics` / `academics:edit` | Question papers, their sections and questions, and copying from the bank. |
| POST | `/admin/students/:id` | `students:edit` | Correct a pupil's record — the students sheet. The admission number is not the sheet's to change. |

The gate on these is the **module**, not a portal. The app hands out modules the
way the desktop always has, so somebody holding Students at Manage is shown
Students and the sheet inside it whether or not they also hold the staff
register — and a portal check here would refuse the very screen the module
system just drew for them.

### Staff — their own employment
Everything under `/hr` is about the signed-in person and nobody else. There is
no `staffId` parameter anywhere in it by design: the token decides whose
payslip this is, so no amount of guessing at ids reaches a colleague's.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/hr/me` | Their staff record, teaching assignments, and today's clock-in. |
| POST | `/hr/clock` | `{ direction: 'in' \| 'out' }`. Clocking in twice does not move the first stamp. |
| GET | `/hr/attendance?month=&year=` | Their own month of clock-ins. |
| GET | `/hr/leave` | Their leave requests and how each was decided. |
| POST | `/hr/leave` | Ask for leave; the days are counted from the dates. |
| GET | `/hr/payslips?year=` | **Paid** months only — an unpaid draft row is the school's working figure, not a statement of what anyone is owed. |

### Scope — whose class

Permissions answer "may this account edit scores at all". Scope answers the
question straight after: **whose**. It is resolved from `staff_assignments` by
`electron/ipc/_scope.js` — the same resolver the desktop uses — and applied to
every staff route above.

| Assignment | What it grants |
|---|---|
| Class, no subject | The whole class — every subject in it |
| Class + subject | That subject in that class, nothing else in it |
| Subject, no class | That subject in every class that teaches it |

The register, the canteen sheet and the end-of-term remarks belong to the one
teacher answerable for the class (`is_class_teacher`), not to everyone who
takes a subject in it. Proprietors, Super Admins and Head Teachers are
unrestricted as to *which* class; money and system modules are still theirs
only if the school granted them.

A pupil outside a teacher's scope answers **404, not 403** — which pupils are
in another class is not theirs to learn either.

### No money moves through this API
There is no checkout, no payment form and no gateway webhook. The card /
mobile-money checkout, the "tell the school what you paid" intent form, the
verification pull and `POST /webhooks/paystack` were all removed, routes
included — a request to any of them answers 404, and `/info` reports
`online_payments: false` so an older client is told plainly.

A parent sees the balance, the itemised bill and every receipt the school has
issued. Settling it is arranged with the school: `GET
/parent/children/:id/settle` returns the figures and the contact details, and
the app turns that into a pre-written WhatsApp message. A school takes payment
at the office or on WhatsApp with the bursar, which is how these schools work
and which nothing typed into a phone can fake.

Cash the school takes **in person** is unaffected — the canteen collection
below is real money handed over at the gate and recorded exactly as the desktop
records it.
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
| GET | `/canteen/quick-pay?classId=&date=` | staff (`canteen.view`, class teacher) | The class for one day: who has paid, who is excused, who was marked absent, the daily rate, and whether the calendar calls it a school day. |
| POST | `/canteen/quick-pay` | staff (`canteen.create`, class teacher) | `{ classId, date, studentIds[], paymentMethod }` — the desktop's own `markBulkPaid`, so the ledger entry, term attribution and daily rate are identical either way. A day already settled is skipped, so a second tap cannot charge the same child twice. |
| POST | `/canteen/exempt` | staff (`canteen.edit`, class teacher) | `{ classId, date, studentIds[], reason }` — excuse the absent. A day already paid for is left as it is rather than stranding a payment row. |
| GET | `/classes/:id/contacts` | staff (`notifications.view`) | The whole class's guardian contacts and any registered parent accounts, in one request, so a teacher can ring or message from the roll. |
| GET | `/students/:id/events` | staff (`students.view`) | The pupil's conduct log — commendations, incidents, notes and health entries — plus `can_write`. |
| POST | `/students/:id/events` | staff (`students.edit`, class teacher) | `{ eventType, title, description?, date? }`. Writes to the same `student_events` table the desktop has used since the first release; the pupil's parent sees the entry immediately. |
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
| **host** (the school itself — its Wi-Fi address or a tunnel) | the desktop | `http(s)://<address>/api/v1` — `/auth/*`, `/parent/*`, staff routes | parents **and** staff | everything, immediately: attendance, scores, the daily canteen collection, homework marking, the class contact book |
| **cloud** (Online) | the hosted service | `https://<portal>/api/v1` — `/portal/*` for parents, `/staff/*` for teachers | parents **and** staff | parents read; teachers queue attendance, scores, canteen and homework for the desktop to apply |

In cloud mode the client picks a school from `GET /portal/schools` (or from
`GET /info`), then signs in as a parent via `POST /portal/login`
(`{ school_id, identifier, password }`) or as a teacher via
`POST /staff/login` (`{ school_id, username, password }`).

The API client (`mobile/src/api.js`) **normalises** cloud replies into the same
shapes the host's routes return, so no screen knows which mode it is in. A
staff route that is `/attendance` on the desktop is `/staff/attendance` on the
cloud, and one helper picks between them.

Host-only, and they say so rather than failing: **the daily canteen
collection** (it reads the register live and takes real money), **the class
contact book** (guardian numbers are not projected over the internet),
**marking homework** (it needs an assignment id that only exists once the
desktop has created the assignment) and **a pupil's full profile**. Over the
internet a parent still sees the totals, the receipts the portal was given and
the current term's report; the screens say which parts are the school's last
sync rather than showing an empty table pretending to be complete.

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
3. **Parent tabs:** Children → per-child overview, academics, report cards
   (this term and past terms, with the trend), register, itemised fees and
   payment history, canteen, homework and timetable; Notices; Messages;
   Account. Settling a balance opens the school's WhatsApp — no payment is
   taken in the app.
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
