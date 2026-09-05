// Nickland Edusoft — Academic Session & Term Automation
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Determines, from the configured term calendar and the actual (network)
// time, whether the school is IN SESSION or ON VACATION, surfaces that on
// the UI, and — when a term rolls over — migrates the system into the new
// term (carrying balances forward and, at the start of a new academic
// year, promoting students to their next class).
//
// Everything here is configurable:
//   session_status_mode : auto | in_session | vacation  (manual override)
//   term_auto_migrate    : prompt | auto | off
//   use_network_time     : true | false

const https = require('https');
const { getSetting } = require('../utils/idgen');

function todayISO(d) { return (d || new Date()).toISOString().slice(0, 10); }

// Best-effort network time via an HTTPS Date header. Falls back to the system
// clock on any error/timeout so the app is never blocked when offline.
function getNetworkTime() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (date, source) => { if (!settled) { settled = true; resolve({ date, source }); } };
    try {
      const req = https.request(
        { method: 'HEAD', host: 'www.google.com', path: '/', timeout: 3000 },
        (res) => {
          const h = res.headers && res.headers.date;
          res.resume();
          if (h) { const d = new Date(h); if (!isNaN(d.getTime())) return done(d, 'network'); }
          done(new Date(), 'system');
        }
      );
      req.on('error', () => done(new Date(), 'system'));
      req.on('timeout', () => { req.destroy(); done(new Date(), 'system'); });
      req.end();
    } catch (_) { done(new Date(), 'system'); }
  });
}

