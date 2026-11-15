# Nickland EduSoft — Technical Audit & Implementation Plan

**Repository:** `Afrinicky/nickland-edusoft-Ver-2-codex` · branch `ccr-fb3496ac-zk2wiq`
**Audit date:** 2026-11-15 · **Scope:** full repository (632 tracked files)
**Status:** audit presented; architecture decided (§0). Phase 0 (baseline) in progress. No application code modified.

---

## 0. Decisions taken

| # | Decision | Consequence |
|---|---|---|
| D1 | **Cloudflare Containers** carry the API | Existing images run unchanged. No Workers rewrite. `worker_threads`, `SharedArrayBuffer`, `psycopg` and `bcrypt` all keep working. |
| D2 | **`host/server.js` on Neon is the cloud system of record** for school operations; **`cloud-python` remains the platform layer** (public site, Superadmin console, billing, subscriptions, licence signing, seals, device seats) | 93% channel coverage on day one. One implementation of every business rule. `docs/DESK_COVERAGE.md`'s 243 `not yet` channels become irrelevant to the office application. |
| D3 | **Per-module conflict authority** | Finance is always cloud-authoritative — money has one ledger. Attendance, marks and remarks are authoritative where they were entered, settled per field by the existing three-way rule, with losers recorded in `sync_conflicts`. |
| D4 | **No school is live on the cloud** | Phase 2 is a clean additive migration. No reconciliation of two integer-id sets. Lowest-risk path. |
| D5 | **Under 50 schools, under 10 concurrent staff** | **One container per school.** `host/db/worker.js`'s blocking `Atomics.wait` adapter stays exactly as written, and `host/db/cache.js` stays exact, because each school keeps precisely one writer. Gap **G6 is resolved by topology rather than by code** — the single most valuable consequence of D1 + D2 + D5. |
| D6 | **Always warm** | No cold starts. Each enrolled school's container runs continuously. Cost is predictable and scales with enrolment, not usage. |
| D7 | **Move Neon closer to Ghana**, measured before committing | Latency work, not correctness work. Every query blocks the host for one round trip, so region is a first-order performance decision. Frankfurt is the current baseline to beat. |

**What D1+D2+D5 together mean:** the hardest problem in the original brief — making the cloud primary without rewriting 22,000 lines of handlers or maintaining two implementations of "take a payment" — is solved by running the installer's own code, one container per school, with the existing synchronous Neon adapter untouched. The remaining work is identity, journalling and the sync engine, not a port.

---

## 1. Executive summary

Six findings determine everything that follows.

**1. The cloud is already two different clouds, and neither is currently the system of record.**
`cloud-python/` (FastAPI, Render, Neon) holds a *full* copy of a school — 82 tables in a dedicated Postgres schema per school — but its office-application surface answers only **107 of 408 channels (26%)**. `host/server.js` runs the **installer's own handlers** against Neon through a better-sqlite3-shaped adapter and answers **381 of 408 (93%)** — but it is pinned to **one instance, one school per deployment**. Making the cloud primary is a choice between these two, and that choice is the largest single decision in the project.

**2. The existing synchronisation is not replication, and it is not reversible.**
Upward it pushes **17 read-model projections** (`student_snapshot`, `receipt`, `debtor_list`, …) that are *overwrite-on-sync snapshots*, collapsed to one row per entity key. Downward it applies **17 named change types** (`score_entry`, `attendance_mark`, `fee_payment`, …) through a permission-rechecking applier. The downward path is a real, idempotent, conflict-aware transaction channel. The upward path is a cache. **There is no journal of desktop transactions anywhere in the repository.**

**3. Every primary key is a local autoincrement integer, and every human-facing identifier is a local counter.**
82 `INTEGER PRIMARY KEY AUTOINCREMENT` tables; no UUID column on any domain table. `receipt_number` comes from a `receipt_counter` row in `settings`; `index_number` from `next_roll_number`. Two databases for the same school *will* mint the same receipt number and the same admission number. `payments.receipt_number` is `UNIQUE`. This is the structural blocker to bidirectional sync and it must be fixed before anything else is built.

**4. Financial transactions sync in one direction only.**
Cloud→desktop payments are correctly idempotent (`apply_staff.js:697` — applied-ledger key + `payments.reference` dedup). Desktop→cloud payments **do not exist as transactions**: an offline receipt reaches the cloud only as a `receipt` snapshot in the thin store, never as a row in the school's Postgres ledger.

**5. Two high-severity security loopholes are live in both the local and the cloud implementation.**
`settings:get-all` is permission-exempt and returns every settings row unredacted — including `paystack_secret_key`, `flutterwave_secret_key`, `hubtel_client_secret`, `expresspay_api_key`, `sms_api_key`, `email_smtp_pass` and `school_api_key`. Any signed-in staff account can read them, over the LAN and over the internet. Separately, parent self-registration grants access to a child's full record on an **unverified** phone number or email match.

**6. The LAN architecture is sound, well-documented and should be extended, not touched.**
`electron/ipc/mobile.js`, `electron/server/api.js`, `electron/server/webapp.js`, port 4747, `EDUSOFT_HOST_URL` and the `/api/v1/desk/call` RPC are a coherent, tested design. The single-route RPC (`desk_api.js`) is the correct seam for everything this project needs; it already makes the office application transport-agnostic across Electron IPC, LAN HTTP and the hosted service.

---

## 2. What exists today

### 2.1 Runtimes

| Runtime | Path | Role | Database |
|---|---|---|---|
| Electron desktop | `electron/main.js` | Office application; LAN host | local SQLite (better-sqlite3) |
| Electron thin client | `electron/client_mode.js` | Same installer, `EDUSOFT_HOST_URL` set; opens no DB, starts no server, loads `/desk/` from the host | none |
| Headless Node host | `host/server.js` | Installer's own handlers on a server | SQLite, **or** Neon via `host/db/neon.js` |
| FastAPI cloud | `cloud-python/app/` | SaaS platform: website, console, billing, licensing, online school | Neon; schema per school + shared platform schema |
| Node cloud (reference) | `cloud/src/` | Thin portal + sync API; superseded by `cloud-python`, retained and still tested | Neon or memory |
| Mobile / web app | `mobile/` | Expo; Android, iOS and browser build | none (API client) |
| Office app in a browser | `src/renderer` → `npm run build:desk` | Same screens as the installer | none (RPC client) |

