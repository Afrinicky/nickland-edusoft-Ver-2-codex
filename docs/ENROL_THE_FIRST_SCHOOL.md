# Enrolling the first school

**Nickland EduSoft · Copyright © 2026 Nickland Sales**

What has to be true before the first real school is enrolled, what to do, and
what that school can and cannot do afterwards. Honest about the last part: one
significant thing is not finished, and it is named in §5 rather than buried.

The path itself is rehearsed end to end by
`cloud-python/tests/test_enrolment.py` — 29 assertions that enrol a school,
sign in as its administrator, open its modules, add a member of staff, activate
a desktop against it, and check a second school cannot see any of it.

---

## 1. Before you enrol anything

Set on the cloud service. The boot report prints what is missing, in these
words, so a misconfigured deployment says so rather than failing later in front
of a school.

| Variable | Why it matters if unset |
|---|---|
| `DATABASE_URL` | Nothing works. Neon, pooled, `?sslmode=require`. |
| `PLATFORM_ADMIN_KEY` | **Enrolment answers 404.** Under 24 characters it is ignored and the boot log says so. This is the key the console uses. |
| `PORTAL_SECRET` | Signs sessions. Changing it signs everybody out. |
| `LICENCE_SIGNING_KEY` | Without it the service generates one and keeps it in the database — which works, and means anyone with the database could sign licences. **Changing it later invalidates every licence already issued.** |
| `PORTAL_BASE_DOMAIN` | Without it **a school has no address of its own**. It still works, reached at the shared origin with a picker — but there is no `ave-maria.edusoft.gh` to send anybody. Set this before the first school, not after. |
| `BILLING_CRON_SECRET` | Renewal reminders and queued SMS do not go out. |

Region: choose the Neon region **first**, then match the service to it. Every
screen is many small queries and each is a round trip — measured at about 100 ms
per screen in-region against over two seconds across a continent.

---

## 2. Enrol the school

Console → **Enrol a school**. Fill in the school's name and the
administrator's name, email and a password of at least eight characters.

One act creates all of it: the Postgres schema (87 tables, seeded), the registry
row, the administrator inside the school's own schema, their platform identity,
the subscription, and a sync key shown once.

Hand over: the address, the administrator's email, and the password you chose.

> **They will be made to change that password at first sign-in.** That is
> deliberate. A password you chose has been read by somebody at Nickland,
> written in a handover note and probably sent over WhatsApp — it is a password
> two parties know.

The sync key is shown **once**. It is stored as a hash; it cannot be read back,
only reissued.

---

## 3. The school starts work immediately

Cloud only, nothing installed. The administrator signs in, replaces the
password, and works: classes, subjects and terms are already seeded, the roll is
empty and ready, and Settings → Users & Access is where they add their staff.

Staff then reach the same school, with the same accounts and the same
permissions, from:

* the web — the office application in a browser
* the phone app — teachers and staff
* the desktop — once activated, see below
* the school's own network — the LAN host on port 4747, unchanged

---

## 4. Putting it on a computer in the school

The school downloads the **stub installer** from the website. It is small; it
fetches the application on launch and installs it.

On first run the desktop asks one question — which school is this, and prove
it: the school's address, the administrator's email, and their password. That
exchanges for this machine's own credential, the school's id and a signed
licence, and creates the administrator locally so somebody can sign in offline.

**A desktop cannot create a school.** There is no "Create Super Admin" screen
any more. If a desktop is ever shown one, something is wrong — check
`EDUSOFT_ALLOW_LOCAL_SETUP` is not set.

> **The Windows installer has not been built or verified.** It cannot be built
> in the Linux container this work was done in. `win.target` is `nsis-web` and
> CI publishes the `.nsis.7z` the stub downloads, but
> `nsisWeb.appPackageUrl` is still a placeholder and must point at wherever
> that package is hosted. **Build it and install it once before giving it to a
> school.**

---

## 5. What that school cannot do yet

**Two-way synchronisation does not exist.** This is the one thing to be clear
about before enrolling anybody.

The transaction journal is in place — every write on a desktop is captured,
with the record's identity, the device and the user (Phase 2) — and nothing
consumes it yet. So:

* an activated desktop knows its school and holds a licence, and **its database
  is empty**. The school's pupils, staff and records are in the cloud and do not
  come down.
* work done on that desktop stays on it.

**Therefore: enrol the first school as a cloud school.** It can do everything
through the browser and the phone app today. Install the desktop when
synchronisation lands, or install it knowing it is a separate, empty copy.

The LAN host is unaffected and works as it always has, against whatever
database the office PC holds.

---

## 6. Other things switched off for this release

* **The parent/student portal.** Parents cannot sign in and the parent routes
  refuse. The `parents` table keeps every row and Settings → Mobile App still
  provisions accounts, so nothing is lost and one flag brings it back.
* **Self-registration from the website.** The public `/register` page still
  exists and its form will be refused by the API with a message saying Nickland
  sets schools up. **Worth deciding on before launch** — a visitor filling in a
  form that cannot succeed is a poor first impression, and the honest fix is
  website copy rather than code.

---

## 7. If something goes wrong

| Symptom | Cause |
|---|---|
| Enrolment answers 404 | `PLATFORM_ADMIN_KEY` unset or under 24 characters |
| The school has no address | `PORTAL_BASE_DOMAIN` unset — §1 |
| "Schools are set up by Nickland" on the website | Working as intended — §6 |
| The desktop offers to create a school | `EDUSOFT_ALLOW_LOCAL_SETUP` is set; unset it |
| A desktop will not activate | Check the seat count on the subscription; the error names the machines using them |
| The administrator cannot sign in | They must change the password first; that is the forced change, not a failure |
