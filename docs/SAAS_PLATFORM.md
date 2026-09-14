# The Edusoft platform — website, school application, Superadmin console

One product, one backend, one database, three interfaces. This page is the
reference for how they fit together and for the subscription and billing engine
that sits under all of them.

> **The architectural rule everything here follows.** The website, the cloud
> application and the Superadmin console are three faces of one platform. They
> share authentication, the API, the multi-tenant database, the subscription
> engine, the billing engine and feature entitlements. They are not three
> applications with three copies of a school's details in them.

---

## 1. The shape of it

```
                        ┌───────────────────────────────┐
 www.edusoft.<domain>   │   Public website              │  cloud-python/site
                        │   home · features · pricing   │
                        │   about · support · register  │
                        └───────────────┬───────────────┘
                                        │
 app.edusoft.<domain>   ┌───────────────▼───────────────┐
 <school>.edusoft.<..>  │   School cloud application    │  mobile/ (Expo web)
                        │   pupils · academics · fees   │
                        └───────────────┬───────────────┘
                                        │
 admin.edusoft.<domain> ┌───────────────▼───────────────┐
                        │   Superadmin console          │  cloud-python/console
                        │   schools · plans · billing   │
                        └───────────────┬───────────────┘
                                        │
 api.edusoft.<domain>   ┌───────────────▼───────────────┐
                        │   One FastAPI service         │  cloud-python/app
                        │   auth · tenants · billing    │
                        └───────────────┬───────────────┘
                                        │
                        ┌───────────────▼───────────────┐
                        │   One Postgres                │
                        │   public.*   the platform     │
                        │   school_*   one per school   │
                        └───────────────────────────────┘
```

`/api/v1/*` answers identically on every hostname. The hostname decides only
which HTML is served — see `app/site.py`. A deployment that has configured no
`PORTAL_BASE_DOMAIN` keeps the behaviour it always had: the school application
at `/`, the website at `/welcome`, the console at `/console`.

---

## 2. Where each thing lives

