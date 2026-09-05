// Nickland Edusoft — What a mark on the register can say.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// One vocabulary, and one rule about reasons. There were two of each.
//
// The office PC's weekly register offered Present and Absent, and kept a
// written reason against an absence. The browser's register offered Present,
// Absent and Late, and kept no reason at all — so a class marked on a phone in
// the corridor produced a register with a hole in it that the office could not
// fill without re-marking the day, and a pupil marked Late anywhere lost the
// reason entirely, because every writer in the system did this:
//
//     const notes = status === 'absent' ? (reason || null) : null;
//
// Late is exactly the mark a school asks a reason for. A child who arrives at
// nine has a story — a funeral, a clinic, a lorry that did not come — and it
// is the story a head teacher wants when a pattern shows up three weeks later.
// Throwing it away because the pupil was eventually IN school is the one case
// the old rule got backwards.
//
// ── The vocabulary ──────────────────────────────────────────────────────────
//
//   present   in school, on time
//   late      in school, after the bell — needs a reason
//   absent    not in school                — needs a reason
//   excused   an absence the school itself authorised — needs a reason
//
// `excused` is not offered by either register; it is here because older
// databases carry it and a label is better than a raw word on a printout.
//
// ── Counting ────────────────────────────────────────────────────────────────
//
// A late pupil is PRESENT for the purposes of "was this child in school", and
// the attendance rate has always been counted that way. `present_count` stays
// what it has always been — the days marked exactly present — so no school's
// existing register changes its totals; `in_school_count` is the count that
// answers the attendance question, and both are reported.

const STATUSES = [
  { value: 'present', label: 'Present', mark: '✓', in_school: true },
  { value: 'late', label: 'Late', mark: 'L', in_school: true, needs_reason: true },
  { value: 'absent', label: 'Absent', mark: '✗', in_school: false, needs_reason: true },
];

// Marked nowhere, kept everywhere: a status a database may already hold.
const LEGACY = [
  { value: 'excused', label: 'Excused', mark: 'E', in_school: false, needs_reason: true },
];

const ALL = STATUSES.concat(LEGACY);
const VALUES = STATUSES.map(s => s.value);

const find = (status) => ALL.find(s => s.value === String(status || '')) || null;

/** A status the register may write. */
function isValid(status) {
  return VALUES.includes(String(status || ''));
}

/** Does this mark call for the teacher to say why? */
function needsReason(status) {
  return !!(find(status) || {}).needs_reason;
}

/** Was the pupil in school at all? Late counts; absent does not. */
function inSchool(status) {
  return !!(find(status) || {}).in_school;
}

function label(status) {
  const s = find(status);
  return s ? s.label : String(status || '').replace(/_/g, ' ');
}

function mark(status) {
  const s = find(status);
  return s ? s.mark : '';
}

/**
 * The reason to store against a mark.
 *
 * Present clears it — a reason on a present pupil is a leftover from the day
 * they were away, and leaving it there is how a printout ends up explaining an
 * absence that did not happen. Absent and late keep what they are given, and
 * fall back to what is already on the row so that re-marking a day does not
 * silently discard a reason a teacher typed earlier.
 */
function notesFor(status, reason, existing) {
  if (!needsReason(status)) return null;
  const given = reason == null ? '' : String(reason).trim();
  if (given) return given;
  const kept = existing == null ? '' : String(existing).trim();
  return kept || null;
}

module.exports = { STATUSES, ALL, VALUES, isValid, needsReason, inSchool, label, mark, notesFor };
