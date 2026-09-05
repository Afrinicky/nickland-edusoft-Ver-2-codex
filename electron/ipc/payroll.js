// Nickland Edusoft — Payroll IPC (payslips, SSNIT, PAYE, YTD, bulk processing)
// Copyright © 2026 Nickland Sales. All rights reserved.

// Ghana PAYE tax bands for 2024+ (cumulative monthly thresholds in GHS)
// Source: Ghana Revenue Authority Income Tax Act 896 + amendments
const PAYE_BANDS = [
  { upTo: 490,     rate: 0.00 },     // First 490 GHS — tax-free
  { upTo: 600,     rate: 0.05 },     // Next 110 — 5%
  { upTo: 730,     rate: 0.10 },     // Next 130 — 10%
  { upTo: 3896.67, rate: 0.175 },    // Next 3,166.67 — 17.5%
  { upTo: 19896.67,rate: 0.25 },     // Next 16,000 — 25%
  { upTo: 50416.67,rate: 0.30 },     // Next 30,520 — 30%
  { upTo: Infinity,rate: 0.35 },     // Above — 35%
];

function calculatePAYE(taxableIncome) {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  let remaining = taxableIncome;
  let lower = 0;
  for (const band of PAYE_BANDS) {
    const bandWidth = band.upTo - lower;
    const taxableInBand = Math.min(remaining, bandWidth);
    if (taxableInBand <= 0) break;
    tax += taxableInBand * band.rate;
    remaining -= taxableInBand;
    lower = band.upTo;
    if (remaining <= 0) break;
  }
  return Math.round(tax * 100) / 100;
}

function getSSNITRates(db) {
  const ssnitOn = db.prepare("SELECT value FROM settings WHERE key = 'feature_ssnit_enabled'").get()?.value !== 'false';
  if (!ssnitOn) return { worker: 0, employer: 0, disabled: true };
  const w = db.prepare("SELECT value FROM settings WHERE key = 'ssnit_worker_pct'").get();
  const e = db.prepare("SELECT value FROM settings WHERE key = 'ssnit_employer_pct'").get();
  return {
    worker: parseFloat(w?.value || '5.5') / 100,
    employer: parseFloat(e?.value || '13.0') / 100,
    disabled: false,
  };
}

function isPAYEEnabled(db) {
  return db.prepare("SELECT value FROM settings WHERE key = 'feature_paye_enabled'").get()?.value !== 'false';
}

// ── The month, worked out ───────────────────────────────────────────────────
//
// These three were written inside the IPC closure, which meant only the
// installed application could reach them: `POST /payroll/run` answered 501 and
// the browser's Payroll module showed "Running payroll is done on the school's
// own system" to an office that WAS on the school's own system. A school with
// one office PC and a laptop could run the month on one of them and not the
// other, for no reason a bursar could see.
//
// They are module-level functions now, and both callers use them — the IPC
// handler below and electron/server/office_api.js — so a run started in a
// browser and one started at the office PC compute the same figures from the
// same rates and write the same rows.
//
// None of them checks a permission. That is deliberate: the IPC handler checks
// the desktop session and the HTTP route checks the bearer token's module, and
// a function that also checked would be checking the wrong thing for one of
// them. Authorisation belongs to the caller; arithmetic belongs here.

/** One person's month, from their base salary and the school's rates. */
function computeSalary(db, staffRow, { month, year, rates, payeOn }) {
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prev = db.prepare(
    'SELECT carry_over_to_next FROM staff_salaries WHERE staff_id = ? AND month = ? AND year = ?'
  ).get(staffRow.id, prevMonth, prevYear);
  const arrear = (prev && prev.carry_over_to_next) || 0;

  const gross = staffRow.base_salary;
  const ssnitWorker = staffRow.ssnit_enrolled ? Math.round(gross * rates.worker * 100) / 100 : 0;
  const ssnitEmployer = staffRow.ssnit_enrolled ? Math.round(gross * rates.employer * 100) / 100 : 0;
  const taxable = Math.max(0, gross - ssnitWorker);
  const paye = payeOn ? calculatePAYE(taxable) : 0;
  const net = Math.round((gross - ssnitWorker - paye) * 100) / 100;
  return { gross, ssnitWorker, ssnitEmployer, paye, net, arrear };
}

