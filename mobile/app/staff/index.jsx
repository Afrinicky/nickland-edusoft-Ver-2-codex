// Staff dashboard — term metrics scoped by the user's permissions.
import React, { useCallback, useState } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/auth';
import { api, money } from '../../src/api';
import { Screen, Card, H2, Muted, Loading, ErrorNote } from '../../src/ui';
import { colors } from '../../src/theme';

export default function Dashboard() {
  const { token, profile } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { setData(await api.dashboard(token)); }
    catch (e) { setError(e.message); setData({ metrics: {} }); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (data === null) return <Loading />;

  const m = data.metrics || {};
  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Card>
        <H2>{profile?.user?.full_name || 'Staff'}</H2>
        <Muted>{profile?.designation || ''}{data.term ? ` · ${data.term.label}` : ''}</Muted>
      </Card>
      <ErrorNote message={error} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <Metric label="Active students" value={m.students ?? '—'} />
        <Metric label="Active staff" value={m.staff ?? '—'} />
        <Metric label="Fees collected" value={m.fees_collected != null ? money(m.fees_collected) : '—'} tone="success" />
        <Metric label="Fees outstanding" value={m.fees_outstanding != null ? money(m.fees_outstanding) : '—'} tone="danger" />
      </View>
    </Screen>
  );
}

function Metric({ label, value, tone }) {
  return (
    <View style={{ flexGrow: 1, minWidth: '45%', backgroundColor: colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.border }}>
      <Muted>{label}</Muted>
      <Text style={{ fontSize: 20, fontWeight: '800', marginTop: 4, color: tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : colors.text }}>{value}</Text>
    </View>
  );
}
