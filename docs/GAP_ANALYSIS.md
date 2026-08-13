# Nickland Edusoft — Platform Gap Analysis

**Reviewed:** 2026-08-13 · **Against:** the stated product vision + standard school-management-software (SMS) feature baselines.

Your vision has three pillars:

1. **PC installer** — a Windows app that runs as a local host and does everything a school office needs.
2. **Mobile app** — teachers use it over the LAN to *do their work*; parents use the same app over the internet to see their ward's info.
3. **Web student portal** — parents access their ward's info from a browser.

This document rates each pillar honestly, lists the gaps, and recommends what to build to reach "best-in-class."

---

## 1. Executive summary

The **desktop (PC host) is genuinely strong** — it already exceeds many commercial Ghanaian SMS products in finance, payroll (PAYE/SSNIT), fees, canteen, and terminal-report depth. The offline-first, local-SQLite-as-source-of-truth design is the right architecture for the market.

The **two mobile/web pillars are the weak points**, and one of them is weak *against your own description*:

- **The mobile teacher app is read-only.** Teachers can view a dashboard, a student roster, and a debtor list — and nothing else. They cannot take attendance, enter scores, write lesson notes, or message anyone from the phone. Your description says the app is "used by teachers to perform their duties." Today it is used by teachers to *watch*, not to *perform*.
- **The web/cloud portal is thinner than the docs imply.** Over the internet, parents see fees balances, receipts, and announcements only. Academic **results and attendance are not synced to the cloud**, so the "access their ward's info" promise is only fully met while the phone is on the school LAN.
- **The mobile app and the cloud portal speak different API contracts** (`/api/v1/parent/*` vs `/api/v1/portal/*`), so the same mobile app cannot currently talk to the hosted cloud — only to the desktop host (directly or via a tunnel).

Everything else below is the standard-SMS feature comparison.

---

## 2. Pillar-by-pillar assessment

### 2.1 PC installer / local host — **Strong (est. 85%)**

Implemented and solid:

- **Students:** admissions, profiles, class history, attendance register, bulk sheet editing, status lifecycle, en-masse **promotion**.
- **Academics:** subjects, class→subject mapping, assessment columns/compilation, exam papers/questions/sections, class & exam scores, grading bands, **end-of-term report cards** with live position / number-on-roll / conduct & remarks.
- **Fees:** templates, bills & line items, discounts, debtors, books, bulk pay, mobile-money capture.
- **Finance:** income, expenses, budgets, financial statements, balancing, audit tab — with a centralised **ledger** choke point.
- **Payroll/HR:** salaries, payroll runs, **PAYE & SSNIT schedules**, leave, staff attendance, documents, medical, performance, training, activities.
- **Canteen, Inventory, Receipts engine, Notifications** (SMS via Arkesel, email via Resend/SMTP), **Audit log**, role/designation **permission matrix**, backups (scheduled + cloud-folder fan-out), and a cloud-sync outbox.

Gaps at the desktop layer are **feature-breadth** items covered in §3.

### 2.2 Mobile app — teacher side — **Weak (est. 25%)** ⚠️ biggest gap vs. your vision

The teacher app has exactly four tabs: **Dashboard, Students, Debtors, Account** — all read-only.

| Core teacher duty | On desktop | On mobile |
|---|---|---|
| Take/mark class attendance | ✅ | ❌ (host endpoint `POST /attendance` exists but **no screen calls it**) |
| Enter / submit scores & grades | ✅ | ❌ (**no endpoint, no screen**) |
| Write / submit lesson notes | ✅ | ❌ |
| View class roster | ✅ | ✅ (read-only) |
| View their timetable / schedule | ❌ (no module) | ❌ |
| Message / notify parents | ✅ (broadcast) | ❌ |
| Request leave / view payslip | ✅ | ❌ |

**This is the headline gap.** The endpoint plumbing for attendance already exists on the host but is unused; scores have no plumbing at all.

### 2.3 Mobile app — parent side — **Good over LAN (est. 70%), thin over internet**

Over the LAN/tunnel to the host, the parent screens are genuinely useful: per-child **fees, canteen, attendance summary, academic performance/report, payment history**, and **make-a-payment** (manual + online gateway). This is the most complete of the three client experiences.

The limitation is off-LAN reach — see §2.4.

### 2.4 Web student portal (cloud) — **Partial (est. 45%)**

The hosted portal (`cloud/` Node service + `cloud/public/index.html`, and a Python twin in `cloud-python/`) implements parent login and serves **children balances, receipts, announcements, and profile edits**. But the desktop sync outbox only projects two entity types — `student_snapshot` (balances) and `receipt`.

Consequences:

