# Nickland Edusoft — Cloud, Multi-School & Two-Database Sync

This captures the target architecture for the hosted, multi-school website and
how each school's **local SQLite** stays in step with the shared **cloud Neon
(Postgres)** database.

## Principles
- **Local-first.** Each school keeps running fully on its desktop SQLite even
  with no internet. The cloud is an *additive* mirror + a reach-anywhere portal,
  never a hard dependency for daily work.
- **Thin cloud (Neon holds as little as possible).** The **local SQLite is the
  durable holder of everyone's information** — students, staff, finance, scores,
  documents. Neon stores only what the portal/app actually needs to *serve a
  request when the desktop is offline*, and nothing more:
  - identity/link rows (parent ↔ student, device tokens) and per-school config;
  - **small, denormalised read snapshots** (a child's current balances, latest
    report summary, recent receipts/notices) that are overwritten on each sync
    and can be TTL-expired/pruned — not full history;
  - **in-flight transactions** (payment intents, portal edits) that pull down to
    the desktop and can be deleted from the cloud once reconciled.
  History, attachments, and the full dataset never need to live in Neon; the
  desktop keeps them and backs them up (see BACKUPS below). This keeps cloud
  storage — and cost — minimal, and doesn't change any established framework:
  the outbox just projects a thin view upward.

## Backups (schools own their data)
Because the local DB is the source of truth, robust backups matter more than a
fat cloud. The desktop supports **manual and automated** backups (Settings →
Backup): scheduled hourly/daily/weekly with retention, fanned out to the local
backups folder, an extra local/LAN/network folder, and a **cloud-sync folder**
(Google Drive Desktop / OneDrive / Dropbox — any drive of choice). This gives
off-site durability without putting the full dataset in Neon.
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

### Local additions (desktop side) — IMPLEMENTED
- `sync_outbox` table + `postToOutbox()` / `enqueueStudentSnapshot()`
  (`electron/server/sync/outbox.js`). Enqueue is a **no-op when cloud sync is
  off**, and collapses an unsynced duplicate of the same `(entity_type,
  entity_key)` so only the latest snapshot is kept. Each row carries a `uuid`
  as the cross-DB idempotency key (no need to add uuid to every table).
- Sync client (`electron/server/sync/client.js`): `push()` batches outbox rows,
  `pull()` applies whitelisted cloud changes and advances a cursor,
  `syncOnce()` for the timer. Authority-aware apply: parent profile is
  cloud-authoritative; school operational data is never overwritten from cloud.
- Control plane (`electron/ipc/cloud_sync.js`) + Settings → Cloud Sync:
  enable, URL/school-id/key, test, push/pull now, status; a 5-minute scheduler.
- The centralised payment path enqueues a `student_snapshot` + `receipt` on
  every payment (all channels), so the portal's read model stays fresh.

### Cloud API contract (the Neon portal implements this)
Authenticated with header `x-school-key`; all rows namespaced by `school_id`.
```
GET  /api/v1/sync/ping                       → { ok, school }
POST /api/v1/sync/push                        → { ok, accepted:[uuid…] }
     body { school_id, records:[{ uuid, entity_type, entity_key, op, version, payload }] }
     ingest is idempotent on (school_id, uuid); upserts the thin read model.
GET  /api/v1/sync/pull?since=<cursor>         → { ok, cursor, changes:[{ type, payload }] }
     returns cloud-origin changes (parent_update, student_contact_update, …).
```
`entity_type` values today: `student_snapshot` (balances read model),
`receipt`. Pull `type` values handled: `parent_update`,
`student_contact_update` (both field-whitelisted). Unknown types are ignored,
so the contract is forward-compatible.

### Cloud service — IMPLEMENTED (`cloud/`)
A runnable multi-tenant service implements the contract above: Node `http`, a
storage abstraction (**Neon/Postgres** when `DATABASE_URL` is set, in-memory
otherwise), per-school API-key auth, the `snapshots` thin read model + a
`cloud_changes` queue, and a tenant-provisioning script. It stays thin by
design — only the read model + change queue per school. An end-to-end test
boots the real service and the real desktop sync client together and verifies
push, the portal read endpoint, pull/reconcile, idempotency, and key
rejection. See `cloud/README.md`. The public website frontend (parent login +
child pages) is a separate app built against this same API.

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

## Student portal (web + mobile app)

The portal is named for the **student** — it shows a child's fees, results,
attendance, receipts and notices. The account holder is the **parent/guardian**
(login is a phone/email matched against the student's guardian contacts); for the
Nursery–JHS age range the responsible adult holds the account, not the pupil.
- Parents sign in (web or the React Native app) and open **their child's
  portal**: performance/report cards, fees & canteen balances, attendance,
  receipts, and announcements.
- Parents can **upload/update information** (contact details, documents) — these
  are cloud-origin writes that pull down and reconcile to the desktop under the
  authority rules above.
- Communications & notices flow both ways: school → parents (announcements,
  reminders) and parent → school (messages), surfaced in the portal and mirrored
  to notification channels.

## Sync mechanics (how the outbox actually behaves)

These are contracts, not implementation details — breaking one of them causes
silent data staleness rather than a visible error.

### Snapshot versions must increase forever, per entity
Both cloud stores drop an incoming snapshot whose `version` is **not greater**
than the one they already hold, so that a delayed retry can never regress the
read model. That means the desktop must never reuse or reset a version.

Versions therefore come from `sync_versions`, a per-`entity_key` counter that is
independent of the outbox rows themselves — so pruning synced rows cannot reset
it. `outbox.postToOutbox()` allocates the next value on every enqueue, including
when it collapses an un-synced duplicate.

> This is the shape of a bug that was live: `version` defaulted to `1` on each
> new outbox row and was only incremented when two edits collapsed into one
> un-synced row. After any collapse the cloud held version 2 while every later
> push arrived as version 1 and was silently discarded. The parent portal froze
> on a stale balance indefinitely, and the desktop reported each push as
> **accepted**. Covered by `test/regressions.js`.

### Failed records back off, then park
A push failure records the attempt and sets `next_attempt_at` on an increasing
backoff (1m → 5m → 15m → 1h → 3h → 6h, capped). After `MAX_ATTEMPTS` the record
is marked `dead = 1`: it stops being handed out, stops generating traffic, and
stops holding up the queue, but stays in the table for inspection. Records the
cloud accepts-with-omission (present in the batch, missing from `accepted`) are
treated as failures rather than being retried unconditionally every tick.

Settings → Cloud shows the parked count as **stuck**; **Push now** clears all
backoff and un-parks everything, which is the operator's retry after fixing a
cause. A newer edit for the same entity also re-arms its queued row.

### Retention
Synced outbox rows are pruned after 14 days (`cloud_outbox_retention_days`),
after each successful push and again in the daily maintenance sweep. Expired and
long-revoked mobile API tokens, and the `system_log` mirror, are trimmed in the
same sweep.

### Transport
The cloud base URL must be `https://` — the school API key and the projected
parent password hashes travel over it. Plain `http://` is refused except for
loopback, which is what the test suites use. Sync reports this as
`blocked: "insecure_url"` rather than failing per-request.

## Phasing
1. **Done:** local host API + parent identity + role scoping (LAN); Resend/Arkesel
   transport; centralised receipts on payment acknowledgment.
2. **Next:** `uuid` + `sync_outbox` on the desktop; the cloud ingest/pull API on
   Neon; per-school API keys.
3. **Then:** the multi-tenant website (per-school pages), online payment
   gateways (mobile money/bank) with webhooks, and the student web portal —
   sharing the same API contract the mobile app uses.
