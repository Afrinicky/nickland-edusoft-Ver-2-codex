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
 PUBLIC_SITE_DOMAIN     ┌───────────────────────────────┐
 nicklandedusoft.com    │   Public website              │  cloud-python/site
                        │   home · features · pricing   │
                        │   about · support · register  │
                        └───────────────┬───────────────┘
                                        │
 PORTAL_BASE_DOMAIN     ┌───────────────▼───────────────┐
 edusoft.gh             │   School cloud application    │  mobile/ (Expo web)
 <school>.edusoft.gh    │   pupils · academics · fees   │
 app.edusoft.gh         └───────────────┬───────────────┘
                                        │
 CONSOLE_DOMAIN         ┌───────────────▼───────────────┐
 admin.nicklandedu…com  │   Superadmin console          │  cloud-python/console
                        │   schools · plans · billing   │
                        └───────────────┬───────────────┘
                                        │
 …and on all three      ┌───────────────▼───────────────┐
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

**Three domains, each named on its own and none borrowing from another.**
`/api/v1/*` answers identically on every hostname; the hostname decides only
which HTML is served — see `app/site.py`.

The portal domain is the schools', whole and undivided: its bare name, its
`www` and every subdomain of it reach the school application, exactly as they
always have. That is not a detail — parents and teachers have already been
given addresses under it, and a marketing page appearing at one of them is a
support call. The website and the console get domains of their own, or they get
nothing.

Matching is **exact**: a configured domain and its `www.`, never "ends with". A
suffix rule would make every subdomain of the website's domain the website, and
this has no reason to guess when it can be told — which is what lets the console
sit at `admin.nicklandedusoft.com` while the website is `nicklandedusoft.com`.
The console list is consulted first, so an explicitly named host always wins.

A deployment that configures none of this keeps the behaviour it always had:
the school application at `/`, the website at `/welcome`, the console at
`/console`. Those two paths work on a fully configured deployment too, which is
what makes local development possible — on `localhost` every hostname is the
same hostname.

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
| `cloud-python/app/gateways/` | The payment gateway adapters, and Arkesel SMS. |
| `cloud-python/app/school/integrations.py` | A school's own gateway and SMS setup. |
| `cloud-python/app/integrations_api.py` | The API behind that setup screen. |
| `mobile/src/screens/system/integrations.jsx` | The four-step setup screen itself. |
| `electron/server/gateways/` | The same four adapters, for the offline desktop. |
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
| Key | the school's own — set by the school, in its own portal | the console's live gateway, or `PLATFORM_PAYSTACK_SECRET` |
| Whose account the money lands in | **the school's** | Nickland's |
| Webhook | `/api/v1/payments/webhook/{school_id}` | `/api/v1/billing/webhook` |
| Table | `school_payments` | `platform_payments` |

Both sides go through the **same adapter layer** (§10a), so adding a provider
adds it to both at once.

No card number is ever stored. What Edusoft keeps is the provider's customer
id, an authorisation reference, the network (Visa, Mastercard, Verve) and the
last four digits — enough for a bursar to recognise which card is on file, and
nothing that would work anywhere else.

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

## 10a. The gateway adapters

`app/gateways/`. One file per provider, and one contract:

```python
checkout(cfg, amount, reference, email, metadata, callback_url)
verify(cfg, reference, token="")
verify_webhook(cfg, raw, headers)      # is this delivery genuine?
read_webhook(cfg, raw, headers)        # what does it say?
charge_stored(cfg, authorization, …)   # a renewal, with nobody present
ping(cfg)                              # are these credentials real?
```

Each adapter also **declares its own fields** — label, hint, whether it is a
secret, whether it is required — and the setup screen and the console are drawn
from those declarations. Adding a fifth provider is one file and no screen work.

| | Cards | Other channels | Signs callbacks | Charges a saved card | Verified live |
|---|---|---|---|---|---|
| Paystack | Visa, Mastercard, Verve | mobile money, bank | HMAC-SHA512 over the raw body | yes | **yes** |
| Flutterwave | Visa, Mastercard | mobile money, bank | a shared `verif-hash` | yes | no |
| Hubtel | Visa, Mastercard | mobile money | **no** | no | no |
| ExpressPay | Visa, Mastercard | mobile money | **no** | no | no |

Card networks are **declared, not assumed** (`card_brands` on each adapter).
The website prints what the live gateway actually accepts, so a deployment that
moves from Paystack to Flutterwave does not leave a page promising Verve to
schools whose gateway has never heard of it.

