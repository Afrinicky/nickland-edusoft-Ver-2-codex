// Nickland Edusoft — Onboarding workbook: import.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Turns a filled-in onboarding workbook into a working school. The two rules
// the finance importer is built on hold here too, with one changed:
//
//   1. NEVER a second write path. A pupil admitted from this sheet goes through
//      the same `createStudent` the admission form calls, so they get an index
//      number in the school's own format, a class history row and everything
//      else the app would have given them. A workbook that wrote its own rows
//      would quietly produce pupils the rest of the system treats differently.
//
//   2. NEVER import the same thing twice — but here that means UPSERT, not
//      refuse. See `_onboarding_schema.js` for why: onboarding is iterative and
//      the second run is usually a correction, not a mistake.
//
//   3. ORDER IS NOT NEGOTIABLE. Sheets are walked in SHEET_ORDER, never in the
//      order the file happens to list them, because a pupil cannot be put in a
//      class that has not been created yet.
//
// Everything is driven from plain row objects (`importRows`), and reading the
// .xlsx is a thin layer on top (`importWorkbook`). That split is what lets the
// whole pipeline — validation, name resolution, upsert, the lot — be tested
// without Excel anywhere near it.

const S = require('./_onboarding_schema');
const { SHEETS, SHEET_ORDER, IMPORT_SHEETS, ON_EXISTING } = S;
const security = require('./_security');
const billing = require('./_billing');

// ── The services this importer drives ──────────────────────────────────
// Captured from the real modules rather than reimplemented. `_registry` is not
// involved: these are the bare handlers, called with the same argument shapes
// the renderer sends.
function captureHandlers(db, userDataPath) {
  const h = {};
  const reg = { handle: (name, fn) => { h[name] = fn; } };
  // `userDataPath` is only reached by the photo-upload handlers, which an
  // import never calls; passing it through anyway keeps these registrations
  // identical to the ones the application itself makes.
  require('./settings')(reg, db);
  require('./students')(reg, db, userDataPath);
  require('./staff')(reg, db, userDataPath);
  require('./fees')(reg, db);
  return h;
}

