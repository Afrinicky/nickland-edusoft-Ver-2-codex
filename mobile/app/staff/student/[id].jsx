// A pupil's record — what a teacher needs when a parent stops them at the gate.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Who the child is, who to ring, how often they are here, how they are doing,
// what they owe and what homework is outstanding — on one screen. Money is
// shown only to an account with the money modules, and it is omitted rather
// than blanked, so nothing implies a figure is zero when it is simply not
// this teacher's business.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Linking, RefreshControl } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/auth';
import { RequireModule } from '../../../src/guard';
import { useScreenTitle } from '../../../src/shell';
import { api, money } from '../../../src/api';
import {
  Screen, Card, Section, Title, Heading, Body, Muted, Micro, Button, Badge, Avatar,
  ErrorNote, InfoNote, SuccessNote, Skeleton, EmptyState, ListRow, Grid, StatCard,
  KeyValue, ProgressBar, Divider, Gradient, IconTile, Hero, HeroStat, Toolbar, Sheet, Tabs,
  Field, TextArea, Select, DateField,
} from '../../../src/ui';
import { useBranding } from '../../../src/brand';
import { PrintButton } from '../../../src/actions';

import { Bars, Meter, DayStrip, toneForScore } from '../../../src/charts';
import { whatsappHref, telHref, open as openLink } from '../../../src/contact';
import { useLayout } from '../../../src/responsive';
import { colors, palette, gradients, spacing, radius, shadow, type } from '../../../src/theme';