### 2.2 Data architecture

Three distinct schemas, not two:

1. **Desktop SQLite** — `electron/db/database.js` (2,296 lines). 82 tables, created and migrated in-process. The canonical definition.
2. **Per-school Postgres** — `cloud-python/schema/school.sql`. **Generated** from (1) by `scripts/schema-to-postgres.mjs`. 82 tables, 42 indexes, applied into `school_<id>`; every connection has `search_path` pinned to one school (`cloud-python/app/school/db.py`). Structural tenant isolation — a forgotten `WHERE` cannot cross schools.
3. **Thin-cloud platform schema** — `snapshots`, `cloud_changes`, `schools`, `school_payments`, `platform_audit`, billing tables. `cloud-python/app/store.py`.

(2) and (3) are **not connected**. `/api/v1/sync/push` writes only to `snapshots` (`store.py:327`). Nothing propagates a desktop transaction into a school's Postgres schema.

### 2.3 Write paths

- 1,736 `db.prepare(...)` sites and 73 `db.transaction(...)` sites across `electron/`.
- Every IPC channel is wrapped at registration by `guardedIpcMain` (`electron/ipc/_guard.js`), which applies the licence gate, then `ALWAYS_ALLOWED`, then elevation, then the module/action permission from `_policy.js`, then the class/subject scope rule. The renderer cannot reach an unguarded handler.
- `electron/ipc/_registry.js` records the handler **after** guarding, so the LAN `/desk/call` route reaches exactly the guarded function — there is no second implementation and no unguarded path.
- The LAN REST API (`api.js`, `staff_api.js`, `finance_api.js`, `office_api.js`, `admin_api.js`, `dashboards_api.js`) does **not** pass through `_guard.js`; it re-implements the checks with `can()`, `scopeOf()`/`officeScopeOf()` and an explicit `audit()` helper.
- The cloud mirrors the model: `school_api.py:require()` resolves the actor per call and checks the same module/action, then school entitlement. `desk_api.py` declares `module`/`action` per channel.

### 2.4 The existing synchronisation, precisely

**Upward** (`electron/server/sync/outbox.js`, `staff_projection.js`, `office_projection.js`):
17 entity types — `student_snapshot`, `parent_auth`, `staff_auth`, `staff_profile`, `staff_timetable`, `class_roster`, `school_metrics`, `school_profile`, `debtor_list`, `admin_summary`, `finance_summary`, `receipt`, `report_card`, `announcement`, `exam_score`, `term_remark`, `staff_reset_claim`.

Mechanics: `postToOutbox` **collapses** an unsynced row with the same `(entity_type, entity_key)`, replacing the payload. A monotonic per-key version lives in its own `sync_versions` table so pruning cannot regress it. Retry has exponential backoff (`[60,300,900,3600,10800,21600]`), parks at 12 attempts (`dead = 1`), and prunes synced rows after 14 days. Deletes are tombstones: `op:'delete'` **with a null payload**, so the cloud row's contents are genuinely removed.

The collapse is correct for a read model and **fatal for a journal**: two edits to the same pupil before a sync become one row, and the first is unrecoverable.

**Downward** (`electron/server/sync/client.js`, `apply_staff.js` — 839 lines):
Cursor-based pull, `PULL_PAGE = 500`, drain loop bounded at `PULL_ROUNDS = 20`. 17 change types. `apply_staff.js` re-resolves the acting user against the desktop (`actor()`), re-checks effective permissions (`allowed()`), uses an applied-changes ledger (`alreadyApplied`/`markApplied`) for idempotency, and does three-way optimistic concurrency on marks and remarks (`local === incoming` → no-op; `local === base` → apply; otherwise → keep local and write `sync_conflicts`). Cursor receipt advances `schools.applied_cursor` with `GREATEST`; pruning is bounded by both the cursor and 90 days.

TLS is enforced for the cloud base URL except loopback (`client.js:insecureBase`).

**Assessment:** the downward path is production-grade and is the correct model to generalise. The upward path must be replaced by a journal, not extended.

### 2.5 The LAN system (preserve)

- `electron/ipc/mobile.js` — starts/stops the embedded server, port default **4747**, bind `lan`/`localhost`, device-token and parent management, auto-start on boot, EADDRINUSE handling, and a status payload that reports whether the web app and the desk app builds are present.
- `electron/server/api.js` — Node `http`, no framework. Literal-beats-placeholder route matching, per-route `public`/`rawBody`/`maxBody`, bearer tokens (SHA-256 stored, TTL from `mobile_token_ttl_days`, revocable), IP+identifier rate limiting on auth, licence gate on every non-GET, 413 with a readable message rather than a torn socket.
- `electron/server/webapp.js` — serves the parents' app at `/` and the office app at `/desk`, GET/HEAD only, never in front of `/api/`, path traversal blocked by root-prefix check, hashed assets immutable and shells `no-cache`, and an explanatory 503 when the desk build is absent.
- `electron/server/desk_api.js` — the single RPC route. Staff-only, `security.runAs` per request so concurrent users are distinct identities in every audit row, `HOST_ONLY` list for machine-bound channels, handle-based file download scoped to the issuing account with a 10-minute TTL, upload staging with an allow-list of extensions and a server-generated filename.
- `electron/client_mode.js` — `EDUSOFT_HOST_URL`, reachability probe against `/api/v1/desk/info`, and two human-readable failure pages.

### 2.6 Channel coverage (`docs/DESK_COVERAGE.md`, generated)

| Surface | Answers |
|---|---|
| Installed application | 408 / 408 |
| Browser on the school network, and the thin client | 381 / 408 (93%) |
| Hosted — `host/server.js` | 381 / 408 (93%) |
| Hosted — `cloud-python` | 107 / 408 (26%) |

61 channels are legitimately machine-bound (file dialogs, folder opening, backup restore, factory reset). 243 are marked `not yet` on the Python service.

---

## 3. Gaps that block cloud-first operation

