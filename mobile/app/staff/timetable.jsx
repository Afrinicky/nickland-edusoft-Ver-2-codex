// My timetable — the signed-in teacher's week, today first.
import React, { useCallback, useState } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { Screen, Card, H2, Muted, Row, Loading, ErrorNote } from '../../src/ui';
import { colors } from '../../src/theme';

export default function MyTimetable() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { setData(await api.myTimetable(token)); }
    catch (e) { setError(e.message); setData({ days: [], today: null }); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (data === null) return <Loading label="Loading your timetable…" />;

  if (data.has_staff === false) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'My Timetable' }} />
        <Card><Muted>Your account isn't linked to a staff record, so there's no timetable to show. Ask the school office.</Muted></Card>
      </Screen>
    );
  }

  const week = (data.days || []).filter(d => (d.periods || []).length > 0);

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: 'My Timetable' }} />
      <ErrorNote message={error} />

      {data.today && (
        <Card style={{ borderLeftWidth: 4, borderLeftColor: colors.accent }}>
          <H2>Today — {data.today.label}</H2>
          <DayList periods={data.today.periods} emptyText="No lessons scheduled today." />
        </Card>
      )}

      {week.length === 0
        ? <Card><Muted>No lessons are assigned to you yet.</Muted></Card>
        : week.map(d => (
            <Card key={d.value}>
              <H2>{d.label}</H2>
              <DayList periods={d.periods} emptyText="No lessons." />
            </Card>
          ))}
    </Screen>
  );
}

function DayList({ periods, emptyText }) {
  const lessons = (periods || []).filter(p => !p.is_break);
  if (lessons.length === 0) return <Muted>{emptyText}</Muted>;
  return lessons.map((p, i) => (
    <Row key={i}
      left={<>
        <Text style={{ fontWeight: '600' }}>{p.subject_name || 'Lesson'}</Text>
        <Muted>{p.class_name || ''}{p.class_name && p.period_label ? ' · ' : ''}{p.period_label || ''}</Muted>
      </>}
      right={<Muted>{p.start_time}–{p.end_time}</Muted>} />
  ));
}
