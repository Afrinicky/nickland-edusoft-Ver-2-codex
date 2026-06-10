// Staff IPC handlers — manages teaching and non-teaching staff, salaries, payroll.
const fs = require('fs');
const path = require('path');
const { getSetting } = require('../utils/idgen');

function registerStaffHandlers(ipcMain, db, userDataPath) {
  // List staff
  ipcMain.handle('staff:list', (_e, filters = {}) => {
    let sql = 'SELECT * FROM staff WHERE 1=1';
    const params = [];
    if (filters.role) { sql += ' AND role = ?'; params.push(filters.role); }
    if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
    if (filters.search) {
      sql += ' AND (surname LIKE ? OR first_name LIKE ? OR staff_number LIKE ?)';
      const q = `%${filters.search}%`;
      params.push(q, q, q);
    }
    sql += ' ORDER BY surname, first_name';
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('staff:get', (_e, id) => {
    const s = db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
    if (!s) return null;
    s.assignments = db.prepare(`
      SELECT sa.*, c.name AS class_name, sub.name AS subject_name, t.label AS term_label
      FROM staff_assignments sa
      LEFT JOIN class_groups c ON c.id = sa.class_group_id
      LEFT JOIN subjects sub ON sub.id = sa.subject_id
      LEFT JOIN terms t ON t.id = sa.term_id
      WHERE sa.staff_id = ?
    `).all(id);
    return s;
  });

  ipcMain.handle('staff:create', (_e, data) => {
    // Generate staff number if not provided
    let staffNumber = data.staff_number;
    if (!staffNumber) {
      const lastNo = db.prepare(`
        SELECT staff_number FROM staff WHERE staff_number LIKE 'STAFF/%'
        ORDER BY id DESC LIMIT 1
      `).get();
      let next = 1;
      if (lastNo) {
        const m = String(lastNo.staff_number).match(/STAFF\/(\d+)/);
        if (m) next = parseInt(m[1], 10) + 1;
      }
      staffNumber = `STAFF/${String(next).padStart(4, '0')}`;
    }
    const result = db.prepare(`
      INSERT INTO staff (
        staff_number, surname, first_name, other_names, gender, date_of_birth,
        phone, email, address, role, status, qualification, specialization,
        bank_account, bank_name, ssnit_number, ssnit_enrolled, hire_date,
        base_salary, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      staffNumber, data.surname || '', data.first_name || '', data.other_names || '',
      data.gender || '', data.date_of_birth || null, data.phone || '', data.email || '',
      data.address || '', data.role, data.status || 'Active',
      data.qualification || '', data.specialization || '',
      data.bank_account || '', data.bank_name || '',
      data.ssnit_number || '', data.ssnit_enrolled ? 1 : 0,
      data.hire_date || new Date().toISOString().slice(0, 10),
      data.base_salary || 0, data.notes || ''
    );
    return { ok: true, id: result.lastInsertRowid, staff_number: staffNumber };
  });

  ipcMain.handle('staff:update', (_e, { id, data }) => {
    const fields = [
      'surname', 'first_name', 'other_names', 'gender', 'date_of_birth',
      'phone', 'email', 'address', 'role', 'status', 'qualification',
      'specialization', 'bank_account', 'bank_name', 'ssnit_number',
      'ssnit_enrolled', 'hire_date', 'stop_date', 'base_salary', 'notes',
    ];
    const setClauses = [];
    const params = [];
    for (const f of fields) {
      if (data[f] !== undefined) {
        setClauses.push(`${f} = ?`);
        params.push(data[f]);
      }
    }
    if (setClauses.length === 0) return { ok: true };
    params.push(id);
    db.prepare(`UPDATE staff SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
    return { ok: true };
  });

  ipcMain.handle('staff:delete', (_e, id) => {
    db.prepare("UPDATE staff SET status = 'Stopped', stop_date = ? WHERE id = ?")
      .run(new Date().toISOString().slice(0, 10), id);
    return { ok: true };
  });

  ipcMain.handle('staff:upload-photo', (_e, { staffId, sourcePath }) => {
    const ext = path.extname(sourcePath) || '.png';
    const dest = path.join(userDataPath, 'uploads', 'staff');
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const destPath = path.join(dest, `${staffId}${ext}`);
    fs.copyFileSync(sourcePath, destPath);
    db.prepare('UPDATE staff SET photo_path = ? WHERE id = ?').run(destPath, staffId);
    return { ok: true, path: destPath };
  });

  // ===== Salaries =====
  ipcMain.handle('staff:list-salaries', (_e, staffId) => {
    return db.prepare(`
      SELECT * FROM staff_salaries WHERE staff_id = ?
      ORDER BY year DESC, month DESC
    `).all(staffId);
  });

  ipcMain.handle('staff:save-salary', (_e, data) => {
    // Compute SSNIT and net based on flags
    const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(data.staff_id);
    const ssnitWorkerPct = parseFloat(getSetting(db, 'ssnit_worker_pct', '5.5'));
    const ssnitEmployerPct = parseFloat(getSetting(db, 'ssnit_employer_pct', '13.0'));

    const gross = parseFloat(data.gross_salary) || 0;
    const extra = parseFloat(data.extra_pay) || 0;
    const arrearBf = parseFloat(data.arrear_brought_forward) || 0;
    const grossTotal = gross + extra + arrearBf;

    let ssnitWorker = 0, ssnitEmployer = 0;
    if (staff && staff.ssnit_enrolled) {
      ssnitWorker = gross * (ssnitWorkerPct / 100);
      ssnitEmployer = gross * (ssnitEmployerPct / 100);
    }
    const paye = parseFloat(data.paye_tax) || 0;
    const otherDed = parseFloat(data.other_deductions) || 0;
    const net = grossTotal - ssnitWorker - paye - otherDed;
    const actualPaid = data.actual_amount_paid !== undefined
      ? parseFloat(data.actual_amount_paid) : net;
    const carryOver = net - actualPaid;

    const existing = db.prepare(`
      SELECT id FROM staff_salaries WHERE staff_id = ? AND month = ? AND year = ?
    `).get(data.staff_id, data.month, data.year);

    if (existing) {
      db.prepare(`
        UPDATE staff_salaries SET
          gross_salary = ?, extra_pay = ?, extra_pay_description = ?,
          arrear_brought_forward = ?, ssnit_worker = ?, ssnit_employer = ?,
          paye_tax = ?, other_deductions = ?, other_deductions_description = ?,
          net_salary = ?, actual_amount_paid = ?, carry_over_to_next = ?,
          payment_date = ?, payment_method = ?, payment_reference = ?,
          is_paid = ?, notes = ?
        WHERE id = ?
      `).run(
        gross, extra, data.extra_pay_description || '',
        arrearBf, ssnitWorker, ssnitEmployer,
        paye, otherDed, data.other_deductions_description || '',
        net, actualPaid, carryOver,
        data.payment_date || null, data.payment_method || '', data.payment_reference || '',
        data.is_paid ? 1 : 0, data.notes || '',
        existing.id
      );
      return { ok: true, id: existing.id };
    } else {
      const result = db.prepare(`
        INSERT INTO staff_salaries (
          staff_id, month, year, gross_salary, extra_pay, extra_pay_description,
          arrear_brought_forward, ssnit_worker, ssnit_employer, paye_tax,
          other_deductions, other_deductions_description, net_salary,
          actual_amount_paid, carry_over_to_next, payment_date, payment_method,
          payment_reference, is_paid, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.staff_id, data.month, data.year, gross, extra, data.extra_pay_description || '',
        arrearBf, ssnitWorker, ssnitEmployer, paye, otherDed,
        data.other_deductions_description || '', net, actualPaid, carryOver,
        data.payment_date || null, data.payment_method || '', data.payment_reference || '',
        data.is_paid ? 1 : 0, data.notes || ''
      );
      // Add to expense ledger if paid
      if (data.is_paid && actualPaid > 0) {
        db.prepare(`
          INSERT INTO expense_records (date, category, description, amount, paid_to, linked_salary_id)
          VALUES (?, 'salary', ?, ?, ?, ?)
        `).run(
          data.payment_date || new Date().toISOString().slice(0, 10),
          `Salary ${data.month}/${data.year}`, actualPaid,
          `${staff.surname} ${staff.first_name}`, result.lastInsertRowid
        );
      }
      return { ok: true, id: result.lastInsertRowid };
    }
  });

  ipcMain.handle('staff:payroll-summary', (_e, { month, year }) => {
    return db.prepare(`
      SELECT s.id, s.staff_number, s.surname, s.first_name, s.role, s.status,
             sal.gross_salary, sal.extra_pay, sal.arrear_brought_forward,
             sal.ssnit_worker, sal.paye_tax, sal.other_deductions,
             sal.net_salary, sal.actual_amount_paid, sal.carry_over_to_next,
             sal.is_paid, sal.id AS salary_id
      FROM staff s
      LEFT JOIN staff_salaries sal ON sal.staff_id = s.id AND sal.month = ? AND sal.year = ?
      WHERE s.status = 'Active'
      ORDER BY s.role, s.surname
    `).all(month, year);
  });
}

module.exports = registerStaffHandlers;
