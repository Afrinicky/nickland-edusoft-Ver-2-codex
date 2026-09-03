// The term's position — what the office opens on.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Four numbers and two lists, and each section appears only if this account
// may see the module behind it. A head teacher who holds fees but not finance
// gets the fee position and no expenditure section at all — not a section full
// of zeroes, which would be a claim, and a false one.
import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { AsOf, OfficeScreen, cedis, shortDate, useOffice } from '../../src/office';
import {
  Card, Section, Grid, StatCard, ListRow, Muted, EmptyState, ProgressBar, Badge, Button,
} from '../../src/ui';
import { colors, spacing, type } from '../../src/theme';

export default function FinanceOverview() {
  const router = useRouter();
  const { mode } = useAuth();
  const state = useOffice((token) => (
    mode === 'online' ? api.school.feesOverview(token) : api.financeOverview(token)
  ), [mode]);

  const d = state.data;
  const fees = d?.fees;
  const ledger = d?.ledger;
  const payroll = d?.payroll;

  return (
    <OfficeScreen state={state} skeleton={4}>
      {d ? (
        <>
          <Card tone="primary">
            <Muted>{d.term ? d.term.label : 'No term is running'}</Muted>
            {d.stale ? <AsOf at={d.updated_at} /> : null}
          </Card>

          {fees ? (
            <>
              <Grid min={162}>
                <StatCard label="Collected this term" value={cedis(fees.collected)} tone="success" icon="wallet" />
                <StatCard label="Still outstanding" value={cedis(fees.outstanding)} tone="danger" icon="trend"
                  note={`${fees.debtors} pupil${fees.debtors === 1 ? '' : 's'}`} />
                <StatCard label="Taken today" value={cedis(fees.today)} tone="data" icon="check"
                  note={`${fees.today_receipts} receipt${fees.today_receipts === 1 ? '' : 's'}`} />
                <StatCard label="Billed" value={cedis(fees.billed)} tone="neutral" icon="layers"
                  note={`${fees.bills} bill${fees.bills === 1 ? '' : 's'} raised`} />
              </Grid>

              <Card>
                <Muted>Collection rate</Muted>
                <ProgressBar value={fees.collection_rate} max={100}
                  tone={fees.collection_rate >= 75 ? 'success' : fees.collection_rate >= 40 ? 'warning' : 'danger'}
                  label={`${fees.collection_rate}% of what has been billed`} />
              </Card>

              {fees.pending_intents ? (
                <Card tone="warning" onPress={() => router.push('/finance/online')}>
                  <Text style={{ ...type.body, fontWeight: '700', color: colors.text }}>
                    {fees.pending_intents} payment{fees.pending_intents === 1 ? '' : 's'} waiting to be confirmed
                  </Text>
                  <Muted>Parents have said they paid. Check them against the school’s statement.</Muted>
                </Card>
              ) : null}
            </>
          ) : null}

          {ledger ? (
            <Section title="The books" icon="book" subtitle="This term, income against expenditure.">
              <Grid min={162}>
                <StatCard label="Income" value={cedis(ledger.income)} tone="success" icon="trend" />
                <StatCard label="Expenditure" value={cedis(ledger.expense)} tone="warning" icon="note" />
                <StatCard label="Net" value={cedis(ledger.net)}
                  tone={ledger.net >= 0 ? 'success' : 'danger'} icon="chart" />
              </Grid>
              {(d.expense_categories || []).length ? (
                <Card>
                  {d.expense_categories.slice(0, 6).map((c, i) => (
                    <ListRow key={c.category} title={String(c.category).replace(/_/g, ' ')}
                      subtitle={`${c.n} entr${c.n === 1 ? 'y' : 'ies'}`}
                      right={<Text style={{ ...type.small, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                        {cedis(c.total)}</Text>}
                      last={i === Math.min(5, d.expense_categories.length - 1)} />
                  ))}
                </Card>
              ) : null}
            </Section>
          ) : null}

          {payroll ? (
            <Section title="Payroll" icon="users"
              subtitle={`${payroll.month}/${payroll.year} — ${payroll.paid} of ${payroll.staff} paid.`}>
              <Grid min={162}>
                <StatCard label="Net for the month" value={cedis(payroll.net)} tone="neutral" icon="wallet" />
                <StatCard label="Paid out" value={cedis(payroll.paid_total)} tone="success" icon="check" />
                <StatCard label="Still owing" value={cedis(payroll.outstanding)}
                  tone={payroll.outstanding > 0 ? 'warning' : 'success'} icon="trend" />
              </Grid>
            </Section>
          ) : null}

          {(d.top_debtors || []).length ? (
            <Section title="Largest arrears" icon="wallet"
              action={<Button label="All of them" tone="ghost" size="sm" onPress={() => router.push('/finance/debtors')} />}>
              <Card padded={false}>
                {d.top_debtors.slice(0, 8).map((r, i) => (
                  <ListRow key={r.student_id || i}
                    title={r.student_name} subtitle={r.class_name || r.index_number}
                    right={<Text style={{ ...type.small, fontWeight: '800', color: colors.danger, fontVariant: ['tabular-nums'] }}>
                      {cedis(r.balance)}</Text>}
                    onPress={() => router.push(`/finance/student/${r.student_id}`)}
                    last={i === Math.min(7, d.top_debtors.length - 1)} />
                ))}
              </Card>
            </Section>
          ) : null}

          {(d.recent || []).length ? (
            <Section title="Latest receipts" icon="check">
              <Card padded={false}>
                {d.recent.slice(0, 8).map((r, i) => (
                  <ListRow key={r.receipt_number || i}
                    title={r.student_name}
                    subtitle={`${r.receipt_number} · ${shortDate(r.payment_date)} · ${r.payment_method}`}
                    right={<Text style={{ ...type.small, fontWeight: '800', color: colors.success, fontVariant: ['tabular-nums'] }}>
                      {cedis(r.amount)}</Text>}
                    last={i === Math.min(7, d.recent.length - 1)} />
                ))}
              </Card>
            </Section>
          ) : null}

          {!fees && !ledger && !payroll ? (
            <Card>
              <EmptyState icon="wallet" title="Nothing here yet"
                message="This account holds a part of the finance office that has no figures on it yet." />
            </Card>
          ) : null}
        </>
      ) : null}
    </OfficeScreen>
  );
}
