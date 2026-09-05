// Nickland Edusoft — Books.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Textbooks are charged ONCE for the academic year — Part B of the bill a
// Ghanaian school prints — and whatever is unpaid carries into Terms 2 and 3 as
// arrears on the fees bill. That is why they are not on the term fee: a parent
// who bought the books in September must not be asked for them again in
// January.
//
// The installed application's Books tab, cloned: charge the books, take the
// money with the mode and reference a receipt needs, and print the bill.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { isElevated } from '../../modules';
import { useOfficeClasses } from '../../pickers';
import { cedis, useOffice, OfficeScreen } from '../../office';
import {
  Select, DataTable, Muted, Badge, Button, Field, Sheet, CheckRow, Divider,
  EmptyState, ErrorNote, SuccessNote, SearchField, SegmentedControl,
} from '../../ui';
import { Panel, Bar, StatRow, Stat } from '../../desk';
import { printHtml } from '../../print';
import { ReceiptView } from './receipt';
import { colors, spacing, type } from '../../theme';

const STATUSES = [
  { label: 'All', value: '' },
  { label: 'Paid in Full', value: 'paid_full' },
  { label: 'Partial Payment', value: 'paid_partial' },
  { label: 'Not Paid', value: 'unpaid' },
  { label: 'Not Billed', value: 'not_billed' },
];

