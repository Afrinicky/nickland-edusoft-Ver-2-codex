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

  // ══ Billing ════════════════════════════════════════════════════════════════

  add('GET', `${API}/fees/templates`, async (ctx, req, res) => {
    if (!gate(ctx, res, 'fees')) return undefined;
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
        ORDER BY c.name, t.label, ft.id
      `).all(),
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
    let id = body.id ? int(body.id) : null;

    if ((body.bill_type || 'school_fees') === 'school_fees' && termId) {
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
        db.prepare('UPDATE fee_templates SET name = ?, class_group_id = ?, term_id = ? WHERE id = ?')
          .run(name, classId, termId, id);
        db.prepare('DELETE FROM fee_line_items WHERE fee_template_id = ?').run(id);
      } else {
        const r = db.prepare(
          'INSERT INTO fee_templates (name, class_group_id, term_id, is_active) VALUES (?, ?, ?, 1)'
        ).run(name, classId, termId);
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
  add('POST', `${API}/fees/bills`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'fees', 'create')) return undefined;
    const term = body.termId ? db.prepare('SELECT * FROM terms WHERE id = ?').get(int(body.termId))
                             : currentTerm();
    if (!term) return bad(res, 'No term is running, so there is nothing to bill for.');

    const classId = body.classId ? int(body.classId) : null;
    const studentId = body.studentId ? int(body.studentId) : null;
    if (!classId && !studentId) return bad(res, 'Which class, or which pupil?');

    const students = studentId
      ? db.prepare("SELECT * FROM students WHERE id = ? AND status = 'Active'").all(studentId)
      : db.prepare("SELECT * FROM students WHERE current_class_id = ? AND status = 'Active' ORDER BY surname, first_name")
          .all(classId);
    if (!students.length) return bad(res, 'There is nobody active to bill.');

    let raised = 0; let skipped = 0; let noTemplate = 0;
    const tx = db.transaction(() => {
      for (const s of students) {
        const existing = db.prepare('SELECT id FROM student_bills WHERE student_id = ? AND term_id = ?')
          .get(s.id, term.id);
        if (existing) { skipped += 1; continue; }

        const template = db.prepare(`
          SELECT * FROM fee_templates
          WHERE COALESCE(is_active,1) = 1 AND term_id = ?
            AND (class_group_id = ? OR class_group_id IS NULL)
          ORDER BY class_group_id IS NULL LIMIT 1`).get(term.id, s.current_class_id);
        if (!template) { noTemplate += 1; continue; }

        const lines = db.prepare(
          'SELECT * FROM fee_line_items WHERE fee_template_id = ? ORDER BY item_number, id').all(template.id);
        const total = num(lines.reduce((n, l) => n + Number(l.amount || 0), 0));

        // Anything unpaid from a previous term travels with the new bill, so a
        // parent sees one figure rather than being chased by two.
        const arrears = num(db.prepare(`
          SELECT COALESCE(SUM(balance), 0) AS b FROM student_bills
          WHERE student_id = ? AND term_id <> ? AND COALESCE(status,'active') = 'active'
        `).get(s.id, term.id).b);

        // A discount the school has granted this pupil, applied as it is billed.
        const discount = discountFor(s.id, total);

        const billed = num(Math.max(0, total - discount) + arrears);
        const r = db.prepare(`
          INSERT INTO student_bills
            (student_id, term_id, template_id, total_billed, total_paid, balance,
             arrears_from_prev, discount_amount, discount_reason, generated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`)
          .run(s.id, term.id, template.id, billed, billed, arrears,
               discount, discount ? 'Granted discount' : null, todayISO());

        let n = 0;
        for (const l of lines) {
          n += 1;
          db.prepare(`INSERT INTO bill_line_items (student_bill_id, item_number, description, amount, is_arrear)
                      VALUES (?, ?, ?, ?, 0)`).run(r.lastInsertRowid, n, l.description, num(l.amount));
        }
        if (arrears > 0) {
          db.prepare(`INSERT INTO bill_line_items (student_bill_id, item_number, description, amount, is_arrear)
                      VALUES (?, ?, ?, ?, 1)`)
            .run(r.lastInsertRowid, n + 1, 'Brought forward from a previous term', arrears);
        }
        raised += 1;
      }
    });
    tx();

    audit(db, ctx, 'student_bill', null, 'raise_bills',
      `${raised} raised, ${skipped} already billed, ${noTemplate} with no template — ${term.label}`, 'high');
    return json(res, 200, { ok: true, raised, skipped, no_template: noTemplate, term: term.label });
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

  add('POST', `${API}/payroll/run`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'payroll', 'create')) return undefined;
    const now = new Date();
    const month = int(body.month) || (now.getMonth() + 1);
    const year = int(body.year) || now.getFullYear();
    // The desktop's own calculation, so a run started in a browser and one
    // started at the office PC produce identical rows.
    const payroll = require('../ipc/payroll');
    if (typeof payroll.bulkRun !== 'function') {
      return json(res, 501, { ok: false, host_only: true,
        error: 'Running payroll is done on the school’s own system.' });
    }
    const r = payroll.bulkRun(db, { month, year, paymentDate: todayISO() });
    audit(db, ctx, 'payroll', null, 'run_payroll', `${month}/${year}`, 'high');
    return json(res, 200, { ok: true, ...(r || {}) });
  });

  add('POST', `${API}/payroll/:id/paid`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'payroll', 'edit')) return undefined;
    const id = int(params.id);
    const row = db.prepare('SELECT * FROM staff_salaries WHERE id = ?').get(id);
    if (!row) return missing(res, 'No such salary row.');
    db.prepare(`UPDATE staff_salaries
                   SET is_paid = 1, actual_amount_paid = ?, payment_method = ?,
                       payment_reference = ?, payment_date = ?
                 WHERE id = ?`)
      .run(num(body.amount ?? row.net_salary), body.method || 'Bank Transfer',
           body.reference || null, body.date || todayISO(), id);
    audit(db, ctx, 'salary', id, 'mark_salary_paid', String(num(body.amount ?? row.net_salary)), 'high');
    return json(res, 200, { ok: true });
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
