// Nickland Edusoft — School fees.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Everything about the term's school fee in one place: the schedules that have
// been written, the bills standing against them, and the one button that raises
// a new one. Same three ways in as the installed application — from scratch,
// from a framework, or from a previous term — and the same rule.
//
// ── The rule ────────────────────────────────────────────────────────────────
//
// A term has ONE school fees bill. Raising a second replaces the first: the old
// schedule is retired, balances are recalculated, and money already received
// stays exactly where it is. The prompt says so in those words, because
// "Replace?" on its own is not something anybody in a school office is willing
// to press.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { isElevated } from '../../modules';
import { useOfficeClasses } from '../../pickers';
import { cedis, shortDate, termLabel, useOffice, OfficeScreen } from '../../office';
import {
  Select, DataTable, Muted, Badge, Button, Field, Sheet, Divider, ChoiceRow,
  EmptyState, ErrorNote, SuccessNote, Loading, SegmentedControl, SearchField,
} from '../../ui';
import { Panel, Bar, StatRow, Stat } from '../../desk';
import { printHtml } from '../../print';
import { colors, spacing, type } from '../../theme';

const SOURCES = [
  { id: 'framework', label: 'From a framework',
    hint: 'A published bill — the particulars already written, in the order they print.' },
  { id: 'previous', label: 'From a previous term',
    hint: 'Last term’s bill, optionally uplifted. What most schools want most terms.' },
  { id: 'scratch', label: 'From scratch',
    hint: 'Type it out. For a bill nothing else resembles.' },
];

