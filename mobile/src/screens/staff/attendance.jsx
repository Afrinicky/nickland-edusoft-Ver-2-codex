// The register — mark a class for a day, and look back over the ones already
// taken.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Two things the first version could not do, both of which a class teacher does
// weekly: mark a whole class in one action (thirty taps to record a full house
// is why registers get taken late), and look at what was marked last week —
// which is the question a parent asks, and the reason a register gets
// corrected.
//
// A third: say WHY. The office PC's register has always kept a written reason
// against a day, and this one kept none — so a class marked on a phone in the
// corridor reached the office as a column of red with nothing behind it, and
// the head teacher asking on Friday why Ama had missed three days had to ring
// the teacher. The reason box is now here, seeded with whatever is already on
// the record, and it is asked for on a LATE mark as well as an absence: a
// child who arrives at nine has a story, and it is the story that matters when
// the pattern shows up three weeks later.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, RefreshControl } from 'react-native';
import { useAuth } from '../../auth';
import { RequireModule } from '../../guard';
import { api } from '../../api';
import {
  Screen, Card, Section, Heading, Body, Muted, Micro, Button, Badge,
  ErrorNote, Flash, InfoNote, Skeleton, EmptyState, SegmentedControl,
  DataTable, Grid, StatCard, ProgressBar, PendingBadge, Field,
} from '../../ui';
import { ClassPicker, DateStepper, useOfficeClasses, todayISO } from '../../pickers';
import { useLayout } from '../../responsive';
import { colors, palette, spacing, radius, type } from '../../theme';

// The office PC's list, in the office PC's order — see electron/ipc/_attendance.js,
// which is what actually enforces it. Late and Absent both ask why.
const STATUSES = [
  { key: 'present', label: 'Present', color: palette.green600, soft: palette.green100 },
  { key: 'late', label: 'Late', color: palette.amber600, soft: palette.amber100, needsReason: true },
  { key: 'absent', label: 'Absent', color: palette.red600, soft: palette.red100, needsReason: true },
];

const needsReason = (status) => !!(STATUSES.find(s => s.key === status) || {}).needsReason;

