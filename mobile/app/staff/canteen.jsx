// Canteen — the morning collection, the class sheet, and one pupil at a time.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The desktop has had Quick Pay since the first release: the class for one day,
// every child who has not paid ticked by default, absentees excluded, and one
// press to record the lot. The teacher's app had nothing of the kind — a class
// teacher at the door with forty children filing past had to open a form,
// find a pupil, type an amount and save, forty times.
//
// So Quick Pay is here, and it opens first, because it is what a teacher opens
// the app for at eight in the morning. The sheet and the single collection are
// still a tab away for the rest of the day.
//
// The money is real cash, taken by hand at the school gate and recorded here.
// Nothing on this screen charges a card or a wallet; there is no such thing in
// this app any more.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { useAuth } from '../../src/auth';
import { RequireModule } from '../../src/guard';
import { api, money } from '../../src/api';
import {
  Screen, Card, Section, Heading, Body, Muted, Micro, Button, Badge, Sheet, Field, Select,
  ErrorNote, SuccessNote, InfoNote, WarningNote, Skeleton, EmptyState, ListRow, SearchField,
  Grid, StatCard, KeyValue, Tabs, CheckRow, Avatar, Toolbar, DateField, Divider,
} from '../../src/ui';
import { ClassPicker, useClasses } from '../../src/pickers';
import { useLayout } from '../../src/responsive';
import { colors, palette, spacing, radius, type } from '../../src/theme';

const METHODS = ['Cash', 'Mobile Money', 'Bank'];
const todayISO = () => new Date().toISOString().slice(0, 10);

function CanteenScreen() {
  const { token, mode, profile } = useAuth();
  const layout = useLayout();
  const { classes } = useClasses(token);

  // Quick Pay first. It is the eight-o'clock job, and the tab a teacher opens
  // the module for; the sheet is what they check at break.
  const [tab, setTab] = useState('quick');
  const [classId, setClassId] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (classId == null && classes && classes.length === 1) setClassId(classes[0].id);
  }, [classes, classId]);

  const canCollect = profile?.is_admin || profile?.permissions?.canteen?.canCreate;
  const cloud = mode === 'cloud';

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => setRefreshing(false)} />}>
      <ErrorNote message={error} />
      <SuccessNote message={saved} />

      <Card><ClassPicker classes={classes} value={classId} onChange={setClassId} /></Card>

      <Card padded={false} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
        <Tabs
          value={tab} onChange={(v) => { setTab(v); setError(null); setSaved(null); }}
          options={[
            { value: 'quick', label: 'Quick pay', icon: 'check' },
            { value: 'sheet', label: "Today's sheet", icon: 'bowl' },
            { value: 'one', label: 'One pupil', icon: 'user' },
          ]}
        />
      </Card>

      {!classId ? (
        <Card>
          <EmptyState
            icon="bowl" title="Choose a class"
            message="The daily collection belongs to the teacher answerable for the class. Pick yours to begin."
          />
        </Card>
      ) : tab === 'quick' ? (
        <QuickPay
          token={token} classId={classId} cloud={cloud} canCollect={canCollect}
          onError={setError} onSaved={setSaved} layout={layout}
        />
      ) : tab === 'sheet' ? (
        <ClassSheet token={token} classId={classId} onError={setError} />
      ) : (
        <OnePupil
          token={token} classId={classId} canCollect={canCollect}
          onError={setError} onSaved={setSaved} cloud={cloud}
        />
      )}
    </Screen>
  );
}

