// The timetable — my week, and any class I teach.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The first version showed the teacher's own week and stopped. A class grid
// exists on the desktop and a teacher covering a colleague's lesson needs it,
// so it is here too — for the classes they may open, and no others.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import {
  Screen, Card, Section, Heading, Muted, Micro, Badge, SegmentedControl,
  ErrorNote, InfoNote, Skeleton, EmptyState, ListRow, Grid, StatCard,
} from '../../src/ui';
import { ClassPicker, useClasses } from '../../src/pickers';
import { useLayout } from '../../src/responsive';
import { colors, palette, spacing, radius, type } from '../../src/theme';

const TODAY = new Date().getDay();

export default function Timetable() {
  const { token, mode } = useAuth();
  const layout = useLayout();
  const { classes } = useClasses(token);

  const [tab, setTab] = useState('mine');
  const [mine, setMine] = useState(null);
  const [classId, setClassId] = useState(null);
  const [grid, setGrid] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadMine = useCallback(async () => {
    setError(null);
    try { setMine(await api.myTimetable(token)); }
    catch (e) { setError(e.message); setMine({ days: [], today: null }); }
  }, [token]);

  const loadClass = useCallback(async () => {
    if (!classId) return;
    setGrid(null); setError(null);
    try { setGrid(await api.classTimetable(token, classId)); }
    catch (e) { setError(e.message); setGrid({ periods: [], days: [], entries: {} }); }
  }, [token, classId]);

  useEffect(() => { loadMine(); }, [loadMine]);
  useEffect(() => { if (tab === 'class') loadClass(); }, [tab, loadClass]);

  const week = (mine?.days || []).filter(d => (d.periods || []).some(p => !p.is_break));
  const lessonsThisWeek = week.reduce((n, d) => n + d.periods.filter(p => !p.is_break).length, 0);

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => {
      setRefreshing(true);
      await (tab === 'mine' ? loadMine() : loadClass());
      setRefreshing(false);
    }} />}>
      <ErrorNote message={error} />

      <Card>
        <SegmentedControl
          value={tab} onChange={setTab}
          options={[
            { value: 'mine', label: 'My week', icon: 'calendar' },
            { value: 'class', label: 'A class', icon: 'grid' },
          ]}
        />
      </Card>

      {tab === 'mine' ? (
        mine === null ? <Card><Skeleton rows={4} height={70} /></Card>
          : mine.has_staff === false ? (
            <Card>
              <EmptyState
                icon="calendar" title="No timetable"
                message="Your account isn't linked to a staff record, so there is no timetable to show. Ask the school office."
              />
            </Card>
          ) : week.length === 0 ? (
            <Card><EmptyState icon="calendar" title="Nothing scheduled" message="No lessons are assigned to you yet." /></Card>
          ) : (
            <>
              <Grid min={150}>
                <StatCard label="Lessons a week" value={lessonsThisWeek} icon="clock" />
                <StatCard label="Teaching days" value={week.length} icon="calendar" />
                <StatCard label="Today" value={mine.today ? mine.today.periods.filter(p => !p.is_break).length : 0} tone="data" icon="check" />
              </Grid>

              {week.map(d => {
                const lessons = (d.periods || []).filter(p => !p.is_break);
                const isToday = d.value === TODAY;
                return (
                  <Section
                    key={d.value} title={d.label} icon="calendar"
                    tone={isToday ? 'accent' : undefined}
                    subtitle={`${lessons.length} lesson${lessons.length === 1 ? '' : 's'}`}
                    action={isToday ? <Badge tone="gold" label="Today" /> : null}
                  >
                    {lessons.map((p, i) => (
                      <ListRow
                        key={i} icon="clock" iconTone={isToday ? 'gold' : 'primary'}
                        title={p.subject_name || 'Lesson'}
                        subtitle={[p.class_name, p.period_label].filter(Boolean).join(' · ')}
                        right={<Text style={{ ...type.small, fontWeight: '700', color: colors.textSoft, fontVariant: ['tabular-nums'] }}>
                          {p.start_time}–{p.end_time}
                        </Text>}
                      />
                    ))}
                  </Section>
                );
              })}
            </>
          )
      ) : (
        <>
          <Card><ClassPicker classes={classes} value={classId} onChange={setClassId} /></Card>
          {mode === 'cloud' ? (
            <InfoNote message="A class grid is read from the school's own system. Connect on the school Wi-Fi to see one; your own week works from anywhere." />
          ) : !classId ? (
            <Card><EmptyState icon="grid" title="Choose a class" message="See the whole week for a class you teach." /></Card>
          ) : grid === null ? (
            <Card><Skeleton rows={5} /></Card>
          ) : (
            <ClassGrid grid={grid} layout={layout} />
          )}
        </>
      )}
    </Screen>
  );
}

function ClassGrid({ grid, layout }) {
  const periods = grid.periods || [];
  const days = grid.days || [];
  const entries = grid.entries || {};
  if (periods.length === 0) {
    return <Card><EmptyState icon="grid" title="No timetable set" message="The school has not built a grid for this class yet." /></Card>;
  }

  return (
    <Section title={grid.class?.name || 'Class timetable'} icon="grid">
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
        <View>
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8 }}>
            <View style={{ width: 108 }}><Micro>Period</Micro></View>
            {days.map(d => (
              <View key={d.value} style={{ width: 132, paddingHorizontal: 5 }}>
                <Micro>{d.label}</Micro>
              </View>
            ))}
          </View>
          {periods.map(p => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 1, borderBottomColor: colors.borderSoft, paddingVertical: 7 }}>
              <View style={{ width: 108, paddingRight: 8 }}>
                <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>{p.label}</Text>
                <Muted>{p.start_time}–{p.end_time}</Muted>
              </View>
              {days.map(d => {
                const cell = entries[`${d.value}:${p.id}`];
                if (p.is_break) {
                  return (
                    <View key={d.value} style={{ width: 132, paddingHorizontal: 5, justifyContent: 'center' }}>
                      <View style={{ backgroundColor: colors.borderSoft, borderRadius: radius.sm, paddingVertical: 8, alignItems: 'center' }}>
                        <Muted>{p.label}</Muted>
                      </View>
                    </View>
                  );
                }
                return (
                  <View key={d.value} style={{ width: 132, paddingHorizontal: 5 }}>
                    {cell ? (
                      <View style={{ backgroundColor: colors.primarySoft, borderRadius: radius.sm, padding: 8 }}>
                        <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.primary }}>
                          {cell.subject_name || 'Lesson'}
                        </Text>
                        {cell.teacher_name ? <Muted numberOfLines={1}>{cell.teacher_name}</Muted> : null}
                      </View>
                    ) : <View style={{ height: 34 }} />}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </Section>
  );
}
