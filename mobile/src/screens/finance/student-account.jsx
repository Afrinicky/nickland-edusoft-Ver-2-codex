// A pupil's account — the bill line by line, and every receipt against it.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React from 'react';
import { View, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api } from '../../api';
import { OfficeScreen, cedis, shortDate, useOffice } from '../../office';
import { useScreenTitle } from '../../shell';
import {
  Card, Section, Grid, StatCard, DataTable, Muted, EmptyState, Badge, Divider,
} from '../../ui';
import { colors, spacing, type } from '../../theme';

export default function StudentAccount() {
  const { id } = useLocalSearchParams();
  const state = useOffice((t) => api.financeStudentBill(t, id), [id]);
  const d = state.data;
  useScreenTitle(d?.student?.name || 'Account');

  return (
    <OfficeScreen state={state} skeleton={5}>
      {d ? (
        <>
          <Card tone="primary">
            <Text style={{ ...type.title, color: colors.text, fontSize: 20 }}>{d.student.name}</Text>
            <Muted>{[d.student.class_name, d.student.index_number].filter(Boolean).join(' · ')}</Muted>
            {d.term ? <Muted>{d.term.label}</Muted> : null}
          </Card>

          {d.bill ? (
            <Grid min={150}>
              <StatCard label="Billed" value={cedis(d.bill.billed)} tone="neutral" icon="layers" />
              <StatCard label="Paid" value={cedis(d.bill.paid)} tone="success" icon="check" />
              <StatCard label="Balance" value={cedis(d.bill.balance)}
                tone={d.bill.balance > 0 ? 'danger' : 'success'} icon="wallet" />
            </Grid>
          ) : (
            <Card><EmptyState icon="layers" title="No bill this term"
              message="Nothing has been raised for this pupil in the current term." /></Card>
          )}

          {(d.items || []).length ? (
            <Section title="What was charged" icon="book">
              <Card padded={false}>
                <DataTable dense keyExtractor={(r, i) => String(i)}
                  columns={[
                    { key: 'description', label: 'Item', render: (r) => (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text numberOfLines={1} style={{ ...type.small, color: colors.text }}>
                          {r.description}
                        </Text>
                        {r.is_arrear ? <Badge label="Arrears" tone="warning" /> : null}
                      </View>
                    ) },
                    { key: 'amount', label: 'Amount', align: 'right', width: 122,
                      render: (r) => <Text style={{ ...type.small, fontWeight: '700',
                        fontVariant: ['tabular-nums'] }}>{cedis(r.amount)}</Text> },
                  ]}
                  rows={d.items} />
                {d.bill?.discount ? (
                  <View style={{ padding: spacing.md }}>
                    <Divider />
                    <Text style={{ ...type.small, color: colors.success, fontWeight: '700', marginTop: 8 }}>
                      {`Less discount ${cedis(d.bill.discount)}`}
                    </Text>
                  </View>
                ) : null}
              </Card>
            </Section>
          ) : null}

          <Section title="Receipts" icon="check" subtitle="Every payment this pupil has made.">
            {(d.history || []).length === 0 ? (
              <Card><EmptyState icon="wallet" title="Nothing received"
                message="No payment has been recorded for this pupil." /></Card>
            ) : (
              <Card padded={false}>
                <DataTable dense keyExtractor={(r, i) => r.receipt_number || String(i)}
                  columns={[
                    { key: 'receipt_number', label: 'Receipt', render: (r) => (
                      <View>
                        <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                          {r.receipt_number}
                        </Text>
                        <Muted numberOfLines={1}>
                          {[shortDate(r.payment_date), r.payment_method, r.term_label].filter(Boolean).join(' · ')}
                        </Muted>
                        {r.is_reversed && r.reversal_reason
                          ? <Muted numberOfLines={1}>{`Reversed — ${r.reversal_reason}`}</Muted> : null}
                      </View>
                    ) },
                    { key: 'amount', label: 'Amount', align: 'right', width: 128,
                      render: (r) => <Text style={{
                        ...type.small, fontWeight: '800', fontVariant: ['tabular-nums'],
                        color: r.is_reversed ? colors.faint : colors.success,
                        textDecorationLine: r.is_reversed ? 'line-through' : 'none',
                      }}>{cedis(r.amount)}</Text> },
                  ]}
                  rows={d.history} />
              </Card>
            )}
          </Section>

          {(d.intents || []).length ? (
            <Section title="Paid online" icon="bell">
              <Card padded={false}>
                {d.intents.map((it, i) => (
                  <View key={it.id} style={{ padding: spacing.md,
                    borderBottomWidth: i === d.intents.length - 1 ? 0 : 1,
                    borderBottomColor: colors.borderSoft }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                          {it.gateway ? `Through ${it.gateway}` : String(it.channel || 'bank').replace(/_/g, ' ')}
                        </Text>
                        <Muted numberOfLines={1}>{[it.reference, shortDate(it.created_at)].filter(Boolean).join(' · ')}</Muted>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ ...type.small, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                          {cedis(it.amount)}
                        </Text>
                        <Badge label={it.status}
                          tone={it.status === 'acknowledged' ? 'success'
                               : it.status === 'rejected' ? 'danger' : 'warning'} />
                      </View>
                    </View>
                  </View>
                ))}
              </Card>
            </Section>
          ) : null}
        </>
      ) : null}
    </OfficeScreen>
  );
}