export default function SchoolFees() {
  const { token, profile } = useAuth();
  const { classes } = useOfficeClasses(token);
  const may = isElevated(profile);

  const [classId, setClassId] = useState('');
  const [owingOnly, setOwingOnly] = useState(false);
  const [q, setQ] = useState('');
  const [building, setBuilding] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);

  const state = useOffice(async (t) => {
    const [summary, templates] = await Promise.all([
      api.billsSummary(t),
      api.feeTemplates(t, 'school_fees').catch(() => ({ templates: [] })),
    ]);
    return { summary, templates: templates.templates || [] };
  }, []);

  const bills = useOffice(
    (t) => api.financeDebtors(t, classId || undefined).catch(() => ({ debtors: [] })),
    [classId]);

  const summary = state.data?.summary;
  const term = summary?.term;
  const schedules = (state.data?.templates || [])
    .filter(t => !term || t.term_id === term.id || t.term_id === null);
  const feesKind = (summary?.kinds || []).find(k => k.key === 'school_fees');

  const rows = useMemo(() => {
    const list = bills.data?.debtors || bills.data?.students || [];
    const needle = q.trim().toLowerCase();
    return list.filter(r =>
      (!owingOnly || (r.balance || 0) > 0)
      && (!needle || `${r.name || ''} ${r.surname || ''} ${r.first_name || ''} ${r.index_number || ''}`
        .toLowerCase().includes(needle)));
  }, [bills.data, owingOnly, q]);

  const reload = useCallback(() => { state.reload(); bills.reload(); }, [state, bills]);

  // Printing goes through the office's own bill generator — the document a
  // parent is handed must be one document, not two that resemble each other.
  async function printBills(studentIds, what) {
    if (!studentIds.length) return setError('Nobody selected to print for.');
    setBusy(true); setError(null);
    try {
      const doc = await api.billHtml(token, { studentIds: studentIds.join(','), termId: term?.id });
      await printHtml(doc);
      setNote(`${studentIds.length} ${what} ready to print`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const className = (classes || []).find(c => String(c.id) === String(classId))?.name;

  return (
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      {note ? <SuccessNote message={note} /> : null}

      <StatRow>
        <Stat index={0} label="Billed this term" icon="layers" tone="primary"
              value={cedis(feesKind?.billed || 0)} note={term?.full_label || ''} />
        <Stat index={1} label="Collected" icon="check" tone="success"
              value={cedis(feesKind?.paid || 0)}
              note={`${feesKind?.raised || 0} bill(s) raised`} />
        <Stat index={2} label="Outstanding" icon="alert" tone="danger"
              value={cedis(feesKind?.outstanding || 0)}
              note={`${feesKind?.debtors || 0} pupil(s) owing`} />
        <Stat index={3} label="Schedules in force" icon="book" tone="data"
              value={String(schedules.length)}
              note={schedules.length ? 'what the term bills from' : 'nobody can be billed yet'} />
      </StatRow>

      <Panel padded={false}
             title={`School fees — ${termLabel(term, 'no term running')}`}
             subtitle={schedules.length === 0
               ? 'No schedule written for this term yet, so nobody can be billed.'
               : `${schedules.length} schedule(s) in force`}
             right={may ? (
               <Button title="New school fees" icon="plus" full={false}
                       onPress={() => { setError(null); setBuilding({}); }} />
             ) : null}>
        <View style={{ padding: spacing.lg }}>
          {schedules.length === 0 ? (
            <EmptyState icon="layers" title="Nothing has been charged for this term"
                        message={may
                          ? 'Start from the school’s own bill, from a published framework, or from last term’s — whichever is nearest. You can change every figure before anything is raised.'
                          : 'Raising the term’s fees is the Proprietor’s to do.'} />
          ) : (
            <DataTable
              keyExtractor={(r) => String(r.id)}
              columns={[
                { key: 'name', label: 'Schedule' },
                { key: 'class_name', label: 'Class', width: 150,
                  render: (r) => r.class_name || 'Every class' },
                { key: 'term_label', label: 'Term', width: 190,
                  render: (r) => termLabel(r, 'Any term — standing default') },
                { key: 'items', label: 'Lines', align: 'right', width: 80 },
                { key: 'total', label: 'Per pupil', align: 'right', width: 130,
                  render: (r) => cedis(r.total) },
                ...(may ? [{ key: 'act', label: '', align: 'right', width: 110, render: (r) => (
                  <Button title="Amend" size="sm" variant="outline" full={false}
                          onPress={() => setBuilding({ templateId: r.id })} />
                ) }] : []),
              ]}
              rows={schedules} />
          )}
        </View>
      </Panel>

      <Panel padded={false} title="The bills standing against it"
             subtitle="Print a class before reopening, a handful for the parents at the counter, or one at a time.">
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Bar left={<>
            <View style={{ minWidth: 190 }}>
              <Select label="" value={classId} onChange={setClassId} placeholder="All classes"
                      options={[{ label: 'All classes', value: '' },
                                ...(classes || []).map(c => ({ label: c.name, value: String(c.id) }))]} />
            </View>
            <View style={{ minWidth: 200, flex: 1 }}>
              <SearchField value={q} onChangeText={setQ} placeholder="Find a pupil" />
            </View>
            <SegmentedControl value={owingOnly ? 'owing' : 'all'}
                              onChange={(v) => setOwingOnly(v === 'owing')}
                              options={[{ label: 'Everyone', value: 'all' },
                                        { label: 'Owing only', value: 'owing' }]} />
          </>}
          right={rows.length ? (
            <Button title={classId ? `Print all of ${className}` : 'Print every bill'}
                    icon="print" variant="outline" full={false} busy={busy} disabled={busy}
                    onPress={() => printBills(rows.map(r => r.student_id ?? r.id), 'bill(s)')} />
          ) : null} />

          <DataTable
            keyExtractor={(r) => String(r.student_id ?? r.id)}
            empty="No bills for this term yet. Raising the term's school fees bills every active pupil in one action."
            columns={[
              { key: 'index_number', label: 'Index No', width: 120 },
              { key: 'name', label: 'Pupil',
                render: (r) => (
                  <View style={{ minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                      {r.name || `${r.surname || ''} ${r.first_name || ''}`.trim()}
                    </Text>
                    <Muted numberOfLines={1}>{r.class_name}</Muted>
                  </View>
                ) },
              { key: 'total_billed', label: 'Billed', align: 'right', width: 120,
                render: (r) => cedis(r.total_billed ?? r.billed) },
              { key: 'total_paid', label: 'Paid', align: 'right', width: 120,
                render: (r) => (
                  <Text style={{ ...type.small, color: '#15803D', fontVariant: ['tabular-nums'] }}>
                    {cedis(r.total_paid ?? r.paid)}
                  </Text>
                ) },
              { key: 'balance', label: 'Balance', align: 'right', width: 120,
                render: (r) => (
                  <Text style={{
                    ...type.small, fontWeight: '800',
                    color: (r.balance || 0) > 0 ? colors.danger : '#15803D',
                    fontVariant: ['tabular-nums'],
                  }}>{cedis(r.balance ?? r.amount_owed)}</Text>
                ) },
              { key: 'act', label: '', align: 'right', width: 110, render: (r) => (
                <Button title="Print" size="sm" variant="ghost" full={false} disabled={busy}
                        onPress={() => printBills([r.student_id ?? r.id], 'bill')} />
              ) },
            ]}
            rows={rows} />
        </View>
      </Panel>

      {building ? (
        <BillBuilder term={term} classes={classes} amending={building.templateId || null}
                     onClose={() => setBuilding(null)}
                     onDone={(msg) => { setBuilding(null); setNote(msg); reload(); }} />
      ) : null}
    </OfficeScreen>
  );
}

// ══ The builder ═════════════════════════════════════════════════════════════

function BillBuilder({ term, classes, amending, onClose, onDone }) {
  const { token } = useAuth();

  const [step, setStep] = useState(amending ? 'lines' : 'source');
  const [source, setSource] = useState(null);
  const [frameworks, setFrameworks] = useState([]);
  const [previous, setPrevious] = useState([]);
  const [frameworkId, setFrameworkId] = useState('');
  const [sourceTemplateId, setSourceTemplateId] = useState('');
  const [adjust, setAdjust] = useState('0');
  const [name, setName] = useState('');
  const [items, setItems] = useState([{ item_number: 1, description: '', amount: '' }]);
  const [bookItems, setBookItems] = useState([]);
  const [scope, setScope] = useState('school');
  const [classIds, setClassIds] = useState([]);
  const [plan, setPlan] = useState(null);
  const [clash, setClash] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.billFrameworks(token, 'school_fees').then(r => setFrameworks(r.frameworks || [])).catch(() => {});
    api.feeTemplates(token, 'school_fees')
      .then(r => setPrevious((r.templates || []).filter(t => !term || t.term_id !== term.id)))
      .catch(() => {});
  }, [token, term?.id]);

  useEffect(() => {
    if (!name && term) setName(`${term.label} school fees — ${term.year_label || ''}`.trim());
  }, [term]);

  useEffect(() => {
    if (!term) return;
    api.schoolFeesPlan(token, {
      termId: term.id,
      scope: scope === 'school' ? 'school' : 'classes',
      classIds: scope === 'school' ? undefined : classIds.join(','),
    }).then(p => setPlan(p && p.ok ? p : null)).catch(() => {});
  }, [token, term?.id, scope, classIds.join(',')]);

  // Amending opens straight on the figures. Raising then REPLACES the
  // schedule, which is the only correct outcome: one that has produced bills
  // cannot be edited underneath them without the two saying different things.
  useEffect(() => {
    if (!amending) return;
    api.feeTemplate(token, amending).then(r => {
      const t = r.template || r;
      setName(t.name || '');
      setItems((t.items || t.line_items || []).map((it, i) => ({
        item_number: it.item_number || (i + 1),
        description: it.description, amount: it.amount,
      })));
      if (t.class_group_id) { setScope('classes'); setClassIds([Number(t.class_group_id)]); }
    }).catch(e => setError(e.message));
  }, [token, amending]);

  const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  function chooseFramework(id) {
    setFrameworkId(id);
    const fw = frameworks.find(f => f.id === id);
    if (!fw) return;
    let n = 0;
    const lines = [];
    const books = [];
    for (const part of fw.parts || []) {
      for (const it of part.items) {
        if (part.kind === 'books') books.push({ title: it.description, amount: it.amount });
        else lines.push({ item_number: ++n, description: it.description, amount: it.amount });
      }
    }
    setItems(lines.length ? lines : [{ item_number: 1, description: '', amount: '' }]);
    setBookItems(books);
  }

  // Re-uplifting works off the ORIGINAL amounts, not the uplifted ones — typing
  // "10" twice must not raise the fee by 21%.
  async function loadPrevious(id, pct) {
    if (!id) return;
    try {
      const r = await api.feeTemplate(token, Number(id));
      const t = r.template || r;
      const factor = 1 + ((Number(pct) || 0) / 100);
      setItems((t.items || t.line_items || []).map((it, i) => ({
        item_number: it.item_number || (i + 1),
        description: it.description,
        amount: Math.round((Number(it.amount) || 0) * factor * 100) / 100,
      })));
      setBookItems([]);
    } catch (e) { setError(e.message); }
  }

  async function raise(confirmReplace) {
    const usable = items.filter(i => String(i.description || '').trim());
    if (!usable.length) return setError('A bill needs at least one line.');
    if (scope === 'classes' && !classIds.length) return setError('Choose at least one class.');
    setBusy(true); setError(null);
    try {
      const res = await api.raiseSchoolFees(token, {
        termId: term?.id,
        scope: scope === 'school' ? 'school' : 'classes',
        classIds: scope === 'school' ? [] : classIds,
        name: name.trim(),
        items: usable.map((i, n) => ({
          item_number: Number(i.item_number) || (n + 1),
          description: String(i.description).trim(),
          amount: Number(i.amount) || 0,
        })),
        bookItems,
        confirmReplace: !!confirmReplace,
      });
      const parts = [`${res.generated} bill(s) raised at ${cedis(res.per_pupil)} a pupil`];
      if (res.replaced) parts.push(`${res.replaced} previous schedule(s) replaced`);
      if (res.skipped) {
        parts.push(`${res.skipped} could not be: ${(res.problems || []).map(p => p.reason).join(' ')}`);
      }
      onDone(parts.join(' · '));
    } catch (e) {
      if (e.data && e.data.code === 'REPLACE_REQUIRED') setClash(e.data);
      else setError(e.message);
    } finally { setBusy(false); }
  }

  const stepTitle = step === 'source' ? 'Where does this bill start from?'
    : step === 'lines' ? 'What is on the bill'
      : 'Who it is raised against';

  return (
    <Sheet visible onClose={onClose} title={`New school fees — ${termLabel(term)}`}>
      <Muted>{stepTitle}</Muted>
      <ErrorNote message={error} />

      {step === 'source' ? (
        <View style={{ gap: spacing.sm }}>
          {SOURCES.map(s => (
            <ChoiceRow key={s.id} title={s.label} subtitle={s.hint}
                       selected={source === s.id}
                       onSelect={() => {
                         setSource(s.id);
                         if (s.id === 'scratch') {
                           setItems([{ item_number: 1, description: '', amount: '' }]);
                           setBookItems([]);
                           setStep('lines');
                         }
                       }} />
          ))}

          {source === 'framework' ? (
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              <Muted>
                A framework is a bill somebody has already argued about. Adopt it and change
                the figures — nothing is raised until you say so.
              </Muted>
              {frameworks.map(f => (
                <ChoiceRow key={f.id} title={f.name}
                           subtitle={`${f.description}\n${f.item_count} particular(s)`
                             + (f.fees_total > 0 ? ` · ${cedis(f.fees_total)} school fees` : '')
                             + (f.books_total > 0 ? ` · ${cedis(f.books_total)} textbooks` : '')
                             + (f.origin ? ` · ${f.origin}` : '')}
                           selected={frameworkId === f.id}
                           onSelect={() => chooseFramework(f.id)} />
              ))}
              <Button title="Use this framework" icon="check" disabled={!frameworkId}
                      onPress={() => setStep('lines')} />
            </View>
          ) : null}

          {source === 'previous' ? (
            <View style={{ marginTop: spacing.sm }}>
              <Select label="Copy from" value={sourceTemplateId}
                      placeholder="— Choose a previous bill —"
                      onChange={(v) => { setSourceTemplateId(v); loadPrevious(v, adjust); }}
                      options={previous.map(t => ({
                        label: `${t.name} · ${t.class_name || 'All classes'} · ${termLabel(t, 'All terms')} · ${cedis(t.total)}`,
                        value: String(t.id),
                      }))} />
              {previous.length === 0 ? (
                <Muted>There is no earlier bill to copy yet. Start from a framework or from scratch.</Muted>
              ) : null}
              <Field label="Adjust every amount by (%)" value={adjust}
                     keyboardType="decimal-pad"
                     onChangeText={(v) => { setAdjust(v); loadPrevious(sourceTemplateId, v); }}
                     hint="Leave at 0 to carry the amounts over unchanged." />
              <Button title="Use this bill" icon="check" disabled={!sourceTemplateId}
                      onPress={() => setStep('lines')} />
            </View>
          ) : null}
        </View>
      ) : null}

      {step === 'lines' ? (
        <View>
          <Field label="What this bill is called" value={name} onChangeText={setName}
                 placeholder={`e.g. ${term?.label || 'First Term'} Bills ${term?.year_label || ''}`}
                 hint="The academic year belongs in the name — every year has a term by the same name." />

          {items.map((item, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
              <View style={{ flex: 2, minWidth: 150 }}>
                <Field label={i === 0 ? 'Particulars' : ''} value={item.description || ''}
                       placeholder="e.g. Tuition Fee"
                       onChangeText={(v) => setItems(list =>
                         list.map((x, j) => (j === i ? { ...x, description: v } : x)))} />
              </View>
              <View style={{ width: 130 }}>
                <Field label={i === 0 ? 'Amount' : ''} value={String(item.amount ?? '')}
                       keyboardType="decimal-pad"
                       onChangeText={(v) => setItems(list =>
                         list.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
              </View>
              <Button title="Remove" variant="ghost" size="sm" full={false}
                      onPress={() => setItems(list => list.filter((_, j) => j !== i))} />
            </View>
          ))}
          <Button title="Add a particular" variant="outline" icon="plus" full={false}
                  onPress={() => setItems(list =>
                    [...list, { item_number: list.length + 1, description: '', amount: '' }])} />

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md }}>
            <Text style={{ ...type.heading, color: colors.text }}>Total per pupil</Text>
            <Text style={{ ...type.heading, color: colors.primary }}>{cedis(total)}</Text>
          </View>

          {bookItems.length ? (
            <>
              <Divider />
              <Text style={{ ...type.heading, color: colors.text }}>Part B — textbooks</Text>
              <Muted>
                Textbooks are charged once for the academic year and carried into the other
                two terms as arrears, so they are not billed on the term fee. These lines are
                seeded into the Books tab instead.
              </Muted>
              {bookItems.map((b, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Muted>{b.title}</Muted>
                  <Muted>{cedis(b.amount)}</Muted>
                </View>
              ))}
            </>
          ) : null}

          <Divider />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {!amending ? (
              <Button title="← Back" variant="outline" full={false} onPress={() => setStep('source')} />
            ) : null}
            <Button title="Next — who pays it →" onPress={() => setStep('scope')} />
          </View>
        </View>
      ) : null}

      {step === 'scope' ? (
        <View>
          <SegmentedControl value={scope} onChange={setScope}
                            options={[{ label: 'The whole school', value: 'school' },
                                      { label: 'Chosen classes', value: 'classes' }]} />

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
          <Muted style={{ marginTop: spacing.sm }}>
            Naming every class is the same instruction as "the whole school", and produces
            one standing schedule rather than one per class.
          </Muted>

          {plan ? (
            <>
              <Divider />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
                <Fact label="Pupils affected" value={String(plan.student_count)} />
                <Fact label="Per pupil" value={cedis(total)} />
                <Fact label="Expected in total" value={cedis(total * plan.student_count)} />
                {plan.replaces
                  ? <Fact label="Schedules replaced" value={String(plan.existing_schedules.length)} tone="warn" />
                  : null}
              </View>
              {plan.replaces ? (
                <View style={{
                  marginTop: spacing.md, padding: spacing.md, borderRadius: 8,
                  backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: colors.warning,
                }}>
                  <Text style={{ ...type.small, fontWeight: '800', color: colors.warning }}>
                    This replaces the term's existing school fees bill.
                  </Text>
                  <Text style={{ ...type.small, color: colors.warning, marginTop: 4 }}>
                    {`${plan.existing_schedules.map(e => `“${e.name}”`).join(', ')} will be retired, `
                     + `${plan.bills_already_raised} bill(s) rebuilt, and every balance recalculated. `
                     + `The ${cedis(plan.already_paid)} already received stays exactly where it is — `
                     + 'a parent who has paid is credited against the new figure, not asked for it twice.'}
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}

          {clash ? (
            <View style={{
              marginTop: spacing.md, padding: spacing.md, borderRadius: 8,
              backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: colors.warning,
            }}>
              <Text style={{ ...type.small, fontWeight: '800', color: colors.warning }}>
                A school fees bill already exists for this term
              </Text>
              <Text style={{ ...type.small, color: colors.warning, marginVertical: 6 }}>{clash.error}</Text>
              <Button title={busy ? 'Replacing…' : 'Replace it — recalculate the balances'}
                      busy={busy} disabled={busy} onPress={() => raise(true)} />
              <Button title="Leave it alone" variant="ghost" onPress={() => setClash(null)} />
            </View>
          ) : null}

          <Divider />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button title="← Back" variant="outline" full={false} onPress={() => setStep('lines')} />
            <Button title={busy ? 'Raising…' : `Raise it${plan ? ` for ${plan.student_count} pupil(s)` : ''}`}
                    icon="check" busy={busy} disabled={busy} onPress={() => raise(false)} />
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

function Fact({ label, value, tone }) {
  return (
    <View style={{ minWidth: 120 }}>
      <Muted>{label}</Muted>
      <Text style={{ ...type.heading, color: tone === 'warn' ? colors.warning : colors.text }}>
        {value}
      </Text>
    </View>
  );
}
