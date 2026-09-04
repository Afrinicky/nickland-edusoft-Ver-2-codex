// Canteen — the sheet, the arrears and the school calendar behind them.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A Ghanaian school's canteen is a DAILY charge, not a termly one, and that
// single fact is why it cannot be modelled as a small fee. A child who was
// absent on Tuesday does not owe for Tuesday. A child excused for the term owes
// nothing at all. What a parent owes is therefore the number of SCHOOL DAYS
// they have not paid for, multiplied by the rate — and "which days were school
// days" is a decision the office makes on a calendar.
//
// So: the sheet is a day, the arrears are a count of days, and the calendar is
// what makes both of them mean anything.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { useClasses, todayISO, DateStepper } from '../../pickers';
import { OfficeScreen, cedis, useOffice } from '../../office';
import {
  Select, DataTable, Muted, Badge, EmptyState, ErrorNote, SuccessNote, Button,
  CheckRow, SearchField, Field,
} from '../../ui';
import { Panel, Bar, StatRow, Stat } from '../../desk';
import { colors, spacing, type } from '../../theme';

// ── Dashboard ───────────────────────────────────────────────────────────────

export function CanteenDashboard() {
  const state = useOffice((t) => api.canteenDebtors(t));
  const d = state.data;
  const rows = d?.debtors || d?.students || [];
  const owed = rows.reduce((n, r) => n + (Number(r.amount_owed ?? r.balance) || 0), 0);

  return (
    <OfficeScreen state={state} skeleton={4}>
      <StatRow>
        <Stat index={0} label="Owed to the canteen" icon="bowl" tone="danger" value={cedis(owed)}
              note={`${rows.length} pupil${rows.length === 1 ? '' : 's'} behind`} />
        <Stat index={1} label="Daily rate" icon="wallet" tone="primary"
              value={d?.daily_rate != null ? cedis(d.daily_rate) : '—'}
              note="Set in Settings → Canteen" />
        <Stat index={2} label="Pupils behind" icon="users" tone="warning" value={rows.length}
              note={rows.length ? 'Chased class by class' : 'Nobody is behind'} />
      </StatRow>

      <Panel padded={false} title="Who owes the most"
             subtitle="Days not paid for, times the daily rate.">
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r, i) => String(r.id ?? r.student_id ?? i)}
            empty="Nobody owes the canteen anything."
            columns={[
              { key: 'name', label: 'Pupil',
                render: (r) => r.name || `${r.surname || ''} ${r.first_name || ''}`.trim() },
              { key: 'class_name', label: 'Class', width: 150 },
              { key: 'unpaid_days', label: 'Days', align: 'right', width: 90,
                render: (r) => String(r.unpaid_days ?? r.days ?? '—') },
              { key: 'amount_owed', label: 'Owes', align: 'right', width: 130,
                render: (r) => cedis(r.amount_owed ?? r.balance) },
            ]}
            rows={[...rows].sort((a, b) =>
              (Number(b.amount_owed ?? b.balance) || 0) - (Number(a.amount_owed ?? a.balance) || 0)).slice(0, 40)} />
        </View>
      </Panel>
    </OfficeScreen>
  );
}

// ── The sheet ───────────────────────────────────────────────────────────────

