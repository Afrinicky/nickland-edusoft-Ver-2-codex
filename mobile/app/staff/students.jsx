// The roll — every pupil this teacher may see, searchable.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The first version was a flat, unsearchable, untappable list of names. A
// teacher looking up one pupil in a school of six hundred scrolled. This one
// filters by class, searches by name or index number, and opens a record.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth';
import { RequireModule } from '../../src/guard';
import { api } from '../../src/api';
import {
  Screen, Card, Section, Muted, Micro, Badge, SearchField, Select,
  ErrorNote, Skeleton, EmptyState, ListRow, Grid, StatCard, Avatar,
} from '../../src/ui';
import { useClasses } from '../../src/pickers';
import { useLayout } from '../../src/responsive';
import { colors, spacing, type } from '../../src/theme';

function StudentsScreen() {
  const { token } = useAuth();
  const router = useRouter();
  const layout = useLayout();
  const { classes } = useClasses(token);

  const [classId, setClassId] = useState(null);
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    // Photographs are asked for only when one class is selected. A roll of
    // forty faces is a couple of megabytes over the school Wi-Fi; the whole
    // school's six hundred is not something to put on a phone by accident, so
    // "All my classes" gets names and initials.
    try { const r = await api.students(token, classId, { photos: !!classId }); setRows(r.students || []); }
    catch (e) { setError(e.message); setRows([]); }
  }, [token, classId]);

  useEffect(() => { load(); }, [load]);

  // Filtered here rather than round-tripped: the roll a teacher may see is at
  // most a few hundred rows, and typing should not wait on the network.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows || [];
    return (rows || []).filter(s =>
      `${s.name || ''} ${s.surname || ''} ${s.first_name || ''} ${s.index_number || ''}`.toLowerCase().includes(needle));
  }, [rows, q]);

  const byClass = useMemo(() => {
    const map = new Map();
    for (const s of filtered) {
      const k = s.class_name || 'No class';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(s);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ErrorNote message={error} />

      <Card>
        <SearchField value={q} onChangeText={setQ} placeholder="Search by name or index number" />
        {classes && classes.length > 1 ? (
          <View style={{ marginTop: spacing.md }}>
            <Select
              label="Class" value={classId} onChange={v => setClassId(v === classId ? null : v)}
              options={[{ value: null, label: 'All my classes' }, ...classes.map(c => ({
                value: c.id, label: c.name, note: c.is_class_teacher ? 'Class teacher' : undefined,
              }))]}
            />
          </View>
        ) : null}
      </Card>

      {rows === null ? <Card><Skeleton rows={6} height={56} /></Card> : (
        <>
          <Grid min={150}>
            <StatCard label="Pupils you can see" value={rows.length} icon="users" />
            {q ? <StatCard label="Matching" value={filtered.length} tone="data" icon="search" /> : null}
            <StatCard label="Classes" value={(classes || []).length} icon="grid" />
          </Grid>

          {filtered.length === 0 ? (
            <Card>
              <EmptyState
                icon="users"
                title={q ? 'Nobody matches that' : 'Nothing on your roll'}
                message={q
                  ? 'Try part of a surname, or an index number.'
                  : 'No classes are assigned to you yet. Ask the school office to set your teaching assignments.'}
              />
            </Card>
          ) : byClass.map(([className, pupils]) => (
            <Section key={className} title={className} icon="users" subtitle={`${pupils.length} pupil${pupils.length === 1 ? '' : 's'}`}>
              {pupils.map(s => (
                <ListRow
                  key={s.id}
                  title={s.name || `${s.surname || ''} ${s.first_name || ''}`.trim()}
                  subtitle={s.index_number}
                  right={s.gender ? <Badge tone="neutral" label={s.gender} /> : null}
                  onPress={() => router.push(`/staff/student/${s.id}`)}
                  icon="user"
                  avatar={<Avatar name={s.name || `${s.surname || ''} ${s.first_name || ''}`}
                    photo={s.photo} size={38} />}
                />
              ))}
            </Section>
          ))}
        </>
      )}
    </Screen>
  );
}

export default function Students() {
  return (
    <RequireModule modules={[['students', 'view']]}>
      <StudentsScreen />
    </RequireModule>
  );
}
