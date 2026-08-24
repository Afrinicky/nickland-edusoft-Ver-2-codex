import React from 'react';
import { Tabs, Redirect } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '../../src/theme';
import { useAuth } from '../../src/auth';
import { Loading } from '../../src/ui';

function Icon({ emoji }) { return <Text style={{ fontSize: 20 }}>{emoji}</Text>; }

export default function StaffLayout() {
  const { ready, token, profile } = useAuth();

  // See the note in ../parent/_layout.jsx: on the web a reload or a bookmarked
  // link mounts a screen before the stored session has been read back.
  if (!ready) return <Loading label="Starting…" />;
  if (!token || !profile) return <Redirect href="/" />;
  if (profile.role === 'parent') return <Redirect href="/parent" />;

  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: colors.primary },
      headerTintColor: '#fff',
      tabBarActiveTintColor: colors.primary,
    }}>
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: () => <Icon emoji="📊" /> }} />
      <Tabs.Screen name="students" options={{ title: 'Students', tabBarIcon: () => <Icon emoji="🧑‍🎓" /> }} />
      <Tabs.Screen name="debtors" options={{ title: 'Debtors', tabBarIcon: () => <Icon emoji="💰" /> }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: () => <Icon emoji="⚙️" /> }} />
      {/* Task screens reached from the dashboard quick actions — not tab bar items. */}
      <Tabs.Screen name="attendance" options={{ href: null, title: 'Attendance' }} />
      <Tabs.Screen name="scores" options={{ href: null, title: 'Enter Scores' }} />
      <Tabs.Screen name="canteen" options={{ href: null, title: 'Canteen' }} />
      <Tabs.Screen name="timetable" options={{ href: null, title: 'My Timetable' }} />
      <Tabs.Screen name="homework" options={{ href: null, title: 'Set Homework' }} />
    </Tabs>
  );
}
