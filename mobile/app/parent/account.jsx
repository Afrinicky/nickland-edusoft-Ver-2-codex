// Parent account — profile + sign out.
import React from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../src/auth';
import { Screen, Card, H2, Muted, Button } from '../../src/ui';

export default function Account() {
  const { profile, host, signOut } = useAuth();
  const p = profile?.parent || {};
  return (
    <Screen>
      <Card>
        <H2>{p.full_name || 'Parent'}</H2>
        <Muted>{p.phone || ''}{p.email ? ` · ${p.email}` : ''}</Muted>
        <View style={{ marginTop: 8 }}><Muted>Connected to: {host}</Muted></View>
      </Card>
      <Card>
        <Muted>Update your contact details or documents from the school's student portal on the web, or ask the school office.</Muted>
      </Card>
      <Button title="Sign out" variant="danger" onPress={async () => { await signOut(); router.replace('/login'); }} />
    </Screen>
  );
}
