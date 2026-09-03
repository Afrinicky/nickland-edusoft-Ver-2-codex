# Working while the desktop is off

*Advice, not a plan of work. Nothing here has been built.*

The ask: no API backend or server for the cloud. The desktop host stays the
source of truth but will not always be on. Teachers and parents keep using the
web and phone app while it is off, keep making entries, and when the host comes
back it takes everything in automatically — so that a teacher can enter exam and
class scores after school hours.

---

## 1. You have already built this

This is the important thing to know before spending money on it. The teacher who
enters marks at 8pm with the school computer off, and the desktop that takes them
in the next morning, is not a feature to design. It runs, and `cloud/test/staff.js`
covers it end to end:

```
✓ scores queued
✓ an impossible score is refused while the teacher is still looking at it
✓ the score sheet shows the queued marks
✓ and no invented total for a mark the school has not weighted yet
✓ the desktop pulls the queued work
✓ the scores are in, and weighted by the desktop
✓ the work is attributed to the teacher who did it
✓ a redelivered batch applies without error
✓ the canteen money is NOT taken twice
✓ and the register now reads from the school itself, not the queue
```

Thirteen kinds of change already survive the host being off:

| | |
|---|---|
| `score_entry` | exam marks |
| `assessment_entry` | class work and tests |
| `attendance_mark` | the register |
| `term_remarks` | end-of-term remarks |
| `canteen_collect` | the morning collection |
| `homework_create` | homework set for a class |
| `lesson_note_save` | lesson notes |
| `leave_request`, `staff_clock` | a teacher's own records |
| `message_reply`, `announcement_create` | talking to parents |
| `staff_password_change`, `staff_password_reset_request` | signing in |
| `parent_update` | a parent's own details |

The mechanism: the cloud writes each change to a `cloud_changes` queue. The
desktop pulls a batch on a timer, applies each one through
`electron/server/sync/apply_staff.js` — which **re-checks the teacher's
permissions against the desktop's own database before writing**, so the cloud
cannot be talked into granting access the school did not give — and advances a
cursor. Replayed batches are no-ops.

**So item 4 is not "build offline sync". It is two smaller questions: where the
cloud runs, and four rough edges in what is already there.**

---

## 2. On "no server"

There is one thing that cannot be designed away. When a teacher saves a mark at
8pm on their own phone, that mark has to land somewhere that is **not** the
teacher's phone. If it only lives in their browser it is gone when they clear
their history, invisible to the head teacher, and lost entirely if they mark on
the phone and then open the app on the staffroom PC. Something has to accept an
authenticated write and hold it durably.

That something is a server. The real question is whether it is a server *you
operate* — and the answer to that can genuinely be no.

**Recommended: serverless functions plus Neon.** This is what "no server" means
in practice and it is already where the repo is pointed. There is no process to
keep alive, nothing to SSH into, no operating system to patch, no dyno to pay
for while the school sleeps. A function boots when a teacher saves a mark and
disappears afterwards; Neon scales to zero between requests. For one school it
plausibly costs nothing. `cloud-python/` already speaks the whole contract, and
`app/store.py` is already written against Neon — moving it behind functions is
a packaging change, not a rewrite.

**Not recommended: database-as-API** (Supabase/PostgREST, Firebase), where the
app talks straight to the database and row-level security does the
authorisation. It is the only option with genuinely no backend code, and that
is exactly the problem. The rules deciding that a teacher may mark their own
class's register and not Basic 6's currently live in one place, in
`scopeLib`, in JavaScript, under test. Re-expressing them as SQL policies means
writing them a second time, in a language where a mistake is not a failed test
but every pupil's marks readable by everyone. The saving is not worth it.

**Also fine: leave it where it is.** `cloud-python` on Render's paid tier is a
server you do not administer. The free tier is not fine — it sleeps, and the
cold start lands squarely on the teacher opening the app at 8pm.

---

## 3. The four rough edges

These are worth fixing before the host is routinely off for days at a time.

### The cloud silently overwrites a desktop correction

`applyScores` writes the cloud's value unconditionally:

```js
saveExamMark(db, { studentId: sid, subjectId, termId, examScore: v });
```

So: a teacher enters 62 from home on Monday night. On Tuesday morning the head
teacher spots a marking error on the desktop and corrects it to 68. The sync
timer then drains Monday's queue and puts it back to 62. Nobody is told.

The fix is ordinary optimistic concurrency: stamp each cloud change with the
version of the row it was based on, and on apply, skip — and record — any
change whose base no longer matches. `applyPasswordChange` already does a
version of this (`if (existing.status === 'approved') return true; // reviewed;
not theirs to rewrite`); the same idea needs to reach scores, remarks and
assessments.

Note that this is *only* a risk for the fields both sides edit. Marks are
usually owned by one subject teacher, which is why it has not bitten yet. Term
remarks are the dangerous one — a head teacher and a class teacher genuinely do
both write them.

### Report cards cannot be produced while the host is off

Every printout in the apps is fetched from the desktop's own generator — which
was the right call, and is why the teacher app, the parent app and the desktop
print byte-identical documents. The consequence is that with the host off, a
parent asking for a report card gets nothing.

If that matters, the honest options are to say so in the app ("report cards are
available when the school's computer is on") or to cache the last generated HTML
per pupil per term in the cloud when the host pushes. The second is cheap and I
would take it: a report card for a closed term does not change.

### The queue is never pruned

`cloud_changes` rows are kept forever; the cursor just advances past them. Not a
correctness problem — replays are already safe — but it grows without limit.
A `DELETE FROM cloud_changes WHERE id <= applied_cursor AND created_at < now() -
interval '90 days'` on a schedule is enough.

### A long outage drains slowly

`pending_changes` returns at most 500 per pull, and one pull happens per timer
tick. A host that was off for a month with a few thousand queued changes takes
several ticks to catch up. Nothing breaks; the school just sees the desktop
"still catching up" for a while. Either loop the pull until the batch comes back
short, or say so on the sync screen so it does not look stuck.

---

## 4. What I would do, in order

1. **Move the cloud onto functions + Neon.** No behaviour changes; it is where
   the money and the operations burden go away. `DEPLOY.md` covers the Neon half
   already.
2. **Add version stamps to the queued changes** and make `apply_staff.js` skip a
   change whose base has moved. This is the one with real data at stake.
3. **Cache report-card HTML in the cloud on push.** Small, and it removes the
   last thing a parent cannot do while the host is off.
4. **Prune the queue; loop the pull.** Housekeeping.

One thing not to do: make the cloud authoritative for anything. The value of
"the desktop is the source of truth" is that the school's own machine, sitting
in the office, holds the real record and does not depend on anybody's uptime or
anybody's bill being paid. The queue is a mailbox, not a second ledger.
