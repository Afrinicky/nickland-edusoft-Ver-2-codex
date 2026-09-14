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
