// Nickland Edusoft — the finance office, over LAN or a tunnel.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Everything the desktop's Fees and Finance pages do, reachable from a browser
// or a phone: the term's position, collections and receipts, a pupil's bill
// line by line, arrears, income and expenditure, the statement, payroll, and
// the payments parents make online.
//
// The rules are the ones the rest of the server already keeps:
//
//   1. Permission first. `fees`, `finance` and `payroll` are three separate
//      modules and they are checked separately — a bursar granted fees is not
//      thereby handed the school's expenditure, and neither is handed payroll.
//   2. The portal is checked as well as the module. Belt and braces: an
//      account that cannot see the Finance portal cannot reach its routes by
//      typing one, even in the window between a permission being withdrawn on
//      the desktop and the app noticing.
//   3. Reuse, never re-implement. A fee payment goes through
//      `payments_service.recordFeePayment` — the same function the desktop's
//      own screen calls, so the ledger is posted, the receipt is numbered
//      inside the transaction, and the parent's snapshot is refreshed. A
//      second implementation is a second set of bugs and, here, a second set
//      of receipt numbers.
//   4. Money that moves is audited. Every write in this file leaves a row in
//      audit_log naming the account that made it.
//
// Registered by `createApiServer` (api.js), which owns routing, auth and CORS.

const payments = require('./payments_service');
const { postIncome, postExpense } = require('../ipc/_ledger');
const portals = require('../ipc/_portals');

function todayISO() { return new Date().toISOString().slice(0, 10); }

