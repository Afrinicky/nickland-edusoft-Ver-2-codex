// Nickland Edusoft — Canteen billing.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The canteen is billed by the DAY, not by the term: what a family owes is the
// daily rate times the number of feeding days the school actually opens for.
// So the term's canteen calendar is not a canteen-module detail — it IS the
// canteen bill, and it belongs where the school's other bills are raised.
//
// The calendar itself is unchanged: same generator, same holidays, same day
// grid. What is new is that the bill it implies can be seen and printed from
// here, which is what a parent asks for at the gate in week one.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { useOfficeClasses } from '../../pickers';
import { cedis, shortDate, termLabel, useOffice, OfficeScreen } from '../../office';
import {
  Select, DataTable, Muted, Button, Field, Sheet, CheckRow, Divider,
  EmptyState, ErrorNote, SuccessNote, Loading, SearchField,
} from '../../ui';
import { Panel, Bar, StatRow, Stat } from '../../desk';
import { printHtml } from '../../print';
import { colors, spacing, type } from '../../theme';

const DAY_TONES = {
  school_day: { bg: '#EEF3FB', fg: colors.primary, label: 'Feeding day' },
  holiday: { bg: '#F1F3F6', fg: colors.muted, label: 'Holiday' },
  weekend: { bg: '#F1F3F6', fg: colors.muted, label: 'Weekend' },
};