Two honest notes, because they change how much you should trust each one:

* **Flutterwave, Hubtel and ExpressPay are written from the providers'
  published contracts and have not been exercised against live accounts from
  inside this repository.** Each carries `verified = False`, which the setup
  screen and the console both display. That is the reason the Test rule below
  exists, and why it is a rule rather than a suggestion.
* **Arkesel payments is deliberately absent.** Arkesel publishes SMS, OTP, USSD
  and Voice APIs; its collections API is not publicly documented. Writing an
  adapter from guesswork and shipping it behind a Test button that could not
  meaningfully test it would be worse than not shipping it. Arkesel **SMS** is
  implemented and verified — `app/gateways/sms.py`, the same API the desktop has
  called for two releases.

**Unsigned callbacks are handled, not pretended about.** Hubtel and ExpressPay
do not sign. Their `verify_webhook` returns `False` — always — and the delivery
is treated as what it actually is: a nudge saying *go and look*. The looking is
`verify()`, over the school's own authenticated connection. Nothing is weaker
here than for Paystack, because settlement has never believed a webhook about an
amount; the only difference is that such a callback cannot by itself settle
anything, and the code says so.

**A subscription has to be set up on a card, and the checkout asks for one.**
Every provider here can take mobile money, and for a one-off invoice that is
usually what a school wants. But a mobile-money collection is a *one-off*: it
leaves no handle that can be charged next month. So a **setup** checkout — the
card check at the end of a trial (§7) — is narrowed to `reusable_channels`,
which on all four providers is the card and only the card. A school that paid
its trial check by mobile money would think it had a subscription and discover
at month end that there had never been anything to charge.

A **one-off** checkout is deliberately left unrestricted: there is nothing to
charge later, so the payer's own preference is the only thing that matters.

`remember_method()` is the backstop — an authorisation the provider marks
non-reusable is not filed as a payment method at all, because a billing page
showing one that silently fails at renewal is worse than one showing none.

**The Test rule.** A gateway cannot be switched on until `ping()` has passed,
and changing any credential clears the pass. A wrong key is therefore found by
the bursar who can fix it, and never by a parent at ten at night. `ping()` costs
nothing and moves no money: it asks the provider a question only a real
credential can get an answer to.

---

## 10b. A school's own setup

`mobile/src/screens/system/integrations.jsx` → `/api/v1/school/integrations`.
Four steps, in this order, because the person doing it is a bursar with the
provider's dashboard open in another tab:

1. **Choose your provider.**  2. **Paste what it gave you.**
3. **Press Test.**  4. **Switch it on** — which does not work until 3 passed.

Text messages to parents sit on the same screen, with the same shape. Leaving
the test number blank checks the key only and uses no credit; putting a number
in sends one real message, which is the only way to prove a sender ID has been
approved.

**Secrets are write-only.** A stored key comes back as `••••1234` and is never
readable by anyone — not on the screen, not in the console, not to support.
Re-posting the mask means "keep the one you have", so editing a sender ID does
not mean retyping a key nobody can see. Owner-only: `is_admin`, or a Nickland
super admin.

**Two kinds of grandfathering, both deliberate:**

* A school whose gateway was configured before this screen existed (its keys
  pushed up by its desktop) keeps working, untested and unblocked. The Test rule
  applies only where `gateway_credentials` exists, which only this screen
  writes.
* The console's **Payment gateway** page does the same job for Nickland's own
  subscription billing, and `PLATFORM_PAYSTACK_SECRET` still works when nothing
  is configured there.

**The desktop offers the same four** (`electron/server/gateways/`), so a school
that set up Hubtel on its own desktop and later moves to the portal — or the
other way round — does not change provider to do it. `test/gateways.js` asserts
the two lists are equal, so adding a provider to one side and not the other is a
failing test.

---

## 10c. No subscription, no usage — including offline

The cloud portal and the parents' app were always gated at
`school_api.require()`. **The desktop was not gated at all** — and the desktop
is the source of truth and runs without the internet. A school that stopped
paying could pull out the network cable and keep running it forever.

It cannot be closed by asking the desktop nicely: anything it decides for
itself, somebody can change, and a flag in its SQLite file is a flag a bursar
can edit. So the decision is made in the cloud and travels as a **short-lived
signed lease**.

```
  cloud                                     desktop
  ─────                                     ───────
  billing/licence.py                        electron/licence/
    Ed25519 PRIVATE key                       Ed25519 PUBLIC key
    signs {school, access, features,          verifies, and can refuse
           device, not_after}                 — it can never forge
           │                                        ▲
           └──── POST /api/v1/licence ──────────────┘
                 (every sync, and daily)
```