// A window that defaults to the current term rather than to all history: a
// phone asking for "the payments" should not be handed four years of them.
function range(query, term) {
  const from = query.from || (term && term.start_date) || '1970-01-01';
  const to = query.to || (term && term.end_date) || '2099-12-31';
  return { from: String(from).slice(0, 10), to: String(to).slice(0, 10) };
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function registerFinanceRoutes({ add, db, json, can, API, getSetting, audit }) {
  const deny = (res, msg) => json(res, 403, { ok: false, error: msg || 'Access denied.' });
  const bad = (res, msg) => json(res, 400, { ok: false, error: msg });
  const missing = (res, msg) => json(res, 404, { ok: false, error: msg || 'Not found.' });

  const currentTerm = () => {
    try { return db.prepare('SELECT * FROM terms WHERE is_current = 1').get() || null; }
    catch (_) { return null; }
  };

  // The gate every route in this file passes through. The portal check is
  // deliberately first: it answers "is this person in the finance office at
  // all", and it is the answer that decides whether the route may even admit
  // to existing.
  const gate = (ctx, res, module, action = 'view') => {
    if (!ctx || ctx.role !== 'staff') { deny(res, 'Staff only.'); return false; }
    if (!portals.hasPortal(ctx, 'finance')) { deny(res); return false; }
    if (!can(ctx, module, action)) {
      deny(res, `Access denied. You do not have permission to ${action} ${module}.`);
      return false;
    }
    return true;
  };

  // ── The term's position ───────────────────────────────────────────────────
  // Four numbers and two lists, each of which appears only if the account may
  // see the module behind it. An accountant without `finance` gets the fee
  // position and no expenditure — not zeroes, which would read as a school
  // that had spent nothing.
  add('GET', `${API}/finance/overview`, async (ctx, req, res) => {
    if (!ctx || ctx.role !== 'staff') return deny(res, 'Staff only.');
    if (!portals.hasPortal(ctx, 'finance')) return deny(res);
    const term = currentTerm();
    const out = {
      ok: true,
      term: term ? { id: term.id, label: term.label, start_date: term.start_date, end_date: term.end_date } : null,
      currency: getSetting(db, 'payment_currency', 'GHS'),
      may: {
        fees: can(ctx, 'fees', 'view'),
        finance: can(ctx, 'finance', 'view'),
        payroll: can(ctx, 'payroll', 'view'),
        record_payment: can(ctx, 'fees', 'create'),
      },
    };

    if (term && can(ctx, 'fees', 'view')) {
      const collected = db.prepare(
        'SELECT COALESCE(SUM(amount),0) t, COUNT(*) n FROM payments WHERE term_id = ? AND is_reversed = 0'
      ).get(term.id);
      const billed = db.prepare(`
        SELECT COALESCE(SUM(total_billed),0) billed, COALESCE(SUM(balance),0) outstanding,
               COUNT(*) FILTER (WHERE balance > 0) debtors, COUNT(*) bills
        FROM student_bills WHERE term_id = ? AND COALESCE(status,'active') = 'active'
      `).get(term.id);
      const today = db.prepare(
        'SELECT COALESCE(SUM(amount),0) t, COUNT(*) n FROM payments WHERE payment_date = ? AND is_reversed = 0'
      ).get(todayISO());
      out.fees = {
        billed: num(billed.billed), collected: num(collected.t), receipts: collected.n,
        outstanding: num(billed.outstanding), debtors: billed.debtors, bills: billed.bills,
        today: num(today.t), today_receipts: today.n,
        collection_rate: billed.billed ? Math.round((collected.t / billed.billed) * 100) : 0,
      };
      out.recent = db.prepare(`
        SELECT p.id, p.receipt_number, p.amount, p.payment_date, p.payment_method,
               s.surname, s.first_name, s.index_number, c.name AS class_name
        FROM payments p JOIN students s ON s.id = p.student_id
        LEFT JOIN class_groups c ON c.id = s.current_class_id
        WHERE p.is_reversed = 0
        ORDER BY date(p.payment_date) DESC, p.id DESC LIMIT 12
      `).all().map(r => ({ ...r, student_name: `${r.surname || ''} ${r.first_name || ''}`.trim() }));
      out.top_debtors = db.prepare(`
        SELECT s.id AS student_id, s.surname, s.first_name, s.index_number,
               c.name AS class_name, b.balance
        FROM student_bills b JOIN students s ON s.id = b.student_id
        LEFT JOIN class_groups c ON c.id = s.current_class_id
        WHERE b.term_id = ? AND b.balance > 0 AND s.status = 'Active'
          AND COALESCE(b.status,'active') = 'active'
        ORDER BY b.balance DESC LIMIT 10
      `).all(term.id).map(r => ({ ...r, student_name: `${r.surname || ''} ${r.first_name || ''}`.trim() }));
      // Money waiting on somebody: what parents have paid online or declared
      // and nobody has acknowledged yet. The one number in the office that
      // means "there is work on this screen".
      out.fees.pending_intents = db.prepare(
        "SELECT COUNT(*) c FROM payment_intents WHERE status = 'pending'"
      ).get().c;
    }

    if (can(ctx, 'finance', 'view')) {
      const { from, to } = range({}, term);
      const income = db.prepare(`
        SELECT COALESCE(SUM(amount),0) t FROM income_records
        WHERE term_id = ? OR (term_id IS NULL AND COALESCE(transaction_date, date) BETWEEN ? AND ?)
      `).get(term ? term.id : null, from, to).t;
      const expense = db.prepare(`
        SELECT COALESCE(SUM(amount),0) t FROM expense_records
        WHERE term_id = ? OR (term_id IS NULL AND COALESCE(transaction_date, date) BETWEEN ? AND ?)
      `).get(term ? term.id : null, from, to).t;
      out.ledger = { income: num(income), expense: num(expense), net: num(income) - num(expense) };
      out.expense_categories = db.prepare(`
        SELECT category, COALESCE(SUM(amount),0) total, COUNT(*) n
        FROM expense_records
        WHERE COALESCE(transaction_date, date) BETWEEN ? AND ?
        GROUP BY category ORDER BY total DESC LIMIT 8
      `).all(from, to);
    }

    if (can(ctx, 'payroll', 'view')) {
      const now = new Date();
      const m = now.getMonth() + 1, y = now.getFullYear();
      const row = db.prepare(`
        SELECT COUNT(*) n, COALESCE(SUM(net_salary),0) net,
               COUNT(*) FILTER (WHERE is_paid = 1) paid,
               COALESCE(SUM(CASE WHEN is_paid = 1 THEN actual_amount_paid ELSE 0 END),0) paid_total
        FROM staff_salaries WHERE month = ? AND year = ?
      `).get(m, y);
      out.payroll = {
        month: m, year: y, staff: row.n, net: num(row.net),
        paid: row.paid, paid_total: num(row.paid_total),
        outstanding: Math.max(0, num(row.net) - num(row.paid_total)),
      };
    }

    return json(res, 200, out);
  });

  // ── Collections ───────────────────────────────────────────────────────────
  add('GET', `${API}/finance/collections`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'fees')) return undefined;
    const term = currentTerm();
    const { from, to } = range(query, term);
    const p = [from, to];
    let sql = `
      SELECT p.id, p.receipt_number, p.amount, p.payment_date, p.payment_method,
             p.reference, p.notes, p.is_reversed, p.reversal_reason,
             s.id AS student_id, s.surname, s.first_name, s.index_number,
             c.name AS class_name, u.full_name AS received_by_name
      FROM payments p
      JOIN students s ON s.id = p.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      LEFT JOIN users u ON u.id = p.received_by
      WHERE date(p.payment_date) BETWEEN date(?) AND date(?)
    `;
    if (query.classId) { sql += ' AND s.current_class_id = ?'; p.push(query.classId); }
    if (query.method) { sql += ' AND p.payment_method = ?'; p.push(query.method); }
    sql += ' ORDER BY date(p.payment_date) DESC, p.id DESC LIMIT 400';
    const rows = db.prepare(sql).all(...p);
    const total = rows.filter(r => !r.is_reversed).reduce((n, r) => n + num(r.amount), 0);
    return json(res, 200, {
      ok: true, from, to, total, count: rows.length,
      may_record: can(ctx, 'fees', 'create'),
      payments: rows.map(r => ({ ...r, student_name: `${r.surname || ''} ${r.first_name || ''}`.trim() })),
    });
  });

  // Take a payment. The one route in the app that turns a figure into money in
  // the school's books, so it goes through the shared service rather than an
  // INSERT of its own: the ledger entry, the receipt number, the delivery and
  // the parent's snapshot all follow from that one call.
  add('POST', `${API}/finance/collections`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'fees', 'create')) return undefined;
    const studentId = parseInt(body.studentId ?? body.student_id, 10);
    const amount = num(body.amount);
    if (!studentId) return bad(res, 'Choose the pupil the payment is for.');
    if (!(amount > 0)) return bad(res, 'Enter an amount greater than zero.');
    const student = db.prepare('SELECT id, surname, first_name FROM students WHERE id = ?').get(studentId);
    if (!student) return missing(res, 'That pupil is not on the roll.');

    const r = payments.recordFeePayment(db, {
      student_id: studentId,
      amount,
      payment_date: body.date || body.payment_date || todayISO(),
      payment_method: body.method || body.payment_method || 'Cash',
      reference: body.reference || null,
      received_by: ctx.user.id,
      notes: body.notes || null,
      source: 'office_payment',
    });
    if (!r.ok) return json(res, 400, r);
    audit(db, ctx, 'payment', r.payment_id, 'record_payment',
      `Fee payment ${r.receipt_number} — ${amount} for ${student.surname} ${student.first_name}`);
    return json(res, 200, r);
  });

  // Reversing a payment rewrites what a parent was told they had paid, so it
  // is held to the same bar the desktop holds it to: the Super Admin or the
  // Proprietor, a reason in writing, and a row in the audit trail. A bursar
  // with fees:delete cannot do it here any more than they can there.
  add('POST', `${API}/finance/collections/:id/reverse`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'fees', 'edit')) return undefined;
    if (!ctx.is_admin) return deny(res, 'Only the Super Admin or the Proprietor may reverse a payment.');
    const reason = String(body.reason || '').trim();
    if (reason.length < 5) return bad(res, 'Give the reason the payment is being reversed.');
    const pay = db.prepare('SELECT * FROM payments WHERE id = ?').get(parseInt(params.id, 10));
    if (!pay) return missing(res, 'That payment does not exist.');
    if (pay.is_reversed) return bad(res, 'That payment has already been reversed.');

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE payments SET is_reversed = 1, reversed_by = ?, reversal_reason = ?,
          reversed_at = datetime('now') WHERE id = ?
      `).run(ctx.user.id, reason, pay.id);
      if (pay.student_bill_id) {
        db.prepare(`
          UPDATE student_bills SET total_paid = total_paid - ?,
            balance = total_billed - (total_paid - ?) WHERE id = ?
        `).run(pay.amount, pay.amount, pay.student_bill_id);
      }
      // The ledger is not edited in place — a reversal is its own entry, so
      // the books show what happened rather than a number that changed.
      postExpense(db, {
        category: 'refund', amount: pay.amount,
        description: `Reversal of receipt ${pay.receipt_number} — ${reason}`,
        payment_method: pay.payment_method, reference: pay.receipt_number,
        date: todayISO(), term_id: pay.term_id, recorded_by: ctx.user.id, is_auto: 1,
      });
    });
    try { tx(); } catch (e) { return json(res, 400, { ok: false, error: `Could not reverse: ${e.message}` }); }

    try { require('./sync/outbox').enqueueStudentSnapshot(db, pay.student_id); } catch (_) {}
    audit(db, ctx, 'payment', pay.id, 'reverse_payment',
      `Reversed ${pay.receipt_number} (${pay.amount}): ${reason}`, 'high');
    return json(res, 200, { ok: true });
  });

  // ── A pupil's account ─────────────────────────────────────────────────────
  // Who to take money from, and what they owe. Searched rather than listed:
  // the office types two letters of a surname, not a page number.
  add('GET', `${API}/finance/students`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'fees')) return undefined;
    const term = currentTerm();
    const p = [term ? term.id : null];
    let sql = `
      SELECT s.id, s.index_number, s.surname, s.first_name, c.name AS class_name,
             COALESCE(b.total_billed,0) billed, COALESCE(b.total_paid,0) paid,
             COALESCE(b.balance,0) balance
      FROM students s
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      LEFT JOIN student_bills b ON b.student_id = s.id AND b.term_id = ?
        AND COALESCE(b.status,'active') = 'active'
      WHERE s.status = 'Active'
    `;
    if (query.classId) { sql += ' AND s.current_class_id = ?'; p.push(query.classId); }
    if (query.q) {
      sql += ' AND (s.surname LIKE ? OR s.first_name LIKE ? OR s.other_names LIKE ? OR s.index_number LIKE ?)';
      const like = `%${String(query.q).slice(0, 60)}%`;
      p.push(like, like, like, like);
    }
    if (String(query.owing || '') === '1') sql += ' AND COALESCE(b.balance,0) > 0';
    sql += ' ORDER BY s.surname, s.first_name LIMIT 200';
    return json(res, 200, {
      ok: true,
      students: db.prepare(sql).all(...p).map(r => ({
        ...r, name: `${r.surname || ''} ${r.first_name || ''}`.trim(),
      })),
    });
  });

  add('GET', `${API}/finance/students/:id/bill`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'fees')) return undefined;
    const sid = parseInt(params.id, 10);
    const student = db.prepare(`
      SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names, s.status,
             c.name AS class_name
      FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id WHERE s.id = ?
    `).get(sid);
    if (!student) return missing(res, 'That pupil is not on the roll.');
    const term = query.termId
      ? db.prepare('SELECT * FROM terms WHERE id = ?').get(parseInt(query.termId, 10))
      : currentTerm();
    const bill = term ? db.prepare(`
      SELECT * FROM student_bills WHERE student_id = ? AND term_id = ?
        AND COALESCE(status,'active') = 'active'
    `).get(sid, term.id) : null;
    const items = bill ? db.prepare(`
      SELECT item_number, description, amount, is_arrear
      FROM bill_line_items WHERE student_bill_id = ? ORDER BY is_arrear, item_number, id
    `).all(bill.id) : [];
    const history = db.prepare(`
      SELECT p.receipt_number, p.amount, p.payment_date, p.payment_method, p.reference,
             p.is_reversed, t.label AS term_label, u.full_name AS received_by_name
      FROM payments p LEFT JOIN terms t ON t.id = p.term_id
      LEFT JOIN users u ON u.id = p.received_by
      WHERE p.student_id = ? ORDER BY date(p.payment_date) DESC, p.id DESC LIMIT 100
    `).all(sid);
    const intents = db.prepare(`
      SELECT id, amount, channel, gateway, status, gateway_status, reference, created_at, acknowledged_at
      FROM payment_intents WHERE student_id = ? ORDER BY id DESC LIMIT 20
    `).all(sid);
    return json(res, 200, {
      ok: true,
      student: { ...student, name: `${student.surname || ''} ${student.first_name || ''}`.trim() },
      term: term ? { id: term.id, label: term.label } : null,
      bill: bill ? {
        billed: num(bill.total_billed), paid: num(bill.total_paid), balance: num(bill.balance),
        arrears: num(bill.arrears_from_prev), discount: num(bill.discount_amount),
        books_total: num(bill.books_total), books_paid: num(bill.books_paid),
        generated_at: bill.generated_at,
      } : null,
      items, history, intents,
    });
  });

  // ── Arrears ───────────────────────────────────────────────────────────────
  add('GET', `${API}/finance/debtors`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'fees')) return undefined;
    const term = currentTerm();
    if (!term) return json(res, 200, { ok: true, debtors: [], total: 0, by_class: [] });
    const p = [term.id];
    let sql = `
      SELECT s.id AS student_id, s.index_number, s.surname, s.first_name,
             c.id AS class_id, c.name AS class_name, b.balance, b.total_billed, b.total_paid,
             ROUND(julianday('now') - julianday(b.generated_at)) AS days_outstanding,
             (SELECT p2.phone FROM parents p2 JOIN parent_students ps ON ps.parent_id = p2.id
               WHERE ps.student_id = s.id LIMIT 1) AS guardian_phone
      FROM student_bills b
      JOIN students s ON s.id = b.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE b.term_id = ? AND b.balance > 0 AND s.status = 'Active'
        AND COALESCE(b.status,'active') = 'active'
    `;
    if (query.classId) { sql += ' AND s.current_class_id = ?'; p.push(query.classId); }
    if (query.min) { sql += ' AND b.balance >= ?'; p.push(num(query.min)); }
    sql += ' ORDER BY b.balance DESC LIMIT 500';
    const rows = db.prepare(sql).all(...p);
    const byClass = db.prepare(`
      SELECT c.name AS class_name, COUNT(*) n, COALESCE(SUM(b.balance),0) total
      FROM student_bills b JOIN students s ON s.id = b.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE b.term_id = ? AND b.balance > 0 AND s.status = 'Active'
        AND COALESCE(b.status,'active') = 'active'
      GROUP BY c.id ORDER BY total DESC
    `).all(term.id);
    return json(res, 200, {
      ok: true, term: { id: term.id, label: term.label },
      total: rows.reduce((n, r) => n + num(r.balance), 0),
      by_class: byClass,
      debtors: rows.map(r => ({ ...r, student_name: `${r.surname || ''} ${r.first_name || ''}`.trim() })),
    });
  });

  // ── Income and expenditure ────────────────────────────────────────────────
  add('GET', `${API}/finance/income`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'finance')) return undefined;
    const { from, to } = range(query, currentTerm());
    const p = [from, to];
    let sql = `
      SELECT ir.id, ir.receipt_number, ir.category, ir.subcategory, ir.amount, ir.payer_name,
             ir.description, ir.payment_method, ir.reference, ir.is_auto,
             COALESCE(ir.transaction_date, ir.date) AS date, u.full_name AS recorded_by_name
      FROM income_records ir LEFT JOIN users u ON u.id = ir.recorded_by
      WHERE COALESCE(ir.transaction_date, ir.date) BETWEEN ? AND ?
    `;
    if (query.category) { sql += ' AND ir.category = ?'; p.push(query.category); }
    sql += ' ORDER BY date DESC, ir.id DESC LIMIT 400';
    const rows = db.prepare(sql).all(...p);
    return json(res, 200, {
      ok: true, from, to, records: rows,
      total: rows.reduce((n, r) => n + num(r.amount), 0),
      may_record: can(ctx, 'finance', 'create'),
      categories: db.prepare(`
        SELECT category, COALESCE(SUM(amount),0) total, COUNT(*) n FROM income_records
        WHERE COALESCE(transaction_date, date) BETWEEN ? AND ?
        GROUP BY category ORDER BY total DESC
      `).all(from, to),
    });
  });

  add('POST', `${API}/finance/income`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'finance', 'create')) return undefined;
    const amount = num(body.amount);
    if (!body.category) return bad(res, 'Choose what the money is for.');
    if (!(amount > 0)) return bad(res, 'Enter an amount greater than zero.');
    // postIncome returns the new row's id, not a result object.
    const id = postIncome(db, {
      category: String(body.category), subcategory: body.subcategory || null, amount,
      payer_name: body.payer || body.payer_name || null,
      description: body.description || null,
      payment_method: body.method || body.payment_method || 'Cash',
      reference: body.reference || null, date: body.date || todayISO(),
      source: 'manual', recorded_by: ctx.user.id,
    });
    audit(db, ctx, 'income', id, 'record_income', `${body.category} ${amount}`);
    return json(res, 200, { ok: true, id });
  });

  add('GET', `${API}/finance/expenses`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'finance')) return undefined;
    const { from, to } = range(query, currentTerm());
    const p = [from, to];
    let sql = `
      SELECT er.id, er.transaction_number, er.category, er.subcategory, er.amount,
             er.payee_name, er.description, er.payment_method, er.reference, er.is_auto,
             COALESCE(er.transaction_date, er.date) AS date,
             u.full_name AS approved_by_name, ru.full_name AS recorded_by_name
      FROM expense_records er
      LEFT JOIN users u ON u.id = er.approved_by
      LEFT JOIN users ru ON ru.id = er.recorded_by
      WHERE COALESCE(er.transaction_date, er.date) BETWEEN ? AND ?
    `;
    if (query.category) { sql += ' AND er.category = ?'; p.push(query.category); }
    sql += ' ORDER BY date DESC, er.id DESC LIMIT 400';
    const rows = db.prepare(sql).all(...p);
    return json(res, 200, {
      ok: true, from, to, records: rows,
      total: rows.reduce((n, r) => n + num(r.amount), 0),
      may_record: can(ctx, 'finance', 'create'),
      categories: db.prepare(`
        SELECT category, COALESCE(SUM(amount),0) total, COUNT(*) n FROM expense_records
        WHERE COALESCE(transaction_date, date) BETWEEN ? AND ?
        GROUP BY category ORDER BY total DESC
      `).all(from, to),
    });
  });

  add('POST', `${API}/finance/expenses`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'finance', 'create')) return undefined;
    const amount = num(body.amount);
    if (!body.category) return bad(res, 'Choose what the money was spent on.');
    if (!body.description) return bad(res, 'Say what the payment was for.');
    if (!(amount > 0)) return bad(res, 'Enter an amount greater than zero.');
    const id = postExpense(db, {
      category: String(body.category), subcategory: body.subcategory || null, amount,
      payee_name: body.payee || body.payee_name || null,
      description: String(body.description),
      payment_method: body.method || body.payment_method || 'Cash',
      reference: body.reference || null, date: body.date || todayISO(),
      source: 'manual', recorded_by: ctx.user.id,
      // Approving your own expenditure is how a school's books stop meaning
      // anything. An account that may only *record* leaves it unapproved for
      // somebody with `finance: manage` to sign off on the desktop.
      approved_by: can(ctx, 'finance', 'edit') ? ctx.user.id : null,
    });
    audit(db, ctx, 'expense', id, 'record_expense', `${body.category} ${amount} — ${body.description}`);
    return json(res, 200, { ok: true, id });
  });

  // ── The statement ─────────────────────────────────────────────────────────
  // Income against expenditure for a term, by category and by month. The
  // desktop prints this; here it is the numbers, so a proprietor can read the
  // position of the school from a phone without asking anybody.
  add('GET', `${API}/finance/statement`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'finance')) return undefined;
    const term = query.termId
      ? db.prepare('SELECT * FROM terms WHERE id = ?').get(parseInt(query.termId, 10))
      : currentTerm();
    const { from, to } = range(query, term);
    const income = db.prepare(`
      SELECT category, COALESCE(SUM(amount),0) total, COUNT(*) n FROM income_records
      WHERE COALESCE(transaction_date, date) BETWEEN ? AND ? GROUP BY category ORDER BY total DESC
    `).all(from, to);
    const expense = db.prepare(`
      SELECT category, COALESCE(SUM(amount),0) total, COUNT(*) n FROM expense_records
      WHERE COALESCE(transaction_date, date) BETWEEN ? AND ? GROUP BY category ORDER BY total DESC
    `).all(from, to);
    const monthly = db.prepare(`
      SELECT ym, COALESCE(SUM(inc),0) income, COALESCE(SUM(exp),0) expense FROM (
        SELECT strftime('%Y-%m', COALESCE(transaction_date, date)) ym, amount inc, 0 exp
          FROM income_records WHERE COALESCE(transaction_date, date) BETWEEN ? AND ?
        UNION ALL
        SELECT strftime('%Y-%m', COALESCE(transaction_date, date)) ym, 0 inc, amount exp
          FROM expense_records WHERE COALESCE(transaction_date, date) BETWEEN ? AND ?
      ) GROUP BY ym ORDER BY ym
    `).all(from, to, from, to);
    const totalIncome = income.reduce((n, r) => n + num(r.total), 0);
    const totalExpense = expense.reduce((n, r) => n + num(r.total), 0);
    return json(res, 200, {
      ok: true, from, to,
      term: term ? { id: term.id, label: term.label } : null,
      income, expense, monthly,
      totals: { income: totalIncome, expense: totalExpense, net: totalIncome - totalExpense },
    });
  });

  // ── Payroll ───────────────────────────────────────────────────────────────
  // Read-only here, and deliberately. A payroll RUN calculates SSNIT and PAYE
  // against the school's rates and writes a month of salaries at once; that
  // belongs on the desktop where the schedules are printed and signed. What a
  // phone is good for is the answer to "has everyone been paid".
  add('GET', `${API}/finance/payroll`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'payroll')) return undefined;
    const now = new Date();
    const month = parseInt(query.month, 10) || (now.getMonth() + 1);
    const year = parseInt(query.year, 10) || now.getFullYear();
    const rows = db.prepare(`
      SELECT ss.id, ss.staff_id, ss.gross_salary, ss.extra_pay, ss.ssnit_worker, ss.ssnit_employer,
             ss.paye_tax, ss.other_deductions, ss.net_salary, ss.actual_amount_paid,
             ss.carry_over_to_next, ss.is_paid, ss.payment_date, ss.payment_method,
             st.staff_number, st.surname, st.first_name, st.role, d.name AS designation
      FROM staff_salaries ss
      JOIN staff st ON st.id = ss.staff_id
      LEFT JOIN designations d ON d.id = st.designation_id
      WHERE ss.month = ? AND ss.year = ?
      ORDER BY st.surname, st.first_name
    `).all(month, year);
    const sum = (k) => rows.reduce((n, r) => n + num(r[k]), 0);
    return json(res, 200, {
      ok: true, month, year,
      rows: rows.map(r => ({ ...r, staff_name: `${r.surname || ''} ${r.first_name || ''}`.trim() })),
      totals: {
        staff: rows.length, gross: sum('gross_salary'), net: sum('net_salary'),
        ssnit_worker: sum('ssnit_worker'), ssnit_employer: sum('ssnit_employer'),
        paye: sum('paye_tax'), paid: rows.filter(r => r.is_paid).length,
        paid_total: rows.reduce((n, r) => n + (r.is_paid ? num(r.actual_amount_paid) : 0), 0),
      },
      // Kept under both names: `rows` is what this route has always answered
      // and `salaries` is what the online school calls it, and a screen that
      // reads one and is handed the other shows an empty run with no error.
      salaries: rows.map(r => ({ ...r, staff_name: `${r.surname || ''} ${r.first_name || ''}`.trim() })),
      // The run used to stay on the desktop and this said so. It does not any
      // more — see POST /payroll/run in office_api.js — and a flag telling the
      // browser to hide its own working button is worse than no flag.
      run_is_desktop_only: false,
    });
  });

  add('GET', `${API}/finance/payroll/:staffId/payslip`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'payroll')) return undefined;
    const staffId = parseInt(params.staffId, 10);
    const now = new Date();
    const month = parseInt(query.month, 10) || (now.getMonth() + 1);
    const year = parseInt(query.year, 10) || now.getFullYear();
    const row = db.prepare(`
      SELECT ss.*, st.staff_number, st.surname, st.first_name, st.other_names, st.role,
             st.ssnit_number, st.bank_name, st.bank_account, d.name AS designation
      FROM staff_salaries ss JOIN staff st ON st.id = ss.staff_id
      LEFT JOIN designations d ON d.id = st.designation_id
      WHERE ss.staff_id = ? AND ss.month = ? AND ss.year = ?
    `).get(staffId, month, year);
    if (!row) return missing(res, 'No payslip for that month.');
    return json(res, 200, {
      ok: true,
      payslip: { ...row, staff_name: `${row.surname || ''} ${row.first_name || ''}`.trim() },
      school: { name: getSetting(db, 'school_name', 'School') },
    });
  });

  // ── Payments taken online ─────────────────────────────────────────────────
  // The reconciliation screen. A gateway payment that settled has already been
  // recorded by the webhook and appears here as history; what needs a person
  // is the parent who declared a transfer, and the gateway charge that never
  // came back. See server/payments_service.js for how settlement works.
  add('GET', `${API}/finance/online`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!gate(ctx, res, 'fees')) return undefined;
    const status = ['pending', 'acknowledged', 'rejected'].includes(query.status) ? query.status : 'pending';
    const rows = db.prepare(`
      SELECT pi.id, pi.uuid, pi.amount, pi.channel, pi.gateway, pi.gateway_reference,
             pi.gateway_status, pi.reference, pi.notes, pi.status, pi.created_at,
             pi.acknowledged_at, pi.payment_id, pi.currency,
             s.id AS student_id, s.surname, s.first_name, s.index_number,
             c.name AS class_name, p.full_name AS parent_name, p.phone AS parent_phone,
             pay.receipt_number
      FROM payment_intents pi
      JOIN students s ON s.id = pi.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      LEFT JOIN parents p ON p.id = pi.parent_id
      LEFT JOIN payments pay ON pay.id = pi.payment_id
      WHERE pi.status = ? ORDER BY pi.id DESC LIMIT 200
    `).all(status);
    const gateway = getSetting(db, 'payment_gateway', 'none');
    return json(res, 200, {
      ok: true, status,
      may_acknowledge: can(ctx, 'fees', 'edit'),
      gateway: { id: gateway, live: gateway !== 'none' && !!getSetting(db, 'paystack_secret_key', '') },
      counts: {
        pending: db.prepare("SELECT COUNT(*) c FROM payment_intents WHERE status='pending'").get().c,
        acknowledged: db.prepare("SELECT COUNT(*) c FROM payment_intents WHERE status='acknowledged'").get().c,
        rejected: db.prepare("SELECT COUNT(*) c FROM payment_intents WHERE status='rejected'").get().c,
      },
      intents: rows.map(r => ({ ...r, student_name: `${r.surname || ''} ${r.first_name || ''}`.trim() })),
    });
  });

  add('POST', `${API}/finance/online/:id/acknowledge`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'fees', 'edit')) return undefined;
    const r = payments.acknowledgeIntent(db, parseInt(params.id, 10), {
      actorUserId: ctx.user.id, method: body.method,
    });
    if (!r.ok) return json(res, 400, r);
    audit(db, ctx, 'payment_intent', parseInt(params.id, 10), 'acknowledge_intent',
      `Acknowledged as receipt ${r.receipt_number}`);
    return json(res, 200, r);
  });

  add('POST', `${API}/finance/online/:id/reject`, async (ctx, req, res, params, body) => {
    if (!gate(ctx, res, 'fees', 'edit')) return undefined;
    const reason = String(body.reason || '').trim();
    if (reason.length < 3) return bad(res, 'Say why it is being rejected — the parent is told.');
    const r = payments.rejectIntent(db, parseInt(params.id, 10), { actorUserId: ctx.user.id, reason });
    if (!r.ok) return json(res, 400, r);
    audit(db, ctx, 'payment_intent', parseInt(params.id, 10), 'reject_intent', reason);
    return json(res, 200, r);
  });

  // Ask the gateway again about a charge nobody heard back about. Read-only
  // as far as the parent is concerned — it settles only if the GATEWAY says
  // the money arrived, never because somebody in the office pressed a button.
  add('POST', `${API}/finance/online/:id/verify`, async (ctx, req, res, params) => {
    if (!gate(ctx, res, 'fees', 'edit')) return undefined;
    const intent = db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(parseInt(params.id, 10));
    if (!intent) return missing(res, 'That payment does not exist.');
    if (!intent.gateway_reference) return bad(res, 'That payment was not taken through the gateway.');
    const r = await payments.verifyAndSettle(db, intent.gateway_reference, { actorUserId: ctx.user.id });
    if (r.ok) audit(db, ctx, 'payment_intent', intent.id, 'verify_intent', `Settled ${intent.gateway_reference}`);
    return json(res, r.ok ? 200 : 400, r);
  });
}

module.exports = { registerFinanceRoutes };
