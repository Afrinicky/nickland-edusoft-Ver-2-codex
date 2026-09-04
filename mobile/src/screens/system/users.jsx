// Accounts.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Three things the system will not let you do, and each is here because the
// alternative is a school locked out of itself: you cannot deactivate the
// account you are signed in with, you cannot take the administrator role off
// the last account that has it, and a password you set for somebody else must
// be changed by them before they can do anything.
import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { OfficeScreen, shortDate, useOffice } from '../../office';
import {
  Card, Section, Grid, StatCard, SearchField, DataTable, Muted, EmptyState, Badge,
  Button, Sheet, Field, Select, ErrorNote, Divider,
} from '../../ui';
import { colors, spacing, type } from '../../theme';

export default function Users() {
  const { token, profile } = useAuth();
  const state = useOffice((t) => api.systemUsers(t));
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(null);
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const d = state.data;
  const me = profile?.user?.id;

  const rows = useMemo(() => {
    const list = d?.users || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(u => `${u.full_name || ''} ${u.username || ''} ${u.designation || ''}`
      .toLowerCase().includes(needle));
  }, [d, q]);

  async function create() {
    setError(null);
    if (!username.trim() || !fullName.trim()) return setError("A username and the person's name are required.");
    if (password.length < 8) return setError('A password must be at least 8 characters.');
    setBusy(true);
    try {
      await api.systemCreateUser(token, {
        username: username.trim().toLowerCase(), fullName: fullName.trim(),
        full_name: fullName.trim(), password,
        designationId: designationId ? Number(designationId) : undefined,
        designation_id: designationId ? Number(designationId) : undefined,
      });
      setDone(`${username.trim()} created. They must change the password before they can do anything.`);
      setCreating(false); setUsername(''); setFullName(''); setPassword(''); setDesignationId('');
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function setStatus(user, active) {
    setError(null);
    try {
      await api.systemUserStatus(token, user.id, active);
      setManaging(null);
      state.reload();
    } catch (e) { setError(e.message); }
  }

  async function setRole(user, id) {
    setError(null);
    try {
      await api.systemUserRole(token, user.id, Number(id));
      setManaging(null);
      state.reload();
    } catch (e) { setError(e.message); }
  }

  return (
    <OfficeScreen state={state} skeleton={6}>
      <ErrorNote message={error} />
      {done ? (
        <Card tone="success">
          <Text style={{ ...type.small, fontWeight: '700', color: colors.text }}>{done}</Text>
          <Button label="Done" tone="ghost" size="sm" onPress={() => setDone(null)} />
        </Card>
      ) : null}

      <Card><Button label="Create an account" icon="plus" onPress={() => { setError(null); setCreating(true); }} /></Card>

      {d ? (
        <>
          <Grid min={150}>
            <StatCard label="Accounts" value={d.users.length} tone="data" icon="users" />
            <StatCard label="Deactivated" tone="neutral" icon="lock"
              value={d.users.filter(u => !u.is_active).length} />
          </Grid>

          <Card><SearchField value={q} onChangeText={setQ} placeholder="Find an account" /></Card>

          <Section title="Accounts" icon="users">
            <DataTable
              keyExtractor={(u) => String(u.id)}
              empty="Nobody matches that."
              onRowPress={(u) => { setError(null); setManaging(u); }}
              columns={[
                { key: 'full_name', label: 'Person', render: (u) => (
                  <View>
                    <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700',
                      color: u.is_active ? colors.text : colors.faint }}>
                      {u.full_name}
                    </Text>
                    <Muted numberOfLines={1}>
                      {[u.username, u.designation].filter(Boolean).join(' · ')}
                    </Muted>
                  </View>
                ) },
                { key: 'last_login', label: 'Last in', width: 110,
                  render: (u) => (u.last_login ? shortDate(u.last_login) : <Muted>Never</Muted>) },
                { key: 'state', label: '', align: 'right', width: 128,
                  render: (u) => (
                    <View style={{ flexDirection: 'row', gap: 4, justifyContent: 'flex-end' }}>
                      {u.must_change_password ? <Badge label="New password" tone="warning" /> : null}
                      {u.is_active ? null : <Badge label="Off" tone="danger" />}
                      {u.id === me ? <Badge label="You" tone="primary" /> : null}
                    </View>
                  ) },
              ]}
              rows={rows} />
          </Section>
        </>
      ) : null}

      <Sheet visible={creating} onClose={() => setCreating(false)} title="Create an account">
        <ErrorNote message={error} />
        <Field label="Full name" value={fullName} onChangeText={setFullName} />
        <Field label="Username" value={username} onChangeText={setUsername}
          autoCapitalize="none" hint="Letters, numbers, dot, dash or underscore." />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry
          hint="At least 8 characters. They replace it the first time they sign in." />
        <Select label="Role" value={designationId} onChange={setDesignationId}
          options={(d?.designations || []).map(x => ({ label: x.name, value: String(x.id) }))} />
        <Button label={busy ? 'Creating…' : 'Create'} disabled={busy} onPress={create} icon="check" />
      </Sheet>

      <Sheet visible={!!managing} onClose={() => setManaging(null)}
        title={managing ? managing.full_name : 'Account'}>
        <ErrorNote message={error} />
        {managing ? (
          <>
            <Card tone="primary">
              <Text style={{ ...type.body, fontWeight: '800', color: colors.text }}>{managing.full_name}</Text>
              <Muted>{[managing.username, managing.designation].filter(Boolean).join(' · ')}</Muted>
              {managing.sessions != null ? (
                <Muted>{`${managing.sessions} live session${managing.sessions === 1 ? '' : 's'}`}</Muted>
              ) : null}
            </Card>

            <Select label="Role" value={String(managing.designation_id || '')}
              onChange={(v) => setRole(managing, v)}
              options={(d?.designations || []).map(x => ({ label: x.name, value: String(x.id) }))} />
            <Muted>
              Changing a role signs every device that account holds out, so the new one takes effect
              everywhere at once.
            </Muted>

            <Divider />

            {managing.id === me ? (
              <Muted>This is the account you are signed in with. You cannot switch it off from here.</Muted>
            ) : (
              <Button
                label={managing.is_active ? 'Deactivate this account' : 'Reactivate it'}
                tone={managing.is_active ? 'danger' : 'primary'}
                onPress={() => setStatus(managing, !managing.is_active)} />
            )}
            {managing.is_active ? (
              <Muted>
                Deactivating signs them out immediately — not when their session happens to expire.
              </Muted>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}
