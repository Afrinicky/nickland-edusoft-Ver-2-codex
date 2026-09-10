// Nickland Edusoft — Onboarding workbook contract.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The workbook a school fills in BEFORE it has a system. Everything the office
// already keeps in Excel — the roll, the staff list, the classes, the fee
// schedule, what each pupil still owes — copied into one file and imported in
// one act, so that onboarding is an afternoon rather than a term of typing.
//
// It is the twin of the finance workbook (`_workbook_schema.js`) and shares its
// coercion helpers deliberately: two dialects of "what is a date" is how a
// pupil ends up born a day early on one sheet and on time on the other. What it
// does NOT share is the finance workbook's semantics, and the difference is the
// whole design:
//
//                     Finance workbook          Onboarding workbook
//   Content           money that moved          the school's master data
//   Re-import         never twice               update in place
//   Cross-references  none                      by the school's own names
//   Sheet order       independent               strictly dependent
//
// ── Why upsert rather than never-twice ─────────────────────────────────
// A payment imported twice is money the school did not receive. But onboarding
// is iterative by nature: import four hundred pupils, notice that a column of
// birthdays came in as American dates, fix the sheet, import again. Under the
// finance workbook's append-only rule the second run would produce four hundred
// duplicate pupils. So every sheet here declares a NATURAL KEY — the identifier
// the school already uses, not one of ours — and a row whose key is already
// present updates that record instead of creating a second one.
//
// ── Why natural keys ───────────────────────────────────────────────────
// The school's spreadsheet has never heard of `class_groups.id`. It says
// "Basic 5". So every cross-sheet reference is written the way the office
// writes it, and resolving names to ids is the importer's job, not the
// bursar's. A name that resolves to nothing is a row-level error naming the
// sheet, the row and the missing value — never a silent NULL foreign key.
//
// ── Why the order lives here ───────────────────────────────────────────
// Classes must exist before a pupil can be put in one; terms before a fee
// schedule can be attached to one. A user is free to drag the tabs around in
// Excel, and some will. Import order is therefore read from SHEET_ORDER below
// and never from the file.

const wb = require('./_workbook_schema');

const SHEETS = {
  COVER:          'Start Here',
  PROFILE:        'School Profile',
  YEARS:          'Academic Years',
  TERMS:          'Terms',
  CLASSES:        'Classes',
  SUBJECTS:       'Subjects',
  CLASS_SUBJECTS: 'Class Subjects',
  GRADING:        'Grading Bands',
  STAFF:          'Staff',
  STUDENTS:       'Students',
  PARENTS:        'Parents',
  FEES:           'Fee Structure',
  BALANCES:       'Opening Balances',
  REFERENCE:      'Reference Data',
};

// The order the importer walks, and the only order that is correct. Each entry
// may only reference things defined at or above it.
const SHEET_ORDER = [
  SHEETS.PROFILE,
  SHEETS.YEARS,
  SHEETS.TERMS,
  SHEETS.CLASSES,
  SHEETS.SUBJECTS,
  SHEETS.CLASS_SUBJECTS,
  SHEETS.GRADING,
  SHEETS.STAFF,
  SHEETS.STUDENTS,
  SHEETS.PARENTS,
  SHEETS.FEES,
  SHEETS.BALANCES,
];

// Same head as the finance workbook — title, school, blank, sheet title, help,
// column headers — so a school that has seen one has seen both.
const HEADER_ROWS = wb.HEADER_ROWS;

// What an importer does with a row whose natural key already exists.
const ON_EXISTING = {
  UPDATE:  'update',   // the usual case: correct the record in place
  SKIP:    'skip',     // already right; touching it would undo later edits
  REPLACE: 'replace',  // the sheet IS the list — see Grading Bands
};