function AttendanceScreen() {
  const { token, mode } = useAuth();
  const layout = useLayout();
  const { classes, error: classError } = useOfficeClasses(token);

  const [tab, setTab] = useState('mark');
  const [classId, setClassId] = useState(null);
  const [date, setDate] = useState(todayISO());
  const [roster, setRoster] = useState(null);
  const [marks, setMarks] = useState({});
  // { studentId: 'went to the clinic' } — what is typed against a mark that
  // asks why. Seeded from the record so an existing reason is edited, not
  // silently replaced with a blank.
  const [reasons, setReasons] = useState({});
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // A single class is not a choice. Pre-selecting it saves the most common
  // teacher — one class, one register — a tap every single morning.
  useEffect(() => {
    if (classId == null && classes && classes.length === 1) setClassId(classes[0].id);
  }, [classes, classId]);

  const loadRoster = useCallback(async () => {
    if (!classId || !date) return;
    setRoster(null); setError(null); setSaved(null); setDirty(false);
    try {
      const r = await api.attendanceRoster(token, classId, date);
      setRoster(r.students || []);
      // Everyone starts Present, so a teacher taps only the exceptions.
      setMarks(Object.fromEntries((r.students || []).map(s => [s.id, s.status || 'present'])));
      setReasons(Object.fromEntries((r.students || []).map(s => [s.id, s.notes || ''])));
    } catch (e) { setError(e.message); setRoster([]); }
  }, [token, classId, date]);

  const loadHistory = useCallback(async () => {
    if (!classId) return;
    setHistory(null);
    try { setHistory(await api.attendanceHistory(token, classId, 30)); }
    catch (e) { setError(e.message); setHistory({ days: [], students: [] }); }
  }, [token, classId]);

  useEffect(() => { if (tab === 'mark') loadRoster(); }, [tab, loadRoster]);
  useEffect(() => { if (tab === 'history') loadHistory(); }, [tab, loadHistory]);

  function setAll(status) {
    setMarks(Object.fromEntries((roster || []).map(s => [s.id, status])));
    setDirty(true);
  }
  function setOne(id, status) {
    setMarks(m => ({ ...m, [id]: status }));
    setDirty(true);
  }
  function setReason(id, text) {
    setReasons(r => ({ ...r, [id]: text }));
    setDirty(true);
  }

  // Pupils marked late or absent with nothing written against them. The save
  // is not blocked on it — a register taken at eight o'clock is often taken
  // before anybody knows why a child is missing, and a teacher who cannot save
  // simply does not take the register — but the count is put in front of them,
  // and the boxes stay on screen to be filled in when the note comes in.
  const missingReasons = (roster || []).filter(
    s => needsReason(marks[s.id]) && !String(reasons[s.id] || '').trim());

  async function save() {
    setSaving(true); setError(null); setSaved(null);
    try {
      const payload = Object.entries(marks).map(([student_id, status]) => ({
        student_id: Number(student_id),
        status,
        notes: needsReason(status) ? (String(reasons[student_id] || '').trim() || null) : null,
      }));
      const r = await api.markAttendance(token, date, payload);
      setSaved(mode === 'cloud'
        ? `Register for ${date} saved on this device and queued — it reaches the school when its computer next syncs.`
        : `Register saved — ${r.saved} pupil${r.saved === 1 ? '' : 's'} recorded for ${date}.`);
      setDirty(false);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  const counts = STATUSES.map(s => ({ ...s, n: Object.values(marks).filter(v => v === s.key).length }));
  const total = roster ? roster.length : 0;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => {
      setRefreshing(true);
      await (tab === 'mark' ? loadRoster() : loadHistory());
      setRefreshing(false);
    }} />}>
      <ErrorNote message={classError} />

      <Card>
        <ClassPicker classes={classes} value={classId} onChange={setClassId} />
        {classId ? (
          <SegmentedControl
            value={tab} onChange={setTab}
            options={[
              { value: 'mark', label: 'Take the register', icon: 'check' },
              { value: 'history', label: 'Last 30 days', icon: 'chart' },
            ]}
          />
        ) : null}
      </Card>

      {!classId ? (
        <Card><EmptyState icon="check" title="Choose a class" message="Pick the class whose register you are taking." /></Card>
      ) : tab === 'mark' ? (
        <>
          <Card><DateStepper value={date} onChange={setDate} /></Card>


          {roster === null ? <Card><Skeleton rows={6} height={48} /></Card>
            : roster.length === 0 ? <Card><EmptyState icon="users" title="Nobody on this roll" message="There are no active pupils in this class." /></Card>
              : (
                <>
                  <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
                      <Heading style={{ flex: 1 }}>{total} on roll</Heading>
                      {dirty ? <Badge tone="warning" label="Unsaved" /> : null}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.md }}>
                      {counts.map(c => (
                        <View key={c.key} style={{ flex: 1, backgroundColor: c.soft, borderRadius: radius.sm + 2, padding: 10 }}>
                          <Text style={{ color: c.color, fontWeight: '800', fontSize: 20, fontVariant: ['tabular-nums'] }}>{c.n}</Text>
                          <Text style={{ color: c.color, fontWeight: '700', fontSize: 11.5 }}>{c.label}</Text>
                        </View>
                      ))}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Button size="sm" variant="subtle" title="All present" icon="tick" onPress={() => setAll('present')} />
                      <Button size="sm" variant="outline" title="Clear to absent" onPress={() => setAll('absent')} />
                    </View>
                  </Card>

                  <Card>
                    <Muted style={{ marginBottom: spacing.sm }}>Everyone starts as present. Tap only the exceptions — a late arrival and an absence both ask why.</Muted>
                    {roster.map(s => (
                      <View key={s.id} style={{
                        paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
                        flexDirection: layout.canTable ? 'row' : 'column',
                        alignItems: layout.canTable ? 'center' : 'stretch',
                        gap: layout.canTable ? spacing.md : 8,
                      }}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text numberOfLines={1} style={{ ...type.body, fontWeight: '700', color: colors.text }}>{s.name}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Muted>{s.index_number}</Muted>
                            {s.pending ? <PendingBadge /> : null}
                          </View>
                        </View>
                        <View style={{ flexDirection: 'row', gap: 6, width: layout.canTable ? 300 : undefined }}>
                          {STATUSES.map(st => {
                            const active = marks[s.id] === st.key;
                            return (
                              <TouchableOpacity
                                key={st.key} accessibilityRole="button"
                                accessibilityState={{ selected: active }}
                                accessibilityLabel={`${s.name} ${st.label}`}
                                onPress={() => setOne(s.id, st.key)} activeOpacity={0.8}
                                style={{
                                  flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center',
                                  backgroundColor: active ? st.color : colors.surfaceAlt,
                                  borderWidth: 1, borderColor: active ? st.color : colors.border,
                                }}
                              >
                                <Text style={{ color: active ? '#fff' : colors.muted, fontWeight: '700', fontSize: 13 }}>{st.label}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                        {/* The box appears under the pupil it belongs to, the
                            moment the mark that calls for it is tapped — the
                            teacher is already looking at that row. */}
                        {needsReason(marks[s.id]) ? (
                          <View style={{ width: layout.canTable ? 300 : undefined }}>
                            <Field
                              value={reasons[s.id] || ''}
                              onChangeText={t => setReason(s.id, t)}
                              placeholder={marks[s.id] === 'late' ? 'Why were they late?' : 'Why are they away?'}
                              icon="note"
                              style={{ marginBottom: 0 }}
                              accessibilityLabel={`Reason for ${s.name}`}
                            />
                          </View>
                        ) : null}
                      </View>
                    ))}
                    {missingReasons.length > 0 ? (
                      <InfoNote
                        style={{ marginTop: spacing.md }}
                        message={`${missingReasons.length} pupil${missingReasons.length === 1 ? '' : 's'} marked late or absent with no reason written. You can save now and add the reason when you have it.`}
                      />
                    ) : null}
                    <Flash
                      error={error} success={saved} onClear={() => setSaved(null)}
                      style={{ marginTop: spacing.md, marginBottom: 0 }}
                    />
                    <Button
                      title={saving ? 'Saving…' : `Save register for ${date}`}
                      onPress={save} busy={saving} size="lg" style={{ marginTop: spacing.sm }}
                    />
                  </Card>
                </>
              )}
        </>
      ) : (
        <HistoryPanel history={history} />
      )}
    </Screen>
  );
}

function HistoryPanel({ history }) {
  if (history === null) return <Card><Skeleton rows={5} /></Card>;
  const days = history.days || [];
  const pupils = history.students || [];
  if (days.length === 0) {
    return <Card><EmptyState icon="chart" title="No registers yet" message="Nothing has been marked for this class in the last 30 days." /></Card>;
  }

  const marked = days.length;
  const attendance = days.reduce((n, d) => n + d.present + d.late, 0);
  const possible = days.reduce((n, d) => n + d.total, 0);
  const rate = possible ? Math.round((attendance / possible) * 100) : 0;

  return (
    <>
      <Grid min={150}>
        <StatCard label="Days marked" value={marked} icon="calendar" />
        <StatCard label="Attendance" value={`${rate}%`} tone={rate >= 90 ? 'success' : rate >= 75 ? 'warning' : 'danger'} icon="chart" />
        <StatCard label="Absences" value={days.reduce((n, d) => n + d.absent, 0)} tone="danger" icon="alert" />
      </Grid>

      <Section title="Day by day" icon="calendar" subtitle={history.window_days ? `The projection keeps ${history.window_days} days off-LAN.` : undefined}>
        <DataTable
          keyExtractor={(r) => r.date}
          columns={[
            { key: 'date', label: 'Date' },
            { key: 'present', label: 'Present', align: 'right' },
            { key: 'absent', label: 'Absent', align: 'right' },
            { key: 'late', label: 'Late', align: 'right' },
            {
              key: 'rate', label: 'Rate', align: 'right',
              render: (r) => {
                const pct = r.total ? Math.round(((r.present + r.late) / r.total) * 100) : 0;
                return <Badge tone={pct >= 90 ? 'success' : pct >= 75 ? 'warning' : 'danger'} label={`${pct}%`} />;
              },
            },
          ]}
          rows={days}
        />
      </Section>

      <Section title="Who is missing school" icon="users" subtitle="Ordered by days absent, with the reasons that were given.">
        {pupils.filter(p => p.total > 0).sort((a, b) => b.absent - a.absent).slice(0, 40).map(p => (
          <View key={p.id} style={{ paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text numberOfLines={1} style={{ ...type.body, fontWeight: '700', color: colors.text, flex: 1 }}>{p.name}</Text>
              {p.late ? <Badge tone="warning" label={`${p.late} late`} /> : null}
              <Badge
                tone={p.absent === 0 ? 'success' : p.absent <= 2 ? 'warning' : 'danger'}
                label={`${p.absent} absent`}
              />
            </View>
            <View style={{ marginTop: 6 }}>
              <ProgressBar
                value={p.present + p.late} max={p.total || 1}
                tone={p.total && (p.present + p.late) / p.total >= 0.9 ? 'success' : 'warning'}
              />
            </View>
            {/* Why, in the teacher's own words — the half of the register that
                used to be thrown away between the classroom and the office. */}
            {(p.reasons || []).length > 0 ? (
              <View style={{ marginTop: 7, gap: 3 }}>
                {p.reasons.map(r => (
                  <View key={`${r.date}-${r.status}`} style={{ flexDirection: 'row', gap: 6, alignItems: 'baseline' }}>
                    <Micro color={r.status === 'late' ? palette.amber600 : palette.red600}>
                      {r.date.slice(5)} {r.status}
                    </Micro>
                    <Muted style={{ flex: 1 }} numberOfLines={2}>{r.reason}</Muted>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ))}
      </Section>
    </>
  );
}

// Reachable by URL in the browser build, so the screen guards itself rather
// than relying on the navigation having hidden it. The server checks the same
// permissions on every request regardless.
export default function Attendance() {
  return (
    <RequireModule modules={[['students', 'view'], ['academics', 'view']]}>
      <AttendanceScreen />
    </RequireModule>
  );
}
