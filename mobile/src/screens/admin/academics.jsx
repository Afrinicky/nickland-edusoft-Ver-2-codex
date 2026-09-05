// How the classes are doing.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The same averages the broadsheet shows, one level up — so a head teacher can
// see which class is behind before the term ends rather than after the reports
// are printed. A class with no marks entered says so rather than showing a
// zero, because a zero here would read as "they all failed".
import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../api';
import { OfficeScreen, useOffice } from '../../office';
import { Card, Section, Grid, StatCard, DataTable, Muted, EmptyState, Badge, ProgressBar } from '../../ui';
import {
  MetricCard, MetricRow, SectionCard, DashRow, RankRow, AvgBar, QuickAction, CardGrid,
  EmptyLine, rateInk, fullName,
} from '../../dash';
import { useLayout } from '../../responsive';
import { colors, spacing, type } from '../../theme';

export default function Academics() {
  const router = useRouter();
  const layout = useLayout();
  const wide = layout.isDesktop;

  const state = useOffice(async (t) => {
    const [overview, rich] = await Promise.all([
      api.adminAcademics(t),
      wide ? api.dashAcademics(t) : Promise.resolve(null),
    ]);
    return { overview, rich: rich && rich.ok ? rich : null };
  }, [wide]);

  if (state.data && state.data.rich) {
    return (
      <OfficeScreen state={state} skeleton={5}>
        <AcademicsFull d={state.data.rich} classes={state.data.overview?.classes || []} router={router} />
      </OfficeScreen>
    );
  }

  const d = state.data?.overview;
  const classes = d?.classes || [];
  const marked = classes.filter(c => c.entries);

  const average = marked.length
    ? Math.round(marked.reduce((n, c) => n + (c.average || 0), 0) / marked.length * 10) / 10
    : null;

  return (
    <OfficeScreen state={state} skeleton={5}>
      {d ? (
        classes.length === 0 ? (
          <Card><EmptyState icon="trend" title="No classes yet"
            message="Set the school's classes up first." /></Card>
        ) : (
          <>
            <Card tone="primary">
              <Muted>{d.term ? d.term.label : 'No term is running'}</Muted>
            </Card>

            <Grid min={150}>
              <StatCard label="Classes with marks" value={`${marked.length} of ${classes.length}`}
                tone={marked.length === classes.length ? 'success' : 'warning'} icon="layers" />
              {average != null ? (
                <StatCard label="School average" value={String(average)}
                  tone={average >= 60 ? 'success' : average >= 45 ? 'warning' : 'danger'} icon="chart" />
              ) : null}
            </Grid>

            <Section title="Class by class" icon="trend"
              subtitle="Average, pass rate and attendance from the marks and registers already entered.">
              <Card padded={false}>
                <DataTable
                  keyExtractor={(r) => String(r.id)}
                  columns={[
                    { key: 'name', label: 'Class', render: (r) => (
                      <View>
                        <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                          {r.name}
                        </Text>
                        <Muted numberOfLines={1}>
                          {r.entries
                            ? `${r.pupils} pupils · ${r.entries} marks`
                            : `${r.pupils} pupils · no marks entered`}
                        </Muted>
                      </View>
                    ) },
                    { key: 'average', label: 'Average', align: 'right', width: 96,
                      render: (r) => (r.average == null
                        ? <Muted>—</Muted>
                        : <Badge label={String(r.average)}
                            tone={r.average >= 60 ? 'success' : r.average >= 45 ? 'warning' : 'danger'} />) },
                    { key: 'pass_rate', label: 'Passing', align: 'right', width: 96,
                      render: (r) => (r.pass_rate == null ? <Muted>—</Muted> : (
                        <Text style={{ ...type.small, fontWeight: '700', fontVariant: ['tabular-nums'],
                                       color: r.pass_rate >= 70 ? colors.success
                                            : r.pass_rate >= 45 ? colors.warning : colors.danger }}>
                          {`${r.pass_rate}%`}
                        </Text>
                      )) },
                    { key: 'attendance_rate', label: 'Attending', align: 'right', width: 96,
                      render: (r) => (r.attendance_rate == null ? <Muted>—</Muted> : (
                        <Text style={{ ...type.small, fontWeight: '700', fontVariant: ['tabular-nums'],
                                       color: r.attendance_rate >= 90 ? colors.success
                                            : r.attendance_rate >= 75 ? colors.warning : colors.danger }}>
                          {`${r.attendance_rate}%`}
                        </Text>
                      )) },
                  ]}
                  rows={classes} />
              </Card>
            </Section>

            {classes.length - marked.length > 0 ? (
              <Card tone="warning">
                <Text style={{ ...type.body, fontWeight: '700', color: colors.text }}>
                  {`${classes.length - marked.length} class${classes.length - marked.length === 1 ? ' has' : 'es have'} no marks entered`}
                </Text>
                <Muted>
                  That is a question for the teachers, not a result. Nothing is graded until marks
                  are in.
                </Muted>
              </Card>
            ) : null}
          </>
        )
      ) : null}
    </OfficeScreen>
  );
}

