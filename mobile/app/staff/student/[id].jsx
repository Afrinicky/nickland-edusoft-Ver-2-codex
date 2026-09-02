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
  Screen, Card, Section, Title, Heading, Muted, Micro, Button, Badge, Avatar,
  ErrorNote, InfoNote, Skeleton, EmptyState, ListRow, Grid, StatCard,
  KeyValue, ProgressBar, Divider, Gradient, IconTile,
} from '../../../src/ui';
import { useLayout } from '../../../src/responsive';
import { colors, palette, gradients, spacing, radius, shadow, type } from '../../../src/theme';

function StudentScreen() {
  const { id } = useLocalSearchParams();
  const { token } = useAuth();
  const router = useRouter();
  const layout = useLayout();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useScreenTitle(data?.student?.name || 'Pupil record');

  const load = useCallback(async () => {
    setError(null);
    try { setData(await api.student(token, id)); }
    catch (e) { setError(e.message); setData({ student: null }); }
  }, [token, id]);

  useEffect(() => { load(); }, [load]);

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

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ErrorNote message={error} />

      <Gradient colors={gradients.brand} angle={130} style={[{ borderRadius: radius.lg, padding: spacing.xl }, shadow.raised]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <Avatar name={s.name} size={layout.isPhone ? 54 : 64} tone="chrome" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={2} style={{ color: '#fff', fontSize: layout.isPhone ? 21 : 26, fontWeight: '800', letterSpacing: -0.5 }}>
              {s.name}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 13.5, fontWeight: '600', marginTop: 3 }}>
              {[s.index_number, s.class_name, s.gender].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
      </Gradient>

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
                  <Button
                    size="sm" variant="subtle" title={g.contact} icon="phone" full={false}
                    onPress={() => Linking.openURL(`tel:${String(g.contact).replace(/\s/g, '')}`).catch(() => {})}
                  />
                ) : null}
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
        <Section title="This term's marks" icon="award" subtitle={data.term?.label}>
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
        <Section title="Recent register" icon="calendar">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {(data.recent_attendance || []).map((r, i) => (
              <View key={i} style={{
                paddingHorizontal: 9, paddingVertical: 6, borderRadius: radius.sm,
                backgroundColor: r.status === 'absent' ? palette.red100 : r.status === 'late' ? palette.amber100 : palette.green100,
              }}>
                <Text style={{
                  fontSize: 11.5, fontWeight: '700',
                  color: r.status === 'absent' ? palette.red600 : r.status === 'late' ? palette.amber600 : palette.green600,
                }}>
                  {String(r.date).slice(5)}
                </Text>
              </View>
            ))}
          </View>
        </Section>
      )}

      {data.stale ? (
        <InfoNote message="This is the school's record as of its last sync. It refreshes when the school's computer next connects." />
      ) : null}
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
