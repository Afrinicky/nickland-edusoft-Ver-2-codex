// Fees Management — the parts the web app could not do.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Taking a payment and chasing arrears already existed. What did not, and what
// an office actually starts a term with, is BILLING: writing the template that
// says what a class owes, raising it against every pupil in that class, and the
// discounts and book charges that sit on top of it.
//
// ── Why a template and not a number ─────────────────────────────────────────
//
// A Ghanaian school's fee is not one figure. It is tuition, plus PTA, plus
// examination, plus furniture in the year they buy desks — and the parent is
// entitled to see the line items, because those are what they are being asked
// to pay for and what they will argue about at the gate. So a template is a
// LIST, the bill carries the list, and the receipt prints it.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { useClasses } from '../../pickers';
import { OfficeScreen, cedis, shortDate, useOffice } from '../../office';
import {
  Select, SearchField, DataTable, Muted, Badge, EmptyState, ErrorNote, SuccessNote,
  Button, Sheet, Field, Loading, ProgressBar, Divider, CheckRow, SegmentedControl,
} from '../../ui';
import { Panel, Bar, StatRow, Stat } from '../../desk';
import { colors, spacing, type } from '../../theme';

// ── Dashboard ───────────────────────────────────────────────────────────────

export function FeesDashboard() {
  const router = useRouter();
  const state = useOffice((t) => api.financeOverview(t));
  const d = state.data;
  const f = d?.fees;

  // A count that is absent is not a count of undefined. An older host answers
  // with fewer fields than this one asks for, and "undefined bills raised"
  // under a figure is how a school decides the new screen is broken.
  const count = (n, one, many) => {
    const v = Number(n);
    return Number.isFinite(v) ? `${v} ${v === 1 ? one : many}` : '';
  };

  return (
    <OfficeScreen state={state} skeleton={4}>
      {d ? (
        <>
          <StatRow>
            <Stat index={0} label="Billed this term" icon="layers" tone="primary"
                  value={f ? cedis(f.billed) : '—'}
                  note={f ? count(f.bills, 'bill raised', 'bills raised') : ''} />
            <Stat index={1} label="Collected" icon="check" tone="success"
                  value={f ? cedis(f.collected) : '—'}
                  note={f ? count(f.receipts, 'receipt', 'receipts') : ''}
                  action="View payments" onPress={() => router.push('/app/fees?tab=payments')} />
            <Stat index={2} label="Outstanding" icon="trend" tone="danger"
                  value={f ? cedis(f.outstanding) : '—'}
                  note={f ? count(f.debtors, 'pupil owing', 'pupils owing') : ''}
                  action="View debtors" onPress={() => router.push('/app/fees?tab=debtors')} />
            <Stat index={3} label="Taken today" icon="wallet" tone="data"
                  value={f ? cedis(f.today) : '—'}
                  note={f ? count(f.today_receipts, 'receipt today', 'receipts today') : ''} />
          </StatRow>

          {f ? (
            <Panel title="Collection" subtitle={`${f.collection_rate}% of what was billed this term`}>
              <ProgressBar value={f.collection_rate} max={100}
                           tone={f.collection_rate >= 80 ? 'success'
                                 : f.collection_rate >= 50 ? 'warning' : 'danger'} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                <Muted>{`Collected ${cedis(f.collected)}`}</Muted>
                <Muted>{`Still owed ${cedis(f.outstanding)}`}</Muted>
              </View>
            </Panel>
          ) : null}

          {d.recent && d.recent.length ? (
            <Panel padded={false} title="Recent payments"
                   subtitle="The last receipts written, newest first">
              <View style={{ padding: spacing.lg }}>
                <DataTable
                  keyExtractor={(r) => String(r.id)}
                  columns={[
                    { key: 'name', label: 'Pupil',
                      render: (r) => `${r.surname || ''} ${r.first_name || ''}`.trim() },
                    { key: 'class_name', label: 'Class', width: 130 },
                    { key: 'receipt_number', label: 'Receipt', width: 150 },
                    { key: 'payment_date', label: 'Date', width: 110,
                      render: (r) => shortDate(r.payment_date) },
                    { key: 'amount', label: 'Amount', align: 'right', width: 130,
                      render: (r) => cedis(r.amount) },
                  ]}
                  rows={d.recent} />
              </View>
            </Panel>
          ) : null}
        </>
      ) : null}
    </OfficeScreen>
  );
}

// ── Fee templates ───────────────────────────────────────────────────────────

