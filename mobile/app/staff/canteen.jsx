// Canteen — the morning sheet, and taking the money.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Collecting from one pupil at a time is the phone case, and it was all the app
// had. The sheet is the morning case: who has paid, who has not, and how much
// the class owes between them. It belongs to the class teacher, which the
// server enforces and this screen says plainly rather than offering a list that
// will come back refused.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { useAuth } from '../../src/auth';
import { RequireModule } from '../../src/guard';
import { api, money } from '../../src/api';
import {
  Screen, Card, Section, Heading, Muted, Micro, Button, Badge, Sheet, Field, Select,
  ErrorNote, SuccessNote, InfoNote, Skeleton, EmptyState, ListRow, SearchField,
  Grid, StatCard, KeyValue,
} from '../../src/ui';
import { ClassPicker, useClasses } from '../../src/pickers';
import { useLayout } from '../../src/responsive';
import { colors, spacing, type } from '../../src/theme';

const METHODS = ['Cash', 'Mobile Money', 'Bank'];

function CanteenScreen() {
  const { token, mode, profile } = useAuth();
  const layout = useLayout();
  const { classes } = useClasses(token);

  const [classId, setClassId] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [collecting, setCollecting] = useState(null);   // the pupil being paid for
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ amount: '', method: 'Cash', notes: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (classId == null && classes && classes.length === 1) setClassId(classes[0].id);
  }, [classes, classId]);

  const load = useCallback(async () => {
    if (!classId) return;
    setSheet(null); setError(null);
    try { setSheet(await api.canteenClass(token, classId)); }
    catch (e) { setError(e.message); setSheet({ students: [], denied: true }); }
  }, [token, classId]);

  useEffect(() => { load(); }, [load]);

  const open = useCallback(async (pupil) => {
    setCollecting(pupil); setDetail(null); setSaved(null);
    setForm({ amount: pupil.amount_owed ? String(pupil.amount_owed) : '', method: 'Cash', notes: '' });
    try { setDetail(await api.canteenStudent(token, pupil.id)); }
    catch (e) { setDetail({ error: e.message }); }
  }, [token]);

  async function collect() {
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter the amount collected.'); return; }
    setSaving(true); setError(null);
    try {
      const r = await api.canteenCollect(token, {
        student_id: collecting.id, amount, payment_method: form.method, notes: form.notes,
      });
      setCollecting(null);
      setSaved(r.receipt_number
        ? `${money(amount)} collected from ${collecting.name}. Receipt ${r.receipt_number}.`
        : `${money(amount)} recorded for ${collecting.name} and queued — the school issues the receipt when its computer next syncs.`);
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = sheet?.students || [];
    return needle ? all.filter(s => `${s.name} ${s.index_number}`.toLowerCase().includes(needle)) : all;
  }, [sheet, q]);

  const canCollect = profile?.is_admin || profile?.permissions?.canteen?.canCreate;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ErrorNote message={error} />
      <SuccessNote message={saved} />

      <Card><ClassPicker classes={classes} value={classId} onChange={setClassId} /></Card>

      {!classId ? (
        <Card><EmptyState icon="bowl" title="Choose a class" message="The canteen sheet is the class teacher's — pick the class you are answerable for." /></Card>
      ) : sheet === null ? (
        <Card><Skeleton rows={6} height={52} /></Card>
      ) : sheet.denied ? (
        <Card>
          <EmptyState
            icon="bowl" title="Not your sheet"
            message="The canteen sheet belongs to the teacher answerable for the class. You can still collect from a pupil in a class of yours."
          />
        </Card>
      ) : (
        <>
          <Grid min={150}>
            <StatCard label="On roll" value={(sheet.students || []).length} icon="users" />
            <StatCard label="Owing" value={sheet.totals?.owing ?? 0} tone={sheet.totals?.owing ? 'warning' : 'success'} icon="alert" />
            <StatCard label="Outstanding" value={money(sheet.totals?.amount || 0)} tone="danger" icon="wallet" />
            {sheet.daily_rate ? <StatCard label="Daily rate" value={money(sheet.daily_rate)} icon="bowl" /> : null}
          </Grid>

          <Card><SearchField value={q} onChangeText={setQ} placeholder="Find a pupil" /></Card>

          <Section title="Today's sheet" icon="bowl" subtitle={sheet.date}>
            {rows.length === 0 ? <Muted>Nobody matches that.</Muted> : rows.map(s => (
              <ListRow
                key={s.id}
                icon="user" iconTone={s.unpaid_days > 0 ? 'warning' : 'success'}
                title={s.name}
                subtitle={`${s.index_number} · ${s.unpaid_days} unpaid day${s.unpaid_days === 1 ? '' : 's'}`}
                right={(
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Text style={{ ...type.small, fontWeight: '800', color: s.amount_owed > 0 ? colors.danger : colors.success }}>
                      {money(s.amount_owed)}
                    </Text>
                    {canCollect ? <Button size="sm" variant="subtle" title="Collect" onPress={() => open(s)} full={false} /> : null}
                  </View>
                )}
              />
            ))}
          </Section>

          {sheet.stale ? (
            <InfoNote message="Balances are the school's last sync. Money you take here is queued with a reference the school de-duplicates on, so a repeated delivery cannot take it twice." />
          ) : null}
        </>
      )}

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
              keyboardType="numeric" placeholder="0.00" icon="wallet"
              hint={detail.daily_rate ? `${money(detail.daily_rate)} covers one day.` : undefined}
            />
            <Select
              label="How it was paid" value={form.method}
              onChange={v => setForm(f => ({ ...f, method: v }))}
              options={METHODS.map(m => ({ value: m, label: m }))}
            />
            <Field label="Note (optional)" value={form.notes} onChangeText={v => setForm(f => ({ ...f, notes: v }))}
              placeholder="Anything the office should know" autoCapitalize="sentences" />
          </>
        )}
      </Sheet>
    </Screen>
  );
}

export default function Canteen() {
  return (
    <RequireModule modules={[['canteen', 'view']]}>
      <CanteenScreen />
    </RequireModule>
  );
}
