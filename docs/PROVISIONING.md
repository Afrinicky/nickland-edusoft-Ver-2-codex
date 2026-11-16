# How a school comes into existence

**Nickland EduSoft · Copyright © 2026 Nickland Sales**

One place creates a school, and one only: the Super Admin, online. Everything
else attaches to a school that already exists.

That sentence is the design, not a summary of it. There used to be two ways for
a school to come into being — the public website registered itself, and a
desktop created its own on first run — and the second one is what made every
hard question hard. Which of the two is the real school? Who is its
administrator if they disagree? What happens when both have a Proprietor
account with different passwords? None of those questions exists now, because
there is nothing to disagree with.

---

## 1. The Super Admin registers the school

In the console, with the platform key. One act, reported as one thing
(`platform_api.provision_school` → `identity.register`):

| | |
|---|---|
| Postgres schema | `school_<slug>`, 87 tables, seeded with the designations, classes, subjects, grading bands and settings a school opens on |
| Registry row | in `schools` — what a desktop's credential is checked against |
| Administrator | a Super Admin account **inside the school's own schema** |
| Identity | the administrator's email in `platform_identities`, which is the front door |
| Subscription | the chosen plan, trial or otherwise |
| Sync key | shown once; stored as a hash and reissued rather than recovered |

The schema is created **first**, deliberately. It is the half that can fail for
reasons outside the request — a database asleep, a connection limit reached —
and a registry row pointing at a school that does not exist is worse than no
row at all: it appears in the picker, it accepts a credential, and every read
behind it fails. A schema with no registry row is inert by comparison, shows up
in the listing as incomplete, and is what a retry lands on harmlessly.

### The administrator's first password

If the Super Admin does not choose one, a password is generated from the CSPRNG
and returned **once** — there is nowhere to read it back from, because only its
hash is stored.

Either way `must_change_password` is set, and that is a security property rather
than a courtesy. A password the Super Admin chose has been read by somebody at
Nickland, written in a handover note and very likely sent over WhatsApp. It is a
password two parties know, and the school's administrator replaces it at first
sign-in.

The exception is a school that typed its own password at a registration form
thirty seconds ago. Asking *them* to change it immediately is the kind of thing
that makes a product feel like it was not written for a person — so
`chose_own_password` decides, and it is true only for the public route.

### The school starts work immediately

Cloud only, and nothing else is required. The administrator signs in at the
school's own address, finishes the setup the Super Admin did not do, and adds
their staff under Settings → Users & Access. Every module is there.

---

## 2. The public website no longer registers schools

`POST /api/v1/register` refuses with 403 — before the rate limiter and before
anything is written, because the expensive irreversible part of a registration
is creating a schema with 87 tables in it.

The machinery behind it is untouched: `identity.register` still does the whole
act and the console still calls it. What is closed is the unauthenticated front
door. `EDUSOFT_SELF_REGISTRATION=1` reopens it.

---

## 3. The desktop attaches; it does not create

The installer is a **stub**. `win.target` is `nsis-web`, so the download is a
small `.exe` that fetches the application package on launch and installs it —
the full `nsis` installer is still built alongside it for a school whose
connection cannot be relied on for a 100 MB download.

> **Not built or verified here.** A Windows installer cannot be produced in this
> Linux container. The configuration is right and CI now publishes the
> `.nsis.7z` package the stub downloads, but the first real build is the test.
> `nsisWeb.appPackageUrl` must point at wherever that package is hosted, and it
> is currently a placeholder.

On first launch the desktop asks one question — which school is this computer,
and prove it:

```
school address     https://yourschool.edusoft.gh
administrator      head@yourschool.edu.gh
password           ••••••••
```

`licence:activate` → `POST /api/v1/activate` exchanges those for this machine's
own device credential, the school's id and a signed licence. One email running
several schools is **asked**, not guessed.

What changed to make that possible: all three `licence:*` channels were
registered in `ipc/cloud_sync.js` and named nowhere on `electron/api-surface.js`,
so no renderer and no browser could call them. Activation — the only way a
desktop attaches to a school — was unreachable from the user interface
entirely, which is why the first-run screen still offered to create a school.

`auth:bootstrap` now refuses, and says which screen to use instead. The channel
stays rather than disappearing so an older renderer shows a sentence a school
can act on rather than a dead button. `EDUSOFT_ALLOW_LOCAL_SETUP=1` re-enables
it, for a support engineer recovering a school whose cloud record is gone.

---

## 4. What is still missing

Activation attaches the machine. It does not yet bring the school's records
down — the classes, the staff, the pupils, the term. That is the **sync
engine**, and it is the next piece of work; the journal it will carry is
already in place (`electron/db/journal.js`, Phase 2).

Until then an activated desktop knows which school it belongs to and has a
licence, and its database is empty. It is not yet a usable offline copy.

---

## 5. Where each decision lives

| | |
|---|---|
| `cloud-python/app/release.py` | self-registration and the parent portal, cloud side |
| `electron/release.js` | local setup and the parent portal, desktop side |
| `cloud-python/app/platform_api.py` | the tenant, the schema, the registry row |
| `cloud-python/app/identity.py` | the administrator, the identity, the password rule |
| `electron/licence/refresh.js` | activation, from the desktop |
| `test/provisioning.js` | 26 assertions holding all of the above in place |
