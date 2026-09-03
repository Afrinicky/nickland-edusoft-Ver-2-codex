// The audit trail — what has been done, and what was refused.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The refusals are the ones to read. A run of them against one account is the
// earliest sign anybody gets that it has been taken, and it is the reason
// every denial in the system writes a row rather than only returning a 403.
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { api } from '../../src/api';
import { OfficeScreen, useOffice } from '../../src/office';
import {
  Card, Section, Muted, Badge, EmptyState, SegmentedControl, Grid, StatCard, DataTable,
} from '../../src/ui';
import { colors, spacing, type } from '../../src/theme';

const FILTERS = [
  { label: 'Everything', value: '' },
  { label: 'Serious', value: 'high' },
  { label: 'Refusals', value: 'denied' },
];

function when(value) {
  if (!value) return '';
  const s = String(value);
  return s.length > 16 ? s.slice(0, 16).replace('T', ' ') : s;
}

export default function Audit() {
  const [filter, setFilter] = useState('');
  const state = useOffice((t) => api.systemAudit(t, filter === 'denied'
    ? { action: 'permission_denied', limit: 200 }
    : { severity: filter || undefined, limit: 200 }), [filter]);
  const d = state.data;

  const bySeverity = Object.fromEntries((d?.severities || []).map(s => [s.severity, s.c]));

  return (
    <OfficeScreen state={state} skeleton={6}>
      {d ? (
        <>
          <Grid min={150}>
            <StatCard label="Serious" value={bySeverity.high || 0}
              tone={(bySeverity.high || 0) > 50 ? 'warning' : 'neutral'} icon="alert" />
            <StatCard label="Ordinary" value={bySeverity.normal || 0} tone="neutral" icon="note" />
          </Grid>

          <Card>
            <SegmentedControl value={filter} onChange={setFilter} options={FILTERS} />
          </Card>

          {(d.entries || []).length === 0 ? (
            <Card><EmptyState icon="note" title="Nothing recorded"
              message="No entry matches that." /></Card>
          ) : (
            <Section title="The trail" icon="note" subtitle="Newest first.">
              <Card padded={false}>
                <DataTable dense
                  keyExtractor={(r) => String(r.id)}
                  columns={[
                    { key: 'action', label: 'What', render: (r) => (
                      <View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                            {String(r.action).replace(/_/g, ' ')}
                          </Text>
                          {r.severity === 'high' ? <Badge label="Serious" tone="danger" /> : null}
                        </View>
                        {r.justification ? (
                          <Muted numberOfLines={2}>{r.justification}</Muted>
                        ) : null}
                      </View>
                    ) },
                    { key: 'user', label: 'Who', width: 150,
                      render: (r) => (r.user_name
                        ? <View>
                            <Text numberOfLines={1} style={{ ...type.small, color: colors.textSoft }}>
                              {r.user_name}
                            </Text>
                            <Muted numberOfLines={1}>{r.username}</Muted>
                          </View>
                        : <Muted>The system</Muted>) },
                    { key: 'created_at', label: 'When', align: 'right', width: 132,
                      render: (r) => <Muted>{when(r.created_at)}</Muted> },
                  ]}
                  rows={d.entries} />
              </Card>
            </Section>
          )}
        </>
      ) : null}
    </OfficeScreen>
  );
}
