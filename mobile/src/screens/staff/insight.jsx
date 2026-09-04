// Class insight — how the class is doing, and how to reach its parents.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Three questions a class teacher is asked every term and had no way to answer
// from the app:
//
//   Which subjects is this class weak in? The broadsheet has every mark in it
//   and answers nothing at a glance — forty rows by nine columns is data, not
//   an answer. This averages it.
//
//   Who is slipping? Attendance and marks both, ranked, so the three children
//   who need a word are at the top of the screen rather than somewhere in a
//   scroll.
//
//   How do I reach a parent? One request for the whole class's contacts, and a
//   WhatsApp or a call straight from the row. Before this a teacher opened one
//   pupil's record at a time and copied the number by hand.
//
// Everything here is computed from what the school already holds. Nothing on
// this screen writes.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../auth';
import { RequireModule } from '../../guard';
import { useBranding } from '../../brand';
import { api, money } from '../../api';
import {
  Screen, Card, Section, Heading, Body, Muted, Micro, Button, Badge, Tabs, Avatar,
  ErrorNote, InfoNote, Skeleton, EmptyState, ListRow, Grid, StatCard, SearchField,
  DataTable, Divider, Toolbar,
} from '../../ui';
import { ClassPicker, useClasses } from '../../pickers';
import { Bars, Meter, Trend, toneForScore } from '../../charts';
import { whatsappHref, telHref, mailHref, open as openLink } from '../../contact';
import { useLayout } from '../../responsive';
import { colors, palette, spacing, type } from '../../theme';

function InsightScreen() {
  const { token, profile, mode } = useAuth();
  const layout = useLayout();
  const router = useRouter();
  const brand = useBranding();
  const { classes } = useClasses(token);

  const [classId, setClassId] = useState(null);
  const [tab, setTab] = useState('performance');
  const [board, setBoard] = useState(null);
  const [history, setHistory] = useState(null);
  const [contacts, setContacts] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (classId == null && classes && classes.length) {
      const mine = classes.find(c => c.is_class_teacher) || classes[0];
      setClassId(mine.id);
    }
  }, [classes, classId]);

  const load = useCallback(async () => {
    if (!classId) return;
    setError(null); setBoard(null); setHistory(null); setContacts(null);
    const settle = (p, f) => p.then(r => r).catch(() => f);
    const [b, h, c] = await Promise.all([
      settle(api.results(token, classId), { subjects: [], students: [], denied: true }),
      settle(api.attendanceHistory(token, classId, 60), { days: [], students: [], denied: true }),
      settle(api.classContacts(token, classId), { students: [], denied: true }),
    ]);
    setBoard(b); setHistory(h); setContacts(c);
  }, [token, classId]);

  useEffect(() => { load(); }, [load]);

  return (
    <Screen refreshControl={
      <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />
    }>
      <ErrorNote message={error} />

      <Card><ClassPicker classes={classes} value={classId} onChange={setClassId} /></Card>

      <Card padded={false} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
        <Tabs
          value={tab} onChange={setTab}
          options={[
            { value: 'performance', label: 'Performance', icon: 'trend' },
            { value: 'attendance', label: 'Attendance', icon: 'check' },
            { value: 'contacts', label: 'Parents', icon: 'phone' },
          ]}
        />
      </Card>

      {!classId ? (
        <Card><EmptyState icon="grid" title="Choose a class" message="Pick one of your classes to see how it is doing." /></Card>
      ) : tab === 'performance' ? (
        <Performance board={board} onOpen={(id) => router.push(`/app/students/${id}`)} layout={layout} />
      ) : tab === 'attendance' ? (
        <Attendance history={history} onOpen={(id) => router.push(`/app/students/${id}`)} layout={layout} />
      ) : (
        <Contacts contacts={contacts} school={brand.school?.name} cloud={mode === 'cloud'}
          onOpen={(id) => router.push(`/app/students/${id}`)} />
      )}
    </Screen>
  );
}