| Setting | Default | What it answers |
|---|---|---|
| `licence_lease_days` | 14 | how long a school that stopped **paying** keeps working |
| `licence_lease_grace_days` | 7 | how long a school with no **internet** keeps working |

Two different questions, deliberately given two different answers. Adobe does
the same thing and for the same reason — its offline grace is 30 days on
monthly plans and 99 on annual.

**What it actually stops.** Not a determined person with a debugger; nothing
shipped to somebody else's computer stops that, and pretending otherwise means
months on obfuscation that buys an afternoon. It stops every realistic thing:

| | how |
|---|---|
| going offline and staying there | the lease expires and will not renew |
| winding the clock back | a high-water mark of the latest moment ever seen |
| copying the folder to another PC | the lease names the machine it is for |
| reinstalling to get a new trial | the cloud remembers the school, not the install |
| editing the licence row by hand | the signature stops matching |
| an administrator overriding it | the gate is checked before the elevated shortcut |

**It never destroys anything.** Every expiry path ends in **read-only**: every
record readable, every report printable, every export available, and not one
new mark, payment or pupil. §11 says suspension must never delete a school's
data, and an expired lease is a kind of suspension. Backups and sign-in stay
open in every state, because a school must always be able to get its data out.

Enforced at the two chokepoints the desktop already had — `ipc/_guard.js` for
the office window and the dispatcher in `server/api.js` for a browser on the
school Wi-Fi — so a phone on the same network meets the same rule the desktop
does.

**A fresh install gets 30 days** (`ACTIVATION_DAYS`) before it must have
collected a licence. Without that, the first run of the first install would be
read-only and every existing school would arrive on Monday to a system that had
locked itself overnight. It is not a second free trial: the trial is the
cloud's, counted per school, and reinstalling to get another month gets you a
database with none of your pupils in it.

---

## 10d. Downloading is opting in

The model is Adobe's, which is what the installers of every paid desktop
product have converged on:

1. **Website** — choose a plan, register, give payment details. A free trial
   still takes them and charges GHS 0 (§7).
2. **Download** — `/download` hands over the installer, and only to an account
   with a live subscription. The build is the **same file for everybody**:
   there are no per-customer installers, because a build that has to be kept
   secret is a build that leaks once and is then worthless forever.
3. **Activate** — the installed app asks for the same email and password, and
   `POST /api/v1/activate` gives that machine its own credential and a lease.

So the download is free and inert, and the account is what is worth something.
That is the whole of the protection and the whole of what has ever worked.

**Seats.** `school_devices`, capped by the plan's `limits.devices`
(`default_device_seats`, 5, when a plan says nothing). Sign in on a machine and
it takes a seat; run out and you are told *which machines are using them*,
because "device limit reached" with no list is the most annoying error message
in consumer software. A school frees one itself from Billing — an operator
should never be the person handling a stolen laptop.

Each activated machine gets **its own credential**, not the school's shared
key. That is what makes Deactivate mean something: it cuts off that computer at
its very next request and leaves the office PC working. A machine that is wiped
and reactivated reclaims its existing row rather than eating a second seat.

---

## 10e. Renewal reminders

`billing/reminders.py`, modelled on how a consumer subscription does it,
because that is what schools are used to and it works: told early, told again
nearer, told on the day, told once when it has lapsed. Never nagged daily.

```
14 days · 7 days · 3 days · 1 day · the day · expired · grace · suspended
```

Configured as `reminder_days_before` (default `14,7,3,1`; zero is always added).
Three channels — the application itself, email and SMS — carrying **the same
words**, because the fastest way to lose a customer's trust is to tell them two
different things. Every one carries the Renew button.

**Sent once.** `billing_reminders` is UNIQUE over (school, stage, channel,
period, recipient) and the row is written *before* the message is attempted, so
a retried run or two racing workers produce one message. An SMS sent twice is
charged twice and read as a broken system.

**Our SMS key, not the school's.** A school being told it has lapsed must not
pay for the message, and a suspended school may have no credit left to send it
with (`platform_sms_key`).

**Renewal takes mobile money.** The card-only rule (§10a) is for putting an
instrument on file for a subscription that renews *itself*. A bursar renewing
by hand needs no such thing, and in Ghana that bursar pays by MoMo — refusing
it would mean a reminder whose button does not work. `POST /school/billing/renew`
is deliberately unrestricted.

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

