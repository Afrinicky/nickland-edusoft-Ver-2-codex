// Nickland Edusoft — the rest of the office, over HTTP.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The desktop host already served the teaching day, the fee collections and the
// two portals' summaries. It did not serve the parts of the office that lived
// behind IPC handlers on the machine itself: billing, discounts, book charges,
// the store room, the buses, payroll's statutory schedules, the notification
// log, staff activities, budgets and the cashbook.
//
// That was invisible while the browser app was four small portals. It is not
// invisible now: the browser app IS the desktop application, and a school using
// it on its own Wi-Fi would find half of it answering 404.
//
// ── What this is, and what it is not ────────────────────────────────────────
//
// It is the same operations the online school performs
// (cloud-python/app/school/*.py), against SQLite instead of Postgres, so the
// two answer the same shapes. Where the online school already had a module, its
// SQL is the reference and this is a translation of it — the pair are meant to
// be read side by side.
//
// It is NOT a generic bridge to the IPC layer. Every route names its module and
// its action and is refused by the same `can()` the rest of the API uses. A
// route that lets a browser reach an arbitrary IPC channel would be a hole in
// the middle of the access system, however convenient.

module.exports = function registerOfficeRoutes({ add, db, json, can, API, getSetting, audit }) {
  const todayISO = () => new Date().toISOString().slice(0, 10);

  // ── helpers ───────────────────────────────────────────────────────────────

  const bad = (res, msg) => json(res, 400, { ok: false, error: msg });
  const deny = (res, msg) => json(res, 403, { ok: false, error: msg || 'Access denied.' });
  const missing = (res, msg) => json(res, 404, { ok: false, error: msg || 'Not found.' });

  /** Staff only, with the module and action this route needs. */
  const gate = (ctx, res, module, action = 'view') => {
    if (!ctx || ctx.role !== 'staff') { deny(res, 'Staff only.'); return false; }
    if (!can(ctx, module, action)) { deny(res); return false; }
    return true;
  };

  const num = (v) => (v == null || v === '' ? 0 : Math.round(Number(v) * 100) / 100);
  const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
  const currentTerm = () => db.prepare('SELECT * FROM terms WHERE is_current = 1').get() || null;
  /** The year a new record belongs to: the running one, else the latest opened. */
  const currentYearId = () => {
    const row = db.prepare(`
      SELECT id FROM academic_years
      ORDER BY COALESCE(is_current, 0) DESC, start_date DESC, id DESC LIMIT 1`).get();
    return row ? row.id : null;
  };

  /** Any one of these, at view, is enough to need the school's own lists. */
  const anyOf = (ctx, modules) => modules.some(m => can(ctx, m, 'view'));

  // ══ The lists the whole office picks from ══════════════════════════════════
  //
  // Every screen in the office starts by naming a class or a pupil: raise this
  // class's bills, take this pupil's payment, work down this class on the bulk
  // pay sheet, chase this class's canteen arrears.
  //
  // ── The fault these routes fix ─────────────────────────────────────────────
  //
  // They used to name them through `/classes` and `/students`, which are the
  // TEACHING lists: both are filtered to the caller's own staff_assignments,
  // because a subject teacher who takes one lesson in Basic 6 has no business
  // marking its register. That is right for teaching and wrong for the office.
  // An accountant has no teaching assignments at all, so every class picker in
  // the browser read "Nothing to choose from" and every pupil search came back
  // empty — the bulk pay sheet, the payment sheet, billing, the canteen sheet.
  // The installed application has no such filter on those screens, so the same
  // person could do the work at the office PC and not on the laptop beside it.
  //
  // So: two lists, unfiltered by teaching, gated on the modules that actually
  // need to name somebody. `/classes` and `/students` are unchanged and still
  // mean "the ones that are yours".
  //
  // The pupil list carries what a receipt carries — name, admission number,
  // class — and nothing else. Naming a child you are about to take money from
  // is not reading their record; the record stays behind `students`.
  const OFFICE_MODULES = ['students', 'fees', 'canteen', 'finance', 'academics', 'staff', 'payroll'];

  add('GET', `${API}/office/classes`, async (ctx, req, res) => {
    if (!ctx || ctx.role !== 'staff') return deny(res, 'Staff only.');
    if (!anyOf(ctx, OFFICE_MODULES)) return deny(res);
    const classes = db.prepare(`
      SELECT id, name, short_code, level_category, level_order,
             (SELECT COUNT(*) FROM students s
               WHERE s.current_class_id = class_groups.id AND s.status = 'Active') AS pupils
      FROM class_groups
      WHERE COALESCE(is_active, 1) = 1
      ORDER BY level_order, name
    `).all();
    return json(res, 200, { ok: true, classes });
  });

  add('GET', `${API}/office/students`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!ctx || ctx.role !== 'staff') return deny(res, 'Staff only.');
    if (!anyOf(ctx, ['students', 'fees', 'canteen', 'finance'])) return deny(res);

    const status = ['Active', 'Inactive', 'Withdrawn', 'Graduated', 'Suspended'].includes(query.status)
      ? query.status : 'Active';
    const p = [status];
    let sql = `
      SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names, s.gender,
             s.current_class_id, c.name AS class_name, c.short_code AS class_code
      FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE s.status = ?`;
    if (query.classId) { sql += ' AND s.current_class_id = ?'; p.push(int(query.classId)); }
    if (query.q) {
      sql += ` AND (s.surname LIKE ? OR s.first_name LIKE ? OR s.other_names LIKE ?
                    OR s.index_number LIKE ?)`;
      const like = `%${String(query.q).slice(0, 60)}%`;
      p.push(like, like, like, like);
    }
    sql += ' ORDER BY s.surname, s.first_name LIMIT 500';
    return json(res, 200, {
      ok: true, status,
      students: db.prepare(sql).all(...p).map(r => ({
        ...r, name: `${r.surname || ''} ${r.first_name || ''}`.trim(),
      })),
    });
  });

  // The staff room, for the same reason: payroll and the activities board both
  // start by naming somebody, and a payroll clerk holds `payroll`, not `staff`.
  add('GET', `${API}/office/staff`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!ctx || ctx.role !== 'staff') return deny(res, 'Staff only.');
    if (!anyOf(ctx, ['staff', 'payroll'])) return deny(res);
    const status = ['Active', 'Inactive', 'Resigned', 'Retired'].includes(query.status)
      ? query.status : 'Active';
    return json(res, 200, {
      ok: true, status,
      staff: db.prepare(`
        SELECT id, staff_number, surname, first_name, role, status, phone
        FROM staff WHERE status = ? ORDER BY surname, first_name
      `).all(status).map(r => ({ ...r, name: `${r.surname || ''} ${r.first_name || ''}`.trim() })),
    });
  });

  // ══ Staff training, and a year's pay ═══════════════════════════════════════
  //
  // Two small things the installed application could do and the browser could
  // not. Neither is complicated; both were simply never given a route, which
  // is how a capability gap usually looks from the inside.

  add('GET', `${API}/staff/:id/training`, async (ctx, req, res, params) => {
    if (!ctx || ctx.role !== 'staff') return deny(res, 'Staff only.');
    const id = int(params.id);
    // Your own training record is yours to read. Anybody else's is the staff
    // module — a courses list is part of somebody's employment file.
    const own = ctx.user && ctx.user.staff_id && Number(ctx.user.staff_id) === id;
    if (!own && !can(ctx, 'staff', 'view')) return deny(res);
    return json(res, 200, {
      ok: true,
      training: db.prepare(`
        SELECT id, title, provider, start_date, end_date, notes
        FROM staff_training WHERE staff_id = ? ORDER BY start_date DESC, id DESC
      `).all(id),
      may_edit: can(ctx, 'staff', 'edit'),
    });
  });

  add('POST', `${API}/staff/:id/training`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'staff', 'edit')) return undefined;
    const id = int(params.id);
    if (!db.prepare('SELECT id FROM staff WHERE id = ?').get(id)) {
      return missing(res, 'No such member of staff.');
    }
    const title = String(body.title || '').trim();
    if (!title) return bad(res, 'What was the course called?');
    const vals = [title, String(body.provider || '').trim() || null,
                  body.startDate || null, body.endDate || null,
                  String(body.notes || '').trim() || null];

    if (body.id) {
      db.prepare(`UPDATE staff_training SET title = ?, provider = ?, start_date = ?,
                    end_date = ?, notes = ? WHERE id = ? AND staff_id = ?`)
        .run(...vals, int(body.id), id);
      audit(db, ctx, 'staff_training', int(body.id), 'save_training', title, 'normal');
      return json(res, 200, { ok: true, id: int(body.id) });
    }
    const r = db.prepare(`INSERT INTO staff_training
        (staff_id, title, provider, start_date, end_date, notes)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, ...vals);
    audit(db, ctx, 'staff_training', r.lastInsertRowid, 'save_training', title, 'normal');
    return json(res, 200, { ok: true, id: r.lastInsertRowid });
  });

  add('DELETE', `${API}/staff/training/:trainingId`, async (ctx, req, res, params) => {
    if (!gate(ctx, res, 'staff', 'edit')) return undefined;
    const id = int(params.trainingId);
    const row = db.prepare('SELECT * FROM staff_training WHERE id = ?').get(id);
    if (!row) return missing(res, 'No such training record.');
    db.prepare('DELETE FROM staff_training WHERE id = ?').run(id);
    audit(db, ctx, 'staff_training', id, 'delete_training', row.title || '', 'normal');
    return json(res, 200, { ok: true });
  });

  // A year of pay, month by month — what somebody needs for a loan application
  // or a tax query, and what the desktop has always been able to print.
  add('GET', `${API}/payroll/:staffId/year`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!ctx || ctx.role !== 'staff') return deny(res, 'Staff only.');
    const staffId = int(params.staffId);
    // A person may always read their own year, whatever their modules say —
    // the same rule the payslip route follows.
    const own = ctx.user && ctx.user.staff_id && Number(ctx.user.staff_id) === staffId;
    if (!own && !can(ctx, 'payroll', 'view')) return deny(res);
    const year = int(query.year) || new Date().getFullYear();

    const months = db.prepare(`
      SELECT month, gross_salary, ssnit_worker, ssnit_employer, paye_tax,
             other_deductions, net_salary, actual_amount_paid, is_paid
      FROM staff_salaries WHERE staff_id = ? AND year = ? ORDER BY month
    `).all(staffId, year);
    const sum = (k) => num(months.reduce((n, r) => n + (Number(r[k]) || 0), 0));
    return json(res, 200, {
      ok: true, staff_id: staffId, year, months,
      totals: {
        gross: sum('gross_salary'), ssnit_worker: sum('ssnit_worker'),
        ssnit_employer: sum('ssnit_employer'), paye: sum('paye_tax'),
        other_deductions: sum('other_deductions'), net: sum('net_salary'),
        actual: sum('actual_amount_paid'),
        paid_months: months.filter(m => m.is_paid).length,
      },
    });
  });

  // ══ The school calendar ════════════════════════════════════════════════════
  //
  // Which days are school days. Every canteen figure in the system rests on
  // it: what a pupil owes is the number of SCHOOL DAYS they have not paid for
  // times the daily rate, so a term with no calendar set up has no arrears at
  // all and a term with the wrong one has the wrong arrears.
  //
  // It was reachable only from the installed application, which meant a school
  // could read the consequences of the calendar in the browser and not set it
  // — the Canteen module's Calendar tab could edit the rate and nothing else.

  add('GET', `${API}/calendar`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!ctx || ctx.role !== 'staff') return deny(res, 'Staff only.');
    if (!can(ctx, 'canteen', 'view') && !can(ctx, 'settings', 'view')) return deny(res);
    const termId = query.termId ? int(query.termId) : (currentTerm() || {}).id || null;
    const days = termId
      ? db.prepare('SELECT * FROM school_calendar WHERE term_id = ? ORDER BY date').all(termId)
      : db.prepare('SELECT * FROM school_calendar ORDER BY date LIMIT 500').all();
    const counts = days.reduce((a, d) => {
      a[d.day_type] = (a[d.day_type] || 0) + 1; return a;
    }, {});
    return json(res, 200, {
      ok: true, term_id: termId, days, counts,
      school_days: counts.school_day || 0,
      may_edit: can(ctx, 'canteen', 'edit') || can(ctx, 'settings', 'edit'),
    });
  });

  // One day, changed. A public holiday declared on Tuesday afternoon is the
  // ordinary case, and it must not cost anybody the whole term's calendar.
  add('POST', `${API}/calendar/day`, async (ctx, req, res, params, body) => {
    if (!ctx || ctx.role !== 'staff') return deny(res, 'Staff only.');
    if (!can(ctx, 'canteen', 'edit') && !can(ctx, 'settings', 'edit')) return deny(res);
    const date = String(body.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad(res, 'Which day? Use YYYY-MM-DD.');
    const dayType = ['school_day', 'holiday', 'weekend', 'vacation'].includes(body.dayType)
      ? body.dayType : 'school_day';
    const termId = body.termId ? int(body.termId) : (currentTerm() || {}).id || null;
    const label = String(body.label || '').slice(0, 120);

    const existing = db.prepare('SELECT id FROM school_calendar WHERE date = ?').get(date);
    if (existing) {
      db.prepare('UPDATE school_calendar SET day_type = ?, label = ?, term_id = ? WHERE date = ?')
        .run(dayType, label, termId, date);
    } else {
      db.prepare('INSERT INTO school_calendar (date, day_type, label, term_id) VALUES (?, ?, ?, ?)')
        .run(date, dayType, label, termId);
    }
    audit(db, ctx, 'school_calendar', null, 'set_calendar_day', `${date} → ${dayType}`, 'normal');
    return json(res, 200, { ok: true, date, day_type: dayType, label });
  });

  // The whole term at once: weekdays are school days, weekends are not, and
  // the holidays the office names are taken out. The desktop's own generator,
  // so a term set up in a browser and one set up at the office PC produce the
  // same calendar and therefore the same arrears.
  add('POST', `${API}/calendar/term`, async (ctx, req, res, params, body) => {
    if (!ctx || ctx.role !== 'staff') return deny(res, 'Staff only.');
    if (!can(ctx, 'canteen', 'edit') && !can(ctx, 'settings', 'edit')) return deny(res);
    const term = body.termId ? db.prepare('SELECT * FROM terms WHERE id = ?').get(int(body.termId))
                             : currentTerm();
    if (!term) return bad(res, 'No term is running, so there is nothing to lay out.');
    const startDate = String(body.startDate || term.start_date || '').slice(0, 10);
    const endDate = String(body.endDate || term.end_date || '').slice(0, 10);
    if (!startDate || !endDate || startDate > endDate) {
      return bad(res, "That term has no dates. Set them in Settings → Terms first.");
    }
    const excludeWeekends = body.excludeWeekends !== false;
    const holidays = Array.isArray(body.holidays) ? body.holidays : [];
    const holidayBy = new Map(holidays
      .filter(h => h && h.date)
      .map(h => [String(h.date).slice(0, 10), String(h.label || 'Holiday').slice(0, 120)]));

    let school = 0, off = 0;
    const tx = db.transaction(() => {
      const ins = db.prepare(`INSERT OR REPLACE INTO school_calendar (date, day_type, label, term_id)
                              VALUES (?, ?, ?, ?)`);
      const end = new Date(`${endDate}T00:00:00Z`);
      for (const d = new Date(`${startDate}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const iso = d.toISOString().slice(0, 10);
        const dow = d.getUTCDay();
        let dayType = 'school_day';
        let label = '';
        if (excludeWeekends && (dow === 0 || dow === 6)) {
          dayType = 'holiday';
          label = dow === 0 ? 'Sunday' : 'Saturday';
        }
        if (holidayBy.has(iso)) { dayType = 'holiday'; label = holidayBy.get(iso); }
        ins.run(iso, dayType, label, term.id);
        if (dayType === 'school_day') school += 1; else off += 1;
      }
    });
    tx();
    audit(db, ctx, 'school_calendar', term.id, 'setup_term_calendar',
      `${term.label}: ${school} school days, ${off} off`, 'high');
    return json(res, 200, { ok: true, term: term.label, school_days: school, off_days: off });
  });

  // ══ Billing ════════════════════════════════════════════════════════════════

  add('GET', `${API}/fees/templates`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'fees')) return undefined;
    // School fees by default. The extra charges a term throws up are a
    // different list on a different screen, and mixing them was how a class
    // ended up billed for the excursion twice.
    const billType = (query && query.billType) === 'supplementary' ? 'supplementary'
      : (query && query.billType) === 'all' ? null : 'school_fees';
    return json(res, 200, {
      ok: true,
      templates: db.prepare(`
        SELECT ft.*, c.name AS class_name, t.label AS term_label,
               (SELECT COALESCE(SUM(amount),0) FROM fee_line_items WHERE fee_template_id = ft.id) AS total,
               (SELECT COUNT(*) FROM fee_line_items WHERE fee_template_id = ft.id) AS items
        FROM fee_templates ft
        LEFT JOIN class_groups c ON c.id = ft.class_group_id
        LEFT JOIN terms t ON t.id = ft.term_id
        WHERE COALESCE(ft.is_active, 1) = 1
          AND (? IS NULL OR COALESCE(ft.bill_type, 'school_fees') = ?)
        ORDER BY c.name, t.label, ft.id
      `).all(billType, billType),
    });
  });

  add('GET', `${API}/fees/templates/:id`, async (ctx, req, res, params) => {
    if (!gate(ctx, res, 'fees')) return undefined;
    const id = int(params.id);
    const template = db.prepare(`
      SELECT ft.*, c.name AS class_name, t.label AS term_label
      FROM fee_templates ft
      LEFT JOIN class_groups c ON c.id = ft.class_group_id
      LEFT JOIN terms t ON t.id = ft.term_id
      WHERE ft.id = ?`).get(id);
    if (!template) return missing(res, 'No such template.');
    template.items = db.prepare(
      'SELECT * FROM fee_line_items WHERE fee_template_id = ? ORDER BY item_number, id').all(id);
    return json(res, 200, { ok: true, template });
  });

  // Creating or amending what a class is charged. A school-fees template that
  // clashes with an existing one for the same class and term is refused rather
  // than silently shadowing it — "there cannot be two school fees in one term"
  // is the school's rule, and a second template that quietly wins is how a
  // class gets billed the wrong amount.
  add('POST', `${API}/fees/templates`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'fees', 'edit')) return undefined;
    const name = String(body.name || '').trim();
    if (!name) return bad(res, 'Give the template a name.');
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return bad(res, 'A bill needs at least one line.');

    const classId = body.class_group_id ? int(body.class_group_id) : null;
    const termId = body.term_id ? int(body.term_id) : null;
    const billType = (body.bill_type || body.billType) === 'supplementary'
      ? 'supplementary' : 'school_fees';
    let id = body.id ? int(body.id) : null;

    if (billType === 'school_fees' && termId) {
      const clash = db.prepare(`
        SELECT ft.id, ft.name FROM fee_templates ft
        WHERE COALESCE(ft.is_active,1) = 1 AND ft.term_id = ?
          AND ((ft.class_group_id IS NULL AND ? IS NULL) OR ft.class_group_id = ?)
          AND (? IS NULL OR ft.id <> ?)
        LIMIT 1`).get(termId, classId, classId, id, id);
      if (clash) return json(res, 409, { ok: false, error: `"${clash.name}" already covers that class and term.` });
    }

    const tx = db.transaction(() => {
      if (id) {
        db.prepare(`UPDATE fee_templates
                       SET name = ?, class_group_id = ?, term_id = ?, bill_type = ?
                     WHERE id = ?`).run(name, classId, termId, billType, id);
        db.prepare('DELETE FROM fee_line_items WHERE fee_template_id = ?').run(id);
      } else {
        const r = db.prepare(`
          INSERT INTO fee_templates (name, class_group_id, term_id, bill_type, is_active)
          VALUES (?, ?, ?, ?, 1)`).run(name, classId, termId, billType);
        id = r.lastInsertRowid;
      }
      let n = 0;
      for (const item of items) {
        n += 1;
        db.prepare(`INSERT INTO fee_line_items (fee_template_id, item_number, description, amount)
                    VALUES (?, ?, ?, ?)`)
          .run(id, n, String(item.description || '').slice(0, 200), num(item.amount));
      }
    });
    tx();
    audit(db, ctx, 'fee_template', id, 'save_fee_template', name);
    return json(res, 200, { ok: true, id });
  });

  /**
   * Raise bills — the operation a term starts with.
   *
   * One pupil or a whole class. A bill that already exists for that pupil and
   * term is left alone rather than replaced: a bill is what a parent has been
   * TOLD they owe, and quietly rewriting one after they have paid against it is
   * how a school ends up arguing with a receipt it issued itself.
   */
  // Raising a class's bills — through the desktop's own generator.
  //
  // This route used to carry its own copy of bill generation, and the copy
  // resolved templates more strictly than the real thing: it matched only
  // `term_id = ?`, so a school whose fee template said "Every class / Any
  // term" — which is what a small school actually sets up — got "no template"
  // for every pupil and could not raise a bill from the browser at all.
  //
  // The copy was also missing everything the desktop's generator does around
  // the edges: book charges carried into Terms 2 and 3, supplementary charges
  // preserved when a bill is regenerated, the refusal to quietly resurrect a
  // bill the school withdrew, and recomputing `total_paid` from the payments
  // table rather than resetting it to zero. Each of those is money.
  //
  // So there is one generator now, in electron/ipc/fees.js, and this calls it.
  add('POST', `${API}/fees/bills`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'fees', 'create')) return undefined;
    const term = body.termId ? db.prepare('SELECT * FROM terms WHERE id = ?').get(int(body.termId))
                             : currentTerm();
    if (!term) return bad(res, 'No term is running, so there is nothing to bill for.');

    const classId = body.classId ? int(body.classId) : null;
    const studentId = body.studentId ? int(body.studentId) : null;
    const scope = String(body.scope || (studentId ? 'student' : classId ? 'class' : 'all'));

    let students;
    if (scope === 'student' || studentId) {
      students = db.prepare("SELECT id FROM students WHERE id = ? AND status = 'Active'").all(studentId);
    } else if (scope === 'class' || classId) {
      students = db.prepare(`SELECT id FROM students WHERE current_class_id = ? AND status = 'Active'
                             ORDER BY surname, first_name`).all(classId);
    } else if (scope === 'owing') {
      students = db.prepare(`
        SELECT DISTINCT s.id FROM students s JOIN student_bills b ON b.student_id = s.id
        WHERE s.status = 'Active' AND b.balance > 0`).all();
    } else {
      students = db.prepare("SELECT id FROM students WHERE status = 'Active' ORDER BY surname, first_name").all();
    }
    if (!students.length) return bad(res, 'There is nobody active to bill.');

    const fees = require('../ipc/fees');
    let generated = 0;
    // Reasons, counted. A school that sees "Generated 0 bills" and nothing
    // else cannot tell a missing template from a withdrawn bill from a pupil
    // with no class, and those are three different jobs.
    const problems = new Map();
    for (const s of students) {
      try { fees.generateBillForStudent(db, s.id, term.id); generated += 1; }
      catch (e) {
        const msg = String((e && e.message) || e);
        problems.set(msg, (problems.get(msg) || 0) + 1);
      }
    }

    const failed = [...problems.entries()].map(([reason, count]) => ({ reason, count }));
    audit(db, ctx, 'student_bill', null, 'raise_bills',
      `${generated} of ${students.length} — ${term.label}`, 'high');
    return json(res, 200, {
      ok: true, generated, skipped: students.length - generated,
      problems: failed, failed, term: term.label,
      // Kept so an older browser build that reads `raised` still shows a
      // figure rather than "undefined bills raised".
      raised: generated,
    });
  });

  /** What a granted discount takes off a bill of `total`. */
  function discountFor(studentId, total) {
    const d = db.prepare(`
      SELECT * FROM student_discounts
      WHERE student_id = ? AND COALESCE(is_active,1) = 1
      ORDER BY id DESC LIMIT 1`).get(studentId);
    if (!d) return 0;
    return d.discount_type === 'percentage'
      ? num(total * (Number(d.discount_value) || 0) / 100)
      : num(d.discount_value);
  }

  // ══ Discounts ══════════════════════════════════════════════════════════════

  add('GET', `${API}/discounts`, async (ctx, req, res) => {
    if (!gate(ctx, res, 'fees')) return undefined;
    return json(res, 200, {
      ok: true,
      discounts: db.prepare(`
        SELECT d.*, d.discount_value AS value,
               TRIM(COALESCE(s.surname,'') || ' ' || COALESCE(s.first_name,'')) AS student_name,
               c.name AS class_name, u.full_name AS granted_by_name
        FROM student_discounts d
        JOIN students s ON s.id = d.student_id
        LEFT JOIN class_groups c ON c.id = s.current_class_id
        LEFT JOIN users u ON u.id = d.granted_by
        WHERE COALESCE(d.is_active,1) = 1
        ORDER BY d.id DESC LIMIT 400`).all(),
    });
  });

  // Elevated, exactly as the desktop and the online school hold it: a discount
  // changes what a family is asked to pay, and "who may reduce a bill" is not
  // the same question as "who may take a payment".
  add('POST', `${API}/discounts`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'fees', 'edit')) return undefined;
    if (!ctx.is_admin) return deny(res, 'Only the Super Admin or the Proprietor may grant a discount.');
    const studentId = int(body.student_id ?? body.studentId);
    if (!studentId) return bad(res, 'Which pupil?');
    const reason = String(body.reason || '').trim();
    if (reason.length < 3) return bad(res, 'Give the reason. It is recorded against the pupil.');
    const type = body.discount_type === 'percentage' ? 'percentage' : 'fixed';
    const value = num(body.value ?? body.discount_value);
    if (value <= 0) return bad(res, 'A discount of nothing is not a discount.');

    const r = db.prepare(`
      INSERT INTO student_discounts
        (student_id, discount_type, discount_value, reason, applies_to, is_active, granted_by)
      VALUES (?, ?, ?, ?, ?, 1, ?)`)
      .run(studentId, type, value, reason, body.applies_to || 'school_fees', ctx.user.id);
    audit(db, ctx, 'discount', r.lastInsertRowid, 'grant_discount',
      `${type} ${value} — ${reason}`, 'high');
    return json(res, 200, { ok: true, id: r.lastInsertRowid });
  });

  // ══ Extra charges, and withdrawing a bill ═════════════════════════════════
  //
  // School fees are billed once a term. Everything else a Ghanaian school asks
  // for mid-term — excursion, sports week, mock exams, BECE registration,
  // speech day — is raised as a SUPPLEMENTARY charge and lands on the pupil's
  // existing term bill as extra lines, so a parent still has one bill and one
  // balance to settle rather than three pieces of paper.
  //
  // Both of these, and voiding a bill, are ELEVATED. Raising what a family is
  // asked to pay, and removing a bill from every total in the school, are not
  // the same question as "may this person take a payment".

  const billing = require('../ipc/_billing');

  const elevated = (ctx, res, what) => {
    if (!ctx.is_admin) { deny(res, `Only the Super Admin or the Proprietor may ${what}.`); return false; }
    return true;
  };

  add('GET', `${API}/fees/supplementary`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'fees')) return undefined;
    const term = (query && query.termId) ? db.prepare('SELECT * FROM terms WHERE id = ?').get(int(query.termId))
                                         : currentTerm();
    const rows = db.prepare(`
      SELECT ft.*, c.name AS class_name,
             (SELECT COALESCE(SUM(amount),0) FROM fee_line_items WHERE fee_template_id = ft.id) AS total,
             (SELECT COUNT(*) FROM fee_line_items WHERE fee_template_id = ft.id) AS items
      FROM fee_templates ft
      LEFT JOIN class_groups c ON c.id = ft.class_group_id
      WHERE COALESCE(ft.is_active, 1) = 1 AND ft.bill_type = 'supplementary'
      ORDER BY ft.id DESC`).all();

    // How many of this term's bills each charge is already on — the number the
    // office actually asks about, and the one that makes applying it twice
    // obviously unnecessary rather than merely harmless.
    const appliedTo = db.prepare(`
      SELECT COUNT(DISTINCT li.student_bill_id) AS n
      FROM bill_line_items li JOIN student_bills b ON b.id = li.student_bill_id
      WHERE li.source_template_id = ? AND li.charge_type = 'extra'
        AND (? IS NULL OR b.term_id = ?)`);

    return json(res, 200, {
      ok: true,
      term: term ? { id: term.id, label: term.label } : null,
      may_apply: !!ctx.is_admin,
      templates: rows.map(t => ({ ...t,
        applied_to: appliedTo.get(t.id, term ? term.id : null, term ? term.id : null).n })),
    });
  });

  /**
   * Add a supplementary charge to bills that already exist.
   *
   * Idempotent per (bill, template): applying twice does not charge twice, and
   * says how many it skipped rather than pretending it did nothing.
   */
  add('POST', `${API}/fees/supplementary`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'fees', 'edit')) return undefined;
    if (!elevated(ctx, res, 'apply a supplementary charge')) return undefined;

    const templateId = int(body.templateId ?? body.template_id);
    const tpl = templateId && db.prepare('SELECT * FROM fee_templates WHERE id = ?').get(templateId);
    if (!tpl) return bad(res, 'That supplementary bill no longer exists.');
    if ((tpl.bill_type || 'school_fees') !== 'supplementary') {
      return bad(res, 'Only a supplementary bill can be added on top of a term bill. '
                    + 'School fees are billed once per term through Generate Bills.');
    }
    const items = billing.templateItems(db, templateId)
      .filter(i => (i.amount || 0) !== 0 || i.description);
    if (!items.length) return bad(res, 'That supplementary bill has no line items.');

    const term = body.termId ? db.prepare('SELECT * FROM terms WHERE id = ?').get(int(body.termId))
                             : currentTerm();
    if (!term) return bad(res, 'No term is running, so there is nothing to add the charge to.');

    const scope = body.scope === 'class' || body.scope === 'selected' ? body.scope : 'all';
    const ids = Array.isArray(body.studentIds) ? body.studentIds.map(int).filter(Boolean) : [];
    let bills;
    if (scope === 'class' && int(body.classId)) {
      bills = db.prepare(`
        SELECT b.id FROM student_bills b JOIN students s ON s.id = b.student_id
        WHERE b.term_id = ? AND s.current_class_id = ? AND COALESCE(b.status,'active') = 'active'`)
        .all(term.id, int(body.classId));
    } else if (scope === 'selected' && ids.length) {
      const marks = ids.map(() => '?').join(',');
      bills = db.prepare(`
        SELECT id FROM student_bills
        WHERE term_id = ? AND COALESCE(status,'active') = 'active' AND student_id IN (${marks})`)
        .all(term.id, ...ids);
    } else {
      bills = db.prepare(`
        SELECT b.id FROM student_bills b JOIN students s ON s.id = b.student_id
        WHERE b.term_id = ? AND s.status = 'Active' AND COALESCE(b.status,'active') = 'active'`)
        .all(term.id);
    }
    if (!bills.length) {
      return bad(res, 'No term bills matched. Generate the term bills first, then add the extra charge.');
    }

    const now = new Date().toISOString();
    const alreadyOn = db.prepare(`
      SELECT COUNT(*) AS n FROM bill_line_items
      WHERE student_bill_id = ? AND source_template_id = ? AND charge_type = 'extra'`);
    const nextNo = db.prepare(
      'SELECT COALESCE(MAX(item_number), 0) AS n FROM bill_line_items WHERE student_bill_id = ?');
    const ins = db.prepare(`
      INSERT INTO bill_line_items
        (student_bill_id, item_number, description, amount, is_arrear, arrear_from_term_id,
         charge_type, source_template_id, added_at, added_by)
      VALUES (?, ?, ?, ?, 0, NULL, 'extra', ?, ?, ?)`);

    let applied = 0; let skipped = 0; let amount = 0;
    const tx = db.transaction(() => {
      for (const b of bills) {
        if (alreadyOn.get(b.id, templateId).n > 0) { skipped += 1; continue; }
        let n = nextNo.get(b.id).n;
        for (const it of items) {
          n += 1;
          ins.run(b.id, n, it.description, num(it.amount), templateId, now, ctx.user.id);
          amount += num(it.amount);
        }
        billing.recomputeBillTotals(db, b.id);
        applied += 1;
      }
    });
    tx();

    audit(db, ctx, 'student_bill', null, 'supplementary_applied',
      `Applied "${tpl.name}" (GHS ${num(amount)}) to ${applied} bill(s) for ${term.label}.`, 'high');
    return json(res, 200, { ok: true, applied, skipped,
      total_amount: num(amount), template_name: tpl.name, term: term.label });
  });

  /** Take a supplementary charge back off every bill it was added to. */
  add('POST', `${API}/fees/supplementary/remove`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'fees', 'edit')) return undefined;
    if (!elevated(ctx, res, 'withdraw a supplementary charge')) return undefined;
    const templateId = int(body.templateId ?? body.template_id);
    if (!templateId) return bad(res, 'Which charge?');
    const billId = body.billId ? int(body.billId) : null;
    const term = body.termId ? db.prepare('SELECT * FROM terms WHERE id = ?').get(int(body.termId))
                             : currentTerm();

    const targets = billId
      ? db.prepare('SELECT id FROM student_bills WHERE id = ?').all(billId)
      : db.prepare(`
          SELECT DISTINCT b.id FROM student_bills b
          JOIN bill_line_items li ON li.student_bill_id = b.id
          WHERE (? IS NULL OR b.term_id = ?) AND li.source_template_id = ?
            AND li.charge_type = 'extra'`)
          .all(term ? term.id : null, term ? term.id : null, templateId);

    const del = db.prepare(
      "DELETE FROM bill_line_items WHERE student_bill_id = ? AND source_template_id = ? AND charge_type = 'extra'");
    let removed = 0;
    const tx = db.transaction(() => {
      for (const t of targets) {
        if (del.run(t.id, templateId).changes > 0) { billing.recomputeBillTotals(db, t.id); removed += 1; }
      }
    });
    tx();
    audit(db, ctx, 'student_bill', billId, 'supplementary_removed',
      `Removed supplementary charge ${templateId} from ${removed} bill(s).`, 'high');
    return json(res, 200, { ok: true, removed });
  });

  // ── Withdrawing a bill ─────────────────────────────────────────────────────
  //
  // A voided bill is hidden from the bills list, the debtors report and every
  // total, which is exactly what makes this worth serving: it is the only place
  // anybody can see what was withdrawn, by whom, and on what stated grounds —
  // and put it back if it should not have been.

  add('GET', `${API}/fees/bills/voided`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'fees')) return undefined;
    const all = String((query && query.all) || '') === '1';
    const term = currentTerm();
    const termId = all ? null : (int(query && query.termId) || (term ? term.id : null));
    return json(res, 200, {
      ok: true, term_id: termId, may_restore: !!ctx.is_admin,
      bills: db.prepare(`
        SELECT b.*, s.index_number, s.surname, s.first_name,
               TRIM(COALESCE(s.surname,'') || ' ' || COALESCE(s.first_name,'')) AS student_name,
               c.name AS class_name, t.label AS term_label, u.full_name AS voided_by_name
        FROM student_bills b
        JOIN students s ON s.id = b.student_id
        LEFT JOIN class_groups c ON c.id = s.current_class_id
        JOIN terms t ON t.id = b.term_id
        LEFT JOIN users u ON u.id = b.voided_by
        WHERE COALESCE(b.status,'active') = 'voided' AND (? IS NULL OR b.term_id = ?)
        ORDER BY b.voided_at DESC LIMIT 400`).all(termId, termId),
    });
  });

  add('POST', `${API}/fees/bills/:id/void`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'fees', 'edit')) return undefined;
    if (!elevated(ctx, res, 'withdraw a bill')) return undefined;
    const reason = String(body.reason || '').trim();
    if (reason.length < 5) {
      return bad(res, 'A reason is required, and it has to say something — this is written to the audit trail.');
    }
    const id = int(params.id);
    const bill = db.prepare(`
      SELECT b.*, s.index_number, s.surname, s.first_name
      FROM student_bills b JOIN students s ON s.id = b.student_id WHERE b.id = ?`).get(id);
    if (!bill) return missing(res, 'Bill not found.');
    if ((bill.status || 'active') === 'voided') return bad(res, 'That bill is already voided.');

    db.prepare(`UPDATE student_bills
                   SET status = 'voided', voided_at = ?, voided_by = ?, void_reason = ?
                 WHERE id = ?`)
      .run(new Date().toISOString(), ctx.user.id, reason, id);

    audit(db, ctx, 'student_bill', id, 'bill_voided',
      `Voided bill #${id} for ${bill.index_number} (${bill.surname} ${bill.first_name}), `
      + `GHS ${num(bill.total_billed)} billed / GHS ${num(bill.total_paid)} paid. Reason: ${reason}`, 'high');

    // Voiding does not un-receive money. Saying so plainly beats a silent
    // discrepancy between the bill list and the finance ledger.
    return json(res, 200, { ok: true, retained_payments: num(bill.total_paid),
      warning: Number(bill.total_paid || 0) > 0
        ? `GHS ${num(bill.total_paid)} already received against this bill stays recorded in Finance. `
          + 'Reverse those payments separately if the money is being refunded.'
        : null });
  });

  add('POST', `${API}/fees/bills/:id/restore`, async (ctx, req, res, params) => {
    if (!gate(ctx, res, 'fees', 'edit')) return undefined;
    if (!elevated(ctx, res, 'restore a withdrawn bill')) return undefined;
    const id = int(params.id);
    const bill = db.prepare('SELECT * FROM student_bills WHERE id = ?').get(id);
    if (!bill) return missing(res, 'Bill not found.');
    if ((bill.status || 'active') !== 'voided') return bad(res, 'That bill is not voided.');
    db.prepare(`UPDATE student_bills
                   SET status = 'active', voided_at = NULL, voided_by = NULL, void_reason = NULL
                 WHERE id = ?`).run(id);
    billing.recomputeBillTotals(db, id);
    audit(db, ctx, 'student_bill', id, 'bill_restored', `Restored voided bill #${id}.`, 'high');
    return json(res, 200, { ok: true });
  });

  // ══ Books ══════════════════════════════════════════════════════════════════

  add('GET', `${API}/books/:id`, async (ctx, req, res, params) => {
    if (!gate(ctx, res, 'fees')) return undefined;
    const studentId = int(params.id);
    const record = db.prepare(`
      SELECT * FROM student_books WHERE student_id = ? ORDER BY id DESC LIMIT 1`).get(studentId);
    if (!record) return json(res, 200, { ok: true, items: [], total: 0, paid: 0, balance: 0 });
    record.items = db.prepare(
      'SELECT * FROM student_books_items WHERE student_books_id = ? ORDER BY display_order, id')
      .all(record.id);
    record.payments = db.prepare(`
      SELECT * FROM books_payments WHERE student_books_id = ? AND COALESCE(is_reversed,0) = 0
      ORDER BY payment_date DESC, id DESC`).all(record.id);
    return json(res, 200, { ok: true, ...record,
      total: num(record.total_amount), paid: num(record.total_paid), balance: num(record.balance) });
  });

  add('POST', `${API}/books/:id`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'fees', 'edit')) return undefined;
    const studentId = int(params.id);
    const items = Array.isArray(body.items) ? body.items : [];
    const total = num(items.reduce((n, i) => n + Number(i.amount || 0), 0));
    const existing = db.prepare(
      'SELECT * FROM student_books WHERE student_id = ? ORDER BY id DESC LIMIT 1').get(studentId);

    const tx = db.transaction(() => {
      let id = existing ? existing.id : null;
      const paid = existing ? num(existing.total_paid) : 0;
      if (id) {
        db.prepare('UPDATE student_books SET total_amount = ?, balance = ?, updated_at = ? WHERE id = ?')
          .run(total, num(total - paid), new Date().toISOString(), id);
        db.prepare('DELETE FROM student_books_items WHERE student_books_id = ?').run(id);
      } else {
        const r = db.prepare(`
          INSERT INTO student_books
            (student_id, academic_year_id, class_group_id, total_amount, total_paid, balance, notes)
          VALUES (?, ?, (SELECT current_class_id FROM students WHERE id = ?), ?, 0, ?, ?)`)
          .run(studentId, int(body.academicYearId) || currentYearId(),
               studentId, total, total, body.notes || null);
        id = r.lastInsertRowid;
      }
      items.forEach((item, n) => {
        db.prepare(`INSERT INTO student_books_items (student_books_id, title, amount, display_order)
                    VALUES (?, ?, ?, ?)`)
          .run(id, String(item.title || item.description || '').slice(0, 200), num(item.amount), n);
      });
    });
    tx();
    audit(db, ctx, 'student_books', studentId, 'save_books', `${items.length} item(s)`);
    return json(res, 200, { ok: true });
  });

  add('POST', `${API}/books/:id/payment`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'fees', 'create')) return undefined;
    const studentId = int(params.id);
    const amount = num(body.amount);
    if (amount <= 0) return bad(res, 'How much was paid?');
    const record = db.prepare(
      'SELECT * FROM student_books WHERE student_id = ? ORDER BY id DESC LIMIT 1').get(studentId);
    if (!record) return bad(res, 'Nothing has been charged to this pupil for books.');

    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO books_payments
                    (student_id, student_books_id, amount, payment_date, payment_method, received_by, notes)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(studentId, record.id, amount, body.date || todayISO(),
             body.paymentMethod || body.method || 'Cash', ctx.user.id, body.notes || null);
      const paid = num(Number(record.total_paid || 0) + amount);
      db.prepare('UPDATE student_books SET total_paid = ?, balance = ?, updated_at = ? WHERE id = ?')
        .run(paid, num(Number(record.total_amount || 0) - paid), new Date().toISOString(), record.id);
    });
    tx();
    audit(db, ctx, 'books_payment', studentId, 'books_payment', String(amount));
    return json(res, 200, { ok: true });
  });

  // ══ The store room ═════════════════════════════════════════════════════════

  add('GET', `${API}/inventory`, async (ctx, req, res) => {
    if (!gate(ctx, res, 'finance')) return undefined;
    return json(res, 200, {
      ok: true,
      items: db.prepare(`
        SELECT *, quantity_on_hand AS quantity FROM inventory_items
        ORDER BY name`).all(),
    });
  });

  add('POST', `${API}/inventory`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'finance', body.id ? 'edit' : 'create')) return undefined;
    const name = String(body.name || '').trim();
    if (!name) return bad(res, 'Give the item a name.');
    if (body.id) {
      db.prepare(`UPDATE inventory_items
                     SET name = ?, category = ?, unit = ?, unit_cost = ?, reorder_level = ?, updated_at = ?
                   WHERE id = ?`)
        .run(name, body.category || null, body.unit || null, num(body.unit_cost),
             num(body.reorder_level), new Date().toISOString(), int(body.id));
      audit(db, ctx, 'inventory_item', int(body.id), 'save_item', name);
      return json(res, 200, { ok: true, id: int(body.id) });
    }
    const r = db.prepare(`
      INSERT INTO inventory_items (name, category, unit, unit_cost, quantity_on_hand, reorder_level)
      VALUES (?, ?, ?, ?, 0, ?)`)
      .run(name, body.category || null, body.unit || null, num(body.unit_cost), num(body.reorder_level));
    audit(db, ctx, 'inventory_item', r.lastInsertRowid, 'save_item', name);
    return json(res, 200, { ok: true, id: r.lastInsertRowid });
  });

  add('POST', `${API}/inventory/movement`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'finance', 'create')) return undefined;
    const itemId = int(body.itemId ?? body.item_id);
    const item = itemId ? db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(itemId) : null;
    if (!item) return bad(res, 'Which item?');
    const direction = String(body.movementType ?? body.movement_type ?? 'in').toLowerCase() === 'out'
      ? 'out' : 'in';
    const qty = Number(body.quantity) || 0;
    if (qty <= 0) return bad(res, 'How many?');
    const onHand = Number(item.quantity_on_hand || 0);
    if (direction === 'out' && qty > onHand) {
      return bad(res, `There are only ${onHand} ${item.unit || 'of these'} on the books.`);
    }

    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO inventory_movements
                    (inventory_item_id, movement_type, quantity, unit_cost, total_cost,
                     movement_date, recorded_by, notes)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(itemId, direction, qty, num(item.unit_cost), num(qty * Number(item.unit_cost || 0)),
             body.date || todayISO(), ctx.user.id, body.notes || null);
      db.prepare('UPDATE inventory_items SET quantity_on_hand = ?, updated_at = ? WHERE id = ?')
        .run(direction === 'in' ? onHand + qty : onHand - qty, new Date().toISOString(), itemId);
    });
    tx();
    audit(db, ctx, 'inventory_item', itemId, `stock_${direction}`, `${qty} × ${item.name}`);
    return json(res, 200, { ok: true });
  });

  add('GET', `${API}/inventory/movements`, async (ctx, req, res) => {
    if (!gate(ctx, res, 'finance')) return undefined;
    return json(res, 200, {
      ok: true,
      movements: db.prepare(`
        SELECT m.*, i.name AS item_name, i.unit, u.full_name AS recorded_by_name
        FROM inventory_movements m
        LEFT JOIN inventory_items i ON i.id = m.inventory_item_id
        LEFT JOIN users u ON u.id = m.recorded_by
        ORDER BY m.movement_date DESC, m.id DESC LIMIT 300`).all(),
    });
  });

  // ══ The buses ══════════════════════════════════════════════════════════════

  add('GET', `${API}/transport`, async (ctx, req, res) => {
    if (!gate(ctx, res, 'finance')) return undefined;
    return json(res, 200, {
      ok: true,
      routes: db.prepare(`
        SELECT r.*, r.driver_phone AS driver_contact,
               (SELECT COUNT(*) FROM student_transport st
                 WHERE st.route_id = r.id AND COALESCE(st.is_active,1) = 1) AS riders
        FROM transport_routes r
        WHERE COALESCE(r.is_active,1) = 1
        ORDER BY r.name`).all(),
    });
  });

  add('GET', `${API}/transport/:id`, async (ctx, req, res, params) => {
    if (!gate(ctx, res, 'finance')) return undefined;
    const routeId = int(params.id);
    const route = db.prepare('SELECT * FROM transport_routes WHERE id = ?').get(routeId);
    if (!route) return missing(res, 'No such route.');
    const term = currentTerm();
    const riders = db.prepare(`
      SELECT st.student_id, s.surname, s.first_name, s.index_number, c.name AS class_name,
             COALESCE(st.fee_override, r.fee_per_term) AS fee,
             (SELECT COALESCE(SUM(amount),0) FROM transport_payments p
               WHERE p.student_id = st.student_id AND (? IS NULL OR p.term_id = ?)) AS paid
      FROM student_transport st
      JOIN students s ON s.id = st.student_id
      JOIN transport_routes r ON r.id = st.route_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE st.route_id = ? AND COALESCE(st.is_active,1) = 1
      ORDER BY s.surname, s.first_name`).all(term ? term.id : null, term ? term.id : null, routeId);
    for (const r of riders) {
      r.name = `${r.surname || ''} ${r.first_name || ''}`.trim();
      r.paid = num(r.paid);
      r.balance = num(Math.max(0, Number(r.fee || 0) - r.paid));
    }
    return json(res, 200, { ok: true, route, riders });
  });

  add('POST', `${API}/transport`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'finance', body.id ? 'edit' : 'create')) return undefined;
    const name = String(body.name || '').trim();
    if (!name) return bad(res, 'Give the route a name.');
    const cols = [name, body.description || null, body.vehicle_number || null,
                  body.driver_name || null, body.driver_contact || body.driver_phone || null,
                  int(body.capacity), num(body.fee_per_term)];
    if (body.id) {
      db.prepare(`UPDATE transport_routes
                     SET name = ?, description = ?, vehicle_number = ?, driver_name = ?,
                         driver_phone = ?, capacity = ?, fee_per_term = ?
                   WHERE id = ?`).run(...cols, int(body.id));
      audit(db, ctx, 'transport_route', int(body.id), 'save_route', name);
      return json(res, 200, { ok: true, id: int(body.id) });
    }
    const r = db.prepare(`
      INSERT INTO transport_routes
        (name, description, vehicle_number, driver_name, driver_phone, capacity, fee_per_term, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)`).run(...cols);
    audit(db, ctx, 'transport_route', r.lastInsertRowid, 'save_route', name);
    return json(res, 200, { ok: true, id: r.lastInsertRowid });
  });

  // Putting pupils on a bus. A pupil rides one route, so this moves rather than
  // adds — `student_transport.student_id` is unique for exactly that reason.
  add('POST', `${API}/transport/riders`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'finance', 'edit')) return undefined;
    const routeId = int(body.routeId ?? body.route_id);
    if (!routeId) return bad(res, 'Which route?');
    const ids = (body.studentIds || body.student_ids || []).map(int).filter(Boolean);
    if (!ids.length) return bad(res, 'Which pupils?');
    const tx = db.transaction(() => {
      for (const id of ids) {
        db.prepare(`
          INSERT INTO student_transport (student_id, route_id, is_active, start_date)
          VALUES (?, ?, 1, ?)
          ON CONFLICT (student_id) DO UPDATE SET route_id = excluded.route_id, is_active = 1`)
          .run(id, routeId, todayISO());
      }
    });
    tx();
    audit(db, ctx, 'transport_route', routeId, 'assign_riders', `${ids.length} pupil(s)`);
    return json(res, 200, { ok: true, assigned: ids.length });
  });

  add('POST', `${API}/transport/payment`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'finance', 'create')) return undefined;
    const tp = require('../ipc/transport');
    const term = currentTerm();
    const r = tp.recordPayment(db, {
      studentId: int(body.studentId ?? body.student_id),
      routeId: int(body.routeId ?? body.route_id),
      termId: term ? term.id : null,
      amount: num(body.amount),
      paymentDate: body.date || todayISO(),
      paymentMethod: body.paymentMethod || body.method || 'Cash',
      receivedBy: ctx.user.id,
      notes: body.notes || null,
    });
    if (r && r.ok === false) return bad(res, r.error);
    audit(db, ctx, 'transport_payment', null, 'transport_payment', String(num(body.amount)));
    return json(res, 200, { ok: true, ...(r || {}) });
  });

  // ══ Canteen arrears ════════════════════════════════════════════════════════

  add('GET', `${API}/canteen/debtors`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'canteen')) return undefined;
    const rate = Number(getSetting(db, 'canteen_daily_rate', '0')) || 0;
    const term = currentTerm();
    const classId = query && query.classId ? int(query.classId) : null;
    const rows = db.prepare(`
      SELECT s.id, s.index_number, s.surname, s.first_name, c.name AS class_name,
             (SELECT COUNT(*) FROM school_calendar sc
               LEFT JOIN canteen_day_status cds ON cds.date = sc.date AND cds.student_id = s.id
              WHERE sc.term_id = ? AND sc.day_type = 'school_day'
                AND (cds.status IS NULL OR cds.status = 'unpaid')) AS unpaid_days
      FROM students s
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE s.status = 'Active' AND (? IS NULL OR s.current_class_id = ?)
      ORDER BY s.surname, s.first_name`).all(term ? term.id : null, classId, classId);

    const debtors = rows
      .map(r => ({ ...r, name: `${r.surname || ''} ${r.first_name || ''}`.trim(),
                   amount_owed: num((r.unpaid_days || 0) * rate) }))
      .filter(r => r.amount_owed > 0);
    return json(res, 200, { ok: true, daily_rate: rate, debtors });
  });

  // ══ Staff ══════════════════════════════════════════════════════════════════

  add('GET', `${API}/admin/staff-register`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'staff')) return undefined;
    const date = (query && query.date) || todayISO();
    return json(res, 200, {
      ok: true, date,
      staff: db.prepare(`
        SELECT s.id AS staff_id, s.surname, s.first_name, d.name AS designation,
               a.clock_in, a.clock_out, a.status,
               TRIM(COALESCE(s.surname,'') || ' ' || COALESCE(s.first_name,'')) AS name
        FROM staff s
        LEFT JOIN designations d ON d.id = s.designation_id
        LEFT JOIN staff_attendance a ON a.staff_id = s.id AND a.date = ?
        WHERE COALESCE(s.status,'Active') = 'Active'
        ORDER BY s.surname, s.first_name`).all(date),
    });
  });

  // ── Staff activities ──
  // Not module-gated on the way in: a person may always read and file their
  // OWN. Reading a colleague's is what needs `staff`.
  add('GET', `${API}/activities`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!ctx || ctx.role !== 'staff') return deny(res, 'Staff only.');
    const mineOnly = !can(ctx, 'staff', 'view');
    if (mineOnly && !ctx.user.staff_id) {
      return json(res, 200, { ok: true, activities: [], mine_only: true, may_acknowledge: false });
    }
    const staffId = mineOnly ? ctx.user.staff_id
                             : (query && query.staffId ? int(query.staffId) : null);
    const rows = db.prepare(`
      SELECT a.*, TRIM(COALESCE(s.surname,'') || ' ' || COALESCE(s.first_name,'')) AS staff_name,
             c.name AS class_name, u.full_name AS acknowledged_by_name
      FROM staff_activities a
      LEFT JOIN staff s ON s.id = a.staff_id
      LEFT JOIN class_groups c ON c.id = a.related_class_id
      LEFT JOIN users u ON u.id = a.acknowledged_by
      WHERE (? IS NULL OR a.staff_id = ?)
      ORDER BY a.activity_date DESC, a.id DESC LIMIT 400`).all(staffId, staffId);
    return json(res, 200, { ok: true, activities: rows, mine_only: mineOnly,
                            may_acknowledge: can(ctx, 'staff', 'edit') });
  });

  add('POST', `${API}/activities`, async (ctx, req, res, params, body) => {
    if (!ctx || ctx.role !== 'staff') return deny(res, 'Staff only.');
    const supervisor = can(ctx, 'staff', 'edit');
    const staffId = supervisor ? int(body.staff_id ?? body.staffId) || ctx.user.staff_id
                               : ctx.user.staff_id;
    if (!staffId) return bad(res, 'Your account has no staff record to file against.');
    const title = String(body.title || '').trim();
    if (!title) return bad(res, 'Give the activity a title.');

    if (body.id) {
      const existing = db.prepare('SELECT staff_id FROM staff_activities WHERE id = ?').get(int(body.id));
      if (!existing) return missing(res, 'No such activity.');
      if (!supervisor && existing.staff_id !== ctx.user.staff_id) return deny(res, 'That is not your activity.');
      db.prepare(`UPDATE staff_activities
                     SET activity_date = ?, activity_type = ?, title = ?, description = ?,
                         duration_minutes = ?, location = ?, hours_contributed = ?
                   WHERE id = ?`)
        .run(body.activity_date || todayISO(), body.activity_type || 'other', title,
             body.description || null, int(body.duration_minutes), body.location || null,
             body.hours_contributed == null ? null : Number(body.hours_contributed), int(body.id));
      return json(res, 200, { ok: true, id: int(body.id) });
    }
    const r = db.prepare(`
      INSERT INTO staff_activities
        (staff_id, activity_date, activity_type, title, description, duration_minutes,
         location, related_class_id, hours_contributed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(staffId, body.activity_date || todayISO(), body.activity_type || 'other', title,
           body.description || null, int(body.duration_minutes), body.location || null,
           int(body.related_class_id), body.hours_contributed == null ? null : Number(body.hours_contributed));
    return json(res, 200, { ok: true, id: r.lastInsertRowid });
  });

  add('POST', `${API}/activities/:id/acknowledge`, async (ctx, req, res, params) => {
    if (!gate(ctx, res, 'staff', 'edit')) return undefined;
    db.prepare('UPDATE staff_activities SET acknowledged_by = ?, acknowledged_at = ? WHERE id = ?')
      .run(ctx.user.id, new Date().toISOString(), int(params.id));
    return json(res, 200, { ok: true });
  });

  // ══ Payroll ════════════════════════════════════════════════════════════════

  // Running the month. The desktop's own calculation — the same PAYE bands,
  // the same SSNIT rates, the same carry-over arithmetic — so a run started in
  // a browser and one started at the office PC write identical rows.
  //
  // It used to answer 501 unconditionally, because the calculation lived
  // inside the payroll IPC closure and `payroll.bulkRun` was never a function.
  // The browser told an office standing at the school's own server that
  // payroll "is done on the school's own system". See electron/ipc/payroll.js.
  add('POST', `${API}/payroll/run`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'payroll', 'create')) return undefined;
    const now = new Date();
    const month = int(body.month) || (now.getMonth() + 1);
    const year = int(body.year) || now.getFullYear();
    if (!(month >= 1 && month <= 12) || !(year >= 1970 && year <= 2999)) {
      return bad(res, 'Which month?');
    }
    const payroll = require('../ipc/payroll');
    const r = payroll.bulkRun(db, {
      month, year, paymentDate: body.paymentDate || todayISO(),
    });
    audit(db, ctx, 'payroll', null, 'run_payroll',
      `${month}/${year} — ${r.created} created, ${r.updated} updated`, 'high');
    return json(res, 200, r);
  });

  // The month as it WOULD be, before anybody commits to it. The desktop shows
  // this above its run button and the browser needs the same: a payroll clerk
  // checks the figures before writing them, and a preview that only one of the
  // two machines can produce is a check only one of them can make.
  add('GET', `${API}/payroll/preview`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'payroll')) return undefined;
    const now = new Date();
    const month = int(query.month) || (now.getMonth() + 1);
    const year = int(query.year) || now.getFullYear();
    if (!(month >= 1 && month <= 12) || !(year >= 1970 && year <= 2999)) {
      return bad(res, 'Which month?');
    }
    const payroll = require('../ipc/payroll');
    return json(res, 200, { ok: true, ...payroll.bulkPreview(db, { month, year }) });
  });

  // Marking a salary paid, through the desktop's own function rather than a
  // second UPDATE written here. That matters for two things this route used to
  // get wrong: the expense is posted to the ledger (so Finance shows the money
  // leaving, and the audit's ledger-vs-module comparison balances), and the
  // shortfall on a part payment carries into next month instead of being
  // silently forgiven.
  add('POST', `${API}/payroll/:id/paid`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'payroll', 'edit')) return undefined;
    const id = int(params.id);
    const row = db.prepare('SELECT * FROM staff_salaries WHERE id = ?').get(id);
    if (!row) return missing(res, 'No such salary row.');
    const payroll = require('../ipc/payroll');
    const r = payroll.markPaid(db, {
      id,
      actualAmount: body.amount != null ? num(body.amount) : row.net_salary,
      paymentMethod: body.method || 'Bank Transfer',
      paymentReference: body.reference || null,
      paymentDate: body.date || todayISO(),
      paidBy: ctx.user ? ctx.user.id : null,
    });
    if (!r.ok) return bad(res, r.error);
    audit(db, ctx, 'salary', id, 'mark_salary_paid',
      `${r.actual}${r.carry_over ? ` — ${r.carry_over} carried over` : ''}`, 'high');
    return json(res, 200, r);
  });

  add('GET', `${API}/payroll/schedule/:kind`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'payroll')) return undefined;
    const kind = params.kind === 'paye' ? 'paye' : 'ssnit';
    const now = new Date();
    const month = int(query && query.month) || (now.getMonth() + 1);
    const year = int(query && query.year) || now.getFullYear();

    // SSNIT is filed for contributors. Somebody not marked enrolled but with a
    // contribution taken off them this month is still money owed to the fund,
    // so they belong on the schedule too — the alternative is a short filing.
    const where = kind === 'ssnit'
      ? `AND (COALESCE(s.ssnit_enrolled, 0) = 1
              OR COALESCE(sal.ssnit_worker, 0) > 0 OR COALESCE(sal.ssnit_employer, 0) > 0)`
      : '';
    const rows = db.prepare(`
      SELECT sal.*, TRIM(COALESCE(s.surname,'') || ' ' || COALESCE(s.first_name,'')) AS staff_name,
             s.surname, s.first_name, s.staff_number, s.ssnit_number
      FROM staff_salaries sal
      JOIN staff s ON s.id = sal.staff_id
      WHERE sal.month = ? AND sal.year = ? ${where}
      ORDER BY s.surname, s.first_name`).all(month, year);

    // Both key sets: the plain ones this app's tables read, and the column
    // names the online school answers with, so one screen serves both servers.
    const schedule = rows.map(r => (kind === 'ssnit'
      ? { staff_id: r.staff_id, staff_name: r.staff_name, staff_number: r.staff_number,
          ssnit_number: r.ssnit_number,
          basic: num(r.gross_salary), gross_salary: num(r.gross_salary),
          employee: num(r.ssnit_worker), ssnit_worker: num(r.ssnit_worker),
          employer: num(r.ssnit_employer), ssnit_employer: num(r.ssnit_employer),
          total: num(Number(r.ssnit_worker || 0) + Number(r.ssnit_employer || 0)),
          ssnit_total: num(Number(r.ssnit_worker || 0) + Number(r.ssnit_employer || 0)) }
      : { staff_id: r.staff_id, staff_name: r.staff_name, staff_number: r.staff_number,
          gross: num(r.gross_salary), gross_salary: num(r.gross_salary),
          ssnit_worker: num(r.ssnit_worker),
          taxable: num(Number(r.gross_salary || 0) - Number(r.ssnit_worker || 0)),
          amount: num(r.paye_tax), paye_tax: num(r.paye_tax) }));

    return json(res, 200, { ok: true, kind, month, year, rows: schedule,
      total: num(schedule.reduce((n, r) => n + Number(kind === 'ssnit' ? r.total : r.amount), 0)),
      school: { name: getSetting(db, 'school_name', 'School'),
                ssnit_employer_number: getSetting(db, 'school_ssnit_number', ''),
                tin: getSetting(db, 'school_tin', '') },
      school_ssnit_number: getSetting(db, 'school_ssnit_number', ''),
      school_tin: getSetting(db, 'school_tin', '') });
  });

  add('GET', `${API}/payroll/:staffId/payslip`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    // A person may always read their OWN payslip; anybody else's needs payroll.
    if (!ctx || ctx.role !== 'staff') return deny(res, 'Staff only.');
    const staffId = int(params.staffId);
    if (staffId !== ctx.user.staff_id && !can(ctx, 'payroll', 'view')) return deny(res);
    const now = new Date();
    const month = int(query && query.month) || (now.getMonth() + 1);
    const year = int(query && query.year) || now.getFullYear();
    const slip = db.prepare(`
      SELECT sal.*, sal.ssnit_worker AS ssnit_employee, sal.paye_tax AS paye,
             TRIM(COALESCE(s.surname,'') || ' ' || COALESCE(s.first_name,'')) AS staff_name,
             d.name AS designation
      FROM staff_salaries sal
      JOIN staff s ON s.id = sal.staff_id
      LEFT JOIN designations d ON d.id = s.designation_id
      WHERE sal.staff_id = ? AND sal.month = ? AND sal.year = ?`).get(staffId, month, year);
    if (!slip) return missing(res, 'No payslip for that month.');
    return json(res, 200, { ok: true, payslip: slip });
  });

  // ══ Finance ════════════════════════════════════════════════════════════════

  add('POST', `${API}/finance/income`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'finance', 'create')) return undefined;
    const amount = num(body.amount);
    if (amount <= 0) return bad(res, 'How much came in?');
    const term = currentTerm();
    const r = db.prepare(`
      INSERT INTO income_records
        (category, subcategory, amount, payer_name, description, payment_method, reference,
         transaction_date, term_id, recorded_by, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(body.category || 'Other', body.subcategory || null, amount,
           body.payerName || body.payer_name || null, body.description || null,
           body.paymentMethod || body.payment_method || 'Cash', body.reference || null,
           body.transactionDate || body.transaction_date || todayISO(),
           term ? term.id : null, ctx.user.id, ctx.user.id);
    audit(db, ctx, 'income', r.lastInsertRowid, 'record_income', `${body.category || 'Other'} ${amount}`);
    return json(res, 200, { ok: true, id: r.lastInsertRowid });
  });

  add('POST', `${API}/finance/expenses/:id/approve`, async (ctx, req, res, params) => {
    if (!gate(ctx, res, 'finance', 'edit')) return undefined;
    const id = int(params.id);
    const row = db.prepare('SELECT id, recorded_by, amount FROM expense_records WHERE id = ?').get(id);
    if (!row) return missing(res, 'No such expense.');
    // Somebody else approves it. An expense recorded and approved by the same
    // person is not an approval; it is a signature on your own cheque.
    if (row.recorded_by === ctx.user.id) {
      return bad(res, 'An expense is approved by somebody other than the person who recorded it.');
    }
    db.prepare('UPDATE expense_records SET approved_by = ? WHERE id = ?').run(ctx.user.id, id);
    audit(db, ctx, 'expense', id, 'approve_expense', String(num(row.amount)), 'high');
    return json(res, 200, { ok: true });
  });

  /**
   * The audit: what was receipted against what reached the ledger.
   *
   * A fee receipt posts itself to the income ledger as it is written. When the
   * two figures differ, something was recorded by hand that should not have
   * been, or a posting failed and was never retried — both worth an hour of
   * somebody's time, and neither visible from a balance alone.
   */
  add('GET', `${API}/finance/audit`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'finance')) return undefined;
    const term = query && query.termId
      ? db.prepare('SELECT * FROM terms WHERE id = ?').get(int(query.termId))
      : currentTerm();
    if (!term) return json(res, 200, { ok: true, checks: [], difference: 0 });

    const fees = num(db.prepare(
      'SELECT COALESCE(SUM(amount),0) t FROM payments WHERE term_id = ? AND COALESCE(is_reversed,0) = 0'
    ).get(term.id).t);
    const canteen = num(db.prepare(
      'SELECT COALESCE(SUM(amount),0) t FROM canteen_payments WHERE term_id = ?'
    ).get(term.id).t);
    const ledgerFees = num(db.prepare(`
      SELECT COALESCE(SUM(amount),0) t FROM income_records
      WHERE term_id = ? AND lower(category) IN ('fees','school fees','school_fees')`).get(term.id).t);
    const ledgerCanteen = num(db.prepare(`
      SELECT COALESCE(SUM(amount),0) t FROM income_records
      WHERE term_id = ? AND lower(category) = 'canteen'`).get(term.id).t);
    const ledgerAll = num(db.prepare(
      'SELECT COALESCE(SUM(amount),0) t FROM income_records WHERE term_id = ?').get(term.id).t);

    const checks = [
      { id: 'fees', label: 'Fee receipts against the ledger',
        expected: fees, found: ledgerFees, difference: num(fees - ledgerFees) },
      { id: 'canteen', label: 'Canteen collections against the ledger',
        expected: canteen, found: ledgerCanteen, difference: num(canteen - ledgerCanteen) },
    ];
    return json(res, 200, {
      ok: true, term: { id: term.id, label: term.label },
      fees_collected: fees, ledger_income: ledgerAll,
      difference: num(fees + canteen - ledgerFees - ledgerCanteen),
      checks,
    });
  });

  /** Income and expenditure on one page, in date order, with a running balance. */
  add('GET', `${API}/finance/cashbook`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'finance')) return undefined;
    const term = currentTerm();
    const from = (query && query.dateFrom) || (term ? term.start_date : '1970-01-01');
    // The term's own dates, but never ending before today: a term that runs a
    // week past the date it was given must not hide the week's takings.
    const today = todayISO();
    const to = (query && query.dateTo)
      || (term ? (term.end_date > today ? term.end_date : today) : '2099-12-31');

    const rows = [
      ...db.prepare(`
        SELECT transaction_date AS date, category, description, amount,
               COALESCE(receipt_number, reference) AS reference, 'income' AS kind
        FROM income_records WHERE transaction_date BETWEEN ? AND ?`).all(from, to),
      ...db.prepare(`
        SELECT transaction_date AS date, category, description, amount,
               transaction_number AS reference, 'expense' AS kind
        FROM expense_records WHERE transaction_date BETWEEN ? AND ?`).all(from, to),
    ].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.kind.localeCompare(b.kind));

    let balance = 0;
    for (const r of rows) {
      r.amount = num(r.amount);
      balance += r.kind === 'income' ? r.amount : -r.amount;
      r.balance = num(balance);
    }
    const totalIn = num(rows.filter(r => r.kind === 'income').reduce((n, r) => n + r.amount, 0));
    const totalOut = num(rows.filter(r => r.kind === 'expense').reduce((n, r) => n + r.amount, 0));
    return json(res, 200, { ok: true, from, to, entries: rows,
      total_in: totalIn, total_out: totalOut, closing_balance: num(totalIn - totalOut) });
  });

  // ══ Budgets ════════════════════════════════════════════════════════════════

  add('GET', `${API}/budgets`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'finance')) return undefined;
    const id = query && query.id ? int(query.id) : null;
    if (id) {
      const budget = db.prepare(`
        SELECT b.*, t.label AS term_label FROM budgets b
        LEFT JOIN terms t ON t.id = b.term_id WHERE b.id = ?`).get(id);
      if (!budget) return missing(res, 'No such budget.');
      budget.items = db.prepare(
        'SELECT * FROM budget_items WHERE budget_id = ? ORDER BY item_type, display_order, id').all(id);
      return json(res, 200, { ok: true, budget, may_edit: can(ctx, 'finance', 'edit') });
    }
    return json(res, 200, {
      ok: true, may_edit: can(ctx, 'finance', 'edit'),
      budgets: db.prepare(`
        SELECT b.*, t.label AS term_label,
               (SELECT COALESCE(SUM(projected_amount),0) FROM budget_items
                 WHERE budget_id = b.id AND item_type = 'expense') AS planned_expense,
               (SELECT COALESCE(SUM(projected_amount),0) FROM budget_items
                 WHERE budget_id = b.id AND item_type = 'income') AS planned_income,
               (SELECT COALESCE(SUM(actual_amount),0) FROM budget_items
                 WHERE budget_id = b.id AND item_type = 'expense') AS actual_expense
        FROM budgets b LEFT JOIN terms t ON t.id = b.term_id
        ORDER BY b.id DESC`).all(),
    });
  });

  add('POST', `${API}/budgets`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'finance', 'edit')) return undefined;
    const title = String(body.title || '').trim();
    if (!title) return bad(res, 'Give the budget a title.');
    let id = body.id ? int(body.id) : null;
    const tx = db.transaction(() => {
      if (id) {
        db.prepare(`UPDATE budgets SET title = ?, budget_type = ?, term_id = ?, period_label = ?,
                                       start_date = ?, end_date = ?, notes = ?, status = ?
                     WHERE id = ?`)
          .run(title, body.budget_type || 'term', int(body.term_id), body.period_label || null,
               body.start_date || null, body.end_date || null, body.notes || null,
               body.status || 'draft', id);
      } else {
        const r = db.prepare(`
          INSERT INTO budgets (title, budget_type, term_id, period_label, start_date, end_date,
                               notes, status, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(title, body.budget_type || 'term', int(body.term_id), body.period_label || null,
               body.start_date || null, body.end_date || null, body.notes || null,
               body.status || 'draft', ctx.user.id);
        id = r.lastInsertRowid;
      }
      // Items are replaced wholesale when they are sent at all, so what is
      // stored is what the screen showed. Omitting them leaves them alone.
      if (Array.isArray(body.items)) {
        db.prepare('DELETE FROM budget_items WHERE budget_id = ?').run(id);
        body.items.forEach((item, n) => {
          db.prepare(`INSERT INTO budget_items
                        (budget_id, item_type, category, description, projected_amount,
                         actual_amount, notes, display_order)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, item.item_type === 'income' ? 'income' : 'expense',
                 String(item.category || 'Other').slice(0, 80),
                 String(item.description || '').slice(0, 200),
                 num(item.projected_amount), num(item.actual_amount), item.notes || null, n);
        });
      }
    });
    tx();
    audit(db, ctx, 'budget', id, 'save_budget', title);
    return json(res, 200, { ok: true, id });
  });

  // ══ Notifications ══════════════════════════════════════════════════════════

  add('GET', `${API}/notifications`, async (ctx, req, res) => {
    if (!gate(ctx, res, 'notifications')) return undefined;
    return json(res, 200, {
      ok: true,
      notifications: db.prepare(`
        SELECT n.*, u.full_name AS sent_by_name FROM notification_log n
        LEFT JOIN users u ON u.id = n.sent_by
        ORDER BY n.sent_at DESC, n.id DESC LIMIT 300`).all(),
    });
  });

  /**
   * Send a message.
   *
   * A text message costs money and cannot be recalled, so this is `create` on
   * notifications and nothing weaker, and every despatch is logged with what
   * was sent, to whom, and what it cost — the record a school needs when the
   * bill arrives.
   */
  add('POST', `${API}/notifications`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'notifications', 'create')) return undefined;
    const message = String(body.message || body.body || '').trim();
    if (!message) return bad(res, 'There is no message to send.');
    const audience = ['parents', 'staff', 'all'].includes(body.audience) ? body.audience : 'parents';
    const classId = body.classId ? int(body.classId) : null;

    const recipients = [];
    if (audience === 'parents' || audience === 'all') {
      recipients.push(...db.prepare(`
        SELECT DISTINCT p.id, p.full_name AS name, p.phone AS contact, 'parent' AS kind
        FROM parents p
        JOIN parent_students ps ON ps.parent_id = p.id
        JOIN students s ON s.id = ps.student_id
        WHERE s.status = 'Active' AND (? IS NULL OR s.current_class_id = ?)
          AND p.phone IS NOT NULL AND p.phone <> ''`).all(classId, classId));
    }
    if (audience === 'staff' || audience === 'all') {
      recipients.push(...db.prepare(`
        SELECT s.id, TRIM(COALESCE(s.surname,'') || ' ' || COALESCE(s.first_name,'')) AS name,
               s.phone AS contact, 'staff' AS kind
        FROM staff s
        WHERE COALESCE(s.status,'Active') = 'Active' AND s.phone IS NOT NULL AND s.phone <> ''`).all());
    }
    if (!recipients.length) return bad(res, 'Nobody in that group has a telephone number on file.');

    const ins = db.prepare(`
      INSERT INTO notification_log
        (channel, recipient_type, recipient_id, recipient_name, recipient_contact,
         message_body, delivery_status, sent_by)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`);
    const ids = [];
    const tx = db.transaction(() => {
      for (const r of recipients) {
        ids.push(ins.run(body.channel === 'email' ? 'email' : 'sms', r.kind, r.id, r.name,
                         r.contact, message, ctx.user.id).lastInsertRowid);
      }
    });
    tx();

    // Delivery is fire-and-forget: the log rows exist, and the transport
    // updates them to sent/failed. A send that blocked on the network would
    // hold the browser open for four hundred messages.
    try {
      const transport = require('../ipc/_transport');
      if (typeof transport.dispatchMany === 'function') transport.dispatchMany(db, ids);
    } catch (_) { /* the log stands whatever the gateway does */ }

    audit(db, ctx, 'notification', null, 'send_notification',
      `${recipients.length} recipient(s), ${audience}`, 'high');
    return json(res, 200, { ok: true, sent: recipients.length });
  });

  add('POST', `${API}/announcements/:id/withdraw`, async (ctx, req, res, params) => {
    if (!gate(ctx, res, 'notifications', 'edit')) return undefined;
    const id = int(params.id);
    const row = db.prepare('SELECT id, title FROM announcements WHERE id = ?').get(id);
    if (!row) return missing(res, 'No such notice.');
    db.prepare('UPDATE announcements SET is_published = 0 WHERE id = ?').run(id);
    audit(db, ctx, 'announcement', id, 'withdraw_announcement', row.title || '');
    return json(res, 200, { ok: true });
  });

  // ══ Resetting a password ═══════════════════════════════════════════════════

  add('POST', `${API}/system/users/:id/password`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'settings', 'edit')) return undefined;
    const password = String(body.password || '');
    if (password.length < 6) return bad(res, 'A password must be at least six characters.');
    let bcrypt; try { bcrypt = require('bcryptjs'); } catch (_) {
      return json(res, 500, { ok: false, error: 'Password hashing is unavailable.' });
    }
    const id = int(params.id);
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
    if (!user) return missing(res, 'No such account.');
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
      .run(bcrypt.hashSync(password, 10), id);
    audit(db, ctx, 'user', id, 'reset_password', user.username, 'high');
    return json(res, 200, { ok: true });
  });
};
