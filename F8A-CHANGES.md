# Phase F8a — Live-compute Position / Number on Roll / Attendance

**Ships:** 2026-06-06
**Scope:** ONE focused change. Single file modified: `electron/ipc/reports.js`.
**No schema changes. No UI changes. No migrations. No preload changes.**

---

## What changed

### Added — one helper function

`enrichSummaryLive(db, studentId, termId, classGroupId, base)` in `electron/ipc/reports.js`
(located between `signatureDataUri` and `reportCardHtml` for readability).

Takes the persisted `student_term_summary` row as the **fallback baseline**, then
runs four focused SQL queries (each in its own `try/catch`) to override these
four fields with live values:

| Field | Live source |
|---|---|
| `class_rank` | Active students in same class ranked by `AVG(scores.total_score) DESC`, strict ordinal — mirrors existing `scores:rank-class` semantics exactly. Students with zero score rows get no rank (left blank). |
| `number_on_roll` | `COUNT` of students with `current_class_id = ? AND status = 'Active'`. |
| `days_present` | `COUNT(*)` of `student_attendance` rows for this student+term where `LOWER(status) = 'present'`. |
| `total_days` | `COUNT(DISTINCT date)` of attendance for any active student in the same class+term. |

**Fallback discipline:** if any internal query throws, that field falls back
silently to the persisted `student_term_summary` value (or stays blank if there
was no persisted row). A `console.warn` is logged for diagnosis but never
escapes to the user.

### Modified — exactly two call-sites

Both pass the loaded `summary` through `enrichSummaryLive` before handing it
to `reportCardHtml`:

1. `reports:render-card-html` (in-app preview) — line ~33
2. `generateReportCards` (PDF generation loop) — line ~198

---

## What this fixes (Section 4.1 of the handoff)

Before F8a:
- **Position in Class** was blank unless someone clicked "Rank Class" first
- **Number on Roll** was blank for the same reason
- **Attendance** ("__ out of __") was blank because nothing wrote to those columns

After F8a — every terminal report card auto-computes those four fields from
the live source-of-truth tables at render time. No teacher action required.

The qualitative fields (Conduct Traits, Learner Interests, Learner Talents,
Teacher's Remarks) are **NOT** touched by F8a — they remain blank by design.
That's F8b's job (UI editor + `scores:save-term-summary` handler).

---

## Verification (after install)

1. Open any student's report at `/academics/report/:studentId`.
2. Confirm "Position in Class" and "Number on Roll" now show numbers
   (assuming the student has at least one score row and is in a class).
3. Confirm "Attendance: __ Out of __" now shows numbers
   (assuming the class has any attendance marked for this term).
4. Generate a PDF from "🖨 Print Whole Class" — every page should have
   matching values.

If any field still shows blank after F8a:
- **Position blank** → the student has no `scores` rows for this term yet.
- **Roll blank** → student's `current_class_id` is NULL or class has no active students.
- **Attendance blank** → no `student_attendance` rows exist for the term/class.

These are all correct "no data" states — not bugs.

---

## What's intentionally NOT in F8a

Per the working discipline (one change at a time, no batching):

- ❌ Conduct / Interests / Talents / Remarks editor → **F8b**
- ❌ Class → subject mapping → **F8c**
- ❌ Head Teacher signature bug investigation → **F8d**
- ❌ Any other Corrections_3 item

Each will ship as its own zip after F8a is confirmed working.

---

## Test results

29 / 29 assertions passed against an in-memory SQLite reproducing the
production schema. Cases covered:

- Live values override stale persisted values (Alice case)
- No persisted row → live values fill everything (Bob case)
- Student with zero score rows → no rank assigned, blank stays blank (Eve case)
- Missing `classGroupId` → rank/roll/total_days fall back to persisted (defensive)
- Case-insensitive `'Present'` / `'present'` status matching
- Exception in any query → persisted value survives, never produces broken output