// ── The sheets ─────────────────────────────────────────────────────────
// `key` is the natural key: the columns that decide whether a row is a new
// record or a correction to one already imported. `required` is enforced before
// anything is written; `ref` names another sheet's key that this column must
// resolve against.
const IMPORT_SHEETS = {
  [SHEETS.PROFILE]: {
    target: 'settings',
    title: 'The school itself',
    help: 'The school\'s own details. Fill in the Value column; leave a row blank to keep whatever the system already has.',
    key: ['setting'],
    onExisting: ON_EXISTING.UPDATE,
    columns: [
      { key: 'setting', header: 'Detail', w: 26, required: true },
      { key: 'value',   header: 'Value',  w: 46 },
    ],
  },

  [SHEETS.YEARS]: {
    target: 'academic_year',
    title: 'Academic years',
    help: 'Every academic year the school is bringing across, oldest first. Put YES against the one running now.',
    key: ['label'],
    onExisting: ON_EXISTING.UPDATE,
    columns: [
      { key: 'label',      header: 'Academic Year', w: 18, required: true },
      { key: 'start_date', header: 'Starts',        w: 13, date: true },
      { key: 'end_date',   header: 'Ends',          w: 13, date: true },
      { key: 'is_current', header: 'Current? (YES/NO)', w: 18, bool: true },
    ],
  },

  [SHEETS.TERMS]: {
    target: 'term',
    title: 'Terms',
    help: 'Three terms per academic year, numbered 1, 2 and 3. Put YES against the term running now — only one.',
    key: ['year_label', 'term_number'],
    onExisting: ON_EXISTING.UPDATE,
    columns: [
      { key: 'year_label',  header: 'Academic Year', w: 18, required: true, ref: SHEETS.YEARS },
      { key: 'term_number', header: 'Term No',       w: 10, int: true, required: true },
      { key: 'label',       header: 'Term Name',     w: 18, required: true },
      { key: 'start_date',  header: 'Starts',        w: 13, date: true },
      { key: 'end_date',    header: 'Ends',          w: 13, date: true },
      { key: 'is_current',  header: 'Current? (YES/NO)', w: 18, bool: true },
    ],
  },

  [SHEETS.CLASSES]: {
    target: 'class',
    title: 'Classes',
    help: 'Every class in the school, in the order a child moves through them. Order decides promotion, so get it right: Creche 1, KG 1, Basic 1 … JHS 3.',
    key: ['name'],
    onExisting: ON_EXISTING.UPDATE,
    columns: [
      { key: 'name',           header: 'Class Name',   w: 20, required: true },
      { key: 'short_code',     header: 'Short Code',   w: 12 },
      { key: 'level_category', header: 'Level',        w: 14, required: true },
      { key: 'level_order',    header: 'Order',        w: 9,  int: true, required: true },
      { key: 'section',        header: 'Stream',       w: 12 },
      { key: 'capacity',       header: 'Capacity',     w: 11, int: true },
    ],
  },

  [SHEETS.SUBJECTS]: {
    target: 'subject',
    title: 'Subjects',
    help: 'Every subject taught. The two weightings must add to 100 — they decide how class work and the exam combine into a final mark.',
    key: ['name'],
    onExisting: ON_EXISTING.UPDATE,
    columns: [
      { key: 'name',             header: 'Subject',          w: 26, required: true },
      { key: 'code',             header: 'Code',             w: 10 },
      { key: 'class_weight_pct', header: 'Class Work %',     w: 14, num: true },
      { key: 'exam_weight_pct',  header: 'Exam %',           w: 11, num: true },
    ],
  },

  [SHEETS.CLASS_SUBJECTS]: {
    target: 'class_subject',
    title: 'What each class is taught',
    help: 'One row per class. List its subjects in the Subjects column separated by commas — they must be spelt as on the Subjects sheet.',
    key: ['class_name'],
    onExisting: ON_EXISTING.REPLACE,
    columns: [
      { key: 'class_name', header: 'Class',    w: 20, required: true, ref: SHEETS.CLASSES },
      { key: 'subjects',   header: 'Subjects', w: 70, required: true, list: true },
    ],
  },

  [SHEETS.GRADING]: {
    target: 'grading',
    title: 'Grading scale',
    help: 'The school\'s own grade boundaries. Importing this sheet REPLACES the whole scale, so list every band, not just the ones you are changing.',
    key: ['min_score', 'max_score'],
    onExisting: ON_EXISTING.REPLACE,
    columns: [
      { key: 'min_score', header: 'From', w: 9,  num: true, required: true },
      { key: 'max_score', header: 'To',   w: 9,  num: true, required: true },
      { key: 'remark',    header: 'Remark / Grade', w: 26, required: true },
    ],
  },
};

