// Connect screen — two ways in, and the split is NOT "on Wi-Fi" vs "off it":
//
//   • My school — the school's own system, whether that is its address on the
//     school Wi-Fi (http://192.168.1.20:4747) or an internet address that
//     reaches the same desktop through a tunnel (https://…). Everything works
//     either way: teachers mark registers and enter scores, parents pay.
//   • Parent portal — the hosted portal. Parents only, read-only, because the
//     cloud holds a thin read model rather than the school's database.
//
// Framing these as "Wi-Fi" and "internet" was wrong, and it hid the path
// teachers actually need: a teacher working from home enters the school's
// internet address here, in the first tab, and has their full job.
//
// In a browser most people never see this screen at all — the app is served by
// the host or the portal, so the connection is adopted from the page's own
// origin (see src/origin.js). It appears when a portal hosts several schools,
// when someone changes school, and always on the phone app.
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../src/auth';
import { setConnection, api } from '../src/api';
import { Screen, Card, H1, H2, Muted, Field, Button, ErrorNote } from '../src/ui';
import { colors } from '../src/theme';
import { isWeb } from '../src/storage';
import { webOrigin, isSecureOrigin } from '../src/origin';

export default function Connect() {
  const { saveHost, saveCloud, detectedSchools } = useAuth();
  const [tab, setTab] = useState(detectedSchools ? 'cloud' : 'school');

  // School-address state. In a browser already sitting on a plain-HTTP
  // address, that address is almost certainly the school host, so start there.
  const originGuess = isWeb && !isSecureOrigin() ? webOrigin() : null;
  const [url, setUrl] = useState(originGuess || 'http://192.168.');
  const [school, setSchool] = useState(null);

  // Cloud state
  const [cloudUrl, setCloudUrl] = useState(detectedSchools ? detectedSchools.baseUrl : 'https://');
  const [schools, setSchools] = useState(detectedSchools ? detectedSchools.schools : null);
  const [picked, setPicked] = useState(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // A browser on HTTPS refuses plain-HTTP requests as mixed content, so a LAN
  // address typed here can never work from a page served over HTTPS. Say so
  // up front instead of letting the fetch fail with a bare network error.
  const httpsBlocksLan = isWeb && isSecureOrigin();

  useEffect(() => {
    if (detectedSchools) {
      setTab('cloud');
      setCloudUrl(detectedSchools.baseUrl);
      setSchools(detectedSchools.schools);
    }
  }, [detectedSchools]);

  function switchTab(t) { setTab(t); setError(null); setSchool(null); setPicked(null); if (!detectedSchools) setSchools(null); }

  // A page on HTTPS cannot reach a plain-HTTP address on the local network —
  // the browser blocks it as mixed content. An https:// school address (a
  // tunnel to the desktop) is fine, so this is a warning, not a locked door.
  const lanBlocked = httpsBlocksLan && /^http:\/\//i.test(url.trim());

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
        <Tab label="My school" active={tab === 'school'} onPress={() => switchTab('school')} />
        <Tab label="Parent portal" active={tab === 'cloud'} onPress={() => switchTab('cloud')} />
      </View>

      {tab === 'school' ? (
        <Card>
          <Field label="School address" value={url} onChangeText={setUrl}
            placeholder="http://192.168.1.20:4747" keyboardType="url" autoCorrect={false} autoCapitalize="none" />
          <Muted>
            On the school Wi-Fi, the address the desktop shows under Settings → Mobile App.
            Away from school, the school's internet address if it has one. Teachers need this
            one — marking registers, entering scores and collecting canteen money all run on
            the school's own system.
          </Muted>
          {lanBlocked && (
            <View style={{ marginTop: 12, padding: 12, backgroundColor: '#FFFBEB', borderRadius: 8 }}>
              <Text style={{ color: colors.text, fontSize: 13 }}>
                This page is on a secure (https) address, and browsers block secure pages from
                reaching a plain http address on the local network. Either open the school's
                address directly in your browser, or use the school's https address.
              </Text>
            </View>
          )}
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
          {detectedSchools ? (
            <>
              <H2>Choose your school</H2>
              <Muted>You are on {shortHost(detectedSchools.baseUrl)}. Pick the school your child attends.</Muted>
            </>
          ) : (
            <>
              <Field label="Portal address" value={cloudUrl} onChangeText={setCloudUrl}
                placeholder="https://portal.yourschool.com" keyboardType="url" autoCorrect={false} autoCapitalize="none" />
              <Muted>
                The school's hosted portal. Parents can view fees, results, attendance and
                receipts from anywhere. Staff sign-in is not here — teachers use "My school".
              </Muted>
            </>
          )}
          <ErrorNote message={error} />
          {schools && schools.length > 0 && (
            <View style={{ marginTop: 12 }}>
              {!detectedSchools && <H2>Choose your school</H2>}
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
            : (!detectedSchools && <Button title={busy ? 'Searching…' : 'Find my school'} onPress={findSchools} disabled={busy} />)}
        </Card>
      )}
    </Screen>
  );
}

function shortHost(u) {
  return String(u || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function Tab({ label, active, onPress }) {
  return (
    <TouchableOpacity onPress={onPress}
      style={{ flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: active ? colors.primary : '#fff', borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );
}
