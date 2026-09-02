# Phase F10 — Photos that appear, and access that actually holds

**Ships:** 2026-09-02
**Scope:** Three reported faults, fixed at the root across desktop, phone and
browser.

---

## 1. The teacher's photo never appeared

Two separate faults, and the first one hid the second.

**The profile never asked for it.** `Staff/Detail.jsx` rendered
`initials(staff)` unconditionally and never read `photo_path`. The photo
uploaded, cropped and saved correctly — and was then displayed nowhere. Sixteen
places had the same shape. They now share one `Avatar` component where initials
are the *fallback*, not the design, and a photo deleted from disk behind the
app's back falls back to initials rather than a broken-image icon.

**The URL could not have worked anyway.** Every uploaded picture was addressed
as `file://<absolute path>`. A page cannot do that: in development the renderer
is served from `http://localhost:5173` and the browser refuses a `file://`
subresource outright; packaged, it rests on Chromium's file-origin rules rather
than on anything we control. That covered the school logo, signatures and
student photos too.

They are now served over a **`nes-media://`** scheme registered by the main
process, identical in development and packaged. Unlike switching `webSecurity`
off — the usual shortcut — it does not hand the renderer the disk: every request
resolves against an allowlist of two directories, and anything outside them is
refused and logged.

## 2. Teachers were scoped to nothing

`staff_assignments` existed and was written by the UI. Nothing read it.

The model, now enforced:

| Assignment | What it grants |
|---|---|
| Class, no subject | The whole class — every subject in it |
| Class + subject | That subject in that class, nothing else in it |
| Subject, no class | That subject in every class that teaches it |

**They combine.** A teacher can hold Basic 5 outright *and* take Mathematics in
Basic 4 and Basic 6 — the case the school described, so the case the model is
built around.

The third shape could not be expressed before: a class was required, so a
subject specialist needed a row per class and any class added later silently
left them out.

**One class, one class teacher.** The register, the canteen sheet and the
end-of-term report all hang off "who is answerable for Basic 5", and that cannot
have two answers. A second is refused, naming whoever holds it.

**Settings → Teaching Assignments** is new. Assignments could previously only be
reached by opening Users, finding a person and clicking a small icon on their
row — so a class with nobody answerable for it was invisible until something
needing one failed. The page shows every class, who holds it, which classes have
nobody, and what each teacher can currently open. A **Head Teacher** may use it:
their designation is the qualification for the job, and requiring `settings.edit`
meant they could not, despite running the staffing.

## 3. Permissions were never checked

The audit behind this phase found **no permission checks at all** across the
students, scores, exams, timetable, homework, canteen and academics handlers —
**98 of them**. Settings → Roles & Access wrote the rules to the database and
nothing ever read them. Turning off "Students: create" left the admissions form
admitting, the Students Sheet saving, and Import Excel importing. That is
exactly what was reported.

**Enforcement is declared once and applied at registration.** Rather than edit
98 handler bodies — 98 chances to get it wrong, and no cover for the ninety-ninth
added next month — `_policy.js` states the rule per channel and `_guard.js`
wraps `ipcMain.handle`. Modules register exactly as before.

> **A channel with no policy entry is DENIED to a restricted user, not allowed.**
> A handler added later is closed until somebody says otherwise — the only
> default that stays safe as the app grows.

This runs in the main process. Opening DevTools and calling the channel directly
lands in the same place.

### What is now refused

- Admitting, editing or deleting a pupil without `students.create/edit/delete`
- Bulk import, the Students Sheet, and every cell written through it
- **Import / Export Excel** on the assessment compilation, the timetable and the
  attendance register — the same reading and writing acts as the screens they
  sit on, and previously a way straight round an account refused `academics.edit`
- Rewriting another class's timetable; the period structure needs `settings.edit`
- The end-of-term summary, report and assessment compilation outside the class
  teacher's own class
- The canteen for a class one only visits for a subject

### And what is hidden

Students Admissions and Students Sheet are gone from the tab bar without the
permission. Class pickers list only the teacher's own classes — a teacher is not
offered Basic 6 and then told access denied on choosing it. A subject teacher
visiting a class sees their subject and no other.

## Over the internet

The desktop resolves the scope and **projects the answer**, rather than the
cloud resolving it a second time from data it does not have. One implementation
of "which classes are mine", not two that drift. Class rosters are the spine of
every staff read, so filtering them covers the class list, the roll, registers,
score sheets and homework together.

Writes outside scope are refused, not queued: queueing a change the desktop will
drop tells a teacher their register is safe when it is not. A canteen lookup for
a pupil in another class answers **not-found** rather than forbidden — which
pupils are in another class is not theirs to learn either.

---

## Upgrading schools: read this

**A teacher with no assignments now reaches no classes.** That is the rule
working as asked, but it means every existing school must set assignments before
its teachers can work. Settings → Teaching Assignments lists exactly who has
nothing and which classes have no class teacher.

The alternative — treating "unassigned" as "unrestricted" — is the bug that was
reported, so it was not an option.

---

## Tests

`test/access.js` — 44 checks running the **real guard over the real policy**
against a real database:

- a class teacher cannot admit, edit, delete, bulk-import or sheet-edit a pupil,
  but can still read the roll
- Excel is not a way round a refused permission
- a class held outright plus a subject elsewhere resolves correctly, in both
  directions
- a specialist reaches their subject in every class and no other subject anywhere
- canteen and end-of-term belong to the class teacher
- an unlisted channel is closed to a teacher and open to an administrator
- assignment rules: head teachers may assign, a second class teacher is refused,
  duplicates are no-ops, "every class" works
- every refusal is written to the audit log

`cloud/test/staff.js` gains four checks that the same scope holds over the
internet. Full suite: **501 passing.**

Also breaks the `require` cycle between `_security` and `auth`, which Node had
been warning about — whichever loaded second saw a half-built copy of the other
and `resolveEffectivePermissions` came out undefined.

## Files

**New:** `electron/ipc/_scope.js`, `electron/ipc/_policy.js`,
`electron/ipc/_guard.js`, `src/renderer/src/lib/media.js`,
`src/renderer/src/components/Avatar.jsx`,
`src/renderer/src/pages/Settings/TeacherAssignments.jsx`, `test/access.js`

**Changed:** `electron/main.js`, `electron/ipc/auth.js`, `_security.js`,
`students.js`, `settings.js`, `electron/server/sync/staff_projection.js`,
`cloud/src/staff.js`, `cloud/src/server.js`, the Students / Academics /
Timetable / Settings screens, and the sixteen avatar and `file://` sites.
