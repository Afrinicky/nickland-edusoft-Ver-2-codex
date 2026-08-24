// Staff account — profile + sign out.
import React from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../src/auth';
import { Screen, Card, H2, Muted, Button } from '../../src/ui';

export default function Account() {
  const { profile, host, signOut, forgetConnection } = useAuth();
  const u = profile?.user || {};
  const perms = profile?.permissions || {};
  const allowed = Object.keys(perms).filter(k => perms[k]?.canView);
  return (
    <Screen>
      <Card>
        <H2>{u.full_name || 'Staff'}</H2>
        <Muted>{profile?.designation || ''}{profile?.is_admin ? ' · Administrator' : ''}</Muted>
        <View style={{ marginTop: 8 }}><Muted>Connected to: {host}</Muted></View>
      </Card>
      <Card>
        <H2>Your access</H2>
        <Muted>{profile?.is_admin ? 'Full access (administrator).' : (allowed.length ? allowed.join(', ') : 'No modules enabled.')}</Muted>
      </Card>
      <Button title="Sign out" variant="danger" onPress={async () => { await signOut(); router.replace('/login'); }} />
      <Button title="Change school" variant="ghost" onPress={async () => { await forgetConnection(); router.replace('/connect'); }} />
    </Screen>
  );
}