Whatever `CONSOLE_DOMAIN` names, or `/console` on any address.

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
| `PORTAL_BASE_DOMAIN` | for subdomains | the schools' domain; one or several, comma-separated, the first canonical |
| `PUBLIC_SITE_DOMAIN` | for the website | the website's own domain; unset means `/welcome` only |
| `CONSOLE_DOMAIN` | for the console | the console's own domain; unset means `/console` only |
| `PLATFORM_PAYSTACK_SECRET` | fallback | Nickland's gateway key — **not** a school's. Superseded by a gateway configured in the console |
| `PLATFORM_PAYSTACK_PUBLIC` | fallback | the publishable key the browser needs |
| `BILLING_CRON_SECRET` | for scheduling | ≥ 16 characters, or the cron routes are not there |
| `LICENCE_SIGNING_KEY` | for offline licensing | Ed25519 private key, base64. Generated and stored in `platform_settings` if unset — which works, and is weaker, and the boot report says which |

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
[edusoft] public website: nicklandedusoft.com (also /welcome)
[edusoft] superadmin console: admin.nicklandedusoft.com (also /console)
```

Three separate lines because they are three separate decisions, and the
commonest deployment mistake is assuming one of them follows from another. An
interface with no domain configured says so and names the variable that would
give it one.

---

## 16. Standing a platform up

1. Deploy the service with `DATABASE_URL`, `PORTAL_SECRET`,
   `PLATFORM_ADMIN_KEY` and `PORTAL_BASE_DOMAIN`. The tables are created on
   first boot and the plans, features and settings are seeded.
   Add `PUBLIC_SITE_DOMAIN` and `CONSOLE_DOMAIN` if the website and the console
   are to have addresses of their own.
2. Point a wildcard DNS record (`*.edusoft.gh`) at it, and the website's and
   the console's domains too.
3. Open the console's domain (or `/console` on any address), choose **Create the
   first one**, and paste `PLATFORM_ADMIN_KEY`. That bootstrap closes as soon as
   one operator exists.
4. In the console: check **System settings**, set the prices under **Plans**,
   and set the plan/feature grid under **Features**.
5. Set up Nickland's own gateway under **Payment gateway** — paste the keys,
   press **Test connection**, then **Make this the live one**. (Or set
   `PLATFORM_PAYSTACK_SECRET` and `PLATFORM_PAYSTACK_PUBLIC` instead; the
   console's gateway wins where both exist.) Until one of the two is there,
   schools register, start trials and use everything, and no card is taken.
6. Schedule three crons, all on `BILLING_CRON_SECRET` so a cron service holds
   one credential:
   - `/api/v1/admin/cron/billing-run` — daily. Raises invoices, moves the
     lifecycle along, and sends the day's reminders.
   - `/api/v1/admin/cron/reminders` — daily, for a deployment that wants
     reminders on a different schedule from invoicing. Safe to call as often as
     you like; a reminder already sent is not sent again.
   - `/api/v1/admin/cron/notifications` — every ten minutes, to push the text
     messages schools have queued to parents.
7. Fill in the mail server and the platform SMS key under **System settings**,
   or renewal reminders reach nobody. Everything else works without them.
8. Put the installers somewhere and set `download_desktop_windows`,
   `download_desktop_mac` and `download_android` to their addresses. Until then
   the download page says the build is not published yet rather than offering a
   link that 404s.

Existing schools need no migration and keep working (§11, grandfathering).
Subscribe them from the console when you are ready, or let each school choose a
plan from its own billing page.

---

## 17. Tests

```bash
export DATABASE_URL="postgres://…" ALLOW_DEV_SECRET=1
python3 cloud-python/tests/test_billing.py    # the engine, on the in-memory store
python3 cloud-python/tests/test_saas.py       # registration, routing and enforcement, on Postgres
python3 cloud-python/tests/test_gateways.py   # the adapters, against a stand-in provider
python3 cloud-python/tests/test_licensing.py  # leases, seats, activation, reminders
node    test/gateways.js                      # the desktop's adapters, and parity with the cloud's
node    test/licence.js                       # the four ways people try to run an unpaid copy
```

The Python suites are in `npm run test:online`; `test/gateways.js` is in
`npm run test:regressions`.

`test_billing.py` parses `schema-saas.sql` and asserts that every table's
columns match its spec in `app/billing/repo.py`, so a column added to one and
forgotten in the other is a failing test rather than a `KeyError` on a Tuesday.