// ── Lookups ────────────────────────────────────────────────────────────
// Everything the sheets refer to by name, indexed the way a person types it.
// Rebuilt after each sheet is applied, because the Classes sheet is what makes
// the Students sheet's class names resolvable.
function norm(v) {
  return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildContext(db) {
  const ctx = {
    classes: new Map(),      // 'basic 5'   → row
    subjects: new Map(),     // 'english'   → row
    years: new Map(),        // '2025/2026' → row
    terms: new Map(),        // 'first term 2025/2026' and 'first term' → row
    students: new Map(),     // index no    → row
    staff: new Map(),        // staff no    → row
    parents: new Map(),      // phone       → row
  };
  const q = (sql) => { try { return db.prepare(sql).all(); } catch (_) { return []; } };

  for (const r of q('SELECT * FROM class_groups')) {
    ctx.classes.set(norm(r.name), r);
    if (r.short_code) ctx.classes.set(norm(r.short_code), r);
  }
  for (const r of q('SELECT * FROM subjects WHERE COALESCE(is_active,1) = 1')) {
    ctx.subjects.set(norm(r.name), r);
    if (r.code) ctx.subjects.set(norm(r.code), r);
  }
  for (const r of q('SELECT * FROM academic_years')) ctx.years.set(norm(r.label), r);

  // A term is referred to two ways and both have to work: "First Term
  // 2025/2026" when the workbook is precise, and bare "First Term" when the
  // office assumed this year — which they will, because they always do.
  for (const r of q(`SELECT t.*, y.label AS year_label FROM terms t
                     LEFT JOIN academic_years y ON y.id = t.academic_year_id`)) {
    ctx.terms.set(norm(`${r.label} ${r.year_label || ''}`), r);
    const bare = norm(r.label);
    // Only the current year claims the bare name, so "First Term" never
    // silently means a year the school has finished with.
    if (!ctx.terms.has(bare) || r.is_current) ctx.terms.set(bare, r);
  }
  for (const r of q('SELECT id, index_number, surname, first_name, date_of_birth FROM students')) {
    if (r.index_number) ctx.students.set(norm(r.index_number), r);
  }
  for (const r of q('SELECT id, staff_number, surname, first_name, date_of_birth FROM staff')) {
    if (r.staff_number) ctx.staff.set(norm(r.staff_number), r);
  }
  for (const r of q('SELECT id, full_name, phone FROM parents')) {
    if (r.phone) ctx.parents.set(norm(r.phone), r);
  }
  return ctx;
}

// A record already in the system that this row is a correction to, found by the
// sheet's natural key — and, when the sheet has no number to key on, by the
// name and birthday an office actually uses to tell two children apart.
function findExisting(db, sheetName, row, ctx) {
  switch (IMPORT_SHEETS[sheetName].target) {
    case 'academic_year': return ctx.years.get(norm(row.label)) || null;
    case 'class':         return ctx.classes.get(norm(row.name)) || null;
    case 'subject':       return ctx.subjects.get(norm(row.name)) || null;
    case 'parent':        return ctx.parents.get(norm(row.phone)) || null;
    case 'term': {
      const y = ctx.years.get(norm(row.year_label));
      if (!y) return null;
      try {
        return db.prepare('SELECT * FROM terms WHERE academic_year_id = ? AND term_number = ?')
          .get(y.id, row.term_number) || null;
      } catch (_) { return null; }
    }
    case 'student': return matchPerson(db, 'students', ctx.students, row, row.index_number);
    case 'staff':   return matchPerson(db, 'staff', ctx.staff, row, row.staff_number);
    default: return null;
  }
}

function matchPerson(db, table, byNumber, row, number) {
  if (number) {
    const hit = byNumber.get(norm(number));
    if (hit) return hit;
    // A number the sheet supplies that we have never seen is a NEW person with
    // a number of the school's own choosing — not a failure. Falling through to
    // the name match here would be wrong: two different children genuinely can
    // share a name and a birthday, and the number is the office saying so.
    return null;
  }
  const candidates = namesakes(db, table, row);
  if (candidates.length === 1) return candidates[0];
  // None, or more than one and no way to tell them apart. Ambiguity is refused
  // rather than resolved — see `ambiguousPerson`, which is what turns it into a
  // sentence the office can act on.
  return null;
}

// Everyone already on the roll under this row's name, narrowed by birthday when
// the sheet gives one.
function namesakes(db, table, row) {
  const sur = norm(row.surname), first = norm(row.first_name);
  if (!sur || !first) return [];
  let rows;
  try {
    rows = db.prepare(
      `SELECT * FROM ${table} WHERE LOWER(TRIM(surname)) = ? AND LOWER(TRIM(first_name)) = ?`
    ).all(sur, first);
  } catch (_) { return []; }
  const dob = row.date_of_birth || '';
  return dob ? rows.filter(r => (r.date_of_birth || '') === dob) : rows;
}

// A row with no number, matching more than one person already on the roll and
// with no birthday to tell them apart, cannot be resolved — and guessing is the
// one thing that must not happen, because the guess would silently overwrite
// somebody else's record. The office is asked for the one fact that settles it.
function ambiguousPerson(db, sheetName, row, ctx) {
  const t = IMPORT_SHEETS[sheetName].target;
  if (t !== 'student' && t !== 'staff') return null;
  const number = t === 'student' ? row.index_number : row.staff_number;
  if (number) return null;
  const hits = namesakes(db, t === 'student' ? 'students' : 'staff', row);
  if (hits.length < 2) return null;
  const who = `${row.surname} ${row.first_name}`.trim();
  return row.date_of_birth
    ? `There is already more than one ${who} born ${row.date_of_birth}. ` +
      `Give this row its ${t === 'student' ? 'Index No' : 'Staff No'} so the right record is corrected.`
    : `There is already more than one ${who} on the roll. Fill in the Date of Birth, ` +
      `or the ${t === 'student' ? 'Index No' : 'Staff No'}, so the right record is corrected.`;
}

// ── Validation ─────────────────────────────────────────────────────────
// Everything that can be known before writing is checked before writing, and
// reported against the row number the user is looking at in Excel. A school
// correcting forty rows wants all forty listed once, not one per re-run.
function validateRow(db, sheetName, row, ctx) {
  const def = IMPORT_SHEETS[sheetName];
  const errors = [];

  for (const col of def.columns) {
    const v = row[col.key];
    const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
    if (col.required && empty) { errors.push(`${col.header} is required`); continue; }
    if (empty) continue;

    if (col.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
      errors.push(`${col.header} is not a real date`);
    }
    if (col.enum && !col.enum.some(e => norm(e) === norm(v))) {
      errors.push(`${col.header} must be one of: ${col.enum.join(', ')}`);
    }
    if (col.money && !(Number(v) >= 0)) {
      errors.push(`${col.header} must be a number`);
    }
  }

  // Cross-sheet references. A name that resolves to nothing is named in full —
  // "No class called \"Basic 5B\"" is actionable; "invalid class" is not.
  for (const col of def.columns) {
    if (!col.ref || !row[col.key]) continue;
    const raw = row[col.key];
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      if (!resolveRef(col.ref, v, ctx)) {
        errors.push(`${refNoun(col.ref)} "${v}" is not on the ${col.ref} sheet`);
      }
    }
  }

  // Sheet-specific rules — the ones where a plausible-looking sheet still
  // produces a school that behaves wrongly.
  switch (def.target) {
    case 'subject': {
      const cw = row.class_weight_pct, ew = row.exam_weight_pct;
      if (cw != null && ew != null && Math.round(cw + ew) !== 100) {
        errors.push(`Class Work % and Exam % must add up to 100 (they add to ${Math.round(cw + ew)})`);
      }
      break;
    }
    case 'term':
      if (row.term_number != null && ![1, 2, 3].includes(Number(row.term_number))) {
        errors.push('Term No must be 1, 2 or 3');
      }
      break;
    case 'grading':
      if (row.min_score != null && row.max_score != null && row.min_score > row.max_score) {
        errors.push('From cannot be greater than To');
      }
      break;
    case 'profile':
    case 'settings':
      if (row.setting && !S.PROFILE_BY_LABEL.has(norm(row.setting))) {
        errors.push(`"${row.setting}" is not one of the school details this sheet asks for`);
      }
      break;
  }

  if (row.start_date && row.end_date && row.start_date > row.end_date) {
    errors.push('Starts is after Ends');
  }

  const ambiguous = ambiguousPerson(db, sheetName, row, ctx);
  if (ambiguous) errors.push(ambiguous);

  return errors;
}

