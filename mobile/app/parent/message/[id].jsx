// A single parent↔school conversation.
import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useAuth } from '../../../src/auth';
import { api } from '../../../src/api';
import { Screen, Card, Muted, Field, Button, Loading, ErrorNote } from '../../../src/ui';
import { colors } from '../../../src/theme';

export default function Conversation() {
  const { id } = useLocalSearchParams();
  const { token, mode } = useAuth();
  const canWrite = mode !== 'cloud';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { setData(await api.parentThread(token, id)); }
    catch (e) { setError(e.message); }
  }, [token, id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function send() {
    if (!reply.trim()) return;
    setSending(true); setError(null);
    try {
      await api.parentSendMessage(token, { threadId: id, body: reply });
      setReply(''); await load();
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
  }

  if (!data && !error) return <Loading />;
  if (error && !data) return <Screen><ErrorNote message={error} /></Screen>;

  const t = data?.thread || {};
  return (
    <Screen>
      <Stack.Screen options={{ title: t.subject || 'Conversation' }} />
      <ErrorNote message={error} />
      <Card>
        {(data.messages || []).length === 0 && <Muted>No messages yet.</Muted>}
        {(data.messages || []).map((m, i) => (
          <View key={i} style={{ alignItems: m.sender_type === 'parent' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
            <View style={{ maxWidth: '82%', backgroundColor: m.sender_type === 'parent' ? colors.primary : '#F1F5F9', borderRadius: 12, padding: 10 }}>
              <Text style={{ color: m.sender_type === 'parent' ? '#fff' : colors.text }}>{m.body}</Text>
            </View>
            <Muted style={{ fontSize: 11, marginTop: 2 }}>
              {m.sender_name || (m.sender_type === 'parent' ? 'You' : 'School')} · {String(m.created_at || '').slice(0, 16).replace('T', ' ')}
            </Muted>
          </View>
        ))}
      </Card>

      {canWrite ? (
        <Card>
          <Field label="Reply" value={reply} onChangeText={setReply} multiline numberOfLines={3} autoCapitalize="sentences" />
          <Button title={sending ? 'Sending…' : 'Send reply'} onPress={send} disabled={sending || !reply.trim()} />
        </Card>
      ) : (
        <Card><Muted>To reply, open the app on the school Wi-Fi.</Muted></Card>
      )}
    </Screen>
  );
}
