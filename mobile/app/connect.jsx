// Connect screen — enter the school host address (shown on the desktop in
// Settings → Mobile App), verify it, and continue to sign in.
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../src/auth';
import { setBaseUrl, api } from '../src/api';
import { Screen, Card, H1, Muted, Field, Button, ErrorNote } from '../src/ui';
import { colors } from '../src/theme';

export default function Connect() {
  const { saveHost } = useAuth();
  const [url, setUrl] = useState('http://192.168.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [school, setSchool] = useState(null);

  async function verify() {
    setBusy(true); setError(null); setSchool(null);
    const clean = url.trim().replace(/\/+$/, '');
    setBaseUrl(clean);
    try {
      const info = await api.info();
      setSchool(info.school);
      await saveHost(clean);
    } catch (e) {
      setError(e.message || 'Could not reach that address.');
    } finally { setBusy(false); }
  }

  return (
    <Screen>
      <View style={{ alignItems: 'center', marginVertical: 24 }}>
        <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 30 }}>🎓</Text>
        </View>
        <H1>Nickland Edusoft</H1>
        <Muted>Connect to your school</Muted>
      </View>
      <Card>
        <Field label="School address" value={url} onChangeText={setUrl}
          placeholder="http://192.168.1.20:4747" keyboardType="url" autoCorrect={false} />
        <Muted>Ask the school for this address. It's shown on the desktop under Settings → Mobile App when the server is running.</Muted>
        <ErrorNote message={error} />
        {school && (
          <View style={{ marginTop: 12, padding: 12, backgroundColor: '#ECFDF5', borderRadius: 8 }}>
            <Text style={{ fontWeight: '700', color: colors.success }}>✓ Connected to {school.name}</Text>
          </View>
        )}
        {school
          ? <Button title="Continue" onPress={() => router.replace('/login')} />
          : <Button title={busy ? 'Checking…' : 'Connect'} onPress={verify} disabled={busy} />}
      </Card>
    </Screen>
  );
}
