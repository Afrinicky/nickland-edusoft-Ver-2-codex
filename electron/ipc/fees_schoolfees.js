// Nickland Edusoft — Raising the term's school fees.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// One action, because in a school it IS one action. "Raise the first term's
// bill" is a single decision an owner makes once a term, and splitting it into
// "write a template", "go to another tab", "generate bills", "notice half the
// classes were missed" is how bills go out in week three.
//
// ── The rule this file exists to enforce ────────────────────────────────────
//
// A term has ONE school fees bill. Not one per attempt, not one that quietly
// shadows another. When a school raises a second one, the first is REPLACED:
// the old schedule is retired, every affected pupil's bill is rebuilt from the
// new one, and their balance moves up or down by the difference.
//
// What must never move is money already received. Payments are not attached to
// a schedule, they are attached to the pupil and the term, so a replacement
// re-derives `total_paid` from the payments table rather than resetting it.
// A parent who paid GHS 300 against an 800-cedi bill owes 200 after the bill
// is corrected to 500 — they do not owe 500 again.
//
// ── Where the lines come from ───────────────────────────────────────────────
//
// Three ways in, because schools arrive from three different places:
//   • scratch    — type it, which is what a school with an unusual bill does
//   • framework  — adopt a published shape (see _frameworks.js) and adjust
//   • previous   — last term's bill, optionally uplifted by a percentage,
//                  which is what most schools actually want most terms

const billing = require('./_billing');
const frameworks = require('./_frameworks');
const security = require('./_security');

const SCHOOL_FEES = billing.BILL_TYPES.SCHOOL_FEES;

module.exports = function registerSchoolFeesHandlers(ipcMain, db, fees) {

  // ── The frameworks a bill can be started from ────────────────────────────
  ipcMain.handle('fees:frameworks', (_e, billType) => frameworks.listFrameworks(billType || null));

  // ── What raising would do, before anything is written ────────────────────
  //
  // Answers the only two questions that matter before an owner commits: what
  // schedule is being replaced, and how many bills and how much money is
  // already sitting against it. A "Replace" button with no numbers behind it
  // is a button nobody in a school is willing to press.
  ipcMain.handle('fees:school-fees-plan', (_e, { termId, scope, classId, classIds } = {}) => {
    const term = billing.termWithYear(db, termId)
      || billing.termWithYear(db, (db.prepare('SELECT id FROM terms WHERE is_current = 1').get() || {}).id);
    if (!term) return { ok: false, error: 'No term is running, so there is nothing to bill for.' };

    const targets = resolveClasses(db, { scope, classId, classIds });
    const students = studentsForClasses(db, targets.classIds, targets.wholeSchool);

    // Every school-fees schedule that would be superseded by raising this one.
    const existing = existingSchedules(db, term.id, targets);

    const billsRaised = db.prepare(`
      SELECT COUNT(*) AS n,
             COALESCE(SUM(total_billed), 0) AS billed,
             COALESCE(SUM(total_paid), 0)  AS paid
      FROM student_bills
      WHERE term_id = ? AND COALESCE(status, 'active') = 'active'
    `).get(term.id);

    return {
      ok: true,
      term: { id: term.id, label: term.label, year_label: term.year_label, full_label: billing.termLabel(term) },
      scope: targets.wholeSchool ? 'school' : 'classes',
      class_names: targets.classNames,
      student_count: students.length,
      existing_schedules: existing,
      // The prompt the UI needs: raising again replaces what is there.
      replaces: existing.length > 0,
      bills_already_raised: billsRaised.n,
      already_billed: billing.round2(billsRaised.billed),
      already_paid: billing.round2(billsRaised.paid),
    };
  });

  // ── Raise it ─────────────────────────────────────────────────────────────
  ipcMain.handle('fees:raise-school-fees', (_e, payload = {}) => {
    const denied = requireElevated(db, 'raise the term\'s school fees');
    if (denied) return denied;
    return raiseSchoolFees(db, fees, payload);
  });

  // ── A bill summary per kind, for the Bills home ──────────────────────────
  ipcMain.handle('fees:bills-summary', (_e, termId) => billsSummary(db, termId));
};