// ── People ─────────────────────────────────────────────────────────────
// Staff and pupils are the two sheets a school actually spends its afternoon
// on, so both are keyed on the number the office already writes on a file —
// and both tolerate that number being missing, because plenty of schools have
// never issued one.
Object.assign(IMPORT_SHEETS, {
  [SHEETS.STAFF]: {
    target: 'staff',
    title: 'Staff',
    help: 'Everybody the school employs — teachers, the office, the kitchen, the caretaker. Leave Staff No blank and the system issues one.',
    key: ['staff_number'],
    fallbackKey: ['surname', 'first_name', 'date_of_birth'],
    onExisting: ON_EXISTING.UPDATE,
    columns: [
      { key: 'staff_number',   header: 'Staff No',      w: 14 },
      { key: 'surname',        header: 'Surname',       w: 18, required: true },
      { key: 'first_name',     header: 'First Name',    w: 18, required: true },
      { key: 'other_names',    header: 'Other Names',   w: 18 },
      { key: 'gender',         header: 'Gender',        w: 10, enum: ['Male', 'Female'] },
      { key: 'date_of_birth',  header: 'Date of Birth', w: 14, date: true },
      { key: 'role',           header: 'Role',          w: 22, required: true },
      { key: 'phone',          header: 'Phone',         w: 15, phone: true },
      { key: 'email',          header: 'Email',         w: 24 },
      { key: 'address',        header: 'Address',       w: 28 },
      { key: 'qualification',  header: 'Qualification', w: 22 },
      { key: 'hire_date',      header: 'Date Employed', w: 14, date: true },
      { key: 'base_salary',    header: 'Monthly Salary (GHS)', w: 20, money: true },
      { key: 'ssnit_number',   header: 'SSNIT No',      w: 16 },
      { key: 'bank_name',      header: 'Bank',          w: 18 },
      { key: 'bank_account',   header: 'Bank Account',  w: 20 },
      { key: 'status',         header: 'Status',        w: 12, enum: ['Active', 'Inactive'] },
    ],
  },

  [SHEETS.STUDENTS]: {
    target: 'student',
    title: 'Students',
    help: 'The whole roll. Class must be spelt exactly as on the Classes sheet. Leave Index No blank and the system issues one in the school\'s own format.',
    key: ['index_number'],
    // A school with no index numbers at all still has to import. Name and date
    // of birth is what an office uses to tell two children apart, so it is what
    // we use when there is no number to key on.
    fallbackKey: ['surname', 'first_name', 'date_of_birth'],
    onExisting: ON_EXISTING.UPDATE,
    columns: [
      { key: 'index_number',    header: 'Index No',      w: 16 },
      { key: 'surname',         header: 'Surname',       w: 18, required: true },
      { key: 'first_name',      header: 'First Name',    w: 18, required: true },
      { key: 'other_names',     header: 'Other Names',   w: 18 },
      { key: 'gender',          header: 'Gender',        w: 10, enum: ['Male', 'Female'] },
      { key: 'date_of_birth',   header: 'Date of Birth', w: 14, date: true },
      { key: 'class_name',      header: 'Class',         w: 18, required: true, ref: SHEETS.CLASSES },
      { key: 'admission_date',  header: 'Date Admitted', w: 14, date: true },
      { key: 'status',          header: 'Status',        w: 11, enum: ['Active', 'Inactive'] },
      { key: 'denomination',    header: 'Denomination',  w: 16 },
      { key: 'place_of_birth',  header: 'Place of Birth', w: 18 },
      { key: 'place_of_residence', header: 'Residence',  w: 20 },
      { key: 'digital_address', header: 'Digital Address', w: 16 },
      { key: 'father_name',     header: 'Father',        w: 24 },
      { key: 'father_contact',  header: 'Father Phone',  w: 15, phone: true },
      { key: 'mother_name',     header: 'Mother',        w: 24 },
      { key: 'mother_contact',  header: 'Mother Phone',  w: 15, phone: true },
      { key: 'guardian_name',   header: 'Guardian',      w: 24 },
      { key: 'guardian_contact', header: 'Guardian Phone', w: 15, phone: true },
      { key: 'previous_school', header: 'Previous School', w: 24 },
      { key: 'nhis_number',     header: 'NHIS No',       w: 14 },
      { key: 'blood_group',     header: 'Blood Group',   w: 12 },
      { key: 'allergies',       header: 'Allergies',     w: 24 },
      { key: 'notes',           header: 'Notes',         w: 28 },
    ],
  },

  // Parents get their own sheet because a parent is not a column on a child:
  // one phone number belongs to three pupils across two classes, and the app
  // signs that person in ONCE and shows them all three. Keyed on the phone,
  // which is what the school actually has and what the parent signs in with.
  [SHEETS.PARENTS]: {
    target: 'parent',
    title: 'Parent accounts',
    help: 'Only needed if parents will use the app. One row per parent; list their children\'s Index Numbers separated by commas.',
    key: ['phone'],
    onExisting: ON_EXISTING.UPDATE,
    columns: [
      { key: 'full_name',    header: 'Parent Name',  w: 26, required: true },
      { key: 'phone',        header: 'Phone',        w: 15, required: true, phone: true },
      { key: 'email',        header: 'Email',        w: 24 },
      { key: 'children',     header: 'Children (Index Nos)', w: 40, required: true, list: true },
      { key: 'relationship', header: 'Relationship', w: 14 },
    ],
  },
});

