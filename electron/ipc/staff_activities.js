// Nickland Edusoft — Staff Activities + Lesson Notes IPC
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Permissions model:
//   - A teacher can view/create/edit only their own records (resolved via users.staff_id)
//   - Head Teacher / Administrator / Proprietor can view & review all
//   - The 'mine' boolean on list handlers limits to current user's own records

module.exports = function registerStaffActivitiesHandlers(ipcMain, db) {
  const security = require('./_security');

  // Helper: resolve the staff_id for the current logged-in user
  function currentStaffId() {
    const uid = security.getCurrentUserId();
    if (!uid) return null;
    const u = db.prepare('SELECT staff_id FROM users WHERE id = ?').get(uid);
    return u?.staff_id || null;
  }

  // Helper: can the current user manage all staff records (head teacher / admin)?
  function isStaffSupervisor() {
    const uid = security.getCurrentUserId();
    if (!uid) return false;
    const row = db.prepare(`
      SELECT d.name AS designation FROM users u
      LEFT JOIN designations d ON d.id = u.designation_id WHERE u.id = ?
    `).get(uid);
    return ['Administrator', 'Proprietor', 'Head Teacher'].includes(row?.designation);
  }

  // ═══════════════════════════════════════════════════════
  // LESSON NOTES
  // ═══════════════════════════════════════════════════════

  ipcMain.handle('lesson-notes:list', (_e, filters = {}) => {
    let sql = `
      SELECT ln.*, s.surname || ' ' || s.first_name AS teacher_name,
             cg.name AS class_name, sub.name AS subject_name, t.label AS term_label
      FROM lesson_notes ln
      LEFT JOIN staff s ON s.id = ln.staff_id
      LEFT JOIN class_groups cg ON cg.id = ln.class_group_id
      LEFT JOIN subjects sub ON sub.id = ln.subject_id
      LEFT JOIN terms t ON t.id = ln.term_id
      WHERE 1=1
    `;
    const params = [];

    // Non-supervisors can only see their own
    if (!isStaffSupervisor()) {
      const sid = currentStaffId();
      if (!sid) return [];   // user not linked to staff — nothing to show
      sql += ' AND ln.staff_id = ?';
      params.push(sid);
    } else if (filters.staffId) {
      sql += ' AND ln.staff_id = ?';
      params.push(filters.staffId);
    }

    if (filters.termId)       { sql += ' AND ln.term_id = ?';        params.push(filters.termId); }
    if (filters.subjectId)    { sql += ' AND ln.subject_id = ?';     params.push(filters.subjectId); }
    if (filters.classGroupId) { sql += ' AND ln.class_group_id = ?'; params.push(filters.classGroupId); }
    if (filters.status)       { sql += ' AND ln.status = ?';         params.push(filters.status); }
    if (filters.weekNumber)   { sql += ' AND ln.week_number = ?';    params.push(filters.weekNumber); }
    if (filters.search)       {
      sql += ' AND (ln.topic LIKE ? OR ln.sub_topic LIKE ?)';
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }

    sql += ' ORDER BY ln.lesson_date DESC, ln.id DESC';
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('lesson-notes:get', (_e, id) => {
    const note = db.prepare(`
      SELECT ln.*, s.surname || ' ' || s.first_name AS teacher_name,
             cg.name AS class_name, sub.name AS subject_name, t.label AS term_label,
             r.full_name AS reviewer_name
      FROM lesson_notes ln
      LEFT JOIN staff s ON s.id = ln.staff_id
      LEFT JOIN class_groups cg ON cg.id = ln.class_group_id
      LEFT JOIN subjects sub ON sub.id = ln.subject_id
      LEFT JOIN terms t ON t.id = ln.term_id
      LEFT JOIN users r ON r.id = ln.reviewed_by
      WHERE ln.id = ?
    `).get(id);
    if (!note) return null;
    // Permission check: own record or supervisor
    if (!isStaffSupervisor()) {
      const sid = currentStaffId();
      if (note.staff_id !== sid) return null;
    }
    return note;
  });

  ipcMain.handle('lesson-notes:save', (_e, data) => {
    const mySid = currentStaffId();
    const supervisor = isStaffSupervisor();

    // If updating, verify ownership (unless supervisor)
    if (data.id) {
      const existing = db.prepare('SELECT staff_id, status FROM lesson_notes WHERE id = ?').get(data.id);
      if (!existing) return { ok: false, error: 'Lesson note not found' };
      if (!supervisor && existing.staff_id !== mySid) {
        return { ok: false, error: 'You can only edit your own lesson notes.' };
      }
      // Reviewed notes are locked from teacher edits (supervisor can still edit)
      if (!supervisor && existing.status === 'reviewed') {
        return { ok: false, error: 'This lesson note has been reviewed and is locked from edits.' };
      }
    }

    // If creating, force staff_id to current user unless supervisor explicitly sets it
    const staffId = data.id
      ? (data.staff_id || mySid)
      : (supervisor && data.staff_id ? data.staff_id : mySid);
    if (!staffId) {
      return { ok: false, error: 'You must be linked to a staff record to create lesson notes. Ask an Administrator.' };
    }

    if (data.id) {
      db.prepare(`
        UPDATE lesson_notes SET
          class_group_id = ?, subject_id = ?, term_id = ?,
          week_number = ?, lesson_date = ?, duration_minutes = ?,
          topic = ?, sub_topic = ?, references_text = ?, tlms = ?,
          objectives = ?, rpk = ?, introduction = ?, presentation = ?,
          activity = ?, evaluation = ?, closure = ?, assignment = ?, remarks = ?,
          status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        data.class_group_id || null, data.subject_id || null, data.term_id || null,
        data.week_number || null, data.lesson_date || null, data.duration_minutes || null,
        data.topic, data.sub_topic || null, data.references_text || null, data.tlms || null,
        data.objectives || null, data.rpk || null, data.introduction || null, data.presentation || null,
        data.activity || null, data.evaluation || null, data.closure || null,
        data.assignment || null, data.remarks || null,
        data.status || 'draft', data.id
      );
      return { ok: true, id: data.id };
    } else {
      const r = db.prepare(`
        INSERT INTO lesson_notes
          (staff_id, class_group_id, subject_id, term_id,
           week_number, lesson_date, duration_minutes,
           topic, sub_topic, references_text, tlms,
           objectives, rpk, introduction, presentation,
           activity, evaluation, closure, assignment, remarks, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        staffId,
        data.class_group_id || null, data.subject_id || null, data.term_id || null,
        data.week_number || null, data.lesson_date || null, data.duration_minutes || null,
        data.topic, data.sub_topic || null, data.references_text || null, data.tlms || null,
        data.objectives || null, data.rpk || null, data.introduction || null, data.presentation || null,
        data.activity || null, data.evaluation || null, data.closure || null,
        data.assignment || null, data.remarks || null, data.status || 'draft'
      );
      return { ok: true, id: r.lastInsertRowid };
    }
  });

  ipcMain.handle('lesson-notes:delete', (_e, id) => {
    const existing = db.prepare('SELECT staff_id, status FROM lesson_notes WHERE id = ?').get(id);
    if (!existing) return { ok: false, error: 'Lesson note not found' };
    const supervisor = isStaffSupervisor();
    const mySid = currentStaffId();
    if (!supervisor && existing.staff_id !== mySid) {
      return { ok: false, error: 'You can only delete your own lesson notes.' };
    }
    if (!supervisor && existing.status === 'reviewed') {
      return { ok: false, error: 'Reviewed lesson notes cannot be deleted by the teacher.' };
    }
    db.prepare('DELETE FROM lesson_notes WHERE id = ?').run(id);
    return { ok: true };
  });

  // Head teacher reviews a lesson note (acknowledges + adds comments)
  ipcMain.handle('lesson-notes:review', (_e, { id, status, comments }) => {
    if (!isStaffSupervisor()) {
      return { ok: false, error: 'Only a Head Teacher / Administrator / Proprietor can review lesson notes.' };
    }
    const uid = security.getCurrentUserId();
    db.prepare(`
      UPDATE lesson_notes SET
        status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_comments = ?
      WHERE id = ?
    `).run(status || 'reviewed', uid, comments || null, id);
    return { ok: true };
  });

  // ═══════════════════════════════════════════════════════
  // STAFF ACTIVITIES (general log)
  // ═══════════════════════════════════════════════════════

  ipcMain.handle('staff-activities:list', (_e, filters = {}) => {
    let sql = `
      SELECT sa.*, s.surname || ' ' || s.first_name AS staff_name,
             cg.name AS class_name,
             u.full_name AS acknowledged_by_name
      FROM staff_activities sa
      LEFT JOIN staff s ON s.id = sa.staff_id
      LEFT JOIN class_groups cg ON cg.id = sa.related_class_id
      LEFT JOIN users u ON u.id = sa.acknowledged_by
      WHERE 1=1
    `;
    const params = [];

    if (!isStaffSupervisor()) {
      const sid = currentStaffId();
      if (!sid) return [];
      sql += ' AND sa.staff_id = ?';
      params.push(sid);
    } else if (filters.staffId) {
      sql += ' AND sa.staff_id = ?';
      params.push(filters.staffId);
    }

    if (filters.activityType) { sql += ' AND sa.activity_type = ?'; params.push(filters.activityType); }
    if (filters.fromDate)     { sql += ' AND sa.activity_date >= ?'; params.push(filters.fromDate); }
    if (filters.toDate)       { sql += ' AND sa.activity_date <= ?'; params.push(filters.toDate); }

    sql += ' ORDER BY sa.activity_date DESC, sa.id DESC';
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('staff-activities:save', (_e, data) => {
    const mySid = currentStaffId();
    const supervisor = isStaffSupervisor();

    if (data.id) {
      const existing = db.prepare('SELECT staff_id FROM staff_activities WHERE id = ?').get(data.id);
      if (!existing) return { ok: false, error: 'Activity not found' };
      if (!supervisor && existing.staff_id !== mySid) {
        return { ok: false, error: 'You can only edit your own activities.' };
      }
    }

    const staffId = data.id
      ? (data.staff_id || mySid)
      : (supervisor && data.staff_id ? data.staff_id : mySid);
    if (!staffId) {
      return { ok: false, error: 'You must be linked to a staff record to log activities.' };
    }

    if (data.id) {
      db.prepare(`
        UPDATE staff_activities SET
          activity_date = ?, activity_type = ?, title = ?, description = ?,
          duration_minutes = ?, location = ?, related_class_id = ?, hours_contributed = ?
        WHERE id = ?
      `).run(
        data.activity_date, data.activity_type, data.title, data.description || null,
        data.duration_minutes || null, data.location || null,
        data.related_class_id || null, data.hours_contributed || null, data.id
      );
      return { ok: true, id: data.id };
    } else {
      const r = db.prepare(`
        INSERT INTO staff_activities
          (staff_id, activity_date, activity_type, title, description,
           duration_minutes, location, related_class_id, hours_contributed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        staffId, data.activity_date, data.activity_type, data.title,
        data.description || null, data.duration_minutes || null,
        data.location || null, data.related_class_id || null,
        data.hours_contributed || null
      );
      return { ok: true, id: r.lastInsertRowid };
    }
  });

  ipcMain.handle('staff-activities:delete', (_e, id) => {
    const existing = db.prepare('SELECT staff_id FROM staff_activities WHERE id = ?').get(id);
    if (!existing) return { ok: false, error: 'Activity not found' };
    if (!isStaffSupervisor() && existing.staff_id !== currentStaffId()) {
      return { ok: false, error: 'You can only delete your own activities.' };
    }
    db.prepare('DELETE FROM staff_activities WHERE id = ?').run(id);
    return { ok: true };
  });

  // Supervisor acknowledges an activity
  ipcMain.handle('staff-activities:acknowledge', (_e, id) => {
    if (!isStaffSupervisor()) {
      return { ok: false, error: 'Only a Head Teacher / Administrator / Proprietor can acknowledge activities.' };
    }
    const uid = security.getCurrentUserId();
    db.prepare(`
      UPDATE staff_activities SET acknowledged_by = ?, acknowledged_at = datetime('now')
      WHERE id = ?
    `).run(uid, id);
    return { ok: true };
  });

  // Activity summary for one staff member over a date range
  ipcMain.handle('staff-activities:summary', (_e, { staffId, fromDate, toDate }) => {
    const supervisor = isStaffSupervisor();
    const targetId = staffId || currentStaffId();
    if (!supervisor && targetId !== currentStaffId()) {
      return { ok: false, error: 'You can only view your own activity summary.' };
    }
    const byType = db.prepare(`
      SELECT activity_type, COUNT(*) AS count,
             COALESCE(SUM(hours_contributed), 0) AS hours
      FROM staff_activities
      WHERE staff_id = ?
        AND activity_date >= COALESCE(?, '1900-01-01')
        AND activity_date <= COALESCE(?, '2999-12-31')
      GROUP BY activity_type
      ORDER BY count DESC
    `).all(targetId, fromDate || null, toDate || null);
    const total = db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(hours_contributed), 0) AS hours
      FROM staff_activities
      WHERE staff_id = ?
        AND activity_date >= COALESCE(?, '1900-01-01')
        AND activity_date <= COALESCE(?, '2999-12-31')
    `).get(targetId, fromDate || null, toDate || null);
    return { ok: true, by_type: byType, total };
  });
};