// ══ The work ════════════════════════════════════════════════════════════════

function requireElevated(db, action) {
  const userId = security.getCurrentUserId();
  if (security.isElevated(db, userId)) return null;
  try {
    db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
      VALUES ('fee_template', NULL, 'permission_denied', ?, ?, 'high')
    `).run(userId, `Denied ${action}: only the Proprietor or the Super Admin may do this.`);
  } catch (_) { /* auditing must not block the denial */ }
  return {
    ok: false,
    code: 'NOT_ELEVATED',
    error: 'Only the Proprietor or the Super Admin can raise or replace a term\'s school fees. '
         + 'It changes what every family in the school is asked to pay.',
  };
}

/** Which classes a raise covers, and whether that is the whole school. */
function resolveClasses(db, { scope, classId, classIds } = {}) {
  const all = db.prepare(
    'SELECT id, name FROM class_groups WHERE is_active = 1 ORDER BY level_order, name'
  ).all();

  let ids = [];
  if (scope === 'class' && classId) ids = [Number(classId)];
  else if (scope === 'classes' && Array.isArray(classIds)) ids = classIds.map(Number).filter(Boolean);
  else if (Array.isArray(classIds) && classIds.length) ids = classIds.map(Number).filter(Boolean);

  // Naming every class one by one is the same instruction as "the whole
  // school", and it should produce the same single standing schedule rather
  // than fifteen identical class-specific ones nobody can maintain.
  const wholeSchool = ids.length === 0 || ids.length >= all.length;

  const chosen = wholeSchool ? all : all.filter(c => ids.includes(c.id));
  return {
    wholeSchool,
    classIds: chosen.map(c => c.id),
    classNames: wholeSchool ? ['Every class'] : chosen.map(c => c.name),
  };
}

function studentsForClasses(db, classIds, wholeSchool) {
  if (wholeSchool) {
    return db.prepare(
      "SELECT id, current_class_id FROM students WHERE status = 'Active' ORDER BY surname, first_name"
    ).all();
  }
  if (!classIds.length) return [];
  const marks = classIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT id, current_class_id FROM students
    WHERE status = 'Active' AND current_class_id IN (${marks})
    ORDER BY surname, first_name
  `).all(...classIds);
}

/** Active school-fees schedules a raise over this scope would supersede. */
function existingSchedules(db, termId, targets) {
  const rows = db.prepare(`
    SELECT ft.id, ft.name, ft.class_group_id, ft.term_id,
           c.name AS class_name, t.label AS term_label, y.label AS year_label,
           (SELECT COALESCE(SUM(amount), 0) FROM fee_line_items li WHERE li.fee_template_id = ft.id) AS total_amount,
           (SELECT COUNT(*) FROM fee_line_items li WHERE li.fee_template_id = ft.id) AS item_count,
           (SELECT COUNT(*) FROM student_bills b WHERE b.template_id = ft.id) AS bill_count
    FROM fee_templates ft
    LEFT JOIN class_groups c ON c.id = ft.class_group_id
    LEFT JOIN terms t ON t.id = ft.term_id
    LEFT JOIN academic_years y ON y.id = t.academic_year_id
    WHERE ft.is_active = 1
      AND COALESCE(ft.bill_type, 'school_fees') = 'school_fees'
      AND (ft.term_id = ? OR ft.term_id IS NULL)
  `).all(termId);

  // A standing "all terms / all classes" default is superseded by anything
  // written for this term; a schedule for a class outside the scope is not.
  return rows.filter(r =>
    targets.wholeSchool
    || r.class_group_id === null
    || targets.classIds.includes(r.class_group_id));
}

