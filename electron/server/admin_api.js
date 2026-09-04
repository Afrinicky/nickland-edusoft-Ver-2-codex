// Nickland Edusoft — running the school, and running the system.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Two portals live here because they share a shape and nothing else:
//
//   /admin/*   Administration — the head teacher, the management, the office.
//              Enrolment and pupil records, staff and leave, academic
//              oversight, the approvals somebody has to actually make, notices.
//
//   /system/*  The system itself — the Super Admin alone. User accounts,
//              access levels, the audit trail, school settings, sync, backups.
//              Not the Proprietor: they own the school and are elevated over
//              its money, but the person who can quietly rewrite who may see
//              what is a different person on purpose.
//
// The portal split is not the security. Every route still checks the module
// permission the desktop checks, and /system additionally requires the
// designation itself — being the Super Admin, not merely holding a `settings`
// tick that somebody granted by mistake.
//
// Three things are deliberately NOT here, and should not be added:
//
//   • Approving a password reset. That happens on the desktop, face to face,
//     because the whole point of the code the Super Admin reads out is that
//     the person asking is standing in front of them. Raising and redeeming a
//     request are already reachable remotely; approval is the human step.
//   • Any read of a stored gateway secret. Settings answer whether a key is
//     configured, never what it is.
//   • Deleting anything financial. A phone is where things are read and
//     approved; destruction stays where the audit trail is printed.

const portals = require('../ipc/_portals');
const access = require('../ipc/_access');

function todayISO() { return new Date().toISOString().slice(0, 10); }
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// The settings a portal may read and write. A whitelist, not a filter: the
// settings table also holds counters, gateway secrets and sync keys, and a
// blanket "everything except…" is one forgotten key away from serving one.
const SETTINGS_READABLE = [
  'school_name', 'school_abbreviation', 'school_motto', 'school_type', 'school_address',
  'school_location', 'school_digital_address', 'school_phone_1', 'school_phone_2',
  'school_email', 'school_website', 'school_whatsapp',
  'payment_currency', 'canteen_daily_rate', 'vacation_date', 'reopening_date',
  'current_exam_title', 'mobile_parent_self_register', 'mobile_token_ttl_days',
  'payment_gateway', 'paystack_public_key', 'paystack_base_url', 'paystack_callback_url',
  'online_payments_enabled', 'online_payment_min', 'online_payment_max',
];
// Written, but never read back. A secret that a screen can display is a secret
// that a screenshot can carry out of the building.
const SETTINGS_WRITE_ONLY = ['paystack_secret_key'];
const SETTINGS_WRITABLE = new Set([...SETTINGS_READABLE, ...SETTINGS_WRITE_ONLY]);

