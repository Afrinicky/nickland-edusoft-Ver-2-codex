// Transport IPC — bus routes, stops, pupil assignments and termly fee collection.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Fee collection follows the same discipline as fees/canteen: every payment is
// posted to the finance ledger via postIncome under category 'transport',
// attributed by term_id and idempotent on the receipt number, so transport
// money can never fall out of the term-scoped Finance reports or double-post.
//
// Read helpers are exported for the mobile API and the cloud snapshot.

const { postIncome } = require('./_ledger');
const { getNextReceiptNumber } = require('../utils/idgen');
const { autoReceiptForPayment, autoDeliverReceipt } = require('./receipts_engine');

function currentTermId(db) {
  return db.prepare('SELECT id FROM terms WHERE is_current = 1').get()?.id || null;
}

function nextReceipt(db) {
  const n = getNextReceiptNumber(db);
  const yy = new Date().getFullYear().toString().slice(-2);
  return `TR/${yy}/${String(n).padStart(5, '0')}`;
}

// ── Routes ──
function listRoutes(db) {
  return db.prepare(`
    SELECT r.*,
           (SELECT COUNT(*) FROM student_transport st WHERE st.route_id = r.id AND st.is_active = 1) AS rider_count,
           (SELECT COUNT(*) FROM transport_stops ts WHERE ts.route_id = r.id) AS stop_count
    FROM transport_routes r
    ORDER BY r.is_active DESC, r.name
  `).all();
}

