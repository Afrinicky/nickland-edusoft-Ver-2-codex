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

- ~~**The mobile teacher app is read-only.**~~ ~~Teachers now mark attendance, enter scores, collect canteen money and set homework.~~ **Closed.** The teacher app now carries the desktop's whole teacher surface — including the two that were still outstanding, lesson notes and continuous assessment — and it works over the internet with the school's computer switched off.
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

### 2.2 Mobile app — teacher side — **Strong (est. 90%)** ✅ *closed on this branch*

**Teachers do not get the desktop at all**, so this pillar is not a companion
to the product — for a teacher it *is* the product. It is now built that way:
fifteen screens where there were seven, and the desktop's teacher surface
reproduced rather than sampled.

| Core teacher duty | On desktop | On mobile / web |
|---|---|---|
| Take/mark class attendance | ✅ | ✅ + whole-class marking and 30 days of history |
| Enter exam scores | ✅ | ✅ |
| Enter continuous assessment (class work) | ✅ | ✅ — the half of a mark the report card actually carries |
| Broadsheet + report cards | ✅ | ✅ |
| End-of-term conduct & remarks | ✅ | ✅ (class teacher only) |
| Set homework | ✅ | ✅ |
| **Mark** homework | ✅ | ✅ on the school's own system; needs an assignment the desktop created |
| Write / submit lesson notes | ✅ | ✅ — the full form |
| A pupil's record + guardian contacts | ✅ | ✅ |
| Class roster | ✅ | ✅ searchable, and it opens a record |
| Their timetable, and a class grid | ✅ | ✅ |
| Canteen: collect, and the class sheet | ✅ | ✅ |
| Message parents | ✅ | ✅ two-way, mirrored to SMS/email |
| Post notices | ✅ | ✅ |
| Clock in/out, leave, payslips | ✅ | ✅ |

Remaining: taking a fee payment (receipt numbering) and structural
configuration (roles, terms, subjects, fee templates) stay on the desktop by
design.

### 2.3 Mobile app — parent side — **Good over LAN (est. 70%), thin over internet**

Over the LAN/tunnel to the host, the parent screens are genuinely useful: per-child **fees, canteen, attendance summary, academic performance/report, payment history**, and **make-a-payment** (manual + online gateway). This is the most complete of the three client experiences.

The limitation is off-LAN reach — see §2.4.

### 2.4 Web student portal (cloud) — **Good for reads (est. 65%)**

The hosted portal (`cloud/` Node service, and a Python twin in `cloud-python/`) implements parent login and serves each child's **fees & canteen balances, attendance summary, academic report (results), receipts, announcements, and profile edits**. The `student_snapshot` read model carries all of this (see `CLOUD_SYNC.md`), and both portal twins render attendance + performance cards.

> **Update (this branch): the portal front end is now the mobile app itself.** `mobile/` builds for the browser as well as for Android, so the third pillar is no longer a separate hand-written page that has to be kept in step with the app — it is the same eighteen screens, from the same source. The desktop host serves it over the school Wi-Fi (full features, teachers included, no internet needed) and the hosted portal serves it over HTTPS to parents, where it can be added to a phone's home screen. The old `public/index.html` is kept at `/legacy`. See [`WEB_APP.md`](WEB_APP.md).
>
> This changes the pillar-3 gap from "the portal is thinner than the app" to "the cloud API is thinner than the host API" — which is §2.4's remaining list below, and the teacher-over-internet gap in §2.2.