| # | Gap | Evidence | Consequence |
|---|---|---|---|
| G1 | No stable cross-database record identity | 82 `AUTOINCREMENT` PKs; no UUID column | Two copies of one school cannot be merged at all |
| G2 | Human identifiers from local counters | `idgen.js:getNextReceiptNumber` (`receipt_counter`), `getNextRollNumber`; `payments.receipt_number UNIQUE` | Duplicate receipt numbers and admission numbers; failed inserts on merge |
| G3 | No transaction journal | `outbox.postToOutbox` collapses by entity key | Offline edit history is unrecoverable; ordering and dependencies cannot be reconstructed |
| G4 | Desktop→cloud financial writes absent | `backfillAll` pushes `receipt` snapshots only | An offline payment never becomes a cloud ledger entry |
| G5 | Tombstones only for projected entities | `enqueueTombstone` callers | Deletions in most modules never propagate |
| G6 | Node host cannot scale | `render.yaml` ("One instance, deliberately"); `host/db/worker.js` blocks the main thread per query via `Atomics.wait`; `host/db/cache.js` exact only with a single writer; `DATABASE_SCHEMA=school` is one school | Not viable as a multi-school primary platform as written |
| G7 | Python host feature gap | 243 channels `not yet` | Not viable as the primary platform today either |
| G8 | No device registry for sync audit | `api_tokens` identifies a device for auth, not a sync origin | "Which device and user created this record" is not answerable per record |
| G9 | No durable per-device sync cursor on the upload side | `cloud_cursor` setting is a single download cursor | Resumability exists downward only |
| G10 | Two `audit_log` definitions | `database.js:729` and `database.js:1002`, both `CREATE TABLE IF NOT EXISTS` | The second is a silent no-op; latent confusion |

---

## 4. Security audit

### HIGH

**S1 — `settings:get-all` exposes every secret to any signed-in account.**
`electron/ipc/settings.js:22` returns all `settings` rows grouped by category, unredacted. The channel is listed in `ALWAYS_ALLOWED` (`electron/ipc/_policy.js:248`), so `_guard.js` skips the permission check entirely. The cloud has the identical hole: `cloud-python/app/desk_api.py:146` declares `@channel("settings:get-all")` with `module=None`, and `school_api.py:require()` performs no permission check when `module` is `None`.

Exposed keys: `paystack_secret_key`, `flutterwave_secret_key`, `flutterwave_secret_hash`, `hubtel_client_secret`, `expresspay_api_key`, `sms_api_key`, `email_smtp_pass`, `resend_api_key`, `school_api_key`, plus `payment_gateway_credentials` (JSON) in the cloud.

Impact: a class teacher can read the school's payment-gateway secret (move money), its SMS credentials (impersonate the school to every parent), and `school_api_key` — which authenticates `/api/v1/sync/push` and `/sync/pull` and therefore grants read/write to the school's cloud data. Reachable from the LAN browser and, on the hosted service, from the internet.

Fix: redact by key pattern and category in both implementations; serve the sign-in screen the curated public set that `desk_api.js` `/desk/info` already builds; require `settings:view` for the rest; add a regression test asserting no secret key ever appears in the channel's response.

**S2 — Parent self-registration grants a child's full record on an unverified contact match.**
`electron/server/parents.js:77` matches the supplied phone or email against `students.father_contact`/`mother_contact`/`guardian_contact` and the email equivalents, then links the new account to every matched pupil. There is no OTP, no email confirmation, no school approval step. `mobile_parent_self_register` defaults to `'true'` (`api.js` `/info`). A parent's phone number is not a secret in a Ghanaian school — it is in the class WhatsApp group.

Impact: anyone who knows a parent's number obtains that child's fee ledger, academic record, attendance, timetable, homework and teacher contacts, plus a 30-day bearer token.

Fix: require possession proof (SMS OTP through the existing Arkesel/`_transport.js` path, or email code), or default the setting to off and route registration through office approval. Minimum password length is also 4 characters here — raise it.

### MEDIUM

**S3 — `auth:*` read channels bypass the permission guard.**
`_policy.js:fallbackRule` returns `null` when the channel prefix is not in `PREFIX_MODULE`, and `_guard.js` then calls the handler with no check (`if (!rule) return handler(...)`). `auth` is not in `PREFIX_MODULE`. The write channels defend themselves internally (`auth:create-user`, `auth:update-user`, `auth:set-permission-override`, `auth:update-designation-permission` check `settings` permissions; `auth:add-user-assignment`/`remove-user-assignment` check `mayAssign()`), but these do not: `auth:list-users`, `auth:list-designations`, `auth:get-designation-permissions`, `auth:class-teachers`, `auth:list-user-assignments`. Any signed-in staff account enumerates the full user roster, every designation's permission matrix and every teaching assignment — useful reconnaissance for S1.

Fix: add `auth: 'settings'` (or a dedicated module) to `PREFIX_MODULE` so the fallback covers it, and make `fallbackRule` fail **closed** for unknown prefixes with an explicit allow-list for the pre-sign-in channels. The current fail-open default is the real defect; the five channels are its symptom.

**S4 — LAN traffic is plain HTTP, and the thin client loads remote code over it.**
Deliberate and documented (`webapp.js` preamble: same-origin, no mixed-content block, no service worker). But `electron/main.js:133` does `mainWindow.loadURL(`${host}/desk/`)` — the installer renders code fetched over unauthenticated HTTP from the LAN. Anyone on the school Wi-Fi who can ARP-spoof can inject script into the office application. `contextIsolation: true` and `nodeIntegration: false` are correctly set, which bounds this to the application's own privileges — which still includes every channel the signed-in user holds.

Fix (no behaviour change for existing installs): offer an optional self-signed-cert HTTPS mode on 4747 with certificate pinning in the thin client, and pin the expected host fingerprint on first successful connect. Document the residual risk otherwise.

**S5 — Parent accounts have no lockout and weak password policy.**
`parents.loginParent` has no per-account failure counter; only the API-layer limiter (20 requests / 60s per IP **and** per identifier) applies. Staff logins do have a lockout (`auth.js:loginLock`). Parent passwords: minimum 4 characters.

**S6 — Long-lived bearer tokens in browser `localStorage`.**
`mobile_token_ttl_days` defaults to 30; the desk client stores the token in `localStorage` (`src/renderer/src/lib/desk.js`). A single XSS anywhere on the origin yields a 30-day staff session. The cloud is better (`session.py` `DEFAULT_TTL_DAYS = 14`, `MAX_TTL_DAYS = 30`). Recommend a short access token with refresh, or at minimum a much shorter TTL for staff on the hosted surface.

