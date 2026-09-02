// Staff debtors list (fees.view on the host).
import React, { useCallback, useState } from 'react';
import { Text, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/auth';
import { RequireModule } from '../../src/guard';
import { api, money } from '../../src/api';
import { Screen, Card, Muted, Row, Loading, ErrorNote } from '../../src/ui';
import { colors } from '../../src/theme';

function DebtorsScreen() {
  const { token } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { const r = await api.debtors(token); setRows(r.debtors || []); }
    catch (e) { setError(e.message); setRows([]); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (rows === null) return <Loading />;

  const total = rows.reduce((s, r) => s + (r.balance || 0), 0);
  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ErrorNote message={error} />
      <Card>
        <Row left={<Text style={{ fontWeight: '800' }}>Total outstanding</Text>}
          right={<Text style={{ fontWeight: '800', color: colors.danger }}>{money(total)}</Text>} />
        {rows.length === 0 && !error && <Muted>No outstanding balances 🎉</Muted>}
        {rows.map((r, i) => (
          <Row key={i}
            left={<><Text style={{ fontWeight: '600' }}>{r.surname} {r.first_name}</Text><Muted>{r.class_name || ''} · {r.index_number}</Muted></>}
            right={<Text style={{ fontWeight: '700', color: colors.danger }}>{money(r.balance)}</Text>} />
        ))}
      </Card>
    </Screen>
  );
}

// Reachable by URL in the browser build, so the screen guards itself rather
// than relying on the tab bar having hidden it. The server checks the same
// permissions on every request regardless.
export default function Debtors() {
  return (
    <RequireModule modules={[['fees', 'view']]}>
      <DebtorsScreen />
    </RequireModule>
  );
}
