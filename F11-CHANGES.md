# Phase F11 — The teacher's app, for teachers who have no desktop

**Ships:** 2026-09-02
**Scope:** Everything a teacher does, on the phone and in the browser, and an
interface that fits the machine it is opened on.

---

## The premise that had been missed

Teachers do not get the desktop. It is not their fallback and not their
occasional alternative — the phone app and the browser app are the whole of
their working day.

The app had seven screens. Four of them (dashboard, roll, debtors, account) were
lists, and three (register, exam marks, canteen) were reachable only from a
quick-action tile. A teacher wanting to write a lesson note, enter class work,
check a broadsheet, look up a parent's number, answer a message, ask for leave
or read a payslip could do none of it. Those are not fringe cases; the first
two are how a report card gets its marks and how a head teacher checks that
teaching happened.

So this phase does not add features to a companion app. It rebuilds the app as
the thing the job is done in.

## What a teacher can now do

| | Before | Now |
|---|---|---|
| Register | Mark one day, one pupil at a time | Whole class in one tap, plus 30 days of history and who is missing school |
| Exam marks | Enter them | Enter them, with what the weighting will make of them |
| **Class work** | — | Assignments, tests and quizzes against the term's columns; the weighted class score is recomputed through the desktop's own function |
| **Broadsheet** | — | Every pupil against every subject, with average and position |
| **Report cards** | — | A pupil's terminal report, and the conduct and remarks that go on it |
| **A pupil's record** | A name in a list | Guardians to ring, attendance, marks, homework, fees |
| Homework | Set it | Set it, see who has handed it in, mark it |
| **Lesson notes** | — | The full form — objectives, RPK, TLMs, the four stages, evaluation, assignment — drafted and submitted for review |
| Timetable | Their own week | Their own week, and any class grid they teach |
| Canteen | Collect from one pupil | Collect, plus the morning sheet: who owes, and how much |
| **Messages** | — | Read and answer parents; the reply is mirrored to SMS or email |
| **Notices** | — | Read, and post where permitted |
| **Their own job** | — | Clock in and out, this month's attendance, leave requests, payslips |

The two that stay with the school are the two that genuinely have to: taking a
fee payment writes a receipt against the school's own numbering, and structural
configuration (roles, terms, subjects, fee templates) is an office job.

## It fits the machine it is on

The browser build was laid out for a phone and then capped at 640 pixels, so a
teacher's laptop showed a phone-shaped column down the middle of a 27-inch
monitor. One bundle now takes three shapes, decided by the width of the window
rather than by the platform:

| Width | Navigation | Layout |
|---|---|---|
| < 768 | Bottom bar of five, plus a **More** sheet with the rest | One column, large tap targets |
| 768–1179 | A rail of icons | Two or three columns |
| ≥ 1180 | A labelled, grouped sidebar | Up to four columns, content capped at 1240px |

A browser window dragged narrow gets the phone layout, because at 380 pixels it
*is* a phone. Tables render as tables where there is room and as stacked,
labelled rows where there is not, so a thirteen-subject broadsheet is readable
on a handset instead of scrolling sideways forever.

This meant replacing expo-router's `Tabs` for the signed-in areas. `Tabs` draws
a bottom bar and only a bottom bar: on a laptop it showed five of fifteen
screens along the bottom edge and hid the rest. Routing is unchanged — every
screen still has a URL that can be typed, bookmarked and shared, and still
guards itself.

Driven in Chromium at 390, 834 and 1440 pixels across every teacher screen: no
console errors, and no horizontal overflow anywhere.

## The interface

A design system rather than a collection of styles: one palette with a rule
(structure, action, judgement, data — nothing decorative), five type sizes,
three elevations, and one set of components every screen is assembled from.

The icons are drawn from plain Views. That is a deliberate choice over two
easier ones. **Emoji** — what the app used — are somebody else's artwork: they
differ on Android, iOS and every desktop browser, they carry their own colour,
and a navigation bar of them reads as a chat message rather than as a school's
system. **An SVG library** would draw them in a tenth of the code, but it is a
native dependency, and this project ships one bundle to an APK, a desktop
installer and a Vercel deploy.

Work not yet at the school is marked everywhere it appears — a queued mark, a
queued reply, a queued leave request. "Saved" and "saved here, waiting" are not
the same promise, and a teacher who has just marked a register deserves to be
told which one it is.