// ── Money the school is bringing across ────────────────────────────────
Object.assign(IMPORT_SHEETS, {
  // One row per fee LINE, not per class: a school's schedule is "Basic 5 pays
  // tuition 400, PTA 20, exams 15", and asking an office to flatten that into
  // one row per class with fifteen amount columns is how it gets typed wrong.
  // Rows sharing a class and term are gathered into one template on import.
  [SHEETS.FEES]: {
    target: 'fee_item',
    title: 'Fee structure',
    help: 'What each class pays, one line per item. Repeat the Class and Term on every line of the same schedule.',
    key: ['class_name', 'term_label', 'item_name'],
    onExisting: ON_EXISTING.UPDATE,
    columns: [
      { key: 'class_name', header: 'Class',        w: 18, required: true, ref: SHEETS.CLASSES },
      { key: 'term_label', header: 'Term',         w: 18, required: true, ref: SHEETS.TERMS },
      { key: 'part',       header: 'Part (A/B)',   w: 11 },
      { key: 'item_name',  header: 'Item',         w: 26, required: true },
      { key: 'amount',     header: 'Amount (GHS)', w: 14, money: true, required: true },
      { key: 'is_optional', header: 'Optional? (YES/NO)', w: 18, bool: true },
    ],
  },

  // The one sheet that must not be double-counted. An opening balance is what
  // the pupil owed on the day the school started using this system — a
  // statement of position, not a transaction — so a re-import SETS the arrears
  // to the figure on the sheet rather than adding to it. Importing the file
  // three times therefore leaves the same balance, not triple it.
  [SHEETS.BALANCES]: {
    target: 'opening_balance',
    title: 'Opening balances',
    help: 'What each pupil still owed on the day the school moved onto this system. Re-importing SETS the figure — it never adds to it.',
    key: ['index_number', 'term_label'],
    onExisting: ON_EXISTING.UPDATE,
    columns: [
      { key: 'index_number',  header: 'Index No',  w: 16, required: true, ref: SHEETS.STUDENTS },
      { key: 'student_name',  header: 'Student Name', w: 26 },
      { key: 'term_label',    header: 'Term',      w: 18, required: true, ref: SHEETS.TERMS },
      { key: 'amount_owing',  header: 'Arrears Brought Forward (GHS)', w: 28, money: true, required: true },
      { key: 'notes',         header: 'Notes',     w: 28 },
    ],
  },
});

