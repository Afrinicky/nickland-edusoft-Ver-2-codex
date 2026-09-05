// Nickland Edusoft — Bill frameworks.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A FRAMEWORK is a ready-made bill: the particulars a school actually prints,
// in the order it prints them, with its own figures already filled in. It is
// the same idea as a competency framework in an assessment system — a
// published structure somebody else has already argued about, that you adopt
// and adjust rather than derive from nothing.
//
// Why this exists: writing a term's bill from a blank table is the step
// schools stall on, and stalling means bills go out in week three. A school
// that recognises its own bill in the list — "PART A / PART B, tuition,
// examination, sanitation, textbooks" — is three clicks from raising it.
//
// A framework is NOT a template. The template is what gets saved and what the
// bill is generated from; a framework is only the starting shape it is filled
// in from, so amending a framework never changes a bill already issued.
//
// Frameworks carry PARTS because Ghanaian bills are printed in parts: Part A
// is the school fee proper and totals on its own, Part B is textbooks, which
// a parent may settle separately and which carry into the next term as
// arrears. Flattening them into one list loses the subtotal a parent checks.

const BILL_TYPES = { SCHOOL_FEES: 'school_fees', SUPPLEMENTARY: 'supplementary' };

// Part kinds map onto how the money is actually held:
//   fees  — the term's school fee, billed on the term bill
//   books — charged once for the academic year, carried into T2/T3 as arrears
const PART_KINDS = { FEES: 'fees', BOOKS: 'books' };

