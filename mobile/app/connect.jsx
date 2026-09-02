// Connect screen — two ways in, and the split is NOT "on Wi-Fi" vs "off it":
//
//   • My school — the school's own system, whether that is its address on the
//     school Wi-Fi (http://192.168.1.20:4747) or an internet address that
//     reaches the same desktop through a tunnel (https://…). Everything works,
//     immediately, but the school's computer has to be switched on.
//   • Nickland Edusoft online — the hosted service. Teachers and parents both
//     sign in, and it answers whether or not the school's computer is on.
//     Teachers' registers, scores, canteen collections and homework are queued
//     and reach the school when it next syncs; taking a fee payment still
//     needs the school itself, because receipts are numbered there.
//
// Framing these as "Wi-Fi" and "internet" was wrong, and it hid the path
// teachers need most: neither tab is parents-only.
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
import {
  Screen, Card, Title, Heading, Muted, Field, Button, ErrorNote,
  SuccessNote, WarningNote, SegmentedControl, ListRow, Gradient, IconTile,
} from '../src/ui';
import { Icon } from '../src/icons';
import { colors, palette, gradients, spacing, radius, shadow, type } from '../src/theme';
import { useLayout } from '../src/responsive';
import { isWeb } from '../src/storage';
import { webOrigin, isSecureOrigin } from '../src/origin';

export default function Connect() {
  const { saveHost, saveCloud, detectedSchools } = useAuth();
  const layout = useLayout();
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
    <Screen variant="reading">
      <Gradient colors={gradients.chrome} angle={145} style={[{ borderRadius: radius.lg, padding: spacing.xl, marginBottom: spacing.sm }, shadow.raised]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{
            width: 46, height: 46, borderRadius: 15,
            backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="school" size={24} color={palette.gold400} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: layout.isPhone ? 20 : 24, letterSpacing: -0.4 }}>
              Nickland Edusoft
            </Text>
            <Text style={{ color: colors.onChromeMuted, fontSize: 13, fontWeight: '600' }}>
              Connect to your school
            </Text>
          </View>
        </View>
      </Gradient>

      <SegmentedControl
        value={tab} onChange={switchTab}
        options={[
          { value: 'school', label: 'My school', icon: 'pin' },
          { value: 'cloud', label: 'Online', icon: 'grid' },
        ]}
      />

      {tab === 'school' ? (
        <Card>
          <Field label="School address" value={url} onChangeText={setUrl}
            placeholder="http://192.168.1.20:4747" keyboardType="url" autoCorrect={false} autoCapitalize="none" />
          <Muted>
            On the school Wi-Fi, the address the desktop shows under Settings → Mobile App.
            Away from school, the school's internet address if it has one. Everything works
            straight away here — but only while the school's computer is switched on. If it
            is off, use Online.
          </Muted>
          {lanBlocked && (
            <WarningNote message="This page is on a secure (https) address, and browsers block secure pages from reaching a plain http address on the local network. Either open the school's address directly in your browser, or use the school's https address." />
          )}
          <ErrorNote message={error} />
          {school && <SuccessNote message={`Connected to ${school.name}.`} />}
          {school
            ? <Button title="Continue" onPress={() => router.replace('/login')} size="lg" iconRight="chevron" />
            : <Button title={busy ? 'Checking…' : 'Connect'} onPress={verifyLan} busy={busy} size="lg" />}
        </Card>
      ) : (
        <Card>
          {detectedSchools ? (
            <>
              <Heading>Choose your school</Heading>
              <Muted style={{ marginBottom: spacing.sm }}>You are on {shortHost(detectedSchools.baseUrl)}. Pick your school.</Muted>
            </>
          ) : (
            <>
              <Field label="Portal address" value={cloudUrl} onChangeText={setCloudUrl}
                placeholder="https://portal.yourschool.com" keyboardType="url" autoCorrect={false} autoCapitalize="none" />
              <Muted>
                Works whether or not the school's computer is on. Parents see fees, results,
                attendance and receipts; teachers mark registers, enter scores, collect
                canteen money and set homework, and the work reaches the school when it next
                syncs.
              </Muted>
            </>
          )}
          <ErrorNote message={error} />
          {schools && schools.length > 0 && (
            <View style={{ marginTop: 12 }}>
              {!detectedSchools && <Heading>Choose your school</Heading>}
              {schools.map(s => {
                const active = picked?.school_id === s.school_id;
                return (
                  <TouchableOpacity key={s.school_id} onPress={() => setPicked(s)} activeOpacity={0.8}
                    style={{
                      marginTop: 8, padding: 14, borderRadius: radius.md, borderWidth: 1,
                      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primarySoft : colors.card,
                    }}>
                    <IconTile name="school" size={34} tone={active ? 'primary' : 'primary'} />
                    <Text style={{ ...type.body, fontWeight: '700', color: active ? colors.primary : colors.text, flex: 1 }}>{s.name}</Text>
                    {active ? <Icon name="tick" size={17} color={colors.primary} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          {picked
            ? <Button title={`Continue as ${picked.name}`} onPress={continueCloud} size="lg" iconRight="chevron" />
            : (!detectedSchools && <Button title={busy ? 'Searching…' : 'Find my school'} onPress={findSchools} busy={busy} size="lg" />)}
        </Card>
      )}
    </Screen>
  );
}

function shortHost(u) {
  return String(u || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
}
