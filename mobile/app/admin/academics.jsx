// How the classes are doing.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The same averages the broadsheet shows, one level up — so a head teacher can
// see which class is behind before the term ends rather than after the reports
// are printed. A class with no marks entered says so rather than showing a
// zero, because a zero here would read as "they all failed".
import React from 'react';
import { View, Text } from 'react-native';
import { api } from '../../src/api';
import { OfficeScreen, useOffice } from '../../src/office';
import { Card, Section, Grid, StatCard, DataTable, Muted, EmptyState, Badge, ProgressBar } from '../../src/ui';
import { colors, spacing, type } from '../../src/theme';

export default function Academics() {
  const state = useOffice((t) => api.adminAcademics(t));
  const d = state.data;
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
