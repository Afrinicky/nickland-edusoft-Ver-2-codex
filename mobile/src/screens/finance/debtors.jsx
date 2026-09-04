// Arrears — who owes, how much, and how long it has been owing.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../api';
import { AsOf, OfficeScreen, cedis, useOffice } from '../../office';
import { Card, Section, Grid, StatCard, SearchField, DataTable, Muted, EmptyState, Badge } from '../../ui';
import { useLayout } from '../../responsive';
import { colors, type } from '../../theme';

export default function Debtors() {
  const router = useRouter();
  const layout = useLayout();
  const [q, setQ] = useState('');
  const state = useOffice((t) => api.financeDebtors(t));
  const d = state.data;

  const rows = useMemo(() => {
    const list = d?.debtors || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(r => `${r.student_name || ''} ${r.index_number || ''} ${r.class_name || ''}`
      .toLowerCase().includes(needle));
  }, [d, q]);

  return (
    <OfficeScreen state={state} skeleton={6}>
      {d ? (
        (d.debtors || []).length === 0 ? (
          <Card><EmptyState icon="wallet" title="Nothing outstanding"
            message="Every active pupil's fees are settled for this term." /></Card>
        ) : (
          <>
            <Grid min={162}>
              <StatCard label="Pupils owing" value={d.debtors.length} tone="warning" icon="users" />
              <StatCard label="Total outstanding" value={cedis(d.total)} tone="danger" icon="wallet" />
            </Grid>
            {d.updated_at ? <Card><AsOf at={d.updated_at} /></Card> : null}

            {(d.by_class || []).length ? (
              <Section title="By class" icon="layers" subtitle="Where the money is.">
                <Card padded={false}>
                  <DataTable
                    dense
                    keyExtractor={(r, i) => `${r.class_name || i}`}
                    columns={[
                      { key: 'class_name', label: 'Class' },
                      { key: 'n', label: 'Pupils', align: 'right', width: 84 },
                      { key: 'total', label: 'Owing', align: 'right', width: 128,
                        render: (r) => <Text style={{ ...type.small, fontWeight: '800',
                                                      fontVariant: ['tabular-nums'], color: colors.danger }}>
                          {cedis(r.total)}</Text> },
                    ]}
                    rows={d.by_class}
                  />
                </Card>
              </Section>
            ) : null}

            <Card><SearchField value={q} onChangeText={setQ} placeholder="Find a pupil or a class" /></Card>

            <Section title="Arrears" icon="trend" subtitle="Largest first.">
              <DataTable
                keyExtractor={(r, i) => String(r.student_id || i)}
                empty="Nobody matches that."
                onRowPress={(r) => r.student_id && router.push(`/app/fees/${r.student_id}`)}
                columns={[
                  { key: 'name', label: 'Pupil', render: (r) => (
                    <View>
                      <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                        {r.student_name}
                      </Text>
                      <Muted numberOfLines={1}>
                        {[r.index_number, r.guardian_phone].filter(Boolean).join(' · ')}
                      </Muted>
                    </View>
                  ) },
                  { key: 'class_name', label: 'Class', width: layout.isDesktop ? 140 : undefined },
                  { key: 'days_outstanding', label: 'Days', align: 'right', width: 74,
                    render: (r) => (r.days_outstanding == null ? '—' : (
                      <Badge label={String(Math.round(r.days_outstanding))}
                        tone={r.days_outstanding > 60 ? 'danger' : r.days_outstanding > 30 ? 'warning' : 'neutral'} />
                    )) },
                  { key: 'balance', label: 'Owing', align: 'right', width: 128,
                    render: (r) => <Text style={{ ...type.small, fontWeight: '800',
                                                  fontVariant: ['tabular-nums'], color: colors.danger }}>
                      {cedis(r.balance)}</Text> },
                ]}
                rows={rows}
              />
            </Section>
          </>
        )
      ) : null}
    </OfficeScreen>
  );
}
