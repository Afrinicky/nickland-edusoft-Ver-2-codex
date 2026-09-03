// Nickland Edusoft Cloud — the finance office and the administration, off-LAN.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The twin of the desktop's server/finance_api.js and server/admin_api.js, for
// when the school's own machine is switched off. It is a much smaller surface
// than either, and the difference is deliberate rather than unfinished:
//
//   READS come from two projections the desktop pushes — finance_summary and
//   admin_summary (see electron/server/sync/office_projection.js). They are
//   summaries, not the ledger: a term's position, the arrears, what is waiting
//   to be approved. Nobody needs the whole of a school's books on a phone in a
//   taxi, and a copy of them on somebody else's server is a liability the
//   school did not ask for.
//
//   WRITES are only the two that move no money: approving leave, and signing
//   off a lesson note. Both are queued for the desktop and applied there.
//
//   TAKING MONEY is not here at all. Recording a fee payment posts to the
//   ledger, consumes a receipt number and prints a receipt — with the school's
//   machine off, none of those can happen, and a "payment" that sits in a
//   queue until Monday is not a receipt a parent can be shown. The office
//   takes money on the school's own network, where the books are.
//
//   THE SYSTEM PORTAL is not here either. Accounts, access levels and the
//   audit trail are administered where the system is: on the school's network
//   or at the desktop itself. It is the one portal an attacker most wants and
//   the one nobody needs from a phone at the roadside.
//
// Permissions are checked here against the projected map AND again on the
// desktop before anything is applied. A projection is a copy; a copy can be
// stale.

const ACTION_KEY = { view: 'canView', create: 'canCreate', edit: 'canEdit', delete: 'canDelete' };

function can(rec, module, action) {
  if (!rec) return false;
  if (rec.is_admin) return true;
  const p = (rec.permissions || {})[module];
  return !!(p && p[ACTION_KEY[action]]);
}

// The two writes this surface accepts, and the only ones the desktop will take
// from it. Named here as well as in staff.js so `pendingSummary` counts them.
const OFFICE_WRITE_TYPES = ['leave_decision', 'lesson_note_decision'];

async function payload(store, school_id, type, key) {
  const rows = await store.listSnapshots(school_id, type);
  const hit = rows.find(r => r.entity_key === key);
  return hit ? hit.payload : null;
}

async function pending(store, school_id, types) {
  if (typeof store.pendingChanges !== 'function') return [];
  try { return await store.pendingChanges(school_id, { types }); } catch (_) { return []; }
}

// ── Finance ─────────────────────────────────────────────────────────────────

async function financeOverview(store, school_id, rec) {
  if (!can(rec, 'fees', 'view') && !can(rec, 'finance', 'view') && !can(rec, 'payroll', 'view')) {
    return { ok: false, status: 403, error: 'Access denied.' };
  }
  const s = await payload(store, school_id, 'finance_summary', 'finance:school');
  const out = {
    ok: true, mode: 'cloud',
    term: s ? s.term : null,
    currency: (s && s.currency) || 'GHS',
    updated_at: s ? s.updated_at : null,
    // Everything here was true when the school last synchronised. Saying so is
    // the difference between a stale figure and a wrong one.
    stale: !s,
    may: {
      fees: can(rec, 'fees', 'view'),
      finance: can(rec, 'finance', 'view'),
      payroll: can(rec, 'payroll', 'view'),
      // Off-LAN nobody may take money, however the school has granted fees.
      record_payment: false,
    },
    record_payment_is_host_only: true,
  };
  if (!s) return out;
  // Each section is dropped, not zeroed. A head teacher without `finance` is
  // shown a school with no expenditure section, not one that spent nothing.
  if (can(rec, 'fees', 'view')) {
    out.fees = s.fees;
    out.recent = s.recent || [];
    out.top_debtors = s.top_debtors || [];
  }
  if (can(rec, 'finance', 'view')) {
    out.ledger = s.ledger;
    out.expense_categories = s.expense_categories || [];
  }
  if (can(rec, 'payroll', 'view')) out.payroll = s.payroll;
  return out;
}