function registerAdminRoutes({ add, db, json, can, API, getSetting, setSetting, media, audit }) {
  const deny = (res, msg) => json(res, 403, { ok: false, error: msg || 'Access denied.' });
  const bad = (res, msg) => json(res, 400, { ok: false, error: msg });
  const missing = (res, msg) => json(res, 404, { ok: false, error: msg || 'Not found.' });

  const currentTerm = () => {
    try { return db.prepare('SELECT * FROM terms WHERE is_current = 1').get() || null; }
    catch (_) { return null; }
  };

  // The gate on these routes is the MODULE, and only the module.
  //
  // It used to be the administration portal as well, and that was right while
  // the app was four portals: a bursar had no administration screen, so a
  // bursar had no business at an administration route. The app is modules now,
  // exactly as the desktop has always been — a person holding Students at
  // Manage is shown Students and the sheet inside it, whether or not they also
  // hold the staff register — and a portal check here would refuse the very
  // screen the module system just drew for them. A module a person may not use
  // is still never drawn; that rule is unchanged and is enforced in the same
  // permission map both sides read.
  //
  // Nothing is widened by this. `can()` is the same check the desktop makes on
  // the same resolved permissions, and every route below still names the
  // module and the action it needs.
  const adminGate = (ctx, res, module, action = 'view') => {
    if (!ctx || ctx.role !== 'staff') { deny(res, 'Staff only.'); return false; }
    if (module) {
      if (!can(ctx, module, action)) {
        deny(res, `Access denied. You do not have permission to ${action} ${module}.`);
        return false;
      }
      return true;
    }
    // The cross-module summary. It reports each part only to an account that
    // holds that part (see `may` below), so the gate is simply: does this
    // person hold any of it? Somebody granted nothing is told no, once, rather
    // than handed a page of zeroes.
    const any = ['students', 'staff', 'academics', 'fees', 'dashboard']
      .some(m => can(ctx, m, 'view'));
    if (!any) { deny(res); return false; }
    return true;
  };

  // The system portal is the Super Admin, full stop. The designation is
  // resolved from the live user row on every request (see subjectContext in
  // api.js), so a role changed in the office takes effect on the next tap and
  // not on the next sign-in.
  const systemGate = (ctx, res) => {
    if (!ctx || ctx.role !== 'staff') { deny(res, 'Staff only.'); return false; }
    if (!portals.isSuperAdmin(ctx) || !portals.hasPortal(ctx, 'system')) { deny(res); return false; }
    return true;
  };

  // ══ Administration ════════════════════════════════════════════════════════

  // The school this morning. Enrolment, who turned up, the staff room, what is
  // waiting to be approved — and the fee position only if this account may see
  // fees at all. A head teacher without finance gets the school without the
  // money, not the school with zeroes in it.
  add('GET', `${API}/admin/overview`, async (ctx, req, res) => {
    if (!adminGate(ctx, res, null)) return undefined;
    const term = currentTerm();
    const today = todayISO();
    const out = {
      ok: true, date: today,
      term: term ? { id: term.id, label: term.label, start_date: term.start_date, end_date: term.end_date } : null,
      school: { name: getSetting(db, 'school_name', 'School') },
      may: {
        students: can(ctx, 'students', 'view'), staff: can(ctx, 'staff', 'view'),
        academics: can(ctx, 'academics', 'view'), fees: can(ctx, 'fees', 'view'),
        notifications: can(ctx, 'notifications', 'view'),
      },
    };

    if (can(ctx, 'students', 'view')) {
      out.enrolment = db.prepare(`
        SELECT COUNT(*) total,
               COUNT(*) FILTER (WHERE gender = 'Male') boys,
               COUNT(*) FILTER (WHERE gender = 'Female') girls
        FROM students WHERE status = 'Active'
      `).get();
      out.by_class = db.prepare(`
        SELECT c.id, c.name, c.short_code, COUNT(s.id) pupils
        FROM class_groups c LEFT JOIN students s ON s.current_class_id = c.id AND s.status = 'Active'
        GROUP BY c.id ORDER BY c.level_order, c.name
      `).all();
      // A register belongs to a pupil, not to a class — the class is reached
      // through the pupil's current class, which is also what makes "how many
      // classes were marked today" answerable at all.
      const att = db.prepare(`
        SELECT COUNT(*) FILTER (WHERE a.status = 'present') present,
               COUNT(*) FILTER (WHERE a.status = 'absent') absent,
               COUNT(DISTINCT s.current_class_id) classes_marked
        FROM student_attendance a JOIN students s ON s.id = a.student_id
        WHERE a.date = ?
      `).get(today);
      out.attendance = {
        ...att,
        classes_total: out.by_class.filter(c => c.pupils > 0).length,
        rate: (att.present + att.absent) ? Math.round((att.present / (att.present + att.absent)) * 100) : null,
      };
      out.admissions_this_term = term ? db.prepare(`
        SELECT COUNT(*) c FROM students
        WHERE date(COALESCE(admission_date, created_at)) BETWEEN date(?) AND date(?)
      `).get(term.start_date || '1970-01-01', term.end_date || '2099-12-31').c : 0;
    }

    if (can(ctx, 'staff', 'view')) {
      out.staff = db.prepare(`
        SELECT COUNT(*) total,
               COUNT(*) FILTER (WHERE role LIKE '%each%') teaching
        FROM staff WHERE status = 'Active'
      `).get();
      out.staff.clocked_in = db.prepare(
        "SELECT COUNT(*) c FROM staff_attendance WHERE date = ? AND status = 'present'"
      ).get(today).c;
      out.approvals = {
        leave: db.prepare("SELECT COUNT(*) c FROM leave_requests WHERE status = 'pending'").get().c,
      };
    }

    if (can(ctx, 'academics', 'view')) {
      out.approvals = out.approvals || {};
      out.approvals.lesson_notes = db.prepare(
        "SELECT COUNT(*) c FROM lesson_notes WHERE COALESCE(status,'draft') = 'submitted'"
      ).get().c;
    }

    if (term && can(ctx, 'fees', 'view')) {
      const f = db.prepare(`
        SELECT COALESCE(SUM(total_billed),0) billed, COALESCE(SUM(balance),0) outstanding
        FROM student_bills WHERE term_id = ? AND COALESCE(status,'active') = 'active'
      `).get(term.id);
      const collected = db.prepare(
        'SELECT COALESCE(SUM(amount),0) t FROM payments WHERE term_id = ? AND is_reversed = 0'
      ).get(term.id).t;
      out.fees = {
        billed: num(f.billed), collected: num(collected), outstanding: num(f.outstanding),
        collection_rate: f.billed ? Math.round((collected / f.billed) * 100) : 0,
      };
    }

    return json(res, 200, out);
  });

  // The whole roll, not one teacher's classes. That is the difference between
  // this route and /students, and it is why it sits behind the admin portal:
  // an account that runs the school sees the school.
  add('GET', `${API}/admin/students`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!adminGate(ctx, res, 'students')) return undefined;
    const status = ['Active', 'Withdrawn', 'Graduated', 'Suspended'].includes(query.status)
      ? query.status : 'Active';
    const p = [status];
    let sql = `
      SELECT s.id, s.index_number, s.surname, s.first_name, s.other_names, s.gender,
             s.date_of_birth, s.status, s.admission_date, c.name AS class_name,
             s.current_class_id
      FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
      WHERE s.status = ?
    `;
    if (query.classId) { sql += ' AND s.current_class_id = ?'; p.push(query.classId); }
    if (query.q) {
      sql += ' AND (s.surname LIKE ? OR s.first_name LIKE ? OR s.other_names LIKE ? OR s.index_number LIKE ?)';
      const like = `%${String(query.q).slice(0, 60)}%`;
      p.push(like, like, like, like);
    }
    sql += ' ORDER BY s.surname, s.first_name LIMIT 500';
    return json(res, 200, {
      ok: true, status,
      may_admit: can(ctx, 'students', 'create'),
      may_edit: can(ctx, 'students', 'edit'),
      students: db.prepare(sql).all(...p).map(r => ({
        ...r, name: `${r.surname || ''} ${r.first_name || ''}`.trim(),
      })),
    });
  });

  // Admitting a pupil. The desktop's admissions form asks for more than this
  // and should — a photograph, the guardians, the medical note. What is here
  // is what an office can honestly complete from a phone with a parent
  // standing at the gate; the rest is filled in on the record afterwards.
  add('POST', `${API}/admin/students`, async (ctx, req, res, params, body) => {
    if (!adminGate(ctx, res, 'students', 'create')) return undefined;
    const surname = String(body.surname || '').trim();
    const firstName = String(body.firstName || body.first_name || '').trim();
    if (!surname || !firstName) return bad(res, 'A surname and a first name are required.');
    const classId = body.classId ? parseInt(body.classId, 10) : null;
    if (classId && !db.prepare('SELECT id FROM class_groups WHERE id = ?').get(classId)) {
      return bad(res, 'That class does not exist.');
    }
    let indexNumber = String(body.indexNumber || body.index_number || '').trim();
    if (indexNumber && db.prepare('SELECT id FROM students WHERE index_number = ?').get(indexNumber)) {
      return bad(res, 'That admission number is already in use.');
    }
    if (!indexNumber) {
      // Same shape the desktop generates: the year, then a running count.
      const year = new Date().getFullYear();
      const n = db.prepare("SELECT COUNT(*) c FROM students WHERE index_number LIKE ?").get(`${year}/%`).c;
      indexNumber = `${year}/${String(n + 1).padStart(4, '0')}`;
    }
    const r = db.prepare(`
      INSERT INTO students (index_number, surname, first_name, other_names, gender,
        date_of_birth, current_class_id, admission_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active')
    `).run(indexNumber, surname, firstName, body.otherNames || body.other_names || null,
      body.gender || null, body.dateOfBirth || body.date_of_birth || null,
      classId, body.admissionDate || todayISO());

    try { require('./sync/outbox').enqueueStudentSnapshot(db, r.lastInsertRowid); } catch (_) {}
    audit(db, ctx, 'student', r.lastInsertRowid, 'admit_student', `${surname} ${firstName} (${indexNumber})`);
    return json(res, 200, { ok: true, id: r.lastInsertRowid, index_number: indexNumber });
  });

  // Correcting a pupil's record.
  //
  // The web app's Students Sheet is the desktop's spreadsheet view: a whole
  // class on screen, corrected in place, the way an office actually works
  // through a pile of admission forms. Without this route it could show the
  // sheet and not save it.
  //
  // The editable list is the same one the online school allows
  // (cloud-python/app/school/students.py EDITABLE) so a correction made in a
  // browser on the school Wi-Fi and the same correction made over the internet
  // change the same set of columns. Everything else about a pupil — the
  // admission number, the photograph, the audit trail — is not editable from
  // here at all.
  add('POST', `${API}/admin/students/:id`, async (ctx, req, res, params, body) => {
    if (!adminGate(ctx, res, 'students', 'edit')) return undefined;
    const id = parseInt(params.id, 10);
    const existing = db.prepare('SELECT id, surname, first_name, current_class_id FROM students WHERE id = ?').get(id);
    if (!existing) return json(res, 404, { ok: false, error: 'That pupil is not on the roll.' });

    const EDITABLE = [
      'surname', 'first_name', 'other_names', 'gender', 'denomination', 'date_of_birth',
      'place_of_birth', 'place_of_residence', 'street_address', 'house_number',
      'digital_address', 'nhis_number', 'father_name', 'father_contact', 'father_email',
      'mother_name', 'mother_contact', 'mother_email', 'guardian_name', 'guardian_contact',
      'guardian_email', 'current_class_id', 'admission_date', 'notes',
    ];
    const patch = {};
    for (const k of EDITABLE) if (Object.prototype.hasOwnProperty.call(body, k)) patch[k] = body[k];
    if (!Object.keys(patch).length) return bad(res, 'Nothing to change.');

    if (patch.current_class_id
        && Number(patch.current_class_id) !== Number(existing.current_class_id)
        && !db.prepare('SELECT id FROM class_groups WHERE id = ?').get(patch.current_class_id)) {
      return bad(res, 'That class does not exist.');
    }
    if ('surname' in patch && !String(patch.surname || '').trim()) return bad(res, 'A surname is required.');
    if ('first_name' in patch && !String(patch.first_name || '').trim()) return bad(res, 'A first name is required.');

    const cols = Object.keys(patch);
    db.prepare(`UPDATE students SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map(c => (patch[c] === '' ? null : patch[c])), id);

    try { require('./sync/outbox').enqueueStudentSnapshot(db, id); } catch (_) {}
    audit(db, ctx, 'student', id, 'update_student',
      `${existing.surname} ${existing.first_name}: ${cols.join(', ')}`);
    return json(res, 200, { ok: true });
  });

  // Withdrawing, graduating or readmitting. A status change is what a parent
  // notices first — the app stops showing their child — so it is audited with
  // the reason, and the reason is required.
  add('POST', `${API}/admin/students/:id/status`, async (ctx, req, res, params, body) => {
    if (!adminGate(ctx, res, 'students', 'edit')) return undefined;
    const allowed = ['Active', 'Withdrawn', 'Graduated', 'Suspended'];
    const status = String(body.status || '');
    if (!allowed.includes(status)) return bad(res, 'That is not a status a pupil can be put into.');
    const reason = String(body.reason || '').trim();
    if (status !== 'Active' && reason.length < 3) return bad(res, 'Give the reason.');
    const sid = parseInt(params.id, 10);
    const student = db.prepare('SELECT id, surname, first_name, status FROM students WHERE id = ?').get(sid);
    if (!student) return missing(res, 'That pupil is not on the roll.');
    db.prepare('UPDATE students SET status = ? WHERE id = ?').run(status, sid);
    try { require('./sync/outbox').enqueueStudentSnapshot(db, sid); } catch (_) {}
    audit(db, ctx, 'student', sid, 'student_status',
      `${student.surname} ${student.first_name}: ${student.status} → ${status}${reason ? ` (${reason})` : ''}`,
      status === 'Active' ? 'normal' : 'high');
    return json(res, 200, { ok: true });
  });

  // ── Staff ─────────────────────────────────────────────────────────────────
  add('GET', `${API}/admin/staff`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!adminGate(ctx, res, 'staff')) return undefined;
    const status = ['Active', 'Inactive', 'Resigned'].includes(query.status) ? query.status : 'Active';
    const rows = db.prepare(`
      SELECT st.id, st.staff_number, st.surname, st.first_name, st.other_names, st.gender,
             st.phone, st.email, st.role, st.status, st.hire_date, d.name AS designation,
             (SELECT COUNT(*) FROM staff_assignments sa WHERE sa.staff_id = st.id) assignments,
             (SELECT status FROM staff_attendance a WHERE a.staff_id = st.id AND a.date = ?) today
      FROM staff st LEFT JOIN designations d ON d.id = st.designation_id
      WHERE st.status = ? ORDER BY st.surname, st.first_name
    `).all(todayISO(), status);
    return json(res, 200, {
      ok: true, status,
      may_edit: can(ctx, 'staff', 'edit'),
      may_add: can(ctx, 'staff', 'create'),
      // The designations, with the roll: a form that asks what somebody's job
      // is needs the school's own list of jobs, and fetching it from the user
      // table would put a Super Admin's screen behind a staff screen.
      designations: db.prepare('SELECT id, name FROM designations ORDER BY name').all(),
      staff: rows.map(r => ({ ...r, name: `${r.surname || ''} ${r.first_name || ''}`.trim() })),
    });
  });

  add('GET', `${API}/admin/staff/:id`, async (ctx, req, res, params) => {
    if (!adminGate(ctx, res, 'staff')) return undefined;
    const id = parseInt(params.id, 10);
    const st = db.prepare(`
      SELECT st.*, d.name AS designation FROM staff st
      LEFT JOIN designations d ON d.id = st.designation_id WHERE st.id = ?
    `).get(id);
    if (!st) return missing(res, 'No such member of staff.');
    // A salary is payroll, not staff. Someone who may see the staff register
    // is not thereby entitled to what everybody earns.
    const showPay = can(ctx, 'payroll', 'view');
    const { base_salary, bank_account, bank_name, ssnit_number, ...rest } = st;
    const assignments = db.prepare(`
      SELECT sa.class_group_id, c.name AS class_name, sa.subject_id, s.name AS subject_name,
             sa.is_class_teacher
      FROM staff_assignments sa
      LEFT JOIN class_groups c ON c.id = sa.class_group_id
      LEFT JOIN subjects s ON s.id = sa.subject_id
      WHERE sa.staff_id = ?
    `).all(id);
    const month = new Date().toISOString().slice(0, 7);
    const attendance = db.prepare(`
      SELECT date, status, clock_in, clock_out FROM staff_attendance
      WHERE staff_id = ? AND date LIKE ? ORDER BY date DESC
    `).all(id, `${month}%`);
    const leave = db.prepare(`
      SELECT id, leave_type, start_date, end_date, days_requested, status, created_at
      FROM leave_requests WHERE staff_id = ? ORDER BY id DESC LIMIT 20
    `).all(id);
    return json(res, 200, {
      ok: true,
      staff: {
        ...rest, photo: media.dataUri(st.photo_path),
        name: `${st.surname || ''} ${st.first_name || ''}`.trim(),
        ...(showPay ? { base_salary, bank_account, bank_name, ssnit_number } : {}),
      },
      assignments, attendance, leave, may_see_pay: showPay,
    });
  });

  /**
   * Create or amend a staff record.
   *
   * The pay columns are only written by an account that may SEE them. Without
   * that check an account with `staff: edit` and no payroll could set anybody's
   * salary — including their own — without ever being able to read it back,
   * which is worse than being able to read it.
   */
  add('POST', `${API}/admin/staff`, async (ctx, req, res, params, body) => {
    const isNew = !body.id;
    if (!adminGate(ctx, res, 'staff', isNew ? 'create' : 'edit')) return undefined;

    const FIELDS = ['surname', 'first_name', 'other_names', 'gender', 'date_of_birth', 'phone',
                    'email', 'address', 'role', 'designation_id', 'status', 'qualification',
                    'specialization', 'hire_date', 'stop_date', 'notes', 'staff_number'];
    const PAY = ['base_salary', 'bank_account', 'bank_name', 'ssnit_number', 'ssnit_enrolled'];
    const allowed = can(ctx, 'payroll', 'edit') ? [...FIELDS, ...PAY] : FIELDS;

    const patch = {};
    for (const k of allowed) if (Object.prototype.hasOwnProperty.call(body, k)) patch[k] = body[k];

    if (isNew) {
      if (!String(patch.surname || '').trim() || !String(patch.first_name || '').trim()) {
        return bad(res, 'A surname and a first name are required.');
      }
      if (!patch.role) patch.role = 'Teaching';
      if (!patch.status) patch.status = 'Active';
      if (!patch.staff_number) {
        const n = db.prepare('SELECT COUNT(*) c FROM staff').get().c || 0;
        patch.staff_number = `STAFF/${String(n + 1).padStart(4, '0')}`;
      }
      if (db.prepare('SELECT id FROM staff WHERE staff_number = ?').get(patch.staff_number)) {
        return bad(res, 'That staff number is already in use.');
      }
      const cols = Object.keys(patch);
      const r = db.prepare(`INSERT INTO staff (${cols.join(', ')})
                            VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...cols.map(k => patch[k]));
      audit(db, ctx, 'staff', r.lastInsertRowid, 'create_staff',
        `${patch.surname} ${patch.first_name}`, 'high');
      return json(res, 200, { ok: true, id: r.lastInsertRowid, staff_number: patch.staff_number });
    }

    const id = parseInt(body.id, 10);
    if (!db.prepare('SELECT id FROM staff WHERE id = ?').get(id)) {
      return missing(res, 'No such member of staff.');
    }
    const cols = Object.keys(patch);
    if (!cols.length) return bad(res, 'Nothing to change.');
    db.prepare(`UPDATE staff SET ${cols.map(k => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map(k => patch[k]), id);
    audit(db, ctx, 'staff', id, 'update_staff', cols.join(', '));
    try {
      const owner = db.prepare('SELECT id FROM users WHERE staff_id = ?').get(id);
      if (owner) require('./sync/staff_projection').enqueueStaffProfile(db, owner.id);
    } catch (_) {}
    return json(res, 200, { ok: true, id });
  });

  /**
   * Which classes and subjects somebody teaches.
   *
   * The single most consequential write in the staff module: the teaching
   * scope is built from this, so it decides whose marks a teacher can touch.
   * Replaced wholesale rather than patched, so what is stored always matches
   * what the screen showed.
   */
  add('POST', `${API}/admin/staff/:id/assignments`, async (ctx, req, res, params, body) => {
    if (!adminGate(ctx, res, 'staff', 'edit')) return undefined;
    const id = parseInt(params.id, 10);
    if (!db.prepare('SELECT id FROM staff WHERE id = ?').get(id)) {
      return missing(res, 'No such member of staff.');
    }
    const rows = [];
    for (const a of (Array.isArray(body.assignments) ? body.assignments : [])) {
      const classId = a.class_group_id ?? a.classId ?? null;
      const subjectId = a.subject_id ?? a.subjectId ?? null;
      if (!classId && !subjectId) continue;
      rows.push([classId || null, subjectId || null, a.is_class_teacher ? 1 : 0]);
    }

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM staff_assignments WHERE staff_id = ?').run(id);
      for (const [classId, subjectId, isCt] of rows) {
        // One class has one class teacher. Setting a second silently would give
        // two people the register and the report cards.
        if (isCt && classId) {
          db.prepare('UPDATE staff_assignments SET is_class_teacher = 0 WHERE class_group_id = ? AND is_class_teacher = 1')
            .run(classId);
        }
        db.prepare(`INSERT INTO staff_assignments (staff_id, class_group_id, subject_id, is_class_teacher)
                    VALUES (?, ?, ?, ?)`).run(id, classId, subjectId, isCt);
      }
    });
    tx();

    audit(db, ctx, 'staff', id, 'set_assignments', `${rows.length} assignment(s)`, 'high');
    // Every session that member of staff holds is now resolving a scope that
    // has changed; the next request re-reads it, so nothing needs revoking.
    try {
      const owner = db.prepare('SELECT id FROM users WHERE staff_id = ?').get(id);
      if (owner) require('./sync/staff_projection').enqueueStaffProfile(db, owner.id);
    } catch (_) {}
    return json(res, 200, { ok: true, assignments: rows.length });
  });

  // ── Approvals: leave ──────────────────────────────────────────────────────
  add('GET', `${API}/admin/leave`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!adminGate(ctx, res, 'staff')) return undefined;
    const status = ['pending', 'approved', 'rejected'].includes(query.status) ? query.status : 'pending';
    const rows = db.prepare(`
      SELECT lr.*, st.surname, st.first_name, st.staff_number, st.role,
             u.full_name AS reviewed_by_name
      FROM leave_requests lr JOIN staff st ON st.id = lr.staff_id
      LEFT JOIN users u ON u.id = lr.reviewed_by
      WHERE lr.status = ? ORDER BY lr.id DESC LIMIT 200
    `).all(status);
    return json(res, 200, {
      ok: true, status, may_decide: can(ctx, 'staff', 'edit'),
      requests: rows.map(r => ({ ...r, staff_name: `${r.surname || ''} ${r.first_name || ''}`.trim() })),
    });
  });

  add('POST', `${API}/admin/leave/:id/decision`, async (ctx, req, res, params, body) => {
    if (!adminGate(ctx, res, 'staff', 'edit')) return undefined;
    const decision = String(body.decision || '');
    if (!['approved', 'rejected'].includes(decision)) return bad(res, 'Approve it or reject it.');
    const id = parseInt(params.id, 10);
    const lr = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
    if (!lr) return missing(res, 'No such request.');
    if (lr.status !== 'pending') return bad(res, `That request was already ${lr.status}.`);
    db.prepare(`
      UPDATE leave_requests SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'),
        reviewer_notes = ? WHERE id = ?
    `).run(decision, ctx.user.id, body.notes || null, id);
    // The teacher's own record carries their leave, and it is projected per
    // USER account rather than per staff row — so the account has to be found.
    try {
      const owner = db.prepare('SELECT id FROM users WHERE staff_id = ?').get(lr.staff_id);
      if (owner) require('./sync/staff_projection').enqueueStaffProfile(db, owner.id);
    } catch (_) {}
    audit(db, ctx, 'leave_request', id, `leave_${decision}`, body.notes || '');
    return json(res, 200, { ok: true });
  });

  // ── Approvals: lesson notes ───────────────────────────────────────────────
  add('GET', `${API}/admin/lesson-notes`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!adminGate(ctx, res, 'academics')) return undefined;
    const status = ['submitted', 'approved', 'rejected', 'draft'].includes(query.status)
      ? query.status : 'submitted';
    const rows = db.prepare(`
      SELECT ln.id, ln.topic AS title, ln.sub_topic, ln.week_number, ln.lesson_date,
             ln.status, ln.created_at, ln.updated_at,
             ln.class_group_id, c.name AS class_name, s.name AS subject_name,
             st.surname, st.first_name
      FROM lesson_notes ln
      LEFT JOIN class_groups c ON c.id = ln.class_group_id
      LEFT JOIN subjects s ON s.id = ln.subject_id
      LEFT JOIN staff st ON st.id = ln.staff_id
      WHERE COALESCE(ln.status,'draft') = ? ORDER BY ln.id DESC LIMIT 200
    `).all(status);
    return json(res, 200, {
      ok: true, status, may_decide: can(ctx, 'academics', 'edit'),
      notes: rows.map(r => ({ ...r, teacher_name: `${r.surname || ''} ${r.first_name || ''}`.trim() })),
    });
  });

  add('POST', `${API}/admin/lesson-notes/:id/decision`, async (ctx, req, res, params, body) => {
    if (!adminGate(ctx, res, 'academics', 'edit')) return undefined;
    const decision = String(body.decision || '');
    if (!['approved', 'rejected'].includes(decision)) return bad(res, 'Approve it or reject it.');
    const id = parseInt(params.id, 10);
    const note = db.prepare('SELECT id, status, staff_id FROM lesson_notes WHERE id = ?').get(id);
    if (!note) return missing(res, 'No such lesson note.');
    db.prepare(`
      UPDATE lesson_notes SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'),
        review_comments = ? WHERE id = ?
    `).run(decision, ctx.user.id, body.comments || null, id);
    audit(db, ctx, 'lesson_note', id, `lesson_note_${decision}`, body.comments || '');
    return json(res, 200, { ok: true });
  });

  // ── Academic oversight ────────────────────────────────────────────────────
  // How the school is doing, class by class, from marks already entered. Not a
  // new calculation: the same averages the broadsheet shows, aggregated one
  // level up so a head teacher can see which class is behind before the term
  // ends rather than after the reports are printed.
  add('GET', `${API}/admin/academics`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!adminGate(ctx, res, 'academics')) return undefined;
    const term = query.termId
      ? db.prepare('SELECT * FROM terms WHERE id = ?').get(parseInt(query.termId, 10))
      : currentTerm();
    if (!term) return json(res, 200, { ok: true, term: null, classes: [] });
    const classes = db.prepare(`
      SELECT c.id, c.name, c.short_code, COUNT(DISTINCT s.id) pupils
      FROM class_groups c LEFT JOIN students s ON s.current_class_id = c.id AND s.status = 'Active'
      GROUP BY c.id ORDER BY c.level_order, c.name
    `).all();
    const marks = db.prepare(`
      SELECT s.current_class_id class_id, COUNT(*) entries,
             ROUND(AVG(sc.total_score), 1) average,
             COUNT(*) FILTER (WHERE sc.total_score >= 50) passes
      FROM scores sc JOIN students s ON s.id = sc.student_id
      WHERE sc.term_id = ? AND s.status = 'Active' AND sc.total_score IS NOT NULL
      GROUP BY s.current_class_id
    `).all(term.id);
    const byClass = new Map(marks.map(m => [m.class_id, m]));
    const attendance = db.prepare(`
      SELECT s.current_class_id class_id,
             COUNT(*) FILTER (WHERE a.status = 'present') present, COUNT(*) marked
      FROM student_attendance a JOIN students s ON s.id = a.student_id
      WHERE a.date BETWEEN ? AND ? GROUP BY s.current_class_id
    `).all(term.start_date || '1970-01-01', term.end_date || '2099-12-31');
    const attByClass = new Map(attendance.map(a => [a.class_id, a]));
    return json(res, 200, {
      ok: true,
      term: { id: term.id, label: term.label },
      classes: classes.map(c => {
        const m = byClass.get(c.id) || {};
        const a = attByClass.get(c.id) || {};
        return {
          ...c,
          entries: m.entries || 0,
          average: m.average == null ? null : num(m.average),
          pass_rate: m.entries ? Math.round((m.passes / m.entries) * 100) : null,
          attendance_rate: a.marked ? Math.round((a.present / a.marked) * 100) : null,
        };
      }),
    });
  });

  // Notices are NOT here. `POST /announcements` (server/staff_api.js) already
  // posts one, gated on `notifications: edit`, and the admin portal calls that.
  // Two routes writing the same table is two sets of rules about who may.

  // ══ System ════════════════════════════════════════════════════════════════

  add('GET', `${API}/system/overview`, async (ctx, req, res) => {
    if (!systemGate(ctx, res)) return undefined;
    const counts = {
      users: db.prepare('SELECT COUNT(*) c FROM users WHERE is_active = 1').get().c,
      users_inactive: db.prepare('SELECT COUNT(*) c FROM users WHERE is_active = 0').get().c,
      designations: db.prepare('SELECT COUNT(*) c FROM designations').get().c,
      students: db.prepare("SELECT COUNT(*) c FROM students WHERE status = 'Active'").get().c,
      staff: db.prepare("SELECT COUNT(*) c FROM staff WHERE status = 'Active'").get().c,
      parents: db.prepare('SELECT COUNT(*) c FROM parents').get().c,
    };
    let sync = { enabled: false };
    try {
      const outbox = require('./sync/outbox');
      sync = {
        enabled: outbox.syncEnabled(db),
        pending: outbox.pendingCount(db),
        failed: outbox.deadCount(db),
      };
    } catch (_) {}
    const gateway = getSetting(db, 'payment_gateway', 'none');
    return json(res, 200, {
      ok: true, counts, sync,
      // Requests raised from a phone or a browser, waiting for somebody to
      // approve them at the desktop. Shown here so the Super Admin knows to
      // go and do it — never approved here.
      password_requests: db.prepare(
        "SELECT COUNT(*) c FROM password_reset_requests WHERE status = 'pending'"
      ).get().c,
      payments: {
        gateway,
        configured: gateway !== 'none' && !!getSetting(db, 'paystack_secret_key', ''),
        online_enabled: getSetting(db, 'online_payments_enabled', 'false') === 'true',
      },
      security: {
        recent_denials: db.prepare(`
          SELECT COUNT(*) c FROM audit_log
          WHERE action = 'permission_denied' AND date(created_at) >= date('now', '-7 day')
        `).get().c,
      },
      version: '2.0.0',
    });
  });

  // ── User accounts ─────────────────────────────────────────────────────────
  add('GET', `${API}/system/users`, async (ctx, req, res) => {
    if (!systemGate(ctx, res)) return undefined;
    const users = db.prepare(`
      SELECT u.id, u.username, u.full_name, u.is_active, u.must_change_password,
             u.last_login, u.created_at, u.staff_id, d.id AS designation_id, d.name AS designation
      FROM users u LEFT JOIN designations d ON d.id = u.designation_id
      ORDER BY u.is_active DESC, u.full_name
    `).all();
    return json(res, 200, {
      ok: true, users,
      designations: db.prepare('SELECT id, name, description, is_system FROM designations ORDER BY name').all(),
    });
  });

  add('POST', `${API}/system/users`, async (ctx, req, res, params, body) => {
    if (!systemGate(ctx, res)) return undefined;
    const username = String(body.username || '').trim().toLowerCase();
    const fullName = String(body.fullName || body.full_name || '').trim();
    const password = String(body.password || '');
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      return bad(res, 'A username is 3–32 letters, numbers, dot, dash or underscore.');
    }
    if (!fullName) return bad(res, "Enter the person's name.");
    if (password.length < 8) return bad(res, 'A password must be at least 8 characters.');
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      return bad(res, 'That username is taken.');
    }
    const designationId = body.designationId ? parseInt(body.designationId, 10) : null;
    if (designationId && !db.prepare('SELECT id FROM designations WHERE id = ?').get(designationId)) {
      return bad(res, 'That role does not exist.');
    }
    let bcrypt; try { bcrypt = require('bcryptjs'); } catch { return json(res, 500, { ok: false, error: 'auth unavailable' }); }
    const r = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, designation_id, staff_id,
        is_active, must_change_password, created_by)
      VALUES (?, ?, ?, ?, ?, 1, 1, ?)
    `).run(username, bcrypt.hashSync(password, 10), fullName, designationId,
      body.staffId ? parseInt(body.staffId, 10) : null, ctx.user.id);
    // The account has to be able to sign in off-LAN from the moment it is
    // made, so the projection goes up with it rather than at the next sync.
    try { require('./sync/staff_projection').enqueueStaffAuth(db, r.lastInsertRowid); } catch (_) {}
    audit(db, ctx, 'user', r.lastInsertRowid, 'create_user', `${username} (${fullName})`, 'high');
    // `must_change_password` is set: whoever created it chose the password, so
    // the person it belongs to replaces it before they can do anything.
    return json(res, 200, { ok: true, id: r.lastInsertRowid, must_change_password: true });
  });

  add('POST', `${API}/system/users/:id/status`, async (ctx, req, res, params, body) => {
    if (!systemGate(ctx, res)) return undefined;
    const id = parseInt(params.id, 10);
    const active = body.active === true || body.active === 1 || body.active === 'true';
    const u = db.prepare('SELECT id, username, is_active FROM users WHERE id = ?').get(id);
    if (!u) return missing(res, 'No such account.');
    // Locking yourself out of your own school from a phone, with the desktop
    // in another building, is a support call nobody enjoys.
    if (id === ctx.user.id && !active) return bad(res, 'You cannot deactivate the account you are signed in with.');
    if (!active) {
      const admins = db.prepare(`
        SELECT COUNT(*) c FROM users u JOIN designations d ON d.id = u.designation_id
        WHERE u.is_active = 1 AND d.name IN ('Proprietor','Super Admin','Administrator') AND u.id <> ?
      `).get(id).c;
      if (admins === 0) return bad(res, 'That is the last administrator account. The school would be locked out.');
    }
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(active ? 1 : 0, id);
    // A deactivated account's cloud session dies on its next request, not when
    // its token happens to expire — so the projection goes up immediately.
    try { require('./sync/staff_projection').enqueueStaffAuth(db, id); } catch (_) {}
    try { require('./tokens').revokeAllForSubject(db, 'user', id); } catch (_) {}
    audit(db, ctx, 'user', id, active ? 'activate_user' : 'deactivate_user', u.username, 'high');
    return json(res, 200, { ok: true });
  });

  add('POST', `${API}/system/users/:id/role`, async (ctx, req, res, params, body) => {
    if (!systemGate(ctx, res)) return undefined;
    const id = parseInt(params.id, 10);
    const designationId = parseInt(body.designationId ?? body.designation_id, 10);
    const u = db.prepare(`
      SELECT u.id, u.username, d.name AS designation FROM users u
      LEFT JOIN designations d ON d.id = u.designation_id WHERE u.id = ?
    `).get(id);
    if (!u) return missing(res, 'No such account.');
    const d = db.prepare('SELECT id, name FROM designations WHERE id = ?').get(designationId);
    if (!d) return bad(res, 'That role does not exist.');
    if (id === ctx.user.id && !portals.isElevated(d.name)) {
      return bad(res, 'You cannot take the administrator role off the account you are signed in with.');
    }
    db.prepare('UPDATE users SET designation_id = ? WHERE id = ?').run(designationId, id);
    try { require('./sync/staff_projection').enqueueStaffAuth(db, id); } catch (_) {}
    audit(db, ctx, 'user', id, 'change_user_role', `${u.username}: ${u.designation || 'none'} → ${d.name}`, 'high');
    return json(res, 200, { ok: true });
  });

  // ── Access levels ─────────────────────────────────────────────────────────
  // The ladder from electron/ipc/_access.js, read and written as levels rather
  // than as four booleans, so what a person is granted here reads the same as
  // what the desktop's Access Control screen shows.
  add('GET', `${API}/system/access`, async (ctx, req, res) => {
    if (!systemGate(ctx, res)) return undefined;
    const designations = db.prepare('SELECT id, name, description, is_system FROM designations ORDER BY name').all();
    const rows = db.prepare('SELECT * FROM designation_permissions').all();
    const byDesignation = new Map();
    for (const d of designations) byDesignation.set(d.id, {});
    for (const r of rows) {
      const map = byDesignation.get(r.designation_id);
      if (map) map[r.module] = access.permsToLevel(r);
    }
    return json(res, 200, {
      ok: true,
      levels: access.LEVELS, modules: access.MODULES, always_full: access.ALWAYS_FULL,
      designations: designations.map(d => ({
        ...d,
        locked: access.ALWAYS_FULL.includes(d.name),
        levels: access.ALWAYS_FULL.includes(d.name)
          ? Object.fromEntries(access.MODULE_KEYS.map(m => [m, 'full']))
          : Object.fromEntries(access.MODULE_KEYS.map(m => [m, (byDesignation.get(d.id) || {})[m] || 'no'])),
      })),
    });
  });

  add('POST', `${API}/system/access`, async (ctx, req, res, params, body) => {
    if (!systemGate(ctx, res)) return undefined;
    const designationId = parseInt(body.designationId ?? body.designation_id, 10);
    const d = db.prepare('SELECT id, name FROM designations WHERE id = ?').get(designationId);
    if (!d) return bad(res, 'That role does not exist.');
    if (access.ALWAYS_FULL.includes(d.name)) {
      return bad(res, `${d.name} always has full access. Change the person's role instead.`);
    }
    const levels = body.levels || {};
    const changes = [];
    for (const [module, level] of Object.entries(levels)) {
      if (!access.MODULE_KEYS.includes(module)) return bad(res, `Unknown module: ${module}`);
      if (!access.isValidLevel(level)) return bad(res, `Unknown level: ${level}`);
      changes.push([module, level]);
    }
    if (!changes.length) return bad(res, 'Nothing to change.');
    const tx = db.transaction(() => {
      for (const [module, level] of changes) {
        const p = access.levelToPerms(level);
        db.prepare(`
          INSERT INTO designation_permissions (designation_id, module, can_view, can_create, can_edit, can_delete)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (designation_id, module) DO UPDATE SET
            can_view = excluded.can_view, can_create = excluded.can_create,
            can_edit = excluded.can_edit, can_delete = excluded.can_delete
        `).run(designationId, module, p.can_view, p.can_create, p.can_edit, p.can_delete);
      }
    });
    try { tx(); } catch (e) { return json(res, 400, { ok: false, error: `Could not save: ${e.message}` }); }

    // Everyone holding this role has just had their access changed, and the
    // cloud is enforcing from a copy. Re-project every one of them now, or a
    // withdrawn permission would keep working off-LAN until something else
    // happened to touch the account.
    try {
      const proj = require('./sync/staff_projection');
      for (const u of db.prepare('SELECT id FROM users WHERE designation_id = ?').all(designationId)) {
        proj.enqueueStaffAuth(db, u.id);
      }
    } catch (_) {}
    audit(db, ctx, 'designation', designationId, 'change_access',
      `${d.name}: ${changes.map(([m, l]) => `${m}=${l}`).join(', ')}`, 'high');
    return json(res, 200, { ok: true });
  });

  // ── The audit trail ───────────────────────────────────────────────────────
  add('GET', `${API}/system/audit`, async (ctx, req, res, params, body, ip, tokenId, query) => {
    if (!systemGate(ctx, res)) return undefined;
    const p = [];
    let sql = `
      SELECT a.id, a.entity_type, a.entity_id, a.action, a.justification, a.severity,
             a.created_at, u.full_name AS user_name, u.username
      FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE 1=1
    `;
    if (query.severity) { sql += ' AND a.severity = ?'; p.push(query.severity); }
    if (query.entity) { sql += ' AND a.entity_type = ?'; p.push(query.entity); }
    if (query.action) { sql += ' AND a.action = ?'; p.push(query.action); }
    if (query.userId) { sql += ' AND a.user_id = ?'; p.push(parseInt(query.userId, 10)); }
    sql += ' ORDER BY a.id DESC LIMIT ?';
    p.push(Math.min(parseInt(query.limit, 10) || 100, 500));
    return json(res, 200, {
      ok: true,
      entries: db.prepare(sql).all(...p),
      severities: db.prepare('SELECT severity, COUNT(*) c FROM audit_log GROUP BY severity').all(),
    });
  });

  // ── Settings ──────────────────────────────────────────────────────────────
  add('GET', `${API}/system/settings`, async (ctx, req, res) => {
    if (!systemGate(ctx, res)) return undefined;
    const values = {};
    for (const key of SETTINGS_READABLE) values[key] = getSetting(db, key, '');
    return json(res, 200, {
      ok: true, settings: values,
      // Named, so the screen can offer the field — and answered as a yes or a
      // no, so nothing that reaches a browser can be read back out of it.
      secrets: SETTINGS_WRITE_ONLY.map(key => ({ key, configured: !!getSetting(db, key, '') })),
    });
  });

  add('POST', `${API}/system/settings`, async (ctx, req, res, params, body) => {
    if (!systemGate(ctx, res)) return undefined;
    const patch = body.settings || body;
    const written = [];
    for (const [key, value] of Object.entries(patch)) {
      if (!SETTINGS_WRITABLE.has(key)) continue;
      setSetting(db, key, value == null ? '' : String(value));
      written.push(key);
    }
    if (!written.length) return bad(res, 'Nothing there that can be changed from here.');
    try { require('./sync/outbox').enqueueSchoolProfile(db); } catch (_) {}
    // The values are not logged: one of them is a gateway secret, and an audit
    // trail that quotes secrets is a second place they can be read from.
    audit(db, ctx, 'settings', null, 'change_settings', written.join(', '), 'high');
    return json(res, 200, { ok: true, written });
  });
}

module.exports = { registerAdminRoutes, SETTINGS_READABLE, SETTINGS_WRITE_ONLY };
