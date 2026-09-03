// Parent messages — conversations with the school. Host mode can start/reply;
// cloud (internet) mode is read-only for now.
import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, RefreshControl } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { Screen, Card, H2, Muted, Field, Button, Loading, ErrorNote } from '../../src/ui';
import { colors } from '../../src/theme';

export default function Messages() {
  const { token, mode } = useAuth();
  const canWrite = mode !== 'cloud';
  const [threads, setThreads] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [compose, setCompose] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { const r = await api.parentThreads(token); setThreads(r.threads || []); }
    catch (e) { setError(e.message); setThreads([]); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function send() {
    if (!body.trim()) return;
    setSending(true); setError(null);
    try {
      await api.parentSendMessage(token, { subject, body });
      setSubject(''); setBody(''); setCompose(false);
      await load();
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
  }

  if (threads === null) return <Loading label="Loading messages…" />;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ErrorNote message={error} />

      {canWrite ? (
        compose ? (
          <Card>
            <H2>New message to the school</H2>
            <View style={{ marginTop: 8 }}>
              <Field label="Subject (optional)" value={subject} onChangeText={setSubject} autoCapitalize="sentences" />
              <Field label="Message" value={body} onChangeText={setBody} multiline numberOfLines={4} autoCapitalize="sentences" />
            </View>
            <Button title={sending ? 'Sending…' : 'Send'} onPress={send} disabled={sending || !body.trim()} />
            <Button title="Cancel" variant="ghost" onPress={() => setCompose(false)} />
          </Card>
        ) : (
          <Button title="✉️  New message" onPress={() => setCompose(true)} />
        )
      ) : (
        <Card><Muted>You can read the school's messages here. To reply, open the app on the school Wi-Fi.</Muted></Card>
      )}

      {threads.length === 0
        ? <Card><Muted>No conversations yet.</Muted></Card>
        : threads.map(t => (
            <TouchableOpacity key={t.id} onPress={() => router.push(`/parent/message/${t.id}`)}>
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '700', flex: 1 }}>{t.subject || (t.student_name ? `Re: ${t.student_name}` : 'Conversation')}</Text>
                  {t.parent_unread > 0 && (
                    <View style={{ backgroundColor: colors.accent, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 1 }}>
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{t.parent_unread}</Text>
                    </View>
                  )}
                </View>
                <Muted style={{ marginTop: 4 }} >{t.preview}</Muted>
              </Card>
            </TouchableOpacity>
          ))}
    </Screen>
  );
}
