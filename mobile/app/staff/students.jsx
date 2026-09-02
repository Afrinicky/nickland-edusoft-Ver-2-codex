// Staff students roster (permission-gated on the host).
import React, { useCallback, useState } from 'react';
import { Text, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/auth';
import { RequireModule } from '../../src/guard';
import { api } from '../../src/api';
import { Screen, Card, Muted, Row, Loading, ErrorNote } from '../../src/ui';

function StudentsScreen() {
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

// Reachable by URL in the browser build, so the screen guards itself rather
// than relying on the tab bar having hidden it. The server checks the same
// permissions on every request regardless.
export default function Students() {
  return (
    <RequireModule modules={[['students', 'view']]}>
      <StudentsScreen />
    </RequireModule>
  );
}
