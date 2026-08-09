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
    </Tabs>
  );
}