- **Results / report cards are not in the cloud read-model.** Parents on the internet cannot see grades when the desktop is offline, even though `CLOUD_SYNC.md` lists "report cards" as a portal feature.
- **Attendance is not in the cloud read-model** either.
- **Contract mismatch:** the mobile client calls `/api/v1/parent/*`; the cloud exposes `/api/v1/portal/*`. The "same client reaches the host over the internet" only holds via a **tunnel to the desktop**, not via the hosted cloud. The two need a unified contract or an adapter.

---

## 3. Comparison to standard SMS feature baselines

Modules that mature commercial SMS products ship and this platform **does not yet have**:

| Module | Status | Why it matters (Nursery–JHS context) |
|---|---|---|
| **Timetable / scheduling** | ❌ Absent | Class & teacher timetables are table-stakes; also unlocks a teacher "today's periods" mobile view. |
| **Homework / assignments** | ❌ Absent (only lesson notes) | Parents increasingly expect to see assignments & due dates. |
| **Two-way communication / messaging** | ❌ Outbound only | Notifications are one-way (SMS/email out). No parent↔school inbox/chat/threads. |
| **Library circulation** | ❌ Absent | "Books" today is a fees item, not catalog + loans/returns. |
| **Transport / bus routes** | ❌ Absent | Common add-on; route, stop, and pickup tracking. |
| **Online admissions / enquiry intake** | ❌ Absent | A public "apply/enquire" form feeding the admissions pipeline. |
| **Student ID cards & certificates** | ⚠️ Partial | Report cards print; no ID-card or certificate/testimonial generator. |
| **Behaviour / discipline log** | ⚠️ Thin | `welfare_records`/`student_events` exist but no dedicated conduct/incident workflow surfaced to parents. |
| **Health / clinic records (student)** | ⚠️ Thin | Staff medical exists; student clinic visits/immunisation not modelled. |
| **School calendar / events (parent-facing)** | ⚠️ Backend only | `school_calendar` exists but isn't surfaced in the portal/app. |
| **CBT / online exams / e-learning (LMS)** | ❌ Absent | Optional for this age range, but a differentiator. |

Modules where you **match or beat** the standard: payroll with statutory PAYE/SSNIT, canteen management, offline-first architecture, a real audit log, and centralised receipting — many competitors are weaker here.

---

## 4. Cross-cutting concerns

- **Testing is very thin.** One `test/regressions.js` (guarding the sync-version bug) plus cloud portal/e2e tests. The large desktop IPC surface (40+ handlers, a 1,656-line schema) has no unit/integration coverage — risky for a product schools depend on for money and grades.
- **Sync robustness is good but narrow.** The outbox (monotonic versions, backoff→park, retention) is well-designed; it just carries too few entity types (§2.4).
- **Security posture is reasonable** (bearer tokens hashed at rest, per-device revocation, HMAC webhooks, HTTPS-only cloud, rate-limited auth). Worth a formal review of: token/session expiry on the desktop, parent self-registration matching rules (impersonation risk), and RLS enforcement on the Neon tenant tables.
- **Multi-school / SaaS** is designed (per-tenant `school_id`, API keys) but the hosted product (billing, per-school onboarding, tenant admin) isn't built yet.
- **Accessibility & localisation** — single language/currency (GHS) assumed; fine for now, a ceiling for expansion.

---

## 5. Recommendations (prioritised)

### P0 — Make the pillars deliver what they promise
1. **Turn the teacher app into a working tool.** Add mobile screens + host endpoints for: **attendance marking** (endpoint already exists — wire a screen), **score/grade entry** (new endpoint), and **lesson-note submission**. This closes the single biggest gap against your own description.
2. **Put results & attendance in the cloud read-model.** Extend the outbox to project `report_summary` and `attendance_summary` snapshots so the web/mobile parent experience is complete off-LAN.
3. **Unify the client↔cloud contract.** Either have the cloud implement `/api/v1/parent/*`, or add a thin adapter, so the *same* mobile app works over LAN, tunnel, and hosted cloud without a rebuild.

### P1 — Close the standard-SMS breadth gap
4. **Timetable module** (desktop authoring + "today's periods" on teacher mobile + parent view).
5. **Two-way messaging** (parent↔school threads, mirrored to SMS/email; the transport layer is already there).
6. **Homework/assignments** surfaced to parents.

### P2 — Differentiate & harden
7. **Library circulation, transport, online admissions, ID-card/certificate generation.**
8. **Test suite** for the desktop IPC + a security review (self-registration, session expiry, tenant RLS).
9. **SaaS control plane** (per-school onboarding, subscription billing) to make the hosted portal a product.

---

## 6. One-paragraph verdict

You have built an unusually strong **offline desktop core** — better than much of the local competition on money, payroll, and reporting. What's missing is the part your own description leans on hardest: the **mobile app as a tool teachers act through**, and a **cloud portal that carries results and attendance**, not just balances, to parents over the internet. Fix those two, unify the API contract, then fill the standard-SMS breadth gaps (timetable, messaging, homework), and this becomes a best-in-class package for its market.
