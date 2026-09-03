// Transport — bus routes, stops, pupil assignments and termly fee collection.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi } from '../../lib/format.js';

export default function TransportIndex() {
  const { currentTerm, currentUser, showToast, can } = useStore();
  const canEdit = can('finance', 'edit') || can('finance', 'create');
  const [routes, setRoutes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [dash, setDash] = useState(null);
  const [routeModal, setRouteModal] = useState(null);
  const [assignModal, setAssignModal] = useState(false);
  const [payModal, setPayModal] = useState(null);

  async function loadRoutes() {
    const r = await window.api.transport.listRoutes();
    setRoutes(r);
    if (r.length && (selected == null || !r.find(x => x.id === selected))) setSelected(r[0].id);
    if (!r.length) setSelected(null);
  }
  async function loadDash() { setDash(await window.api.transport.dashboard(currentTerm?.id)); }
  useEffect(() => { loadRoutes(); }, []);
  useEffect(() => { loadDash(); }, [currentTerm?.id, routes.length]);

  const route = routes.find(r => r.id === selected) || null;

  async function delRoute(r) {
    if (!window.confirm(`Delete route "${r.name}"? Its stops will be removed.`)) return;
    const res = await window.api.transport.deleteRoute(r.id);
    if (res.ok) { showToast('Route deleted.', 'success'); loadRoutes(); }
    else showToast(res.error, 'error');
  }

  return (
    <div style={{ padding: 24 }}>
      <div className="page-header"><div>
        <div className="page-title">Transport</div>
        <div className="page-subtitle">Bus routes, stops, riders and termly transport fees</div>
      </div></div>

      {dash && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '4px 0 18px' }}>
          <Stat label="Active routes" value={dash.metrics.routes} />
          <Stat label="Riders" value={dash.metrics.riders} />
          <Stat label={`Collected (${currentTerm?.label || 'term'})`} value={fmtCedi(dash.metrics.total_collected)} tone="ok" />
          <Stat label="Outstanding" value={fmtCedi(dash.metrics.outstanding)} tone={dash.metrics.outstanding > 0 ? 'bad' : 'ok'} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Routes list */}
        <div className="card" style={{ width: 300, flexShrink: 0 }}>
          <div className="section-header">
            <div className="section-title">Routes</div>
            {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setRouteModal({})}>+ Route</button>}
          </div>
          {routes.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>No routes yet.</div>}
          {routes.map(r => (
            <div key={r.id} onClick={() => setSelected(r.id)}
              style={{ padding: '10px 8px', borderRadius: 8, cursor: 'pointer', marginBottom: 4,
                background: r.id === selected ? 'var(--bg)' : 'transparent',
                borderLeft: r.id === selected ? '3px solid var(--navy, #1B3A6B)' : '3px solid transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{r.name}</strong>
                {!r.is_active && <span className="badge">Inactive</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {r.rider_count} rider{r.rider_count === 1 ? '' : 's'} · {fmtCedi(r.fee_per_term)}/term
                {r.driver_name ? ` · ${r.driver_name}` : ''}
              </div>
            </div>
          ))}
        </div>

        {/* Selected route detail */}
        <div style={{ flex: 1, minWidth: 380 }}>
          {!route ? <div className="card" style={{ color: 'var(--muted)' }}>Select or add a route.</div> : (
            <>
              <div className="card">
                <div className="section-header">
                  <div className="section-title">{route.name}</div>
                  {canEdit && <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setRouteModal(route)}>Edit</button>
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => delRoute(route)}>Delete</button>
                  </div>}
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {[route.vehicle_number && `Vehicle ${route.vehicle_number}`,
                    route.driver_name && `Driver ${route.driver_name}`,
                    route.driver_phone,
                    route.capacity && `Capacity ${route.capacity}`,
                    `${fmtCedi(route.fee_per_term)}/term`].filter(Boolean).join(' · ')}
                </div>
                <StopsPanel routeId={route.id} canEdit={canEdit} showToast={showToast} />
              </div>

              <RidersPanel routeId={route.id} termId={currentTerm?.id} canEdit={canEdit}
                onAssign={() => setAssignModal(true)} onCollect={(rider) => setPayModal(rider)} refreshKey={routeModal} />
            </>
          )}
        </div>
      </div>

      {routeModal && <RouteModal initial={routeModal} onClose={() => setRouteModal(null)}
        onSaved={() => { setRouteModal(null); loadRoutes(); }} showToast={showToast} />}
      {assignModal && route && <AssignModal routeId={route.id} onClose={() => setAssignModal(false)}
        onSaved={() => { setAssignModal(false); loadRoutes(); loadDash(); setSelected(route.id); }} showToast={showToast} />}
      {payModal && <PayModal rider={payModal} termId={currentTerm?.id} currentUser={currentUser}
        onClose={() => setPayModal(null)} onSaved={() => { setPayModal(null); loadDash(); loadRoutes(); }} showToast={showToast} />}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 150, padding: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: tone === 'ok' ? 'var(--ok, #15803D)' : tone === 'bad' ? 'var(--danger)' : undefined }}>{value}</div>
    </div>
  );
}

