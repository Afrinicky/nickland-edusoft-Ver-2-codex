// Transport and the store room.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Two small modules that the app did not have at all, and that a school with a
// bus and a stationery cupboard runs on. Both sit behind the `finance`
// permission, exactly as the desktop puts them.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { useOfficeClasses } from '../../pickers';
import { OfficeScreen, cedis, shortDate, useOffice } from '../../office';
import {
  Select, SearchField, DataTable, Muted, Badge, EmptyState, ErrorNote, SuccessNote,
  Button, Sheet, Field, TextArea, Loading, CheckRow, Divider,
} from '../../ui';
import { Panel, Bar, StatRow, Stat } from '../../desk';
import { colors, spacing, type } from '../../theme';

// A picker with nothing in it should say why, and what to do about it. The
// default — "Nothing to choose from." — is true and useless: a school that has
// not set up a bus route reads it as a fault in the app rather than as a job
// they have not done yet.
const NO_ROUTES = 'No bus routes have been set up yet. Add one under Transport \u2192 Routes, '
  + 'and riders can then be assigned to it.';

// ══ Transport ═══════════════════════════════════════════════════════════════

export function TransportRoutes() {
  const { token, profile } = useAuth();
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const state = useOffice((t) => api.transportRoutes(t));
  const may = can(profile, 'finance', 'edit');
  const routes = state.data?.routes || [];

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.saveTransportRoute(token, {
        id: editing.id || undefined,
        name: editing.name,
        description: editing.description || null,
        fee_per_term: editing.fee_per_term ? Number(editing.fee_per_term) : 0,
        driver_name: editing.driver_name || null,
        driver_contact: editing.driver_contact || null,
        vehicle_number: editing.vehicle_number || null,
        capacity: editing.capacity ? Number(editing.capacity) : null,
      });
      setEditing(null);
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={4}>
      <ErrorNote message={error} />
      <StatRow>
        <Stat index={0} label="Routes" icon="bus" tone="primary" value={routes.length}
              note={routes.length ? 'Running this term' : 'None set up yet'} />
        <Stat index={1} label="Riders" icon="users" tone="data"
              value={routes.reduce((n, r) => n + (Number(r.riders) || 0), 0)}
              note="Pupils assigned to a bus" />
        <Stat index={2} label="Termly fee" icon="wallet" tone="warning"
              value={routes.length ? cedis(Math.max(...routes.map(r => Number(r.fee_per_term) || 0))) : '—'}
              note="The highest route fee" />
      </StatRow>

      <Bar left={<Muted>A route is a bus, a driver and a fee. Pupils are put on one under Riders.</Muted>}
           right={may ? <Button title="Add a route" icon="plus" full={false}
                                onPress={() => setEditing({})} /> : null} />

      <Panel padded={false}>
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r) => String(r.id)}
            empty="No routes yet."
            onRowPress={may ? (r) => setEditing({ ...r }) : undefined}
            columns={[
              { key: 'name', label: 'Route', render: (r) => (
                <View style={{ minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>{r.name}</Text>
                  {r.description ? <Muted numberOfLines={1}>{r.description}</Muted> : null}
                </View>
              ) },
              { key: 'driver_name', label: 'Driver', width: 170 },
              { key: 'vehicle_number', label: 'Vehicle', width: 140 },
              { key: 'riders', label: 'Riders', align: 'right', width: 90,
                render: (r) => String(r.riders ?? '—') },
              { key: 'fee_per_term', label: 'Fee a term', align: 'right', width: 140,
                render: (r) => cedis(r.fee_per_term) },
            ]}
            rows={routes} />
        </View>
      </Panel>

      <Sheet visible={!!editing} onClose={() => setEditing(null)}
             title={editing && editing.id ? 'Change the route' : 'A new route'}>
        {editing ? (
          <>
            <Field label="Name" value={editing.name || ''}
                   onChangeText={(v) => setEditing(e => ({ ...e, name: v }))}
                   hint="Where it goes — Acherensua town, Kumasi road…" />
            <Field label="Fee a term" value={String(editing.fee_per_term ?? '')}
                   onChangeText={(v) => setEditing(e => ({ ...e, fee_per_term: v }))} />
            <Field label="Driver" value={editing.driver_name || ''}
                   onChangeText={(v) => setEditing(e => ({ ...e, driver_name: v }))} />
            <Field label="Driver's phone" value={editing.driver_contact || ''}
                   onChangeText={(v) => setEditing(e => ({ ...e, driver_contact: v }))} />
            <Field label="Vehicle number" value={editing.vehicle_number || ''}
                   onChangeText={(v) => setEditing(e => ({ ...e, vehicle_number: v }))} />
            <Field label="Seats" value={String(editing.capacity ?? '')}
                   onChangeText={(v) => setEditing(e => ({ ...e, capacity: v }))} />
            <TextArea label="Notes" value={editing.description || ''}
                      onChangeText={(v) => setEditing(e => ({ ...e, description: v }))} />
            <Button title={busy ? 'Saving…' : 'Save the route'} busy={busy} disabled={busy} onPress={save} />
          </>
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}

export function TransportRiders() {
  const { token, profile } = useAuth();
  const { classes } = useOfficeClasses(token);
  const [routeId, setRouteId] = useState('');
  const [classId, setClassId] = useState('');
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const may = can(profile, 'finance', 'edit');

  const routes = useOffice((t) => api.transportRoutes(t));
  const roll = useOffice(
    (t) => (classId ? api.adminStudents(t, { status: 'Active', classId }) : Promise.resolve({ ok: true, students: [] })),
    [classId]);
  const route = useOffice(
    (t) => (routeId ? api.transportRoute(t, routeId) : Promise.resolve({ ok: true, riders: [] })),
    [routeId]);

  const riding = useMemo(
    () => new Set((route.data?.riders || []).map(r => String(r.student_id ?? r.id))),
    [route.data]);

  async function assign() {
    const chosen = Object.keys(picked).filter(k => picked[k]);
    setBusy(true); setError(null); setDone(null);
    try {
      await api.setTransportRiders(token, {
        routeId: Number(routeId), studentIds: chosen.map(Number),
      });
      setPicked({});
      setDone(`${chosen.length} pupil${chosen.length === 1 ? '' : 's'} put on the route.`);
      route.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const chosen = Object.keys(picked).filter(k => picked[k]);

  return (
    <OfficeScreen state={routes} skeleton={4}>
      <ErrorNote message={error} />
      {done ? <SuccessNote message={done} /> : null}

      <Bar left={<>
        <View style={{ minWidth: 220 }}>
          <Select label="Route" value={routeId} onChange={(v) => { setPicked({}); setRouteId(v); }}
                  placeholder="Which route?" empty={NO_ROUTES}
                  options={(routes.data?.routes || []).map(r => ({ label: r.name, value: String(r.id),
                                                                   note: cedis(r.fee_per_term) }))} />
        </View>
        <View style={{ minWidth: 220 }}>
          <Select label="Class" value={classId} onChange={(v) => { setPicked({}); setClassId(v); }}
                  placeholder="Which class?"
                  options={(classes || []).map(c => ({ label: c.name, value: String(c.id) }))} />
        </View>
      </>}
      right={chosen.length && may ? (
        <Button title={busy ? 'Assigning…' : `Put ${chosen.length} on the bus`} busy={busy}
                disabled={busy} icon="check" full={false} onPress={assign} />
      ) : null} />

      {!routeId ? (
        <EmptyState icon="bus" title="Pick a route"
                    message="Riders are assigned one route at a time, so a pupil is never on two buses." />
      ) : (
        <View style={{ flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap' }}>
          <View style={{ minWidth: 300, flexGrow: 1, flexBasis: 340 }}>
            <Panel title="On this route" subtitle={`${(route.data?.riders || []).length} riders`}>
              <DataTable
                keyExtractor={(r, i) => String(r.student_id ?? r.id ?? i)}
                empty="Nobody rides this route yet."
                columns={[
                  { key: 'name', label: 'Pupil',
                    render: (r) => r.name || `${r.surname || ''} ${r.first_name || ''}`.trim() },
                  { key: 'class_name', label: 'Class', width: 130 },
                ]}
                rows={route.data?.riders || []} />
            </Panel>
          </View>
          <View style={{ minWidth: 300, flexGrow: 1, flexBasis: 340 }}>
            <Panel title="Add from a class"
                   subtitle={classId ? 'Tick the pupils who ride this bus.' : 'Choose a class above.'}>
              {!classId ? <Muted>No class chosen.</Muted> : (
                (roll.data?.students || []).map(s => (
                  <CheckRow key={s.id}
                            disabled={!may || riding.has(String(s.id))}
                            checked={riding.has(String(s.id)) || !!picked[s.id]}
                            onToggle={() => setPicked(p => ({ ...p, [s.id]: !p[s.id] }))}
                            title={s.name}
                            subtitle={riding.has(String(s.id)) ? 'Already on this route' : s.index_number} />
                ))
              )}
            </Panel>
          </View>
        </View>
      )}
    </OfficeScreen>
  );
}

export function TransportPayments() {
  const { token, profile } = useAuth();
  const [routeId, setRouteId] = useState('');
  const [taking, setTaking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const routes = useOffice((t) => api.transportRoutes(t));
  const route = useOffice(
    (t) => (routeId ? api.transportRoute(t, routeId) : Promise.resolve({ ok: true, riders: [] })),
    [routeId]);
  const may = can(profile, 'finance', 'create');

  async function take() {
    setBusy(true); setError(null); setDone(null);
    try {
      await api.transportPayment(token, {
        studentId: Number(taking.student_id ?? taking.id),
        routeId: Number(routeId),
        amount: Number(taking.amount) || 0,
        paymentMethod: taking.method || 'Cash',
      });
      setDone(`${cedis(taking.amount)} receipted for ${taking.name}.`);
      setTaking(null);
      route.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={routes} skeleton={4}>
      <ErrorNote message={error} />
      {done ? <SuccessNote message={done} /> : null}

      <Bar left={<View style={{ minWidth: 240 }}>
        <Select label="Route" value={routeId} onChange={setRouteId} placeholder="Which route?"
                empty={NO_ROUTES}
                options={(routes.data?.routes || []).map(r => ({ label: r.name, value: String(r.id) }))} />
      </View>} />

      {!routeId ? (
        <EmptyState icon="wallet" title="Pick a route"
                    message="Transport is charged per term, per rider, and receipted like any other payment." />
      ) : (
        <Panel padded={false} title="Riders and what they owe">
          <View style={{ padding: spacing.lg }}>
            <DataTable
              keyExtractor={(r, i) => String(r.student_id ?? r.id ?? i)}
              empty="Nobody rides this route yet."
              columns={[
                { key: 'name', label: 'Pupil',
                  render: (r) => r.name || `${r.surname || ''} ${r.first_name || ''}`.trim() },
                { key: 'class_name', label: 'Class', width: 130 },
                { key: 'paid', label: 'Paid', align: 'right', width: 120,
                  render: (r) => cedis(r.paid ?? 0) },
                { key: 'balance', label: 'Owes', align: 'right', width: 120,
                  render: (r) => cedis(r.balance ?? 0) },
                { key: 'take', label: '', align: 'right', width: 120,
                  render: (r) => (may ? (
                    <Button size="sm" variant="outline" full={false} title="Take"
                            onPress={() => setTaking({ ...r, name: r.name || `${r.surname || ''} ${r.first_name || ''}`.trim(),
                                                       amount: r.balance ?? '', method: 'Cash' })} />
                  ) : null) },
              ]}
              rows={route.data?.riders || []} />
          </View>
        </Panel>
      )}

      <Sheet visible={!!taking} onClose={() => setTaking(null)}
             title={taking ? `Transport — ${taking.name}` : ''}>
        {taking ? (
          <>
            <Field label="Amount" value={String(taking.amount ?? '')}
                   onChangeText={(v) => setTaking(t => ({ ...t, amount: v }))} />
            <Select label="How they paid" value={taking.method}
                    onChange={(v) => setTaking(t => ({ ...t, method: v }))}
                    options={['Cash', 'Mobile Money', 'Bank Transfer'].map(m => ({ label: m, value: m }))} />
            <Button title={busy ? 'Receipting…' : 'Receipt it'} busy={busy} disabled={busy} onPress={take} />
          </>
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}

// ══ Purchasing & Inventory ══════════════════════════════════════════════════

export function InventoryDashboard() {
  const state = useOffice((t) => api.inventory(t));
  const items = state.data?.items || [];
  const low = items.filter(i => Number(i.quantity) <= Number(i.reorder_level || 0));
  const value = items.reduce((n, i) => n + ((Number(i.quantity) || 0) * (Number(i.unit_cost) || 0)), 0);

  return (
    <OfficeScreen state={state} skeleton={4}>
      <StatRow>
        <Stat index={0} label="Items on the books" icon="box" tone="primary" value={items.length}
              note="Everything the school owns and counts" />
        <Stat index={1} label="Value in store" icon="wallet" tone="data" value={cedis(value)}
              note="Quantity times unit cost" />
        <Stat index={2} label="Running low" icon="alert" tone={low.length ? 'danger' : 'success'}
              value={low.length}
              note={low.length ? 'At or under the reorder level' : 'Nothing needs reordering'} />
      </StatRow>

      {low.length ? (
        <Panel padded={false} title="Reorder these"
               subtitle="At or below the level somebody set for them.">
          <View style={{ padding: spacing.lg }}>
            <DataTable
              keyExtractor={(r) => String(r.id)}
              columns={[
                { key: 'name', label: 'Item' },
                { key: 'quantity', label: 'In store', align: 'right', width: 110 },
                { key: 'reorder_level', label: 'Reorder at', align: 'right', width: 120 },
              ]}
              rows={low} />
          </View>
        </Panel>
      ) : null}
    </OfficeScreen>
  );
}

export function InventoryItems() {
  const { token, profile } = useAuth();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [moving, setMoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const state = useOffice((t) => api.inventory(t));
  const may = can(profile, 'finance', 'edit');
  const mayMove = can(profile, 'finance', 'create');

  const rows = useMemo(() => {
    const list = state.data?.items || [];
    const needle = q.trim().toLowerCase();
    return needle ? list.filter(i => `${i.name || ''} ${i.category || ''}`.toLowerCase().includes(needle)) : list;
  }, [state.data, q]);

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.saveInventoryItem(token, {
        id: editing.id || undefined,
        name: editing.name,
        category: editing.category || null,
        unit: editing.unit || null,
        unit_cost: editing.unit_cost ? Number(editing.unit_cost) : 0,
        reorder_level: editing.reorder_level ? Number(editing.reorder_level) : 0,
      });
      setEditing(null);
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function move() {
    setBusy(true); setError(null);
    try {
      await api.moveStock(token, {
        itemId: Number(moving.id),
        movementType: moving.direction,
        quantity: Number(moving.quantity) || 0,
        notes: moving.notes || null,
      });
      setMoving(null);
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      <Bar left={<View style={{ minWidth: 260, flex: 1 }}>
        <SearchField value={q} onChangeText={setQ} placeholder="Find an item" />
      </View>}
      right={may ? <Button title="Add an item" icon="plus" full={false}
                           onPress={() => setEditing({})} /> : null} />

      <Panel padded={false}>
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r) => String(r.id)}
            empty="Nothing in the store room yet."
            onRowPress={may ? (r) => setEditing({ ...r }) : undefined}
            columns={[
              { key: 'name', label: 'Item', render: (r) => (
                <View style={{ minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>{r.name}</Text>
                  {r.category ? <Muted numberOfLines={1}>{r.category}</Muted> : null}
                </View>
              ) },
              { key: 'quantity', label: 'In store', align: 'right', width: 100,
                render: (r) => (
                  <Text style={{ ...type.small, fontWeight: '700',
                                 color: Number(r.quantity) <= Number(r.reorder_level || 0)
                                   ? colors.danger : colors.text }}>
                    {r.quantity} {r.unit || ''}
                  </Text>
                ) },
              { key: 'unit_cost', label: 'Unit cost', align: 'right', width: 120,
                render: (r) => cedis(r.unit_cost) },
              { key: 'move', label: '', align: 'right', width: 150,
                render: (r) => (mayMove ? (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Button size="sm" variant="outline" full={false} title="In"
                            onPress={() => setMoving({ ...r, direction: 'in', quantity: '' })} />
                    <Button size="sm" variant="ghost" full={false} title="Out"
                            onPress={() => setMoving({ ...r, direction: 'out', quantity: '' })} />
                  </View>
                ) : null) },
            ]}
            rows={rows} />
        </View>
      </Panel>

      <Sheet visible={!!editing} onClose={() => setEditing(null)}
             title={editing && editing.id ? 'Change the item' : 'A new item'}>
        {editing ? (
          <>
            <Field label="Name" value={editing.name || ''}
                   onChangeText={(v) => setEditing(e => ({ ...e, name: v }))} />
            <Field label="Category" value={editing.category || ''}
                   onChangeText={(v) => setEditing(e => ({ ...e, category: v }))}
                   hint="Stationery, cleaning, furniture…" />
            <Field label="Unit" value={editing.unit || ''}
                   onChangeText={(v) => setEditing(e => ({ ...e, unit: v }))}
                   hint="Reams, boxes, pieces" />
            <Field label="Unit cost" value={String(editing.unit_cost ?? '')}
                   onChangeText={(v) => setEditing(e => ({ ...e, unit_cost: v }))} />
            <Field label="Reorder when it falls to" value={String(editing.reorder_level ?? '')}
                   onChangeText={(v) => setEditing(e => ({ ...e, reorder_level: v }))} />
            <Button title={busy ? 'Saving…' : 'Save the item'} busy={busy} disabled={busy} onPress={save} />
          </>
        ) : null}
      </Sheet>

      <Sheet visible={!!moving} onClose={() => setMoving(null)}
             title={moving ? `${moving.direction === 'in' ? 'Into' : 'Out of'} the store — ${moving.name}` : ''}>
        {moving ? (
          <>
            <Muted>{`There are ${moving.quantity ?? 0} ${moving.unit || ''} on the books now.`}</Muted>
            <Field label="How many" value={String(moving.quantity ?? '')}
                   onChangeText={(v) => setMoving(m => ({ ...m, quantity: v }))} />
            <Field label="Why" value={moving.notes || ''}
                   onChangeText={(v) => setMoving(m => ({ ...m, notes: v }))}
                   hint="Bought from…, issued to…" />
            <Button title={busy ? 'Recording…' : 'Record it'} busy={busy} disabled={busy} onPress={move} />
          </>
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}

export function InventoryMovements() {
  const state = useOffice((t) => api.stockMovements(t));
  const rows = state.data?.movements || [];
  return (
    <OfficeScreen state={state} skeleton={5}>
      <Panel padded={false} title="Everything in and out"
             subtitle="Newest first. A store room with no movement log is a store room nobody can audit.">
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r, i) => String(r.id ?? i)}
            empty="Nothing has moved yet."
            columns={[
              { key: 'created_at', label: 'When', width: 120,
                render: (r) => shortDate(r.created_at || r.movement_date) },
              { key: 'item_name', label: 'Item' },
              { key: 'movement_type', label: 'Direction', width: 110,
                render: (r) => <Badge tone={r.movement_type === 'in' ? 'success' : 'warning'}
                                      label={r.movement_type === 'in' ? 'In' : 'Out'} /> },
              { key: 'quantity', label: 'How many', align: 'right', width: 110 },
              { key: 'notes', label: 'Why' },
            ]}
            rows={rows} />
        </View>
      </Panel>
    </OfficeScreen>
  );
}
