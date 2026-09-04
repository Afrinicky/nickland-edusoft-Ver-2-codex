// The statement — income against expenditure, by category and by month.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React from 'react';
import { View, Text } from 'react-native';
import { api } from '../../api';
import { OfficeScreen, cedis, useOffice } from '../../office';
import { Card, Section, Grid, StatCard, DataTable, Muted, EmptyState, ProgressBar } from '../../ui';
import { colors, spacing, type } from '../../theme';

export default function Statement() {
  const state = useOffice((t) => api.financeStatement(t));
  const d = state.data;
  // Defaulted rather than optional-chained-then-dereferenced: an older host,
  // or a window with nothing in it, answers without `totals`, and reading
  // `.income` off undefined took the whole page down.
  const totals = d?.totals || { income: 0, expense: 0, net: 0 };

  return (
    <OfficeScreen state={state} skeleton={5}>
      {d ? (
        <>
          <Card tone="primary">
            <Muted>{d.term ? d.term.label : 'This window'}</Muted>
            <Text style={{ ...type.small, color: colors.textSoft, marginTop: 2 }}>
              {`${d.from} to ${d.to}`}
            </Text>
          </Card>

          <Grid min={162}>
            <StatCard label="Income" value={cedis(totals.income)} tone="success" icon="trend" />
            <StatCard label="Expenditure" value={cedis(totals.expense)} tone="warning" icon="note" />
            <StatCard label="Net" value={cedis(totals.net)}
              tone={totals.net >= 0 ? 'success' : 'danger'} icon="chart"
              note={totals.net >= 0 ? 'The school is ahead' : 'The school is behind'} />
          </Grid>

          {totals.income > 0 ? (
            <Card>
              <Muted>How much of the income the spending takes</Muted>
              <ProgressBar
                value={Math.min(100, Math.round((totals.expense / totals.income) * 100))}
                max={100}
                tone={totals.expense > totals.income ? 'danger'
                     : totals.expense > totals.income * 0.8 ? 'warning' : 'success'}
                label={`${Math.round((totals.expense / totals.income) * 100)}% of income spent`} />
            </Card>
          ) : null}

          <Section title="Income" icon="trend">
            {(d.income || []).length === 0 ? (
              <Card><EmptyState icon="trend" title="No income recorded"
                message="Nothing has been received in this window." /></Card>
            ) : (
              <Card padded={false}>
                <DataTable dense keyExtractor={(r) => r.category}
                  columns={[
                    { key: 'category', label: 'Source', render: (r) => String(r.category).replace(/_/g, ' ') },
                    { key: 'n', label: 'Entries', align: 'right', width: 84 },
                    { key: 'total', label: 'Amount', align: 'right', width: 128,
                      render: (r) => <Text style={{ ...type.small, fontWeight: '800',
                        fontVariant: ['tabular-nums'], color: colors.success }}>{cedis(r.total)}</Text> },
                  ]}
                  rows={d.income} />
              </Card>
            )}
          </Section>

          <Section title="Expenditure" icon="note">
            {(d.expense || []).length === 0 ? (
              <Card><EmptyState icon="note" title="No expenditure recorded"
                message="Nothing has been spent in this window." /></Card>
            ) : (
              <Card padded={false}>
                <DataTable dense keyExtractor={(r) => r.category}
                  columns={[
                    { key: 'category', label: 'Category', render: (r) => String(r.category).replace(/_/g, ' ') },
                    { key: 'n', label: 'Entries', align: 'right', width: 84 },
                    { key: 'total', label: 'Amount', align: 'right', width: 128,
                      render: (r) => <Text style={{ ...type.small, fontWeight: '800',
                        fontVariant: ['tabular-nums'], color: colors.warning }}>{cedis(r.total)}</Text> },
                  ]}
                  rows={d.expense} />
              </Card>
            )}
          </Section>

          {(d.monthly || []).length ? (
            <Section title="Month by month" icon="chart">
              <Card padded={false}>
                <DataTable dense keyExtractor={(r) => r.ym}
                  columns={[
                    { key: 'ym', label: 'Month' },
                    { key: 'income', label: 'In', align: 'right', width: 116,
                      render: (r) => <Text style={{ ...type.small, color: colors.success,
                        fontVariant: ['tabular-nums'] }}>{cedis(r.income)}</Text> },
                    { key: 'expense', label: 'Out', align: 'right', width: 116,
                      render: (r) => <Text style={{ ...type.small, color: colors.warning,
                        fontVariant: ['tabular-nums'] }}>{cedis(r.expense)}</Text> },
                    { key: 'net', label: 'Net', align: 'right', width: 116,
                      render: (r) => {
                        const net = (r.income || 0) - (r.expense || 0);
                        return <Text style={{ ...type.small, fontWeight: '800',
                          fontVariant: ['tabular-nums'],
                          color: net >= 0 ? colors.success : colors.danger }}>{cedis(net)}</Text>;
                      } },
                  ]}
                  rows={d.monthly} />
              </Card>
            </Section>
          ) : null}
        </>
      ) : null}
    </OfficeScreen>
  );
}