### LOW

- **S7** — `Access-Control-Allow-Origin: '*'` on every JSON response (`api.js:json`) and `allow_origins=["*"]` on the cloud (`main.py:193`). Not a CSRF hole: authentication is a bearer header and `allow_credentials` is not enabled. Still worth narrowing on the hosted service.
- **S8** — bcrypt cost factor 10 (`office_api.js:1918`, `admin_api.js:853`, `session.py:84`). Raise to 12 with a verify-and-rehash-on-login path.
- **S9** — `/api/v1/desk/call` has no rate limit of its own (sign-in does, `desk_api.py:935`). A valid token can hammer any channel.
- **S10** — G10 above: the duplicate `audit_log` definition.

### Verified sound — do not change

- Tenant isolation by Postgres schema with pinned `search_path` and a narrow identifier regex (`school/db.py`).
- Parameterised SQL throughout; identifiers validated by `ident()` before interpolation (`school/db.py:149`).
- `PORTAL_SECRET` fails closed; the dev constant requires an explicit `ALLOW_DEV_SECRET=1` (`portal_auth.py`).
- Webhook signature verified over raw bytes, amount never read from the body, settlement re-asked of the gateway (`main.py:1401`, `app/payments.py`).
- School keys stored as hashes only; rotation, not recovery (`store.py:306`, `set_school_key`).
- Bearer tokens stored as SHA-256; raw value shown once (`electron/server/tokens.js`).
- Desk file handles are account-scoped and TTL'd; no route accepts a client-supplied path; upload extension comes from a server allow-list.
- Electron: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on the print window, ASAR integrity fuses (`scripts/fuses.mjs`).
- No credentials committed; no security-bypass environment variables.
- Licence enforcement applies on the LAN path as well as IPC, with a documented exempt list.

---

## 5. Recommended architecture

### 5.1 Identity and journal foundation (prerequisite for everything)

1. **`record_uid` on every synchronised table.** `TEXT UNIQUE`, UUIDv7 (time-ordered, so it also sorts). Added by migration, backfilled for existing rows, kept alongside the existing integer PK — **no foreign key changes**, so no existing install breaks and no handler is rewritten.
2. **`device_id` per installation.** Generated on first run, stored in `settings`, registered with the cloud. Carried on every journal entry.
3. **Identifier allocation by lease.** The cloud issues each device a block of receipt and admission numbers (e.g. 500 at a time); offline allocation draws from the block. Prefix-free, no collisions, no renumbering of history. Offline-exhausted blocks fall back to a device-prefixed sequence that is visibly distinguishable.
4. **`sync_journal`** — append-only, never collapsed: `(seq, record_uid, table_name, op, before_json, after_json, device_id, user_id, happened_at, txn_id, idempotency_key, depends_on)`. Written by a single choke point.
5. **`idempotency_key`** on every financial mutation, derived deterministically from `(device_id, txn_id, record_uid)`. Unique index on the cloud side. This is what makes a replayed payment a no-op rather than a second payment.
6. **Keep the existing `sync_outbox` untouched** as the read-model projection channel. It works, the portal depends on it, and it is not what the journal replaces.

Where the choke point goes: `electron/ipc/_guard.js` already wraps all 408 channels at registration, and `_registry.js` records the guarded function. Journalling belongs in the same wrapper — one place, automatically covering any channel added later. The 1,736 `db.prepare` sites are not touched.

### 5.2 Cloud system of record (decided — D2, D5)

**Topology: one `host/server.js` container per school, on Cloudflare Containers, against Neon.**

```
                      Cloudflare (DNS, WAF, Access, rate limiting)
                                      │
            ┌─────────────────────────┼──────────────────────────┐
            │                         │                          │
    cloud-python                 Container router        R2 (documents, photos)
    (platform layer)             (school_id → container)
    site · console ·                   │
    billing · licence ·        ┌───────┴───────┬───────────────┐
    subscriptions · seals      │               │               │
                          school A        school B        school C
                        host/server.js  host/server.js  host/server.js
                        DATABASE_SCHEMA  DATABASE_SCHEMA  DATABASE_SCHEMA
                           =school_a        =school_b       =school_c
                                └───────────────┴───────────────┘
                                             Neon
                                   (one schema per school)
```

Why this works with no change to the database layer:

- `host/server.js` already takes `DATABASE_URL` + `DATABASE_SCHEMA` and already runs the installer's handlers unchanged (`host/server.js:85-105`). Per-school isolation is what it was written for.
- `render.yaml`'s "One instance, deliberately" constraint is **satisfied, not worked around**: one container per school means one writer per database, so `host/db/cache.js`'s exact invalidation stays exact and the `Atomics.wait` blocking adapter stays correct. At under 10 concurrent staff (D5) one query in flight is not the bottleneck.
- Neon already isolates schools structurally by schema, with `search_path` pinned per connection (`cloud-python/app/school/db.py`). Both backends address the same database the same way.
- `host/provision.js --if-empty` already creates a school's tables idempotently and is already wired as a pre-deploy step.

What must be built for D1:
1. A **container router** — maps a request's school (subdomain per `PORTAL_BASE_DOMAIN`, or `school_id` on the desk login) to that school's container instance, and reports a readable state while one is starting.
2. **Container lifecycle tied to enrolment** — `cloud-python`'s platform layer already owns school creation (`platform_api.py`), subscriptions and suspension. Enrolling a school provisions its schema and starts its container; suspension stops it. Always-warm (D6) means no idle-sleep logic.
3. **R2 for generated documents and photographs** — `render.yaml` currently mounts a 5 GB persistent disk at `/var/data` for report cards, receipts, payslips and photos. A per-school container should not carry a per-school disk; R2 replaces it. `electron/server/media.js` and the desk file-handle path (`desk_api.js`) are the two touch points.

`cloud-python` keeps the platform layer and loses nothing. The 243 `not yet` channels stop mattering, because the office application is no longer answered by Python.

### 5.2a What does *not* change