// The School Profile sheet is a fixed list of questions rather than free rows:
// a settings table takes any key at all, and a workbook that let a school
// invent one would write a setting nothing ever reads.
const PROFILE_ROWS = [
  { setting: 'School name',            key: 'school_name' },
  { setting: 'Motto',                  key: 'school_motto' },
  { setting: 'Address',                key: 'school_address' },
  { setting: 'Town / City',            key: 'school_town' },
  { setting: 'Region',                 key: 'school_region' },
  { setting: 'Phone (main)',           key: 'school_phone_1' },
  { setting: 'Phone (alternate)',      key: 'school_phone_2' },
  { setting: 'Email',                  key: 'school_email' },
  { setting: 'Website',                key: 'school_website' },
  { setting: 'GES / Registration No',  key: 'school_ges_number' },
  { setting: 'Head teacher',           key: 'head_teacher_name' },
  { setting: 'Proprietor',             key: 'proprietor_name' },
  { setting: 'WhatsApp number for fees', key: 'school_whatsapp' },
  { setting: 'Index number prefix',    key: 'school_abbreviation' },
];

const PROFILE_BY_LABEL = new Map(
  PROFILE_ROWS.map(r => [r.setting.trim().toLowerCase(), r.key]));

// ── Coercion ───────────────────────────────────────────────────────────
// Shared with the finance workbook wherever the question is the same, because
// "what is a date" must have exactly one answer in this product.
const { toISODate, toMoney, cellText, normaliseForKey } = wb;

/** "YES" / "Y" / "TRUE" / "1" / a tick → 1. Anything else → 0. */
function toBool(v) {
  if (v == null || v === '') return null;
  const s = String(cellText(v)).trim().toLowerCase();
  if (!s) return null;
  return ['yes', 'y', 'true', '1', 'x', '✓', 'current', 'active'].includes(s) ? 1 : 0;
}

function toInt(v) {
  if (v == null || v === '') return null;
  const n = parseInt(String(cellText(v)).replace(/[^0-9-]/g, ''), 10);
  return Number.isNaN(n) ? null : n;
}

function toNum(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(cellText(v)).replace(/[^0-9.-]/g, ''));
  return Number.isNaN(n) ? null : n;
}

// A Ghanaian mobile number is written half a dozen ways — 024 123 4567,
// +233241234567, 233241234567, 24-123-4567 — and a parent whose number is
// stored one way cannot be found by the office searching another. One form:
// the national 0-leading one the school itself writes.
function toPhone(v) {
  const raw = String(cellText(v)).trim();
  if (!raw) return '';
  let d = raw.replace(/[^\d+]/g, '');
  d = d.replace(/^\+/, '');
  if (d.startsWith('233') && d.length >= 12) d = '0' + d.slice(3);
  if (d.length === 9 && !d.startsWith('0')) d = '0' + d;
  return d;
}

// "English, Mathematics , Science" → ['English','Mathematics','Science'].
// Semicolons and newlines too: a bursar pasting a column out of another sheet
// gets newlines, and telling them off for it is not a product decision.
function toList(v) {
  const s = String(cellText(v)).trim();
  if (!s) return [];
  return s.split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
}

/** Coerce one raw cell according to its column definition. */
function coerce(col, v) {
  if (col.date)  return toISODate(v && typeof v === 'object' && v.result !== undefined ? v.result : v);
  if (col.money) return toMoney(v);
  if (col.bool)  return toBool(v);
  if (col.int)   return toInt(v);
  if (col.num)   return toNum(v);
  if (col.phone) return toPhone(v);
  if (col.list)  return toList(v);
  return cellText(v).trim();
}

// The natural key, as a string that survives re-typing. Case, spacing and
// number formatting must not change it, or a row the office merely re-keyed
// would import as a second pupil.
function naturalKey(sheetName, row) {
  const def = IMPORT_SHEETS[sheetName];
  if (!def) return null;
  const usePrimary = def.key.every(f => {
    const v = row[f];
    return v != null && v !== '' && !(Array.isArray(v) && !v.length);
  });
  const fields = usePrimary ? def.key : (def.fallbackKey || def.key);
  const parts = fields.map(f => normaliseForKey(row[f]));
  if (parts.every(p => !p)) return null;
  return [sheetName, ...parts].join('|');
}

module.exports = {
  SHEETS, SHEET_ORDER, IMPORT_SHEETS, HEADER_ROWS, ON_EXISTING,
  PROFILE_ROWS, PROFILE_BY_LABEL,
  toBool, toInt, toNum, toPhone, toList, coerce, naturalKey,
  toISODate, toMoney, cellText, normaliseForKey,
};
