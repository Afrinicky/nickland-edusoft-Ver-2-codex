// Staff students roster (permission-gated on the host).
import React, { useCallback, useState } from 'react';
import { Text, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { Screen, Card, Muted, Row, Loading, ErrorNote } from '../../src/ui';

export default function Students() {
  const { token } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { const r = await api.students(token); setRows(r.students || []); }
    catch (e) { setError(e.message); setRows([]); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (rows === null) return <Loading />;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ErrorNote message={error} />
      <Card>
        {rows.length === 0 && !error && <Muted>No students to show for your access.</Muted>}
        {rows.map(s => (
          <Row key={s.id}
            left={<><Text style={{ fontWeight: '600' }}>{s.surname} {s.first_name}</Text><Muted>{s.index_number}</Muted></>}
            right={<Muted>{s.class_name || ''}</Muted>} />
        ))}
      </Card>
    </Screen>
  );
}
