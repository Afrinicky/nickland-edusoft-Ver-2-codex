// Staff account — profile, what is still on its way to the school, sign out.
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { Screen, Card, H2, Muted, Button, Field, ErrorNote, InfoNote } from '../../src/ui';
import { colors } from '../../src/theme';

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

  return (
    <Screen>
      <Card>
        <H2>{u.full_name || 'Staff'}</H2>
        <Muted>{profile?.designation || ''}{profile?.is_admin ? ' · Administrator' : ''}</Muted>
        <View style={{ marginTop: 8 }}>
          <Muted>Connected to: {online ? `${profile?.school?.name || 'Nickland Edusoft online'} (internet)` : host}</Muted>
        </View>
      </Card>

      {online && (
        <Card>
          <H2>Reaching the school</H2>
          {waiting === null ? (
            <Muted>Checking…</Muted>
          ) : waiting === 0 ? (
            <Muted>Everything you have entered has reached the school.</Muted>
          ) : (
            <Text style={{ color: colors.primary, fontWeight: '700' }}>
              {waiting} {waiting === 1 ? 'entry is' : 'entries are'} waiting for the school's computer.
            </Text>
          )}
          <Muted style={{ marginTop: 6 }}>
            Your work is saved here the moment you enter it, and lands in the school's records
            the next time its computer syncs. Taking a fee payment is the one thing that needs
            the school itself, because receipts are numbered there.
          </Muted>
        </Card>
      )}

      <Card>
        <H2>Your access</H2>
        <Muted>{profile?.is_admin ? 'Full access (administrator).' : (allowed.length ? allowed.join(', ') : 'No modules enabled.')}</Muted>
      </Card>

      <Card>
        <H2>Your password</H2>
        {forced && !pwDone && (
          <InfoNote message="Your password was set by an administrator. Choose your own before carrying on." />
        )}
        <InfoNote message={pwDone} />
        {changing ? (
          <>
            <Field label="Current password" value={pw.current} onChangeText={v => setP('current', v)}
              secureTextEntry placeholder="The one you signed in with" />
            <Field label="New password" value={pw.next} onChangeText={v => setP('next', v)}
              secureTextEntry placeholder="At least 6 characters" />
            <Field label="Confirm new password" value={pw.confirm} onChangeText={v => setP('confirm', v)}
              secureTextEntry placeholder="Type it again" />
            <ErrorNote message={pwError} />
            <Button title={pwBusy ? 'Saving…' : 'Change password'} onPress={savePassword} disabled={pwBusy} />
            {!forced && <Button title="Cancel" variant="ghost" onPress={() => { setChanging(false); setPwError(null); }} />}
          </>
        ) : (
          <>
            <Muted>Change the password you sign in with.</Muted>
            <Button title="Change password" variant="ghost" onPress={() => { setChanging(true); setPwDone(null); }} />
          </>
        )}
      </Card>

      <Button title="Sign out" variant="danger" onPress={async () => { await signOut(); router.replace('/login'); }} />
      <Button title="Change school" variant="ghost" onPress={async () => { await forgetConnection(); router.replace('/connect'); }} />
    </Screen>
  );
}