function resolveRef(sheet, value, ctx) {
  switch (sheet) {
    case SHEETS.CLASSES:  return ctx.classes.get(norm(value)) || null;
    case SHEETS.SUBJECTS: return ctx.subjects.get(norm(value)) || null;
    case SHEETS.YEARS:    return ctx.years.get(norm(value)) || null;
    case SHEETS.TERMS:    return ctx.terms.get(norm(value)) || null;
    case SHEETS.STUDENTS: return ctx.students.get(norm(value)) || null;
    default: return null;
  }
}

function refNoun(sheet) {
  return { [SHEETS.CLASSES]: 'Class', [SHEETS.SUBJECTS]: 'Subject',
           [SHEETS.YEARS]: 'Academic year', [SHEETS.TERMS]: 'Term',
           [SHEETS.STUDENTS]: 'Index number' }[sheet] || 'Value';
}

// ── Whole-sheet rules ──────────────────────────────────────────────────
// Some mistakes are invisible row by row and obvious across the sheet.
function validateSheet(sheetName, rows) {
  const def = IMPORT_SHEETS[sheetName];
  const problems = [];

  // Exactly one "current" — a school with two current terms shows the wrong
  // bills, the wrong register and the wrong report cards, all at once.
  if (def.target === 'term' || def.target === 'academic_year') {
    const current = rows.filter(r => r.is_current === 1);
    if (current.length > 1) {
      problems.push({ row: current[1].__row || null,
        error: `Only one ${def.target === 'term' ? 'term' : 'academic year'} may be marked current; ${current.length} are.` });
    }
  }

  // Overlapping grade bands silently give one mark two grades.
  if (def.target === 'grading') {
    const bands = rows.filter(r => r.min_score != null && r.max_score != null)
      .slice().sort((a, b) => a.min_score - b.min_score);
    for (let i = 1; i < bands.length; i++) {
      if (bands[i].min_score <= bands[i - 1].max_score) {
        problems.push({ row: bands[i].__row || null,
          error: `This band (${bands[i].min_score}–${bands[i].max_score}) overlaps the one below it (${bands[i - 1].min_score}–${bands[i - 1].max_score}).` });
      }
    }
  }

  // The same natural key twice in one file: the second row would silently
  // overwrite the first, so the office is told rather than shown a total that
  // does not match their own count.
  const seen = new Map();
  for (const row of rows) {
    const k = S.naturalKey(sheetName, row);
    if (!k) continue;
    if (seen.has(k)) {
      problems.push({ row: row.__row || null,
        error: `This is the same ${def.title.toLowerCase()} entry as row ${seen.get(k)}. Remove one.` });
    } else seen.set(k, row.__row || '?');
  }
  return problems;
}

