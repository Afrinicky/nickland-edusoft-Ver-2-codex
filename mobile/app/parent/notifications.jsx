// Notices — what the school has told this parent.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// This screen was a stack of grey boxes containing raw SMS bodies, and it was
// only ever half the story: on the school Wi-Fi it showed the text-message log
// and nothing else, so a notice posted on the desktop reached parents on the
// internet portal and not the ones standing in the school yard. The server now
// merges both; this separates them so a parent can read the school's notices
// without wading through delivery receipts.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import {
  Screen, Card, Section, Heading, Body, Muted, Micro, Badge, Tabs,
  ErrorNote, Skeleton, EmptyState, ListRow, Divider,
} from '../../src/ui';
import { ContactSchool } from '../../src/actions';
import { colors, spacing, type } from '../../src/theme';

const when = (v) => String(v || '').slice(0, 16).replace('T', ' ');

export default function Notifications() {
  const { token } = useAuth();
  const [items, setItems] = useState(null);
  const [tab, setTab] = useState('all');
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { const r = await api.parentNotifications(token); setItems(r.notifications || []); }
    catch (e) { setError(e.message); setItems([]); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const notices = useMemo(() => (items || []).filter(n => n.kind === 'notice' || n.channel === 'notice'), [items]);
  const messages = useMemo(() => (items || []).filter(n => !(n.kind === 'notice' || n.channel === 'notice')), [items]);
  const shown = tab === 'notices' ? notices : tab === 'messages' ? messages : (items || []);

  if (items === null) return <Screen><Card><Skeleton rows={5} height={68} /></Card></Screen>;

  return (
    <Screen refreshControl={
      <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />
    }>
      <ErrorNote message={error} />

      <Card padded={false} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
        <Tabs
          value={tab} onChange={setTab}
          options={[
            { value: 'all', label: 'Everything', icon: 'bell', count: (items || []).length },
            { value: 'notices', label: 'School notices', icon: 'note', count: notices.length },
            { value: 'messages', label: 'Sent to you', icon: 'send', count: messages.length },
          ]}
        />
      </Card>

      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon="bell" title="Nothing yet"
            message="Notices the school posts, and reminders it sends you, appear here."
            action={<ContactSchool variant="subtle" size="sm" title="Message the school" icon="whatsapp" full={false} />}
          />
        </Card>
      ) : (
        <Section title={tab === 'messages' ? 'Sent to you' : tab === 'notices' ? 'School notices' : 'Latest first'} icon="bell">
          {shown.map((n, i) => (
            <View key={n.id ?? i} style={{ paddingVertical: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                {n.title ? (
                  <Text style={{ ...type.body, fontWeight: '700', color: colors.text, flex: 1 }}>{n.title}</Text>
                ) : (
                  <Text style={{ ...type.body, fontWeight: '700', color: colors.text, flex: 1 }}>
                    {n.channel ? String(n.channel).toUpperCase() : 'Message'}
                  </Text>
                )}
                {n.student_name ? <Badge tone="primary" label={n.student_name} /> : null}
                {n.delivery_status && n.delivery_status !== 'sent' ? (
                  <Badge tone={n.delivery_status === 'failed' ? 'danger' : 'neutral'} label={n.delivery_status} />
                ) : null}
              </View>
              <Body style={{ marginTop: 3 }}>{n.body || n.message_body}</Body>
              {(n.at || n.sent_at) ? <Micro style={{ marginTop: 4 }}>{when(n.at || n.sent_at)}</Micro> : null}
              {i < shown.length - 1 ? <Divider /> : null}
            </View>
          ))}
        </Section>
      )}
    </Screen>
  );
}