| | |
|---|---|
| `cloud-python/site/` | The public website. Plain HTML, CSS and JS — no build step. |
| `cloud-python/console/` | The Superadmin console. Likewise. |
| `mobile/` | The school application (and the parents' app). Expo; built into the image. |
| `cloud-python/app/billing/` | The subscription and billing engine. |
| `cloud-python/app/public_api.py` | Pricing, registration, the shared sign-in. |
| `cloud-python/app/admin_api.py` | The console's API. |
| `cloud-python/app/billing_api.py` | A school's own billing section. |
| `cloud-python/app/identity.py` | One account across the three interfaces. |
| `cloud-python/app/site.py` | Which hostname gets which interface. |
| `cloud-python/schema-saas.sql` | The platform's subscription and billing tables. |
| `cloud-python/schema/school.sql` | A school's own 81 tables — **unchanged**. |

**Nothing in a school's own schema changed.** The offline system's schema is the
online system's schema, column for column, and that is what keeps the desktop
and the cloud the same product. Every table this work added is platform-level,
in `public`, keyed by `school_id`.

---

## 3. Tenancy

Each school is a Postgres **schema** (`school_ave_maria`), not a `school_id`
column on shared tables. Every connection is pinned to one school's schema and
to nothing else — not even `public` — so a query that forgets a `WHERE` clause
fails rather than finding another school's pupils. See `app/school/db.py`.

The platform's own tables are the exception, and are the only tables that hold
rows about more than one school: subscriptions, invoices, payments, discounts,
exemptions, usage, the audit trail. They are read by the billing engine, by the
console, and by the one school each row is about — never by another school.

---

## 4. One account, three interfaces

A school registers on the website. That creates, in this order:

```
tenant schema  →  administrator account  →  registry row  →
identity  →  subscription  →  signed-in token
```

The administrator's **password never leaves the school's own schema**. It is
bcrypt-hashed into that school's `users` table by the same
`app/school/session.py` the desktop uses, so a school that has been running for
two years is not re-enrolled and the offline and online systems still agree
about who somebody is.

The one thing that was missing is a signpost: given an email typed at
`www.edusoft…`, which school's schema should the password be checked against?
`platform_identities` answers that and nothing else — email → school. No
password, no permission, no session.

Sign-in returns the same `<school_id>.<token>` credential the cloud application
already uses, and the website hands it over in the redirect. The app adopts it
once and strips it from the address bar (`mobile/src/auth.jsx`,
`readHandoff`). One account, one sign-in, no second password box.

---

## 5. Plans and features

Everything about a plan is a row. **There is no `if plan == "pro"` anywhere in
this codebase, and there must never be one.**

| Table | Holds |
|---|---|
| `subscription_plans` | name, prices, interval, trial rules, ceilings, limits |
| `features` | the named capabilities (`academics`, `payroll`, `sms`, …) |
| `plan_features` | which plan holds which feature, and any numeric cap |

The first ten feature keys are the application's own modules
(`app/school/access.py` `MODULES`), deliberately: permission and entitlement
speak one vocabulary, so the enforcement point asks both questions about the
same word.

A feature marked `is_core` is held by every plan and cannot be withheld.
Signing in, seeing your own school and paying your bill are not upsells.

Changing a price, or moving a feature between plans, takes effect on the next
request every school makes. No deployment, no restart. The public pricing page,
the checkout, the billing portal, the invoice and the console all read these
same rows (§16), which is why they cannot disagree.

Defaults are seeded from `app/billing/defaults.py` at boot, **insert-if-absent**
— a restart never overwrites what an operator has since changed.

---

## 6. The billing engine

`app/billing/engine.py`, and every screen that shows a school a figure calls it:

```
Plan
  ↓
Billable pupils            (app/billing/usage.py)
  ↓
base price + pupils × price per pupil      = GROSS
  ↓
school discount                            − discount
  ↓
payment exemption                          − exemption
  ↓
tax                                        + tax
  ↓
                                           = FINAL
```

**Billable pupils** are those whose `students.status` is in
`billable_student_statuses` (default `Active`). Withdrawn, graduated and
archived pupils are in the school's database and are not charged for. A school
that syncs from a desktop rather than being hosted is counted from its pupil
snapshots instead, and `source` says which of the two answered.

**A negotiated price** lives on the subscription
(`price_per_student_override`), never on the plan. One school's deal must not
move everybody else's price.

---

## 7. Discounts and exemptions are different things

| | Discount | Exemption |
|---|---|---|
| What it means | the school pays less | Nickland has decided not to charge |
| Table | `school_discounts` | `payment_exemptions` |
| On the invoice | `discount_amount` | `exemption_amount` |
| Invoice status | unchanged | `EXEMPT` |
| A payment is attempted | yes | **no** |
| In the revenue report | a deduction from gross | its own line, never "unpaid" |
| Reason required | no | **yes** |

Both can expire on a date; a discount can additionally be limited to a number
of billing cycles. Both are audited on grant and on withdrawal, with who did
it.

Exemption is deliberately **not** "set their price to zero". A zero price makes
an exempt school indistinguishable from a school on a free plan, and at the end
of the quarter it sits in the same column as a school that simply has not paid.

A zero-value invoice for an ordinary school (no pupils yet, on a per-pupil
plan) is marked `PAID` at zero, not `EXEMPT` — for the same reason.

---

## 8. The subscription lifecycle

```
TRIALING ──► ACTIVE ──► PAST_DUE ──► GRACE_PERIOD ──► SUSPENDED
    │           ▲           │             │              │
    │           └───────────┴─────────────┴──────────────┘
    │                    payment succeeds
    └──► CANCELLED ──► TERMINATED
```

| Status | Access | Means |
|---|---|---|
| `TRIALING` | full | inside the free period |
| `ACTIVE` | full | paid up |
| `PAST_DUE` | full | a payment failed; the school has been told, nothing withheld |
| `GRACE_PERIOD` | full | still unpaid, warnings louder |
| `SUSPENDED` | read-only¹ | unpaid past the grace period |
| `CANCELLED` | read-only | ended; their records are still theirs to read and export |
| `TERMINATED` | blocked | closed |

¹ `suspended_access`, a platform setting. `read_only` or `blocked`. Never
anything that deletes: **suspension does not destroy data, ever**, and a
suspended school regains everything the moment it pays.

One live subscription per school is enforced by a **partial unique index**, not
by an application check — a double-submitted checkout loses on the second
insert rather than on somebody remembering to look first.

Edusoft's subscription state is the source of truth, not the payment
provider's. The provider is asked about money and is never asked whether a
school may open its register.

---

## 9. Invoices

Every figure that went into the total is **copied onto the invoice** when it is
issued: the pupil count, the price per pupil, the discount that applied and
what it was called, the exemption and why. Nothing is a foreign key to
something an operator can edit later. Repricing Pro in March cannot move what
January's invoice says.

Statuses: `DRAFT`, `OPEN`, `PAID`, `PAST_DUE`, `VOID`, `EXEMPT`.

One invoice per subscription per period, enforced by a unique index, which is
what makes the billing run safe to restart after it dies half way through a
hundred schools.

---

## 10. Payments

Two completely separate paths, and they share no key, no reference and no
table:

| | A school taking fees from a parent | Nickland taking a subscription from a school |
|---|---|---|
| Code | `app/payments.py` | `app/billing/provider.py` |
| Key | the school's own, pushed up by its desktop | `PLATFORM_PAYSTACK_SECRET` |
| Webhook | `/api/v1/payments/webhook/{school_id}` | `/api/v1/billing/webhook` |
| Table | `school_payments` | `platform_payments` |

No card number is ever stored. What Edusoft keeps is the provider's customer
id, an authorisation reference, the brand and the last four digits.

The webhook path is:

1. **Verified** — HMAC over the raw bytes, before a single field is believed.
2. **Idempotent** — every event id is written to `billing_webhook_events`
   before it is acted on. The signature proves a message is genuine; only this
   proves it is *new*.
3. **Not trusted about money** — the amount is re-read from the provider.

`provider_reference` is `UNIQUE`, and that one constraint is the whole
duplicate-payment defence.

**A trial takes a card without charging it.** A zero-amount checkout is not a
checkout, so the provider is asked to authorise the card for a minimal amount
instead; the school has a payment method on file for when the trial ends.

---

## 11. Entitlement enforcement

`app/billing/entitlements.py`, enforced in `app/school_api.py` at `require()` —
the one place every guarded route already passes through. A rule enforced in
ninety places is a rule that is missing from one of them.

Two questions, in this order:

1. **Permission** — may this *person* do this? (the school's own access ladder)
2. **Entitlement** — may this *school* do this? (its plan and its subscription)

A head teacher with every permission in the building still cannot open Payroll
if the school is on a plan that does not include it, and nobody at all can
write to a school whose subscription is suspended.

Refusals are distinguishable, because they lead to different screens:

| | Status | Body |
|---|---|---|
| Subscription | `402` | `subscription_required: true` |
| Feature | `403` | `upgrade_required: true` |

Three rules worth knowing before changing anything here:

* **Grandfathering (§28).** A school that has *never* had a subscription keeps
  full access, indefinitely, until somebody deliberately subscribes it.
  Introducing billing must never be why a school that worked yesterday cannot
  open its register this morning. `grandfather_existing`, default on.
* **Failing open on our faults.** If the billing tables cannot be read, the
  answer is full access. A school locked out because Nickland's platform had a
  bad morning is a far worse outcome than a day of Payroll nobody paid for.
* **The billing portal is never gated.** A suspended school has to reach the
  page that says so and the button that fixes it. That is why
  `app/billing_api.py` is a separate router.

---

## 12. The Superadmin console

`admin.edusoft.<domain>`, or `/console`.

Two ways in. **A person signs in** with an account in `platform_users` — which
is what makes the audit trail say *who* granted an exemption. **A machine
presents `PLATFORM_ADMIN_KEY`** in `x-platform-key`, which is also how the first
operator account is created on a fresh deployment. A platform with neither has
no console at all and does not fall back to something weaker.

It covers: schools, plans, features, subscriptions, discounts, exemptions,
payments, invoices, usage, revenue reporting, system settings, operators and
the audit trail.

**It cannot read a school's pupils, marks, fees or parents.** Not an oversight:
"overall access to the platform" means the platform. Suspending a school,
seeing that it has 412 pupils and billing it are all here; opening one of those
412 is not, and there is no route that does.

---

## 13. The revenue report (§27)

```
Gross subscription value
  − discounts
  − exemptions
  = net billed
  − collected
  = outstanding
```

An exempt invoice is neither collected nor outstanding. Nobody owes it and
nobody paid it, and it must never appear beside a school that has simply not
paid.

---

## 14. The billing run

`invoices.run_billing`, in this order, every step idempotent:

1. Move subscriptions along — trials that ended, cancellations due, grace that
   ran out.
2. Raise an invoice for any live subscription whose period has closed and which
   has not already been billed for it.
3. Age open invoices past their due date and mark their schools `PAST_DUE`.

Run it from the console ("Run billing now") or from a scheduler:

```bash
curl -fsS -X POST -H "x-cron-key: $BILLING_CRON_SECRET" \
     https://<service>/api/v1/admin/cron/billing-run
```

Daily is right. Running it twice in a minute does nothing the second time.

---

## 15. Configuration

| Variable | Required | What it does |
|---|---|---|
| `DATABASE_URL` | yes | Postgres/Neon, pooled, `?sslmode=require` |
| `PORTAL_SECRET` | yes | signs parent, staff and console sessions |
| `PLATFORM_ADMIN_KEY` | for the console | ≥ 24 characters, or platform administration stays off |
| `PORTAL_BASE_DOMAIN` | for subdomains | one or several, comma-separated; the first is canonical |
| `PLATFORM_PAYSTACK_SECRET` | to take money | Nickland's gateway key — **not** a school's |
| `PLATFORM_PAYSTACK_PUBLIC` | to take money | the publishable key the browser needs |
| `BILLING_CRON_SECRET` | for scheduling | ≥ 16 characters, or the cron route is not there |

Everything else — currency, tax, trial rules, grace periods, what a suspended
school may do, which pupils are billable — is a **row** in `platform_settings`,
editable in the console, live at once.

The boot log says which of these a running service actually has, in words:

```
[edusoft] store: pg
[edusoft] database: ready
[edusoft] subscriptions: ready
[edusoft] subscription payments: on
[edusoft] platform administration: on
[edusoft] school addresses: *.edusoft.gh
[edusoft] parents' app: served from this service
[edusoft] interfaces: website, superadmin console — on edusoft.gh: www → website,
          admin → console, every other name → the school application
```

---

## 16. Standing a platform up

1. Deploy the service with `DATABASE_URL`, `PORTAL_SECRET`,
   `PLATFORM_ADMIN_KEY` and `PORTAL_BASE_DOMAIN`. The tables are created on
   first boot and the plans, features and settings are seeded.
2. Point a wildcard DNS record (`*.edusoft.gh`) plus `www` and `admin` at it.
3. Open `admin.edusoft.<domain>`, choose **Create the first one**, and paste
   `PLATFORM_ADMIN_KEY`. That bootstrap closes as soon as one operator exists.
4. In the console: check **System settings**, set the prices under **Plans**,
   and set the plan/feature grid under **Features**.
5. Set `PLATFORM_PAYSTACK_SECRET` and `PLATFORM_PAYSTACK_PUBLIC` when you are
   ready to charge. Until then schools register, start trials and use
   everything, and no card is taken.
6. Schedule the billing run.

Existing schools need no migration and keep working (§11, grandfathering).
Subscribe them from the console when you are ready, or let each school choose a
plan from its own billing page.

---

## 17. Tests

```bash
export DATABASE_URL="postgres://…" ALLOW_DEV_SECRET=1
python3 cloud-python/tests/test_billing.py    # the engine, on the in-memory store
python3 cloud-python/tests/test_saas.py       # registration and enforcement, on Postgres
```

Both are in `npm run test:online`.

`test_billing.py` parses `schema-saas.sql` and asserts that every table's
columns match its spec in `app/billing/repo.py`, so a column added to one and
forgotten in the other is a failing test rather than a `KeyError` on a Tuesday.
