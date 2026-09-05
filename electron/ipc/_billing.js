// Nickland Edusoft — Billing core.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// One place for the rules that decide what a pupil owes, so the bill the
// parent is handed, the Fees dashboard's "expected income", and the debtors
// report can never disagree with each other. Before this module they each
// resolved templates differently and the dashboard read a table the template
// editor never wrote to, which is why a school could bill GHS 3,806 and still
// see "Expected Income GHS 0.00".
//
// The domain model follows how Ghanaian private schools actually bill:
//
//   • SCHOOL FEES — exactly one bill per pupil per term. Tuition plus the
//     standing levies (PTA, exams, ICT, first aid…). A second school-fees
//     bill in the same term is not a thing; the term bill gets revised.
//   • SUPPLEMENTARY — an extra that comes up during the term (excursion,
//     sports week, BECE registration, speech day). Raised on top of the
//     pupil's existing term bill as additional line items, so there is still
//     one balance per pupil per term.
//   • BOOKS — charged once at the start of the academic year and carried into
//     Terms 2 and 3 as arrears. Handled by the books module.

const BILL_TYPES = {
  SCHOOL_FEES: 'school_fees',
  SUPPLEMENTARY: 'supplementary',
};

const CHARGE_TYPES = {
  FEES: 'fees',        // from the term's school-fees template — rebuilt on regeneration
  ARREAR: 'arrear',    // carried-forward balance — rebuilt on regeneration
  EXTRA: 'extra',      // supplementary charge — PRESERVED across regeneration
};

// Starter catalogue so a new template is never a blank page. These are the
// line items Ghanaian private (and mission) schools actually put on a termly
// bill; the school edits the amounts, which are left at 0 deliberately —
// a wrong default amount is worse than no amount.
const FEE_ITEM_PRESETS = [
  {
    group: 'Core termly fees',
    bill_type: BILL_TYPES.SCHOOL_FEES,
    items: [
      { description: 'Tuition Fee', amount: 0 },
      { description: 'PTA Dues', amount: 0 },
      { description: 'Examination Fee', amount: 0 },
      { description: 'Report Card / Stationery', amount: 0 },
      { description: 'ICT / Computer Lab', amount: 0 },
      { description: 'Library Fee', amount: 0 },
      { description: 'First Aid / Health', amount: 0 },
      { description: 'Sports & Culture', amount: 0 },
      { description: 'Maintenance / Development Levy', amount: 0 },
    ],
  },
  {
    group: 'Services (bill only the pupils who use them)',
    bill_type: BILL_TYPES.SCHOOL_FEES,
    items: [
      { description: 'Feeding / Canteen', amount: 0, is_optional: 1 },
      { description: 'Transport / Bus', amount: 0, is_optional: 1 },
      { description: 'Extra Classes', amount: 0, is_optional: 1 },
      { description: 'Boarding / After-school Care', amount: 0, is_optional: 1 },
    ],
  },
  {
    group: 'Start-of-year charges (Term 1)',
    bill_type: BILL_TYPES.SCHOOL_FEES,
    items: [
      { description: 'Admission Fee (new pupils)', amount: 0, is_optional: 1 },
      { description: 'Furniture Levy', amount: 0, is_optional: 1 },
      { description: 'School Uniform', amount: 0, is_optional: 1 },
      { description: 'Exercise Books', amount: 0, is_optional: 1 },
      { description: 'ID Card', amount: 0, is_optional: 1 },
    ],
  },
  {
    group: 'In-term extras (supplementary bills)',
    bill_type: BILL_TYPES.SUPPLEMENTARY,
    items: [
      { description: 'Excursion / Educational Trip', amount: 0 },
      { description: 'Sports Week / Inter-house', amount: 0 },
      { description: 'Speech & Prize-giving Day', amount: 0 },
      { description: 'Cultural / Our Day Celebration', amount: 0 },
      { description: 'Mock Examination', amount: 0 },
      { description: 'BECE Registration', amount: 0 },
      { description: 'Vacation Classes', amount: 0 },
      { description: 'Graduation Levy', amount: 0 },
    ],
  },
];