Stated explicitly because the brief requires it: nothing in `electron/ipc/mobile.js`, `electron/server/api.js`, `electron/server/webapp.js`, port 4747, the route contract, `EDUSOFT_HOST_URL` semantics, the thin-client flow, or the LAN permission and licence model is modified by D1–D7. The LAN host gains a coordinator role (§5.4) and nothing is taken away. `test/office_parity.js`, `test/host_channels.js` and `test/headless_host.js` are the standing proof of that and must stay green at every phase.

### 5.3 Synchronisation engine

Generalise the proven downward applier rather than inventing a second mechanism.

- **Upload:** `POST /sync/journal` — ordered batch of journal entries, each with `record_uid`, `idempotency_key`, `base_version`, `device_id`, `user_id`. The cloud applies through the same module functions a web request uses, so the same permissions, validation and ledger rules apply. Response acknowledges per entry; the device advances a durable upload cursor. Partial acknowledgement is normal and resumable.
- **Download:** the existing `cloud_changes` cursor model, extended to carry journal entries for every table rather than 17 named types, and applied through a generalised `apply_staff.js`.
- **Conflicts (D3 — per-module authority):** the existing three-way rule (`incoming === local` → no-op; `local === base` → apply; otherwise → the authoritative side keeps its value and the other is recorded) extended per field, writing to `sync_conflicts`, surfaced on Settings → Cloud Sync as it already is. Authority is declared in one table, not scattered:

  | Module | Authority | Reason |
  |---|---|---|
  | Fees, payments, receipts, finance, payroll, inventory | **Cloud always** | Money has one ledger. A balance cannot have two answers, and a receipt number is leased from one allocator. |
  | Attendance, exam scores, assessments, term remarks, homework, lesson notes | **Where entered**, per field | A register marked in a classroom and a mark corrected in the office are both real work; the existing per-field rule already settles these correctly and `sync_conflicts` already records the loser. |
  | Students, staff, academics, timetable, settings, access | **Cloud always** | Administrative records with a single owner; last-writer-wins on the primary surface, with the local value recorded. |
  | Canteen collection | **Cloud always**, idempotent | It is money. `apply_staff.js:applyCanteen` already refuses to take it twice; that guarantee is preserved. |

  Declared as a map in one module so "who wins for `scores`" is a line to read rather than a handler to trace — the same reasoning `_policy.js` applies to permissions. Anything not in the map fails to **cloud-authoritative with the local value recorded**, never to a silent overwrite.
- **Financial protection:** append-only ledger; reversal by compensating entry, never by update or delete; unique index on `idempotency_key`; `receipt_number` uniqueness enforced per school *and* allocation leased so it cannot be contested. A payment is never created by a sync path that has not matched an idempotency key.
- **Ordering and dependencies:** `depends_on` carries the `record_uid` of any record that must exist first (a payment depends on its student and bill). An entry whose dependency is unmet is deferred, not dropped, and reported if it stays unmet.
- **Audit:** every applied entry records originating `device_id`, `user_id` and `happened_at` alongside the applying timestamp.

### 5.4 The LAN host as local coordinator

No replacement, no new server. Add to the existing desktop host:
- Connectivity detection, already partly present (`client.js:blockedReason`, `reachable()`), promoted to a single observable state the UI reads.
- Automatic mode switch at the transport, not in the screens: `desk.js`/`origin.js` already select host/online/cloud modes by probing `/api/v1/info`. The office PC becomes the LAN's single sync coordinator — LAN clients always talk to 4747, and only the office PC talks to the cloud.
- Cloudflare Tunnel from the office PC removes the port-forwarding requirement for remote access without opening the school's network.

### 5.5 Cloudflare

**Blocked pending your answer (§7, Q1).** The repository cannot run on Workers as written: `host/server.js` depends on `worker_threads`, `SharedArrayBuffer` and `Atomics.wait`; `cloud-python` depends on `psycopg`, `psycopg_pool`, `bcrypt` and `cryptography`. Workers supports none of that.

What Cloudflare can do today with no stack change, and which I recommend regardless of the answer:
- **DNS, WAF, rate limiting, bot management** in front of the Render origins — directly mitigates S9 and the auth-brute-force surface.
- **Cloudflare Access (Zero Trust)** on `/console` — the interface that can suspend a school and read the platform audit trail currently has no second factor.
- **R2** for report cards, receipts, payslips and photographs. `render.yaml` mounts a 5 GB persistent disk for these; that disk is itself a reason the host cannot scale horizontally.
- **Cloudflare Tunnel** for LAN hosts (§5.4).
- **Hyperdrive** if any part later moves to Workers, and **Containers** if the FastAPI or Node image should run on Cloudflare rather than Render.

---

## 6. Implementation plan

Each phase is independently shippable, migration-safe and test-gated. Nothing in Phases 0–2 depends on the §7 decisions.

**Phase 0 — Baseline. EXECUTED; results below.**

| Suite group | Result |
|---|---|
| `scripts/contrast.mjs` | pass |
| Node regressions, suites 1–16 | pass — 336, 44, 119, 31, 63, 64, 42, 73, 127, 72, 37 … all 0 failed |
| **`test/teacher_api.js`** | **124 passed, 3 failed** — see below |
| Node suites after it (12) | pass — `office_api` 121, `dashboards_api` 80, `office_parity` 95, `webapp` 21, `desk_surface` 31, `desk_api` 44, `headless_host` 10, `host_dialect` 33, `host_connection` 22, `host_blueprint` 28, `host_postgres`, `host_channels` — all 0 failed |
| `cloud/test/*` (4) | pass — `e2e` 34, `portal` 16, `staff` 48, `passwords` 24 |
| Python, no database needed (6) | pass — `test_platform` 67, `test_billing` 114, `test_gateways` 98, `test_desk` 9, `test_portal` 21, `test_staff` 73 |
| Python, database-backed (6) | pass against local Postgres 16 — `test_saas` 113, `test_school` 132, `test_payments` 39, `test_licensing` 64, `test_attack` 46, `test_dashboards` 82 — all 0 failed |

**Baseline verdict: one failure across the whole suite (P0-1), and it is a test-fixture defect, not a product defect.** Everything else is green, including every Postgres-backed suite in both languages.