Remaining gaps (not "the data is missing" — it's there):

- ~~**Contract mismatch**~~ — **closed on this branch.** The mobile app now speaks `/portal/*` in its internet mode and `/parent/*` in its LAN/tunnel mode, from one build (see §5 P0 #3).
- ~~**No staff surface in the cloud**~~ — **closed on this branch.** `/api/v1/staff/*` carries teachers: staff auth (the desktop's own bcrypt hash, projected), a staff read model (class rosters with pupils, subjects, entered marks and recent registers; dashboard metrics; debtors; timetables), and registers, scores, canteen collections and homework queued through the existing change queue for the desktop to apply. **A teacher can now work with the school's computer switched off.** Queued-but-unapplied writes are merged over the read model so a teacher sees their own marks after a reload; permissions are re-checked against the live account before anything is written; and canteen collections carry a uuid the desktop de-duplicates on, so a redelivered batch cannot take the money twice. Still host-only, deliberately: taking a fee payment (receipt numbering) and marking homework (needs an assignment the desktop created).
- **Read-model depth:** the snapshot is current-term and summary-level (per-subject totals + grade, average, rank, remarks) — no historical terms and no per-assessment breakdown. Consistent with the "thin cloud" philosophy, but worth noting as a ceiling.
- **No SaaS control plane:** per-school onboarding and subscription billing aren't built, so this is infrastructure rather than a product yet.

---

## 3. Comparison to standard SMS feature baselines

Modules that mature commercial SMS products ship and this platform **does not yet have**:

| Module | Status | Why it matters (Nursery–JHS context) |
|---|---|---|
| **Timetable / scheduling** | ✅ Full | Lives in **Academics → Timetable**. Bell schedule + per-class weekly grid with Excel/PDF export; teacher "today/my week" on mobile; class timetable in the parent view and the cloud snapshot. |
| **Homework / assignments** | ✅ Full | Lives in **Academics → Homework**. Assignments carry a term, due date and optional **total marks**; graded homework is backed by an `assessment_columns` row so marks feed the weighted class score, subject total and end-of-term report. Marking sheet tracks submitted/late/not-submitted (not submitted scores 0). Parents see their child's own status + mark in-app and on the portal. |
| **Two-way communication / messaging** | ✅ Added (this branch) | Parent↔school threads: desktop Messages page, parent mobile tab, portal read view; staff replies mirror to SMS/email. (Parent-reply over the cloud portal is a noted follow-up; over LAN it's fully two-way.) |
| **Library circulation** | ❌ Absent | "Books" today is a fees item, not catalog + loans/returns. |
| **Transport / bus routes** | ✅ Full | **Transport** module: routes (driver/vehicle/capacity/fee), stops with pickup times, one-per-pupil assignment with fee override, and **termly fee collection posted to the finance ledger** (category `transport`, term-attributed, reconciled — added to the Finance Audit checks). Parent view + cloud snapshot carry the child's route/stop/balance. |
| **Online admissions / enquiry intake** | ❌ Absent | A public "apply/enquire" form feeding the admissions pipeline. |
| **Student ID cards & certificates** | ⚠️ Partial | Report cards print; no ID-card or certificate/testimonial generator. |
| **Behaviour / discipline log** | ⚠️ Thin | `welfare_records`/`student_events` exist but no dedicated conduct/incident workflow surfaced to parents. |
| **Health / clinic records (student)** | ⚠️ Thin | Staff medical exists; student clinic visits/immunisation not modelled. |
| **School calendar / events (parent-facing)** | ⚠️ Backend only | `school_calendar` exists but isn't surfaced in the portal/app. |
| **CBT / online exams / e-learning (LMS)** | ❌ Absent | Optional for this age range, but a differentiator. |

Modules where you **match or beat** the standard: payroll with statutory PAYE/SSNIT, canteen management, offline-first architecture, a real audit log, and centralised receipting — many competitors are weaker here.

---

## 4. Cross-cutting concerns

- **Testing — improving.** `test/regressions.js` now covers the core money/grades logic: the finance ledger (`postIncome` idempotency + term resolution, `reconcileLedger`), fees payment (bill balance math, receipt numbering, ledger posting, debtors), canteen collection, and score weighting. Writing these **caught three live bugs**: (1) `canteen_payments.daily_rate` was written but never created in the schema → canteen collection failed on any fresh database (fixed via migration 25); (2) `fees:debtors-report` selected non-existent columns (`total_amount`/`paid_amount`/`generated_date`) and threw every time it was opened (fixed); (3) the receipt-counter helpers across four modules (`getNextReceiptNumber`, plus bulk-pay/books/canteen) used an `UPDATE`-without-`INSERT` that silently no-ops if the counter row is missing, risking duplicate receipt numbers — now all route through one idempotent upsert (including `_ledger.nextCounter`, whose stuck counter would otherwise collapse every salary expense into one via the `transaction_number` de-dupe). **Payroll is covered too:** the Ghana PAYE bands + SSNIT rates are verified against hand-computed values, and `mark-paid` posts one linked expense per salary. `auth.js` now loads `bcryptjs` lazily so the `_security`-dependent surface is testable. The suite stands at **129 assertions** (plus 21 e2e + 14 portal); reports/exports remain to cover.
- **Sync robustness is good.** The outbox (monotonic versions, backoff→park, retention) is well-designed and now carries balances, receipts, attendance, results, announcements, and parent auth. Depth (history, per-assessment) is the remaining ceiling, not breadth (§2.4).
- **Security posture is reasonable** (bearer tokens hashed at rest, per-device revocation, HMAC webhooks, HTTPS-only cloud, rate-limited auth). Worth a formal review of: token/session expiry on the desktop, parent self-registration matching rules (impersonation risk), and RLS enforcement on the Neon tenant tables.
- **Multi-school / SaaS** is designed (per-tenant `school_id`, API keys) but the hosted product (billing, per-school onboarding, tenant admin) isn't built yet.
- **Accessibility & localisation** — single language/currency (GHS) assumed; fine for now, a ceiling for expansion.
- **One interface across three device classes** — the browser build lays itself
  out from the window width (bottom bar / rail / sidebar), so a 320px handset
  and a 24-inch monitor are the same bundle. Verified in Chromium at 390, 834
  and 1440 pixels: no console errors and no horizontal overflow on any screen.

---

## 5. Recommendations (prioritised)

### P0 — Make the pillars deliver what they promise
1. **Turn the teacher app into a working tool.** ✅ **Done.** Mobile and browser screens plus host and cloud endpoints now cover the whole teacher day: register and history, continuous assessment, exam marks, the broadsheet and report cards, homework set and marked, lesson notes, the canteen sheet, messages, notices, and the teacher's own clock-in, leave and payslips — each permission-gated, scope-gated, and reusing the desktop's own logic.
2. **Put results & attendance in the cloud read-model.** ✅ **Already in the codebase** (commit `f410af3`); this branch adds the end-to-end test that guards the round-trip. The web portal shows a child's results and attendance off-LAN today.
3. **Unify the client↔cloud contract.** ✅ **Done on this branch (cloud mode).** The mobile app now has two connection modes chosen at *Connect* time: **School Wi-Fi** (LAN/tunnel → the desktop host's `/parent/*` + `/staff` API, full features incl. payments) and **Over the internet** (pick a school → the hosted portal's `/portal/*` API, parent-only read + notices). The API client normalises the cloud `student_snapshot` into the same shapes the parent screens already use, so one build serves both. Staff and payments stay host-only by design (the cloud is a thin read model).

### P1 — Close the standard-SMS breadth gap
4. **Timetable module** ✅ **Done on this branch** — desktop authoring (bell schedule + per-class grid) with **Excel + PDF export**, teacher "today / my week" on mobile, the class timetable in the parent view, **and projected into the cloud snapshot so it shows off-LAN** (web portal + mobile cloud mode).
5. **Two-way messaging** ✅ **Done on this branch** — parent↔school threads with a desktop Messages page (staff), a parent mobile tab (compose/reply on LAN, read over the internet), and a portal read view; staff replies mirror to SMS/email. Follow-up: the portal/cloud **write** path so parents can reply over the internet (deferred to avoid cloud-authored snapshot version regressions).
6. **Homework/assignments** ✅ **Done on this branch** — teachers set homework per class+subject with a due date (desktop Homework page + mobile "Set Homework"); parents see upcoming homework in the mobile app and the portal (projected into the cloud snapshot). This clears the P1 list.

### P2 — Differentiate & harden
7. **Library circulation, transport, online admissions, ID-card/certificate generation.**
8. **Test suite** for the desktop IPC + a security review (self-registration, session expiry, tenant RLS).
9. **SaaS control plane** (per-school onboarding, subscription billing) to make the hosted portal a product.

---

## 6. One-paragraph verdict

You have built an unusually strong **offline desktop core** — better than much of the local competition on money, payroll, and reporting. What's missing is the part your own description leans on hardest: the **mobile app as a tool teachers act through**, and a **cloud portal that carries results and attendance**, not just balances, to parents over the internet. Fix those two, unify the API contract, then fill the standard-SMS breadth gaps (timetable, messaging, homework), and this becomes a best-in-class package for its market.
