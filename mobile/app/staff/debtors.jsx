// Fee arrears — who owes, and how much.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { useAuth } from '../../src/auth';
import { RequireModule } from '../../src/guard';
import { api, money } from '../../src/api';
import {
  Screen, Card, Section, Muted, Button, Badge, SearchField,
  ErrorNote, InfoNote, Skeleton, EmptyState, ListRow, Grid, StatCard, DataTable,
} from '../../src/ui';
import { useLayout } from '../../src/responsive';
import { colors, spacing, type } from '../../src/theme';

function DebtorsScreen() {
  const { token } = useAuth();
  const layout = useLayout();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { const r = await api.debtors(token); setRows(r.debtors || []); }
    catch (e) { setError(e.message); setRows([]); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows || [];
    return (rows || []).filter(r =>
      `${r.surname || ''} ${r.first_name || ''} ${r.index_number || ''} ${r.class_name || ''}`.toLowerCase().includes(needle));
  }, [rows, q]);

  const total = (rows || []).reduce((n, r) => n + (r.balance || 0), 0);
  const shown = filtered.reduce((n, r) => n + (r.balance || 0), 0);

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ErrorNote message={error} />

      {rows === null ? <Card><Skeleton rows={6} height={52} /></Card> : rows.length === 0 ? (
        <Card><EmptyState icon="wallet" title="Nothing outstanding" message="Every active pupil's fees are settled for the current term." /></Card>
      ) : (
        <>
          <Grid min={160}>
            <StatCard label="Pupils owing" value={rows.length} tone="warning" icon="users" />
            <StatCard label="Total outstanding" value={money(total)} tone="danger" icon="wallet" />
            {q ? <StatCard label="Matching" value={money(shown)} tone="data" icon="search" /> : null}
          </Grid>

          <Card><SearchField value={q} onChangeText={setQ} placeholder="Find a pupil or class" /></Card>

          <Section title="Arrears" icon="wallet" subtitle="Largest first.">
            <DataTable
              keyExtractor={(r, i) => `${r.index_number || i}`}
              empty="Nobody matches that."
              columns={[
                { key: 'name', label: 'Pupil', render: (r) => (
                  <View>
                    <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                      {`${r.surname || ''} ${r.first_name || ''}`.trim()}
                    </Text>
                    <Muted numberOfLines={1}>{r.index_number}</Muted>
                  </View>
                ) },
                { key: 'class_name', label: 'Class', width: layout.isDesktop ? 150 : undefined },
                {
                  key: 'balance', label: 'Owing', align: 'right', width: 130,
                  render: (r) => <Text style={{ ...type.small, fontWeight: '800', color: colors.danger, fontVariant: ['tabular-nums'] }}>
                    {money(r.balance)}
                  </Text>,
                },
              ]}
              rows={filtered}
            />
          </Section>
        </>
      )}
    </Screen>
  );
}

export default function Debtors() {
  return (
    <RequireModule modules={[['fees', 'view']]}>
      <DebtorsScreen />
    </RequireModule>
  );
}
