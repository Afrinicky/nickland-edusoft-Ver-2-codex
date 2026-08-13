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
- **The mobile app and the cloud portal speak different API contracts** (`/api/v1/parent/*` vs `/api/v1/portal/*`), so the same mobile app cannot currently talk to the hosted cloud — only to the desktop host (directly or via a tunnel).

> **Update (this review branch):** the "results & attendance not in the cloud" gap that appeared in the first draft of this document was already closed in the codebase (commit `f410af3`): the `student_snapshot` read model carries the current-term attendance summary and academic report, and both cloud portal twins render them. This branch adds an end-to-end test that locks that round-trip in. The remaining cloud gap is therefore the **contract mismatch** above, plus read-model *depth* (single current term, summary-level only), not the presence of the data.

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

### 2.4 Web student portal (cloud) — **Good for reads (est. 65%)**

The hosted portal (`cloud/` Node service + `cloud/public/index.html`, and a Python twin in `cloud-python/`) implements parent login and serves each child's **fees & canteen balances, attendance summary, academic report (results), receipts, announcements, and profile edits**. The `student_snapshot` read model carries all of this (see `CLOUD_SYNC.md`), and both portal twins render attendance + performance cards.

Remaining gaps (not "the data is missing" — it's there):

- ~~**Contract mismatch**~~ — **closed on this branch.** The mobile app now speaks `/portal/*` in its internet mode and `/parent/*` in its LAN/tunnel mode, from one build (see §5 P0 #3).
- **Read-model depth:** the snapshot is current-term and summary-level (per-subject totals + grade, average, rank, remarks) — no historical terms and no per-assessment breakdown. Consistent with the "thin cloud" philosophy, but worth noting as a ceiling.
- **No SaaS control plane:** per-school onboarding and subscription billing aren't built, so this is infrastructure rather than a product yet.

---

## 3. Comparison to standard SMS feature baselines

Modules that mature commercial SMS products ship and this platform **does not yet have**:

| Module | Status | Why it matters (Nursery–JHS context) |
|---|---|---|
| **Timetable / scheduling** | ✅ Added (this branch) | School bell schedule + per-class weekly grid; desktop authoring, teacher "today/my week" on mobile, class timetable in the parent view. |
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
- **Sync robustness is good.** The outbox (monotonic versions, backoff→park, retention) is well-designed and now carries balances, receipts, attendance, results, announcements, and parent auth. Depth (history, per-assessment) is the remaining ceiling, not breadth (§2.4).
- **Security posture is reasonable** (bearer tokens hashed at rest, per-device revocation, HMAC webhooks, HTTPS-only cloud, rate-limited auth). Worth a formal review of: token/session expiry on the desktop, parent self-registration matching rules (impersonation risk), and RLS enforcement on the Neon tenant tables.
- **Multi-school / SaaS** is designed (per-tenant `school_id`, API keys) but the hosted product (billing, per-school onboarding, tenant admin) isn't built yet.
- **Accessibility & localisation** — single language/currency (GHS) assumed; fine for now, a ceiling for expansion.

---

## 5. Recommendations (prioritised)

### P0 — Make the pillars deliver what they promise
1. **Turn the teacher app into a working tool.** ✅ **Done on this branch.** Mobile screens + host endpoints now cover **attendance register**, **score entry**, and **canteen collection**, each permission-gated and reusing the desktop's own logic. (Lesson-note submission is the remaining nice-to-have.)
2. **Put results & attendance in the cloud read-model.** ✅ **Already in the codebase** (commit `f410af3`); this branch adds the end-to-end test that guards the round-trip. The web portal shows a child's results and attendance off-LAN today.
3. **Unify the client↔cloud contract.** ✅ **Done on this branch (cloud mode).** The mobile app now has two connection modes chosen at *Connect* time: **School Wi-Fi** (LAN/tunnel → the desktop host's `/parent/*` + `/staff` API, full features incl. payments) and **Over the internet** (pick a school → the hosted portal's `/portal/*` API, parent-only read + notices). The API client normalises the cloud `student_snapshot` into the same shapes the parent screens already use, so one build serves both. Staff and payments stay host-only by design (the cloud is a thin read model).

### P1 — Close the standard-SMS breadth gap
4. **Timetable module** ✅ **Done on this branch** — desktop authoring (bell schedule + per-class grid) with **Excel + PDF export**, teacher "today / my week" on mobile, the class timetable in the parent view, **and projected into the cloud snapshot so it shows off-LAN** (web portal + mobile cloud mode).
5. **Two-way messaging** (parent↔school threads, mirrored to SMS/email; the transport layer is already there).
6. **Homework/assignments** surfaced to parents.

### P2 — Differentiate & harden
7. **Library circulation, transport, online admissions, ID-card/certificate generation.**
8. **Test suite** for the desktop IPC + a security review (self-registration, session expiry, tenant RLS).
9. **SaaS control plane** (per-school onboarding, subscription billing) to make the hosted portal a product.

---

## 6. One-paragraph verdict

You have built an unusually strong **offline desktop core** — better than much of the local competition on money, payroll, and reporting. What's missing is the part your own description leans on hardest: the **mobile app as a tool teachers act through**, and a **cloud portal that carries results and attendance**, not just balances, to parents over the internet. Fix those two, unify the API contract, then fill the standard-SMS breadth gaps (timetable, messaging, homework), and this becomes a best-in-class package for its market.
