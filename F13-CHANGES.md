# Phase F13 — A design system, and one document

**Ships:** 2026-09-03
**Scope:** The phone app, the browser app and the desktop, restyled against one
set of tokens; a sidebar on the phone; and printouts that are the office's own.

---

## What this does NOT touch

**The desktop installer app (`src/renderer/`) is untouched.** An earlier pass
restyled it; that has been reverted in full and the tree is byte-identical to
where it was. It keeps its navy, its gold and its own type.

One thing found there and deliberately left alone: `index.html` fetches six
families from Google Fonts, `--font-family` falls back to `'Cambria'`, and
`store/index.js` re-stamps a serif fallback at runtime — so on a school PC with
no internet the desktop renders in a serif. It is a real bug and a one-line
fix, but it is in the desktop app and nobody asked for it to change. Raised,
not applied.

## Why the desktop web app looked soft

The phone and browser app set no font family at all, so it took whatever
react-native-web resolved by default and the weights sat wherever they landed.
It now names a system stack (`mobile/src/theme.js`), every branch of which ends
in a system sans, with tracking tuned per size. Nothing is fetched — the whole
point of this app is that it works with the school's internet down.

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

**Colour is restrained**: tinted neutrals plus one accent. `#5B3FE0` sits at
7.1:1 on white, so one value works as a button fill *and* as a text colour
instead of two that drift apart.

**One screen is dark, and it is the splash.** The top bar, the drawer, the
sidebar and the bottom bar are one white surface with hairline borders. Violet
appears in three places and means the same thing in each: the pill on the item
you are on, the primary button, and one card per screen carrying the figure
that screen is about — or the header over a person's own profile. A dark rail
down the side of a light screen is a slab of ink with nothing on it, and in
Ghanaian daylight a dark panel is a mirror.

**Contrast is checked, not assumed.** `npm run test:contrast` measures every
pairing the system uses and fails the build below 4.5:1 — it caught the gold
badge at 3.63:1. `faint` is the one token deliberately under the floor and the
suite asserts it stays there so nobody promotes it to a body colour.

**Banned and removed**: coloured side-stripes down the edges of cards (a stripe
is what gets reached for when the hierarchy is not working) and nested cards.

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

The app was driven in a real browser at 390px and 1440px: 36 screens, zero
console errors, and the printed report card compared against the desktop
generator's own output. `git diff` against `src/renderer/` is empty.