**P0-1 — The only failure is a rotted test fixture, not a product defect.**
`test/teacher_api.js:174` writes attendance for the hardcoded date `2026-08-24`, then asserts on `GET /api/v1/attendance/history?days=30`. `electron/server/staff_api.js:237` filters `date >= date('now', ?)` with `-30 days`. Today is 2026-11-15 — 83 days later — so the window legitimately excludes the fixture's own data. The three assertions ("register history counts the day", "and totals each pupil", "...and carries the reason the teacher wrote") would have passed in September and will fail on every run from now on. Fix: make the fixture date relative to today. This must be fixed in Phase 1, because an untrustworthy suite cannot gate Phases 2–5.

**P0-2 — `npm run test:regressions` is a `&&` chain**, so it stops at the first failing suite. Twelve suites never ran in the default invocation and had to be run individually to establish the baseline. Recommend splitting the chain so one stale suite cannot hide twelve green ones.

**P0-3 — `httpx` is a test dependency and is not declared.** `cloud-python/requirements.txt` omits it; all twelve Python suites fail at import without it. Add it (as a test extra, not a runtime dependency).

**P0-4 — Six Python suites require `DATABASE_URL`** and are silently skipped-by-failure without one, `test_attack.py` — the security suite — among them. CI must provide a Postgres service so these are never quietly absent.

**P0-5 — The two tests that validate the chosen architecture skip silently with exit 0.**
`test/host_postgres.js` and `test/host_channels.js` print "DATABASE_URL is not set — skipping" and `process.exit(0)`, so `npm run test:regressions` reports success having tested nothing about the Neon adapter. Since D2 makes that adapter the cloud system of record, this is the most important gap in the suite. Both must become hard failures in CI with a Postgres service attached.

**P0-6 — D2 validated against a real database.** Provisioned Postgres 16 (`host/provision.js` → "82 tables ready") and ran both suites for real:

- `test/host_postgres.js` — **22 passed, 0 failed.** Confirms the adapter's hard parts: BIGINT returned as a JavaScript `number` not a string, `.get()`/`.all()`/`.run()` matching better-sqlite3 semantics including `lastInsertRowid`, transaction commit and rollback, read-your-own-writes inside a transaction, exact cache invalidation (a write is visible to the very next read), cached values immutable to the caller, `MAX()` never served from cache, SQLSTATE propagated to the handler (`23505`), and `@named` parameters.
- `test/host_channels.js` — **93 passed, 0 failed.** 93 real channels answered by Postgres with no refusal. 3 were skipped for wanting arguments the sweep cannot synthesise — the suite says so itself, which is the right behaviour.

This is the evidence D2 rests on: the installer's own handlers genuinely run against Postgres. The architecture is not a hope.

**P0-7 — The security suite passes 46/46 and does not test for S1.**
`cloud-python/tests/test_attack.py` covers the *platform's* secrets well — `PLATFORM_ADMIN_KEY` length gating, `LICENCE_SIGNING_KEY`, `BILLING_CRON_SECRET` kept separate from the console key, `ALLOW_DEV_SECRET`, `/api/v1/admin/settings`. It contains **zero** references to `settings:get-all`, `paystack_secret_key`, `sms_api_key` or `school_api_key`. The blind spot is structural: the suite asks "can an outsider reach the platform's secrets?" and never asks "can an insider read the school's own?" That is exactly the shape of S1, and it is why a green suite coexists with a high-severity leak. Phase 1's redaction test closes the question, not just the hole.

*Files: none modified in Phase 0.*

**Phase 1 — Security fixes. S1, S3 and P0-1 DONE; S2 awaiting the O5 product decision.**

**S1 closed, both implementations.** The secret list now lives on its own —
`electron/ipc/_secrets.js` and `cloud-python/app/school/secrets_policy.py` — because
two lists in two files is exactly how this happened: `admin_api.js` knew these keys
were secrets and `settings:get-all` did not. Eleven keys offline, twelve online (the
cloud also stores `payment_gateway_credentials`, the whole credential set as one JSON
blob — a list that caught the individual keys and missed the blob would have caught
nothing).

The channel keeps its ALWAYS_ALLOWED status, deliberately: the sign-in screen draws
the school's crest and colours from it before anybody holds a token. Making the
*answer* safe is the fix; removing the permission would have broken the login screen.

The half that makes redaction safe is the half worth naming. Settings → Payments and
Settings → Notifications both load every field into a form and write every field back
on Save. Redacting without more would mean: open the screen, press Save, and the
school's Paystack key is gone — silently, with the toast still saying "saved". So an
empty value for a secret now means "the one already saved", enforced in
`settings:set` and in the LAN `POST /system/settings` rather than in each screen,
because the next screen somebody writes will not remember. `Cloud.jsx` already did
this in the screen and `Payments.jsx` already documented it as true; it is now
actually true.

Clearing a credential therefore needed somewhere to go: `settings:clear-secret`,
guarded (the verb table infers `delete`, so it needs `settings:delete`), audited at
high severity, and surfaced as a "Remove saved …" action on the fields that have one.
Without it the redaction would have quietly removed a capability.

**S3 closed.** The four genuinely unguarded reads — `auth:list-users`,
`auth:list-designations`, `auth:get-designation-permissions`, `auth:class-teachers` —
are now named in `POLICY` against `settings/view`. `auth` was deliberately NOT added
to `PREFIX_MODULE`: seven other `auth:` channels defend themselves internally, and two
of them (`add-user-assignment`, `remove-user-assignment`) admit a **Head Teacher**
through `mayAssign()`. A blanket prefix rule would have demanded `settings` create and
delete for those two and taken teaching assignments away from the person whose job
they are. Four named rules, no collateral.

The remaining fail-open path stays open — refusing unlisted channels outright is what
broke every non-admin account the first time `_policy.js` was written — but it is no
longer **silent**: an unruled channel now writes one high-severity `channel_unguarded`
audit row per channel per process. The four `auth:` channels sat in that gap for
months and nothing anywhere said so.

**P0-1 closed.** `test/teacher_api.js` now derives its four register days from today.

**Tests added**, and registered in both `test` and `test:regressions` so they gate:
- `test/settings_secrets.js` — 25 assertions. One per credential by name, so a failure
  says *which* key leaked; plus a catch-all that walks the policy's whole list, which
  is what will catch the key somebody adds next year. Also asserts a class teacher is
  refused both the replace and the clear, that an empty secret preserves, that a real
  value replaces, that an ordinary setting can still be emptied, and that the two
  lists agree.