// ── how the class is doing ──────────────────────────────────────────────────
function Performance({ board, onOpen, layout }) {
  if (board === null) return <Card><Skeleton rows={6} height={54} /></Card>;
  if (board.denied) {
    return <Card><EmptyState icon="award" title="Not yours to read" message="Marks for this class belong to the teachers assigned to it." /></Card>;
  }

  const subjects = board.subjects || [];
  const pupils = board.students || [];
  const withMarks = pupils.filter(p => p.average != null);

  // A class average per subject, and the count of pupils below the pass mark:
  // the two figures a head teacher asks a class teacher for.
  const bySubject = subjects.map(sub => {
    const marks = pupils
      .map(p => (p.scores && p.scores[sub.id] ? p.scores[sub.id].total_score : null))
      .filter(v => v != null);
    const avg = marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : null;
    return {
      id: sub.id,
      label: sub.name || sub.code,
      value: avg == null ? null : Math.round(avg * 10) / 10,
      failing: marks.filter(v => v < 40).length,
      marked: marks.length,
    };
  }).sort((a, b) => (b.value ?? -1) - (a.value ?? -1));

  const classAverage = withMarks.length
    ? Math.round((withMarks.reduce((n, p) => n + p.average, 0) / withMarks.length) * 10) / 10
    : null;
  const struggling = withMarks.filter(p => p.average < 45).sort((a, b) => a.average - b.average);
  const top = withMarks.slice().sort((a, b) => b.average - a.average).slice(0, 5);

  if (!pupils.length) {
    return <Card><EmptyState icon="users" title="Nobody on this roll" message="There are no active pupils in this class." /></Card>;
  }

  return (
    <>
      <Grid min={150}>
        <StatCard label="On roll" value={pupils.length} icon="users" />
        <StatCard label="With marks" value={withMarks.length} icon="check"
          note={pupils.length ? `${Math.round((withMarks.length / pupils.length) * 100)}% entered` : undefined} />
        <StatCard label="Class average" value={classAverage ?? '—'} tone="data" icon="chart" />
        <StatCard label="Below 45" value={struggling.length} tone={struggling.length ? 'warning' : 'success'} icon="alert" />
      </Grid>

      {bySubject.some(s => s.value != null) ? (
        <Section title="Average by subject" icon="chart" subtitle="Where the class is strong, and where it is not.">
          <Bars items={bySubject.map(s => ({
            label: s.label, value: s.value,
            note: s.marked ? `${s.marked} marked${s.failing ? ` · ${s.failing} below 40` : ''}` : 'no marks',
          }))} />
        </Section>
      ) : (
        <Card><EmptyState icon="chart" title="No marks entered yet" message="Averages appear here once marks have been entered for the class." /></Card>
      )}

      {struggling.length ? (
        <Section
          title="Pupils to look at" icon="alert"
          subtitle="Averaging below 45. Worth a word before the end of term."
        >
          {struggling.slice(0, 10).map(p => (
            <ListRow
              key={p.id} icon="user" iconTone="warning"
              title={p.name} subtitle={p.index_number}
              right={<Badge tone={toneForScore(p.average)} label={String(Math.round(p.average * 10) / 10)} />}
              onPress={() => onOpen(p.id)}
            />
          ))}
        </Section>
      ) : null}

      {top.length ? (
        <Section title="Top of the class" icon="award">
          {top.map((p, i) => (
            <ListRow
              key={p.id} icon={i === 0 ? 'award' : 'user'} iconTone={i === 0 ? 'gold' : 'primary'}
              title={p.name}
              subtitle={[p.index_number, p.rank ? `Position ${p.rank}` : null].filter(Boolean).join(' · ')}
              right={<Badge tone={toneForScore(p.average)} label={String(Math.round(p.average * 10) / 10)} />}
              onPress={() => onOpen(p.id)}
            />
          ))}
        </Section>
      ) : null}
    </>
  );
}

// ── who is missing school ───────────────────────────────────────────────────
function Attendance({ history, onOpen, layout }) {
  if (history === null) return <Card><Skeleton rows={6} height={54} /></Card>;
  if (history.denied) {
    return <Card><EmptyState icon="check" title="Not yours to read" message="The register for this class belongs to the teachers assigned to it." /></Card>;
  }

  const days = history.days || [];
  const pupils = (history.students || []).map(p => ({
    ...p,
    rate: p.total ? Math.round((p.present / p.total) * 100) : null,
  }));
  const marked = history.marked_days || days.length;
  const totals = days.reduce((a, d) => ({
    present: a.present + d.present, absent: a.absent + d.absent, late: a.late + d.late, total: a.total + d.total,
  }), { present: 0, absent: 0, late: 0, total: 0 });

  const worrying = pupils.filter(p => p.rate != null && p.rate < 85).sort((a, b) => a.rate - b.rate);

  // The last three weeks of school days, as a rate per day. A Friday the whole
  // class misses is a fact about the timetable, not about the children.
  const trend = days.slice(0, 15).reverse()
    .filter(d => d.total)
    .map(d => ({ label: String(d.date).slice(5), value: Math.round((d.present / d.total) * 100) }));

  if (!marked) {
    return <Card><EmptyState icon="calendar" title="Nothing marked" message="No register has been taken for this class in the last 60 days." /></Card>;
  }

  return (
    <>
      <Grid min={150}>
        <StatCard label="Days marked" value={marked} icon="calendar" />
        <StatCard label="Attendances" value={totals.present} tone="success" icon="check" />
        <StatCard label="Absences" value={totals.absent} tone={totals.absent ? 'danger' : undefined} icon="alert" />
        <StatCard label="Late" value={totals.late} tone={totals.late ? 'warning' : undefined} icon="clock" />
      </Grid>

      <Section title="Class attendance" icon="chart" subtitle="Across the days the register was taken.">
        <Meter
          value={totals.present} total={totals.total} label="Present" goodAbove={90}
          caption={`${totals.present} attendances of ${totals.total} marks over ${marked} day${marked === 1 ? '' : 's'}.`}
        />
        {trend.length > 1 ? (
          <View style={{ marginTop: spacing.xl }}>
            <Trend points={trend} label="Attendance rate, day by day" suffix="%" min={0} max={100} />
          </View>
        ) : null}
      </Section>

      {worrying.length ? (
        <Section title="Below 85%" icon="alert" subtitle="Worth raising with a parent.">
          {worrying.slice(0, 12).map(p => (
            <ListRow
              key={p.id} icon="user" iconTone={p.rate < 70 ? 'danger' : 'warning'}
              title={p.name}
              subtitle={`${p.present} present · ${p.absent} absent · ${p.late} late of ${p.total}`}
              right={<Badge tone={p.rate < 70 ? 'danger' : 'warning'} label={`${p.rate}%`} />}
              onPress={() => onOpen(p.id)}
            />
          ))}
        </Section>
      ) : (
        <Card tone="success">
          <Heading>Nobody below 85%</Heading>
          <Muted style={{ marginTop: 4 }}>Every pupil on this roll is attending well.</Muted>
        </Card>
      )}
    </>
  );
}

