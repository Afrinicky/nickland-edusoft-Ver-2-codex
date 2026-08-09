// Parent notices — announcements/receipts/reminders sent to this parent.
import React, { useCallback, useState } from 'react';
import { Text, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { Screen, Card, Muted, Loading, ErrorNote } from '../../src/ui';
import { colors } from '../../src/theme';

export default function Notifications() {
  const { token } = useAuth();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { const r = await api.parentNotifications(token); setItems(r.notifications || []); }
    catch (e) { setError(e.message); setItems([]); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (items === null) return <Loading />;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ErrorNote message={error} />
      {items.length === 0 && !error && <Card><Muted>No notices yet.</Muted></Card>}
      {items.map((n, i) => (
        <Card key={i}>
          <Text style={{ color: colors.text }}>{n.message_body}</Text>
          <Muted style={{ marginTop: 6 }}>{n.channel?.toUpperCase()} · {n.sent_at}</Muted>
        </Card>
      ))}
    </Screen>
  );
}