function StopsPanel({ routeId, canEdit, showToast }) {
  const [stops, setStops] = useState([]);
  const [form, setForm] = useState({ name: '', pickup_time: '' });
  async function load() { setStops(await window.api.transport.listStops(routeId)); }
  useEffect(() => { load(); }, [routeId]);
  async function add() {
    if (!form.name.trim()) return;
    const r = await window.api.transport.saveStop({ route_id: routeId, name: form.name, pickup_time: form.pickup_time });
    if (r.ok) { setForm({ name: '', pickup_time: '' }); load(); } else showToast(r.error, 'error');
  }
  async function del(id) { await window.api.transport.deleteStop(id); load(); }
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Stops</div>
      {stops.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>No stops yet.</div>}
      {stops.map(s => (
        <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--line, #E7EBF1)' }}>
          <span>{s.name}</span>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            {s.pickup_time || ''} {canEdit && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => del(s.id)}>✕</button>}
          </span>
        </div>
      ))}
      {canEdit && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input className="input" placeholder="Stop name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <input className="input" placeholder="06:40" style={{ width: 90 }} value={form.pickup_time} onChange={e => setForm(f => ({ ...f, pickup_time: e.target.value }))} />
          <button className="btn btn-ghost" onClick={add}>Add</button>
        </div>
      )}
    </div>
  );
}

