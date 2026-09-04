// One conversation with a parent — read it, answer it.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../auth';
import { RequireModule } from '../../guard';
import { useScreenTitle } from '../../shell';
import { api } from '../../api';
import {
  Card, Muted, Micro, Button, Badge, Field, ErrorNote, InfoNote,
  Skeleton, EmptyState, PendingBadge,
} from '../../ui';
import { useLayout, pageWidth } from '../../responsive';
import { colors, palette, spacing, radius, type } from '../../theme';

function stamp(v) {
  if (!v) return '';
  const d = new Date(String(v).replace(' ', 'T'));
  return isNaN(d) ? String(v).slice(0, 16) : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function ThreadScreen() {
  const { id } = useLocalSearchParams();
  const { token, profile, mode } = useAuth();
  const router = useRouter();
  const layout = useLayout();
  const scroller = useRef(null);

  const [data, setData] = useState(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useScreenTitle(data?.thread?.subject || 'Conversation');

  const load = useCallback(async () => {
    setError(null);
    try { setData(await api.staffThread(token, id)); }
    catch (e) { setError(e.message); setData({ messages: [] }); }
  }, [token, id]);

  useEffect(() => { load(); }, [load]);

  const canSend = profile?.is_admin || profile?.permissions?.notifications?.canCreate;

  async function send() {
    if (!body.trim()) return;
    setSending(true); setError(null);
    try {
      await api.staffSendMessage(token, { threadId: id, threadUuid: id, body: body.trim() });
      setBody('');
      // Over the internet the reply is queued; reloading shows it back with
      // its "waiting to sync" mark rather than leaving the box looking as if
      // nothing happened.
      await load();
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
  }

  const messages = data?.messages || [];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scroller}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
        contentContainerStyle={[{ padding: layout.gutter, gap: spacing.sm, flexGrow: 1 }, pageWidth(layout, 'reading')]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <ErrorNote message={error} />

        {data === null ? <Card><Skeleton rows={4} /></Card> : (
          <>
            <Card padded>
              <Text style={{ ...type.heading, color: colors.text }}>
                {data.thread?.subject || 'Conversation'}
              </Text>
              <Muted style={{ marginTop: 2 }}>
                {[data.thread?.parent_name, data.thread?.student_name].filter(Boolean).join(' · ') || 'With a parent'}
              </Muted>
            </Card>

            {messages.length === 0 ? (
              <Card><EmptyState icon="chat" title="Nothing here yet" message="This conversation has no messages." /></Card>
            ) : messages.map((m, i) => {
              const mine = m.sender_type === 'staff';
              return (
                <View key={i} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
                  <View style={{
                    maxWidth: '86%',
                    backgroundColor: mine ? colors.primary : colors.card,
                    borderWidth: mine ? 0 : 1, borderColor: colors.border,
                    borderRadius: radius.md,
                    borderBottomRightRadius: mine ? 4 : radius.md,
                    borderBottomLeftRadius: mine ? radius.md : 4,
                    padding: spacing.md,
                  }}>
                    <Text style={{ ...type.body, color: mine ? '#fff' : colors.text }}>{m.body}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <Muted>{m.sender_name || (mine ? 'School' : 'Parent')} · {stamp(m.created_at)}</Muted>
                    {m.pending ? <PendingBadge /> : null}
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      <View style={{
        borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card,
        padding: layout.gutter,
      }}>
        <View style={[{ width: '100%' }, pageWidth(layout, 'reading')]}>
          {canSend ? (
            <>
              <Field
                value={body} onChangeText={setBody}
                placeholder="Write a reply…" multiline numberOfLines={2}
                autoCapitalize="sentences" style={{ marginBottom: 8 }}
              />
              <Button
                title={sending ? 'Sending…' : 'Send reply'} icon="send"
                onPress={send} busy={sending} disabled={!body.trim()}
              />
              <Muted style={{ marginTop: 6 }}>
                {mode === 'cloud'
                  ? 'Queued for the school, which sends it on to the parent when it next syncs.'
                  : "Also sent to the parent's phone by SMS, or their email."}
              </Muted>
            </>
          ) : (
            <InfoNote message="You can read this conversation. Replying needs permission to create notifications." />
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

export default function Thread() {
  return (
    <RequireModule modules={[['notifications', 'view']]}>
      <ThreadScreen />
    </RequireModule>
  );
}
