import React from 'react';
import { Tabs, Redirect } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '../../src/theme';
import { useAuth } from '../../src/auth';
import { Loading } from '../../src/ui';

function Icon({ emoji }) { return <Text style={{ fontSize: 20 }}>{emoji}</Text>; }

// What you cannot open, you do not see. A tab that leads to "Access denied" is
// worse than no tab: it advertises a part of the school's system to somebody
// who has been told they may not have it, and invites them to keep tapping.
// The same permission map the server enforces decides what is drawn here, so
// the tab bar and the API can never disagree.
function canView(profile, module) {
  if (!profile) return false;
  if (profile.is_admin) return true;
  return !!(profile.permissions || {})[module]?.canView;
}
// `href: null` keeps a screen routable — the dashboard's quick actions and any
// bookmarked URL still reach it — while leaving it out of the tab bar. Hiding
// one that is not permitted has to REMOVE it, so hidden means unreachable.
const hidden = { href: null };

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
      <Tabs.Screen name="index" options={{
        title: 'Dashboard', tabBarIcon: () => <Icon emoji="📊" />,
        // The dashboard is the landing screen, so it stays reachable even
        // without the module: it shows only what the account may see.
      }} />
      <Tabs.Screen name="students" options={canView(profile, 'students')
        ? { title: 'Students', tabBarIcon: () => <Icon emoji="🧑‍🎓" /> }
        : hidden} />
      <Tabs.Screen name="debtors" options={canView(profile, 'fees')
        ? { title: 'Debtors', tabBarIcon: () => <Icon emoji="💰" /> }
        : hidden} />
      {/* Your own account is not a module — everybody has one. */}
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: () => <Icon emoji="⚙️" /> }} />
      {/* Task screens reached from the dashboard quick actions — never tab bar
          items, and only listed at all where the account may use them. */}
      <Tabs.Screen name="attendance" options={{ ...hidden, title: 'Attendance' }} />
      <Tabs.Screen name="scores" options={{ ...hidden, title: 'Enter Scores' }} />
      <Tabs.Screen name="canteen" options={{ ...hidden, title: 'Canteen' }} />
      <Tabs.Screen name="timetable" options={{ ...hidden, title: 'My Timetable' }} />
      <Tabs.Screen name="homework" options={{ ...hidden, title: 'Set Homework' }} />
    </Tabs>
  );
}