function RidersPanel({ routeId, termId, canEdit, onAssign, onCollect, refreshKey }) {
  const [riders, setRiders] = useState([]);
  async function load() { setRiders(await window.api.transport.listRiders({ routeId, termId })); }
  useEffect(() => { load(); }, [routeId, termId, refreshKey]);
  async function unassign(sid) {
    if (!window.confirm('Remove this pupil from the route?')) return;
    await window.api.transport.unassign(sid); load();
  }
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="section-header">
        <div className="section-title">Riders</div>
        {canEdit && <button className="btn btn-primary btn-sm" onClick={onAssign}>+ Assign pupil</button>}
      </div>
      {riders.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>No pupils on this route.</div> : (
        <table className="table" style={{ width: '100%' }}>
          <thead><tr><th>Name</th><th>Class</th><th>Stop</th><th className="text-right">Expected</th><th className="text-right">Paid</th><th className="text-right">Balance</th><th></th></tr></thead>
          <tbody>
            {riders.map(r => (
              <tr key={r.student_id}>
                <td>{r.name}</td>
                <td>{r.class_name || '—'}</td>
                <td>{r.stop_name || '—'}</td>
                <td className="text-right">{fmtCedi(r.expected)}</td>
                <td className="text-right">{fmtCedi(r.paid)}</td>
                <td className="text-right" style={{ color: r.balance > 0 ? 'var(--danger)' : 'var(--ok, #15803D)', fontWeight: 700 }}>{fmtCedi(r.balance)}</td>
                <td className="text-right" style={{ whiteSpace: 'nowrap' }}>
                  {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => onCollect(r)}>Collect</button>}
                  {canEdit && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => unassign(r.student_id)}>Remove</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RouteModal({ initial, onClose, onSaved, showToast }) {
  const [f, setF] = useState({
    id: initial.id || null, name: initial.name || '', description: initial.description || '',
    vehicle_number: initial.vehicle_number || '', driver_name: initial.driver_name || '',
    driver_phone: initial.driver_phone || '', capacity: initial.capacity || '',
    fee_per_term: initial.fee_per_term ?? 0, is_active: initial.is_active !== 0,
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  async function save() {
    if (!f.name.trim()) { showToast('A route name is required.', 'error'); return; }
    const r = await window.api.transport.saveRoute(f);
    if (r.ok) { showToast(f.id ? 'Route updated.' : 'Route added.', 'success'); onSaved(); }
    else showToast(r.error, 'error');
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>{f.id ? 'Edit route' : 'New route'}</h3></div>
        <div className="modal-body">
          <label className="label">Route name</label>
          <input className="input" value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Route A — Adenta" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <div><label className="label">Fee per term (GHS)</label>
              <input className="input" type="number" min="0" value={f.fee_per_term} onChange={e => set('fee_per_term', e.target.value)} /></div>
            <div><label className="label">Capacity</label>
              <input className="input" type="number" min="0" value={f.capacity} onChange={e => set('capacity', e.target.value)} /></div>
            <div><label className="label">Vehicle number</label>
              <input className="input" value={f.vehicle_number} onChange={e => set('vehicle_number', e.target.value)} /></div>
            <div><label className="label">Driver name</label>
              <input className="input" value={f.driver_name} onChange={e => set('driver_name', e.target.value)} /></div>
            <div><label className="label">Driver phone</label>
              <input className="input" value={f.driver_phone} onChange={e => set('driver_phone', e.target.value)} /></div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <input type="checkbox" checked={f.is_active} onChange={e => set('is_active', e.target.checked)} /> Active
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>{f.id ? 'Save' : 'Add route'}</button>
        </div>
      </div>
    </div>
  );
}

function AssignModal({ routeId, onClose, onSaved, showToast }) {
  const [students, setStudents] = useState([]);
  const [stops, setStops] = useState([]);
  const [f, setF] = useState({ student_id: '', stop_id: '', direction: 'both', fee_override: '' });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  useEffect(() => {
    window.api.students.list({ status: 'Active' }).then(s => setStudents(s || [])).catch(() => setStudents([]));
    window.api.transport.listStops(routeId).then(setStops);
  }, [routeId]);
  async function save() {
    if (!f.student_id) { showToast('Choose a pupil.', 'error'); return; }
    const r = await window.api.transport.assign({ student_id: Number(f.student_id), route_id: routeId,
      stop_id: f.stop_id ? Number(f.stop_id) : null, direction: f.direction,
      fee_override: f.fee_override === '' ? null : Number(f.fee_override) });
    if (r.ok) { showToast('Pupil assigned.', 'success'); onSaved(); } else showToast(r.error, 'error');
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>Assign pupil to route</h3></div>
        <div className="modal-body">
          <label className="label">Pupil</label>
          <select className="input" value={f.student_id} onChange={e => set('student_id', e.target.value)}>
            <option value="">— choose —</option>
            {students.map(s => <option key={s.id} value={s.id}>{s.surname} {s.first_name} ({s.index_number})</option>)}
          </select>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <div><label className="label">Stop</label>
              <select className="input" value={f.stop_id} onChange={e => set('stop_id', e.target.value)}>
                <option value="">— any —</option>
                {stops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div><label className="label">Direction</label>
              <select className="input" value={f.direction} onChange={e => set('direction', e.target.value)}>
                <option value="both">Both ways</option>
                <option value="morning">Morning only</option>
                <option value="afternoon">Afternoon only</option>
              </select></div>
          </div>
          <label className="label" style={{ marginTop: 12 }}>Fee override (optional — leave blank for the route rate)</label>
          <input className="input" type="number" min="0" value={f.fee_override} onChange={e => set('fee_override', e.target.value)} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Assign</button>
        </div>
      </div>
    </div>
  );
}

function PayModal({ rider, termId, currentUser, onClose, onSaved, showToast }) {
  const [amount, setAmount] = useState(rider.balance > 0 ? String(rider.balance) : '');
  const [method, setMethod] = useState('Cash');
  const [busy, setBusy] = useState(false);
  async function collect() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { showToast('Enter a valid amount.', 'error'); return; }
    setBusy(true);
    try {
      const r = await window.api.transport.recordPayment({ student_id: rider.student_id, route_id: rider.route_id,
        term_id: termId, amount: amt, payment_method: method, received_by: currentUser?.id || null });
      if (r.ok) { showToast(`Transport fee collected. Receipt ${r.receipt_number}.`, 'success'); onSaved(); }
      else showToast(r.error, 'error');
    } finally { setBusy(false); }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 400 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>Collect transport fee</h3></div>
        <div className="modal-body">
          <div style={{ marginBottom: 10 }}><strong>{rider.name}</strong> · balance {fmtCedi(rider.balance)}</div>
          <label className="label">Amount (GHS)</label>
          <input className="input" type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} autoFocus />
          <label className="label" style={{ marginTop: 12 }}>Method</label>
          <select className="input" value={method} onChange={e => setMethod(e.target.value)}>
            <option>Cash</option><option>Momo</option><option>Bank</option>
          </select>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={collect} disabled={busy}>{busy ? 'Collecting…' : 'Collect'}</button>
        </div>
      </div>
    </div>
  );
}
