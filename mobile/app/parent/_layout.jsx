import React from 'react';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '../../src/theme';

function Icon({ emoji }) { return <Text style={{ fontSize: 20 }}>{emoji}</Text>; }

export default function ParentLayout() {
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
