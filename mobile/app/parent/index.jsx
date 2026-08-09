// Parent home — list of children with fee + canteen balances.
import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, RefreshControl } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { useAuth } from '../../src/auth';
import { api, money } from '../../src/api';
import { Screen, Card, H2, Muted, Loading, ErrorNote } from '../../src/ui';
import { colors } from '../../src/theme';

export default function Children() {
  const { token } = useAuth();
  const [children, setChildren] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { const r = await api.children(token); setChildren(r.children || []); }
    catch (e) { setError(e.message); setChildren([]); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (children === null) return <Loading label="Loading your children…" />;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ErrorNote message={error} />
      {children.length === 0 && !error && (
        <Card><Muted>No children linked to your account yet. Ask the school to link your child.</Muted></Card>
      )}
      {children.map(c => (
        <TouchableOpacity key={c.id} onPress={() => router.push(`/parent/child/${c.id}`)}>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <H2>{c.name}</H2>
                <Muted>{c.class_name} · {c.index_number}</Muted>
              </View>
              <Text style={{ fontSize: 22 }}>›</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              <Stat label="Fees balance" value={money(c.fees.balance)} tone={c.fees.balance > 0 ? 'danger' : 'success'} />
              <Stat label="Canteen owed" value={money(c.canteen.amount_owed)} tone={c.canteen.amount_owed > 0 ? 'danger' : 'success'} />
            </View>
          </Card>
        </TouchableOpacity>
      ))}
    </Screen>
  );
}

function Stat({ label, value, tone }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, borderRadius: 10, padding: 10 }}>
      <Muted>{label}</Muted>
      <Text style={{ fontSize: 16, fontWeight: '800', color: tone === 'danger' ? colors.danger : colors.success }}>{value}</Text>
    </View>
  );
}