export default function BooksBills() {
  const { token, profile } = useAuth();
  const { classes } = useOfficeClasses(token);
  const mayTake = can(profile, 'fees', 'create');
  const mayCharge = isElevated(profile);

  const [config, setConfig] = useState({ methods: [], reference_required: [] });
  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [amounts, setAmounts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [lastPaid, setLastPaid] = useState({});
  const [selected, setSelected] = useState(() => new Set());
  const [charging, setCharging] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  useEffect(() => {
    api.paymentPurposes(token).then(r => r && r.ok && setConfig(r)).catch(() => {});
  }, [token]);

  const state = useOffice(
    (t) => (classId ? api.booksSheet(t, classId) : Promise.resolve({ ok: true, rows: [] })),
    [classId]);

  const rows = state.data?.rows || [];
  const year = state.data?.year || null;
  const needsReference = (config.reference_required || []).includes(method);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r =>
      (!status || r.status === status)
      && (!needle || `${r.surname} ${r.first_name} ${r.index_number}`.toLowerCase().includes(needle)));
  }, [rows, status, q]);

  const totals = useMemo(() => filtered.reduce((a, r) => ({
    billed: a.billed + (r.books_total || 0),
    paid: a.paid + (r.books_paid || 0),
    balance: a.balance + (r.books_balance || 0),
  }), { billed: 0, paid: 0, balance: 0 }), [filtered]);

  const take = useCallback(async (row) => {
    const amount = Number(amounts[row.student_id]);
    if (!(amount > 0)) return setError('Enter a positive amount.');
    if (needsReference && !reference.trim()) {
      return setError(`A ${method.toLowerCase()} payment needs its transaction reference.`);
    }
    setSavingId(row.student_id); setError(null);
    try {
      const res = await api.takePayment(token, {
        studentId: row.student_id, purpose: 'books',
        referenceId: row.student_books_id, amount, method, reference: reference.trim(),
      });
      setAmounts(prev => { const n = { ...prev }; delete n[row.student_id]; return n; });
      setLastPaid(prev => ({
        ...prev,
        [row.student_id]: {
          receiptNo: res.receipt_number, paymentId: res.payment_id,
          source: res.source, receipt: res.receipt,
        },
      }));
      setNote(`${cedis(amount)} — receipt ${res.receipt_number}`);
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setSavingId(null); }
  }, [token, amounts, method, reference, needsReference, state]);

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function printBills(studentIds, what) {
    if (!studentIds.length) return setError('Nobody selected to print for.');
    setError(null);
    try {
      const doc = await api.booksBillHtml(token, {
        academicYearId: year?.id, studentIds: studentIds.join(','),
      });
      await printHtml(doc);
      setNote(`${studentIds.length} books ${what} ready to print`);
    } catch (e) { setError(e.message); }
  }

  function showReceipt(row) {
    const lp = lastPaid[row.student_id];
    if (!lp) return;
    if (lp.receipt) return setReceipt(lp.receipt);
    api.paymentReceipt(token, lp.source, lp.paymentId)
      .then(r => setReceipt(r.receipt)).catch(e => setError(e.message));
  }

  async function print() {
    if (!receipt) return;
    setPrinting(true);
    try {
      const doc = await api.receiptHtml(token, receipt.source, receipt.payment_id,
        { purpose: receipt.purpose });
      await printHtml(doc);
    } catch (e) { setError(e.message); }
    finally { setPrinting(false); }
  }

  if (receipt) {
    return (
      <Panel>
        <ReceiptView receipt={receipt} busy={printing} onPrint={print}
                     onClose={() => setReceipt(null)} />
      </Panel>
    );
  }

  const className = (classes || []).find(c => String(c.id) === String(classId))?.name;

  return (
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      {note ? <SuccessNote message={note} /> : null}

      <Panel title={`Books — ${year?.label || 'no academic year set'}`}
             subtitle="Charged once for the year. Anything unpaid carries into the following terms as arrears on the school fees bill, so a parent who has bought the books is never asked for them twice."
             right={mayCharge ? (
               <Button title="Charge books" icon="book" full={false}
                       onPress={() => setCharging(true)} />
             ) : null}>
        <Bar left={<>
          <View style={{ minWidth: 190 }}>
            <Select label="Class" value={classId} onChange={setClassId}
                    placeholder="— Select Class —"
                    options={(classes || []).map(c => ({ label: c.name, value: String(c.id) }))} />
          </View>
          <View style={{ minWidth: 170 }}>
            <Select label="Filter by Status" value={status} onChange={setStatus} options={STATUSES} />
          </View>
          <View style={{ minWidth: 200 }}>
            <SearchField value={q} onChangeText={setQ} placeholder="Find a pupil" />
          </View>
        </>} />

        {mayTake ? (
          <Bar left={<>
            <View style={{ minWidth: 180 }}>
              <Select label="Mode of payment" value={method} onChange={setMethod}
                      options={config.methods.map(m => ({ label: m, value: m }))} />
            </View>
            <View style={{ minWidth: 220 }}>
              <Field label={needsReference ? 'Reference (required)' : 'Reference (cash needs none)'}
                     value={reference} onChangeText={setReference} editable={needsReference}
                     placeholder={needsReference ? 'Transaction ID or slip number' : '—'} />
            </View>
          </>} />
        ) : null}
      </Panel>

      {classId && rows.length ? (
        <StatRow>
          <Stat index={0} label="Charged" icon="book" tone="primary"
                value={cedis(totals.billed)} note={`${filtered.length} pupil(s)`} />
          <Stat index={1} label="Collected" icon="check" tone="success"
                value={cedis(totals.paid)}
                note={`${rows.filter(r => r.status === 'paid_full').length} fully paid`} />
          <Stat index={2} label="Outstanding" icon="alert" tone="danger"
                value={cedis(totals.balance)}
                note={`${rows.filter(r => (r.books_balance || 0) > 0).length} still owing`} />
          <Stat index={3} label="Per pupil" icon="wallet" tone="data"
                value={cedis(filtered.length ? totals.billed / filtered.length : 0)}
                note={className || 'the class'} />
        </StatRow>
      ) : null}

      {!classId ? (
        <EmptyState icon="book" title="Pick a class"
                    message="Books are charged and paid for per pupil, separately from school fees, because a parent who has bought last year's books does not owe for them again." />
      ) : (
        <Panel padded={false} title={`${filtered.length} pupil(s)`}
               right={<>
                 {selected.size ? (
                   <Button title={`Print ${selected.size} selected`} icon="print" size="sm" full={false}
                           onPress={() => printBills([...selected], 'bill(s)')} />
                 ) : null}
                 <Button title={`Print all of ${className}`} icon="print" size="sm"
                         variant="outline" full={false}
                         onPress={() => printBills(filtered.map(r => r.student_id), 'bill(s)')} />
               </>}>
          <View style={{ padding: spacing.lg }}>
            <DataTable
              keyExtractor={(r) => String(r.student_id)}
              empty={rows.length === 0
                ? `Nothing has been charged to ${className || 'this class'} for ${year?.label || 'this year'}.`
                : 'No students match the filter'}
              columns={[
                { key: 'pick', label: '', width: 44, render: (r) => (
                  <Pressable onPress={() => toggle(r.student_id)} accessibilityRole="checkbox"
                             accessibilityState={{ checked: selected.has(r.student_id) }}
                             style={{
                               width: 18, height: 18, borderRadius: 4, borderWidth: 1.5,
                               borderColor: selected.has(r.student_id) ? colors.primary : colors.border,
                               backgroundColor: selected.has(r.student_id) ? colors.primary : 'transparent',
                             }} />
                ) },
                { key: 'index_number', label: 'Index No.', width: 120 },
                { key: 'name', label: 'Name',
                  render: (r) => (
                    <Text numberOfLines={1} style={{ ...type.small, color: colors.text }}>
                      <Text style={{ fontWeight: '800' }}>{r.surname}</Text>{`, ${r.first_name}`}
                    </Text>
                  ) },
                { key: 'books_total', label: 'Books Cost', align: 'right', width: 120,
                  render: (r) => ((r.books_total || 0) > 0 ? cedis(r.books_total) : '—') },
                { key: 'books_paid', label: 'Paid', align: 'right', width: 120,
                  render: (r) => (
                    <Text style={{ ...type.small, color: '#15803D', fontVariant: ['tabular-nums'] }}>
                      {cedis(r.books_paid || 0)}
                    </Text>
                  ) },
                { key: 'books_balance', label: 'Balance', align: 'right', width: 120,
                  render: (r) => (
                    <Text style={{
                      ...type.small, fontWeight: '800',
                      color: (r.books_balance || 0) > 0 ? colors.danger : '#15803D',
                      fontVariant: ['tabular-nums'],
                    }}>{cedis(r.books_balance || 0)}</Text>
                  ) },
                { key: 'status', label: 'Status', width: 110,
                  render: (r) => <Badge tone={statusTone(r.status)} label={statusLabel(r.status)} /> },
                ...(mayTake ? [{ key: 'pay', label: 'Pay Now', align: 'right', width: 150,
                  render: (r) => (
                    <View style={{ width: 130 }}>
                      <Field label="" value={amounts[r.student_id] || ''}
                             keyboardType="decimal-pad" placeholder="0.00"
                             editable={r.status !== 'not_billed'}
                             onChangeText={(v) => setAmounts(a => ({ ...a, [r.student_id]: v }))} />
                    </View>
                  ) }] : []),

                // Labelled, never iconography at 45% opacity.
                { key: 'act', label: 'Actions', width: 210, render: (r) => {
                  const has = Number(amounts[r.student_id]) > 0;
                  const lp = lastPaid[r.student_id];
                  const saving = savingId === r.student_id;
                  if (mayTake && (has || saving)) {
                    return (
                      <Button title={saving ? 'Saving…' : `Take ${cedis(Number(amounts[r.student_id]) || 0)}`}
                              icon="check" size="sm" full={false} busy={saving} disabled={saving}
                              onPress={() => take(r)} />
                    );
                  }
                  if (lp) {
                    return (
                      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                        <Badge tone="success" label={lp.receiptNo} />
                        <Button title="View receipt" size="sm" variant="outline" full={false}
                                onPress={() => showReceipt(r)} />
                      </View>
                    );
                  }
                  return (
                    <Button title="Print this bill" size="sm" variant="outline" full={false}
                            onPress={() => printBills([r.student_id], 'bill')} />
                  );
                } },
              ]}
              rows={filtered} />
          </View>
        </Panel>
      )}

      {charging ? (
        <ChargeSheet classes={classes} classId={classId} year={year}
                     onClose={() => setCharging(false)}
                     onDone={(msg) => { setCharging(false); setNote(msg); state.reload(); }} />
      ) : null}
    </OfficeScreen>
  );
}