// ── Writing ────────────────────────────────────────────────────────────
// One function per target. Each returns { action: 'created'|'updated'|'skipped',
// summary } and throws with a sentence an office can act on. Where the app has
// a service for the job, the service does it.
function applyRow(db, sheetName, row, ctx, opts) {
  const def = IMPORT_SHEETS[sheetName];
  const h = opts.handlers;

  switch (def.target) {
    case 'settings': {
      const key = S.PROFILE_BY_LABEL.get(norm(row.setting));
      // A blank Value means "keep what the system has". It is not a request to
      // erase the school's name because the bursar tabbed past the row.
      if (!key || row.value === '' || row.value == null) {
        return { action: 'skipped', summary: `${row.setting} — left as it is` };
      }
      h['settings:set'](null, { key, value: row.value, category: 'school' });
      return { action: 'updated', summary: `${row.setting} → ${row.value}` };
    }

    case 'academic_year': {
      const existing = findExisting(db, sheetName, row, ctx);
      if (existing) {
        db.prepare('UPDATE academic_years SET start_date = ?, end_date = ? WHERE id = ?')
          .run(row.start_date || existing.start_date, row.end_date || existing.end_date, existing.id);
        if (row.is_current === 1) setCurrentYear(db, existing.id);
        return { action: 'updated', summary: row.label, id: existing.id };
      }
      const id = db.prepare('INSERT INTO academic_years (label, start_date, end_date, is_current) VALUES (?, ?, ?, 0)')
        .run(row.label, row.start_date || null, row.end_date || null).lastInsertRowid;
      if (row.is_current === 1) setCurrentYear(db, id);
      return { action: 'created', summary: row.label, id };
    }

    case 'term': {
      const year = ctx.years.get(norm(row.year_label));
      const existing = findExisting(db, sheetName, row, ctx);
      if (existing) {
        db.prepare('UPDATE terms SET label = ?, start_date = ?, end_date = ? WHERE id = ?')
          .run(row.label, row.start_date || existing.start_date, row.end_date || existing.end_date, existing.id);
        if (row.is_current === 1) setCurrentTerm(db, existing.id);
        return { action: 'updated', summary: `${row.label} ${row.year_label}`, id: existing.id };
      }
      const id = db.prepare(
        'INSERT INTO terms (academic_year_id, term_number, label, start_date, end_date, is_current) VALUES (?, ?, ?, ?, ?, 0)'
      ).run(year.id, row.term_number, row.label, row.start_date || null, row.end_date || null).lastInsertRowid;
      if (row.is_current === 1) setCurrentTerm(db, id);
      return { action: 'created', summary: `${row.label} ${row.year_label}`, id };
    }

    case 'class': {
      const existing = findExisting(db, sheetName, row, ctx);
      const res = h['settings:save-class'](null, {
        id: existing ? existing.id : undefined,
        name: row.name,
        short_code: row.short_code || autoShortCode(row.name),
        level_category: row.level_category,
        level_order: row.level_order,
        section: row.section || null,
        capacity: row.capacity || null,
        is_active: 1,
      });
      return { action: existing ? 'updated' : 'created', summary: row.name, id: res.id };
    }

    case 'subject': {
      const existing = findExisting(db, sheetName, row, ctx);
      // The two weightings are a pair: supplying one and not the other would
      // leave a subject adding to 140%, so the other is derived.
      let cw = row.class_weight_pct, ew = row.exam_weight_pct;
      if (cw != null && ew == null) ew = 100 - cw;
      if (ew != null && cw == null) cw = 100 - ew;
      const res = h['settings:save-subject'](null, {
        id: existing ? existing.id : undefined,
        name: row.name,
        code: row.code || null,
        class_weight_pct: cw != null ? cw : 40,
        exam_weight_pct: ew != null ? ew : 60,
        is_active: 1,
      });
      return { action: existing ? 'updated' : 'created', summary: row.name, id: res.id };
    }

    case 'class_subject': {
      const cls = ctx.classes.get(norm(row.class_name));
      const ids = row.subjects.map(n => ctx.subjects.get(norm(n)).id);
      h['settings:set-class-subjects'](null, { classId: cls.id, subjectIds: ids });
      return { action: 'updated', summary: `${cls.name}: ${ids.length} subject${ids.length === 1 ? '' : 's'}`, id: cls.id };
    }

    case 'grading':
      // Written by the sheet handler in one act — see applySheet. A band on its
      // own is meaningless; the scale is the unit.
      return { action: 'updated', summary: `${row.min_score}–${row.max_score} ${row.remark}` };

    case 'staff': {
      const existing = findExisting(db, sheetName, row, ctx);
      const data = {
        staff_number: row.staff_number || undefined,
        surname: row.surname, first_name: row.first_name, other_names: row.other_names || '',
        gender: titleCase(row.gender), date_of_birth: row.date_of_birth || null,
        role: row.role, phone: row.phone || '', email: row.email || '',
        address: row.address || '', qualification: row.qualification || '',
        hire_date: row.hire_date || null, base_salary: row.base_salary || 0,
        ssnit_number: row.ssnit_number || '', ssnit_enrolled: row.ssnit_number ? 1 : 0,
        bank_name: row.bank_name || '', bank_account: row.bank_account || '',
        status: titleCase(row.status) || 'Active',
      };
      if (existing) {
        h['staff:update'](null, { id: existing.id, data });
        return { action: 'updated', summary: `${row.surname} ${row.first_name}`, id: existing.id };
      }
      const res = h['staff:create'](null, data);
      if (!res || !res.ok) throw new Error((res && res.error) || 'The staff record was refused');
      return { action: 'created', summary: `${row.surname} ${row.first_name} (${res.staff_number})`, id: res.id };
    }

    case 'student': {
      const cls = ctx.classes.get(norm(row.class_name));
      const existing = findExisting(db, sheetName, row, ctx);
      const fields = {
        surname: row.surname, first_name: row.first_name, other_names: row.other_names || '',
        gender: titleCase(row.gender), date_of_birth: row.date_of_birth || null,
        current_class_id: cls.id, admission_date: row.admission_date || null,
        status: titleCase(row.status) || 'Active',
        denomination: row.denomination || '', place_of_birth: row.place_of_birth || '',
        place_of_residence: row.place_of_residence || '', digital_address: row.digital_address || '',
        father_name: row.father_name || '', father_contact: row.father_contact || '',
        mother_name: row.mother_name || '', mother_contact: row.mother_contact || '',
        guardian_name: row.guardian_name || '', guardian_contact: row.guardian_contact || '',
        previous_school: row.previous_school || '', nhis_number: row.nhis_number || '',
        blood_group: row.blood_group || '', allergies: row.allergies || '',
        notes: row.notes || '',
      };
      if (existing) {
        h['students:update'](null, { id: existing.id, data: fields });
        return { action: 'updated', summary: `${row.surname} ${row.first_name}`, id: existing.id, index_number: existing.index_number };
      }
      // The admission path, not an INSERT: it is what mints the index number in
      // the school's own format and starts the pupil's class history.
      const res = require('./students').createStudent(db, {
        ...fields,
        index_number: row.index_number || null,
      });
      if (!res || !res.ok) throw new Error((res && res.error) || 'The pupil was refused');
      return { action: 'created', summary: `${row.surname} ${row.first_name} (${res.index_number || ''})`.trim(),
               id: res.id, index_number: res.index_number };
    }

    case 'parent': {
      const existing = findExisting(db, sheetName, row, ctx);
      let parentId;
      if (existing) {
        db.prepare('UPDATE parents SET full_name = ?, email = ? WHERE id = ?')
          .run(row.full_name, row.email || null, existing.id);
        parentId = existing.id;
      } else {
        // No password. A parent account is activated by the office issuing one,
        // and a workbook that set a default would hand every parent in the
        // school the same one.
        parentId = db.prepare(
          'INSERT INTO parents (full_name, phone, email, is_active, must_change_password) VALUES (?, ?, ?, 1, 1)'
        ).run(row.full_name, row.phone, row.email || null).lastInsertRowid;
      }
      const link = db.prepare('INSERT OR IGNORE INTO parent_students (parent_id, student_id, relationship) VALUES (?, ?, ?)');
      let linked = 0;
      for (const idx of row.children) {
        const st = ctx.students.get(norm(idx));
        if (st) { link.run(parentId, st.id, row.relationship || null); linked++; }
      }
      return { action: existing ? 'updated' : 'created',
               summary: `${row.full_name} — ${linked} child${linked === 1 ? '' : 'ren'}`, id: parentId };
    }

    case 'fee_item':
      // Written by the sheet handler, for the same reason grading is: a fee
      // schedule is a set of lines, and the app's own save-template service
      // takes it whole. See applySheet.
      return { action: 'updated', summary: `${row.class_name} · ${row.item_name}` };

    case 'opening_balance': return applyOpeningBalance(db, row, ctx);
    default: throw new Error(`Unknown target "${def.target}"`);
  }
}

