// Results — the broadsheet, a pupil's terminal report, and the remarks that
// go on it.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// What a class teacher checks before reports go out, and the one part of a
// report card that is written rather than computed: conduct, interests,
// talents and the teacher's remark. Those belong to the one person answerable
// for the class, so the server refuses them from anybody else and the screen
// says so rather than offering a form that will be rejected.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { useAuth } from '../../src/auth';
import { RequireModule } from '../../src/guard';
import { api } from '../../src/api';
import {
  Screen, Card, Section, Heading, Title, Body, Muted, Micro, Button, Badge, Sheet,
  Field, TextArea, ErrorNote, Flash, InfoNote, Skeleton, EmptyState,
  DataTable, Grid, StatCard, KeyValue, Divider, SegmentedControl, Tabs, Avatar, Toolbar, Select,
} from '../../src/ui';
import { ClassPicker, useClasses } from '../../src/pickers';
import { useBranding } from '../../src/brand';
import { PrintButton } from '../../src/actions';

import { Bars, Trend, toneForScore as scoreTone } from '../../src/charts';
import { useLayout, pageWidth } from '../../src/responsive';
import { colors, palette, spacing, radius, type } from '../../src/theme';

function grade(score, bands) {
  if (score == null) return null;
  const hit = (bands || []).find(b => score >= b.min_score && score <= b.max_score);
  return hit ? hit.remark : null;
}

function toneFor(score) {
  if (score == null) return 'neutral';
  if (score >= 75) return 'success';
  if (score >= 50) return 'info';
  if (score >= 40) return 'warning';
  return 'danger';
}

