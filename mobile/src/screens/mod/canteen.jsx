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
import { useRouter } from 'expo-router';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { useOfficeClasses, todayISO, DateStepper } from '../../pickers';
import { OfficeScreen, cedis, useOffice } from '../../office';
import {
  Select, DataTable, Muted, Badge, EmptyState, ErrorNote, SuccessNote, Button,
  CheckRow, SearchField, Field,
} from '../../ui';
import { Panel, Bar, StatRow, Stat } from '../../desk';
import {
  MetricCard, MetricRow, SectionCard, DashRow, DebtorRow, PaymentRow, Banner,
  EmptyLine, ghs, fullName, dateLabel,
} from '../../dash';
import { useLayout } from '../../responsive';
import { colors, spacing, type } from '../../theme';

// ── Dashboard ───────────────────────────────────────────────────────────────

export function CanteenDashboard() {
  const router = useRouter();
  const layout = useLayout();
  const wide = layout.isDesktop;

  const state = useOffice(async (t) => {
    const [debtors, rich] = await Promise.all([
      api.canteenDebtors(t),
      wide ? api.dashCanteen(t) : Promise.resolve(null),
    ]);
    return { debtors, rich: rich && rich.ok ? rich : null };
  }, [wide]);

  const rich = state.data?.rich;

  return (
    <OfficeScreen state={state} skeleton={4}>
      {rich ? <CanteenFull d={rich} router={router} />
        : state.data ? <CanteenPlain d={state.data.debtors} /> : null}
    </OfficeScreen>
  );
}

// ══ The installed application's Canteen → Dashboard ═════════════════════════
//
// What has been collected, what has not, the daily rate the arithmetic rests
// on, and where today stands; then the biggest debtors and the last
// collections.
//
// "Today's Status" is paid out of marked, not out of the roll. A pupil with no
// entry for today has not been recorded either way, and counting them as
// unpaid would invent arrears the school does not claim.

function CanteenFull({ d, router }) {
  const m = d.metrics || {};
  const todayTotal = (m.today_paid || 0) + (m.today_unpaid || 0) + (m.today_exempt || 0);
  const todayPct = todayTotal > 0 ? Math.round(((m.today_paid || 0) / todayTotal) * 100) : 0;

  return (
    <View style={{ width: '100%' }}>
      <MetricRow columns={4}>
        <MetricCard index={0} tone="green" icon="cash" valueTone="success"
                    label="Collected This Term" value={ghs(m.total_collected)}
                    sub={`${m.payment_count || 0} payments`} />
        <MetricCard index={1} tone="red" icon="alert" valueTone="danger"
                    label="Outstanding" value={ghs(m.amount_owed)}
                    sub={`${m.unpaid_students || 0} students, ${m.unpaid_days_total || 0} days`} />
        <MetricCard index={2} tone="blue" icon="calendar"
                    label="Daily Rate" value={ghs(d.daily_rate)}
                    sub={`${m.total_school_days || 0} school days`} />
        <MetricCard index={3} tone="orange" icon="bell"
                    label="Today's Status" value={`${m.today_paid || 0}/${todayTotal}`}
                    sub={`paid (${todayPct}%) · ${m.today_exempt || 0} exempt`}
                    link="Quick Pay →"
                    onPress={() => router.push('/app/canteen?tab=quickpay')} />
      </MetricRow>

      {m.attendance_exempt_enabled ? (
        <Banner>
          ✓ Attendance-linked exemption is ON. Absent students will not be charged
          canteen fees for that day.
        </Banner>
      ) : null}

      <DashRow weights={[1, 1]}>
        <SectionCard title="Top Canteen Debtors" viewAll="View all →"
                     onViewAll={() => router.push('/app/canteen?tab=debtors')}>
          {(d.top_debtors || []).length === 0
            ? <EmptyLine>No debtors 🎉</EmptyLine>
            : d.top_debtors.slice(0, 8).map((r, i, arr) => (
              <DebtorRow key={r.student_id} person={r} amount={r.amount_owed}
                         days={r.unpaid_days} last={i === arr.length - 1}
                         onPress={() => router.push(`/app/students/${r.student_id}`)} />
            ))}
        </SectionCard>

        <SectionCard title="Recent Payments">
          {(d.recent_payments || []).length === 0
            ? <EmptyLine>No payments yet</EmptyLine>
            : d.recent_payments.slice(0, 8).map((p, i, arr) => (
              <PaymentRow key={p.id} name={fullName(p)}
                          note={`${p.class_code || ''} · ${p.days_covered || 0} day${p.days_covered === 1 ? '' : 's'}`}
                          amount={ghs(p.amount)} when={dateLabel(p.payment_date)}
                          last={i === arr.length - 1} />
            ))}
        </SectionCard>
      </DashRow>
    </View>
  );
}

