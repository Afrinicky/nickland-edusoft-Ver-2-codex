# Access control — who can do what

Nickland Edusoft controls access with **one ladder of levels** that build on each
other, the same model as SECH_LIMS:

| Level | Grants | Stored as |
|---|---|---|
| **No access** | Hidden entirely | — |
| **View** | Open and read | `can_view` |
| **Contribute** | View + add new entries | `+ can_create` |
| **Manage** | Contribute + edit/correct | `+ can_edit` |
| **Full** | Manage + delete | `+ can_delete` |

A level is just a friendly name for a combination of the four permission flags
the database has always stored, so enforcement (`_security.checkPermission`) is
unchanged. `_access.permsToLevel` reduces any legacy flag combination to the
highest *contiguous* level, so access is never over-reported.

## Where

`Settings → Users & Access → Roles & Access`. Two tabs:

- **Roles** — the default access for everyone with a job (Accountant, Class
  Teacher…). Set this once and every user with that role inherits it. "Set every
  area to" applies one level across the board; individual areas are then tuned.
- **Individuals** — a per-person override on top of their role. This is for the
  school with **no accountant** that wants to give one teacher limited Finance
  access *without making them an accountant*: on the Individuals tab, pick the
  teacher, set Finance to **Contribute**, done. Their role stays Class Teacher;
  the override sits on top and the real permission resolver honours it.

Each area (the 10 modules) shows a plain-language description and a grouping —
Overview / Academics / Money / People / System. Money and System areas carry a
small marker (•) so they are granted deliberately.

## Roles

- The built-in roles (Proprietor, Super Admin, Head Teacher, Class/Subject
  Teacher, Accountant, Secretary, Cook, Security, Cleaner) can be re-levelled and
  re-described, but not deleted.
- **Proprietor** and **Super Admin** are always Full and cannot be reduced —
  every school needs at least one account that can never be locked out.
- Custom roles can be created, optionally copied from an existing role, and
  deleted. Deleting a role leaves its users with **no role** (no access) rather
  than silently inheriting another's — safer to under-grant.

## The domain defaults

The seeds match how a Ghanaian school is actually staffed:

- **Accountant** — Full on Fees, Payroll and Finance; View elsewhere.
- **Class / Subject Teacher** — Full on Academics and Canteen; View on Students;
  nothing on money.
- **Secretary** — Students and Notifications; light everywhere else.
- **Head Teacher** — most things, but not payroll/finance write or user
  management.

## Rules

- Only the Super Admin or the Proprietor (anyone with **settings → Manage**) can
  change roles or overrides. Every change is written to the audit trail with who
  and what.
- Backend handlers live in `electron/ipc/access.js`; the shared model
  (levels, modules, mappings) in `electron/ipc/_access.js`; the UI in
  `src/renderer/src/pages/Settings/AccessControl.jsx` with the reusable
  `LevelPills` control.

## What it looks like in the browser and on the phone

The same ladder decides what the app draws. There is no separate app-side
setting and no "teaching / finance / admin" choice to make: the system reads
the account's permission map and hands it the modules it holds, in the
installed application's own order.

| Level on a module | What appears |
|---|---|
| **No access** | The module is not in the sidebar, not on Home, not in the drawer, and not in the bottom bar. It is not greyed out — it is not there |
| **View** | The module opens, on the tabs that only read. Students opens on its dashboard and roll; the Students Sheet is absent |
| **Contribute** | The tabs that add appear: Admissions, Quick Pay, taking a payment |
| **Manage** | The tabs that correct appear: the Students Sheet, Fee Templates, the timetable editor |
| **Full** | Adds what deletes, where a screen offers it |

Three things do not follow the ladder:

* **My work** and **Account** belong to every account, down to a security man
  granted nothing at all. A payslip, a clock-in and a password are a person's
  own.
* **The audit trail** is the Super Admin's, whatever anybody's `settings` level
  says.
* **Discounts, reversals and voids** need elevation (Proprietor or Super
  Admin) over and above `fees`. A bursar with Fees at Full may take money and
  may not forgive it.

The app is not the enforcement — the server checks every request against the
same resolved permissions, and refuses whatever the app happened to draw. What
the app is responsible for is the other half of the rule: **what you cannot do,
you cannot see.** A menu item leading to "access denied" advertises a part of
the school's system to somebody who has been told they may not have it.

The front end's half is tested in `test/app_modules.mjs` and the server's in
`test/office_api.js`, `test/access.js` and `test/portals.js`.