/** Everybody on the payroll for a month, worked out but not written. */
function bulkPreview(db, { month, year }) {
  const payeOn = isPAYEEnabled(db);
  const rates = getSSNITRates(db);
  const staff = db.prepare(`
    SELECT s.id, s.staff_number, s.surname, s.first_name, s.role,
           s.base_salary, s.ssnit_enrolled
    FROM staff s
    WHERE s.status = 'Active' AND s.base_salary > 0
    ORDER BY s.surname, s.first_name
  `).all();

  const previews = [];
  let totalGross = 0, totalSSNITWorker = 0, totalSSNITEmployer = 0, totalPAYE = 0, totalNet = 0;

  for (const s of staff) {
    const c = computeSalary(db, s, { month, year, rates, payeOn });
    const existing = db.prepare(
      'SELECT * FROM staff_salaries WHERE staff_id = ? AND month = ? AND year = ?'
    ).get(s.id, month, year);

    previews.push({
      staff_id: s.id, staff_number: s.staff_number,
      surname: s.surname, first_name: s.first_name, role: s.role,
      gross_salary: c.gross,
      ssnit_worker: c.ssnitWorker, ssnit_employer: c.ssnitEmployer,
      paye_tax: c.paye, net_salary: c.net,
      arrear_brought_forward: c.arrear,
      existing_id: (existing && existing.id) || null,
      is_paid: (existing && existing.is_paid) || 0,
    });

    totalGross += c.gross;
    totalSSNITWorker += c.ssnitWorker;
    totalSSNITEmployer += c.ssnitEmployer;
    totalPAYE += c.paye;
    totalNet += c.net;
  }

  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    month, year, previews,
    totals: {
      staff_count: staff.length,
      total_gross: r2(totalGross),
      total_ssnit_worker: r2(totalSSNITWorker),
      total_ssnit_employer: r2(totalSSNITEmployer),
      total_ssnit_combined: r2(totalSSNITWorker + totalSSNITEmployer),
      total_paye: r2(totalPAYE),
      total_net: r2(totalNet),
      total_employer_cost: r2(totalGross + totalSSNITEmployer),
    },
  };
}

/**
 * Write the month.
 *
 * Idempotent by construction: a salary row already there is UPDATED rather
 * than inserted again, so running the month twice does not pay anybody twice.
 * `payment_date` is only filled in where it was empty — a row already marked
 * paid keeps the date it was actually paid on.
 *
 * Staff with no base salary are not on the run at all, which is why the answer
 * carries `skipped`: "0 created, 0 updated" on a school with five teachers is
 * a screen nobody can act on, and "5 have no salary set" is.
 */
function bulkRun(db, { month, year, paymentDate }) {
  const payeOn = isPAYEEnabled(db);
  const rates = getSSNITRates(db);
  const staff = db.prepare(`
    SELECT id, base_salary, ssnit_enrolled FROM staff
    WHERE status = 'Active' AND base_salary > 0
  `).all();
  const withoutSalary = db.prepare(`
    SELECT COUNT(*) AS c FROM staff
    WHERE status = 'Active' AND COALESCE(base_salary, 0) <= 0
  `).get().c;

  let created = 0, updated = 0;
  const tx = db.transaction(() => {
    for (const s of staff) {
      const c = computeSalary(db, s, { month, year, rates, payeOn });
      const existing = db.prepare(
        'SELECT id FROM staff_salaries WHERE staff_id = ? AND month = ? AND year = ?'
      ).get(s.id, month, year);

      if (existing) {
        db.prepare(`
          UPDATE staff_salaries SET
            gross_salary = ?, arrear_brought_forward = ?,
            ssnit_worker = ?, ssnit_employer = ?, paye_tax = ?,
            net_salary = ?, payment_date = COALESCE(payment_date, ?)
          WHERE id = ?
        `).run(c.gross, c.arrear, c.ssnitWorker, c.ssnitEmployer, c.paye, c.net,
               paymentDate, existing.id);
        updated += 1;
      } else {
        db.prepare(`
          INSERT INTO staff_salaries
            (staff_id, month, year, gross_salary, arrear_brought_forward,
             ssnit_worker, ssnit_employer, paye_tax, net_salary, payment_date, is_paid)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `).run(s.id, month, year, c.gross, c.arrear, c.ssnitWorker, c.ssnitEmployer,
               c.paye, c.net, paymentDate);
        created += 1;
      }
    }
  });
  tx();
  return { ok: true, created, updated, skipped: withoutSalary, month, year };
}

