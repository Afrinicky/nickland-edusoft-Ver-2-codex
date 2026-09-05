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
import { useAuth } from '../../auth';
import { api } from '../../api';
import { AsOf, OfficeScreen, cedis, shortDate, useOffice } from '../../office';
import {
  Card, Section, Grid, StatCard, ListRow, Muted, EmptyState, ProgressBar, Badge, Button,
} from '../../ui';
import {
  MetricCard, MetricRow, SectionCard, DashRow, ActionCard, CardGrid, BarList, PaymentRow,
  EmptyLine, ghs, labelize, dateLabel,
} from '../../dash';
import { useLayout } from '../../responsive';
import { colors, spacing, type } from '../../theme';

export default function FinanceOverview() {
  const router = useRouter();
  const { mode } = useAuth();
  const layout = useLayout();
  const wide = layout.isDesktop;

  const state = useOffice(async (token) => {
    const [overview, rich] = await Promise.all([
      mode === 'online' ? api.school.feesOverview(token) : api.financeOverview(token),
      wide ? api.dashFinance(token) : Promise.resolve(null),
    ]);
    return { overview, rich: rich && rich.ok ? rich : null };
  }, [mode, wide]);

  if (state.data && state.data.rich) {
    return (
      <OfficeScreen state={state} skeleton={4}>
        <FinanceFull d={state.data.rich} overview={state.data.overview} router={router} />
      </OfficeScreen>
    );
  }

  const d = state.data?.overview;
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
                <Card tone="warning" onPress={() => router.push('/app/fees?tab=online')}>
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
              action={<Button label="All of them" tone="ghost" size="sm" onPress={() => router.push('/app/fees?tab=debtors')} />}>
              <Card padded={false}>
                {d.top_debtors.slice(0, 8).map((r, i) => (
                  <ListRow key={r.student_id || i}
                    title={r.student_name} subtitle={r.class_name || r.index_number}
                    right={<Text style={{ ...type.small, fontWeight: '800', color: colors.danger, fontVariant: ['tabular-nums'] }}>
                      {cedis(r.balance)}</Text>}
                    onPress={() => router.push(`/app/fees/${r.student_id}`)}
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

// ══ The installed application's Finance → Dashboard ═════════════════════════
//
// Four coloured cards for the things this screen exists to start, five figures
// across the term, income and expenditure broken down by category, and the last
// five entries of each.
//
// The desktop opens a modal from those first two cards. Here they go to the
// tab that records the thing, because the form for recording income already
// lives there and two forms for one job is how two forms drift apart.

function FinanceFull({ d, overview, router }) {
  const m = d.metrics || {};
  const income = d.income_by_category || [];
  const expense = d.expense_by_category || [];
  const may = d.may && d.may.record;

  // Money parents say they have paid and nobody has acknowledged. Not a figure
  // on the desktop, because on the desktop somebody is standing at the counter;
  // over the internet it is the one number that means "there is work here".
  const pending = overview?.fees?.pending_intents || 0;

  return (
    <View style={{ width: '100%' }}>
      <CardGrid min={240}>
        {may ? (
          <ActionCard tone="income" icon="plus" title="Record Income"
                      sub="Add a new income transaction"
                      onPress={() => router.push('/app/finance?tab=income')} />
        ) : null}
        {may ? (
          <ActionCard tone="expense" icon="note" title="Record Expense"
                      sub="Log a new outgoing payment"
                      onPress={() => router.push('/app/finance?tab=expenses')} />
        ) : null}
        <ActionCard tone="reports" icon="chart" title="Financial Reports"
                    sub="View and print analyses"
                    onPress={() => router.push('/app/finance?tab=statement')} />
        <ActionCard tone="budget" icon="trend" title="Budgets"
                    sub="Plan and track financials"
                    onPress={() => router.push('/app/finance?tab=budgets')} />
      </CardGrid>

      <View style={{ height: 18 }} />

      <MetricRow columns={5}>
        <MetricCard index={0} tone="blue" icon="trend"
                    label="Expected Income" value={ghs(m.expected_income)}
                    sub="If all fees collected" />
        <MetricCard index={1} tone="green" icon="cash" valueTone="success"
                    label="Actual Income" value={ghs(m.income_total)} sub="This term" />
        <MetricCard index={2} tone="red" icon="note" valueTone="danger"
                    label="Total Expenses" value={ghs(m.expense_total)} sub="This term" />
        <MetricCard index={3} tone="purple" icon="chart"
                    valueTone={Number(m.net) >= 0 ? 'success' : 'danger'}
                    label="Net Position" value={ghs(m.net)} sub="Income − Expenses" />
        <MetricCard index={4} tone="orange" icon="users"
                    label="Active Staff" value={m.staff_active ?? '—'} sub="Payroll-eligible" />
      </MetricRow>

      {pending ? (
        <Card tone="warning" onPress={() => router.push('/app/fees?tab=online')}>
          <Text style={{ ...type.body, fontWeight: '700', color: colors.text }}>
            {pending} payment{pending === 1 ? '' : 's'} waiting to be confirmed
          </Text>
          <Muted>Parents have said they paid. Check them against the school’s statement.</Muted>
        </Card>
      ) : null}

      <DashRow weights={[1, 1]}>
        <SectionCard title="Income by Category" viewAll="View all →"
                     onViewAll={() => router.push('/app/finance?tab=income')}>
          {income.length === 0
            ? <EmptyLine>No income recorded</EmptyLine>
            : <>
              <BarList color="#15803D" valueWidth={104} format={ghs}
                       items={income.map(c => ({ label: labelize(c.category), value: c.total }))} />
              <Text style={styles.barTotal}>{`Total: ${ghs(m.income_total)}`}</Text>
            </>}
        </SectionCard>

        <SectionCard title="Expenses by Category" viewAll="View all →"
                     onViewAll={() => router.push('/app/finance?tab=expenses')}>
          {expense.length === 0
            ? <EmptyLine>No expenses recorded</EmptyLine>
            : <>
              <BarList color="#B91C1C" valueWidth={104} format={ghs}
                       items={expense.map(c => ({ label: labelize(c.category), value: c.total }))} />
              <Text style={styles.barTotal}>{`Total: ${ghs(m.expense_total)}`}</Text>
            </>}
        </SectionCard>
      </DashRow>

      <DashRow weights={[1, 1]}>
        <SectionCard title="Recent Income" viewAll="+ Add"
                     onViewAll={may ? () => router.push('/app/finance?tab=income') : null}>
          {(d.recent_income || []).length === 0
            ? <EmptyLine>No income transactions yet</EmptyLine>
            : d.recent_income.map((r, i, arr) => (
              <PaymentRow key={r.id} code={r.receipt_number}
                          name={r.payer_name || labelize(r.category)}
                          note={r.description || labelize(r.category)}
                          amount={`+${ghs(r.amount)}`} when={dateLabel(r.transaction_date)}
                          last={i === arr.length - 1} />
            ))}
        </SectionCard>

        <SectionCard title="Recent Expenses" viewAll="+ Add"
                     onViewAll={may ? () => router.push('/app/finance?tab=expenses') : null}>
          {(d.recent_expenses || []).length === 0
            ? <EmptyLine>No expenses recorded yet</EmptyLine>
            : d.recent_expenses.map((r, i, arr) => (
              <PaymentRow key={r.id} code={r.transaction_number}
                          name={r.payee_name || labelize(r.category)}
                          note={r.description || labelize(r.category)}
                          amount={`−${ghs(r.amount)}`} tone="danger"
                          when={dateLabel(r.transaction_date)}
                          last={i === arr.length - 1} />
            ))}
        </SectionCard>
      </DashRow>
    </View>
  );
}

const styles = {
  barTotal: {
    ...type.small, fontSize: 11, color: colors.muted, textAlign: 'right', marginTop: 8,
  },
};