// ══ The installed application's Academics → Dashboard ═══════════════════════
//
// Four counts of what has actually been marked, the class averages as a table
// with a bar per row, the term's top ten, and the four things somebody opens
// this module to do.
//
// The averages come from `student_term_summary`, which is what the desktop
// reads and what the broadsheet is compiled from — not from a fresh average of
// the raw marks, which would disagree with the printed reports by whatever the
// weighting rules do.

function AcademicsFull({ d, classes, router }) {
  const m = d.metrics || {};
  const performance = d.class_performance || [];
  const top = d.top_students || [];

  // Classes with no marks at all. The desktop states this on the same screen;
  // it is the difference between "the school is averaging 41" and "two classes
  // have not entered anything yet".
  const unmarked = classes.filter(c => !c.entries).length;

  return (
    <View style={{ width: '100%' }}>
      <MetricRow columns={4}>
        <MetricCard index={0} tone="blue" icon="list"
                    label="Scores Entered" value={m.scores_entered || 0} sub="This term" />
        <MetricCard index={1} tone="green" icon="user" valueTone="success"
                    label="Students Assessed" value={m.students_with_scores || 0}
                    sub="At least one score" />
        <MetricCard index={2} tone="orange" icon="note" valueTone="accent"
                    label="Exam Papers" value={m.exam_papers_total || 0}
                    sub={`${m.exam_papers_published || 0} published, ${m.exam_papers_draft || 0} drafts`}
                    link="Open examinations →"
                    onPress={() => router.push('/app/academics?tab=examinations')} />
        <MetricCard index={3} tone="purple" icon="book"
                    label="Question Bank" value={m.question_bank_size || 0} sub="Questions stored" />
      </MetricRow>

      <DashRow weights={[1.3, 1]}>
        <SectionCard title="Class Performance Averages"
                     right={<Muted>This term</Muted>}>
          {performance.length === 0
            ? <EmptyLine>No class averages computed yet</EmptyLine>
            : <DataTable
                keyExtractor={(r) => String(r.id)}
                columns={[
                  { key: 'class', label: 'Class', render: (r) => (
                    <Text numberOfLines={1} style={{ ...type.small, color: colors.text }}>
                      <Text style={{ fontWeight: '800' }}>{r.short_code}</Text>
                      {` — ${r.class_name}`}
                    </Text>
                  ) },
                  { key: 'students_assessed', label: 'Students Assessed', align: 'right', width: 150 },
                  { key: 'class_average', label: 'Class Average', align: 'right', width: 130,
                    render: (r) => (
                      <Text style={{ ...type.small, fontWeight: '800',
                                     fontVariant: ['tabular-nums'], color: rateInk(r.class_average) }}>
                        {r.class_average == null ? '—' : `${Number(r.class_average).toFixed(1)}%`}
                      </Text>
                    ) },
                  { key: 'bar', label: '', width: 96,
                    render: (r) => <AvgBar value={r.class_average} color={rateInk(r.class_average)} /> },
                ]}
                rows={performance} />}
        </SectionCard>

        <SectionCard title="Top 10 Students This Term">
          {top.length === 0
            ? <EmptyLine>No rankings yet</EmptyLine>
            : top.map((r, i) => (
              <RankRow key={r.student_id} rank={i + 1} name={fullName(r)} meta={r.class_name}
                       score={r.average_score == null ? '—' : `${Number(r.average_score).toFixed(1)}%`}
                       onPress={() => router.push(`/app/students/${r.student_id}`)} />
            ))}
        </SectionCard>
      </DashRow>

      <SectionCard title="Quick Actions">
        <CardGrid min={220}>
          <QuickAction icon="list" label="Enter Class Scores"
                       onPress={() => router.push('/app/academics?tab=classscores')} />
          <QuickAction icon="user" label="View Student Profile"
                       onPress={() => router.push('/app/academics?tab=profile')} />
          <QuickAction icon="note" label="Build New Exam Paper"
                       onPress={() => router.push('/app/academics?tab=examinations')} />
          <QuickAction icon="book" label="Manage Question Bank"
                       onPress={() => router.push('/app/academics?tab=examinations')} />
        </CardGrid>
      </SectionCard>

      {unmarked > 0 ? (
        <Card tone="warning">
          <Text style={{ ...type.body, fontWeight: '700', color: colors.text }}>
            {`${unmarked} class${unmarked === 1 ? ' has' : 'es have'} no marks entered`}
          </Text>
          <Muted>
            That is a question for the teachers, not a result. Nothing is graded until marks
            are in.
          </Muted>
        </Card>
      ) : null}
    </View>
  );
}
