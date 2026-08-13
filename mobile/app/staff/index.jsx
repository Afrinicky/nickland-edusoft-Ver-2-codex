// Staff dashboard — term metrics + quick actions scoped by the user's permissions.
import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../src/auth';
import { api, money } from '../../src/api';
import { Screen, Card, H2, Muted, Loading, ErrorNote } from '../../src/ui';
import { colors } from '../../src/theme';

// Does the signed-in staff member have `action` on `module`? Admins can do all.
function allowed(profile, module, action) {
  if (!profile) return false;
  if (profile.is_admin) return true;
  const p = profile.permissions?.[module];
  if (!p) return false;
  const map = { view: 'canView', create: 'canCreate', edit: 'canEdit', delete: 'canDelete' };
  return !!p[map[action] || 'canView'];
}

export default function Dashboard() {
  const { token, profile } = useAuth();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { setData(await api.dashboard(token)); }
    catch (e) { setError(e.message); setData({ metrics: {} }); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (data === null) return <Loading />;

  const m = data.metrics || {};
  const actions = [
    { key: 'attendance', label: 'Take Attendance', emoji: '📝', show: allowed(profile, 'students', 'edit') || allowed(profile, 'academics', 'edit') },
    { key: 'scores', label: 'Enter Scores', emoji: '✍️', show: allowed(profile, 'academics', 'edit') },
    { key: 'canteen', label: 'Collect Canteen', emoji: '🍽️', show: allowed(profile, 'canteen', 'create') },
    { key: 'timetable', label: 'My Timetable', emoji: '📅', show: true },
    { key: 'homework', label: 'Set Homework', emoji: '📚', show: allowed(profile, 'academics', 'edit') },
  ].filter(a => a.show);

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Card>
        <H2>{profile?.user?.full_name || 'Staff'}</H2>
        <Muted>{profile?.designation || ''}{data.term ? ` · ${data.term.label}` : ''}</Muted>
      </Card>
      <ErrorNote message={error} />

      {actions.length > 0 && (
        <Card>
          <H2>Quick actions</H2>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
            {actions.map(a => (
              <TouchableOpacity key={a.key} onPress={() => router.push(`/staff/${a.key}`)}
                style={{ flexGrow: 1, minWidth: '45%', backgroundColor: colors.primary, borderRadius: 12, padding: 16, alignItems: 'center' }}>
                <Text style={{ fontSize: 26 }}>{a.emoji}</Text>
                <Text style={{ color: '#fff', fontWeight: '700', marginTop: 6, textAlign: 'center' }}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <Metric label="Active students" value={m.students ?? '—'} />
        <Metric label="Active staff" value={m.staff ?? '—'} />
        <Metric label="Fees collected" value={m.fees_collected != null ? money(m.fees_collected) : '—'} tone="success" />
        <Metric label="Fees outstanding" value={m.fees_outstanding != null ? money(m.fees_outstanding) : '—'} tone="danger" />
      </View>
    </Screen>
  );
}

function Metric({ label, value, tone }) {
  return (
    <View style={{ flexGrow: 1, minWidth: '45%', backgroundColor: colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.border }}>
      <Muted>{label}</Muted>
      <Text style={{ fontSize: 20, fontWeight: '800', marginTop: 4, color: tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : colors.text }}>{value}</Text>
    </View>
  );
}
