// Messages — the school's conversations with parents.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The parent side of this has been in the app since messaging shipped; the
// staff side existed only on the desktop, so a teacher could be written to and
// had no way to answer. Replies mirror to the parent's SMS or email, exactly as
// one typed at the school would.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../auth';
import { RequireModule } from '../../guard';
import { api } from '../../api';
import {
  Screen, Card, Section, Muted, Badge, SearchField, ErrorNote, InfoNote,
  Skeleton, EmptyState, ListRow, Grid, StatCard,
} from '../../ui';
import { colors, spacing, type } from '../../theme';

function when(v) {
  if (!v) return '';
  const d = new Date(String(v).replace(' ', 'T'));
  if (isNaN(d)) return String(v).slice(0, 16);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function MessagesScreen() {
  const { token, mode } = useAuth();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { setData(await api.staffThreads(token)); }
    catch (e) { setError(e.message); setData({ threads: [] }); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const threads = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = data?.threads || [];
    if (!needle) return all;
    return all.filter(t => `${t.subject || ''} ${t.student_name || ''} ${t.parent_name || ''} ${t.preview || ''}`
      .toLowerCase().includes(needle));
  }, [data, q]);

  const unread = (data?.threads || []).reduce((n, t) => n + (t.staff_unread || 0), 0);

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ErrorNote message={error} />

      {data === null ? <Card><Skeleton rows={5} height={62} /></Card> : (
        <>
          <Grid min={150}>
            <StatCard label="Conversations" value={(data.threads || []).length} icon="chat" />
            {unread > 0 ? <StatCard label="Unread" value={unread} tone="warning" icon="bell" /> : null}
          </Grid>

          <Card><SearchField value={q} onChangeText={setQ} placeholder="Search conversations" /></Card>

          <Section title="Parent conversations" icon="chat">
            {threads.length === 0 ? (
              <EmptyState
                icon="chat" title={q ? 'Nothing matches' : 'No conversations'}
                message={q ? 'Try a pupil or parent name.' : 'When a parent writes to the school, the thread appears here.'}
              />
            ) : threads.map(t => (
              <ListRow
                key={t.id ?? t.uuid}
                icon="chat" iconTone={t.staff_unread ? 'warning' : 'primary'}
                title={t.subject || t.student_name || 'Conversation'}
                subtitle={[t.parent_name, t.student_name].filter(Boolean).join(' · ')}
                badge={t.staff_unread ? <Badge tone="danger" label={String(t.staff_unread)} /> : null}
                meta={t.preview ? <Muted numberOfLines={1}>{t.preview}</Muted> : null}
                right={<Muted>{when(t.last_message_at)}</Muted>}
                onPress={() => router.push(`/app/messages/${t.id ?? t.uuid}`)}
              />
            ))}
          </Section>

          {mode === 'cloud' ? (
            <InfoNote message="Over the internet you can read every conversation and reply to one. Starting a brand new conversation needs the school's own system." />
          ) : null}
        </>
      )}
    </Screen>
  );
}

export default function Messages() {
  return (
    <RequireModule modules={[['notifications', 'view']]}>
      <MessagesScreen />
    </RequireModule>
  );
}