/** The lines a raise will bill, from whichever source the school chose. */
function resolveItems(db, payload) {
  const explicit = (payload.items || [])
    .filter(i => String(i.description || '').trim())
    .map((i, n) => ({
      item_number: Number(i.item_number) || (n + 1),
      description: String(i.description).trim(),
      amount: billing.round2(i.amount),
    }));
  if (explicit.length) return { items: explicit, bookItems: payload.bookItems || [] };

  if (payload.source === 'framework' && payload.frameworkId) {
    const fw = frameworks.getFramework(payload.frameworkId);
    if (!fw) return { error: 'That framework no longer exists.' };
    const { feeItems, bookItems } = frameworks.toTemplateItems(fw);
    return { items: feeItems, bookItems };
  }

  if (payload.source === 'previous' && payload.sourceTemplateId) {
    const factor = 1 + ((Number(payload.adjustPercent) || 0) / 100);
    const items = billing.templateItems(db, Number(payload.sourceTemplateId))
      .map((it, n) => ({
        item_number: it.item_number || (n + 1),
        description: it.description,
        amount: billing.round2((it.amount || 0) * factor),
      }));
    if (!items.length) return { error: 'The bill being copied has no line items.' };
    return { items, bookItems: [] };
  }

  return { error: 'A bill needs at least one line. Add one, pick a framework, or copy a previous term.' };
}

function raiseSchoolFees(db, fees, payload) {
  const term = billing.termWithYear(db, payload.termId)
    || billing.termWithYear(db, (db.prepare('SELECT id FROM terms WHERE is_current = 1').get() || {}).id);
  if (!term) return { ok: false, error: 'No term is running, so there is nothing to bill for.' };

  const targets = resolveClasses(db, payload);
  const students = studentsForClasses(db, targets.classIds, targets.wholeSchool);
  if (!students.length) return { ok: false, error: 'There is nobody active to bill in that scope.' };

  const resolved = resolveItems(db, payload);
  if (resolved.error) return { ok: false, error: resolved.error };
  const items = resolved.items;

  const superseded = existingSchedules(db, term.id, targets);
  if (superseded.length && !payload.confirmReplace) {
    return {
      ok: false,
      code: 'REPLACE_REQUIRED',
      error: `A school fees bill already exists for ${billing.termLabel(term)}. `
           + 'A term can only have one. Raising this replaces it — balances are '
           + 'recalculated and money already received is kept.',
      existing: superseded,
      student_count: students.length,
    };
  }

  const name = String(payload.name || '').trim()
    || `${term.label} school fees — ${term.year_label || ''}`.trim();

  const created = [];
  const tx = db.transaction(() => {
    // Retire what is being replaced rather than deleting it. A schedule that
    // has already produced bills is a record of what parents were told, and
    // deleting it would orphan every bill row that points at it.
    for (const old of superseded) {
      db.prepare('UPDATE fee_templates SET is_active = 0 WHERE id = ?').run(old.id);
      audit(db, 'fee_template', old.id, 'superseded',
        `Replaced by a new ${billing.termLabel(term)} school fees bill.`);
    }

    const scopes = targets.wholeSchool
      ? [{ classGroupId: null, label: 'Every class' }]
      : targets.classIds.map((id, i) => ({ classGroupId: id, label: targets.classNames[i] }));

    for (const s of scopes) {
      const result = db.prepare(`
        INSERT INTO fee_templates (name, class_group_id, term_id, bill_type, is_active)
        VALUES (?, ?, ?, 'school_fees', 1)
      `).run(scopes.length > 1 ? `${name} — ${s.label}` : name, s.classGroupId, term.id);
      const templateId = result.lastInsertRowid;
      const ins = db.prepare(`
        INSERT INTO fee_line_items (fee_template_id, item_number, description, amount)
        VALUES (?, ?, ?, ?)
      `);
      for (const it of items) ins.run(templateId, it.item_number, it.description, it.amount);
      created.push({ id: templateId, class_group_id: s.classGroupId, class_name: s.label });
      audit(db, 'fee_template', templateId, 'raised',
        `${billing.termLabel(term)} school fees for ${s.label}: ${items.length} line(s), `
        + `GHS ${items.reduce((n, i) => n + i.amount, 0).toFixed(2)} a pupil.`);
    }
  });
  tx();

  // Bills are raised OUTSIDE the schedule transaction on purpose: one pupil
  // whose bill cannot be rebuilt (a withdrawn bill, say) must not roll back a
  // schedule the whole school is waiting on. Failures are counted and named.
  let generated = 0;
  const problems = new Map();
  for (const s of students) {
    try { fees.generateBillForStudent(db, s.id, term.id); generated += 1; }
    catch (e) {
      const msg = String((e && e.message) || e);
      problems.set(msg, (problems.get(msg) || 0) + 1);
    }
  }

  const perPupil = billing.round2(items.reduce((n, i) => n + i.amount, 0));
  return {
    ok: true,
    replaced: superseded.length,
    templates: created,
    term: { id: term.id, full_label: billing.termLabel(term) },
    per_pupil: perPupil,
    scope: targets.wholeSchool ? 'school' : 'classes',
    class_names: targets.classNames,
    generated,
    skipped: students.length - generated,
    problems: [...problems.entries()].map(([reason, count]) => ({ reason, count })),
    // Handed back so the caller can offer to seed the books charge from the
    // same framework — the Part B a Ghanaian bill prints under the fee total.
    book_items: resolved.bookItems || [],
  };
}