- `test/guard_coverage.js` — 19 assertions. Walks all 408 channels and asserts each has
  a rule, is always-allowed, is `app:*`, or is on a declared internally-guarded list —
  and then **verifies each exemption against `auth.js`'s source**, so a handler that
  loses its internal check fails here rather than becoming an unguarded channel.
- `cloud-python/tests/test_desk.py` — +13 assertions in `with_a_school`, including that
  not even the Super Admin reads a credential back. The existing "every channel
  declares its module" assertion excludes the `settings:get*` prefix by name; that
  exclusion *was* the blind spot, so the leak is tested directly instead.

**S2 closed by removal, not mitigation.** The school chose to remove parent
self-registration rather than add an OTP, which is the stronger answer. Gone from
`electron/server/parents.js` (`registerParent`), `cloud-python/app/school/parents.py`
(`register`), the mobile app's register stage and its API client, the Settings →
Mobile App toggle, `SETTINGS_READABLE`, and the seeded
`mobile_parent_self_register` row (which is why `schema/seed.sql` drops from 391 rows
to 390 — the only change in it).

Both routes are **kept** and answer a plain 403: a phone running an older build still
has the button, and a 404 reads as "the school's system is broken" while a refusal
reads as what it is. Neither consults a setting — there is no longer a setting that
can turn it back on. `matchStudentsByContact` stays, because `provisionParent` uses it
to suggest children when the **office** sets a parent up; the difference is who is
asserting the relationship.

*Consequence worth stating:* `mobile:create-parent` is "not yet" on the Python
service, so self-registration was the only way a parent account came into existence
**there**. Under D2 that is covered — `host/server.js` runs the real handler — but a
`cloud-python`-only deployment now has no way to create a parent except the
`parent_auth` projection from a desktop. Say the word and I will port that channel.

**Portal login hardened — the part the school asked for.** The audit found *three*
implementations of "check a password", with three different amounts of protection, and
the two with the weakest brake were the two that answer over a network:

| | before | now |
|---|---|---|
| `ipc/auth.js` (staff) | per-**username** lockout | per-(account, source), backstop 50 |
| `server/api.js` (staff, LAN + hosted) | **its own bcrypt call, no account lockout** | routed through `auth.authenticate` |
| `server/parents.js` (parents) | **no throttle, 4-char minimum** | per-(account, source), 8-char floor |

`api.js` now contains no bcrypt call of its own. The per-username lockout was replaced
because `host/server.js` puts that code on the **internet**, where counting failures
per account alone is a denial of service anybody can arrange — guess five times at the
head teacher's username every minute and the head teacher never signs in again. The
replacement is the scheme the online service already arrived at
(`cloud-python/app/school/session.py`), and with no source given — the office PC's own
window — behaviour is exactly what it was.

Also: a parent sign-in now verifies against a dummy hash when no account matches, so
"no such parent" costs the same as "wrong password" — without it the login box was an
oracle for "is this number a parent at this school?", the same question
self-registration used to answer out loud.

In `/auth/signin`, which takes a staff username *or* a parent's phone, the staff path
only engages when the identifier really is a staff username — otherwise every parent
sign-in would write staff failures to the security log and could lock a staff account
out on a number that was never theirs.

**S8 closed.** Eight `bcrypt.hashSync(password, 10)` calls across four files became one
`electron/ipc/_hashing.js` at cost **12**, with `rehashIfStale` upgrading an account at
the one moment the password is both known and proven — so no school resets anything and
no old hash stays at 10 forever. Mirrored in `cloud-python/app/school/session.py`, which
matters because a staff password is bcrypt on the desktop and verified as-is online: the
two halves of one school must agree about what "stored properly" means.

**S10 closed.** The second `audit_log` definition is gone. Verified dead first — none of
its seven columns is referenced anywhere — and verified harmless after: the regenerated
`schema/school.sql` is byte-identical.

**P0-2/3/5 closed.** `scripts/run-tests.mjs` and `cloud-python/tests/run_all.py` replace
the two `&&` chains: every suite runs, every result is reported, the exit code is the
worst of them, and suites skipped for want of a database are **named** rather than
counted as passes. `EDUSOFT_REQUIRE_PG=1` makes that skip an error, which is what CI
should set — `test/host_postgres.js` and `test/host_channels.js` validate D2 and were
reporting success having tested nothing. `httpx` is declared in a new
`cloud-python/requirements-test.txt`.

**Tests added for this pass:** `test/login_hardening.js` — 24 assertions covering the
password floor, both throttles, the per-source property that a per-account lockout would
have broken, the distributed-guessing backstop, office-PC behaviour unchanged, the cost
factor, and that an old hash still signs in *and* gets upgraded. Plus the cloud
`clear-secret` assertions in `test_desk.py`.

*Three test failures during this pass were my tests, not the code* — a class teacher
legitimately cannot write settings; the cloud's `SETTINGS_WRITABLE` legitimately
excludes `sms_api_key`; and `cloud/test/e2e.js` and `cloud/test/portal.js` encoded the
old 6-character parent password. Fixing them made each test stronger.

*Still open:* S4, S6, S7, S9 by decision (see O4), and the Python `mobile:create-parent`
port noted above.
*Verified:* full Node chain exit 0, 1665 assertions, 0 failures — and it now runs to
completion rather than stopping at `teacher_api`. `test_desk.py` 38/38 against
Postgres. Both renderer bundles and the preload build clean.

**Phase 2 — Identity and journal.** §5.1, items 1–6. Migrations only; no feature change; both databases.
*Files: `electron/db/database.js`, `electron/utils/idgen.js`, `electron/ipc/_guard.js`, new `electron/server/sync/journal.js`, `scripts/schema-to-postgres.mjs` (regenerate `cloud-python/schema/school.sql`), `host/db/dialect.js` if UUID defaults need dialect handling.*
*Risk: medium — touches the schema of 82 tables. Mitigation: additive columns only, no FK changes, backfill idempotent and resumable, every migration tested against a populated pre-migration database.*