// ── Opening balances ───────────────────────────────────────────────────
// The one figure on the whole workbook that must not accumulate. It is a
// STATEMENT OF POSITION — "on the day we moved onto this system, this child
// owed GHS 340" — so importing the file a third time must leave the arrears at
// 340, not 1020.
//
// The mechanism is the same one the billing engine already uses for a
// carried-forward balance: an `arrear` line on the pupil's bill for that term.
// Ours carries a fixed description so it can be found and REPLACED rather than
// added to, and so an office looking at the bill can see where it came from.
const OPENING_BALANCE_LABEL = 'Balance brought forward (opening)';

function applyOpeningBalance(db, row, ctx) {
  const student = ctx.students.get(norm(row.index_number));
  const term = ctx.terms.get(norm(row.term_label));
  const amount = billing.round2(row.amount_owing);

  let bill = db.prepare('SELECT * FROM student_bills WHERE student_id = ? AND term_id = ?')
    .get(student.id, term.id);
  if (!bill) {
    // A school can be carrying arrears into a term whose fee schedule has not
    // been raised yet. The debt is real either way, so the bill is opened for
    // it rather than the row being refused.
    const id = db.prepare('INSERT INTO student_bills (student_id, term_id) VALUES (?, ?)')
      .run(student.id, term.id).lastInsertRowid;
    bill = db.prepare('SELECT * FROM student_bills WHERE id = ?').get(id);
  }

  const existing = db.prepare(
    'SELECT id FROM bill_line_items WHERE student_bill_id = ? AND description = ?'
  ).get(bill.id, OPENING_BALANCE_LABEL);

  if (amount === 0) {
    // Nothing owed is a fact worth recording: it removes a figure a previous
    // import put there, which is how an office corrects one to zero.
    if (existing) db.prepare('DELETE FROM bill_line_items WHERE id = ?').run(existing.id);
  } else if (existing) {
    db.prepare('UPDATE bill_line_items SET amount = ? WHERE id = ?').run(amount, existing.id);
  } else {
    db.prepare(`
      INSERT INTO bill_line_items (student_bill_id, item_number, description, amount, is_arrear, charge_type)
      VALUES (?, 0, ?, ?, 1, ?)
    `).run(bill.id, OPENING_BALANCE_LABEL, amount, billing.CHARGE_TYPES.ARREAR);
  }

  billing.recomputeBillTotals(db, bill.id);
  return {
    action: existing ? 'updated' : 'created',
    summary: `${row.index_number} — GHS ${amount.toFixed(2)} into ${term.label}`,
    id: bill.id,
  };
}

// ── Small helpers ──────────────────────────────────────────────────────
// Exactly one current year, and exactly one current term, always.
function setCurrentYear(db, id) {
  db.prepare('UPDATE academic_years SET is_current = 0').run();
  db.prepare('UPDATE academic_years SET is_current = 1 WHERE id = ?').run(id);
}

function setCurrentTerm(db, id) {
  db.prepare('UPDATE terms SET is_current = 0').run();
  db.prepare('UPDATE terms SET is_current = 1 WHERE id = ?').run(id);
}

// "Basic 5" → "B5", "Kindergarten 2" → "K2", "JHS 1" → "JHS1". Only used when
// the school left the column blank; a code they supplied is never rewritten.
function autoShortCode(name) {
  const s = String(name || '').trim();
  const num = (s.match(/(\d+)\s*$/) || [])[1] || '';
  const words = s.replace(/\d+\s*$/, '').trim().split(/\s+/).filter(Boolean);
  const caps = words.filter(w => w === w.toUpperCase() && w.length > 1);
  const letters = caps.length ? caps.join('') : words.map(w => w[0].toUpperCase()).join('');
  return (letters + num).slice(0, 8) || s.slice(0, 8).toUpperCase();
}

function titleCase(v) {
  const s = String(v == null ? '' : v).trim();
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : '';
}

