// Nickland Edusoft — Bills home.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The first screen of Bills answers the two questions an owner opens the
// module to ask: what have we charged this term, and who has not paid.
//
// Before this, the answers were spread across six tabs and a separate Debtors
// tab that only ever covered SCHOOL fees — so a school that ran a canteen and a
// bus had no single place saying what it had billed. Every kind of bill now
// reports the same five figures side by side, and the debtors list that used to
// be its own tab sits here, under the totals it explains.

import React from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { cedis, useOffice, OfficeScreen } from '../../office';
import { DataTable, Muted, Badge, Button } from '../../ui';
import { Panel, StatRow, Stat } from '../../desk';
import { AvgBar, collectionInk } from '../../dash';
import { colors, spacing, type } from '../../theme';

export default function BillsHome({ onOpen }) {
  const { token } = useAuth();
  const state = useOffice((t) => api.billsSummary(t));

  const d = state.data;
  const kinds = d?.kinds || [];
  const debtors = d?.debtors || [];
  const byClass = d?.by_class || [];

  // `null` means "this kind does not keep its own collection figure" (extra
  // charges settle on the term bill), which is not the same as zero and must
  // not be added in as one.
  const totals = kinds.reduce((acc, k) => ({
    billed: acc.billed + (Number(k.billed) || 0),
    paid: acc.paid + (k.paid == null ? 0 : Number(k.paid) || 0),
    outstanding: acc.outstanding + (k.outstanding == null ? 0 : Number(k.outstanding) || 0),
  }), { billed: 0, paid: 0, outstanding: 0 });
  const rate = totals.billed > 0 ? Math.round((totals.paid / totals.billed) * 100) : 0;

  return (
    <OfficeScreen state={state} skeleton={5}>
      <StatRow>
        <Stat index={0} label="Billed this term" icon="layers" tone="primary"
              value={cedis(totals.billed)} note={d?.term?.full_label || ''} />
        <Stat index={1} label="Collected" icon="check" tone="success"
              value={cedis(totals.paid)} note={`${rate}% of what was billed`} />
        <Stat index={2} label="Outstanding" icon="alert" tone="danger"
              value={cedis(totals.outstanding)}
              note={`${debtors.length} pupil(s) owing on fees`} />
        <Stat index={3} label="Withdrawn" icon="trend" tone="data"
              value={String(d?.voided?.count || 0)}
              note={(d?.voided?.count || 0) > 0
                ? `${cedis(d.voided.billed)} taken off the books`
                : 'nothing withdrawn this term'} />
      </StatRow>

      <Panel padded={false} title="What the school bills for"
             subtitle="Each kind keeps its own books. Open one to raise, amend or print it.">
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r) => r.key}
            onRowPress={(r) => onOpen && onOpen(r.tab)}
            columns={[
              { key: 'label', label: 'Bill',
                render: (r) => (
                  <View style={{ minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                      {r.label}
                    </Text>
                    <Muted numberOfLines={1}>{r.note}</Muted>
                  </View>
                ) },
              { key: 'raised', label: 'Raised', align: 'right', width: 100,
                render: (r) => `${r.raised || 0}${r.unit ? ` ${r.unit}` : ''}` },
              { key: 'billed', label: 'Billed', align: 'right', width: 130,
                render: (r) => cedis(r.billed) },
              { key: 'paid', label: 'Collected', align: 'right', width: 140,
                render: (r) => (r.paid == null
                  ? <Muted>on the term bill</Muted>
                  : <Text style={{ ...type.small, fontWeight: '700', color: '#15803D',
                                   fontVariant: ['tabular-nums'] }}>{cedis(r.paid)}</Text>) },
              { key: 'outstanding', label: 'Outstanding', align: 'right', width: 130,
                render: (r) => (r.outstanding == null ? <Muted>—</Muted>
                  : <Text style={{
                      ...type.small, fontWeight: '700',
                      color: (r.outstanding || 0) > 0 ? colors.danger : '#15803D',
                      fontVariant: ['tabular-nums'],
                    }}>{cedis(r.outstanding)}</Text>) },
              { key: 'ready', label: 'Status', width: 120,
                render: (r) => (r.ready
                  ? <Badge tone="success" label="Raised" />
                  : <Badge tone="warning" label="Not raised" />) },
            ]}
            rows={kinds} />
        </View>
      </Panel>

      <Panel padded={false} title="Collection by class"
             right={<Muted>{d?.term?.full_label || ''}</Muted>}>
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r) => String(r.id)}
            empty="No classes set up"
            columns={[
              { key: 'short_code', label: 'Class', width: 90,
                render: (r) => (
                  <Text style={{ ...type.small, fontWeight: '800', color: colors.text }}>
                    {r.short_code || r.name}
                  </Text>
                ) },
              { key: 'bills', label: 'Bills', align: 'right', width: 80 },
              { key: 'billed', label: 'Billed', align: 'right', width: 130,
                render: (r) => cedis(r.billed) },
              { key: 'outstanding', label: 'Owing', align: 'right', width: 130,
                render: (r) => (
                  <Text style={{ ...type.small, fontWeight: '700', color: colors.danger,
                                 fontVariant: ['tabular-nums'] }}>{cedis(r.outstanding)}</Text>
                ) },
              { key: 'rate', label: 'Rate', width: 110, render: (r) => (
                <View>
                  <AvgBar value={r.rate} color={collectionInk(r.rate)} />
                  <Text style={{ ...type.small, fontSize: 11, color: colors.muted, marginTop: 2 }}>
                    {`${r.rate}%`}
                  </Text>
                </View>
              ) },
            ]}
            rows={byClass} />
        </View>
      </Panel>

      {/* Who owes — what used to be the Debtors tab. */}
      <Panel padded={false} title="Who owes"
             subtitle={`${debtors.length} pupil(s) · ${cedis(d?.debtor_total || 0)} outstanding · biggest first`}>
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r) => String(r.id)}
            empty="Nobody owes anything — every bill raised this term is settled."
            columns={[
              { key: 'index_number', label: 'Index No', width: 120 },
              { key: 'name', label: 'Pupil',
                render: (r) => (
                  <View style={{ minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                      {`${r.surname || ''} ${r.first_name || ''}`.trim()}
                    </Text>
                    <Muted numberOfLines={1}>{r.class_name}</Muted>
                  </View>
                ) },
              { key: 'contact', label: 'Contact', width: 150,
                render: (r) => r.father_contact || r.mother_contact || r.guardian_contact || '—' },
              { key: 'balance', label: 'Owing', align: 'right', width: 130,
                render: (r) => (
                  <Text style={{ ...type.small, fontWeight: '800', color: colors.danger,
                                 fontVariant: ['tabular-nums'] }}>{cedis(r.balance)}</Text>
                ) },
              { key: 'days_outstanding', label: 'Days', align: 'right', width: 80 },
            ]}
            rows={debtors} />
        </View>
      </Panel>
    </OfficeScreen>
  );
}