**Phase 3 — Cloud as system of record (D1, D2, D5, D6).** One `host/server.js` container per school on Cloudflare Containers, against Neon. No change to `host/db/worker.js` or `host/db/cache.js` — one container per school preserves the single-writer invariant both depend on. Build: the container image (the existing `buildCommand` from `render.yaml`), the school→container router, lifecycle tied to `cloud-python`'s existing enrolment and suspension in `platform_api.py`, and R2 in place of the `/var/data` disk for generated documents and photographs.
*Files: new `deploy/` Cloudflare configuration and a `Dockerfile` for the Node host; `electron/server/media.js` and `electron/server/desk_api.js` for the R2 file path; `host/server.js` only where `EDUSOFT_DATA_DIR` assumptions must become object storage; `cloud-python/app/platform_api.py` for lifecycle hooks.*
*Risk: medium, reduced from high by D5 and D6 — the concurrency rewrite that made this "high" is no longer required.*

**Phase 4 — Bidirectional sync.** §5.3. Journal upload, generalised applier, conflict surface, financial idempotency, dependency ordering, resumable cursors both directions.
*Files: `electron/server/sync/client.js`, `apply_staff.js` (generalise), new `electron/server/sync/journal_client.js`, `cloud-python/app/sync_api.py` (new), `store.py`.*
*Risk: high. Gated by Phase 2.*

**Phase 5 — Offline/online transparency in the desktop.** §5.4. Connectivity state, automatic switch, sync status surface, LAN coordinator role.
*Files: `electron/ipc/cloud_sync.js`, `electron/client_mode.js`, `src/renderer/src/lib/desk.js`, `mobile/src/origin.js`, the Settings → Cloud Sync screen.*
*Risk: medium. UI additions only, in the existing visual language — no new design system, no explanatory copy beyond state labels.*

**Phase 6 — Cloudflare edge and region (D1, D7).** WAF, rate limiting (closes S9), Cloudflare Access on `/console` (closes the missing second factor on the one interface that can suspend a school), Tunnel for LAN hosts, R2 completion. Then the D7 region work: measure Neon placement against Cloudflare's Accra presence versus the current Frankfurt baseline, on the real query profile — many small blocking round trips per screen, which is what makes region a first-order decision. Move only on measured improvement; document the numbers either way.
*Files: deploy configuration and documentation.*
*Risk: low.*

### Testing strategy

Extend the existing suites rather than adding a framework — the repository already has 29 Node and 12 Python suites covering sync conflicts, payment desk, gateways, licence, access, portals, parity and Postgres dialect.

| Scenario | Where |
|---|---|
| Online operation, all three clients | `test/desk_api.js`, `test/webapp.js`, `cloud-python/tests/test_desk.py` |
| Offline operation, full module set | new `test/offline_journal.js` |
| Reconnection and drain | extend `test/sync_conflicts.js` |
| Simultaneous edits, same field | extend `test/sync_conflicts.js` (three-way rule per field) |
| Interrupted sync, resume | new `test/sync_resume.js` — kill mid-batch, assert no loss and no duplication |
| Financial integrity | new `test/sync_financial.js` — replay a payment batch 3×, assert one ledger entry, one receipt, correct balance |
| Identifier collision | new `test/identifier_leases.js` — two devices offline, overlapping ranges, assert no `UNIQUE` violation on merge |
| Migration safety | new `test/migrations.js` — populate pre-migration, migrate, assert row counts, balances and report-card output unchanged |
| LAN preservation | existing `test/headless_host.js`, `test/host_channels.js`, `test/office_parity.js` must stay green at every phase |
| Cross-language parity | existing `cloud-python/tests/cross_lang.sh` |

### Risk register

| Risk | Mitigation |
|---|---|
| Schema migration damages a live school's data | Additive columns only; resumable idempotent backfill; `test/migrations.js` against populated databases; automatic backup before migration via the existing `electron/ipc/backup_engine.js` |
| Receipt/admission number collision during cutover | Lease allocation before any dual-write is enabled; `test/identifier_leases.js` |
| Duplicate payment on replay | Deterministic idempotency key + unique index + ledger-only writes; `test/sync_financial.js` |
| LAN regression | `office_parity.js`, `host_channels.js`, `headless_host.js` green at every phase; no change to 4747, routes, or `EDUSOFT_HOST_URL` semantics |
| Cloud/desktop business-rule drift | One implementation (Option A), or `desk-coverage.mjs --check` in CI as the contract (Option B) |
| Node host cannot carry multi-school load | Measure before committing; `render.yaml` and `host/db/worker.js` document the constraint explicitly |
| Authority inversion loses data | Journal is append-only and never pruned until acknowledged *and* aged; conflicts are recorded, never discarded; `ARCHITECTURE-OFFLINE.md`'s "never silently overwrite" rule carried forward |

---

## 7. Open items

All five blocking questions are answered in §0. What remains is not blocking but should be settled during the phase that needs it.

**O1 — Neon region (Phase 6, D7).** Measure Cloudflare Accra placement against the Frankfurt baseline on the real query profile before moving any data. The repository's own measurement — roughly 100 ms per screen in-region, over 2 seconds cross-continent — is the number to beat, and it exists because every query blocks the host for one round trip.

**O2 — Always-warm cost model (D6).** Under 50 schools × one always-running container is a predictable bill that scales with enrolment rather than usage. Worth confirming against the subscription pricing in `cloud-python/app/billing/plans.py` so the unit economics hold at the low end of the plan range.

**O3 — Offline identifier-block size.** The lease in §5.1 item 3 trades cloud round trips against how long a school can stay offline. 500 receipts per block is a starting point; the right number comes from the busiest school's daily receipt volume.

**O4 — S4 (plain-HTTP LAN).** Optional HTTPS on 4747 with fingerprint pinning in the thin client is a real hardening, but it changes first-run behaviour for every existing LAN install. Recommend documenting the residual risk now and scheduling the change deliberately rather than folding it into Phase 1.

**O5 — Parent self-registration remediation (S2).** Two acceptable fixes: SMS OTP through the existing `_transport.js` Arkesel path, or default the setting off and route registration through office approval. The first keeps the feature and costs SMS credits per registration; the second costs the school a minute of admin per parent. This is a product call, not a technical one.