// ── Sheet-level targets ────────────────────────────────────────────────
// Two sheets are not a list of independent records: the grading scale is one
// object spread over rows, and a fee schedule is a set of lines the app's own
// service takes whole. Both are applied once per sheet, after every row has
// been validated — so a single bad line stops the schedule it belongs to and
// nothing else.
function applyGrading(db, rows) {
  const bands = rows.slice().sort((a, b) => b.min_score - a.min_score);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM grading_bands').run();
    const ins = db.prepare('INSERT INTO grading_bands (min_score, max_score, remark, display_order) VALUES (?, ?, ?, ?)');
    bands.forEach((b, i) => ins.run(b.min_score, b.max_score, b.remark, i + 1));
  });
  tx();
  return bands.length;
}

function applyFeeSchedules(db, rows, ctx, h) {
  // Every line sharing a class and a term is one schedule.
  const groups = new Map();
  for (const row of rows) {
    const cls = ctx.classes.get(norm(row.class_name));
    const term = ctx.terms.get(norm(row.term_label));
    const gk = `${cls.id}|${term.id}`;
    if (!groups.has(gk)) groups.set(gk, { cls, term, rows: [] });
    groups.get(gk).rows.push(row);
  }

  const results = [];
  for (const { cls, term, rows: lines } of groups.values()) {
    const existing = db.prepare(`
      SELECT id, name FROM fee_templates
       WHERE class_group_id = ? AND term_id = ? AND COALESCE(bill_type, 'school_fees') = 'school_fees'
       ORDER BY is_active DESC, id DESC LIMIT 1
    `).get(cls.id, term.id);

    const res = h['fees:save-template'](null, {
      id: existing ? existing.id : undefined,
      name: existing ? existing.name : `${cls.name} — ${term.label}`,
      class_group_id: cls.id,
      term_id: term.id,
      bill_type: billing.BILL_TYPES.SCHOOL_FEES,
      // The workbook IS the school's fee schedule. A clash with a template
      // already there is the school restating it, not an accident to query —
      // and there is nobody at a dialog box during an import.
      confirm_replace: true,
      replaces_template_id: existing ? existing.id : undefined,
      is_active: 1,
      items: lines.map((l, i) => ({
        item_number: i + 1,
        description: l.item_name,
        amount: l.amount,
        is_optional: l.is_optional === 1 ? 1 : 0,
        category: l.part ? `Part ${String(l.part).trim().toUpperCase()}` : '',
      })),
    });
    if (!res || !res.ok) {
      throw new Error(`${cls.name} ${term.label}: ${(res && res.error) || 'the fee schedule was refused'}`);
    }
    const total = billing.round2(lines.reduce((t, l) => t + (Number(l.amount) || 0), 0));
    results.push({
      action: existing ? 'updated' : 'created',
      summary: `${cls.name} · ${term.label} — ${lines.length} item${lines.length === 1 ? '' : 's'}, GHS ${total.toFixed(2)}`,
    });
  }
  return results;
}

const SHEET_LEVEL = { grading: applyGrading, fee_item: applyFeeSchedules };

// ── Entry point ────────────────────────────────────────────────────────
/**
 * Import already-parsed rows. `sheets` is { [sheetName]: [rowObject] }, each
 * row's values already coerced by the schema's `coerce`. This is the whole
 * importer; reading a .xlsx is a layer on top of it.
 *
 * A dry run does everything except write, and reports exactly what it would do.
 * Onboarding is the one moment a school has no backup to fall back on, so
 * nothing here writes on a click the user has not seen the consequences of.
 */
