# Nickland Edusoft

School management for Ghanaian pre-tertiary schools (Nursery–JHS). One database,
three surfaces.

**Register:** product. Design serves the work; it is not the product.

## Who uses it, where

| Surface | Who | Where | Light |
|---|---|---|---|
| Desktop (Electron) | The office, and everybody when the internet is down | One Windows PC in the school office, all day | Fluorescent strip lighting, curtains open |
| Web app (browser) | Everybody — parents, teachers, the office, the owner | A teacher's phone on the school Wi-Fi; a bursar's laptop; a parent's phone at home | Outdoors at the school gate at 7am, or a dim room at night |
| Phone app (Expo) | Same, installed | Same | Same |

The online system holds the whole school — the same tables the desktop has, in
Postgres, one schema per school. The desktop is not a client of it and it is
not a copy of the desktop: either runs with the other switched off.

The phone is used **outdoors, in Ghanaian daylight, at arm's length, one-handed,
often while something else is happening** — a queue of children, a parent at the
gate. That forces the answer: a light theme with hard contrast. A dark UI in
direct sun is a mirror. Dark appears only where it means something — the splash,
the app's chrome, a profile header.

## Fourteen modules, and one of them is yours or it is not

The desktop application has always been a list of modules down the left-hand
side, and the browser and the phone are now the same list:

**Home · Dashboard · Students · Academics · Fees Management · Canteen ·
Transport · Staff Management · Payroll · Finance · Purchasing & Inventory ·
Notifications · Messages · Settings**

An account is shown the ones it holds and is never told the others exist. A
class teacher opens the app on Students, Academics and Canteen; a bursar on
Fees, Finance, Payroll and the store room; neither is asked what kind of person
they are, and neither is shown a switch between them. Everybody lands on the
same Home — a grid of what they may open — and everybody keeps their own
record: a payslip, a clock-in and a password belong to no module.

Underneath, the system still knows the four kinds of access a school grants —
teaching, money, running the school, the system itself. That grouping decides
what an account holds. It is not a thing the person is shown, chooses, or has
to understand.

A parent is the exception, and always was: they are not a member of staff, and
they have their own app inside this one — their child's marks, conduct,
reports, register, the itemised bill and its receipts, and settling it.

**The system itself — accounts, access levels, the audit trail — is the Super
Admin's alone.** The Proprietor is not the Super Admin. They own the school and
stay elevated over its money, but the person who signs the cheques is not also
the one who can quietly rewrite who may see that they were signed.

Full detail: **[`ARCHITECTURE-PORTALS.md`](ARCHITECTURE-PORTALS.md)**.

## Rules the product enforces

1. **Money moves only when the gateway says it did.** A parent can settle a
   bill from the app, and only a signed webhook may say a payment succeeded —
   the amount is re-read from the gateway, never taken from the body. A parent
   who paid at the bank can say so, and that stays a message until somebody in
   the office confirms it against the school's statement. A school with no
   gateway still shows its own WhatsApp number, which is how most of them take
   money anyway.
2. **What you may not open, you do not see.** Permissions hide navigation —
   the whole module, not only the items inside it — and the server checks every
   request regardless of what the app chose to draw. There is no greyed-out
   tile, no padlock and no "ask your administrator": a school's system is not a
   shop. Every refusal is written to the school's own audit log.
3. **Offline is the normal case.** The school's internet is not dependable. The
   desktop is the source of truth; nothing may depend on a CDN, a web font or a
   remote asset at runtime.
4. **The school's own identity, not ours.** Its crest, its name, its colours in
   the header. Never a generic product logo where the school's should be.
