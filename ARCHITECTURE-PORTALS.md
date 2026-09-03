# Portals, access and the online school

**Nickland Edusoft · Copyright © 2026 Nickland Sales**

This describes what a person is handed when they sign in, what stops them
reaching anything else, and how the offline system and the online one hold the
same school without drifting apart.

---

## 1. The shape of it

```
                            INTERNET
                               │
                      Neon PostgreSQL
                  one schema per school, the
                  whole of the offline schema
                               │
        ┌──────────┬───────────┼───────────┬──────────┐
        │          │           │           │          │
     Parent     Teaching    Finance   Administration System
     portal      portal      portal      portal      portal
                               │
                        Desktop host
                    SQLite, on one PC in
                    the school office
                               │
                offline operation · local backup
```

The desktop is not a client of the online system and the online system is not a
copy of the desktop. They are two places the same school lives, and either can
run with the other switched off. What keeps them one product is that the
online schema is **generated from the offline one**, not written twice — see §5.

---

## 2. Five portals

A portal is a **view**, never a right. Nothing about a portal grants anything.
Every request is checked against the account's permissions whatever portal it
came from, and a portal decides only what a person is *shown* — and therefore
what they are told exists.

| Portal | Who | What is in it |
|---|---|---|
| **Parent** | A parent | Their own children: marks, conduct, reports, register, the bill and its receipts, settling it |
| **Teaching** | Anybody who teaches or collects the canteen money | Register, class work, exam marks, reports, homework, lesson notes, canteen, their own record |
| **Finance** | Anybody holding fees, finance or payroll | Collections, arrears, bills, expenditure, statement, payroll, store room, money taken online |
| **Administration** | Head teacher, management, proprietor, secretary | Enrolment and pupil records, staff and leave, oversight, approvals, notices |
| **System** | The Super Admin alone | Accounts, access levels, the audit trail, school settings |

### Who gets which

Computed from the resolved permission map, in one place
(`electron/ipc/_portals.js`), and translated for the two cloud services and the
app. The translations are checked against the original by a test.

```
teacher    academics: view    OR  canteen: create
finance    fees: view  OR  finance: view  OR  payroll: view
admin      (staff: view AND students: edit)  OR  settings: view
system     the Super Admin designation, and nothing else
           an account with none of the above keeps `teacher`, holding only
           its own record — a payslip, a clock-in and a password
```

Two of those deserve explanation.

**Teaching needs `canteen: create`, not `canteen: view`.** An accountant who may
glance at canteen takings is not somebody who collects them. Before this rule,
a bursar signing in was handed a register, a mark sheet and a broadsheet they
could open and not use — which is the exact failure the product is written
against.

**System is a designation, not a permission tick.** A `settings` tick can be
granted by mistake; being the Administrator is a decision somebody made about a
person. The **Proprietor is deliberately not the Super Admin**: they own the
school and stay elevated over its money — they may reverse a payment and void a
bill — but the person who signs the cheques should not also be the one who can
quietly rewrite who may see that they were signed.

---

## 3. The access ladder

Underneath, the permission tables store four booleans per (role, module):
view / create / edit / delete. That is precise and unreadable. The whole system
is presented as one ladder:

```
No access → View → Contribute → Manage → Full
```

Each rung is a canonical combination of the same four booleans, so nothing
about enforcement changes. Reading tolerates any legacy combination by reducing
it to the highest **contiguous** level, which never over-reports access.

Ten modules: `dashboard`, `students`, `academics`, `canteen`, `fees`, `payroll`,
`finance`, `staff`, `notifications`, `settings`.

A change takes effect on the holder's **very next request**. Nobody signs out.

---

## 4. Where enforcement lives

Four layers, and only the last two are security.

| Layer | What it does | Is it security? |
|---|---|---|
| Navigation | Hides what an account cannot open | No — it is the product's rule about not advertising what somebody may not have |
| Route guard | Redirects a typed URL back where you belong | No — a courtesy |
| **Portal gate** | Refuses the route before the module is consulted | **Yes** |
| **Permission check** | The same check the desktop makes, against the live account | **Yes** |

Plus scope, which is the question that comes after permission: *whose* class.
A Subject Teacher with `academics: edit` is not thereby entitled to every class
in the school. One resolver (`_scope.js`, `app/school/scope.py`) answers it for
the desktop, the LAN API and the online school.

Every refusal writes a row to the school's own audit log at high severity. A
run of them against one account is the earliest sign anybody gets that it has
been taken.

---

## 5. The online school

`cloud-python/` holds the whole school in Postgres — 81 tables, 127 foreign
keys — one **schema per school**.

### The schema is generated, not written twice

```bash
node scripts/schema-to-postgres.mjs
```