function ResultsScreen() {
  const { token, mode } = useAuth();
  const layout = useLayout();
  const brand = useBranding();
  const { classes, error: classError } = useClasses(token);

  const [classId, setClassId] = useState(null);
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [open, setOpen] = useState(null);        // the pupil whose report is open
  const [report, setReport] = useState(null);
  const [remarks, setRemarks] = useState({ conduct: '', interests: '', talents: '', remarks: '' });
  const [savingRemarks, setSavingRemarks] = useState(false);
  const [savedRemarks, setSavedRemarks] = useState(null);
  const [tab, setTab] = useState('report');

  useEffect(() => {
    if (classId == null && classes && classes.length === 1) setClassId(classes[0].id);
  }, [classes, classId]);

  const load = useCallback(async () => {
    if (!classId) return;
    setBoard(null); setError(null);
    try { setBoard(await api.results(token, classId)); }
    catch (e) { setError(e.message); setBoard({ subjects: [], students: [] }); }
  }, [token, classId]);

  useEffect(() => { load(); }, [load]);

  const openReport = useCallback(async (student, termId) => {
    setOpen(student); setReport(null); setSavedRemarks(null); if (!termId) setTab('report');
    try {
      const r = await api.studentReport(token, student.id, termId);
      setReport(r);
      const s = r.summary || {};
      setRemarks({
        conduct: s.conduct_traits || '',
        interests: s.learner_interests || '',
        talents: s.learner_talents || '',
        remarks: s.teacher_remarks || '',
      });
    } catch (e) { setReport({ error: e.message, subjects: [] }); }
  }, [token]);

  async function saveRemarks() {
    setSavingRemarks(true); setSavedRemarks(null);
    try {
      await api.saveRemarks(token, { studentId: open.id, ...remarks });
      setSavedRemarks(mode === 'cloud'
        ? 'Saved and queued — it reaches the school when its computer next syncs.'
        : 'Saved to the report card.');
    } catch (e) { setSavedRemarks(null); setReport(r => ({ ...r, error: e.message })); }
    finally { setSavingRemarks(false); }
  }

  const isClassTeacher = !!(classes || []).find(c => c.id === classId)?.is_class_teacher;
  const subjects = board?.subjects || [];
  const pupils = board?.students || [];
  const withMarks = pupils.filter(p => p.average != null);
  const classAverage = withMarks.length
    ? Math.round((withMarks.reduce((n, p) => n + p.average, 0) / withMarks.length) * 10) / 10
    : null;

  return (
    <Screen variant="full" padded={false} refreshControl={
      <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />
    }>
      <View style={[{ padding: layout.gutter, gap: spacing.md }, subjects.length > 3 ? null : pageWidth(layout)]}>
        <ErrorNote message={classError || error} />

        <Card><ClassPicker classes={classes} value={classId} onChange={setClassId} /></Card>

        {!classId ? (
          <Card><EmptyState icon="award" title="Choose a class" message="The broadsheet shows every pupil against every subject you teach in the class." /></Card>
        ) : board === null ? (
          <Card><Skeleton rows={7} height={44} /></Card>
        ) : pupils.length === 0 ? (
          <Card><EmptyState icon="users" title="Nobody on this roll" message="There are no active pupils in this class." /></Card>
        ) : (
          <>
            <Grid min={150}>
              <StatCard label="On roll" value={pupils.length} icon="users" />
              <StatCard label="With marks" value={withMarks.length} icon="check" />
              <StatCard label="Class average" value={classAverage == null ? '—' : classAverage} tone="data" icon="chart" />
              {board.term ? <StatCard label="Term" value={board.term.label} icon="calendar" /> : null}
            </Grid>

            <Section
              title="Broadsheet" icon="award"
              subtitle={subjects.length ? `${subjects.length} subject${subjects.length === 1 ? '' : 's'} · tap a pupil for their report card` : undefined}
            >
              <DataTable
                onRowPress={openReport}
                keyExtractor={(r) => String(r.id)}
                empty="No marks have been entered for this class yet."
                columns={[
                  { key: 'name', label: 'Pupil', width: layout.isPhone ? undefined : 220 },
                  ...subjects.map(sub => ({
                    key: `s${sub.id}`, label: sub.code || sub.name, align: 'center',
                    render: (r) => {
                      const sc = r.scores[sub.id];
                      const total = sc ? sc.total_score : null;
                      return <Text style={{ ...type.small, fontWeight: '700', color: total == null ? colors.faint : colors.text, fontVariant: ['tabular-nums'] }}>
                        {total == null ? '—' : total}
                      </Text>;
                    },
                  })),
                  {
                    key: 'average', label: 'Average', align: 'right', width: 92,
                    render: (r) => <Badge tone={toneFor(r.average)} label={r.average == null ? '—' : String(r.average)} />,
                  },
                  {
                    key: 'rank', label: 'Position', align: 'right', width: 88,
                    render: (r) => <Text style={{ ...type.small, fontWeight: '700', color: colors.textSoft }}>
                      {r.rank == null ? '—' : `${r.rank}${r.number_on_roll ? ` / ${r.number_on_roll}` : ''}`}
                    </Text>,
                  },
                ]}
                rows={pupils}
              />
            </Section>

            {board.stale ? (
              <InfoNote message="These are the school's figures from its last sync. Marks you enter here are queued and applied when its computer next connects." />
            ) : null}
          </>
        )}
      </View>

      <Sheet
        visible={!!open} onClose={() => setOpen(null)} width={680}
        title={open ? open.name : 'Report'}
        footer={tab === 'remarks' ? (
          <>
            <Button variant="outline" title="Close" onPress={() => setOpen(null)} full={false} />
            <Button
              title={savingRemarks ? 'Saving…' : 'Save remarks'} onPress={saveRemarks}
              busy={savingRemarks} disabled={!isClassTeacher} full={false}
            />
          </>
        ) : (
          <>
            <Button variant="outline" title="Close" onPress={() => setOpen(null)} full={false} />
            <PrintButton
              fetch={() => api.reportCardDocument(token, open.id, report?.term?.id)}
              title="Print report card" variant="primary" size="md"
              disabled={!report || !(report.subjects || []).length}
            />
          </>
        )}
      >
        {report === null ? <Skeleton rows={6} /> : (
          <>
            <ErrorNote message={report.error} />
            <SegmentedControl
              value={tab} onChange={setTab}
              options={[
                { value: 'report', label: 'Report card', icon: 'award' },
                { value: 'remarks', label: 'Remarks', icon: 'note' },
              ]}
            />

            {tab === 'report' ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md }}>
                  <Avatar name={report.student?.name || (open && open.name)} photo={report.student?.photo} size={54} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Heading>{report.student?.name || (open && open.name)}</Heading>
                    <Muted>{[report.student?.index_number, report.student?.class_name].filter(Boolean).join(' · ')}</Muted>
                  </View>
                </View>

                {/* Past terms. A class teacher writing a remark needs to know
                    whether this is a fall or a recovery, and the app has never
                    let them see last term without leaving the sheet. */}
                {(report.terms || []).length > 1 ? (
                  <View style={{ marginBottom: spacing.md }}>
                    <Select
                      label="Term"
                      value={report.term?.id}
                      onChange={(v) => openReport(open, v)}
                      icon="calendar" title="Which term" placeholder="Choose a term"
                      options={(report.terms || []).map(t => ({
                        value: t.id,
                        label: t.label,
                        note: t.average_score != null ? `Average ${Number(t.average_score).toFixed(1)}` : undefined,
                      }))}
                    />
                    <Trend
                      label="Average across terms"
                      points={(report.terms || []).slice().reverse()
                        .filter(t => t.average_score != null)
                        .map(t => ({ label: String(t.label).slice(0, 8), value: t.average_score }))}
                    />
                  </View>
                ) : null}

                <KeyValue items={[
                  { label: 'Index number', value: report.student?.index_number },
                  { label: 'Class', value: report.student?.class_name },
                  { label: 'Term', value: report.term?.label },
                  { label: 'Position', value: report.summary?.class_rank ? `${report.summary.class_rank} of ${report.summary.number_on_roll || '—'}` : null },
                  { label: 'Average', value: report.summary?.average_score != null ? String(report.summary.average_score) : null },
                  {
                    label: 'Attendance',
                    value: report.attendance?.total
                      ? `${report.attendance.present} of ${report.attendance.total} days`
                      : null,
                  },
                ]} />
                <Divider />
                {(report.subjects || []).length > 0 ? (
                  <View style={{ marginBottom: spacing.md }}>
                    <Bars items={(report.subjects || []).map(sub => ({
                      label: sub.subject, value: sub.total_score,
                      note: sub.grade_remark || grade(sub.total_score, report.grading_bands) || undefined,
                    }))} />
                  </View>
                ) : null}
                {(report.subjects || []).length === 0
                  ? <Muted>No marks recorded for this term yet.</Muted>
                  : (report.subjects || []).map((s, i) => (
                      <View key={i} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                          <Text style={{ ...type.body, fontWeight: '700', color: colors.text, flex: 1 }}>{s.subject}</Text>
                          <Badge tone={toneFor(s.total_score)} label={s.total_score == null ? '—' : String(s.total_score)} />
                        </View>
                        <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: 4 }}>
                          <Muted>Class work {s.class_score ?? '—'}</Muted>
                          <Muted>Exam {s.exam_score ?? '—'}</Muted>
                          <Muted>{s.grade_remark || grade(s.total_score, report.grading_bands) || ''}</Muted>
                        </View>
                      </View>
                    ))}
                {report.summary?.teacher_remarks ? (
                  <View style={{ marginTop: spacing.md }}>
                    <Micro>Class teacher's remark</Micro>
                    <Text style={{ ...type.body, color: colors.text, marginTop: 2 }}>{report.summary.teacher_remarks}</Text>
                  </View>
                ) : null}
              </>
            ) : (
              <>
                {!isClassTeacher ? (
                  <InfoNote message="Only the teacher answerable for this class writes its end-of-term remarks. You can read them here." />
                ) : null}
                <TextArea
                  label="Conduct" value={remarks.conduct} numberOfLines={2}
                  onChangeText={v => setRemarks(r => ({ ...r, conduct: v }))}
                  placeholder="How the pupil conducts themselves"
                  editable={isClassTeacher}
                />
                <TextArea
                  label="Interests" value={remarks.interests} numberOfLines={2}
                  onChangeText={v => setRemarks(r => ({ ...r, interests: v }))}
                  placeholder="What they are drawn to"
                  editable={isClassTeacher}
                />
                <TextArea
                  label="Talents" value={remarks.talents} numberOfLines={2}
                  onChangeText={v => setRemarks(r => ({ ...r, talents: v }))}
                  placeholder="What they are good at"
                  editable={isClassTeacher}
                />
                <TextArea
                  label="Class teacher's remark" value={remarks.remarks} numberOfLines={4}
                  onChangeText={v => setRemarks(r => ({ ...r, remarks: v }))}
                  placeholder="The remark printed on the report card"
                  editable={isClassTeacher}
                />
                {/* By the Save button in the sheet footer, which is what the
                    reader is looking at when this appears. */}
                <Flash
                  success={savedRemarks} onClear={() => setSavedRemarks(null)}
                  style={{ marginTop: spacing.sm, marginBottom: 0 }}
                />
              </>
            )}
          </>
        )}
      </Sheet>
    </Screen>
  );
}

export default function Results() {
  return (
    <RequireModule modules={[['academics', 'view']]}>
      <ResultsScreen />
    </RequireModule>
  );
}
