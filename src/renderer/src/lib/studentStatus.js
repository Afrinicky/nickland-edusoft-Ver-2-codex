// Nickland Edusoft — What a pupil's status can be.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The renderer's copy of the answer electron/ipc/_student_status.js gives.
// That file is the enforcement; this exists so a screen can DRAW the choices
// without a round trip, and it can only ever agree with it.
//
// There used to be two lists. The desktop offered Active / Inactive /
// Graduated / Transferred; the browser offered Active / Withdrawn / Graduated
// / Suspended. Both wrote the same column, so a pupil withdrawn at the gate
// did not appear under the office's "Inactive" filter, and the two screens
// reported different roll sizes for the same school.

export const STATUSES = [
  { value: 'Active', label: 'Active', note: 'On the roll, in class' },
  { value: 'Suspended', label: 'Suspended', note: 'Temporarily out, still on the roll', needsReason: true },
  { value: 'Withdrawn', label: 'Withdrawn', note: 'The parent took them out', needsReason: true },
  { value: 'Transferred', label: 'Transferred', note: 'Left for another school', needsReason: true },
  { value: 'Graduated', label: 'Graduated', note: 'Completed the school' },
  { value: 'Inactive', label: 'Inactive', note: 'No longer attending — the older catch-all', needsReason: true },
];

export const STATUS_VALUES = STATUSES.map(s => s.value);

/** Is this pupil counted as being on the roll? */
export const onRoll = (status) => String(status || 'Active') === 'Active';

/** Does moving a pupil into this status need a stated reason? */
export const needsReason = (status) =>
  !!(STATUSES.find(s => s.value === status) || {}).needsReason;

/** The badge tone a status is drawn in, so both apps colour it the same way. */
export function statusTone(status) {
  if (status === 'Active') return 'badge-success';
  if (status === 'Graduated') return 'badge-primary';
  if (status === 'Suspended') return 'badge-warning';
  return 'badge-danger';
}

export default { STATUSES, STATUS_VALUES, onRoll, needsReason, statusTone };
