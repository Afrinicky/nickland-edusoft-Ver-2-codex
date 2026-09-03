# Phase F12 — The parent portal, the teacher's morning, and no money in the app

**Ships:** 2026-09-03
**Scope:** The web app and the phone app — what a parent can see, what a teacher
can do, the school's own identity in both, and the removal of every payment
path from the online system.

---

## Three things were wrong

**A parent could see a number, and nothing behind it.** The child's page was
seven stacked cards: a fee total, two attendance counts, a list of subject
scores with no grading scale beside them, and a "Make a payment" button that
asked for a card. There was no way to open last term's report, no way to tell
whether a child was improving, no breakdown of what the bill was for, no
history of what had already been paid, no conduct or remark — the part of a
report card a parent reads first — and no way to ask anybody about any of it.

**A teacher's morning had no home in the app.** The desktop has had Quick Pay
since the first release: the class for one day, everyone who owes ticked by
default, absentees excluded, one press. A class teacher on a phone had to open
a form, find a pupil, type an amount and save — forty times, at the door, with
children filing past.

**Nobody's face was in it, and neither was the school's.** The crest had been
uploaded on the desktop years ago; every pupil and every teacher had a
photograph on file. The API sent the FILE PATH each was stored under, which
means nothing to a browser on the staffroom Wi-Fi or a phone at a parent's
house — so the app drew initials in coloured circles and a generic blue box
where the school should have been.

## No money moves through this app

Removed outright, routes included:

* the card / mobile-money checkout (`POST /parent/children/:id/pay/online`),
* the "tell the school what you paid" form that created a pending intent
  somebody at the office then reconciled by hand (`POST .../pay`),
* the payment verification pull (`GET /parent/pay/verify/:reference`),
* the gateway webhook that settled them (`POST /webhooks/paystack`).

`/info` now answers `online_payments: false` so an older client is told plainly
rather than left guessing.

In their place, `GET /parent/children/:id/settle` — which settles nothing. It
returns the figures and the school's contact details, and the app turns that
into a WhatsApp message with the child, the class, the term and the amounts
already written into it. A school takes payment the way it always has: at the
office, or on WhatsApp with the bursar. The parent sees the balance, the
itemised bill and every receipt; the paying happens with a person.

Cash the school takes in person is untouched — the canteen collection is real
money handed over at the gate, and it is recorded here exactly as the desktop
records it.

## What a parent can now see

| | Before | Now |
|---|---|---|
| The child | A name | Their photograph, class, index number and class teacher |
| Marks | A list of numbers | Marks against the school's grading scale, strongest and weakest subject, charted |
| **Conduct and remarks** | — | Conduct, interests, talents and the class teacher's remark |
| **Past terms** | — | Every term the school has published, openable |
| **Trends** | — | Average and class position across terms, charted |
| Attendance | Two counts | The term day by day, with a rate and what it means |
| Fees | One balance | The bill line by line, what was carried forward, the discount, the books, and a term-by-term history |
| **Payment history** | 20 rows, unlabelled | Every receipt the school has issued, with term and method |
| Canteen | One figure | Days paid, days owed, days excused, and every collection recorded |
| **Bills and notices** | Notices were the SMS log only | School notices and messages, merged and sorted |
| **Printing** | — | Report card, statement of account and pupil profile |
| Paying | A card form | A message to the school with the figures already in it |

## What a teacher can now do

* **Quick Pay**, and it opens first when the canteen module is opened — because
  it is what the module is opened for at eight in the morning. The class for one
  day, unpaid-and-present ticked by default, a running total of the cash that
  should be in hand, one press to record, and one to excuse the absent. It runs
  the desktop's own `markBulkPaid`, so the ledger entry, the term attribution
  and the daily rate are identical whichever machine took the money. A second
  tap does not charge the same child twice for the same lunch.
* **Class insight** — average by subject, who is below 45, who is below 85%
  attendance, the attendance rate day by day, and a **contact book** for the
  whole class with a call and a WhatsApp on every guardian.
* **My profile** — the teacher's own record with their photograph, what they
  teach, what they are answerable for, and a printable profile sheet carrying
  no salary or bank detail.
* **Printing** — a pupil's report card and profile sheet from the pupil's
  record, a report card from the broadsheet, and past terms in the report sheet
  so a remark can be written knowing whether this is a fall or a recovery.
* Photographs on the class roll, on a pupil's record, in the daily collection.

## The school's own identity

`GET /branding` (public) serves the crest, the name, the motto, the address and
the contact numbers; images travel as data URIs (`electron/server/media.js`),
capped and cached by path and mtime. The desktop projects the same record to
the cloud (`enqueueSchoolProfile`), and the portal serves it at
`GET /portal/branding`, so a parent on the internet sees the same crest as a
teacher on the school Wi-Fi. Saving branding in Settings re-projects it.

A **WhatsApp number** is now a school setting (Settings → School identity),
falling back to Phone 1. It is where every "Message the school" button and
every "settle this balance" prompt leads.

## Interface

* `Avatar` draws the `photo` it has been handed since the first version and
  never once read; `Crest` draws the school's mark with the app's own as a
  fallback.
* `Tabs` — a scrolling tab strip, because a child's record now has eight
  sections and a segmented control at eight is unreadable.
* `charts.jsx` — a term-by-term line, subject bars, a proportion meter and a
  strip of days, drawn out of plain Views. No charting dependency, so nothing
  changes about the APK.
* `Grid` measures its container instead of dividing by percentages. Four cards
  at 25% plus three 12px gaps overflowed, so every four-card row in the app
  had been rendering as three-and-one.
* `print.js` builds each document as self-contained HTML and prints it through
  a hidden iframe — a pop-up is blocked by default on most phone browsers, and
  the parent would have got nothing with no explanation.

## Tests

`test/teacher_api.js` grew from 60 to 108 checks against the real server and a
real database, covering the daily collection (including the double-tap and the
other-class refusals), the branding route, the class contact book, the parent
portal's new endpoints and their scoping, and that every payment route is gone.

    npm test        # 625 checks, all green
