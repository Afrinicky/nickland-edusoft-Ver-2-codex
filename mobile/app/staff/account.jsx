// Staff account — profile, what is still on its way to the school, sign out.
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { Screen, Card, H2, Muted, Button } from '../../src/ui';
import { colors } from '../../src/theme';

export default function Account() {
  const { profile, host, mode, token, signOut, forgetConnection } = useAuth();
  const u = profile?.user || {};
  const perms = profile?.permissions || {};
  const allowed = Object.keys(perms).filter(k => perms[k]?.canView);
  const online = mode === 'cloud';

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

      <Button title="Sign out" variant="danger" onPress={async () => { await signOut(); router.replace('/login'); }} />
      <Button title="Change school" variant="ghost" onPress={async () => { await forgetConnection(); router.replace('/connect'); }} />
    </Screen>
  );
}