// ── Template resolution ────────────────────────────────────────────────
// The ONE resolution order, used by bill generation and by every projection
// that has to answer "what would this pupil be billed?". Most specific first:
//   class + term  →  class (any term)  →  term (all classes)  →  global
// Only school-fees templates are ever auto-applied; supplementary templates
// are applied deliberately, by a person, to a chosen set of pupils.
function resolveFeeTemplate(db, classGroupId, termId) {
  const pick = (sql, ...params) => db.prepare(sql).get(...params) || null;
  const base = `SELECT * FROM fee_templates
                 WHERE is_active = 1 AND COALESCE(bill_type, 'school_fees') = 'school_fees'`;

  return (
    pick(`${base} AND class_group_id = ? AND term_id = ? ORDER BY id DESC LIMIT 1`, classGroupId, termId) ||
    pick(`${base} AND class_group_id = ? AND term_id IS NULL ORDER BY id DESC LIMIT 1`, classGroupId) ||
    pick(`${base} AND class_group_id IS NULL AND term_id = ? ORDER BY id DESC LIMIT 1`, termId) ||
    pick(`${base} AND class_group_id IS NULL AND term_id IS NULL ORDER BY id DESC LIMIT 1`)
  );
}

// ── Naming a term so a human can tell two of them apart ────────────────
// Every academic year has a "First Term". A schedule saved against 2026/2027's
// First Term while the school is running 2025/2026's Third Term looks, in a
// bare dropdown, exactly like the right one — and then bill generation fails
// with "no template applies" and nobody can see why. Every term shown to a
// user carries its academic year.
function termLabel(term) {
  if (!term) return '';
  // Accepts a terms row (`label`) or a row that joined one in (`term_label`),
  // so the same helper names a term wherever it is carried.
  const label = term.label || term.term_label || '';
  if (!label) return '';
  const year = term.year_label || term.academic_year_label || '';
  return year ? `${label} · ${year}` : label;
}

// Reads the term with its academic year attached, for messages and pickers.
function termWithYear(db, termId) {
  if (!termId) return null;
  return db.prepare(`
    SELECT t.*, y.label AS year_label
    FROM terms t LEFT JOIN academic_years y ON y.id = t.academic_year_id
    WHERE t.id = ?
  `).get(termId) || null;
}

// The message a school can act on when nothing covers a pupil. It names the
// term in full and reads back the school-fees schedules that DO exist, because
// the answer is nearly always "you wrote it against the wrong term".
function noTemplateMessage(db, student, termId) {
  const term = termWithYear(db, termId);
  const klass = student && student.current_class_id
    ? db.prepare('SELECT name FROM class_groups WHERE id = ?').get(student.current_class_id)
    : null;
  const where = klass ? `${klass.name} in ${termLabel(term)}` : termLabel(term);

  const others = db.prepare(`
    SELECT ft.name, c.name AS class_name, t.label AS term_label, y.label AS year_label
    FROM fee_templates ft
    LEFT JOIN class_groups c ON c.id = ft.class_group_id
    LEFT JOIN terms t ON t.id = ft.term_id
    LEFT JOIN academic_years y ON y.id = t.academic_year_id
    WHERE ft.is_active = 1 AND COALESCE(ft.bill_type, 'school_fees') = 'school_fees'
    ORDER BY ft.id DESC LIMIT 4
  `).all();

  let msg = `No school fees schedule covers ${where}.`;
  if (others.length) {
    const list = others
      .map(o => `“${o.name}” (${o.class_name || 'all classes'}, ${o.term_label ? termLabel(o) : 'all terms'})`)
      .join('; ');
    msg += ` The schedules you have are: ${list}.`
         + ` Check the term each one is written against — every academic year has a term by the same name.`;
  } else {
    msg += ' Create one under Fees → Bills → School Fees.';
  }
  return msg;
}

function templateItems(db, templateId) {
  return db.prepare(
    'SELECT * FROM fee_line_items WHERE fee_template_id = ? ORDER BY item_number, id'
  ).all(templateId);
}

function templateTotal(db, templateId) {
  const row = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS t FROM fee_line_items WHERE fee_template_id = ?'
  ).get(templateId);
  return round2(row ? row.t : 0);
}

// ── Money ──────────────────────────────────────────────────────────────
// Ghana still transacts in pesewas, so every stored figure is rounded to two
// decimals at the point it is computed. Rounding only at display time let
// fractions of a pesewa accumulate into balances that never reached zero.
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// ── Duplicate school-fees detection ────────────────────────────────────
// "There can't be two school fees in the same term." Returns the template
// that already covers this (class, term) so the UI can prompt rather than
// silently create a second one that shadows the first.
function findConflictingSchoolFeesTemplate(db, { id, classGroupId, termId }) {
  if (!termId) return null; // an "all terms" template is a standing default, not a clash
  const rows = db.prepare(`
    SELECT ft.*, cg.name AS class_name, t.label AS term_label, y.label AS year_label
    FROM fee_templates ft
    LEFT JOIN class_groups cg ON cg.id = ft.class_group_id
    LEFT JOIN terms t ON t.id = ft.term_id
    LEFT JOIN academic_years y ON y.id = t.academic_year_id
    WHERE ft.is_active = 1
      AND COALESCE(ft.bill_type, 'school_fees') = 'school_fees'
      AND ft.term_id = ?
      AND ft.class_group_id IS ?
  `).all(termId, classGroupId || null);
  return rows.find(r => r.id !== id) || null;
}

