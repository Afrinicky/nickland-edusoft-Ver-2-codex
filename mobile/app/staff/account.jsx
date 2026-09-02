// Staff account — profile, what is still on its way to the school, sign out.
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import {
  Screen, Card, Section, Heading, Muted, Micro, Button, Badge, Field,
  ErrorNote, InfoNote, SuccessNote, Grid, StatCard, Avatar, KeyValue, Divider,
} from '../../src/ui';
import { colors, spacing, type } from '../../src/theme';

export default function Account() {
  const { profile, host, mode, token, signOut, forgetConnection } = useAuth();
  const params = useLocalSearchParams();
  const u = profile?.user || {};
  const perms = profile?.permissions || {};
  const allowed = Object.keys(perms).filter(k => perms[k]?.canView);
  const online = mode === 'cloud';

  // Arrives set when sign-in found a password an administrator had chosen. The
  // panel opens on its own and says why, rather than leaving the teacher to
  // find it.
  const forced = String(params.changePassword || '') === '1' || !!profile?.must_change_password;
  const [changing, setChanging] = useState(forced);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState(null);
  const [pwDone, setPwDone] = useState(null);
  const setP = (k, v) => setPw(p => ({ ...p, [k]: v }));

  async function savePassword() {
    setPwError(null);
    if (!pw.current) { setPwError('Enter your current password.'); return; }
    if (pw.next.length < 6) { setPwError('New password must be at least 6 characters.'); return; }
    if (pw.next !== pw.confirm) { setPwError('The two new passwords do not match.'); return; }
    setPwBusy(true);
    try {
      await api.changePassword(token, { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      setPwDone(online
        ? 'Password changed. It works here straight away and reaches the school at the next sync.'
        : 'Password changed.');
      setChanging(false);
    } catch (e) {
      setPwError(e.message || 'Could not change your password.');
    } finally { setPwBusy(false); }
  }

  // Signed in over the internet, work is queued rather than saved outright.
  // A teacher who has just marked a register deserves to be told plainly
  // whether it has reached the school — not left to wonder.
  const [waiting, setWaiting] = useState(null);
  useEffect(() => {
    let live = true;
    if (!online || !token) return undefined;
    api.staffPending(token)
      .then(r => { if (live) setWaiting(r.pending || 0); })
      .catch(() => {});
    return () => { live = false; };
  }, [online, token]);

  // A module map is not a sentence. "Students, Academics, Canteen" reads as a
  // list of what this account can open, which is the question being asked.
  const MODULE_NAMES = {
    dashboard: 'Overview', students: 'Students', academics: 'Academics',
    fees: 'Fees', canteen: 'Canteen', staff: 'Staff', payroll: 'Payroll',
    finance: 'Finance', notifications: 'Messages & notices', settings: 'Settings',
  };

  return (
    <Screen variant="reading">
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <Avatar name={u.full_name} size={54} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ ...type.title, color: colors.text }}>{u.full_name || 'Staff'}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
              <Muted>{profile?.designation || 'Staff'}</Muted>
              {profile?.is_admin ? <Badge tone="gold" label="Administrator" /> : null}
              <Badge tone={online ? 'data' : 'success'} label={online ? 'Over the internet' : 'On the school network'} />
            </View>
          </View>
        </View>
        <Divider />
        <KeyValue items={[
          { label: 'Username', value: u.username },
          { label: online ? 'School' : 'Address', value: online ? (profile?.school?.name || 'Nickland Edusoft online') : host },
        ]} />
      </Card>

      {online && (
        <Section title="Reaching the school" icon="refresh">
          {waiting === null ? (
            <Muted>Checking…</Muted>
          ) : waiting === 0 ? (
            <SuccessNote message="Everything you have entered has reached the school." />
          ) : (
            <InfoNote message={`${waiting} ${waiting === 1 ? 'entry is' : 'entries are'} waiting for the school's computer.`} />
          )}
          <Muted style={{ marginTop: spacing.sm }}>
            Your work is saved the moment you enter it and lands in the school's records the next
            time its computer syncs. Taking a fee payment is the one thing that needs the school
            itself, because receipts are numbered there.
          </Muted>
        </Section>
      )}

      <Section title="What you can open" icon="grid">
        {profile?.is_admin ? (
          <Muted>Full access — an administrator is not restricted anywhere.</Muted>
        ) : allowed.length === 0 ? (
          <Muted>No modules are enabled for your account. Ask the school office.</Muted>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {allowed.map(k => <Badge key={k} tone="primary" label={MODULE_NAMES[k] || k} />)}
          </View>
        )}
      </Section>

      <Section title="Your password" icon="wallet">
        {forced && !pwDone && (
          <InfoNote message="Your password was set by an administrator. Choose your own before carrying on." />
        )}
        <SuccessNote message={pwDone} />
        {changing ? (
          <>
            <Field label="Current password" value={pw.current} onChangeText={v => setP('current', v)}
              secureTextEntry placeholder="The one you signed in with" />
            <Field label="New password" value={pw.next} onChangeText={v => setP('next', v)}
              secureTextEntry placeholder="At least 6 characters" />
            <Field label="Confirm new password" value={pw.confirm} onChangeText={v => setP('confirm', v)}
              secureTextEntry placeholder="Type it again" />
            <ErrorNote message={pwError} />
            <Button title={pwBusy ? 'Saving…' : 'Change password'} onPress={savePassword} busy={pwBusy} />
            {!forced && <Button title="Cancel" variant="ghost" onPress={() => { setChanging(false); setPwError(null); }} />}
          </>
        ) : (
          <>
            <Muted>Change the password you sign in with.</Muted>
            <Button title="Change password" variant="outline" icon="gear"
              onPress={() => { setChanging(true); setPwDone(null); }} style={{ marginTop: spacing.sm }} />
          </>
        )}
      </Section>

      <Card>
        <Button title="Sign out" variant="danger" icon="logout"
          onPress={async () => { await signOut(); router.replace('/login'); }} />
        <Button title="Change school or address" variant="ghost"
          onPress={async () => { await forgetConnection(); router.replace('/connect'); }} />
      </Card>
    </Screen>
  );
}
