# Billing — how it works

Nickland Edusoft bills the way a Ghanaian private school actually bills. This
page is the reference for that model and for the screens that implement it.

## The model

| Kind | How often | Where it lives |
|---|---|---|
| **School fees** | Once per pupil per term | The term bill (`student_bills`) |
| **Extra charge** (supplementary) | Whenever one comes up during the term | Extra lines on the same term bill |
| **Books** | Once per academic year, in Term 1 | `student_books`, carried into T2/T3 as arrears |
| **Arrears** | Automatic | Lines on the next term's bill |

**One school-fees bill per term.** There is no such thing as two school fees in
the same term. If the amounts change, the term's bill is revised, not duplicated.
Saving a second school-fees template for the same class and term is refused: the
existing one is shown, and you choose to replace it, turn the new one into an
extra charge, or cancel.

**Extras go onto the existing bill.** An excursion, sports week, mock exams,
BECE registration or speech day is raised on top of the pupils' current term
bill as additional line items. That keeps **one balance per pupil per term**, so
a payment never has to be split across competing bills and the finance ledger
stays unambiguous. On the printed bill they appear as their own part
(*Part D — Additional Charges This Term*).

## Fee templates

A template is the schedule a bill is made from. `Fees → Bills → Fee Templates`.

Templates resolve most-specific-first when a bill is generated:

```
class + term  →  class (any term)  →  term (all classes)  →  global
```

So an "All classes / All terms" template is a standing default that any term
without its own schedule falls back on, and a template written for `BASIC 5,
FIRST TERM` always beats it. **The Fees dashboard projects expected income
through this exact same resolution**, so what the dashboard predicts and what
generation actually bills cannot drift apart.

Three ways to start one:

1. **Copy a previous term** — pick last term's schedule, name it, choose the new
   term, and optionally apply a flat percentage uplift to every amount.
2. **Pick from common items** — a preset catalogue of the line items Ghanaian
   schools bill (tuition, PTA dues, exams, ICT, first aid, sports & culture,
   maintenance levy, admission, furniture, uniform…). Amounts are deliberately
   left blank; a wrong default is worse than no default.
3. **Type it out.**

A template that has already produced bills is **retired** rather than deleted,
so the bills keep their provenance.

## Generating bills

`Fees → Bills → Student Bills → Generate ALL bills` (or *Generate for class*).

Regenerating is safe and is the normal way to revise a bill:

- Payments already received are never discarded — `total_paid` is recomputed
  from the `payments` table, which is the source of truth.
- Extra charges already raised this term are **preserved**; only the
  template-derived fee lines and arrears are rebuilt.
- A **voided** bill is not resurrected — it has to be restored deliberately.

If a pupil is skipped, the reason is reported. The usual reason is that no
template covers their class, which the Bills hub also flags in red.

## Withdrawing or correcting an issued bill

Restricted to the **Proprietor** and the **Administrator**, enforced on the Node
side (`electron/ipc/fees_billing.js` → `requireElevated`), not in the UI. An
Accountant with `fees.delete` still cannot do it: a bill is what a parent was
told they owe.

| Action | When | Effect |
|---|---|---|
| **Void** | Any bill | Reversible. Drops out of every list, total, debtors report and arrears carry-forward. Money already received stays recorded in Finance — reverse the payments separately if it is being refunded. |
| **Delete** | Only when nothing has been paid | Permanent. Refused otherwise, because it would orphan receipts. |
| **Edit a line** | Any active bill | Add, change or remove a single charge on one pupil's bill. |

All three require a stated reason and write to `audit_log` against the acting
user. Voided bills are reviewable under `Fees → Bills → Voided`, which only
appears for those two designations.

A voided bill is excluded from: the bills list, the debtors report (screen and
print), the Fees dashboard, the main dashboard, the bulk payment sheet, the LAN
API a teacher's phone reads, the cloud `student_snapshot` the parent portal
serves, and mobile-money bill matching.

## Expected income

The Fees dashboard's *Expected Income* means "if all bills are paid":

```
expected = Σ total_billed of this term's active bills
         + Σ (resolved template total) for active pupils with no bill yet
```

Because unbilled pupils are projected through the same resolution generation
uses, **generating the missing bills does not move the figure**. The card also
shows the split, and flags pupils no template covers at all — the difference
between "nobody owes anything" and "nobody has been told what they owe".

## Screens

```
Fees
├── Dashboard
├── Bills                     ← summary strip + warnings
│   ├── Student Bills         the list, generation, drill-in, void/delete/edit
│   ├── Fee Templates         school-fees schedules + extra-charge definitions
│   ├── Extra Charges         raise/withdraw an extra onto existing term bills
│   ├── Books
│   └── Voided                Proprietor / Administrator only
├── Payments
│   ├── Bulk Payment Sheet
│   └── Mobile Payments
├── Discounts
└── Debtors
```

## Printed bill

`electron/ipc/reports.js` → `billHtml()` / `billStyles()`.

Parts A (term fees), B (arrears), C (books), D (extras), then the amount due.
The bands are deliberately shallow — schools print these in their hundreds on
inkjets. Measured against the previous layout on a representative bill: solidly
filled coloured area −40%, total ink coverage −26%, page 10% shorter, same
colours and hierarchy.

## Schema

Added by migration 29 (`electron/db/database.js`):

- `fee_templates.bill_type` — `school_fees` | `supplementary`
- `fee_templates.copied_from_template_id`, `.notes`, `.academic_year_id`
- `student_bills.status` — `active` | `voided`; `.voided_at`, `.voided_by`,
  `.void_reason`, `.supplementary_total`
- `bill_line_items.charge_type` — `fees` | `arrear` | `extra`;
  `.source_template_id`, `.added_at`, `.added_by`

Shared rules live in `electron/ipc/_billing.js`: `resolveFeeTemplate`,
`recomputeBillTotals`, `projectedIncomeForTerm`, `findConflictingSchoolFeesTemplate`,
`FEE_ITEM_PRESETS`, and `round2` (every stored figure is rounded to pesewas at
the point it is computed).
