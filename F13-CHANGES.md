# Phase F13 — A design system, and one document

**Ships:** 2026-09-03
**Scope:** The phone app, the browser app and the desktop, restyled against one
set of tokens; a sidebar on the phone; and printouts that are the office's own.

---

## Why the desktop looked soft

It was rendering in **Cambria — a serif**, on every school PC, and had been for
as long as the app has existed. Three things stacked up:

1. `src/renderer/index.html` pulled **six families from Google Fonts**. A
   school's internet is not dependable and is frequently simply off at seven in
   the morning, so all six requests failed.
2. `--font-family` read `'Inter', 'Cambria', 'Segoe UI', sans-serif`. With Inter
   unavailable, the next name in the list is a serif.
3. `store/index.js` then **overwrote the token at runtime** with
   `'<theme font>', 'Cambria', Georgia, serif`, so fixing the stylesheet alone
   would have changed nothing.

An app whose first rule is "offline is the normal case" cannot have its
typography depend on a CDN. The fonts are a system stack now, resolved through
`FONT_STACKS`, every branch of which ends in a system sans. The Google Fonts
link and its CSP allowances are gone; `connect-src 'self'` closes the door
behind them. The Branding screen offers only families already on the machine.

## One document, not two

**A report card printed from a teacher's phone is now byte-for-byte the report
card the office prints.** Not similar — the same file.

The apps had templates of their own. A school handing out two documents with
the same title and different layouts has a problem no feature makes up for, so
those templates are deleted. `electron/ipc/reports.js` — the generator behind
the desktop's PDF — now exposes `reportCardDocument()` and
`studentProfileDocument()`, the API serves them at

    GET /results/student/:id/report.html      (staff)
    GET /students/:id/profile.html            (staff)
    GET /parent/children/:id/report.html      (parent)
    GET /parent/children/:id/profile.html     (parent)

and `printFromSchool()` prints the string verbatim. Verified: the teacher's
copy, the parent's copy and the desktop's own output are identical.

A pupil's photograph on the profile sheet was `file://` — which resolves on the
office PC and nowhere else, so a profile printed from a phone came out with a
broken image box where the child should be. It is inlined now, as the crest
already was.

Printing is host-only and says so. The projection the internet portal carries
has no crest, no signatures and no grading scale, so a report card built from
it would be a different document wearing the same name.

## The design system

`DESIGN.md` at the repo root is the written version; `mobile/src/theme.js` and
`src/renderer/src/styles/index.css` are the two copies of it.

**Colour is restrained**: tinted neutrals plus one accent. Violet marks the
primary action and the current position, and nothing else. `#5B3FE0` sits at
7.1:1 on white, so one value works as a button fill *and* as a text colour
instead of two that drift apart.

**Contrast is checked, not assumed.** `npm run test:contrast` measures every
pairing the system uses and fails the build below 4.5:1 — it caught the gold
badge at 3.63:1. `faint` is the one token deliberately under the floor and the
suite asserts it stays there so nobody promotes it to a body colour.

**Banned and removed**: fourteen coloured side-stripes down the edges of cards
(a stripe is what gets reached for when the hierarchy is not working), nested
cards, and every hardcoded hex in the renderer — 18 files retinted onto tokens,
which is why the palette had stopped being one.

**Motion** (`mobile/src/motion.jsx`, `--ease-*` on the desktop): ease-out only,
120–400ms, no bounce. What moves is a screen arriving, a list settling (capped
at eight), a press, the drawer, a tab, a ring. Content is visible by default —
nothing is gated behind a transition a headless render would never fire — and
`prefers-reduced-motion` keeps the interface and drops the travel.

## The phone

Three screens the reference has and the app never did — **splash**, **welcome**
and a three-slide **introduction**, shown once — and a **sidebar**.

The bottom bar held five of fifteen destinations and put the rest behind a
"More" sheet: the register one tap away, the broadsheet two plus a scroll, an
order nobody chose. Now the bar carries four, and a **drawer** carries the whole
app, grouped exactly as the desktop groups it, with the crest at the top and
sign-out at the bottom. Between them sits a **centre action** — not a
destination but the thing you came to do: take the register, enter marks,
collect the canteen money. A teacher at a door has one hand free.

Home is the reference's shape with real content: greeting, a **progress ring**
that counts the day's jobs actually finished, and a list of those jobs with
their state. Settings and both profiles are the reference's menu-row column.

The ring is drawn as a dial of segments. The usual no-SVG trick needs
`transformOrigin`, which this React Native does not support — the first build
rendered a full ring at 0%, the worst possible failure for a progress
indicator.

Money no longer truncates. `GHS 870.00` at 24px in a 118px tile was coming out
as `GHS 870…`, and a balance a parent cannot read is a broken screen that looks
fine. Figures step down to fit.

## Tests

    npm test        # 632 checks + the contrast floor, all green

Both apps were driven in a real browser at 390px and 1440px: 36 screens, zero
console errors, and the printed report card compared against the desktop
generator's own output.