function importRows(db, sheets, options = {}) {
  const dryRun = !!options.dryRun;
  const userId = options.userId != null ? options.userId : security.getCurrentUserId();
  const handlers = dryRun ? null : captureHandlers(db, options.userDataPath);
  let ctx = buildContext(db);

  const report = {
    ok: true, dry_run: dryRun, file: options.file || null,
    sheets: [], totals: { created: 0, updated: 0, skipped: 0, failed: 0 },
  };

  for (const sheetName of SHEET_ORDER) {
    const rows = sheets[sheetName] || [];
    const def = IMPORT_SHEETS[sheetName];
    const sheet = {
      sheet: sheetName, title: def.title, found: rows.length,
      created: 0, updated: 0, skipped: 0, failed: 0, entries: [], problems: [],
    };
    if (!rows.length) { report.sheets.push(sheet); continue; }

    // Whole-sheet rules first: they describe the sheet, not a row, and a school
    // told about them up front fixes the file once.
    for (const p of validateSheet(sheetName, rows)) {
      sheet.problems.push(p);
      sheet.failed++;
    }
    const blocked = new Set(sheet.problems.map(p => p.row).filter(r => r != null));

    const good = [];
    for (const row of rows) {
      if (row.__row != null && blocked.has(row.__row)) continue;
      const errors = validateRow(db, sheetName, row, ctx);
      if (errors.length) {
        sheet.failed++;
        sheet.problems.push({ row: row.__row || null, error: errors.join('; ') });
        continue;
      }
      good.push(row);
    }

    const sheetLevel = SHEET_LEVEL[def.target];

    if (dryRun) {
      // The preview's numbers are the ones a school decides on, so they have to
      // be the numbers the real run then produces — not an approximation of
      // them. Anywhere the write path counts differently from one-row-one-record
      // (a fee schedule is a group of lines; a school detail is only ever
      // updated), the preview counts the same way. A preview that promised
      // seventeen and delivered thirteen would be worse than no preview.
      for (const entry of previewSheet(db, sheetName, good, ctx)) {
        sheet[entry.action]++;
        if (sheet.entries.length < 50) sheet.entries.push(entry);
      }
      // Names this sheet introduces have to become resolvable, or every later
      // sheet that refers to them reports a class that "does not exist" when
      // the preview would in fact have created it.
      projectContext(ctx, sheetName, good);
    } else if (sheetLevel) {
      try {
        const out = sheetLevel(db, good, ctx, handlers);
        if (Array.isArray(out)) {
          for (const r of out) {
            sheet[r.action]++;
            if (sheet.entries.length < 50) sheet.entries.push(r);
          }
        } else {
          sheet.updated += good.length;
          if (good.length) sheet.entries.push({ action: 'updated', summary: `${out} band${out === 1 ? '' : 's'}` });
        }
      } catch (e) {
        sheet.failed += good.length;
        sheet.problems.push({ row: null, error: String((e && e.message) || e) });
      }
    } else {
      // Row at a time, NOT one transaction over the sheet. Four hundred pupils
      // imported and one refused is a good afternoon; four hundred rolled back
      // because of one is not.
      for (const row of good) {
        try {
          const out = applyRow(db, sheetName, row, ctx, { userId, handlers });
          sheet[out.action]++;
          if (sheet.entries.length < 50) {
            sheet.entries.push({ row: row.__row || null, action: out.action, summary: out.summary });
          }
        } catch (e) {
          sheet.failed++;
          sheet.problems.push({ row: row.__row || null, error: String((e && e.message) || e) });
        }
      }
      // What this sheet created is what the next one refers to.
      ctx = buildContext(db);
    }

    report.sheets.push(sheet);
    for (const k of ['created', 'updated', 'skipped', 'failed']) report.totals[k] += sheet[k];
  }

  if (!dryRun && (report.totals.created || report.totals.updated)) {
    try {
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, user_id, justification, severity)
        VALUES ('onboarding_workbook', NULL, 'onboarding_imported', ?, ?, 'high')
      `).run(userId, `Imported ${options.file || 'onboarding workbook'}: ` +
        `${report.totals.created} created, ${report.totals.updated} updated, ${report.totals.failed} failed.`);
    } catch (_) {}
  }
  return report;
}

// What the real run would do, counted exactly as the real run counts it.
function previewSheet(db, sheetName, rows, ctx) {
  const def = IMPORT_SHEETS[sheetName];

  // A school detail is never "created": the setting exists either way. A blank
  // Value is the office saying "leave this one alone", and the preview must say
  // so rather than claiming a change.
  if (def.target === 'settings') {
    return rows.map(row => ({
      row: row.__row || null,
      action: (row.value === '' || row.value == null) ? 'skipped' : 'updated',
      summary: describe(sheetName, row),
    }));
  }

  // A fee schedule is one record per (class, term), however many lines the
  // office typed to describe it.
  if (def.target === 'fee_item') {
    const groups = new Map();
    for (const row of rows) {
      const cls = ctx.classes.get(norm(row.class_name));
      const term = ctx.terms.get(norm(row.term_label));
      const gk = `${cls.id}|${term.id}`;
      if (!groups.has(gk)) groups.set(gk, { cls, term, lines: [] });
      groups.get(gk).lines.push(row);
    }
    return [...groups.values()].map(({ cls, term, lines }) => {
      // A class this same file is about to create has a negative placeholder
      // id and therefore no template — which is exactly right.
      const existing = cls.id > 0 && term.id > 0 ? db.prepare(`
        SELECT id FROM fee_templates
         WHERE class_group_id = ? AND term_id = ? AND COALESCE(bill_type, 'school_fees') = 'school_fees'
         LIMIT 1`).get(cls.id, term.id) : null;
      const total = billing.round2(lines.reduce((t, l) => t + (Number(l.amount) || 0), 0));
      return {
        row: lines[0].__row || null,
        action: existing ? 'updated' : 'created',
        summary: `${cls.name} · ${term.label} — ${lines.length} item${lines.length === 1 ? '' : 's'}, GHS ${total.toFixed(2)}`,
      };
    });
  }

  return rows.map(row => {
    const existing = findExisting(db, sheetName, row, ctx);
    const created = !existing && def.onExisting !== ON_EXISTING.REPLACE;
    return { row: row.__row || null, action: created ? 'created' : 'updated',
             summary: describe(sheetName, row) };
  });
}

// During a dry run nothing is written, so the lookups have to be told what
// WOULD exist — otherwise the Students sheet reports four hundred missing
// classes that the Classes sheet two tabs earlier would have created.
function projectContext(ctx, sheetName, rows) {
  const t = IMPORT_SHEETS[sheetName].target;
  let fake = -1;
  for (const row of rows) {
    if (t === 'class' && !ctx.classes.has(norm(row.name))) {
      ctx.classes.set(norm(row.name), { id: fake--, name: row.name });
    } else if (t === 'subject' && !ctx.subjects.has(norm(row.name))) {
      ctx.subjects.set(norm(row.name), { id: fake--, name: row.name });
    } else if (t === 'academic_year' && !ctx.years.has(norm(row.label))) {
      ctx.years.set(norm(row.label), { id: fake--, label: row.label });
    } else if (t === 'term') {
      for (const k of [norm(`${row.label} ${row.year_label}`), norm(row.label)]) {
        if (!ctx.terms.has(k)) ctx.terms.set(k, { id: fake--, label: row.label });
      }
    } else if (t === 'student' && row.index_number && !ctx.students.has(norm(row.index_number))) {
      ctx.students.set(norm(row.index_number), { id: fake--, index_number: row.index_number });
    }
  }
}

function describe(sheetName, row) {
  switch (IMPORT_SHEETS[sheetName].target) {
    case 'settings':   return `${row.setting} → ${row.value}`;
    case 'academic_year': return row.label;
    case 'term':       return `${row.label} ${row.year_label}`;
    case 'class':      return row.name;
    case 'subject':    return row.name;
    case 'class_subject': return `${row.class_name}: ${row.subjects.length} subjects`;
    case 'grading':    return `${row.min_score}–${row.max_score} ${row.remark}`;
    case 'staff':
    case 'student':    return `${row.surname} ${row.first_name}`;
    case 'parent':     return `${row.full_name} (${row.phone})`;
    case 'fee_item':   return `${row.class_name} · ${row.item_name} — ${row.amount}`;
    case 'opening_balance': return `${row.index_number} — ${row.amount_owing}`;
    default: return '';
  }
}

// ── Reading the file ───────────────────────────────────────────────────
// The only part of this module that knows what Excel is. It turns a workbook
// into the plain rows `importRows` takes, and does three things while it is
// there: it finds each column by its HEADER rather than its position, so a
// school that inserted a column still imports; it drops the worked EXAMPLE rows
// the template ships with; and it drops rows that are entirely blank, which is
// most of what lies below the data in a sheet somebody has scrolled through.
const EXAMPLE_MARK = 'EXAMPLE';

function readSheet(ws, sheetName) {
  const def = IMPORT_SHEETS[sheetName];
  if (!def || !ws) return [];

  const headerRow = ws.getRow(S.HEADER_ROWS);
  const colFor = {};
  const width = Math.max(ws.columnCount || 0, def.columns.length + 4);
  for (let c = 1; c <= width; c++) {
    // The template marks a required column with a trailing asterisk. It is
    // decoration, not part of the name.
    const label = S.cellText(headerRow.getCell(c).value).replace(/\*+\s*$/, '').trim().toLowerCase();
    if (!label) continue;
    const match = def.columns.find(col => col.header.toLowerCase() === label);
    if (match && colFor[match.key] === undefined) colFor[match.key] = c;
  }
  // Not one recognised heading means this is not the sheet its tab claims to
  // be — a school's own file renamed, most likely. Better skipped than
  // half-read.
  if (!Object.keys(colFor).length) return [];

  const out = [];
  const last = ws.rowCount || 0;
  for (let r = S.HEADER_ROWS + 1; r <= last; r++) {
    const row = ws.getRow(r);
    if (isExampleRow(row, def, width)) continue;

    const raw = {};
    for (const col of def.columns) {
      const c = colFor[col.key];
      raw[col.key] = c === undefined ? (col.list ? [] : null) : S.coerce(col, row.getCell(c).value);
    }
    const hasData = def.columns.some(col => {
      const v = raw[col.key];
      return v != null && v !== '' && !(Array.isArray(v) && !v.length);
    });
    if (!hasData) continue;

    out.push({ __row: r, ...raw });
  }
  return out;
}

function isExampleRow(row, def, width) {
  for (let c = 1; c <= width + 2; c++) {
    if (S.cellText(row.getCell(c).value).trim().toUpperCase() === EXAMPLE_MARK) return true;
  }
  return false;
}

/**
 * Read a workbook and import it. `dryRun` previews without writing.
 * Everything the import actually does lives in `importRows`; this only turns
 * the file into rows.
 */
async function importWorkbook(db, filePath, options = {}) {
  let wb;
  try {
    const Excel = require('exceljs');
    wb = new Excel.Workbook();
    await wb.xlsx.readFile(filePath);
  } catch (e) {
    return { ok: false, error: `That file could not be opened as an Excel workbook: ${(e && e.message) || e}` };
  }

  const sheets = {};
  const missing = [];
  for (const name of SHEET_ORDER) {
    const ws = wb.getWorksheet(name);
    if (!ws) { missing.push(name); continue; }
    sheets[name] = readSheet(ws, name);
  }

  if (missing.length === SHEET_ORDER.length) {
    return { ok: false, error:
      'None of the onboarding tabs were found in that file. Export a fresh ' +
      'onboarding workbook, copy the school\'s data into it, and import that.' };
  }

  const report = importRows(db, sheets, {
    ...options,
    file: String(filePath).split(/[\\/]/).pop(),
  });
  // A missing tab is not an error — a school with no parent accounts to bring
  // across simply deleted that one — but the report says so rather than
  // silently reporting nothing found.
  report.missing_sheets = missing;
  return report;
}

module.exports = {
  importRows, importWorkbook, readSheet, buildContext, validateRow, validateSheet,
  applyRow, captureHandlers, autoShortCode, OPENING_BALANCE_LABEL, EXAMPLE_MARK,
};