export default function CanteenBills() {
  const { token, profile } = useAuth();
  const { classes } = useOfficeClasses(token);
  const maySetUp = can(profile, 'settings', 'edit');

  const [classId, setClassId] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);

  const state = useOffice(async (t) => {
    const [summary, calendar] = await Promise.all([
      api.billsSummary(t),
      api.schoolCalendar(t).catch(() => ({ days: [], calendar: [] })),
    ]);
    return { summary, days: calendar.days || calendar.calendar || [] };
  }, []);

  const roll = useOffice(
    (t) => api.adminStudents(t, { status: 'Active', classId: classId || undefined })
      .catch(() => ({ students: [] })),
    [classId]);

  const summary = state.data?.summary;
  const term = summary?.term;
  const days = state.data?.days || [];
  const canteenKind = (summary?.kinds || []).find(k => k.key === 'canteen');

  // The days and the rate come from the summary, which computes them the same
  // way the bill does. Deriving the rate back out of a total and a headcount
  // would disagree with the printed bill the moment the roll changed.
  const feedingDays = canteenKind?.feeding_days
    ?? days.filter(d => d.day_type === 'school_day').length;
  const rate = canteenKind?.daily_rate || 0;
  const perPupil = canteenKind?.per_pupil ?? Math.round(feedingDays * rate * 100) / 100;

  const students = useMemo(() => {
    const list = roll.data?.students || [];
    const needle = q.trim().toLowerCase();
    return list.filter(s => !needle
      || `${s.name || ''} ${s.index_number || ''}`.toLowerCase().includes(needle));
  }, [roll.data, q]);

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const print = useCallback(async (studentIds, what) => {
    if (!studentIds.length) return setError('Nobody selected to print for.');
    if (!feedingDays) return setError('Lay out the term’s calendar first.');
    setBusy(true); setError(null);
    try {
      const doc = await api.canteenBillHtml(token, {
        termId: term?.id, studentIds: studentIds.join(','),
      });
      await printHtml(doc);
      setNote(`${studentIds.length} canteen ${what} ready to print`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }, [token, term?.id, feedingDays]);

  const className = (classes || []).find(c => String(c.id) === String(classId))?.name;

  return (
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      {note ? <SuccessNote message={note} /> : null}

      <StatRow>
        <Stat index={0} label="Feeding days" icon="layers" tone="primary"
              value={String(feedingDays)} note={termLabel(term, 'no term running')} />
        <Stat index={1} label="Per pupil, the term" icon="wallet" tone="data"
              value={cedis(perPupil)}
              note={`${feedingDays} day(s) × ${cedis(rate)}`} />
        <Stat index={2} label="Collected" icon="check" tone="success"
              value={cedis(canteenKind?.paid || 0)} note={canteenKind?.note || ''} />
        <Stat index={3} label="Outstanding" icon="alert" tone="danger"
              value={cedis(canteenKind?.outstanding || 0)}
              note={`${canteenKind?.debtors || 0} unpaid day(s)`} />
      </StatRow>

      <Panel title={`Term calendar — ${termLabel(term)}`}
             subtitle={`${days.length} day(s) laid out · ${feedingDays} charged for`}
             right={maySetUp ? (
               <Button title={days.length ? 'Lay it out again' : 'Set up calendar'}
                       icon="calendar" full={false} onPress={() => setSetup(true)} />
             ) : null}>
        {days.length === 0 ? (
          <EmptyState icon="calendar" title="No calendar yet for this term"
                      message={maySetUp
                        ? 'Generate the term’s school days and holidays — the canteen bill is worked out from them.'
                        : 'The school office sets this up. Canteen days cannot be collected until they do.'} />
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {days.map(d => {
                const tone = DAY_TONES[d.day_type] || DAY_TONES.holiday;
                return (
                  <View key={d.date}
                        accessibilityLabel={`${d.date} ${tone.label}`}
                        style={{
                          width: 38, height: 38, borderRadius: 6,
                          borderWidth: 1, borderColor: colors.border,
                          alignItems: 'center', justifyContent: 'center',
                          backgroundColor: tone.bg,
                        }}>
                    <Text style={{ fontSize: 11, color: tone.fg }}>
                      {new Date(d.date).getDate()}
                    </Text>
                  </View>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md, flexWrap: 'wrap' }}>
              {Object.entries(DAY_TONES).map(([k, t]) => (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{
                    width: 12, height: 12, borderRadius: 3,
                    backgroundColor: t.bg, borderWidth: 1, borderColor: colors.border,
                  }} />
                  <Muted>{t.label}</Muted>
                </View>
              ))}
            </View>
          </>
        )}
      </Panel>

      <Panel padded={false} title="The canteen bill"
             subtitle="Print for a class before reopening, for a selection, or one at a time.">
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Bar left={<>
            <View style={{ minWidth: 190 }}>
              <Select label="" value={classId} onChange={(v) => { setClassId(v); setSelected(new Set()); }}
                      placeholder="Every class"
                      options={[{ label: 'Every class', value: '' },
                                ...(classes || []).map(c => ({ label: c.name, value: String(c.id) }))]} />
            </View>
            <View style={{ minWidth: 200, flex: 1 }}>
              <SearchField value={q} onChangeText={setQ} placeholder="Find a pupil" />
            </View>
          </>}
          right={<>
            {selected.size ? (
              <Button title={`Print ${selected.size} selected`} icon="print" full={false}
                      busy={busy} disabled={busy} onPress={() => print([...selected], 'bill(s)')} />
            ) : null}
            <Button title={classId ? `Print all of ${className}` : 'Print the whole school'}
                    icon="print" variant="outline" full={false} busy={busy}
                    disabled={busy || !students.length}
                    onPress={() => print(students.map(s => s.id), 'bill(s)')} />
          </>} />

          <DataTable
            keyExtractor={(r) => String(r.id)}
            empty="Nobody active in that class"
            onRowPress={(r) => toggle(r.id)}
            columns={[
              { key: 'pick', label: '', width: 44, render: (r) => (
                <Pressable onPress={() => toggle(r.id)} accessibilityRole="checkbox"
                           accessibilityState={{ checked: selected.has(r.id) }}
                           style={{
                             width: 18, height: 18, borderRadius: 4, borderWidth: 1.5,
                             borderColor: selected.has(r.id) ? colors.primary : colors.border,
                             backgroundColor: selected.has(r.id) ? colors.primary : 'transparent',
                           }} />
              ) },
              { key: 'index_number', label: 'Index No', width: 120 },
              { key: 'name', label: 'Pupil' },
              { key: 'class_name', label: 'Class', width: 140 },
              { key: 'days', label: 'Days', align: 'right', width: 80,
                render: () => String(feedingDays) },
              { key: 'owing', label: 'For the term', align: 'right', width: 140,
                render: () => (
                  <Text style={{ ...type.small, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                    {cedis(perPupil)}
                  </Text>
                ) },
            ]}
            rows={students} />
        </View>
      </Panel>

      {setup ? (
        <SetupSheet term={term} onClose={() => setSetup(false)}
                    onDone={() => { setSetup(false); state.reload(); setNote('Calendar generated'); }} />
      ) : null}
    </OfficeScreen>
  );
}

// The generator, exactly as the canteen module had it — same dates, same
// weekend rule, same named holidays. Moving a screen is not an excuse to
// change what it does.
function SetupSheet({ term, onClose, onDone }) {
  const { token } = useAuth();
  const [start, setStart] = useState(term?.start_date || '');
  const [end, setEnd] = useState(term?.end_date || '');
  const [excludeWeekends, setExcludeWeekends] = useState(true);
  const [holidays, setHolidays] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.setUpTermCalendar(token, {
        termId: term?.id, startDate: start, endDate: end, excludeWeekends,
        holidays: holidays.filter(h => h.date),
      });
      onDone();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Sheet visible onClose={onClose} title="Set up term calendar">
      <ErrorNote message={error} />
      <Field label="Start date" value={start} onChangeText={setStart} placeholder="YYYY-MM-DD" />
      <Field label="End date" value={end} onChangeText={setEnd} placeholder="YYYY-MM-DD" />
      <CheckRow label="Treat weekends (Sat/Sun) as holidays"
                checked={excludeWeekends} onToggle={() => setExcludeWeekends(v => !v)} />

      <Divider />
      <Text style={{ ...type.heading, color: colors.text }}>Holidays / non-school days</Text>
      {holidays.map((h, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
          <View style={{ width: 150 }}>
            <Field label={i === 0 ? 'Date' : ''} value={h.date || ''} placeholder="YYYY-MM-DD"
                   onChangeText={(v) => setHolidays(list =>
                     list.map((x, j) => (j === i ? { ...x, date: v } : x)))} />
          </View>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Field label={i === 0 ? 'Label' : ''} value={h.label || ''} placeholder="e.g. Christmas"
                   onChangeText={(v) => setHolidays(list =>
                     list.map((x, j) => (j === i ? { ...x, label: v } : x)))} />
          </View>
          <Button title="Remove" variant="ghost" size="sm" full={false}
                  onPress={() => setHolidays(list => list.filter((_, j) => j !== i))} />
        </View>
      ))}
      <Button title="Add a holiday" variant="outline" icon="plus" full={false}
              onPress={() => setHolidays(list => [...list, { date: '', label: '' }])} />

      <Button title={busy ? 'Generating…' : 'Generate calendar'} busy={busy} disabled={busy}
              onPress={save} />
    </Sheet>
  );
}
