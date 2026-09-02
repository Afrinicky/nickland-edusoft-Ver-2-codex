# Phase F9 — Sign-in, passwords, photos, and access visibility

**Ships:** 2026-09-02
**Scope:** Four faults reported from a live school, fixed on all three surfaces
— the Windows desktop, the phone app, and the browser build.

---

## 1. Every account except the first was locked out

**Symptom:** "All logins created are not working except admin."

`auth:create-user` sets `must_change_password = 1` on every account it makes,
which is correct — an administrator chose that password, so the holder should
replace it. The login screen handled the flag with `window.prompt()`.

**Electron does not implement `prompt()`.** It throws. Sign-in stopped at that
line and never reached `onLogin`, so the account could not get in — ever. The
one account unaffected was the very first administrator, created by the
bootstrap screen, which is the only path that leaves the flag clear. Hence
"everything except admin".

The same `prompt()` sat behind **Reset PW** in Settings → Users, so an
administrator could not reset anybody's password either. Both are now ordinary
screens. Nothing in the renderer calls `prompt()` any more.

## 2. Signing out left a blank window

**Symptom:** logging out shows an empty page, not the login screen.

`App.jsx` advanced `phase` from `login` to `app` when `isAuthenticated` turned
true, and had no transition back when it turned false. Signing out cleared the
session and left the shell on `app`: every route rendered `null` under a
sidebar still showing the signed-out user, whose name fell back to
"Administrator". The phase now follows auth state both ways.

## 3. Forgetting a password had no route at all

A school desktop has no mail server, and the phone app talks to a read model,
so "email me a reset link" does not exist here. A person approves instead:

1. **Ask** — from the sign-in screen, the phone, or the browser.
2. **Approve** — an Administrator or Proprietor, in Settings → Users, in
   person. The queue shows who is asking and where from.
3. **Redeem** — approval mints a **six-digit code**, shown to the approver
   once. The account holder enters it and chooses their own password.

**Why a code, and not just "approved".** Approval alone unlocking the
choose-a-password screen would mean that anyone walking past a shared office
machine between the approval and the teacher's return owns the account. The
approver never sets and never sees the new password. A code is single-use,
expires in 24 hours, and only its SHA-256 hash is stored — a lost code means
declining the request, not recovering it.

Signed in already, changing your own password lives in the **sidebar**, not in
Settings: Settings is behind the `settings` permission, so a Class Teacher
could never have reached it, and your own password is not a module.

**One implementation.** The rules live in `electron/server/passwords.js`, used
by the desktop's IPC, by the LAN API a phone reaches on the school Wi-Fi, and —
through the projected claim — by the cloud. A rule that holds on the desktop
and not over Wi-Fi is not a rule.

**How it reaches the cloud.** The cloud cannot approve anything: approval is a
person recognising another person. Once an Administrator approves on the
desktop, the *hash* of the code is projected up as `staff_reset_claim` — the
least the cloud needs to check a code, and the most it can safely hold. A
password changed over the internet is written to the projection at once, so it
works on the next request rather than after the school next syncs, and queued
for the desktop as a bcrypt hash. The password itself never enters the queue.

`must_change_password` now reaches the cloud too. It used to stop at the
desktop, so a temporary password an administrator set was permanent on the
phone — the one device nobody supervises.

### Two version bugs found on the way

Anything writing a projection back read `version` off the **payload**, where
there is no such field. Every write went up as version 2, and the store keeps
the higher version, so once the desktop had pushed a third the write was
silently dropped. That is why a spent reset code stayed spendable. The parent
profile edit had the identical defect and is corrected with it.

## 4. Staff photos

**Symptom:** "I have to save first before adding the image, and even that one
is not working."

- **Any time.** The uploader refused to act without a record id. A photo can
  now be chosen at any point; with no id yet the file is staged on disk and its
  path travels with the form. `staff:create` and `staff:update` carry
  `photo_path`, which neither did before — so a photo attached while editing
  had nowhere to land either.
- **Passport size.** Every upload is cropped to passport proportions from the
  centre (biased towards the top, where the head is in a portrait) and scaled
  to **413 × 531** — 35 × 45 mm at 300 dpi.
- **500KB ceiling.** Re-encoded at descending JPEG quality until it fits.
  Oversized files are shrunk, never rejected: telling a secretary to go and
  resize it first is how the field ends up empty.

Deletions are confined to the app's own photo folder. `photo_path` comes back
out of the database, and a value put there by anything other than this module
is not something to hand to `fs.unlink`.

---

## The standing rule: what you cannot access, you cannot see

Applied everywhere a route or a control is drawn:

| Surface | Before | Now |
|---|---|---|
| Desktop sidebar, homepage | already gated | unchanged |
| Desktop route guard | "Access Restricted", naming the module | sends you home |
| Desktop Settings sub-nav | every tab, always | tabs that configure a module are gated, and an empty section heading is dropped |
| Mobile/web staff tabs | Students and Debtors always drawn | built from the permission map |
| Mobile/web screens by URL | reachable, then a 403 error | guard redirects to the dashboard |

A tab that leads to "Access denied" is worse than no tab: it advertises part of
the school's system to somebody who has been told they may not have it, and
invites them to keep tapping.

**None of this is the enforcement.** Every IPC handler checks permissions in the
main process, and the cloud checks every request against the same map and
answers 403 whatever the app chose to draw. A projection is a copy, and the
desktop has the last word.

---

## Tests

`cloud/test/passwords.js` — 24 checks over the round trip, against the real
cloud server and a real desktop database, with the school's computer genuinely
off for the middle of it:

- a change is verified, applied to the projection, and lands in the school's
  own database when it syncs
- the password never appears in the change queue — only a bcrypt hash
- a code cannot be guessed before approval, cannot be spent twice, and is
  refused once expired
- an unknown username gets the same answer as a real one
- only the hash of a code is projected, never the code

Wired into `npm test` and `npm run test:cloud`. Full suite: **453 passing.**

## Files

**Desktop (main):** `electron/db/database.js` (new `password_reset_requests`
table + migration), `electron/ipc/auth.js`, `electron/ipc/photos.js`,
`electron/ipc/staff.js`, `electron/preload.js`, `electron/server/passwords.js`
(new), `electron/server/api.js`, `electron/server/sync/staff_projection.js`,
`electron/server/sync/apply_staff.js`

**Desktop (renderer):** `App.jsx`, `pages/Login.jsx`, `pages/Settings/Users.jsx`,
`pages/Settings/Index.jsx`, `pages/Staff/Form.jsx`,
`components/PhotoUploader.jsx`, `components/RequirePermission.jsx`,
`components/Sidebar.jsx`, `components/ChangePasswordModal.jsx` (new),
`styles/index.css`

**Cloud:** `cloud/src/staff.js`, `cloud/src/server.js`

**Mobile / web:** `src/api.js`, `src/ui.jsx`, `src/guard.jsx` (new),
`app/login.jsx`, `app/staff/_layout.jsx`, `app/staff/account.jsx`, and the six
guarded staff screens
