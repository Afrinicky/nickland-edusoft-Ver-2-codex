// Nickland Edusoft — What a mark on the register can say.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The renderer's copy of the answer electron/ipc/_attendance.js gives. That
// file is the enforcement; this exists so the register can DRAW the marks
// without a round trip, and it can only ever agree with it.
//
// Late is a mark that carries a reason. It used to be dropped everywhere —
// `status === 'absent' ? reason : null` — so a child who arrived at nine
// because of a funeral lost the story the head teacher wanted three weeks
// later, when the pattern showed up.

export const MARKS = [
  { value: 'present', label: 'Present', glyph: '✓', cls: 'register-present', inSchool: true },
  { value: 'late', label: 'Late', glyph: 'L', cls: 'register-late', inSchool: true, needsReason: true },
  { value: 'absent', label: 'Absent', glyph: '✗', cls: 'register-absent', inSchool: false, needsReason: true },
];

const find = (status) => MARKS.find(m => m.value === status) || null;

export const MARK_VALUES = MARKS.map(m => m.value);

/** Does this mark call for the teacher to say why? */
export const needsReason = (status) => !!(find(status) || {}).needsReason;

/** Was the pupil in school at all? Late counts; absent does not. */
export const inSchool = (status) => !!(find(status) || {}).inSchool;

export const markGlyph = (status) => (find(status) || {}).glyph || '';
export const markClass = (status) => (find(status) || {}).cls || '';
export const markLabel = (status) => (find(status) || {}).label || '';

export default { MARKS, MARK_VALUES, needsReason, inSchool, markGlyph, markClass, markLabel };
