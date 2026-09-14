-- Nickland Edusoft — the platform's subscription and billing tables.
--
-- These sit beside `schema.sql`, OUTSIDE every school's own schema, and that
-- placement is the whole design. A school's schema holds what the school owns:
-- its pupils, its marks, the fees IT charges parents. None of that is any of
-- the platform's business, and none of it belongs in the same tables as what
-- the SCHOOL owes NICKLAND. The two are different money moving in different
-- directions between different parties, and a subscription row inside a
-- tenant's schema would be a row the tenant's own administrator could reach.
--
-- So: every table here is keyed by `school_id` and is read only by the billing
-- engine, the superadmin console, and the one school it is about.
--
-- Re-runnable, like schema.sql — every statement is CREATE … IF NOT EXISTS or
-- ALTER … ADD COLUMN IF NOT EXISTS — because the service applies it itself on
-- boot rather than asking somebody to remember a psql command.

-- ── Plans ───────────────────────────────────────────────────────────────────
-- Nothing about a plan is in the code. "Free", "Pro" and "Max" are three rows
-- in this table, and the Superadmin can change every number on them or add a
-- fourth without a deployment. That is the requirement, and it is also what
-- keeps the pricing page, the checkout, the invoice and the console from ever
-- disagreeing: they all read this table.
CREATE TABLE IF NOT EXISTS subscription_plans (
  plan_id           TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  tagline           TEXT NOT NULL DEFAULT '',
  currency          TEXT NOT NULL DEFAULT 'GHS',
  billing_interval  TEXT NOT NULL DEFAULT 'monthly',   -- monthly | termly | annual
  base_price        NUMERIC(14,2) NOT NULL DEFAULT 0,  -- charged regardless of roll
  price_per_student NUMERIC(14,2) NOT NULL DEFAULT 0,
  included_students INTEGER NOT NULL DEFAULT 0,        -- covered by base_price
  max_students      INTEGER,                           -- NULL = no ceiling
  trial_enabled     BOOLEAN NOT NULL DEFAULT false,
  trial_days        INTEGER NOT NULL DEFAULT 0,
  trial_to_plan     TEXT,                              -- where a trial lands
  requires_payment_method BOOLEAN NOT NULL DEFAULT true,
  is_active         BOOLEAN NOT NULL DEFAULT true,     -- may be subscribed to
  is_public         BOOLEAN NOT NULL DEFAULT true,     -- shown on the pricing page
  sort_order        INTEGER NOT NULL DEFAULT 0,
  limits            JSONB NOT NULL DEFAULT '{}',       -- usage caps, by key
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Features ────────────────────────────────────────────────────────────────
-- A feature is a named capability, not a page. The application asks
-- "is `attendance` entitled here" and gets an answer from the plan; it does not
-- ask which plan the school is on. That indirection is what lets the Superadmin
-- move a feature between plans without touching a line of application code.
CREATE TABLE IF NOT EXISTS features (
  feature_key  TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT 'General',
  -- A core feature cannot be withheld from any plan. Signing in, seeing your
  -- own school and paying your bill are not upsells.
  is_core      BOOLEAN NOT NULL DEFAULT false,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plan_features (
  plan_id      TEXT NOT NULL REFERENCES subscription_plans(plan_id) ON DELETE CASCADE,
  feature_key  TEXT NOT NULL REFERENCES features(feature_key) ON DELETE CASCADE,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  limit_value  INTEGER,                                -- NULL = no numeric cap
  PRIMARY KEY (plan_id, feature_key)
);

-- ── Subscriptions ───────────────────────────────────────────────────────────
-- Edusoft's own record of what a school is entitled to. Deliberately NOT the
-- payment provider's: the provider is asked about money, and is never asked
-- whether a school may open its register. A provider outage, a webhook lost in
-- the night or an account closed by mistake must not lock a school out of its
-- own pupils' records.
CREATE TABLE IF NOT EXISTS subscriptions (
  id                BIGSERIAL PRIMARY KEY,
  school_id         TEXT NOT NULL,
  plan_id           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'TRIALING',
    -- TRIALING | ACTIVE | PAST_DUE | GRACE_PERIOD | SUSPENDED | CANCELLED | TERMINATED
  currency          TEXT NOT NULL DEFAULT 'GHS',
  billing_interval  TEXT NOT NULL DEFAULT 'monthly',
  -- What this school pays, when it is not simply the plan's price. A
  -- negotiation is a property of the subscription, never an edit to the plan:
  -- one school's deal must not move everybody else's price.
  base_price_override        NUMERIC(14,2),
  price_per_student_override NUMERIC(14,2),
  trial_ends_at        TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  grace_ends_at        TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  cancelled_at         TIMESTAMPTZ,
  ended_at             TIMESTAMPTZ,
  provider             TEXT,
  provider_customer_id     TEXT,
  provider_subscription_id TEXT,
  notes             TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_school ON subscriptions(school_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
-- One live subscription per school, enforced by the database rather than by
-- everybody remembering to check. A double-submitted checkout is the ordinary
-- way a school ends up paying twice, and it is not a thing an application-level
-- guard reliably catches under a retry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_one_live ON subscriptions(school_id)
  WHERE status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'SUSPENDED');

CREATE TABLE IF NOT EXISTS subscription_events (
  id              BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT,
  school_id       TEXT NOT NULL,
  at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  event           TEXT NOT NULL,
  from_status     TEXT,
  to_status       TEXT,
  detail          TEXT NOT NULL DEFAULT '',
  actor           TEXT NOT NULL DEFAULT 'system'
);
CREATE INDEX IF NOT EXISTS idx_sub_events_school ON subscription_events(school_id, at DESC);

-- ── Discounts ───────────────────────────────────────────────────────────────
-- A price one school pays, below the plan's. The plan is untouched; the reason
-- is recorded; and it can be made to end on a date or after a number of
-- billing cycles, because "a discount somebody granted in 2026 and forgot" is
-- how a SaaS business quietly loses its margin.
CREATE TABLE IF NOT EXISTS school_discounts (
  id           BIGSERIAL PRIMARY KEY,
  school_id    TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'percent',    -- percent | fixed
  value        NUMERIC(14,2) NOT NULL DEFAULT 0,
  label        TEXT NOT NULL DEFAULT '',
  reason       TEXT NOT NULL DEFAULT '',
  starts_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at      TIMESTAMPTZ,                        -- NULL = until revoked
  cycles       INTEGER,                            -- NULL = every cycle
  cycles_used  INTEGER NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_by   TEXT NOT NULL DEFAULT 'platform',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ,
  revoked_by   TEXT
);
CREATE INDEX IF NOT EXISTS idx_discounts_school ON school_discounts(school_id, is_active);

-- ── Exemptions ──────────────────────────────────────────────────────────────
-- Deliberately NOT a 100% discount, and deliberately not "set the price to
-- zero". A school Nickland has decided not to charge — a pilot, a mission
-- school, a partner — is a different fact from a school that negotiated a
-- price, and the difference has to survive into the reporting: an exempt school
-- must never appear in the same column as a school that simply has not paid.
CREATE TABLE IF NOT EXISTS payment_exemptions (
  id           BIGSERIAL PRIMARY KEY,
  school_id    TEXT NOT NULL,
  percent      NUMERIC(6,2) NOT NULL DEFAULT 100,  -- partial exemptions allowed
  reason       TEXT NOT NULL DEFAULT '',
  starts_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at      TIMESTAMPTZ,                        -- NULL = permanent
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_by   TEXT NOT NULL DEFAULT 'platform',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ,
  revoked_by   TEXT
);
CREATE INDEX IF NOT EXISTS idx_exemptions_school ON payment_exemptions(school_id, is_active);

-- ── Payment methods ─────────────────────────────────────────────────────────
-- References, never instruments. No column here can hold a card number,
-- because none of these columns is wide enough to be useful for one and
-- because the provider holds the card. What Edusoft keeps is the handle the
-- provider gave it, plus the four digits a bursar needs to recognise which
-- card of theirs it is.
CREATE TABLE IF NOT EXISTS payment_methods (
  id                   BIGSERIAL PRIMARY KEY,
  school_id            TEXT NOT NULL,
  provider             TEXT NOT NULL DEFAULT 'paystack',
  provider_customer_id TEXT,
  provider_method_ref  TEXT,
  kind                 TEXT NOT NULL DEFAULT 'card',    -- card | mobile_money | bank
  brand                TEXT NOT NULL DEFAULT '',
  last4                TEXT NOT NULL DEFAULT '',
  exp_month            INTEGER,
  exp_year             INTEGER,
  email                TEXT NOT NULL DEFAULT '',
  is_default           BOOLEAN NOT NULL DEFAULT true,
  status               TEXT NOT NULL DEFAULT 'active',  -- active | expired | removed
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_methods_school ON payment_methods(school_id, status);

-- ── Invoices ────────────────────────────────────────────────────────────────
-- Every figure that went into the total is written down ON the invoice. Not
-- joined to the plan, not recomputed on read — copied. A price the Superadmin
-- changes in March must not silently rewrite what a school was billed in
-- January, and an invoice that recalculates itself is not a record, it is a
-- view that happens to look like one.
CREATE TABLE IF NOT EXISTS invoices (
  id                BIGSERIAL PRIMARY KEY,
  invoice_number    TEXT NOT NULL UNIQUE,
  school_id         TEXT NOT NULL,
  school_name       TEXT NOT NULL DEFAULT '',
  subscription_id   BIGINT,
  plan_id           TEXT NOT NULL DEFAULT '',
  plan_name         TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'DRAFT',   -- DRAFT|OPEN|PAID|PAST_DUE|VOID|EXEMPT
  currency          TEXT NOT NULL DEFAULT 'GHS',
  period_start      TIMESTAMPTZ,
  period_end        TIMESTAMPTZ,
  student_count     INTEGER NOT NULL DEFAULT 0,
  price_per_student NUMERIC(14,2) NOT NULL DEFAULT 0,
  base_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_detail   TEXT NOT NULL DEFAULT '',
  exemption_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  exemption_detail  TEXT NOT NULL DEFAULT '',
  tax_rate          NUMERIC(6,3) NOT NULL DEFAULT 0,
  tax_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid       NUMERIC(14,2) NOT NULL DEFAULT 0,
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at            TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,
  voided_at         TIMESTAMPTZ,
  notes             TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_school ON invoices(school_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status, due_at);
-- One invoice per subscription per period. The billing run is a loop over
-- schools that can be interrupted and restarted, and this is what makes
-- restarting it safe rather than expensive.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_period
  ON invoices(school_id, subscription_id, period_start)
  WHERE status <> 'VOID';

CREATE TABLE IF NOT EXISTS invoice_items (
  id          BIGSERIAL PRIMARY KEY,
  invoice_id  BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  school_id   TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'subscription',
  description TEXT NOT NULL DEFAULT '',
  quantity    NUMERIC(14,2) NOT NULL DEFAULT 1,
  unit_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id, sort_order);

-- ── Payments ────────────────────────────────────────────────────────────────
-- What the provider actually did. `provider_reference` is UNIQUE, and that
-- single constraint is the whole duplicate-payment defence: a webhook
-- redelivered four times, a callback raced against a webhook, a retry after a
-- timeout — all of them land on the same reference and the second one loses.
CREATE TABLE IF NOT EXISTS platform_payments (
  id                 BIGSERIAL PRIMARY KEY,
  school_id          TEXT NOT NULL,
  invoice_id         BIGINT,
  subscription_id    BIGINT,
  provider           TEXT NOT NULL DEFAULT 'paystack',
  provider_reference TEXT NOT NULL UNIQUE,
  amount             NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT 'GHS',
  status             TEXT NOT NULL DEFAULT 'pending',  -- pending|succeeded|failed|refunded
  kind               TEXT NOT NULL DEFAULT 'subscription', -- subscription|setup|manual
  failure_reason     TEXT NOT NULL DEFAULT '',
  gateway_status     TEXT NOT NULL DEFAULT '',
  attempted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at         TIMESTAMPTZ,
  refunded_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_payments_school ON platform_payments(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_payments_invoice ON platform_payments(invoice_id);

-- Every webhook the platform has already acted on. The signature says the
-- message is genuine; this says it is NEW. Both are needed, and only the
-- second one survives a provider that delivers the same genuine message twice.
CREATE TABLE IF NOT EXISTS billing_webhook_events (
  event_id    TEXT PRIMARY KEY,
  provider    TEXT NOT NULL DEFAULT 'paystack',
  event       TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Document seals ──────────────────────────────────────────────────────────
-- The strongest part of the licensing design, and the only part a patched
-- desktop cannot reach: a short signed statement that WE issued a particular
-- receipt or report card, printed on it and checkable by anybody at /verify.
--
-- Minting one needs the private signing key, which is on this service and on
-- no school's computer. So a cracked copy still runs and simply cannot produce
-- paperwork that verifies — which is a far better position to argue from than
-- a licence check somebody has already removed.
--
-- Drawn in batches while online and spent offline, exactly as a chequebook is,
-- so a paying school never notices this exists.
CREATE TABLE IF NOT EXISTS document_seals (
  id         BIGSERIAL PRIMARY KEY,
  school_id  TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'receipt',
  serial     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'issued',
  reference  TEXT NOT NULL DEFAULT '',
  device_id  TEXT NOT NULL DEFAULT '',
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  spent_at   TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The serial is the document's identity, platform-wide. UNIQUE because two
-- documents with the same verification code is the one thing that would make
-- the whole mechanism worthless.
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_seal_serial
  ON document_seals (serial);
CREATE INDEX IF NOT EXISTS idx_document_seal_stock
  ON document_seals (school_id, kind, status);

-- ── Activated devices (seats) ───────────────────────────────────────────────
-- Which computers and phones a school has activated, and when each last spoke
-- to us. The model is Adobe's and Filmora's, because it is the one customers
-- already understand: you sign in on a machine, that machine takes a seat, and
-- when you run out of seats you deactivate one you are not using.
--
-- Without this, one school's credentials run an unlimited number of installs —
-- which is how a single Pro subscription ends up serving a district.
--
-- `device_id` is a hash the desktop computes from the machine it is on (see
-- electron/licence/index.js). Hashed there rather than sent raw, so what is
-- stored here is not a MAC address and is no use to anybody who reads it.
CREATE TABLE IF NOT EXISTS school_devices (
  id             BIGSERIAL PRIMARY KEY,
  school_id      TEXT NOT NULL,
  device_id      TEXT NOT NULL,
  label          TEXT NOT NULL DEFAULT '',
  platform       TEXT NOT NULL DEFAULT '',
  app            TEXT NOT NULL DEFAULT 'desktop',
  app_version    TEXT NOT NULL DEFAULT '',
  -- What the running code hashes to (electron/licence/integrity.js). A
  -- value that is not one we published means those files changed after we
  -- built them, which the console shows and the licence endpoint records.
  build_id       TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'active',
  activated_by   TEXT NOT NULL DEFAULT '',
  -- This device's OWN credential, hashed. Each activated machine gets its own
  -- rather than sharing the school's single sync key, for one decisive reason:
  -- a shared key cannot be revoked for one computer. With this, Deactivate cuts
  -- off the stolen laptop at the next request and leaves the office PC working,
  -- which is what a person pressing that button expects it to mean.
  token_hash     TEXT NOT NULL DEFAULT '',
  last_seen_at   TIMESTAMPTZ,
  last_ip        TEXT NOT NULL DEFAULT '',
  deactivated_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per machine per school. A machine that is deactivated and later
-- signed back in RE-USES its row rather than taking a second seat, which is
-- what makes "reinstall Windows and activate again" not eat a school's seats.
CREATE UNIQUE INDEX IF NOT EXISTS idx_school_device_once
  ON school_devices (school_id, device_id);
CREATE INDEX IF NOT EXISTS idx_school_device_active
  ON school_devices (school_id, status);

-- ── Renewal reminders ───────────────────────────────────────────────────────
-- One row per reminder actually sent, and the UNIQUE is the whole point: a
-- billing run that is retried, or two workers running it at once, must not
-- send a school the same "your subscription ends in 7 days" twice. A school
-- told twice in one morning reads it as a system that is broken, and a school
-- told daily stops reading any of them.
--
-- `stage` is what the reminder was about — `before_7`, `expired`, `grace_3` —
-- so the row is the answer to "have we told them about THIS yet", per channel.
CREATE TABLE IF NOT EXISTS billing_reminders (
  id              BIGSERIAL PRIMARY KEY,
  school_id       TEXT NOT NULL,
  subscription_id BIGINT,
  stage           TEXT NOT NULL,
  channel         TEXT NOT NULL,
  period_end      TEXT NOT NULL DEFAULT '',
  recipient       TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'sent',
  detail          TEXT NOT NULL DEFAULT '',
  read_at         TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The same school, the same stage, the same channel, the same person, for the
-- same period — once. `period_end` is in the key so that next term's "7 days
-- left" is a different reminder from this term's without anything having to be
-- cleared, and `recipient` is in it because the head teacher who registered
-- and the bursar who pays are usually two people and both have to be told.
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_reminder_once
  ON billing_reminders (school_id, stage, channel, period_end, recipient);
CREATE INDEX IF NOT EXISTS idx_billing_reminder_school
  ON billing_reminders (school_id, sent_at DESC);

-- ── Usage ───────────────────────────────────────────────────────────────────
-- What a school's roll was, on a date. Kept as a series rather than read live,
-- because "how many pupils did this school have when we billed it" is a
-- question an invoice dispute asks six months later, and the live count will
-- have moved on by then.
CREATE TABLE IF NOT EXISTS usage_snapshots (
  id                BIGSERIAL PRIMARY KEY,
  school_id         TEXT NOT NULL,
  captured_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  plan_id           TEXT NOT NULL DEFAULT '',
  billable_students INTEGER NOT NULL DEFAULT 0,
  total_students    INTEGER NOT NULL DEFAULT 0,
  staff_count       INTEGER NOT NULL DEFAULT 0,
  detail            JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_usage_school ON usage_snapshots(school_id, captured_at DESC);

-- ── Platform settings ───────────────────────────────────────────────────────
-- The SaaS rules that are not a plan: grace periods, tax, the currency, what
-- happens to a school that has never had a subscription. Configuration, in the
-- database, so an operator changes them in the console and not in a deploy.
CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Who runs the platform ───────────────────────────────────────────────────
-- The Superadmin console is signed into with an account, not with the
-- environment variable. PLATFORM_ADMIN_KEY still exists and still works — it is
-- the machine-to-machine key, and it is how the FIRST operator account is
-- created on a fresh deployment — but a console that asked for it at a login
-- box would mean every operator shares one credential and the audit log says
-- "platform" for all of them.
CREATE TABLE IF NOT EXISTS platform_users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'superadmin',   -- superadmin | support
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- ── The directory that makes one account work everywhere ────────────────────
-- A school administrator registers on the public website with an email address.
-- Their PASSWORD lives where it always has — in their own school's `users`
-- table, inside their own schema, hashed by the same code the desktop uses.
-- Nothing about the school's authentication changes.
--
-- What was missing was only the signpost: given an email typed at
-- www.edusoft…, WHICH school's schema should the password be checked against?
-- Scanning every tenant would be both slow and a way to enumerate schools. So
-- this table holds that one mapping and nothing else — no password, no
-- permissions, no session. It answers "which door", and the door does the rest.
CREATE TABLE IF NOT EXISTS platform_identities (
  id         BIGSERIAL PRIMARY KEY,
  email      TEXT NOT NULL,
  school_id  TEXT NOT NULL,
  username   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'school_admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email, school_id)
);
CREATE INDEX IF NOT EXISTS idx_identities_email ON platform_identities(email);

-- ── A school's lifecycle on the platform ────────────────────────────────────
-- `schools` says a school exists and holds its sync key. This says what the
-- platform has decided about it: suspended for non-payment, archived after
-- leaving, or simply live. Kept apart from `schools` so that retiring a school
-- never touches the row its data is keyed by.
ALTER TABLE schools ADD COLUMN IF NOT EXISTS lifecycle TEXT NOT NULL DEFAULT 'active';
  -- active | suspended | archived
ALTER TABLE schools ADD COLUMN IF NOT EXISTS contact_email TEXT NOT NULL DEFAULT '';
ALTER TABLE schools ADD COLUMN IF NOT EXISTS contact_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE schools ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT '';
ALTER TABLE schools ADD COLUMN IF NOT EXISTS lifecycle_note TEXT NOT NULL DEFAULT '';

-- ── Columns added after a table first shipped ───────────────────────────────
-- `CREATE TABLE IF NOT EXISTS` above does nothing to a table that already
-- exists, so every column added to one after its first release has to be
-- ALTERed in here as well. Forgetting is not a subtle failure: the repository
-- names the column in its SELECT list and every read of the table raises
-- UndefinedColumn on exactly the deployments that have been running longest.
ALTER TABLE school_devices ADD COLUMN IF NOT EXISTS build_id TEXT NOT NULL DEFAULT '';
ALTER TABLE school_devices ADD COLUMN IF NOT EXISTS token_hash TEXT NOT NULL DEFAULT '';

-- ── A school's own payment gateway ──────────────────────────────────────────
-- The credentials a SCHOOL uses to take fees from ITS parents. Not Nickland's,
-- and never mixed with Nickland's: see `platform_gateways` below.
--
-- This table has been read and written by `app/store.py` since internet
-- payments shipped, and nothing in this repository ever created it. On
-- Postgres that meant a school switching online payments on from its desktop
-- got a 500 from `/api/v1/admin/payment-config`, and no parent could ever pay
-- through the cloud — the in-memory store the tests run on has no tables, so
-- every test passed. It is created here, with the columns the code already
-- expects plus the ones a multi-gateway platform needs.
--
-- `credentials` is the new half and the reason this is a JSONB column rather
-- than more named ones: Paystack needs a secret key, Hubtel needs an API id, an
-- API key and a merchant account number, ExpressPay needs a merchant id — and a
-- table with a column per provider per field would need a migration every time
-- a school asks for a provider it already banks with. The adapter declares its
-- fields (`app/gateways/`), and only fields it declared are ever stored.
--
-- Nothing here is ever served. There is no route that reads `credentials` or
-- `secret` back out, and there must never be one: a screen that needs to show
-- which key is in use is given `••••` and the last four characters.
CREATE TABLE IF NOT EXISTS school_payments (
  school_id    TEXT PRIMARY KEY REFERENCES schools(school_id) ON DELETE CASCADE,
  gateway      TEXT NOT NULL DEFAULT 'none',
  secret       TEXT NOT NULL DEFAULT '',      -- Paystack's, kept for the desktops that push it
  public_key   TEXT NOT NULL DEFAULT '',
  base_url     TEXT NOT NULL DEFAULT '',
  currency     TEXT NOT NULL DEFAULT 'GHS',
  callback_url TEXT NOT NULL DEFAULT '',
  min_amount   NUMERIC(14,2) NOT NULL DEFAULT 1,
  max_amount   NUMERIC(14,2) NOT NULL DEFAULT 10000,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  credentials  JSONB NOT NULL DEFAULT '{}',
  -- A gateway is not live until a test against the real provider has passed.
  -- These two say when, and what the provider answered. A configuration that
  -- has never been tested cannot be switched on — which is what stops a wrong
  -- key being found by a parent rather than by the bursar who typed it.
  verified_at     TIMESTAMPTZ,
  verified_detail TEXT NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE school_payments ADD COLUMN IF NOT EXISTS credentials JSONB NOT NULL DEFAULT '{}';
ALTER TABLE school_payments ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE school_payments ADD COLUMN IF NOT EXISTS verified_detail TEXT NOT NULL DEFAULT '';

-- ── Nickland's own gateway ──────────────────────────────────────────────────
-- The other direction of money entirely: the platform charging a school its
-- subscription. One row per provider configured, at most one of them active.
--
-- Kept apart from `school_payments` for the reason the two have been kept apart
-- everywhere else — a school's gateway secret must never be able to say a
-- SUBSCRIPTION was paid, and Nickland's must never appear on a school's screen.
-- Separate tables make that structural rather than remembered.
CREATE TABLE IF NOT EXISTS platform_gateways (
  gateway         TEXT PRIMARY KEY,
  credentials     JSONB NOT NULL DEFAULT '{}',
  currency        TEXT NOT NULL DEFAULT 'GHS',
  callback_url    TEXT NOT NULL DEFAULT '',
  is_active       BOOLEAN NOT NULL DEFAULT false,
  verified_at     TIMESTAMPTZ,
  verified_detail TEXT NOT NULL DEFAULT '',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One active gateway at a time, enforced by the database. Two would make
-- "which provider settled this subscription" a question with two answers.
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_gateway_active
  ON platform_gateways((is_active)) WHERE is_active;

-- ── What goes IN these tables ───────────────────────────────────────────────
-- Nothing. The three plans, the sixteen features, the plan/feature grid and the
-- platform's default settings are seeded from `app/billing/defaults.py` at
-- boot, not from this file.
--
-- They were seeded here first, and that was a mistake worth recording: the
-- in-memory store the tests run on never executes SQL, so the defaults existed
-- in Postgres and not in memory, and the two had to be written twice and kept
-- in step by hand. Seeding from Python instead means the tests exercise the
-- same rows production gets.
--
-- The seed is insert-if-absent, so a Superadmin who has since changed Pro's
-- price does not get it reset on the next restart. A seed is a starting point,
-- never a definition.
