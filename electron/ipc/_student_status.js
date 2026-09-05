// Nickland Edusoft — What a pupil's status can be.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// One list. There were two, and they did not agree.
//
// The desktop offered Active / Inactive / Graduated / Transferred. The browser
// offered Active / Withdrawn / Graduated / Suspended. Both wrote to the same
// column, so a pupil marked "Withdrawn" at the gate did not appear under the
// office's "Inactive" filter, a pupil marked "Transferred" at the office was
// not a status the browser could even display, and the two screens reported
// different roll sizes for the same school.
//
// ── The vocabulary ──────────────────────────────────────────────────────────
//
// Every value either screen could already write is kept, because a school's
// existing records use them and a migration that renamed them would be
// rewriting history to tidy a list. What is new is that both screens now offer
// the same six, in the same order, with the same meanings:
//
//   Active       on the roll, in class
//   Suspended    temporarily out, still on the roll and still billed
//   Withdrawn    the parent took them out
//   Transferred  left for another school — a withdrawal a school distinguishes
//                because it is asked to say so on the GES returns
//   Graduated    completed the school
//   Inactive     the older catch-all, kept because records carry it
//
// ── The one rule that matters ───────────────────────────────────────────────
//
// "On the roll" is `status === 'Active'`, everywhere, and always has been.
// Adding a status never quietly adds anybody to a class list, a bill run or a
// register — it only gives the office a truer word for why somebody is not
// there.

const STATUSES = [
  { value: 'Active', label: 'Active', on_roll: true,
    note: 'On the roll, in class' },
  { value: 'Suspended', label: 'Suspended', on_roll: false,
    note: 'Temporarily out, still on the roll', needs_reason: true },
  { value: 'Withdrawn', label: 'Withdrawn', on_roll: false,
    note: 'The parent took them out', needs_reason: true },
  { value: 'Transferred', label: 'Transferred', on_roll: false,
    note: 'Left for another school', needs_reason: true },
  { value: 'Graduated', label: 'Graduated', on_roll: false,
    note: 'Completed the school' },
  { value: 'Inactive', label: 'Inactive', on_roll: false,
    note: 'No longer attending — the older catch-all', needs_reason: true },
];

const VALUES = STATUSES.map(s => s.value);

/** Is this pupil counted as being on the roll? */
function onRoll(status) {
  return String(status || 'Active') === 'Active';
}

/** A status a school may actually put a pupil into. */
function isValid(status) {
  return VALUES.includes(String(status || ''));
}

/** The tone a status is drawn in, so both apps colour it the same way. */
function tone(status) {
  if (status === 'Active') return 'success';
  if (status === 'Graduated') return 'primary';
  if (status === 'Suspended') return 'warning';
  return 'danger';
}

module.exports = { STATUSES, VALUES, onRoll, isValid, tone };