// Compute the raw calendar status for a given date against the term list.
function computeCalendarStatus(db, isoDate) {
  const terms = db.prepare(`
    SELECT t.*, y.label AS year_label FROM terms t
    LEFT JOIN academic_years y ON y.id = t.academic_year_id
    WHERE t.start_date IS NOT NULL AND t.end_date IS NOT NULL
    ORDER BY date(t.start_date)
  `).all();

  const inTerm = terms.find(t => isoDate >= t.start_date && isoDate <= t.end_date);
  if (inTerm) {
    return { status: 'in_session', term: inTerm, next_term: null, days_to_vacation: daysBetween(isoDate, inTerm.end_date) };
  }
  // Vacation: find the term that just ended (most recent end before now) and the next one starting.
  const ended = [...terms].filter(t => t.end_date < isoDate).sort((a, b) => b.end_date.localeCompare(a.end_date))[0] || null;
  const next = [...terms].filter(t => t.start_date > isoDate).sort((a, b) => a.start_date.localeCompare(b.start_date))[0] || null;
  return {
    status: 'vacation',
    term: ended,
    next_term: next,
    days_to_reopen: next ? daysBetween(isoDate, next.reopening_date || next.start_date) : null,
  };
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

// The calendar reading, and the same reading with the manual override applied.
// Exported because the browser app's top bar shows it too, and the office
// should not be told the school is in session on one screen and on vacation on
// another. The network-time hop stays behind the IPC handler: the desktop can
// afford an HTTPS HEAD once every five minutes, and a LAN server answering
// every page load cannot.
function sessionStatus(db, date) {
  const iso = todayISO(date);
  const cal = computeCalendarStatus(db, iso);
  const mode = getSetting(db, 'session_status_mode', 'auto');
  const status = (mode === 'in_session' || mode === 'vacation') ? mode : cal.status;
  return {
    status,
    source: (mode === 'in_session' || mode === 'vacation') ? 'manual' : 'auto',
    today: iso,
    term: cal.term ? {
      id: cal.term.id, label: cal.term.label, term_number: cal.term.term_number,
      year_label: cal.term.year_label, start_date: cal.term.start_date, end_date: cal.term.end_date,
    } : null,
    next_term: cal.next_term ? {
      id: cal.next_term.id, label: cal.next_term.label,
      start_date: cal.next_term.start_date, reopening_date: cal.next_term.reopening_date,
    } : null,
    days_to_vacation: cal.days_to_vacation ?? null,
    days_to_reopen: cal.days_to_reopen ?? null,
  };
}

module.exports = function registerSessionHandlers(ipcMain, db) {
  const security = require('./_security');

  // ── Current session status (in-session / vacation) ──
  ipcMain.handle('session:status', async () => {
    const mode = getSetting(db, 'session_status_mode', 'auto');
    const useNetCfg = getSetting(db, 'use_network_time', 'true') !== 'false';
    const useNet = useNetCfg;
    const nt = useNet ? await getNetworkTime() : { date: new Date(), source: 'system' };
    const iso = todayISO(nt.date);
    const cal = computeCalendarStatus(db, iso);

    let status = cal.status;
    let source = 'auto';
    if (mode === 'in_session' || mode === 'vacation') { status = mode; source = 'manual'; }

    // Is the calendar current term different from the flagged current term?
    const flagged = db.prepare('SELECT id FROM terms WHERE is_current = 1').get();
    const calendarTermId = cal.status === 'in_session' && cal.term ? cal.term.id : null;
    const migratePref = getSetting(db, 'term_auto_migrate', 'prompt');
    const lastMigrated = getSetting(db, 'term_last_migrated_to', '');
    const transitionPending =
      calendarTermId != null &&
      flagged != null &&
      calendarTermId !== flagged.id &&
      String(calendarTermId) !== String(lastMigrated);

    return {
      ok: true,
      status,                 // 'in_session' | 'vacation'
      source,                 // 'auto' | 'manual'
      mode,                   // configured mode
      network_time: nt.date.toISOString(),
      time_source: nt.source, // 'network' | 'system'
      use_network_time: useNetCfg,
      today: iso,
      term: cal.term ? { id: cal.term.id, label: cal.term.label, term_number: cal.term.term_number, year_label: cal.term.year_label, start_date: cal.term.start_date, end_date: cal.term.end_date } : null,
      next_term: cal.next_term ? { id: cal.next_term.id, label: cal.next_term.label, term_number: cal.next_term.term_number, start_date: cal.next_term.start_date, reopening_date: cal.next_term.reopening_date } : null,
      days_to_vacation: cal.days_to_vacation ?? null,
      days_to_reopen: cal.days_to_reopen ?? null,
      transition_pending: transitionPending,
      transition_target: transitionPending ? calendarTermId : null,
      auto_migrate: migratePref,
    };
  });

  // ── Configure session mode / preferences ──
  ipcMain.handle('session:set-mode', (_e, { mode, autoMigrate, useNetworkTime }) => {
    if (mode && ['auto', 'in_session', 'vacation'].includes(mode)) {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'session_status_mode'").run(mode);
    }
    if (autoMigrate && ['prompt', 'auto', 'off'].includes(autoMigrate)) {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'term_auto_migrate'").run(autoMigrate);
    }
    if (useNetworkTime !== undefined) {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'use_network_time'").run(useNetworkTime ? 'true' : 'false');
    }
    return { ok: true };
  });

  // ── Preview what a term migration would do ──
  ipcMain.handle('session:migration-preview', (_e, { targetTermId }) => {
    return buildMigrationPlan(db, targetTermId);
  });

  // ── Perform the migration into a new term ──
  // Sets the new current term/year, and — when reopening into the first term of
  // a NEW academic year after a promotional (final) term — promotes students to
  // their next class. Balances carry forward automatically because bill
  // generation folds prior unpaid balances in as arrears.
  ipcMain.handle('session:migrate-term', (_e, { targetTermId, promote }) => {
    if (!security.checkPermission(db, 'settings', 'edit')) {
      return { ok: false, error: 'Access denied. Only an administrator can migrate the term.' };
    }
    const plan = buildMigrationPlan(db, targetTermId);
    if (!plan.ok) return plan;

    const result = { promoted: 0, graduated: 0 };
    const tx = db.transaction(() => {
      // Flip the current term + academic year.
      db.prepare('UPDATE terms SET is_current = 0').run();
      db.prepare('UPDATE terms SET is_current = 1 WHERE id = ?').run(plan.target.id);
      if (plan.target.academic_year_id) {
        db.prepare('UPDATE academic_years SET is_current = 0').run();
        db.prepare('UPDATE academic_years SET is_current = 1 WHERE id = ?').run(plan.target.academic_year_id);
      }

      // Promote students on a genuine promotional transition (unless overridden).
      const doPromote = plan.is_promotional && promote !== false;
      if (doPromote) {
        const map = classNextMap(db);
        const students = db.prepare("SELECT id, current_class_id FROM students WHERE status = 'Active'").all();
        const upd = db.prepare('UPDATE students SET current_class_id = ? WHERE id = ?');
        const hist = db.prepare(`
          INSERT INTO student_class_history (student_id, class_group_id, academic_year_id, enrolled_date)
          VALUES (?, ?, ?, ?)
        `);
        for (const s of students) {
          const next = map[s.current_class_id];
          if (next && next.id) {
            upd.run(next.id, s.id);
            if (plan.target.academic_year_id) {
              try { hist.run(s.id, next.id, plan.target.academic_year_id, plan.target.start_date || todayISO()); } catch (_) {}
            }
            result.promoted++;
          } else {
            result.graduated++; // top class — no next level; left for manual graduation
          }
        }
      }

      db.prepare("UPDATE settings SET value = ? WHERE key = 'term_last_migrated_to'").run(String(plan.target.id));
    });
    try {
      tx();
      return { ok: true, target: plan.target, promoted: result.promoted, graduated: result.graduated, was_promotional: plan.is_promotional };
    } catch (e) {
      return { ok: false, error: `Migration failed: ${e.message}` };
    }
  });
};

// Build a description of a proposed migration (safe to call read-only).
function buildMigrationPlan(db, targetTermId) {
  const target = targetTermId
    ? db.prepare('SELECT * FROM terms WHERE id = ?').get(targetTermId)
    : null;
  if (!target) return { ok: false, error: 'Target term not found.' };
  const current = db.prepare('SELECT * FROM terms WHERE is_current = 1').get();

  // Promotional: moving into the first term of a different (later) academic year.
  const isNewYear = current && target.academic_year_id && current.academic_year_id
    && target.academic_year_id !== current.academic_year_id;
  const isPromotional = !!(isNewYear && (target.term_number === 1));

  let promoteCount = 0;
  if (isPromotional) {
    promoteCount = db.prepare("SELECT COUNT(*) c FROM students WHERE status = 'Active'").get().c;
  }
  return {
    ok: true,
    target,
    current: current || null,
    is_promotional: isPromotional,
    active_students: db.prepare("SELECT COUNT(*) c FROM students WHERE status = 'Active'").get().c,
    promote_count: promoteCount,
  };
}

// Map each class_group id → the class one level higher (by level_order).
function classNextMap(db) {
  const classes = db.prepare('SELECT id, level_order FROM class_groups WHERE is_active = 1 ORDER BY level_order').all();
  const byOrder = new Map(classes.map(c => [c.level_order, c]));
  const map = {};
  for (const c of classes) {
    const next = byOrder.get(c.level_order + 1);
    map[c.id] = next ? { id: next.id } : null;
  }
  return map;
}

module.exports.computeCalendarStatus = computeCalendarStatus;
module.exports.sessionStatus = sessionStatus;