It builds the offline database in memory (the CREATE statements and every
migration, exactly as a school's PC runs them), reads the result back out of
`sqlite_master`, and renders it for Postgres — along with the defaults a new
school starts with, dumped from the offline `seedDefaults`. A column added on
the desktop reaches the online system by re-running the generator, not by
somebody remembering to.

`cloud-python/schema/school.sql` and `seed.sql` are generated files. Do not edit
them.

### Why a schema per school

The offline schema has no `school_id` column and does not need one. Reusing it
verbatim is what keeps the two systems the same product. And a query cannot
reach across two schools by forgetting a `WHERE` clause, because two schools are
never in the same table — the isolation is structural rather than remembered.
Every connection pins `search_path` to one school and not even `public`.

### The modules

Ported from the offline system, module for module, against that schema:

```
app/school/access.py      the ladder                (_access.js)
app/school/security.py    permissions and the audit (auth.js, _security.js)
app/school/scope.py       whose class, whose subject (_scope.js)
app/school/session.py     sign-in and sessions      (tokens.js)
app/school/idgen.py       admission and receipt numbers
app/school/billing.py     bills and their arithmetic (_billing.js)
app/school/ledger.py      the books                 (_ledger.js)
app/school/students.py    the roll and the register (students.js)
app/school/academics.py   marks, assessment, results (scores.js, academics.js)
app/school/fees.py        payments, receipts, arrears
app/school/finance.py     income, expenditure, statement, audit
app/school/payroll.py     SSNIT, PAYE, payslips
app/school/staff.py       records, leave, lesson notes, HR
app/school/canteen.py     the daily collection
app/school/timetable.py   periods and the week
app/school/homework.py    set, seen and marked
app/school/communications.py  messages, notices, the SMS log
app/school/stores.py      inventory, transport, books, discounts
app/school/parents.py     a parent and their own children
app/school/payments.py    the gateway, the webhook, settlement
app/school/admin.py       the school at a glance, and the system
app/school_api.py         115 staff routes
app/parent_api.py         13 parent routes, and the webhook
```

The arithmetic is checked rather than assumed: Ghana's PAYE bands give the same
tax as the JavaScript on every sample tried, and a 16/20 class test with a 75
exam produces the same 32 + 45 = 77 the desktop produces, against the same
grading band.

---

## 6. Where the online system is deliberately stricter

The desktop sits in a locked office. This is on the internet.

| | Offline | Online |
|---|---|---|
| Approving your own expenditure | Allowed — one machine, one office | **Refused.** Two acts by two accounts, including for the Super Admin |
| Deactivating an account | Session lives until the token expires | **Every session revoked at once** |
| Changing a role or a password | Same | **Every session revoked at once** |
| Parent password minimum | 4 characters | **8**, with throttling and an audit trail |
| Failed sign-ins | Counted in memory | **Written to the school's own audit log** |
| A gateway secret | Readable in Settings | **Write-only.** No route returns it; the audit row does not quote it |
| A token | One school | **Names its school**, and its hash is only findable in that school's schema |
| Approving a password reset | Face to face at the desktop | **Not online at all**, deliberately |

---

## 7. Money

### Taking a payment

Four things in one transaction: the receipt number is consumed, the payment row
is written, the bill's **paid** side is recomputed from the payments table, and
the ledger is posted. If any fails, none happened.

The receipt number is consumed *inside* the transaction. Taken outside, a
payment that failed to record still burns a number and leaves a gap — which is
what an audit of a school's books treats as a missing receipt.

A payment recomputes what was **paid**, never what was **charged**. Rebuilding
a bill from its line items belongs to the bill, not to the money.

### Reversal

An elevated account, a reason in writing, and its own ledger entry — the books
show what happened, not a number that changed. A bursar with `fees: full`
cannot do it.

### Online payments

```
parent's phone ──▶ school's server ──▶ gateway
                        │                 │
                        ◀── authorization URL
                                          │
                   webhook ◀──────────────┘  (HMAC over raw bytes)
                        │
                   ask the gateway what it actually settled
                        │
                   record the payment · issue the receipt · post the ledger
```

* Only a **signed** webhook may say a payment succeeded, checked over the raw
  bytes before the body is believed about anything.
* The **amount is never read from the webhook.** Settlement re-asks the gateway
  over the school's own authenticated connection. That is the one thing an
  attacker who can post to the webhook cannot forge.
* Settling twice is not two payments. A gateway retrying and a parent
  refreshing both resolve to one receipt.
* An amount is bounded by what is actually owed **before** the gateway is
  called, so a mistyped extra zero is refused rather than refunded.

### A declaration is not a payment

A parent who paid at the bank can say so. It is a message with a number on it:
it posts nothing until somebody with `fees: edit` confirms it against the
school's statement. The same reference twice is one declaration. A gateway
charge can never be confirmed by hand — it settles when the gateway says the
money arrived, or not at all.

---

## 8. Running it

```bash
# regenerate the online schema from the offline one
node scripts/schema-to-postgres.mjs

# provision a school
cd cloud-python && python3 -c "from app.school import db; db.provision('sch_abc')"

# everything
npm test                                    # desktop, LAN API, app, thin cloud
npm run test:online                          # the online school (needs Postgres)
```

`npm run test:online` needs `DATABASE_URL`. It provisions a throwaway school,
exercises it with the six kinds of person a school has, and drops it.

---

## 9. What is deliberately absent

Adding any of these would be a regression, not a feature.

* **Approving a password reset over the internet.** The whole point of the code
  an administrator reads out is that the person asking is standing in front of
  them.
* **A route that returns a stored gateway secret.** A school that has lost its
  key gets a new one from the gateway.
* **Confirming a gateway payment by hand.** If the gateway has not confirmed
  it, the money is not there.
* **Approving your own expenditure, leave, or lesson note.** Approving your own
  leave is not a decision, it is a holiday.
* **Deactivating the last administrator, or the account you are signed in
  with.** A school locked out of its own system is a support call nobody
  enjoys.
