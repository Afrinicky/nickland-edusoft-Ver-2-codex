import React from 'react';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '../../src/theme';

function Icon({ emoji }) { return <Text style={{ fontSize: 20 }}>{emoji}</Text>; }

export default function StaffLayout() {
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
