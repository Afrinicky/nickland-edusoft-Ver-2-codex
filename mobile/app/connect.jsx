// Connect screen — two ways in:
//   • School Wi-Fi (LAN): enter the desktop host address (Settings → Mobile App).
//   • Over the internet: enter the school's portal address, then pick the school.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../src/auth';
import { setConnection, api } from '../src/api';
import { Screen, Card, H1, H2, Muted, Field, Button, ErrorNote } from '../src/ui';
import { colors } from '../src/theme';

export default function Connect() {
  const { saveHost, saveCloud } = useAuth();
  const [tab, setTab] = useState('lan'); // 'lan' | 'cloud'

  // LAN state
  const [url, setUrl] = useState('http://192.168.');
  const [school, setSchool] = useState(null);

  // Cloud state
  const [cloudUrl, setCloudUrl] = useState('https://');
  const [schools, setSchools] = useState(null);
  const [picked, setPicked] = useState(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function switchTab(t) { setTab(t); setError(null); setSchool(null); setSchools(null); setPicked(null); }

  async function verifyLan() {
    setBusy(true); setError(null); setSchool(null);
    const clean = url.trim().replace(/\/+$/, '');
    setConnection({ baseUrl: clean, mode: 'host' });
    try {
      const info = await api.info();
      setSchool(info.school);
      await saveHost(clean);
    } catch (e) {
      setError(e.message || 'Could not reach that address.');
    } finally { setBusy(false); }
  }

  async function findSchools() {
    setBusy(true); setError(null); setSchools(null); setPicked(null);
    const clean = cloudUrl.trim().replace(/\/+$/, '');
    setConnection({ baseUrl: clean, mode: 'cloud' });
    try {
      const r = await api.schools();
      const list = r.schools || [];
      if (!list.length) setError('No schools are available at that portal yet.');
      setSchools(list);
    } catch (e) {
      setError(e.message || 'Could not reach that portal.');
    } finally { setBusy(false); }
  }

  async function continueCloud() {
    const clean = cloudUrl.trim().replace(/\/+$/, '');
    await saveCloud(clean, picked.school_id);
    router.replace('/login');
  }

  return (
    <Screen>
      <View style={{ alignItems: 'center', marginVertical: 20 }}>
        <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 30 }}>🎓</Text>
        </View>
        <H1>Nickland Edusoft</H1>
        <Muted>Connect to your school</Muted>
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Tab label="School Wi-Fi" active={tab === 'lan'} onPress={() => switchTab('lan')} />
        <Tab label="Over the internet" active={tab === 'cloud'} onPress={() => switchTab('cloud')} />
      </View>

      {tab === 'lan' ? (
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
            : <Button title={busy ? 'Checking…' : 'Connect'} onPress={verifyLan} disabled={busy} />}
        </Card>
      ) : (
        <Card>
          <Field label="Portal address" value={cloudUrl} onChangeText={setCloudUrl}
            placeholder="https://portal.yourschool.com" keyboardType="url" autoCorrect={false} autoCapitalize="none" />
          <Muted>The school's internet portal address. Parents can view fees, results, attendance and receipts from anywhere.</Muted>
          <ErrorNote message={error} />
          {schools && schools.length > 0 && (
            <View style={{ marginTop: 12 }}>
              <H2>Choose your school</H2>
              {schools.map(s => {
                const active = picked?.school_id === s.school_id;
                return (
                  <TouchableOpacity key={s.school_id} onPress={() => setPicked(s)}
                    style={{ marginTop: 8, padding: 12, borderRadius: 10, borderWidth: 1,
                      borderColor: active ? colors.primary : colors.border, backgroundColor: active ? '#EEF2FB' : '#fff' }}>
                    <Text style={{ fontWeight: '700', color: active ? colors.primary : colors.text }}>{s.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          {picked
            ? <Button title={`Continue as ${picked.name}`} onPress={continueCloud} />
            : <Button title={busy ? 'Searching…' : 'Find my school'} onPress={findSchools} disabled={busy} />}
        </Card>
      )}
    </Screen>
  );
}

function Tab({ label, active, onPress }) {
  return (
    <TouchableOpacity onPress={onPress}
      style={{ flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: active ? colors.primary : '#fff', borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );
}