/**
 * Record what actually left the account.
 *
 * The difference between what was due and what was handed over carries into
 * next month rather than being forgiven silently — that is what
 * `carry_over_to_next` is, and it is why a part payment is a legitimate thing
 * to record rather than an error.
 */
function markPaid(db, { id, actualAmount, paymentMethod, paymentReference, paymentDate, paidBy }) {
  const { postExpense, nextCounter } = require('./_ledger');
  const salary = db.prepare('SELECT * FROM staff_salaries WHERE id = ?').get(id);
  if (!salary) return { ok: false, error: 'Salary not found' };

  const expected = salary.net_salary + (salary.arrear_brought_forward || 0);
  const actual = parseFloat(actualAmount) || 0;
  // A salary cannot be "paid" for nothing: that state reports the staff member
  // as settled while the ledger records no money leaving the school, which is
  // exactly the mismatch the Finance audit flags.
  if (!(actual > 0)) {
    return { ok: false, error: 'Enter the amount actually paid. To record an unpaid salary, leave it pending.' };
  }
  const carryOver = expected - actual;
  const when = paymentDate || new Date().toISOString().slice(0, 10);

  db.prepare(`
    UPDATE staff_salaries SET
      actual_amount_paid = ?, carry_over_to_next = ?,
      payment_date = ?, payment_method = ?, payment_reference = ?,
      is_paid = 1
    WHERE id = ?
  `).run(actual, Math.max(0, carryOver), when, paymentMethod || 'Bank', paymentReference || null, id);

  // Auto-record expense via the central ledger helper (idempotent on
  // linked_salary_id, so this can never double-post even if the legacy
  // staff:save-salary path also ran).
  try {
    const staffRow = db.prepare('SELECT surname, first_name FROM staff WHERE id = ?').get(salary.staff_id);
    postExpense(db, {
      transaction_number: nextCounter(db, 'transaction_counter', 'SAL'),
      category: 'salary',
      amount: actual,
      description: `Salary ${salary.month}/${salary.year}`,
      payee_name: `${staffRow.surname} ${staffRow.first_name}`.trim(),
      payment_method: paymentMethod || 'Bank',
      reference: paymentReference || null,
      date: when,
      linked_salary_id: id,
      recorded_by: paidBy || null,
      is_auto: 1,
    });
  } catch (e) {
    try {
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, justification, severity)
        VALUES ('salary', ?, 'auto_record_failed', ?, 'high')
      `).run(id || null, `Salary expense auto-record failed: ${e.message}`);
    } catch (_) {}
  }

  return { ok: true, expected, actual, carry_over: Math.max(0, carryOver) };
}

module.exports = function registerPayrollHandlers(ipcMain, db) {
  const security = require('./_security');
  const { postExpense, nextCounter } = require('./_ledger');


  // ── Calculate (preview) a salary without saving ──────
  ipcMain.handle('payroll:calculate', (_e, data) => {
    const gross = parseFloat(data.gross_salary) || 0;
    const extra = parseFloat(data.extra_pay) || 0;
    const arrear = parseFloat(data.arrear_brought_forward) || 0;
    const otherDed = parseFloat(data.other_deductions) || 0;

    const rates = getSSNITRates(db);
    const grossIncome = gross + extra;
    const ssnitWorker = data.ssnit_enrolled ? Math.round(grossIncome * rates.worker * 100) / 100 : 0;
    const ssnitEmployer = data.ssnit_enrolled ? Math.round(grossIncome * rates.employer * 100) / 100 : 0;

    // Taxable income: gross + extras - SSNIT worker (per GRA rules)
    const taxable = Math.max(0, grossIncome - ssnitWorker);
    const paye = isPAYEEnabled(db) ? calculatePAYE(taxable) : 0;

    const totalDeductions = ssnitWorker + paye + otherDed;
    const net = grossIncome - totalDeductions;
    const expectedNet = net + arrear;

    return {
      gross_salary: gross,
      extra_pay: extra,
      gross_income: grossIncome,
      arrear_brought_forward: arrear,
      ssnit_worker: ssnitWorker,
      ssnit_employer: ssnitEmployer,
      paye_tax: paye,
      other_deductions: otherDed,
      total_deductions: Math.round(totalDeductions * 100) / 100,
      net_salary: Math.round(net * 100) / 100,
      expected_amount: Math.round(expectedNet * 100) / 100,
    };
  });

  // ── What payroll actually paid out in a term ──────────
  //
  // The Finance audit needs a like-for-like counterpart to the salary expenses
  // in the ledger. Comparing against bulk-preview was wrong twice over: it
  // recomputes each net from the staff member's CURRENT base salary rather than
  // reading what was actually paid, and it covers a calendar MONTH while the
  // expense side is scoped to a TERM. Both differences show up as a permanent
  // "salary expenses may not match payroll" finding on a perfectly healthy
  // school. This sums the real amounts paid, attributing each salary to a term
  // exactly the way the ledger does.
  ipcMain.handle('payroll:paid-summary', (_e, { termId } = {}) => paidSummaryForTerm(db, termId));

  // ── Bulk preview (calculate all active staff for a month) ──
  ipcMain.handle('payroll:bulk-preview', (_e, { month, year }) => bulkPreview(db, { month, year }));

  // ── Bulk run (commit all calculated salaries for a month) ──
  ipcMain.handle('payroll:bulk-run', (_e, { month, year, paymentDate }) => {
    if (!security.checkPermission(db, 'payroll', 'edit')) {
      return { ok: false, error: 'Access denied. You do not have permission to run payroll.' };
    }
    return bulkRun(db, { month, year, paymentDate });
  });

  // ── Mark salary as paid ──────────────────────────────
  ipcMain.handle('payroll:mark-paid', (_e, args) => {
    if (!security.checkPermission(db, 'payroll', 'edit')) {
      return { ok: false, error: 'Access denied. You do not have permission to mark salaries paid.' };
    }
    return markPaid(db, args);
  });

  // ── Year-to-date summary for a staff member ──────────
  ipcMain.handle('payroll:ytd-summary', (_e, { staffId, year }) => {
    const rows = db.prepare(`
      SELECT month, gross_salary, ssnit_worker, ssnit_employer, paye_tax,
             other_deductions, net_salary, actual_amount_paid, is_paid
      FROM staff_salaries
      WHERE staff_id = ? AND year = ?
      ORDER BY month
    `).all(staffId, year);

    const totals = rows.reduce((acc, r) => ({
      gross: acc.gross + (r.gross_salary || 0),
      ssnit_worker: acc.ssnit_worker + (r.ssnit_worker || 0),
      ssnit_employer: acc.ssnit_employer + (r.ssnit_employer || 0),
      paye: acc.paye + (r.paye_tax || 0),
      other_ded: acc.other_ded + (r.other_deductions || 0),
      net: acc.net + (r.net_salary || 0),
      actual: acc.actual + (r.actual_amount_paid || 0),
      paid_months: acc.paid_months + (r.is_paid ? 1 : 0),
    }), { gross: 0, ssnit_worker: 0, ssnit_employer: 0, paye: 0, other_ded: 0, net: 0, actual: 0, paid_months: 0 });

    return { staff_id: staffId, year, months: rows, totals };
  });

  // ── SSNIT schedule (for a month — list every contributor) ──
  // Format aligned with SSNIT contribution schedule form (Tier 1: employer 13% + worker 5.5%)
  ipcMain.handle('payroll:ssnit-schedule', (_e, { month, year }) => {
    const rows = db.prepare(`
      SELECT s.staff_number, s.ssnit_number,
             s.surname, s.first_name, s.other_names, s.gender, s.date_of_birth,
             ss.gross_salary, ss.ssnit_worker, ss.ssnit_employer
      FROM staff_salaries ss
      JOIN staff s ON s.id = ss.staff_id
      WHERE ss.month = ? AND ss.year = ? AND s.ssnit_enrolled = 1
      ORDER BY s.surname, s.first_name
    `).all(month, year);

    const totals = rows.reduce((acc, r) => ({
      gross: acc.gross + (r.gross_salary || 0),
      worker: acc.worker + (r.ssnit_worker || 0),
      employer: acc.employer + (r.ssnit_employer || 0),
    }), { gross: 0, worker: 0, employer: 0 });

    return {
      month, year,
      rows,
      totals: {
        gross: Math.round(totals.gross * 100) / 100,
        worker: Math.round(totals.worker * 100) / 100,
        employer: Math.round(totals.employer * 100) / 100,
        combined: Math.round((totals.worker + totals.employer) * 100) / 100,
      },
    };
  });

  // ── PAYE remittance schedule (for a month — for GRA filing) ──
  // Format aligned with GRA monthly P.A.Y.E. tax return
  ipcMain.handle('payroll:paye-schedule', (_e, { month, year }) => {
    const rows = db.prepare(`
      SELECT s.staff_number,
             s.surname, s.first_name, s.other_names,
             ss.gross_salary, ss.ssnit_worker,
             (ss.gross_salary - COALESCE(ss.ssnit_worker, 0)) AS taxable_income,
             ss.paye_tax
      FROM staff_salaries ss
      JOIN staff s ON s.id = ss.staff_id
      WHERE ss.month = ? AND ss.year = ?
      ORDER BY s.surname, s.first_name
    `).all(month, year);

    const totals = rows.reduce((acc, r) => ({
      gross: acc.gross + (r.gross_salary || 0),
      ssnit: acc.ssnit + (r.ssnit_worker || 0),
      taxable: acc.taxable + (r.taxable_income || 0),
      paye: acc.paye + (r.paye_tax || 0),
    }), { gross: 0, ssnit: 0, taxable: 0, paye: 0 });

    return {
      month, year,
      rows,
      totals: {
        gross: Math.round(totals.gross * 100) / 100,
        ssnit: Math.round(totals.ssnit * 100) / 100,
        taxable: Math.round(totals.taxable * 100) / 100,
        paye: Math.round(totals.paye * 100) / 100,
      },
      band_thresholds: PAYE_BANDS,
    };
  });

  // ── Get full payslip data (for display + print) ──────
  ipcMain.handle('payroll:payslip-data', (_e, salaryId) => {
    const salary = db.prepare(`
      SELECT ss.*,
             s.surname, s.first_name, s.other_names, s.staff_number,
             s.role, s.ssnit_number, s.bank_account, s.bank_name,
             s.designation_id, d.name AS designation_name
      FROM staff_salaries ss
      JOIN staff s ON s.id = ss.staff_id
      LEFT JOIN designations d ON d.id = s.designation_id
      WHERE ss.id = ?
    `).get(salaryId);
    if (!salary) return null;

    // School identity from settings
    const settings = db.prepare("SELECT key, value FROM settings WHERE category = 'school' OR category = 'branding'").all();
    const sch = {};
    for (const s of settings) sch[s.key] = s.value;

    return {
      salary,
      school: {
        name: sch.school_name || 'School',
        motto: sch.school_motto || '',
        address: sch.school_address || '',
        phone: sch.school_phone_1 || '',
        email: sch.school_email || '',
        logo: sch.school_logo_path || null,
      },
    };
  });
};

// Sum what payroll actually paid out, attributed to a term the same way the
// finance ledger attributes the matching salary expense (the term whose window
// contains the payment date, else the current term). Exported so the audit and
// any report compare the same money on both sides.
function paidSummaryForTerm(db, termId) {
  const { resolveTermForDate } = require('./_ledger');
  let target = termId;
  if (!target) target = db.prepare('SELECT id FROM terms WHERE is_current = 1').get()?.id || null;
  const rows = db.prepare(`
    SELECT id, actual_amount_paid, net_salary, arrear_brought_forward, payment_date
    FROM staff_salaries WHERE is_paid = 1
  `).all();
  let total = 0, count = 0, unrecorded = 0;
  for (const r of rows) {
    const term = resolveTermForDate(db, r.payment_date || null);
    if (!term || term.id !== target) continue;
    const amount = Number(r.actual_amount_paid) || 0;
    // A salary flagged paid with no amount recorded is the state that hides
    // money from Finance; report it so the audit can surface it even if the
    // startup repair has not run yet.
    if (amount <= 0) { unrecorded++; continue; }
    total += amount;
    count++;
  }
  return { term_id: target, total: Math.round(total * 100) / 100, count, unrecorded };
}

module.exports.paidSummaryForTerm = paidSummaryForTerm;
// What the browser needs too. See the note above `computeSalary`: one
// calculation, two callers, so the month is the same month whichever machine
// the office ran it from.
module.exports.bulkPreview = bulkPreview;
module.exports.bulkRun = bulkRun;
module.exports.markPaid = markPaid;
module.exports.calculatePAYE = calculatePAYE;
module.exports.getSSNITRates = getSSNITRates;
module.exports.isPAYEEnabled = isPAYEEnabled;
