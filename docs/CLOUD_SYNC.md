# Nickland Edusoft — Cloud, Multi-School & Two-Database Sync

This captures the target architecture for the hosted, multi-school website and
how each school's **local SQLite** stays in step with the shared **cloud Neon
(Postgres)** database.

## Principles
- **Local-first.** Each school keeps running fully on its desktop SQLite even
  with no internet. The cloud is an *additive* mirror + a reach-anywhere portal,
  never a hard dependency for daily work.
- **Single source of truth per data class**, not per row globally:
  - *School operational data* (students, bills, payments, scores, attendance,
    staff, finance) → **desktop SQLite is authoritative**.
  - *Parent/portal-originated data* (profile edits, messages, online payment
    intents) → **cloud is where it's captured**, then pulled down and reconciled.
- **Every synced entity carries a stable `uuid`** (the app already depends on
  `uuid`). The uuid is the shared key across both databases, so local integer
  ids never need to match cloud ids.

## Tenancy (Neon)
- One Postgres database, **one tenant per school** keyed by `school_id`.
- All tenant tables carry `school_id`; enforce isolation with Postgres
  **row-level security** (RLS) plus app-level scoping. Each desktop authenticates
  to its tenant with a per-school **API key** (rotatable).
- Neon's serverless/branching suits this well: a branch per environment, and it
  scales to zero between bursts (schools sync intermittently).

## Sync mechanism — outbox + pull cursor
```
Desktop (SQLite, authoritative for school data)          Cloud (Neon, per-tenant)
 ── writes ──► sync_outbox (append every change) ── push ──► ingest (idempotent by uuid+version)
 apply ◄── reconcile ◄── pull (GET /sync/pull?since=cursor) ◄── parent-side changes / payment confirmations
```
1. **Change capture (outbox).** Every meaningful local write also appends to a
   `sync_outbox` row: `{ uuid, entity_type, op, payload_json, version, created_at, synced_at }`.
   This is the same discipline as the finance ledger — one choke point, not
   scattered writes.
2. **Push.** A background worker (opportunistic: on connectivity, on interval,
   on demand) sends unsynced outbox rows to `POST /sync/push` with the school
   API key. Ingest is **idempotent** on `(school_id, uuid, version)` so retries
   never duplicate.
3. **Pull.** The desktop calls `GET /sync/pull?since=<cursor>` for cloud-origin
   changes (parent profile edits, messages, online payment intents/confirmations),
   applies them locally, and advances a stored cursor.
4. **Conflict resolution.** Authority rule first (school data → local wins;
   parent data → cloud wins), then last-write-wins by timestamp as a tie-break,
   with every override written to `audit_log`.
5. **Read-model snapshots.** For the portal's read-heavy views (balances,
   receipts, report cards), push *denormalised documents* so the website reads
   fast without live joins and works while the desktop is offline.

### Local additions (desktop side)
- `sync_outbox` table + a `postToOutbox(db, entity, op, payload)` helper the
  write paths call (mirrors `_ledger.postIncome`).
- `uuid` column on synced entities (students, payments, receipts, scores, …).
- A `sync` IPC/worker with status in Settings → Mobile/Cloud.

## Notifications (Resend + Arkesel)
The transport layer (`electron/ipc/_transport.js`) already abstracts this:
- **SMS:** Arkesel (or equivalent) via HTTP.
- **Email:** provider-selectable — **Resend** (HTTP API) or SMTP. Set
  `email_provider = resend`, `resend_api_key`, and a verified `email_from`.
- **What gets sent:** fee receipts, terminal reports, bills, reminders,
  announcements, and any other notice — to **parents/guardians, teachers, and
  staff**.
- **Who sends:** whichever tier observes the event. Office/bank-deposit payments
  are acknowledged on the desktop → the desktop sends. Portal/mobile-money
  payments are confirmed in the cloud → the cloud sends via Resend/Arkesel.

## Payments → receipt, regardless of channel
Parents may pay by **mobile money / bank transfer (electronic)**, **at the
school's accounts office**, or by **bank deposit with a slip brought in**. In
every case the rule is the same and already centralised:

> The moment a payment is acknowledged — manually by the accountant or
> automatically by a gateway/webhook — the ledger post (`_ledger.postIncome`)
> triggers a receipt (`receipts_engine`) and auto-delivery (`autoDeliverReceipt`)
> to the parent's SMS/email.

- **Electronic:** gateway webhook (cloud) → `payment_intent` → pulls to desktop
  → accountant/auto acknowledges → local payment + receipt + notify → push
  confirmation back to cloud.
- **Office / bank deposit:** recorded on desktop → receipt + notify immediately
  → outbox pushes the receipt to the cloud portal.

Because receipt + notification hang off the single ledger-post event, no channel
is a special case.

## Parent portal (web + mobile app)
- Parents sign in (web or the React Native app) and open **their child's
  portal**: performance/report cards, fees & canteen balances, attendance,
  receipts, and announcements.
- Parents can **upload/update information** (contact details, documents) — these
  are cloud-origin writes that pull down and reconcile to the desktop under the
  authority rules above.
- Communications & notices flow both ways: school → parents (announcements,
  reminders) and parent → school (messages), surfaced in the portal and mirrored
  to notification channels.

## Phasing
1. **Done:** local host API + parent identity + role scoping (LAN); Resend/Arkesel
   transport; centralised receipts on payment acknowledgment.
2. **Next:** `uuid` + `sync_outbox` on the desktop; the cloud ingest/pull API on
   Neon; per-school API keys.
3. **Then:** the multi-tenant website (per-school pages), online payment
   gateways (mobile money/bank) with webhooks, and the parent web portal —
   sharing the same API contract the mobile app uses.