// ── Quick Pay ───────────────────────────────────────────────────────────────
function QuickPay({ token, classId, cloud, canCollect, onError, onSaved, layout }) {
  const [date, setDate] = useState(todayISO());
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState({});
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [method, setMethod] = useState('Cash');

  const load = useCallback(async () => {
    setData(null); onError(null);
    try {
      const r = await api.canteenQuickPay(token, classId, date);
      setData(r);
      // The same default the desktop applies: everybody who owes for the day
      // and was not marked absent. A teacher unticks the two who did not bring
      // money rather than ticking thirty-eight who did.
      const next = {};
      for (const s of r.students || []) {
        if (s.canteen_status === 'unpaid' && s.attendance_status !== 'absent') next[s.id] = true;
      }
      setPicked(next);
    } catch (e) { onError(e.message); setData({ students: [], denied: true }); }
  }, [token, classId, date, onError]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = data?.students || [];
    return needle ? all.filter(s => `${s.name} ${s.index_number}`.toLowerCase().includes(needle)) : all;
  }, [data, q]);

  const ids = Object.entries(picked).filter(([, v]) => v).map(([k]) => Number(k));
  const rate = data?.daily_rate || 0;
  const total = ids.length * rate;

  async function record() {
    if (!ids.length) { onError('Tick at least one pupil.'); return; }
    setBusy(true); onError(null);
    try {
      const r = await api.canteenQuickPaySave(token, { classId, date, studentIds: ids, paymentMethod: method });
      setConfirm(false);
      onSaved(
        `${r.count} pupil${r.count === 1 ? '' : 's'} marked paid for ${date} — ${money(r.total)} collected.` +
        (r.skipped ? ` ${r.skipped} were already settled and were left alone.` : '')
      );
      setPicked({});
      load();
    } catch (e) { onError(e.message); }
    finally { setBusy(false); }
  }

  async function excuseAbsent() {
    const absent = (data?.students || [])
      .filter(s => s.attendance_status === 'absent' && s.canteen_status === 'unpaid')
      .map(s => s.id);
    if (!absent.length) { onError('Nobody on the register is marked absent today.'); return; }
    setBusy(true); onError(null);
    try {
      const r = await api.canteenExempt(token, { classId, date, studentIds: absent, reason: 'Absent' });
      onSaved(
        `${r.count} absent pupil${r.count === 1 ? '' : 's'} excused for ${date}.` +
        (r.skipped ? ` ${r.skipped} had already paid for the day and were left alone.` : '')
      );
      load();
    } catch (e) { onError(e.message); }
    finally { setBusy(false); }
  }

  if (cloud) {
    return (
      <Card>
        <EmptyState
          icon="bowl" title="Quick pay needs the school's network"
          message="The daily collection reads the register live and takes real money, so it runs on the school's own system. Connect on the school Wi-Fi to use it — the rest of the canteen module works from anywhere."
        />
      </Card>
    );
  }

  if (data === null) return <Card><Skeleton rows={7} height={54} /></Card>;

  if (data.denied) {
    return (
      <Card>
        <EmptyState
          icon="bowl" title="Not your collection"
          message="The daily collection belongs to the teacher answerable for the class. You can still collect from a pupil in a class of yours under “One pupil”."
        />
      </Card>
    );
  }

  const notASchoolDay = data.day_type && data.day_type !== 'school_day';

  return (
    <>
      <Card>
        <View style={{ flexDirection: layout.isPhone ? 'column' : 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <DateField label="Collecting for" value={date} onChange={setDate} hint="Any school day. Defaults to today." />
          </View>
          <View style={{ flex: 1 }}>
            <Select
              label="How it was paid" value={method} onChange={setMethod}
              options={METHODS.map(m => ({ value: m, label: m }))}
            />
          </View>
        </View>
        {notASchoolDay ? (
          <WarningNote message={`The school calendar has ${date} as ${data.day_label || data.day_type.replace('_', ' ')}, not a school day. Collecting for it is unusual — check the date.`} />
        ) : null}
      </Card>

      <Grid min={150}>
        <StatCard label="On roll" value={data.totals?.on_roll ?? 0} icon="users" />
        <StatCard label="Not yet paid" value={data.totals?.unpaid ?? 0} tone={data.totals?.unpaid ? 'warning' : 'success'} icon="alert" />
        <StatCard label="Absent today" value={data.totals?.absent ?? 0} tone={data.totals?.absent ? 'danger' : undefined} icon="user" />
        <StatCard label="Daily rate" value={money(rate)} icon="cash" />
      </Grid>

      {/* The running total. A teacher counting notes at the gate needs to see
          the figure they should be holding, not compute it afterwards. */}
      <Card tone={ids.length ? 'accent' : undefined}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 180 }}>
            <Micro>Selected</Micro>
            <Text style={{ ...type.numeric, color: colors.text }}>
              {ids.length} × {money(rate)} = {money(total)}
            </Text>
            <Muted style={{ marginTop: 2 }}>
              {ids.length === 0 ? 'Nobody ticked yet.' : `That is what you should be holding for ${date}.`}
            </Muted>
          </View>
          {canCollect ? (
            <Button
              title={`Record ${ids.length || ''} payment${ids.length === 1 ? '' : 's'}`.replace('  ', ' ')}
              icon="check" disabled={!ids.length || busy} onPress={() => setConfirm(true)} full={false}
            />
          ) : null}
        </View>
      </Card>

      <Card>
        <SearchField value={q} onChangeText={setQ} placeholder="Find a pupil" />
        <Toolbar style={{ marginTop: spacing.sm }}>
          <Button size="sm" variant="subtle" title="All unpaid" full={false}
            onPress={() => setPicked(Object.fromEntries((data.students || [])
              .filter(s => s.canteen_status === 'unpaid').map(s => [s.id, true])))} />
          <Button size="sm" variant="subtle" title="Unpaid and present" full={false}
            onPress={() => setPicked(Object.fromEntries((data.students || [])
              .filter(s => s.canteen_status === 'unpaid' && s.attendance_status !== 'absent').map(s => [s.id, true])))} />
          <Button size="sm" variant="ghost" title="Clear" full={false} onPress={() => setPicked({})} />
          {canCollect ? (
            <Button size="sm" variant="outline" title="Excuse the absent" icon="user" full={false}
              busy={busy} onPress={excuseAbsent} />
          ) : null}
        </Toolbar>
      </Card>

      <Section
        title={`Class roll — ${date}`} icon="list"
        subtitle="Ticked pupils will be marked paid for this day."
      >
        {rows.length === 0 ? <Muted>Nobody matches that.</Muted> : (
          <View style={{ gap: 8 }}>
            {rows.map(s => {
              const settled = s.canteen_status === 'paid' || s.canteen_status === 'exempt';
              const absent = s.attendance_status === 'absent';
              return (
                <CheckRow
                  key={s.id}
                  checked={!!picked[s.id]}
                  disabled={settled}
                  onToggle={() => setPicked(p => ({ ...p, [s.id]: !p[s.id] }))}
                  avatar={<Avatar name={s.name} photo={s.photo} size={36} />}
                  title={s.name}
                  subtitle={[s.index_number, absent ? 'Marked absent' : s.attendance_status || null].filter(Boolean).join(' · ')}
                  right={
                    settled
                      ? <Badge tone={s.canteen_status === 'paid' ? 'success' : 'neutral'}
                          label={s.canteen_status === 'paid' ? 'Paid' : 'Excused'} />
                      : absent
                        ? <Badge tone="danger" label="Absent" />
                        : <Badge tone="warning" label="Owing" />
                  }
                />
              );
            })}
          </View>
        )}
      </Section>

      <Sheet
        visible={confirm} onClose={() => setConfirm(false)} title="Record the collection" width={460}
        footer={<>
          <Button variant="outline" title="Go back" onPress={() => setConfirm(false)} full={false} />
          <Button title={busy ? 'Recording…' : 'Yes, record it'} onPress={record} busy={busy} full={false} />
        </>}
      >
        <KeyValue columns={2} items={[
          { label: 'Day', value: date },
          { label: 'Pupils', value: ids.length },
          { label: 'Daily rate', value: money(rate) },
          { label: 'Total', value: money(total) },
          { label: 'Method', value: method },
        ]} />
        <InfoNote message="This records cash you have already collected. Each pupil's day is marked paid and the money is posted to the school's canteen income — a pupil already settled for this day is skipped rather than charged twice." />
      </Sheet>
    </>
  );
}

