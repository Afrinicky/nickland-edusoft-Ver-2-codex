# Nickland Edusoft

School management for Ghanaian pre-tertiary schools (Nursery–JHS). One database,
three surfaces.

**Register:** product. Design serves the work; it is not the product.

## Who uses it, where

| Surface | Who | Where | Light |
|---|---|---|---|
| Desktop (Electron) | The office — proprietor, head, bursar, admin | One Windows PC in the school office, all day | Fluorescent strip lighting, curtains open |
| Web app (browser) | Teachers and parents | A teacher's phone on the school Wi-Fi; a parent's phone at home; a staffroom laptop | Outdoors at the school gate at 7am, or a dim room at night |
| Phone app (Expo) | Teachers and parents | Same, installed | Same |

The phone is used **outdoors, in Ghanaian daylight, at arm's length, one-handed,
often while something else is happening** — a queue of children, a parent at the
gate. That forces the answer: a light theme with hard contrast. A dark UI in
direct sun is a mirror. Dark appears only where it means something — the splash,
the app's chrome, a profile header.

## What the surfaces are for

- **Desktop** — everything: finance, payroll, bills, receipts, settings, users.
- **Web + phone, teacher** — the working day: register, class work, exam marks,
  broadsheet, report cards, lesson notes, homework, the morning canteen
  collection, class insight, their own record.
- **Web + phone, parent** — their child: marks, conduct, reports and trends, the
  register, the itemised bill and receipts, canteen, homework, timetable,
  notices.

## Rules the product enforces

1. **No money moves through the app.** A parent sees the balance and every
   receipt; settling it opens the school's WhatsApp. Cash taken in person by a
   teacher is recorded, because that is a real event that already happened.
2. **What you may not open, you do not see.** Permissions hide navigation; the
   server checks every request regardless.
3. **Offline is the normal case.** The school's internet is not dependable. The
   desktop is the source of truth; nothing may depend on a CDN, a web font or a
   remote asset at runtime.
4. **The school's own identity, not ours.** Its crest, its name, its colours in
   the header. Never a generic product logo where the school's should be.