// ── Bill totals ────────────────────────────────────────────────────────
// Recomputes a bill's stored money columns from its line items and from the
// payments table, which is the source of truth for what was received. Called
// after anything that changes a bill's composition.
function recomputeBillTotals(db, billId) {
  const bill = db.prepare('SELECT * FROM student_bills WHERE id = ?').get(billId);
  if (!bill) return null;

  const sums = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN charge_type = 'arrear' THEN amount ELSE 0 END), 0) AS arrears,
      COALESCE(SUM(CASE WHEN charge_type = 'extra'  THEN amount ELSE 0 END), 0) AS extra,
      COALESCE(SUM(CASE WHEN charge_type NOT IN ('arrear', 'extra') THEN amount ELSE 0 END), 0) AS fees
    FROM bill_line_items WHERE student_bill_id = ?
  `).get(billId);

  const paid = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS t FROM payments
    WHERE student_id = ? AND term_id = ? AND COALESCE(is_reversed, 0) = 0
  `).get(bill.student_id, bill.term_id).t || 0;

  const gross = round2(sums.fees + sums.arrears + sums.extra);
  // The discount was agreed against the fee schedule, so it stays capped at
  // the gross rather than being re-derived — re-deriving a percentage after a
  // supplementary charge would quietly widen a discount nobody re-approved.
  const discount = Math.min(round2(bill.discount_amount || 0), gross);
  const totalBilled = round2(Math.max(0, gross - discount) + round2(bill.books_arrears || 0));
  const totalPaid = round2(paid);

  db.prepare(`
    UPDATE student_bills
       SET total_billed = ?, total_paid = ?, balance = ?,
           arrears_from_prev = ?, supplementary_total = ?
     WHERE id = ?
  `).run(totalBilled, totalPaid, round2(totalBilled - totalPaid),
    round2(sums.arrears), round2(sums.extra), billId);

  return { totalBilled, totalPaid, balance: round2(totalBilled - totalPaid), extra: round2(sums.extra) };
}

// ── Projected income ───────────────────────────────────────────────────
// "If all bills are paid" — the figure the Fees dashboard shows. Bills that
// exist are authoritative (they include arrears, discounts and any
// supplementary charges); active pupils with no bill yet are projected from
// the same template bill generation would use, so generating the missing
// bills does not move the number.
function projectedIncomeForTerm(db, termId) {
  const billed = db.prepare(`
    SELECT COALESCE(SUM(total_billed), 0) AS total, COUNT(*) AS count
    FROM student_bills
    WHERE term_id = ? AND COALESCE(status, 'active') = 'active'
  `).get(termId);

  const unbilled = db.prepare(`
    SELECT s.id, s.current_class_id
    FROM students s
    WHERE s.status = 'Active'
      AND NOT EXISTS (
        SELECT 1 FROM student_bills b
        WHERE b.student_id = s.id AND b.term_id = ?
          AND COALESCE(b.status, 'active') = 'active'
      )
  `).all(termId);

  const cache = new Map();
  let projected = 0;
  let projectedCount = 0;
  let unresolved = 0;
  for (const s of unbilled) {
    const key = String(s.current_class_id);
    if (!cache.has(key)) {
      const tpl = resolveFeeTemplate(db, s.current_class_id, termId);
      cache.set(key, tpl ? templateTotal(db, tpl.id) : null);
    }
    const amount = cache.get(key);
    if (amount === null) { unresolved++; continue; }
    projected += amount;
    projectedCount++;
  }

  return {
    total: round2(billed.total + projected),
    billed_total: round2(billed.total),
    billed_count: billed.count,
    projected_total: round2(projected),
    projected_count: projectedCount,
    // Pupils no template covers — they would fail bill generation, so surfacing
    // the count is the difference between "nobody owes anything" and
    // "nobody has been told what they owe".
    unresolved_count: unresolved,
  };
}

module.exports = {
  BILL_TYPES,
  CHARGE_TYPES,
  FEE_ITEM_PRESETS,
  resolveFeeTemplate,
  termLabel,
  termWithYear,
  noTemplateMessage,
  templateItems,
  templateTotal,
  findConflictingSchoolFeesTemplate,
  recomputeBillTotals,
  projectedIncomeForTerm,
  round2,
};