// ══ What the Bills home shows ═══════════════════════════════════════════════
//
// One row per kind of bill a school raises, so the first screen answers "what
// have we billed, and who has not paid" without opening five tabs. Each kind
// keeps its own books — fees on `student_bills`, books for the academic year,
// canteen by the day, transport by the term — so this is a union of four
// different shapes, deliberately normalised to the same five figures.

function billsSummary(db, termId) {
  const term = billing.termWithYear(db, termId)
    || billing.termWithYear(db, (db.prepare('SELECT id FROM terms WHERE is_current = 1').get() || {}).id);
  if (!term) return { ok: false, error: 'No current term is set.' };

  const kinds = [];

  // ── School fees ─────────────────────────────────────────────────────────
  const fees = db.prepare(`
    SELECT COUNT(*) AS raised,
           COALESCE(SUM(total_billed - COALESCE(supplementary_total, 0)), 0) AS billed,
           COALESCE(SUM(total_paid), 0) AS paid,
           COALESCE(SUM(balance), 0) AS outstanding,
           COUNT(*) FILTER (WHERE balance > 0) AS debtors
    FROM student_bills
    WHERE term_id = ? AND COALESCE(status, 'active') = 'active'
  `).get(term.id);
  const feesTemplate = db.prepare(`
    SELECT COUNT(*) AS n FROM fee_templates
    WHERE is_active = 1 AND COALESCE(bill_type, 'school_fees') = 'school_fees'
      AND (term_id = ? OR term_id IS NULL)
  `).get(term.id).n;
  kinds.push({
    key: 'school_fees', label: 'School fees', tab: 'schoolfees',
    raised: fees.raised, billed: billing.round2(fees.billed), paid: billing.round2(fees.paid),
    outstanding: billing.round2(fees.outstanding), debtors: fees.debtors,
    ready: feesTemplate > 0,
    note: feesTemplate > 0
      ? `${fees.raised} bill(s) raised for ${billing.termLabel(term)}`
      : 'No schedule written for this term yet',
  });

  // ── Books — charged for the academic year, not the term ─────────────────
  const books = term.academic_year_id ? db.prepare(`
    SELECT COUNT(*) AS raised,
           COALESCE(SUM(total_amount), 0) AS billed,
           COALESCE(SUM(total_paid), 0) AS paid,
           COALESCE(SUM(balance), 0) AS outstanding,
           COUNT(*) FILTER (WHERE balance > 0) AS debtors
    FROM student_books WHERE academic_year_id = ?
  `).get(term.academic_year_id) : { raised: 0, billed: 0, paid: 0, outstanding: 0, debtors: 0 };
  kinds.push({
    key: 'books', label: 'Books', tab: 'books',
    raised: books.raised, billed: billing.round2(books.billed), paid: billing.round2(books.paid),
    outstanding: billing.round2(books.outstanding), debtors: books.debtors,
    ready: books.raised > 0,
    note: books.raised > 0
      ? `Charged once for ${term.year_label || 'the year'}`
      : 'No books charged this academic year',
  });

  // ── Canteen — billed by the day off the canteen calendar ────────────────
  const canteen = safeRow(db, `
    SELECT
      (SELECT COUNT(*) FROM school_calendar
        WHERE term_id = ? AND day_type = 'school_day') AS days,
      (SELECT COALESCE(SUM(amount), 0) FROM canteen_payments cp
        WHERE cp.payment_date BETWEEN COALESCE(?, '0000-01-01') AND COALESCE(?, '9999-12-31')) AS paid,
      (SELECT COUNT(*) FROM canteen_day_status
        WHERE status = 'unpaid'
          AND date BETWEEN COALESCE(?, '0000-01-01') AND COALESCE(?, '9999-12-31')) AS unpaid_days
  `, [term.id, term.start_date, term.end_date, term.start_date, term.end_date]);
  const canteenRate = Number(getSettingValue(db, 'canteen_daily_rate', 0)) || 0;
  const canteenBilled = billing.round2((canteen.days || 0) * canteenRate
    * activeStudentCount(db));
  kinds.push({
    key: 'canteen', label: 'Canteen', tab: 'canteen',
    raised: canteen.days || 0,
    billed: canteenBilled,
    paid: billing.round2(canteen.paid || 0),
    outstanding: billing.round2(Math.max(0, canteenBilled - (canteen.paid || 0))),
    debtors: canteen.unpaid_days || 0,
    ready: (canteen.days || 0) > 0,
    note: (canteen.days || 0) > 0
      ? `${canteen.days} feeding day(s) on the term's calendar`
      : 'The term’s canteen calendar has not been laid out',
    unit: 'days',
  });

  // ── Transport — a termly fee against a route ────────────────────────────
  const transport = safeRow(db, `
    SELECT
      (SELECT COUNT(*) FROM student_transport WHERE COALESCE(is_active, 1) = 1) AS riders,
      (SELECT COALESCE(SUM(amount), 0) FROM transport_payments WHERE term_id = ?) AS paid
  `, [term.id]);
  const transportBilled = billing.round2(safeValue(db, `
    SELECT COALESCE(SUM(COALESCE(st.fee_override, r.fee_per_term)), 0) AS t
    FROM student_transport st
    JOIN transport_routes r ON r.id = st.route_id
    WHERE COALESCE(st.is_active, 1) = 1`, []));
  kinds.push({
    key: 'transport', label: 'Transport', tab: 'transport',
    raised: transport.riders || 0,
    billed: transportBilled,
    paid: billing.round2(transport.paid || 0),
    outstanding: billing.round2(Math.max(0, transportBilled - (transport.paid || 0))),
    debtors: 0,
    ready: (transport.riders || 0) > 0,
    note: (transport.riders || 0) > 0
      ? `${transport.riders} pupil(s) ride this term`
      : 'Nobody is assigned to a route',
    unit: 'riders',
  });

  // ── Extra charges raised on top of term bills ───────────────────────────
  const extras = db.prepare(`
    SELECT COALESCE(SUM(supplementary_total), 0) AS billed,
           COUNT(*) FILTER (WHERE COALESCE(supplementary_total, 0) > 0) AS raised
    FROM student_bills
    WHERE term_id = ? AND COALESCE(status, 'active') = 'active'
  `).get(term.id);
  kinds.push({
    key: 'extras', label: 'Extra charges', tab: 'extras',
    raised: extras.raised, billed: billing.round2(extras.billed),
    // Extras are settled on the same term bill, so they have no separate
    // collection figure — saying "GHS 0 collected" would be a lie, not a zero.
    paid: null, outstanding: null, debtors: null,
    ready: extras.raised > 0,
    note: extras.raised > 0
      ? `On ${extras.raised} of this term's bills`
      : 'Nothing raised on top of the term bill',
  });

  // ── Withdrawn ───────────────────────────────────────────────────────────
  const voided = db.prepare(`
    SELECT COUNT(*) AS raised, COALESCE(SUM(total_billed), 0) AS billed,
           COALESCE(SUM(total_paid), 0) AS paid
    FROM student_bills WHERE term_id = ? AND COALESCE(status, 'active') = 'voided'
  `).get(term.id);

  // ── Who owes, merged in from what used to be its own tab ────────────────
  const debtors = db.prepare(`
    SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names,
           c.name AS class_name, c.short_code AS class_code,
           b.total_billed, b.total_paid, b.balance, b.generated_at,
           s.father_contact, s.mother_contact, s.guardian_contact,
           CAST(julianday('now') - julianday(COALESCE(b.generated_at, 'now')) AS INTEGER) AS days_outstanding
    FROM student_bills b
    JOIN students s ON s.id = b.student_id
    LEFT JOIN class_groups c ON c.id = s.current_class_id
    WHERE b.term_id = ? AND b.balance > 0 AND s.status = 'Active'
      AND COALESCE(b.status, 'active') = 'active'
    ORDER BY b.balance DESC
  `).all(term.id);

  const byClass = db.prepare(`
    SELECT c.id, c.name, c.short_code,
           COUNT(b.id) AS bills,
           COALESCE(SUM(b.total_billed), 0) AS billed,
           COALESCE(SUM(b.total_paid), 0) AS paid,
           COALESCE(SUM(b.balance), 0) AS outstanding,
           COUNT(*) FILTER (WHERE b.balance > 0) AS debtors
    FROM class_groups c
    LEFT JOIN students s ON s.current_class_id = c.id AND s.status = 'Active'
    LEFT JOIN student_bills b ON b.student_id = s.id AND b.term_id = ?
                             AND COALESCE(b.status, 'active') = 'active'
    WHERE c.is_active = 1
    GROUP BY c.id ORDER BY c.level_order, c.name
  `).all(term.id);

  return {
    ok: true,
    term: {
      id: term.id, label: term.label, year_label: term.year_label,
      full_label: billing.termLabel(term),
    },
    kinds,
    voided: { count: voided.raised, billed: billing.round2(voided.billed), paid: billing.round2(voided.paid) },
    debtors,
    debtor_total: billing.round2(debtors.reduce((n, d) => n + (d.balance || 0), 0)),
    by_class: byClass.map(c => ({
      ...c,
      billed: billing.round2(c.billed), paid: billing.round2(c.paid),
      outstanding: billing.round2(c.outstanding),
      rate: c.billed > 0 ? Math.round((c.paid / c.billed) * 100) : 0,
    })),
  };
}

function activeStudentCount(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM students WHERE status = 'Active'").get().n;
}

function getSettingValue(db, key, fallback) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  } catch (_) { return fallback; }
}

// A module a school has not switched on has no tables. Asking for its figures
// is a legitimate question with the answer "nothing", not an error that should
// take the whole Bills screen down.
function safeRow(db, sql, params) {
  try { return db.prepare(sql).get(...params) || {}; }
  catch (_) { return {}; }
}
function safeValue(db, sql, params) {
  try { const r = db.prepare(sql).get(...params); return r ? r.t : 0; }
  catch (_) { return 0; }
}

function audit(db, entity, id, action, justification) {
  try {
    db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
      VALUES (?, ?, ?, ?, ?, 'high')
    `).run(entity, id, action, security.getCurrentUserId(), justification);
  } catch (_) { /* best effort */ }
}

module.exports.raiseSchoolFees = raiseSchoolFees;
module.exports.billsSummary = billsSummary;
module.exports.resolveClasses = resolveClasses;
module.exports.studentsForClasses = studentsForClasses;
module.exports.existingSchedules = existingSchedules;
module.exports.resolveItems = resolveItems;