function saveRoute(db, data) {
  if (!data || !data.name || !String(data.name).trim()) return { ok: false, error: 'A route name is required.' };
  const fee = Number(data.fee_per_term) || 0;
  if (fee < 0) return { ok: false, error: 'Fee cannot be negative.' };
  const fields = [
    String(data.name).trim(), data.description || null, data.vehicle_number || null,
    data.driver_name || null, data.driver_phone || null,
    data.capacity ? parseInt(data.capacity, 10) : null, fee,
    data.is_active === false ? 0 : 1,
  ];
  if (data.id) {
    db.prepare(`
      UPDATE transport_routes SET name=?, description=?, vehicle_number=?, driver_name=?,
             driver_phone=?, capacity=?, fee_per_term=?, is_active=? WHERE id=?
    `).run(...fields, data.id);
    return { ok: true, id: data.id };
  }
  const r = db.prepare(`
    INSERT INTO transport_routes (name, description, vehicle_number, driver_name, driver_phone, capacity, fee_per_term, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...fields);
  return { ok: true, id: r.lastInsertRowid };
}

function deleteRoute(db, id) {
  const riders = db.prepare('SELECT COUNT(*) c FROM student_transport WHERE route_id = ? AND is_active = 1').get(id).c;
  if (riders > 0) return { ok: false, error: `${riders} pupil(s) are still on this route. Reassign them first, or deactivate the route instead.` };
  db.prepare('DELETE FROM transport_routes WHERE id = ?').run(id); // stops cascade
  return { ok: true };
}

// ── Stops ──
function listStops(db, routeId) {
  return db.prepare('SELECT * FROM transport_stops WHERE route_id = ? ORDER BY display_order, id').all(routeId);
}

function saveStop(db, data) {
  if (!data || !data.route_id || !data.name || !String(data.name).trim()) return { ok: false, error: 'Route and stop name are required.' };
  if (data.id) {
    db.prepare('UPDATE transport_stops SET name=?, pickup_time=?, dropoff_time=?, display_order=? WHERE id=?')
      .run(String(data.name).trim(), data.pickup_time || null, data.dropoff_time || null, data.display_order || 0, data.id);
    return { ok: true, id: data.id };
  }
  const order = db.prepare('SELECT COALESCE(MAX(display_order),0)+1 n FROM transport_stops WHERE route_id=?').get(data.route_id).n;
  const r = db.prepare('INSERT INTO transport_stops (route_id, name, pickup_time, dropoff_time, display_order) VALUES (?, ?, ?, ?, ?)')
    .run(data.route_id, String(data.name).trim(), data.pickup_time || null, data.dropoff_time || null, order);
  return { ok: true, id: r.lastInsertRowid };
}

function deleteStop(db, id) {
  db.prepare('UPDATE student_transport SET stop_id = NULL WHERE stop_id = ?').run(id);
  db.prepare('DELETE FROM transport_stops WHERE id = ?').run(id);
  return { ok: true };
}

// ── Assignment ──
function assignStudent(db, data) {
  if (!data || !data.student_id || !data.route_id) return { ok: false, error: 'Student and route are required.' };
  const route = db.prepare('SELECT id FROM transport_routes WHERE id = ?').get(data.route_id);
  if (!route) return { ok: false, error: 'Route not found.' };
  const fee = data.fee_override === '' || data.fee_override == null ? null : Number(data.fee_override);
  if (fee != null && (!Number.isFinite(fee) || fee < 0)) return { ok: false, error: 'Fee must be zero or more.' };
  db.prepare(`
    INSERT INTO student_transport (student_id, route_id, stop_id, direction, fee_override, start_date, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT (student_id) DO UPDATE SET
      route_id = excluded.route_id, stop_id = excluded.stop_id, direction = excluded.direction,
      fee_override = excluded.fee_override, start_date = excluded.start_date, is_active = 1
  `).run(data.student_id, data.route_id, data.stop_id || null, data.direction || 'both', fee,
         data.start_date || new Date().toISOString().slice(0, 10));
  return { ok: true };
}

function unassignStudent(db, studentId) {
  db.prepare('DELETE FROM student_transport WHERE student_id = ?').run(studentId);
  return { ok: true };
}

// A pupil's transport picture: route, stop, times, and the term fee balance.
function transportForStudent(db, studentId, termId = null) {
  const a = db.prepare(`
    SELECT st.*, r.name AS route_name, r.fee_per_term, r.driver_name, r.driver_phone, r.vehicle_number,
           s.name AS stop_name, s.pickup_time, s.dropoff_time
    FROM student_transport st
    JOIN transport_routes r ON r.id = st.route_id
    LEFT JOIN transport_stops s ON s.id = st.stop_id
    WHERE st.student_id = ? AND st.is_active = 1
  `).get(studentId);
  if (!a) return null;
  const term = termId || currentTermId(db);
  const expected = a.fee_override != null ? a.fee_override : (a.fee_per_term || 0);
  const paid = term ? (db.prepare('SELECT COALESCE(SUM(amount),0) t FROM transport_payments WHERE student_id = ? AND term_id = ?').get(studentId, term).t || 0) : 0;
  return {
    route_id: a.route_id, route_name: a.route_name,
    stop_id: a.stop_id, stop_name: a.stop_name,
    direction: a.direction,
    pickup_time: a.pickup_time, dropoff_time: a.dropoff_time,
    driver_name: a.driver_name, driver_phone: a.driver_phone, vehicle_number: a.vehicle_number,
    fee_per_term: Math.round(expected * 100) / 100,
    paid: Math.round(paid * 100) / 100,
    balance: Math.round((expected - paid) * 100) / 100,
    term_id: term,
  };
}

// Riders on a route (or all), each with their term balance — the management view.
function listRiders(db, { routeId = null, termId = null } = {}) {
  const term = termId || currentTermId(db);
  const rows = db.prepare(`
    SELECT st.student_id, st.route_id, st.stop_id, st.direction, st.fee_override,
           s.surname, s.first_name, s.index_number, c.name AS class_name,
           r.name AS route_name, r.fee_per_term, stp.name AS stop_name
    FROM student_transport st
    JOIN students s ON s.id = st.student_id
    JOIN transport_routes r ON r.id = st.route_id
    LEFT JOIN class_groups c ON c.id = s.current_class_id
    LEFT JOIN transport_stops stp ON stp.id = st.stop_id
    WHERE st.is_active = 1 ${routeId ? 'AND st.route_id = ?' : ''} AND s.status = 'Active'
    ORDER BY r.name, s.surname, s.first_name
  `).all(...(routeId ? [routeId] : []));
  return rows.map(r => {
    const expected = r.fee_override != null ? r.fee_override : (r.fee_per_term || 0);
    const paid = term ? (db.prepare('SELECT COALESCE(SUM(amount),0) t FROM transport_payments WHERE student_id=? AND term_id=?').get(r.student_id, term).t || 0) : 0;
    return {
      student_id: r.student_id, name: `${r.surname} ${r.first_name}`.trim(), index_number: r.index_number,
      class_name: r.class_name, route_id: r.route_id, route_name: r.route_name, stop_name: r.stop_name,
      direction: r.direction,
      expected: Math.round(expected * 100) / 100,
      paid: Math.round(paid * 100) / 100,
      balance: Math.round((expected - paid) * 100) / 100,
    };
  });
}

// Record a transport-fee payment. Posts income under the SAME term the payment
// is attributed to, idempotent on the receipt number, then receipts + delivers.
function recordPayment(db, data) {
  const amount = parseFloat(data.amount);
  if (!(amount > 0)) return { ok: false, error: 'A positive amount is required.' };
  if (!data.student_id) return { ok: false, error: 'Student is required.' };
  const termId = data.term_id != null ? data.term_id : currentTermId(db);
  const payDate = data.payment_date || new Date().toISOString().slice(0, 10);
  const route = db.prepare('SELECT route_id FROM student_transport WHERE student_id = ? AND is_active = 1').get(data.student_id);
  const receiptNo = nextReceipt(db);

  const tx = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO transport_payments (student_id, route_id, term_id, amount, payment_date, payment_method, reference, received_by, notes, receipt_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.student_id, data.route_id || route?.route_id || null, termId, amount, payDate,
      data.payment_method || 'Cash', data.reference || null,
      data.received_by || null, data.notes || null, receiptNo
    );
    postIncome(db, {
      receipt_number: receiptNo,
      category: 'transport',
      amount,
      description: `Transport fee — ${receiptNo}`,
      payment_method: data.payment_method || 'Cash',
      reference: data.reference || null,
      date: payDate,
      term_id: termId,
      source: 'transport_payment',
      student_id: data.student_id,
      recorded_by: data.received_by || null,
      is_auto: 1,
    });
    return r.lastInsertRowid;
  });
  const id = tx();
  let receiptRow = null;
  try { receiptRow = autoReceiptForPayment(db, 'transport', id); } catch (_) {}
  try { autoDeliverReceipt(db, 'transport', id); } catch (_) {}
  return { ok: true, id, receipt_number: receiptNo, receipt_id: receiptRow?.id || null };
}

function dashboard(db, termId = null) {
  const term = termId || currentTermId(db);
  const riders = listRiders(db, { termId: term });
  const collected = term ? (db.prepare(`
    SELECT COALESCE(SUM(amount),0) t FROM transport_payments WHERE term_id = ?
  `).get(term).t || 0) : 0;
  const outstanding = riders.reduce((s, r) => s + Math.max(0, r.balance), 0);
  return {
    metrics: {
      routes: db.prepare('SELECT COUNT(*) c FROM transport_routes WHERE is_active = 1').get().c,
      riders: riders.length,
      total_collected: Math.round(collected * 100) / 100,
      outstanding: Math.round(outstanding * 100) / 100,
    },
    debtors: riders.filter(r => r.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 20),
  };
}

function registerTransportHandlers(ipcMain, db) {
  ipcMain.handle('transport:list-routes', () => listRoutes(db));
  ipcMain.handle('transport:save-route', (_e, data) => saveRoute(db, data));
  ipcMain.handle('transport:delete-route', (_e, id) => deleteRoute(db, id));
  ipcMain.handle('transport:list-stops', (_e, routeId) => listStops(db, routeId));
  ipcMain.handle('transport:save-stop', (_e, data) => saveStop(db, data));
  ipcMain.handle('transport:delete-stop', (_e, id) => deleteStop(db, id));
  ipcMain.handle('transport:assign', (_e, data) => assignStudent(db, data));
  ipcMain.handle('transport:unassign', (_e, studentId) => unassignStudent(db, studentId));
  ipcMain.handle('transport:student', (_e, { studentId, termId }) => transportForStudent(db, studentId, termId));
  ipcMain.handle('transport:list-riders', (_e, args = {}) => listRiders(db, args));
  ipcMain.handle('transport:record-payment', (_e, data) => recordPayment(db, data));
  ipcMain.handle('transport:dashboard', (_e, termId) => dashboard(db, termId));
}

module.exports = registerTransportHandlers;
module.exports.transportForStudent = transportForStudent;
module.exports.listRiders = listRiders;
module.exports.recordPayment = recordPayment;
module.exports.dashboard = dashboard;