function statusTone(s) {
  return { paid_full: 'success', paid_partial: 'warning', unpaid: 'danger' }[s] || 'data';
}
function statusLabel(s) {
  return { paid_full: 'Full', paid_partial: 'Partial', unpaid: 'None', not_billed: 'No Bill' }[s] || s;
}

// ── Charging the books ──────────────────────────────────────────────────────
//
// One class, several, or the whole school — and correctable. Charging a class
// that already had books used to do nothing at all, silently, so a wrong price
// stayed on every pupil's account with no way back.
function ChargeSheet({ classes, classId, year, onClose, onDone }) {
  const { token } = useAuth();
  const [scope, setScope] = useState(classId ? 'classes' : 'school');
  const [classIds, setClassIds] = useState(classId ? [Number(classId)] : []);
  const [items, setItems] = useState([{ title: '', amount: '' }]);
  const [frameworks, setFrameworks] = useState([]);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // The Part B of every framework — a school that adopted a bill for its
    // fees should not retype the textbooks line from the same document.
    api.billFrameworks(token, 'school_fees').then(r => {
      const books = [];
      for (const f of r.frameworks || []) {
        for (const part of f.parts || []) {
          if (part.kind !== 'books') continue;
          for (const it of part.items) {
            if (it.amount > 0) books.push({ title: it.description, amount: it.amount });
          }
        }
      }
      setFrameworks(books);
    }).catch(() => {});
  }, [token]);

  const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  async function save() {
    const valid = items.filter(i => String(i.title || '').trim());
    if (!valid.length) return setError('Add at least one book with a title.');
    if (scope === 'classes' && !classIds.length) return setError('Choose at least one class.');
    setBusy(true); setError(null);
    try {
      const res = await api.chargeBooks(token, {
        scope: scope === 'school' ? 'school' : undefined,
        classIds: scope === 'school' ? undefined : classIds,
        academicYearId: year?.id,
        items: valid, replace,
      });
      const parts = [];
      if (res.created) parts.push(`${res.created} pupil(s) charged`);
      if (res.updated) parts.push(`${res.updated} corrected`);
      if (res.skipped) parts.push(`${res.skipped} already had books — tick "correct" to redo them`);
      onDone(`${parts.join(' · ')} at ${cedis(res.per_pupil)} each`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Sheet visible onClose={onClose} title={`Charge books — ${year?.label || 'this year'}`}>
      <ErrorNote message={error} />

      <SegmentedControl value={scope} onChange={setScope}
                        options={[{ label: 'The whole school', value: 'school' },
                                  { label: 'Chosen classes', value: 'classes' }]} />
      <Muted>Different classes read different books, so most schools charge class by class.</Muted>

      {scope === 'classes' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
          {(classes || []).map(c => {
            const on = classIds.includes(c.id);
            return (
              <Button key={c.id} title={c.name} size="sm" full={false}
                      variant={on ? 'primary' : 'outline'}
                      onPress={() => setClassIds(ids =>
                        (on ? ids.filter(x => x !== c.id) : [...ids, c.id]))} />
            );
          })}
        </View>
      ) : null}

      {frameworks.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md, alignItems: 'center' }}>
          <Muted>From a framework:</Muted>
          {frameworks.map(b => (
            <Button key={b.title} title={`${b.title} (${cedis(b.amount)})`} size="sm"
                    variant="outline" full={false}
                    onPress={() => setItems(list => {
                      const clean = list.filter(i => String(i.title || '').trim());
                      return [...clean, { title: b.title, amount: b.amount }];
                    })} />
          ))}
        </View>
      ) : null}

      <Divider />
      {items.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
          <View style={{ flex: 2, minWidth: 150 }}>
            <Field label={i === 0 ? 'Book' : ''} value={row.title || ''}
                   placeholder="e.g. English Reader BS4"
                   onChangeText={(v) => setItems(list =>
                     list.map((x, j) => (j === i ? { ...x, title: v } : x)))} />
          </View>
          <View style={{ width: 130 }}>
            <Field label={i === 0 ? 'Amount' : ''} value={String(row.amount ?? '')}
                   keyboardType="decimal-pad" placeholder="0.00"
                   onChangeText={(v) => setItems(list =>
                     list.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
          </View>
          <Button title="Remove" variant="ghost" size="sm" full={false}
                  disabled={items.length === 1}
                  onPress={() => setItems(list => list.filter((_, j) => j !== i))} />
        </View>
      ))}
      <Button title="Add a book" variant="outline" icon="plus" full={false}
              onPress={() => setItems(list => [...list, { title: '', amount: '' }])} />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md }}>
        <Text style={{ ...type.heading, color: colors.text }}>Total per pupil</Text>
        <Text style={{ ...type.heading, color: colors.primary }}>{cedis(total)}</Text>
      </View>

      <Divider />
      <CheckRow label="Correct pupils who already have books charged"
                hint="Rebuilds their charge from this list. Money already received is kept and the balance recalculated — a parent who has paid is credited against the new figure, not asked for it again. Leave this off and they are skipped."
                checked={replace} onToggle={() => setReplace(v => !v)} />

      <Button title={busy ? 'Charging…' : 'Charge the books'} busy={busy} disabled={busy}
              onPress={save} />
    </Sheet>
  );
}