// ── the class sheet ─────────────────────────────────────────────────────────
function ClassSheet({ token, classId, onError }) {
  const [sheet, setSheet] = useState(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setSheet(null); onError(null);
    try { setSheet(await api.canteenClass(token, classId)); }
    catch (e) { onError(e.message); setSheet({ students: [], denied: true }); }
  }, [token, classId, onError]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = sheet?.students || [];
    return needle ? all.filter(s => `${s.name} ${s.index_number}`.toLowerCase().includes(needle)) : all;
  }, [sheet, q]);

  if (sheet === null) return <Card><Skeleton rows={6} height={52} /></Card>;
  if (sheet.denied) {
    return (
      <Card>
        <EmptyState
          icon="bowl" title="Not your sheet"
          message="The canteen sheet belongs to the teacher answerable for the class."
        />
      </Card>
    );
  }

  return (
    <>
      <Grid min={150}>
        <StatCard label="On roll" value={(sheet.students || []).length} icon="users" />
        <StatCard label="Owing" value={sheet.totals?.owing ?? 0} tone={sheet.totals?.owing ? 'warning' : 'success'} icon="alert" />
        <StatCard label="Outstanding" value={money(sheet.totals?.amount || 0)} tone="danger" icon="wallet" />
        {sheet.daily_rate ? <StatCard label="Daily rate" value={money(sheet.daily_rate)} icon="cash" /> : null}
      </Grid>

      <Card><SearchField value={q} onChangeText={setQ} placeholder="Find a pupil" /></Card>

      <Section title="Who owes what" icon="bowl" subtitle={sheet.date}>
        {rows.length === 0 ? <Muted>Nobody matches that.</Muted> : rows.map(s => (
          <ListRow
            key={s.id}
            icon="user" iconTone={s.unpaid_days > 0 ? 'warning' : 'success'}
            title={s.name}
            subtitle={`${s.index_number} · ${s.unpaid_days} unpaid day${s.unpaid_days === 1 ? '' : 's'}`}
            right={
              <Text style={{ ...type.small, fontWeight: '800', color: s.amount_owed > 0 ? colors.danger : colors.success }}>
                {money(s.amount_owed)}
              </Text>
            }
          />
        ))}
      </Section>

      {sheet.stale ? (
        <InfoNote message="Balances are the school's last sync. Money you take here is queued with a reference the school de-duplicates on, so a repeated delivery cannot take it twice." />
      ) : null}
    </>
  );
}