const FRAMEWORKS = [
  // ── The bill Ave Maria Preparatory School prints ────────────────────────
  // Reproduced from the school's own termly bill so the office recognises it
  // on sight. Amounts are the Basic 4–6 first-term figures and are meant to be
  // edited: they are a starting point a bursar corrects in seconds, not a
  // price list this software is asserting.
  {
    id: 'ave-maria-termly',
    name: 'Ave Maria termly bill',
    origin: 'Ave Maria Preparatory School, Acherensua',
    description:
      'Part A is the term’s school fee and totals on its own; Part B is textbooks, '
      + 'charged once for the year. The figures shown are the Basic 4–6 first-term '
      + 'ones — change them to yours before you raise anything.',
    bill_type: BILL_TYPES.SCHOOL_FEES,
    parts: [
      {
        label: 'Part A — School fees',
        kind: PART_KINDS.FEES,
        items: [
          { description: 'Tuition Fee', amount: 250 },
          { description: 'Examination Fee', amount: 40 },
          { description: 'Sanitation Fee', amount: 20 },
          { description: 'Stationery', amount: 20 },
          { description: 'Security', amount: 10 },
          { description: 'Furniture', amount: 25 },
          { description: 'Utility Fee', amount: 10 },
          { description: 'Maintenance', amount: 10 },
          { description: 'Sports Fee', amount: 10 },
          { description: 'PTA Dues', amount: 0 },
          { description: 'First Aid', amount: 5 },
          { description: 'Catholic Education Week Celebration', amount: 0 },
        ],
      },
      {
        label: 'Part B — Textbooks',
        kind: PART_KINDS.BOOKS,
        items: [
          { description: 'Textbooks', amount: 440 },
        ],
      },
    ],
    notes: [
      'At least a part payment of the school fees is due on the reopening day.',
      'Textbooks are to be bought two weeks before reopening, or on reopening day.',
    ],
  },

  // ── A plain preparatory-school bill ─────────────────────────────────────
  // The line items nearly every Ghanaian private basic school bills, with no
  // amounts. A wrong default figure is worse than a blank one: a blank is
  // obviously unfinished, a wrong figure gets raised against three hundred
  // parents.
  {
    id: 'basic-preparatory',
    name: 'Preparatory school — standard particulars',
    description:
      'The particulars a Ghanaian private basic school ordinarily bills, with the '
      + 'amounts left blank for you to fill in.',
    bill_type: BILL_TYPES.SCHOOL_FEES,
    parts: [
      {
        label: 'Part A — School fees',
        kind: PART_KINDS.FEES,
        items: [
          { description: 'Tuition Fee', amount: 0 },
          { description: 'Examination Fee', amount: 0 },
          { description: 'PTA Dues', amount: 0 },
          { description: 'Sanitation Fee', amount: 0 },
          { description: 'Stationery', amount: 0 },
          { description: 'ICT / Computer Lab', amount: 0 },
          { description: 'Library Fee', amount: 0 },
          { description: 'First Aid / Health', amount: 0 },
          { description: 'Sports & Culture', amount: 0 },
          { description: 'Security', amount: 0 },
          { description: 'Utility Fee', amount: 0 },
          { description: 'Maintenance / Development Levy', amount: 0 },
        ],
      },
      {
        label: 'Part B — Textbooks',
        kind: PART_KINDS.BOOKS,
        items: [{ description: 'Textbooks', amount: 0 }],
      },
    ],
  },

  // ── Term 1, which carries the start-of-year charges ─────────────────────
  {
    id: 'first-term-with-admission',
    name: 'First term — with start-of-year charges',
    description:
      'The first term of an academic year carries what the other two do not: '
      + 'admission for new pupils, furniture, uniform and the year’s exercise books.',
    bill_type: BILL_TYPES.SCHOOL_FEES,
    parts: [
      {
        label: 'Part A — School fees',
        kind: PART_KINDS.FEES,
        items: [
          { description: 'Tuition Fee', amount: 0 },
          { description: 'Examination Fee', amount: 0 },
          { description: 'PTA Dues', amount: 0 },
          { description: 'Sanitation Fee', amount: 0 },
          { description: 'Security', amount: 0 },
          { description: 'Utility Fee', amount: 0 },
          { description: 'Maintenance / Development Levy', amount: 0 },
          { description: 'Admission Fee (new pupils)', amount: 0 },
          { description: 'Furniture Levy', amount: 0 },
          { description: 'School Uniform', amount: 0 },
          { description: 'ID Card', amount: 0 },
        ],
      },
      {
        label: 'Part B — Textbooks and exercise books',
        kind: PART_KINDS.BOOKS,
        items: [
          { description: 'Textbooks', amount: 0 },
          { description: 'Exercise Books', amount: 0 },
        ],
      },
    ],
  },

  // ── A JHS bill, which carries BECE costs ────────────────────────────────
  {
    id: 'jhs-termly',
    name: 'Junior High School — termly bill',
    description:
      'A JHS bill, including the mock examinations and BECE registration that '
      + 'a final-year class is charged.',
    bill_type: BILL_TYPES.SCHOOL_FEES,
    parts: [
      {
        label: 'Part A — School fees',
        kind: PART_KINDS.FEES,
        items: [
          { description: 'Tuition Fee', amount: 0 },
          { description: 'Examination Fee', amount: 0 },
          { description: 'PTA Dues', amount: 0 },
          { description: 'Sanitation Fee', amount: 0 },
          { description: 'ICT / Computer Lab', amount: 0 },
          { description: 'Science Practical / Laboratory', amount: 0 },
          { description: 'Library Fee', amount: 0 },
          { description: 'Sports & Culture', amount: 0 },
          { description: 'Security', amount: 0 },
          { description: 'Maintenance / Development Levy', amount: 0 },
          { description: 'Mock Examination', amount: 0 },
          { description: 'BECE Registration', amount: 0 },
        ],
      },
      {
        label: 'Part B — Textbooks',
        kind: PART_KINDS.BOOKS,
        items: [{ description: 'Textbooks', amount: 0 }],
      },
    ],
  },

  // ── In-term extras ──────────────────────────────────────────────────────
  // Not a school-fees bill: these are raised on top of a bill that already
  // exists, one at a time, when the thing actually happens.
  {
    id: 'in-term-extras',
    name: 'In-term extras',
    description:
      'Charges that come up during a term and are added to bills already raised '
      + '— pick the one that happened rather than billing them all.',
    bill_type: BILL_TYPES.SUPPLEMENTARY,
    parts: [
      {
        label: 'Extra charges',
        kind: PART_KINDS.FEES,
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
    ],
  },
];

/** Every framework, or only those of one bill type. */
function listFrameworks(billType) {
  const rows = billType
    ? FRAMEWORKS.filter(f => f.bill_type === billType)
    : FRAMEWORKS.slice();
  return rows.map(f => ({
    ...f,
    // The totals a chooser needs to compare frameworks without opening each.
    fees_total: partTotal(f, PART_KINDS.FEES),
    books_total: partTotal(f, PART_KINDS.BOOKS),
    item_count: f.parts.reduce((n, p) => n + p.items.length, 0),
  }));
}

function getFramework(id) {
  return listFrameworks().find(f => f.id === id) || null;
}

function partTotal(framework, kind) {
  return round2(framework.parts
    .filter(p => p.kind === kind)
    .reduce((sum, p) => sum + p.items.reduce((s, i) => s + (Number(i.amount) || 0), 0), 0));
}

/** A framework flattened into the line items a fee template is saved from.
 *
 *  Only the fee parts become template lines: the books part is charged for the
 *  academic year through the books module, not on the term bill, and copying
 *  it into the school-fees template would bill a parent for the same textbooks
 *  three times over. The books lines are handed back separately so the caller
 *  can seed the books charge from the same framework in one action. */
function toTemplateItems(framework) {
  const feeItems = [];
  let n = 0;
  for (const part of framework.parts) {
    if (part.kind !== PART_KINDS.FEES) continue;
    for (const item of part.items) {
      n += 1;
      feeItems.push({ item_number: n, description: item.description, amount: Number(item.amount) || 0 });
    }
  }
  const bookItems = [];
  for (const part of framework.parts) {
    if (part.kind !== PART_KINDS.BOOKS) continue;
    for (const item of part.items) {
      bookItems.push({ title: item.description, amount: Number(item.amount) || 0 });
    }
  }
  return { feeItems, bookItems };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

module.exports = {
  BILL_TYPES,
  PART_KINDS,
  FRAMEWORKS,
  listFrameworks,
  getFramework,
  toTemplateItems,
};