// ── the class's contact book ────────────────────────────────────────────────
function Contacts({ contacts, school, cloud, onOpen }) {
  const [q, setQ] = useState('');

  if (cloud) {
    return (
      <Card>
        <EmptyState
          icon="phone" title="Contacts stay at the school"
          message="Guardian phone numbers are read from the school's own system rather than projected over the internet. Open the app on the school Wi-Fi to use the contact book."
        />
      </Card>
    );
  }
  if (contacts === null) return <Card><Skeleton rows={6} height={64} /></Card>;
  if (contacts.denied) {
    return (
      <Card>
        <EmptyState
          icon="phone" title="Not available to your account"
          message="Contacting parents is a permission of its own. Ask the school office if you need it."
        />
      </Card>
    );
  }

  const needle = q.trim().toLowerCase();
  const rows = (contacts.students || []).filter(s =>
    !needle || `${s.name} ${s.index_number}`.toLowerCase().includes(needle));

  return (
    <>
      <Card>
        <SearchField value={q} onChangeText={setQ} placeholder="Find a pupil" />
      </Card>

      <InfoNote message="These are the contacts the school office holds. If a number is wrong, the office corrects it — the app shows what they have." />

      {rows.length === 0 ? (
        <Card><EmptyState icon="phone" title="Nobody matches that" message="Try part of a surname or an index number." /></Card>
      ) : rows.map(s => (
        <Card key={s.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Avatar name={s.name} photo={s.photo} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ ...type.body, fontWeight: '700', color: colors.text }}>{s.name}</Text>
              <Muted numberOfLines={1}>{s.index_number}</Muted>
            </View>
            <Button size="sm" variant="ghost" title="Record" full={false} onPress={() => onOpen(s.id)} />
          </View>

          {(s.guardians || []).length === 0 && (s.accounts || []).length === 0 ? (
            <Muted style={{ marginTop: spacing.md }}>No contact recorded for this pupil.</Muted>
          ) : (
            <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
              {(s.guardians || []).map((g, i) => (
                <ContactRow
                  key={`g${i}`} label={g.relation} name={g.name} value={g.contact}
                  message={`Good day${g.name ? ` ${g.name}` : ''}. This is ${school || 'the school'}, about ${s.name}.`}
                />
              ))}
              {(s.accounts || []).map((a, i) => (
                <ContactRow
                  key={`a${i}`} label="App account" name={a.full_name} value={a.phone} email={a.email}
                  message={`Good day${a.full_name ? ` ${a.full_name}` : ''}. This is ${school || 'the school'}, about ${s.name}.`}
                />
              ))}
            </View>
          )}
        </Card>
      ))}
    </>
  );
}

function ContactRow({ label, name, value, email, message }) {
  if (!value && !email) return null;
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap',
      paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.borderSoft,
    }}>
      <View style={{ flex: 1, minWidth: 140 }}>
        <Micro>{label}</Micro>
        <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text, marginTop: 1 }}>
          {name || '—'}
        </Text>
        <Muted numberOfLines={1}>{value || email}</Muted>
      </View>
      <Toolbar>
        {value ? <Button size="sm" variant="subtle" icon="phone" title="Call" full={false} onPress={() => openLink(telHref(value))} /> : null}
        {value ? <Button size="sm" variant="outline" icon="whatsapp" title="WhatsApp" full={false} onPress={() => openLink(whatsappHref(value, message))} /> : null}
        {email ? <Button size="sm" variant="ghost" icon="mail" title="Email" full={false} onPress={() => openLink(mailHref(email, 'From the school', message))} /> : null}
      </Toolbar>
    </View>
  );
}

export default function Insight() {
  return (
    <RequireModule modules={[['academics', 'view'], ['students', 'view']]}>
      <InsightScreen />
    </RequireModule>
  );
}