async function financeDebtors(store, school_id, rec) {
  if (!can(rec, 'fees', 'view')) return { ok: false, status: 403, error: 'Access denied.' };
  const d = await payload(store, school_id, 'debtor_list', 'debtors:school');
  const s = await payload(store, school_id, 'finance_summary', 'finance:school');
  return {
    ok: true,
    term: s ? s.term : null,
    debtors: (d && d.debtors) || [],
    by_class: (s && s.debtors_by_class) || [],
    total: ((d && d.debtors) || []).reduce((n, r) => n + (Number(r.balance) || 0), 0),
    updated_at: d ? d.updated_at : null,
  };
}

// ── Administration ──────────────────────────────────────────────────────────

async function adminOverview(store, school_id, rec) {
  const s = await payload(store, school_id, 'admin_summary', 'admin:school');
  const out = {
    ok: true, mode: 'cloud',
    term: s ? s.term : null,
    date: s ? s.date : null,
    updated_at: s ? s.updated_at : null,
    stale: !s,
    may: {
      students: can(rec, 'students', 'view'), staff: can(rec, 'staff', 'view'),
      academics: can(rec, 'academics', 'view'), fees: can(rec, 'fees', 'view'),
      notifications: can(rec, 'notifications', 'view'),
    },
    // Admitting a pupil writes an admission number the desktop issues, so it
    // is not something to queue from a phone: two offices admitting at once
    // off-LAN would both be handed the same number.
    admissions_are_host_only: true,
  };
  if (!s) return out;
  if (can(rec, 'students', 'view')) {
    out.enrolment = s.enrolment;
    out.by_class = s.by_class || [];
    out.attendance = s.attendance;
  }
  if (can(rec, 'staff', 'view')) {
    out.staff = s.staff;
    out.approvals = { ...(out.approvals || {}), leave: (s.approvals || {}).leave || 0 };
  }
  if (can(rec, 'academics', 'view')) {
    out.classes = s.classes || [];
    out.approvals = { ...(out.approvals || {}), lesson_notes: (s.approvals || {}).lesson_notes || 0 };
  }
  if (can(rec, 'fees', 'view')) out.fees = s.fees;
  return out;
}

// What is waiting for a decision, with anything already decided off-LAN
// removed. Without that a head teacher approving leave on the bus would watch
// the same request sit in the list until the school opened on Monday.
async function approvals(store, school_id, rec) {
  const s = await payload(store, school_id, 'admin_summary', 'admin:school');
  const decided = new Set();
  for (const ch of await pending(store, school_id, OFFICE_WRITE_TYPES)) {
    const p = ch.payload || {};
    decided.add(`${ch.type}:${p.id}`);
  }
  const out = { ok: true, leave: [], lesson_notes: [], updated_at: s ? s.updated_at : null };
  if (!s) return out;
  if (can(rec, 'staff', 'view')) {
    out.leave = (s.pending_leave || []).filter(r => !decided.has(`leave_decision:${r.id}`));
  }
  if (can(rec, 'academics', 'view')) {
    out.lesson_notes = (s.pending_lesson_notes || []).filter(r => !decided.has(`lesson_note_decision:${r.id}`));
  }
  out.may_decide = {
    leave: can(rec, 'staff', 'edit'),
    lesson_notes: can(rec, 'academics', 'edit'),
  };
  return out;
}

async function submitDecision(store, school_id, rec, kind, body) {
  const module = kind === 'leave' ? 'staff' : 'academics';
  if (!can(rec, module, 'edit')) return { ok: false, status: 403, error: 'Access denied.' };
  const id = parseInt(body.id, 10);
  const decision = String(body.decision || '');
  if (!id) return { ok: false, status: 400, error: 'Which one?' };
  if (!['approved', 'rejected'].includes(decision)) {
    return { ok: false, status: 400, error: 'Approve it or reject it.' };
  }
  const type = kind === 'leave' ? 'leave_decision' : 'lesson_note_decision';
  await store.enqueueChange(school_id, {
    type,
    payload: {
      id, decision,
      notes: String(body.notes || '').slice(0, 500),
      // The desktop re-checks this account's live permissions before it
      // applies anything; the id travels so it knows whose decision it was.
      decided_by_user_id: rec.user_id,
      decided_at: new Date().toISOString(),
    },
  });
  return { ok: true, queued: true };
}

module.exports = {
  OFFICE_WRITE_TYPES, can,
  financeOverview, financeDebtors, adminOverview, approvals, submitDecision,
};
