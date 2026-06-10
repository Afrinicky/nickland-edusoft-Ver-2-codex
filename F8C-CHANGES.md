# Phase F8c — Class → Subject Mapping UI

**Ships:** 2026-06-06
**Builds on:** F8a (live numeric fields) + F8b (qualitative editor)
**Scope:** ONE focused change across the report-render and the classes-settings flows.

**Files modified (two):**
- `electron/ipc/reports.js` — new helper `filterScoresByClassMapping` + two call-site wirings
- `src/renderer/src/pages/Settings/Classes.jsx` — subject checkbox panel in the add/edit modal

**No schema changes. No migrations. No new IPC handlers. No new preload bindings.**
Everything F8c needed already existed in F7a-v2 — `class_subjects` table, both
`settings:get-class-subjects` / `settings:set-class-subjects` handlers, and both
`getClassSubjects` / `setClassSubjects` preload bindings were already plumbed.
F8c is the UI + filter that finally makes them do something visible.

---

## The central F8c invariant — the critical fallback rule

This is **the** rule that prevents the regression past attempts at this feature
ran into:

> **A class that has zero rows in `class_subjects` MUST behave exactly as it did before F8c.**
> **The report card MUST show all the student's active subjects, unchanged.**

The filter helper enforces this in **four** independent safety branches:

1. `classGroupId` is falsy (null / undefined / 0) → return scores unchanged
2. `scores` is not an array, or is empty → return as-is
3. SQL query for `class_subjects` returns zero rows → return scores unchanged
4. SQL query throws any error → log warn, return scores unchanged

In branches 1, 3, and 4, the **exact same array reference** is returned — no
clone, no reorder, nothing. Bit-for-bit identical to the pre-F8c render.

---

## What changed

### Backend (electron/ipc/reports.js)

#### New helper `filterScoresByClassMapping(db, classGroupId, scores)`

```
classGroupId falsy            → return scores
scores not array / empty      → return scores
no class_subjects rows        → return scores            (critical fallback)
any SQL error                 → console.warn + return scores
otherwise                     → filter to only subjects in the mapping
```

#### Wired into two call-sites

Both report-card render paths now filter scores through the helper *before*
handing them to the HTML template:

- `reports:render-card-html` (in-app preview) — line ~30
- `generateReportCards` (PDF batch generator) — line ~196

The `meta.scores_count` returned to the renderer now reflects the **filtered**
count, so the "No scores recorded yet" banner triggers based on what will
actually be printed (not the raw count including off-mapping rows).

### Frontend (Classes.jsx)

The class add/edit modal now has a new section: **"Subjects taught in this class"**

- Loads the master subject list once on component mount (`listSubjects`)
- When editing an existing class, fetches its current mapping (`getClassSubjects`) and pre-checks the boxes
- Grid of checkboxes (responsive, 2-4 columns depending on width), scrollable
  if the school has many subjects
- Three controls in the row label:
  - "**N of M selected**" live count
  - **Select all** button
  - **Clear** button (sets the mapping to empty → falls back to "show all")
- A helper line explicitly states the fallback behaviour:
  > When nothing is checked, the report card shows all active subjects by default.

The save flow now does two backend calls:
1. `saveClass` (returns `{ ok, id }`)
2. `setClassSubjects(id, selectedSubjectIds)` (deletes existing rows for the
   class, inserts the new selections in a transaction)

If `saveClass` succeeds but `setClassSubjects` fails, the user sees:
*"Class saved, but subject mapping could not be saved."* — so they know the
state is partial and can re-open the modal to retry.

---

## What this fixes (Section 4.3 of the handoff)

**Before F8c:** Every student's terminal report listed all 17 subjects in the
system, even though BS1 only takes 8 of them. There was no UI to express
"these are the subjects this class is taught."

**After F8c:** Open Settings → Classes → Edit (or + Add). Check the subjects
this class is taught. Save. Every report card printed for that class — single
or whole-class — now lists only those subjects.

If you forget to map a class, nothing breaks: that class continues to print
all subjects, just as before. The feature is opt-in at the class level.

---

## What's intentionally NOT in F8c

Per the working discipline (one change at a time, no batching):

- ❌ Filter score-entry tabs (`scores:exam-sheet`, `scores:end-of-term`, ClassScoresTab subject dropdown) by the same mapping. Listed as "optional, lower priority" in the handoff — separate phase if needed.
- ❌ Bulk "copy mapping from another class" button.
- ❌ Permission-gating of `settings:set-class-subjects` — matches the existing settings.js pattern (no other settings write handlers are gated either).
- ❌ Head Teacher signature bug → **F8d**

---

## Verification (after install)

1. Go to **Settings → Classes**. Pick a class with a small number of subjects (e.g. BS1).
2. Click **Edit**. The modal opens. Scroll to the bottom — confirm the new "Subjects taught in this class" section is present with all subjects listed and **none checked** (assuming no prior mapping).
3. Open the terminal report for any student in this class → confirm it still lists **all subjects** (fallback works for unmapped class).
4. Back in the Edit modal, check 4-5 subjects, click **Save**.
5. Open the same student's report again → confirm it now lists **only the checked subjects**. The position/rank/attendance/qualitative fields are unaffected (still F8a + F8b behaviour).
6. Print **🖨 Print Whole Class** — every PDF page should list the same checked subjects.
7. Re-open the Edit modal — confirm the checkboxes are **pre-checked** matching what you saved (the mapping persisted).
8. Click **Clear** in the modal, then Save → report goes back to "show all subjects" (fallback restored).
9. Test on a class with **no** mapping configured at all — should always show all subjects.

If something appears wrong:
- **Modal shows "Loading…" forever** → check Electron console for `[Classes/F8c] could not load class mapping` — likely a DB issue.
- **Report still shows all subjects after mapping** → confirm `Save` was clicked in the modal; check Electron console for any `[reports/F8c]` warnings (would indicate a SQL fallback fired).
- **Report shows no subjects at all** → student probably has scores only in subjects NOT in the mapping. Either expand the mapping or accept that off-mapping scores don't print.

---

## Test results

- **F8c filter helper**: 19/19 runtime assertions passed
  - Normal filtering (classes 1 and 3 with different mappings)
  - All four fallback paths (no class id, no mapping rows, null/undefined/0 class id, SQL error)
  - Reference equality preserved on all fallback branches (no array clone)
  - Order preservation (filter is a `.filter`, not a reorder)
  - Defensive non-array input handling
  - Off-mapping scores correctly dropped
- **F8a regression**: 29/29 still passing
- **F8b regression**: 47/47 still passing
- **Full-tree parse**: 132/132 JS/JSX files clean

Total runtime assertions across F8a + F8b + F8c: **95/95 passing**.
