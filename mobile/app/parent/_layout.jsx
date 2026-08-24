import React from 'react';
import { Tabs, Redirect } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '../../src/theme';
import { useAuth } from '../../src/auth';
import { Loading } from '../../src/ui';

function Icon({ emoji }) { return <Text style={{ fontSize: 20 }}>{emoji}</Text>; }

export default function ParentLayout() {
  const { ready, token, profile } = useAuth();

  // On the phone every visit starts at the index gate, which waits for the
  // stored session before routing. In a browser it does not: a reload or a
  // bookmarked link (/parent/child/7) mounts this screen cold, and without
  // this guard the screen fetched with no token and showed "Please sign in."
  // to someone who was signed in perfectly well.
  if (!ready) return <Loading label="Starting…" />;
  if (!token || !profile) return <Redirect href="/" />;
  // A staff member who lands on a parent URL belongs in their own area.
  if (profile.role !== 'parent') return <Redirect href="/staff" />;

  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: colors.primary },
      headerTintColor: '#fff',
      tabBarActiveTintColor: colors.primary,
    }}>
      <Tabs.Screen name="index" options={{ title: 'My Children', tabBarIcon: () => <Icon emoji="👨‍👩‍👧" /> }} />
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarIcon: () => <Icon emoji="💬" /> }} />
      <Tabs.Screen name="notifications" options={{ title: 'Notices', tabBarIcon: () => <Icon emoji="🔔" /> }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: () => <Icon emoji="⚙️" /> }} />
      <Tabs.Screen name="child/[id]" options={{ href: null, title: 'Child' }} />
      <Tabs.Screen name="message/[id]" options={{ href: null, title: 'Conversation' }} />
    </Tabs>
  );
}