## One sign-in box

The login screen asked "parent or staff?" before it asked who you were. Nobody
answers that at a school gate, and choosing wrong came back as *invalid
username or password* — which reads as a forgotten password, not a wrong tab.

`POST /auth/signin` (and `/api/v1/signin` on both cloud services) matches a
staff username first, then a parent's phone or email, and says which surface
the account belongs to. A match ends it, so an account is never authenticated
twice against two different passwords, and both failures return **one** message
— saying "that username exists but the password is wrong" tells an outsider
which of a school's accounts are real. Against a school whose desktop has not
been updated, the app does the same two-step itself.

## Scope was not being enforced over the wire

F10 made the desktop enforce **whose** class a teacher may touch. Two of the
three surfaces never read it.

**The LAN API ignored it entirely.** A Subject Teacher signing in on the school
Wi-Fi — the ordinary case — was handed every class in the school: the whole
roll, any register, any score sheet, and the canteen money of a pupil they have
never taught. Every staff route now resolves it through the same `_scope.js` the
desktop uses. A batch of marks reaching outside a teacher's classes is refused
**whole** rather than half-saved: a register that saves some of itself is worse
than one that says no.

**The Python cloud service ignored it too**, while the Node one applied it —
two services meant to speak an identical contract, disagreeing about who can
read a school's roll. Ported, with the fixture that caught it.

**`student_snapshot` never carried `class_id`**, so the cloud's "is this the
class teacher" check read `undefined` and let any teacher collect canteen money
from any pupil. It is projected now.

A pupil outside a teacher's scope answers **404, not 403**. Which pupils are in
another class is not theirs to learn either.

## Over the internet

`class_roster` gains continuous assessment, term summaries, guardian contacts,
canteen balances, the weighting and the grading bands. A new `staff_profile`
record carries the teacher's own employment — assignments, lesson notes, leave,
clock-ins and **paid** payslips only, keyed by user so the cloud can serve a
teacher nothing but their own.

Seven new change types queue for the desktop and apply through the same
functions the LAN routes call: class-work marks, end-of-term remarks, lesson
notes, leave, clock-ins, replies and notices.

Four things are honestly host-only and say so rather than failing with a
network error: taking a fee payment, marking homework, adding an assessment
column (the desktop numbers it, and marks queued against an invented id arrive
pointing at nothing) and starting a brand-new conversation (which needs a
parent record the cloud does not hold — replying works from anywhere).

## Tests

`test/teacher_api.js` — **60 new checks** running the real server over the real
schema. No fixtures standing in for tables: the faults worth catching here are
the ones where a route and a table disagree.

- every screen the app draws has something behind it
- another class's register, roll, broadsheet, canteen sheet and score sheet are
  each refused, and a batch reaching outside is refused whole with none of it
  written
- an administrator is restricted nowhere
- 16 out of 20 at a 40% class weighting comes out as 32, through the desktop's
  own recompute — the arithmetic a report card depends on
- a cleared mark is removed rather than written as zero
- an approved lesson note is no longer the teacher's to rewrite or delete
- payslips show paid months and not the school's unpaid draft
- clocking in twice does not move the first stamp

`cloud-python/tests/test_staff.py` grows from 25 checks to **73**, its fixture
now carrying the teaching scope a real projection carries — which is what
surfaced the missing enforcement.

Full suite: **580 Node + 98 Python**.

## Files

**New:** `electron/server/staff_api.js`, `test/teacher_api.js`,
`mobile/src/responsive.js`, `mobile/src/icons.jsx`, `mobile/src/shell.jsx`,
`mobile/src/nav.js`, `mobile/src/pickers.jsx`, and the screens
`mobile/app/staff/{assessments,results,notes,messages,notices,me}.jsx`,
`mobile/app/staff/student/[id].jsx`, `mobile/app/staff/message/[id].jsx`.

**Changed:** `electron/server/api.js`, `electron/server/sync/{outbox,
staff_projection,apply_staff}.js`, `cloud/src/{staff,server}.js`,
`cloud-python/app/{staff,main}.py`, `mobile/src/{theme,ui,api}.jsx|js`, every
existing mobile screen, and the Mobile API / Web App / Gap Analysis docs.