export function CanteenSheet() {
  const { token, profile } = useAuth();
  const { classes } = useClasses(token);
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const mayCollect = can(profile, 'canteen', 'create');

  const state = useOffice(
    (t) => (classId ? api.canteenClass(t, classId, date) : Promise.resolve({ ok: true, students: [] })),
    [classId, date]);

  const d = state.data;
  const rows = d?.students || [];
  const chosen = Object.keys(picked).filter(k => picked[k]);

  async function collect() {
    setBusy(true); setError(null); setDone(null);
    try {
      await api.canteenQuickPaySave(token, {
        classId: Number(classId), date, studentIds: chosen.map(Number), paymentMethod: 'Cash',
      });
      setPicked({});
      setDone(`${chosen.length} pupil${chosen.length === 1 ? '' : 's'} marked paid for ${date}.`);
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      {done ? <SuccessNote message={done} /> : null}

      <Bar left={<>
        <View style={{ minWidth: 220 }}>
          <Select label="Class" value={classId} onChange={(v) => { setPicked({}); setClassId(v); }}
                  placeholder="Which class?"
                  options={(classes || []).map(c => ({ label: c.name, value: String(c.id) }))} />
        </View>
        <View style={{ minWidth: 220 }}>
          <DateStepper label="Day" value={date} onChange={(v) => { setPicked({}); setDate(v); }} />
        </View>
      </>}
      right={<>
        {d?.daily_rate != null ? <Badge tone="neutral" label={`${cedis(d.daily_rate)} a day`} /> : null}
        {chosen.length && mayCollect ? (
          <Button title={busy ? 'Collecting…' : `Collect from ${chosen.length}`}
                  busy={busy} disabled={busy} icon="check" full={false} onPress={collect} />
        ) : null}
      </>} />

      {!classId ? (
        <EmptyState icon="bowl" title="Pick a class"
                    message="The sheet is one class on one day — who has paid for today's food and who has not." />
      ) : rows.length === 0 ? (
        <EmptyState icon="users" title="Nobody in this class" message="There is nobody to collect from." />
      ) : (
        <>
          <StatRow>
            <Stat index={0} label="Paid today" icon="check" tone="success"
                  value={`${d.paid_today || 0} of ${rows.length}`} note={date} />
            <Stat index={1} label="Owed by this class" icon="trend" tone="danger"
                  value={cedis(d.owed_total)} note="Days not paid for, so far this term" />
          </StatRow>

          <Panel padded={false} title="The sheet"
                 subtitle={mayCollect ? 'Tick everybody who has paid, then collect.' : 'Read only.'}>
            <View style={{ padding: spacing.lg, gap: 2 }}>
              {rows.map(r => (
                <CheckRow
                  key={r.id}
                  disabled={!mayCollect || r.today_status === 'paid'}
                  checked={r.today_status === 'paid' || !!picked[r.id]}
                  onToggle={() => setPicked(p => ({ ...p, [r.id]: !p[r.id] }))}
                  title={r.name}
                  subtitle={r.today_status === 'paid' ? 'Paid for today'
                            : r.today_status === 'exempt' ? 'Excused'
                            : `${r.unpaid_days || 0} day${(r.unpaid_days || 0) === 1 ? '' : 's'} behind`}
                  right={<Text style={{ ...type.small, fontWeight: '700',
                                        color: (r.amount_owed || 0) > 0 ? colors.danger : colors.success }}>
                           {cedis(r.amount_owed)}
                         </Text>} />
              ))}
            </View>
          </Panel>
        </>
      )}
    </OfficeScreen>
  );
}

// ── Arrears ─────────────────────────────────────────────────────────────────

export function CanteenDebtors() {
  const { token } = useAuth();
  const { classes } = useClasses(token);
  const [classId, setClassId] = useState('');
  const [q, setQ] = useState('');
  const state = useOffice((t) => api.canteenDebtors(t, classId || undefined), [classId]);
  const rows = useMemo(() => {
    const list = state.data?.debtors || state.data?.students || [];
    const needle = q.trim().toLowerCase();
    return needle ? list.filter(r => `${r.name || ''} ${r.class_name || ''}`.toLowerCase().includes(needle)) : list;
  }, [state.data, q]);

  return (
    <OfficeScreen state={state} skeleton={5}>
      <Bar left={<>
        <View style={{ minWidth: 200 }}>
          <Select label="Class" value={classId} onChange={setClassId} placeholder="Every class"
                  options={[{ label: 'Every class', value: '' },
                            ...(classes || []).map(c => ({ label: c.name, value: String(c.id) }))]} />
        </View>
        <View style={{ minWidth: 240, flex: 1 }}>
          <SearchField value={q} onChangeText={setQ} placeholder="Find a pupil" />
        </View>
      </>}
      right={<Badge tone="danger" label={cedis(rows.reduce((n, r) =>
        n + (Number(r.amount_owed ?? r.balance) || 0), 0))} />} />

      <Panel padded={false}>
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r, i) => String(r.id ?? r.student_id ?? i)}
            empty="Nobody owes the canteen anything."
            columns={[
              { key: 'name', label: 'Pupil',
                render: (r) => r.name || `${r.surname || ''} ${r.first_name || ''}`.trim() },
              { key: 'class_name', label: 'Class', width: 150 },
              { key: 'unpaid_days', label: 'Days behind', align: 'right', width: 120,
                render: (r) => String(r.unpaid_days ?? r.days ?? '—') },
              { key: 'amount_owed', label: 'Owes', align: 'right', width: 130,
                render: (r) => cedis(r.amount_owed ?? r.balance) },
            ]}
            rows={rows} />
        </View>
      </Panel>
    </OfficeScreen>
  );
}

// ── The calendar ────────────────────────────────────────────────────────────
//
// Which days the canteen charges for. Everything above depends on it: a day
// that is not a school day is a day nobody owes for, and a term whose calendar
// has never been set charges for Saturdays.

export function CanteenCalendar() {
  const { token, profile } = useAuth();
  const state = useOffice((t) => api.systemSettings(t));
  const [rate, setRate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const may = can(profile, 'settings', 'edit');

  useEffect(() => {
    const s = state.data?.settings;
    if (s && rate === null) setRate(String(s.canteen_daily_rate || ''));
  }, [state.data, rate]);

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      await api.systemSaveSettings(token, { canteen_daily_rate: rate });
      setSaved(true);
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={3}>
      <ErrorNote message={error} />
      {saved ? <SuccessNote message="Saved. Every arrears figure is worked out from this rate." /> : null}

      <Panel title="What the canteen charges"
             subtitle="One rate for the whole school, charged per school day.">
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <View style={{ minWidth: 220 }}>
            <RateField value={rate} onChange={setRate} disabled={!may} />
          </View>
          {may ? (
            <Button title={busy ? 'Saving…' : 'Save the rate'} busy={busy} disabled={busy}
                    full={false} onPress={save} />
          ) : null}
        </View>
      </Panel>

      <Panel title="Which days are charged for"
             subtitle="The school calendar decides. A day marked as a holiday charges nobody.">
        <Muted>
          The term's school days come from the calendar the office sets when a term is
          created — start date, end date, and the holidays inside it. Change them under
          Settings → Terms, and every canteen figure follows on the next reading.
        </Muted>
      </Panel>
    </OfficeScreen>
  );
}

function RateField({ value, onChange, disabled }) {
  return (
    <Field label="Daily rate" value={value ?? ''} onChangeText={disabled ? undefined : onChange}
           hint="In cedis, per pupil, per school day" />
  );
}
