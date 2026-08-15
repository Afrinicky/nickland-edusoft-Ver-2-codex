# The finance workbook — running when the system is down

One Excel file holding **everything to do with money**: fees, canteen, books,
transport, other income, expenses and payroll. If the computer running Nickland
Edusoft fails, the school keeps collecting in the workbook. When the system is
back, the workbook is imported and nothing is lost.

`Finance → Workbook`.

## Where it came from

The school ran on a Term-3 fees ledger in Excel. Its limits are why Edusoft
exists: the **Canteen Ledger sheet was permanently empty**, there was no
payroll, no expenses, no other income, and each pupil had only three hard-coded
payment slots. The workbook keeps the parts that worked — the fee-schedule
matrix, the student ledger, the arrears register, the per-class summary — and
fills in everything that was missing.

## The sheets

| Sheet | What it is | Import? |
|---|---|---|
| **Start Here** | What this is and how to use it | — |
| **Fee Schedule** | Line items × classes, resolved through the same template rules bill generation uses | — |
| **Student Ledger** | Billed / discount / arrears / paid / balance per pupil | — |
| **Fee Payments** | School fee collection | ✅ |
| **Canteen Ledger** | Days paid, exempt, owing and money in, per pupil | — |
| **Canteen Payments** | Daily canteen collection | ✅ |
| **Books Payments** | Books bill collection | ✅ |
| **Transport Payments** | Bus/transport fees | ✅ |
| **Other Income** | Donations, PTA levies, hall hire, sales | ✅ |
| **Expenses** | Supplies, utilities, repairs — everything out except salaries | ✅ |
| **Payroll** | Salaries actually paid | ✅ |
| **Arrears Register** | Chase list, largest balance first | — |
| **Finance Summary** | Income and expense by category, fees position, per class | — |
| **Reference Data** | Index numbers, staff numbers, valid categories | — |

## Working offline

1. **Export** before you need it — `Finance → Workbook → Export workbook`. Keep
   a copy somewhere other than this computer.
2. Grey rows marked **SYNCED** are already in the system. Editing them does
   nothing on import.
3. Type new entries on the **green rows**. Method and category cells are
   dropdowns; dates and amounts are pre-formatted.
4. **Index No must match the pupil exactly** — copy it from Student Ledger or
   Reference Data. Same for Staff No on the Payroll sheet.
5. Leave **Entry Ref** blank. The system fills it in.

## Bringing it back

`Finance → Workbook → Choose workbook…` runs a **preview** first: it parses,
validates and checks for duplicates, then reports exactly what it will do —
**without writing anything**. Only when you confirm does money move.

Each row is handed to the same service the app itself uses:

| Sheet | Goes through |
|---|---|
| Fee Payments | `fees:record-payment` |
| Canteen Payments | `canteen.recordCanteenPayment` |
| Books Payments | `books:record-payment` |
| Transport Payments | `transport.recordPayment` |
| Other Income / Expenses | `postIncome` / `postExpense` (the central ledger) |
| Payroll | `payroll:mark-paid` |

So an imported fee payment updates the pupil's bill, mints and delivers a
receipt, and posts to the finance ledger under the term its **date** falls in —
not whichever term happens to be current. An imported canteen payment marks the
days paid, not just the cash. An imported salary settles payroll *and* posts the
expense. **The workbook is never a second write path into the database.**

## Why importing twice is safe

Every row carries a fingerprint of its own contents — the sheet plus the fields
that make two payments genuinely different (date, pupil, amount, reference).
That key is recorded in `workbook_import_log`, which has a **UNIQUE constraint**
on it. Import the same file five times and rows 2–5 are skipped.

The write order matters too. A row is **claimed** in the log first, then written,
then filled in; if the write fails the claim is released. So an interruption
leaves a row *not imported* — visible and retryable — rather than *imported
twice*, which a school cannot recover from.

Two genuinely identical rows in one file (a school really can take two GHS 50
payments from one pupil on one day) stay distinct, and stay distinct
reproducibly when that file is imported again.

## When something is wrong

Bad rows are reported one by one — *"Fee Payments, row 14: No pupil with Index
No AVE/99/99999"*. Fix them in the workbook and import it again: everything that
already succeeded is remembered, so only the corrected rows come in.

Robustness built in:

- Columns are matched by **header text**, not position — inserting a column
  still imports.
- Dates parse from ISO, `dd/mm/yyyy` (the format the school's own ledger used),
  Excel serial numbers and Date objects, without slipping a day.
- Amounts parse from `GHS 1,250.50`, plain numbers and formula cells.
- Rounded to pesewas at the point of entry.

## Backups

Every backup **refreshes the workbook and includes it in the zip**
(`finance-workbook/Finance-Workbook-CURRENT.xlsx`, also named in
`manifest.json`). Restore puts it back. A backup carrying a stale workbook would
hand the school a picture of the term as it stood weeks ago — exactly when they
can least afford it. If the workbook cannot be built, the backup still succeeds
and the failure is written to the system log.

## Permissions

- **Export** needs `finance → View`.
- **Preview / Import** needs `finance → Manage` (see `docs/ACCESS_CONTROL.md`).
- Every import writes an audit entry naming the file, the totals and who ran it.
  `Finance → Workbook` shows the full history of what has ever come in.

## Code

| File | Role |
|---|---|
| `electron/ipc/_workbook_schema.js` | The column contract, shared by export and import; the idempotency key; date/money parsing |
| `electron/ipc/finance_workbook_export.js` | Builds the workbook |
| `electron/ipc/finance_workbook_import.js` | Reads it back, routes each row to the real service |
| `electron/ipc/finance_workbook.js` | IPC, file dialogs, `refreshWorkbook` |
| `src/renderer/src/pages/Finance/WorkbookTab.jsx` | The UI |
| migration 30 | `workbook_import_log` |