// ── one pupil, several days ─────────────────────────────────────────────────
function OnePupil({ token, classId, canCollect, onError, onSaved, cloud }) {
  const [roll, setRoll] = useState(null);
  const [q, setQ] = useState('');
  const [collecting, setCollecting] = useState(null);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ amount: '', method: 'Cash', notes: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setRoll(null);
    api.students(token, classId, { photos: true })
      .then(r => { if (live) setRoll(r.students || []); })
      .catch(e => { onError(e.message); if (live) setRoll([]); });
    return () => { live = false; };
  }, [token, classId, onError]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = roll || [];
    return needle
      ? all.filter(s => `${s.name || ''} ${s.surname || ''} ${s.first_name || ''} ${s.index_number || ''}`.toLowerCase().includes(needle))
      : all;
  }, [roll, q]);

  const open = useCallback(async (pupil) => {
    setCollecting(pupil); setDetail(null);
    setForm({ amount: '', method: 'Cash', notes: '' });
    try {
      const d = await api.canteenStudent(token, pupil.id);
      setDetail(d);
      setForm(f => ({ ...f, amount: d.amount_owed ? String(d.amount_owed) : '' }));
    } catch (e) { setDetail({ error: e.message }); }
  }, [token]);

  async function collect() {
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) { onError('Enter the amount collected.'); return; }
    setSaving(true); onError(null);
    try {
      const r = await api.canteenCollect(token, {
        student_id: collecting.id, amount, payment_method: form.method, notes: form.notes,
      });
      const name = collecting.name || `${collecting.surname || ''} ${collecting.first_name || ''}`.trim();
      setCollecting(null);
      onSaved(r.receipt_number
        ? `${money(amount)} collected from ${name}. Receipt ${r.receipt_number}.`
        : `${money(amount)} recorded for ${name} and queued — the school issues the receipt when its computer next syncs.`);
    } catch (e) { onError(e.message); }
    finally { setSaving(false); }
  }

  if (roll === null) return <Card><Skeleton rows={6} height={54} /></Card>;

  return (
    <>
      <Card><SearchField value={q} onChangeText={setQ} placeholder="Find a pupil" /></Card>

      <Section title="Collect from one pupil" icon="user" subtitle="For arrears, or a parent paying several days at once.">
        {rows.length === 0 ? <Muted>Nobody matches that.</Muted> : rows.map(s => {
          const name = s.name || `${s.surname || ''} ${s.first_name || ''}`.trim();
          return (
            <ListRow
              key={s.id}
              icon="user" iconTone="primary"
              title={name} subtitle={s.index_number}
              right={canCollect ? <Button size="sm" variant="subtle" title="Collect" full={false} onPress={() => open({ ...s, name })} /> : null}
            />
          );
        })}
      </Section>

      <Sheet
        visible={!!collecting} onClose={() => setCollecting(null)}
        title={collecting ? `Collect from ${collecting.name}` : ''}
        footer={<>
          <Button variant="outline" title="Cancel" onPress={() => setCollecting(null)} full={false} />
          <Button title={saving ? 'Recording…' : 'Record payment'} onPress={collect} busy={saving} full={false} />
        </>}
      >
        {detail === null ? <Skeleton rows={3} /> : detail.error ? <ErrorNote message={detail.error} /> : (
          <>
            <KeyValue items={[
              { label: 'Class', value: detail.student?.class_name },
              { label: 'Unpaid days', value: detail.unpaid_days },
              { label: 'Daily rate', value: detail.daily_rate ? money(detail.daily_rate) : null },
              { label: 'Owed', value: money(detail.amount_owed || 0) },
            ]} />
            <Field
              label="Amount collected" value={form.amount}
              onChangeText={v => setForm(f => ({ ...f, amount: v.replace(/[^0-9.]/g, '') }))}
              keyboardType="numeric" placeholder="0.00" icon="cash"
              hint={detail.daily_rate ? `${money(detail.daily_rate)} covers one day.` : undefined}
            />
            <Select
              label="How it was paid" value={form.method}
              onChange={v => setForm(f => ({ ...f, method: v }))}
              options={METHODS.map(m => ({ value: m, label: m }))}
            />
            <Field label="Note (optional)" value={form.notes} onChangeText={v => setForm(f => ({ ...f, notes: v }))}
              placeholder="Anything the office should know" autoCapitalize="sentences" />
            {cloud ? <InfoNote message="Off the school's network this is queued with a reference the school de-duplicates on, so a repeated delivery cannot take the money twice." /> : null}
          </>
        )}
      </Sheet>
    </>
  );
}

export default function Canteen() {
  return (
    <RequireModule modules={[['canteen', 'view']]}>
      <CanteenScreen />
    </RequireModule>
  );
}