// ══ What the arrears list alone can show ════════════════════════════════════

function CanteenPlain({ d }) {
  const rows = d?.debtors || d?.students || [];
  const owed = rows.reduce((n, r) => n + (Number(r.amount_owed ?? r.balance) || 0), 0);

  return (
    <>
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
    </>
  );
}

// ── The sheet ───────────────────────────────────────────────────────────────

export function CanteenSheet() {
  const { token, profile } = useAuth();
  const { classes } = useOfficeClasses(token);
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
  const { classes } = useOfficeClasses(token);
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
  const settings = useOffice((t) => api.systemSettings(t));
  const calendar = useOffice((t) => api.schoolCalendar(t).catch(() => null));
  const [rate, setRate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [holidays, setHolidays] = useState('');
  const [weekends, setWeekends] = useState('yes');
  const [day, setDay] = useState({ date: todayISO(), dayType: 'holiday', label: '' });
  const may = can(profile, 'settings', 'edit') || can(profile, 'canteen', 'edit');

  useEffect(() => {
    const s = settings.data?.settings;
    if (s && rate === null) setRate(String(s.canteen_daily_rate || ''));
  }, [settings.data, rate]);

  const cal = calendar.data;
  const days = cal?.days || [];
  const schoolDays = cal?.school_days ?? 0;

  async function saveRate() {
    setBusy(true); setError(null); setSaved(null);
    try {
      await api.systemSaveSettings(token, { canteen_daily_rate: rate });
      setSaved('Saved. Every arrears figure is worked out from this rate.');
      settings.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  // The whole term at once: weekdays in, weekends out, and the holidays the
  // office names taken out on top. This is the operation a term begins with.
  async function layOutTerm() {
    setBusy(true); setError(null); setSaved(null);
    try {
      const parsed = holidays.split(/[\n,]+/).map(x => x.trim()).filter(Boolean).map((line) => {
        const [date, ...rest] = line.split(/\s+/);
        return { date, label: rest.join(' ') || 'Holiday' };
      }).filter(h => /^\d{4}-\d{2}-\d{2}$/.test(h.date));
      const r = await api.setUpTermCalendar(token, {
        excludeWeekends: weekends === 'yes', holidays: parsed,
      });
      setSaved(`${r.term}: ${r.school_days} school days, ${r.off_days} days off.`);
      calendar.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  // One day, changed. A public holiday declared on Tuesday afternoon is the
  // ordinary case, and it must not cost the office the whole term's calendar.
  async function saveDay() {
    setBusy(true); setError(null); setSaved(null);
    try {
      await api.setCalendarDay(token, day);
      setSaved(`${day.date} is now ${day.dayType === 'school_day' ? 'a school day' : 'a day off'}.`);
      calendar.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={settings} skeleton={3}>
      <ErrorNote message={error} />
      {saved ? <SuccessNote message={saved} /> : null}

      <StatRow>
        <Stat index={0} label="Daily rate" icon="wallet" tone="primary"
              value={rate ? cedis(rate) : '—'} note="Per pupil, per school day" />
        <Stat index={1} label="School days this term" icon="calendar" tone="data"
              value={schoolDays}
              note={schoolDays ? 'What the arrears are counted against' : 'The calendar has not been set up'} />
        <Stat index={2} label="Days off" icon="note" tone="warning"
              value={Math.max(0, days.length - schoolDays)}
              note="Weekends and holidays — nobody is charged" />
      </StatRow>

      <Panel title="What the canteen charges"
             subtitle="One rate for the whole school, charged per school day.">
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <View style={{ minWidth: 220 }}>
            <RateField value={rate} onChange={setRate} disabled={!may} />
          </View>
          {may ? (
            <Button title={busy ? 'Saving…' : 'Save the rate'} busy={busy} disabled={busy}
                    full={false} onPress={saveRate} />
          ) : null}
        </View>
      </Panel>

      {cal ? (
        <>
          <Panel title="Lay out the term"
                 subtitle="Weekdays become school days, weekends do not, and the holidays you name are taken out.">
            {may ? (
              <>
                <View style={{ flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' }}>
                  <View style={{ minWidth: 220 }}>
                    <Select label="Weekends" value={weekends} onChange={setWeekends}
                            options={[{ label: 'Not school days', value: 'yes' },
                                      { label: 'Charge for them too', value: 'no' }]} />
                  </View>
                </View>
                <Field label="Holidays" value={holidays} onChangeText={setHolidays}
                       multiline
                       hint="One a line: 2026-03-06 Independence Day. Anything without a date is ignored." />
                <Button title={busy ? 'Working…' : 'Lay out this term'} busy={busy} disabled={busy}
                        icon="calendar" full={false} onPress={layOutTerm} />
                <Muted style={{ marginTop: 6 }}>
                  This rewrites the term&apos;s calendar. Payments already taken are untouched —
                  what changes is which days a pupil is counted as owing for.
                </Muted>
              </>
            ) : <Muted>You can see the calendar but not change it.</Muted>}
          </Panel>

          <Panel title="One day"
                 subtitle="A holiday declared at short notice, or a Saturday the school did open.">
            {may ? (
              <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <View style={{ minWidth: 190 }}>
                  <Field label="Date" value={day.date}
                         onChangeText={(v) => setDay(d => ({ ...d, date: v }))}
                         placeholder="YYYY-MM-DD" maxLength={10} />
                </View>
                <View style={{ minWidth: 190 }}>
                  <Select label="It is" value={day.dayType}
                          onChange={(v) => setDay(d => ({ ...d, dayType: v }))}
                          options={[{ label: 'A day off', value: 'holiday' },
                                    { label: 'A school day', value: 'school_day' }]} />
                </View>
                <View style={{ minWidth: 190, flex: 1 }}>
                  <Field label="Why" value={day.label}
                         onChangeText={(v) => setDay(d => ({ ...d, label: v }))}
                         hint="Optional — Founders' Day, Election Day" />
                </View>
                <Button title="Save the day" disabled={busy} full={false} onPress={saveDay} />
              </View>
            ) : <Muted>You can see the calendar but not change it.</Muted>}
          </Panel>

          <Panel padded={false} title="The term, day by day"
                 subtitle="What each day counts as. A day off charges nobody.">
            <View style={{ padding: spacing.lg }}>
              <DataTable
                keyExtractor={(r) => String(r.date)}
                empty="This term has no calendar yet. Lay it out above."
                columns={[
                  { key: 'date', label: 'Date', width: 150 },
                  { key: 'day_type', label: 'Counts as', width: 170,
                    render: (r) => (r.day_type === 'school_day'
                      ? <Badge tone="success" label="School day" />
                      : <Badge tone="neutral" label="Day off" />) },
                  { key: 'label', label: 'Why', render: (r) => r.label || '—' },
                ]}
                rows={days} />
            </View>
          </Panel>
        </>
      ) : (
        <Panel title="Which days are charged for"
               subtitle="The school calendar decides. A day marked as a holiday charges nobody.">
          <Muted>
            This connection carries a summary of the school rather than the whole of it, so
            the calendar is set on the school&apos;s own system — under the Canteen module,
            or when a term is created.
          </Muted>
        </Panel>
      )}
    </OfficeScreen>
  );
}

function RateField({ value, onChange, disabled }) {
  return (
    <Field label="Daily rate" value={value ?? ''} onChangeText={disabled ? undefined : onChange}
           hint="In cedis, per pupil, per school day" />
  );
}