export function FeeTemplates() {
  const { token, profile } = useAuth();
  const { classes } = useClasses(token);
  const [templates, setTemplates] = useState(null);
  const [terms, setTerms] = useState([]);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const may = can(profile, 'fees', 'edit');

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.feeTemplates(token);
      setTemplates(r.templates || []);
    } catch (e) { setError(e.message); setTemplates([]); }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let live = true;
    api.terms(token).then(r => { if (live) setTerms(r.terms || []); }).catch(() => {});
    return () => { live = false; };
  }, [token]);

  const total = (items) => (items || []).reduce((n, i) => n + (Number(i.amount) || 0), 0);

  async function save() {
    setBusy(true); setError(null);
    try {
      const items = (editing.items || [])
        .filter(i => String(i.description || '').trim())
        .map(i => ({ description: i.description.trim(), amount: Number(i.amount) || 0 }));
      if (!items.length) throw new Error('A bill needs at least one line.');
      await api.saveFeeTemplate(token, {
        id: editing.id || undefined,
        name: editing.name,
        class_group_id: editing.class_group_id ? Number(editing.class_group_id) : null,
        term_id: editing.term_id ? Number(editing.term_id) : null,
        bill_type: editing.bill_type || 'school_fees',
        items,
      });
      setSaved(editing.name);
      setEditing(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function open(row) {
    setError(null);
    try {
      const r = await api.feeTemplate(token, row.id);
      const t = r.template || r;
      setEditing({ ...t, items: t.items || t.line_items || [] });
    } catch (e) {
      // An older host has no single-template route; the list carries enough to
      // amend the heading, and the lines are re-entered.
      setEditing({ ...row, items: [] });
    }
  }

  if (!may) {
    return <EmptyState icon="lock" title="Templates are not yours to change"
                       message="You can see bills and take payments. Writing what a class is charged needs edit access to Fees." />;
  }

  return (
    <View style={{ gap: spacing.md }}>
      <ErrorNote message={error} />
      {saved ? <SuccessNote message={`“${saved}” saved. Raise it against a class under Bills.`} /> : null}

      <Bar left={<Muted>What a class is charged, line by line. The parent sees these lines on the bill.</Muted>}
           right={<Button title="New template" icon="plus" full={false}
                          onPress={() => setEditing({ bill_type: 'school_fees',
                                                      items: [{ description: '', amount: '' }] })} />} />

      {templates === null ? <Loading label="Reading the templates…" />
        : templates.length === 0 ? (
          <EmptyState icon="layers" title="No fee templates yet"
                      message="A template is the list of what a class owes for a term — tuition, PTA, examination. Write one, then raise it against the class." />
        ) : (
          <Panel padded={false}>
            <View style={{ padding: spacing.lg }}>
              <DataTable
                keyExtractor={(r) => String(r.id)}
                onRowPress={open}
                columns={[
                  { key: 'name', label: 'Template', render: (r) => (
                    <View style={{ minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>{r.name}</Text>
                      <Muted numberOfLines={1}>{r.bill_type === 'supplementary' ? 'Extra charge' : 'School fees'}</Muted>
                    </View>
                  ) },
                  { key: 'class_name', label: 'Class', width: 150,
                    render: (r) => r.class_name || 'Every class' },
                  { key: 'term_label', label: 'Term', width: 150,
                    render: (r) => r.term_label || 'Any term' },
                  { key: 'items', label: 'Lines', align: 'right', width: 80 },
                  { key: 'total', label: 'Total', align: 'right', width: 140,
                    render: (r) => cedis(r.total) },
                ]}
                rows={templates} />
            </View>
          </Panel>
        )}

      <Sheet visible={!!editing} onClose={() => setEditing(null)}
             title={editing && editing.id ? 'Amend the template' : 'A new fee template'}>
        {editing ? (
          <>
            <Field label="Name" value={editing.name || ''}
                   onChangeText={(v) => setEditing(e => ({ ...e, name: v }))}
                   hint="e.g. Basic 4 — Second Term" />
            <Select label="Class" value={String(editing.class_group_id || '')}
                    onChange={(v) => setEditing(e => ({ ...e, class_group_id: v }))}
                    placeholder="Every class"
                    options={[{ label: 'Every class', value: '' },
                              ...(classes || []).map(c => ({ label: c.name, value: String(c.id) }))]} />
            <Select label="Term" value={String(editing.term_id || '')}
                    onChange={(v) => setEditing(e => ({ ...e, term_id: v }))}
                    placeholder="Any term"
                    options={[{ label: 'Any term', value: '' },
                              ...terms.map(t => ({ label: `${t.label}${t.year_label ? ` · ${t.year_label}` : ''}`,
                                                   value: String(t.id) }))]} />
            <Select label="Kind" value={editing.bill_type || 'school_fees'}
                    onChange={(v) => setEditing(e => ({ ...e, bill_type: v }))}
                    options={[{ label: 'School fees', value: 'school_fees' },
                              { label: 'An extra charge', value: 'supplementary' }]} />

            <Divider />
            <Text style={{ ...type.heading, color: colors.text }}>What it is made of</Text>
            <Muted>Each line is printed on the bill and on the receipt.</Muted>
            {(editing.items || []).map((item, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
                <View style={{ flex: 2, minWidth: 150 }}>
                  <Field label={i === 0 ? 'Description' : ''} value={item.description || ''}
                         onChangeText={(v) => setEditing(e => ({ ...e,
                           items: e.items.map((x, j) => (j === i ? { ...x, description: v } : x)) }))} />
                </View>
                <View style={{ width: 130 }}>
                  <Field label={i === 0 ? 'Amount' : ''} value={String(item.amount ?? '')}
                         onChangeText={(v) => setEditing(e => ({ ...e,
                           items: e.items.map((x, j) => (j === i ? { ...x, amount: v } : x)) }))} />
                </View>
                <Button title="Remove" variant="ghost" size="sm" full={false}
                        onPress={() => setEditing(e => ({ ...e, items: e.items.filter((_, j) => j !== i) }))} />
              </View>
            ))}
            <Button title="Add a line" variant="outline" icon="plus" full={false}
                    onPress={() => setEditing(e => ({ ...e, items: [...(e.items || []), { description: '', amount: '' }] }))} />

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md }}>
              <Text style={{ ...type.heading, color: colors.text }}>Total</Text>
              <Text style={{ ...type.heading, color: colors.primary }}>{cedis(total(editing.items))}</Text>
            </View>

            <Button title={busy ? 'Saving…' : 'Save the template'} busy={busy} disabled={busy} onPress={save} />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

// ── Discounts ───────────────────────────────────────────────────────────────
//
// A staff child, a bursary, a second sibling. Every school gives them and every
// school argues about them later, which is why each one is recorded against a
// pupil with who granted it and why, rather than being a smaller number typed
// into a bill.

export function Discounts() {
  const { token, profile } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const may = can(profile, 'fees', 'edit');

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.feeDiscounts(token);
      setRows(r.discounts || []);
    } catch (e) { setError(e.message); setRows([]); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows || []).filter(r => !needle
      || `${r.student_name || ''} ${r.reason || ''} ${r.discount_type || ''}`.toLowerCase().includes(needle));
  }, [rows, q]);

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.saveFeeDiscount(token, {
        student_id: Number(adding.student_id),
        discount_type: adding.discount_type || 'fixed',
        value: Number(adding.value) || 0,
        reason: adding.reason,
        applies_to: adding.applies_to || 'school_fees',
      });
      setAdding(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <View style={{ gap: spacing.md }}>
      <ErrorNote message={error} />
      <Bar left={<View style={{ minWidth: 260, flex: 1 }}>
        <SearchField value={q} onChangeText={setQ} placeholder="Find a pupil or a reason" />
      </View>}
      right={may ? <Button title="Grant a discount" icon="plus" full={false}
                           onPress={() => setAdding({ discount_type: 'fixed', applies_to: 'school_fees' })} /> : null} />

      {rows === null ? <Loading label="Reading the discounts…" />
        : filtered.length === 0 ? (
          <EmptyState icon="wallet" title="No discounts granted"
                      message="A staff child, a bursary, a second sibling — each recorded against the pupil, with who granted it and why." />
        ) : (
          <Panel padded={false}>
            <View style={{ padding: spacing.lg }}>
              <DataTable
                keyExtractor={(r) => String(r.id)}
                columns={[
                  { key: 'student_name', label: 'Pupil',
                    render: (r) => r.student_name || `${r.surname || ''} ${r.first_name || ''}`.trim() },
                  { key: 'reason', label: 'Why' },
                  { key: 'discount_type', label: 'Kind', width: 120,
                    render: (r) => (r.discount_type === 'percentage' ? 'Percentage' : 'Fixed amount') },
                  { key: 'value', label: 'Value', align: 'right', width: 130,
                    render: (r) => (r.discount_type === 'percentage' ? `${r.value}%` : cedis(r.value)) },
                  { key: 'granted_by_name', label: 'Granted by', width: 160 },
                ]}
                rows={filtered} />
            </View>
          </Panel>
        )}

      <Sheet visible={!!adding} onClose={() => setAdding(null)} title="Grant a discount">
        {adding ? (
          <>
            <Muted>Recorded against the pupil with your name on it, and applied when their bill is worked out.</Muted>
            <StudentPicker token={token} value={adding.student_id}
                           onChange={(v) => setAdding(a => ({ ...a, student_id: v }))} />
            <Select label="Kind" value={adding.discount_type}
                    onChange={(v) => setAdding(a => ({ ...a, discount_type: v }))}
                    options={[{ label: 'A fixed amount off', value: 'fixed' },
                              { label: 'A percentage off', value: 'percentage' }]} />
            <Field label={adding.discount_type === 'percentage' ? 'Percentage' : 'Amount'}
                   value={String(adding.value || '')}
                   onChangeText={(v) => setAdding(a => ({ ...a, value: v }))} />
            <Field label="Why" value={adding.reason || ''}
                   onChangeText={(v) => setAdding(a => ({ ...a, reason: v }))}
                   hint="Staff child, bursary, second sibling…" />
            <Button title={busy ? 'Saving…' : 'Grant it'} busy={busy}
                    disabled={busy || !adding.student_id} onPress={save} />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

// ── Books ───────────────────────────────────────────────────────────────────

export function Books() {
  const { token } = useAuth();
  const { classes } = useClasses(token);
  const [classId, setClassId] = useState('');
  const [studentId, setStudentId] = useState(null);
  const [record, setRecord] = useState(null);
  const [error, setError] = useState(null);
  const roll = useOffice(
    (t) => (classId ? api.adminStudents(t, { status: 'Active', classId }) : Promise.resolve({ ok: true, students: [] })),
    [classId]);

  const open = useCallback(async (id) => {
    setStudentId(id); setRecord(null); setError(null);
    try { setRecord(await api.studentBooks(token, id)); }
    catch (e) { setError(e.message); }
  }, [token]);

  return (
    <OfficeScreen state={roll} skeleton={5}>
      <ErrorNote message={error} />
      <Bar left={<View style={{ minWidth: 240 }}>
        <Select label="Class" value={classId} onChange={(v) => { setClassId(v); setRecord(null); setStudentId(null); }}
                placeholder="Which class?"
                options={(classes || []).map(c => ({ label: c.name, value: String(c.id) }))} />
      </View>} />

      {!classId ? (
        <EmptyState icon="book" title="Pick a class"
                    message="Books are charged and paid for per pupil, separately from school fees, because a parent who has bought last year's books does not owe for them again." />
      ) : (
        <View style={{ flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap' }}>
          <View style={{ minWidth: 280, flexGrow: 1, flexBasis: 300 }}>
            <Panel padded={false} title="Pupils">
              <View style={{ padding: spacing.md }}>
                <DataTable
                  keyExtractor={(r) => String(r.id)}
                  onRowPress={(r) => open(r.id)}
                  columns={[{ key: 'name', label: 'Pupil' },
                            { key: 'go', label: '', width: 60, align: 'right',
                              render: (r) => (String(r.id) === String(studentId)
                                ? <Badge tone="primary" label="Open" /> : <Muted>→</Muted>) }]}
                  rows={roll.data?.students || []} />
              </View>
            </Panel>
          </View>
          <View style={{ minWidth: 300, flexGrow: 2, flexBasis: 420 }}>
            {!record ? (
              <EmptyState icon="book" title="No pupil chosen" message="Choose somebody on the left." />
            ) : (
              <Panel title="Books" subtitle="What was issued, and what has been paid for them.">
                <DataTable
                  keyExtractor={(r, i) => String(r.id ?? i)}
                  empty="Nothing has been issued to this pupil."
                  columns={[
                    { key: 'description', label: 'Item' },
                    { key: 'amount', label: 'Charged', align: 'right', width: 120,
                      render: (r) => cedis(r.amount) },
                  ]}
                  rows={record.items || record.books || []} />
                <Divider />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Muted>Balance</Muted>
                  <Text style={{ ...type.heading, color: colors.danger }}>
                    {cedis(record.balance ?? 0)}
                  </Text>
                </View>
              </Panel>
            )}
          </View>
        </View>
      )}
    </OfficeScreen>
  );
}

// ── Bulk pay sheet ──────────────────────────────────────────────────────────
//
// A class at a time, on collection day. The office does not take payments one
// modal at a time when forty parents are in a queue outside — they work down a
// sheet.

export function BulkPaySheet() {
  const { token, profile } = useAuth();
  const { classes } = useClasses(token);
  const [classId, setClassId] = useState('');
  const [amounts, setAmounts] = useState({});
  const [method, setMethod] = useState('Cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const may = can(profile, 'fees', 'create');

  const state = useOffice(
    (t) => (classId ? api.financeDebtors(t, classId) : Promise.resolve({ ok: true, debtors: [] })),
    [classId]);

  const rows = state.data?.debtors || state.data?.students || [];
  const entered = Object.entries(amounts).filter(([, v]) => Number(v) > 0);
  const totalEntered = entered.reduce((n, [, v]) => n + Number(v), 0);

  async function take() {
    setBusy(true); setError(null); setDone(null);
    let n = 0;
    try {
      for (const [studentId, amount] of entered) {
        await api.financeTakePayment(token, {
          studentId: Number(studentId), amount: Number(amount),
          paymentMethod: method, method,
        });
        n += 1;
      }
      setAmounts({});
      setDone(`${n} payment${n === 1 ? '' : 's'} receipted — ${cedis(totalEntered)}`);
      state.reload();
    } catch (e) {
      setError(`${e.message}${n ? ` — ${n} receipted before it stopped.` : ''}`);
    } finally { setBusy(false); }
  }

  if (!may) {
    return <EmptyState icon="lock" title="Taking payments is not yours"
                       message="Your account can see what is owed but not receipt a payment." />;
  }

  return (
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      {done ? <SuccessNote message={done} /> : null}

      <Bar left={<>
        <View style={{ minWidth: 220 }}>
          <Select label="Class" value={classId} onChange={(v) => { setAmounts({}); setClassId(v); }}
                  placeholder="Which class?"
                  options={(classes || []).map(c => ({ label: c.name, value: String(c.id) }))} />
        </View>
        <View style={{ minWidth: 190 }}>
          <Select label="How they paid" value={method} onChange={setMethod}
                  options={['Cash', 'Mobile Money', 'Bank Transfer', 'Cheque']
                    .map(m => ({ label: m, value: m }))} />
        </View>
      </>}
      right={entered.length ? <>
        <Badge tone="data" label={`${entered.length} · ${cedis(totalEntered)}`} />
        <Button title={busy ? 'Receipting…' : 'Receipt them all'} busy={busy} disabled={busy}
                icon="check" full={false} onPress={take} />
      </> : null} />

      {!classId ? (
        <EmptyState icon="wallet" title="Pick a class"
                    message="On collection day the office works down a class, not through forty separate forms." />
      ) : rows.length === 0 ? (
        <EmptyState icon="check" title="Nobody in this class owes anything"
                    message="Every bill in it is settled." />
      ) : (
        <Panel padded={false} title={`${rows.length} owing`}
               subtitle="Type what each parent has handed over. Nothing is receipted until you press the button.">
          <View style={{ padding: spacing.lg }}>
            <DataTable
              keyExtractor={(r) => String(r.student_id ?? r.id)}
              columns={[
                { key: 'name', label: 'Pupil',
                  render: (r) => r.name || `${r.surname || ''} ${r.first_name || ''}`.trim() },
                { key: 'balance', label: 'Owes', align: 'right', width: 130,
                  render: (r) => cedis(r.balance ?? r.amount_owed) },
                { key: 'pay', label: 'Paying now', align: 'right', width: 160,
                  render: (r) => {
                    const id = String(r.student_id ?? r.id);
                    return (
                      <View style={{ width: 140 }}>
                        <Field label="" value={amounts[id] || ''}
                               onChangeText={(v) => setAmounts(a => ({ ...a, [id]: v }))} />
                      </View>
                    );
                  } },
              ]}
              rows={rows} />
          </View>
        </Panel>
      )}
    </OfficeScreen>
  );
}

// ── a small shared picker ───────────────────────────────────────────────────

function StudentPicker({ token, value, onChange }) {
  const [students, setStudents] = useState([]);
  useEffect(() => {
    let live = true;
    api.adminStudents(token, { status: 'Active' })
      .then(r => { if (live) setStudents(r.students || []); })
      .catch(() => { if (live) setStudents([]); });
    return () => { live = false; };
  }, [token]);
  return (
    <Select label="Pupil" value={String(value || '')} onChange={onChange}
            placeholder="Which pupil?" searchable
            options={students.map(s => ({ label: s.name, value: String(s.id), note: s.class_name }))} />
  );
}