function StudentScreen() {
  const { id } = useLocalSearchParams();
  const { token } = useAuth();
  const router = useRouter();
  const layout = useLayout();
  const brand = useBranding();
  const [data, setData] = useState(null);
  const [report, setReport] = useState(null);
  const [conduct, setConduct] = useState(null);
  const [writing, setWriting] = useState(false);
  const [entry, setEntry] = useState({ eventType: 'achievement', title: '', description: '', date: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useScreenTitle(data?.student?.name || 'Pupil record');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, r, c] = await Promise.all([
        api.student(token, id),
        // The terminal report, so a teacher stopped at the gate can print the
        // child's report card there and then rather than sending the parent to
        // the office. It is allowed to fail on its own: a teacher with the
        // roll but not academics still gets the record.
        api.studentReport(token, id).then(x => x).catch(() => null),
        // Commendations and incidents. Fails on its own — an older school
        // desktop has no such route and the record is still worth showing.
        api.studentEvents(token, id).then(x => x).catch(() => ({ events: [], can_write: false })),
      ]);
      setData(d); setReport(r); setConduct(c);
    } catch (e) { setError(e.message); setData({ student: null }); }
  }, [token, id]);

  useEffect(() => { load(); }, [load]);

  async function saveEntry() {
    if (!entry.title.trim()) { setError('Give the entry a title.'); return; }
    setSaving(true); setError(null);
    try {
      await api.addStudentEvent(token, id, entry);
      setWriting(false);
      setSaved('Recorded. The pupil\u2019s parent can see it in their app.');
      setConduct(await api.studentEvents(token, id).catch(() => conduct));
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  if (data === null) return <Screen><Card><Skeleton rows={3} height={80} /></Card><Card><Skeleton rows={5} /></Card></Screen>;
  if (!data.student) {
    return (
      <Screen>
        <ErrorNote message={error} />
        <Card>
          <EmptyState
            icon="users" title="Not found"
            message="This pupil is not on a roll you teach."
            action={<Button title="Back to the roll" onPress={() => router.replace('/staff/students')} full={false} />}
          />
        </Card>
      </Screen>
    );
  }

  const s = data.student;
  const att = data.attendance || {};
  const rate = att.total ? Math.round(((att.present || 0) / att.total) * 100) : null;

  // The office's own documents, fetched rather than rebuilt — a report card
  // printed at the gate is the report card printed in the office.
  const fetchProfile = () => api.studentProfileDocument(token, id);
  const fetchReport = () => api.reportCardDocument(token, id, report?.term?.id);

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ErrorNote message={error} />
      <SuccessNote message={saved} />

      <Hero
        crest={<Avatar name={s.name} photo={s.photo} size={layout.isPhone ? 58 : 72} tone="chrome" ring />}
        eyebrow={data.term?.label || 'This term'}
        title={s.name}
        subtitle={[s.index_number, s.class_name, s.gender].filter(Boolean).join('  ·  ')}
        right={layout.isPhone ? null : (
          <View style={{ gap: spacing.sm }}>
            {data.summary?.average_score != null
              ? <HeroStat label="Average" value={Number(data.summary.average_score).toFixed(1)}
                  note={data.summary.class_rank ? `Position ${data.summary.class_rank}` : undefined} />
              : null}
            {rate != null ? <HeroStat label="Attendance" value={`${rate}%`} /> : null}
          </View>
        )}
      />

      {/* Everything a teacher is asked for at the gate, in one row: the child's
          report card and their profile sheet, both printed from here. */}
      <Card>
        <Toolbar>
          <PrintButton fetch={fetchProfile} title="Print profile" />
          {report && (report.subjects || []).length ? (
            <PrintButton fetch={fetchReport} title="Print report card" variant="subtle" />
          ) : null}
          <Button
            size="sm" variant="ghost" icon="award" title="Report & remarks" full={false}
            onPress={() => router.push('/staff/results')}
          />
        </Toolbar>
      </Card>

      <Grid min={150}>
        <StatCard label="Days present" value={att.present ?? '—'} tone="success" icon="check" />
        <StatCard label="Days absent" value={att.absent ?? '—'} tone={att.absent ? 'danger' : undefined} icon="alert" />
        {rate != null ? <StatCard label="Attendance" value={`${rate}%`} tone={rate >= 90 ? 'success' : rate >= 75 ? 'warning' : 'danger'} icon="chart" /> : null}
        {data.summary?.average_score != null ? (
          <StatCard label="Term average" value={String(data.summary.average_score)} tone="data" icon="award"
            note={data.summary.class_rank ? `Position ${data.summary.class_rank}${data.summary.number_on_roll ? ` of ${data.summary.number_on_roll}` : ''}` : undefined} />
        ) : null}
      </Grid>

      {/* Contacts first: it is the thing most often needed in a hurry. */}
      <Section title="Who to contact" icon="phone">
        {(data.guardians || []).length === 0
          ? <Muted>No guardian contacts are recorded for this pupil.</Muted>
          : (data.guardians || []).map((g, i) => (
              <ListRow
                key={i} icon="user" iconTone="violet"
                title={g.name || g.relation}
                subtitle={g.name ? g.relation : null}
                right={g.contact ? (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Button
                      size="sm" variant="subtle" title="Call" icon="phone" full={false}
                      onPress={() => openLink(telHref(g.contact))}
                    />
                    <Button
                      size="sm" variant="outline" title="WhatsApp" icon="whatsapp" full={false}
                      onPress={() => openLink(whatsappHref(g.contact,
                        `Good day. This is ${s.class_name || 'the class'} teacher at ${brand.school?.name || 'school'}, about ${s.name}.`))}
                    />
                  </View>
                ) : null}
                meta={<Muted>{g.contact}</Muted>}
              />
            ))}
      </Section>

      <Section title="Details" icon="note">
        <KeyValue items={[
          { label: 'Index number', value: s.index_number },
          { label: 'Class', value: s.class_name },
          { label: 'Date of birth', value: s.date_of_birth },
          { label: 'Age', value: s.age },
          { label: 'Gender', value: s.gender },
          { label: 'Denomination', value: s.denomination },
          { label: 'Lives at', value: s.place_of_residence || s.street_address },
          { label: 'Digital address', value: s.digital_address },
          { label: 'Admitted', value: s.admission_date || s.admission_year },
          { label: 'Status', value: s.status },
        ]} />
      </Section>

      {(data.subjects || []).length > 0 && (
        <Section title="This term's marks" icon="award" subtitle={data.term?.label}
          action={report && (report.subjects || []).length ? <PrintButton fetch={fetchReport} title="Print" /> : null}>
          <View style={{ marginBottom: spacing.lg }}>
            <Bars items={(data.subjects || []).map(sub => ({
              label: sub.subject, value: sub.total_score,
              note: [sub.class_score != null ? `CW ${sub.class_score}` : null,
                sub.exam_score != null ? `Exam ${sub.exam_score}` : null].filter(Boolean).join(' · '),
            }))} />
          </View>
          {(data.subjects || []).map((sub, i) => (
            <View key={i} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text style={{ ...type.body, fontWeight: '700', color: colors.text, flex: 1 }}>{sub.subject}</Text>
                <Badge
                  tone={sub.total_score == null ? 'neutral' : sub.total_score >= 75 ? 'success' : sub.total_score >= 50 ? 'info' : sub.total_score >= 40 ? 'warning' : 'danger'}
                  label={sub.total_score == null ? '—' : String(sub.total_score)}
                />
              </View>
              <Muted style={{ marginTop: 2 }}>
                {[
                  sub.class_score != null ? `Class work ${sub.class_score}` : null,
                  sub.exam_score != null ? `Exam ${sub.exam_score}` : null,
                  sub.grade_remark,
                ].filter(Boolean).join(' · ')}
              </Muted>
            </View>
          ))}
          {data.summary?.teacher_remarks ? (
            <View style={{ marginTop: spacing.md }}>
              <Micro>Class teacher's remark</Micro>
              <Text style={{ ...type.body, color: colors.text, marginTop: 2 }}>{data.summary.teacher_remarks}</Text>
            </View>
          ) : null}
        </Section>
      )}

      <ConductLog
        conduct={conduct}
        onAdd={() => { setSaved(null); setEntry({ eventType: 'achievement', title: '', description: '', date: '' }); setWriting(true); }}
      />

      {(data.homework || []).length > 0 && (
        <Section title="Homework" icon="book">
          {(data.homework || []).slice(0, 10).map((h, i) => (
            <ListRow
              key={h.id ?? i} icon="book"
              iconTone={h.status === 'submitted' ? 'success' : h.status === 'missing' ? 'danger' : 'primary'}
              title={h.title}
              subtitle={[h.subject_name, h.due_date ? `Due ${h.due_date}` : null].filter(Boolean).join(' · ')}
              right={h.marks != null ? <Badge tone="info" label={`${h.marks}${h.max_marks ? `/${h.max_marks}` : ''}`} /> : null}
            />
          ))}
        </Section>
      )}

      {(data.fees || data.canteen) && (
        <Section title="Money" icon="wallet">
          {data.fees ? (
            <View style={{ marginBottom: spacing.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <Muted>School fees</Muted>
                <Text style={{ ...type.body, fontWeight: '800', color: data.fees.balance > 0 ? colors.danger : colors.success }}>
                  {money(data.fees.balance)}{data.fees.balance > 0 ? ' owing' : ' — clear'}
                </Text>
              </View>
              <ProgressBar
                value={data.fees.paid} max={data.fees.billed || 1}
                tone={data.fees.balance > 0 ? 'warning' : 'success'}
                label={`${money(data.fees.paid)} of ${money(data.fees.billed)} paid`}
              />
            </View>
          ) : null}
          {data.canteen ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Muted>Canteen — {data.canteen.unpaid_days} unpaid day{data.canteen.unpaid_days === 1 ? '' : 's'}</Muted>
              <Text style={{ ...type.body, fontWeight: '800', color: data.canteen.amount_owed > 0 ? colors.danger : colors.success }}>
                {money(data.canteen.amount_owed)}
              </Text>
            </View>
          ) : null}
        </Section>
      )}

      {(data.recent_attendance || []).length > 0 && (
        <Section title="Recent register" icon="calendar" subtitle="Most recent first.">
          <View style={{ marginBottom: spacing.md }}>
            <Meter
              value={att.present || 0} total={att.total || 0} label="Attendance this term" goodAbove={90}
              caption={att.total ? `${att.present || 0} present, ${att.absent || 0} absent of ${att.total} days.` : undefined}
            />
          </View>
          <DayStrip days={data.recent_attendance} />
        </Section>
      )}

      {data.stale ? (
        <InfoNote message="This is the school's record as of its last sync. It refreshes when the school's computer next connects." />
      ) : null}

      <Sheet
        visible={writing} onClose={() => setWriting(false)} title={`Record something about ${s.name}`}
        footer={<>
          <Button variant="outline" title="Cancel" onPress={() => setWriting(false)} full={false} />
          <Button title={saving ? 'Saving…' : 'Save entry'} busy={saving} full={false} onPress={saveEntry} />
        </>}
      >
        <Select
          label="What kind of entry" value={entry.eventType}
          onChange={v => setEntry(e => ({ ...e, eventType: v }))}
          icon="note" title="Kind of entry" placeholder="Choose a kind"
          options={[
            { value: 'achievement', label: 'Commendation', icon: 'award', note: 'Something done well' },
            { value: 'misconduct', label: 'Incident', icon: 'alert', note: 'Something that went wrong' },
            { value: 'note', label: 'Note', icon: 'note', note: 'For the record' },
            { value: 'health', label: 'Health', icon: 'shield', note: 'Something the school should watch' },
          ]}
        />
        <Field
          label="Title" value={entry.title} autoCapitalize="sentences"
          onChangeText={v => setEntry(e => ({ ...e, title: v }))}
          placeholder="Won the class spelling bee"
        />
        <TextArea
          label="What happened" value={entry.description} numberOfLines={4} autoCapitalize="sentences"
          onChangeText={v => setEntry(e => ({ ...e, description: v }))}
          placeholder="Anything the parent and the next teacher should know"
        />
        <DateField label="Date" value={entry.date} onChange={v => setEntry(e => ({ ...e, date: v }))}
          hint="Leave blank for today." />
        <InfoNote message="The pupil's parent sees this in their app, so write it as you would say it to them." />
      </Sheet>
    </Screen>
  );
}

export default function Student() {
  return (
    <RequireModule modules={[['students', 'view']]}>
      <StudentScreen />
    </RequireModule>
  );
}


// ── conduct: commendations and incidents ────────────────────────────────────
// Both kinds in one list, in the order they happened. A log that showed only
// the incidents would be a thing families dread opening; one that showed only
// the commendations would be worth nothing to the next teacher.
const CONDUCT = {
  achievement: { label: 'Commendation', icon: 'award', tone: 'success' },
  misconduct: { label: 'Incident', icon: 'alert', tone: 'danger' },
  health: { label: 'Health', icon: 'shield', tone: 'info' },
  note: { label: 'Note', icon: 'note', tone: 'primary' },
};

function ConductLog({ conduct, onAdd }) {
  if (conduct === null) return null;
  const events = conduct.events || [];
  return (
    <Section
      title="Conduct and commendations" icon="shield"
      subtitle="What the school has recorded. The pupil's parent sees the same list."
      action={conduct.can_write
        ? <Button size="sm" icon="plus" title="Add an entry" full={false} onPress={onAdd} />
        : null}
    >
      {events.length === 0 ? (
        <EmptyState
          icon="shield" title="Nothing recorded"
          message={conduct.can_write
            ? 'Record a commendation or an incident and it reaches the parent straight away.'
            : 'Only the teacher answerable for this class records conduct for its pupils.'}
          action={conduct.can_write ? <Button title="Add an entry" icon="plus" full={false} onPress={onAdd} /> : null}
        />
      ) : events.map(e => {
        const k = CONDUCT[e.event_type] || CONDUCT.note;
        return (
          <ListRow
            key={e.id}
            icon={k.icon} iconTone={k.tone}
            title={e.title}
            subtitle={[e.date, e.recorded_by_name].filter(Boolean).join(' · ')}
            badge={<Badge tone={k.tone} label={k.label} />}
            meta={e.description ? <Muted numberOfLines={3}>{e.description}</Muted> : null}
          />
        );
      })}
    </Section>
  );
}
