// Payroll — the month, and who has been paid.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Read-and-mark-paid. Running a month calculates SSNIT and PAYE against the
// school's rates and writes everybody's salary at once; that is a deliberate
// act with a schedule to print and sign, and it belongs where the schedules are
// printed. What a phone is good for is the answer to "has everyone been paid".
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { OfficeScreen, cedis, shortDate, useOffice } from '../../office';
import {
  Card, Section, Grid, StatCard, DataTable, Muted, EmptyState, Badge,
  Button, Sheet, Field, Select, ErrorNote, InfoNote, SegmentedControl,
} from '../../ui';
import { colors, type } from '../../theme';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
const METHODS = ['Bank Transfer', 'Cash', 'Mobile Money', 'Cheque'];

export default function Payroll() {
  const { token, profile } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const state = useOffice((t) => api.financePayroll(t, month, year), [month, year]);

  const [paying, setPaying] = useState(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Bank Transfer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const mayPay = can(profile, 'payroll', 'edit');
  const d = state.data;
  const totals = d?.totals;

  async function markPaid() {
    setError(null);
    if (!(Number(amount) > 0)) {
      return setError('Enter the amount actually paid. To leave a salary unpaid, close this.');
    }
    setBusy(true);
    try {
      await api.school.markSalaryPaid(token, paying.id, { amount: Number(amount), method });
      setPaying(null); setAmount('');
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={6}>
      <Card>
        <Muted>Month</Muted>
        <SegmentedControl
          value={String(month)}
          onChange={(v) => setMonth(Number(v))}
          options={MONTHS.map((m, i) => ({ label: m.slice(0, 3), value: String(i + 1) }))} />
      </Card>

      {d ? (
        (d.rows || []).length === 0 ? (
          <Card><EmptyState icon="users" title={`No payroll for ${MONTHS[month - 1]} ${year}`}
            message="Nothing has been calculated for this month yet. The school's own system runs a month." /></Card>
        ) : (
          <>
            <Grid min={162}>
              <StatCard label="On the payroll" value={totals.staff} tone="neutral" icon="users" />
              <StatCard label="Net for the month" value={cedis(totals.net)} tone="data" icon="wallet" />
              <StatCard label="Paid" value={`${totals.paid} of ${totals.staff}`}
                tone={totals.paid === totals.staff ? 'success' : 'warning'} icon="check"
                note={cedis(totals.paid_total)} />
            </Grid>

            <Card padded={false}>
              <DataTable dense keyExtractor={(r) => String(r.id)}
                columns={[
                  { key: 'name', label: 'Staff', render: (r) => (
                    <View>
                      <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                        {r.staff_name}
                      </Text>
                      <Muted numberOfLines={1}>{r.designation || r.role}</Muted>
                    </View>
                  ) },
                  { key: 'net_salary', label: 'Net', align: 'right', width: 116,
                    render: (r) => <Text style={{ ...type.small, fontWeight: '700',
                      fontVariant: ['tabular-nums'] }}>{cedis(r.net_salary)}</Text> },
                  { key: 'paid', label: 'Paid', align: 'right', width: 132,
                    render: (r) => (r.is_paid
                      ? <Text style={{ ...type.small, fontWeight: '800', color: colors.success,
                          fontVariant: ['tabular-nums'] }}>{cedis(r.actual_amount_paid)}</Text>
                      : (mayPay
                          ? <Button label="Mark paid" size="sm" tone="ghost"
                              onPress={() => { setError(null); setPaying(r);
                                setAmount(String((r.net_salary || 0) + (r.arrear_brought_forward || 0))); }} />
                          : <Badge label="Pending" tone="warning" />)) },
                ]}
                rows={d.rows} />
            </Card>

            <Section title="Statutory" icon="book" subtitle="What the school owes on top.">
              <Grid min={162}>
                <StatCard label="SSNIT — worker" value={cedis(totals.ssnit_worker)} tone="neutral" icon="users" />
                <StatCard label="SSNIT — employer" value={cedis(totals.ssnit_employer)} tone="neutral" icon="users" />
                <StatCard label="PAYE" value={cedis(totals.paye)} tone="neutral" icon="note" />
              </Grid>
            </Section>

            {d.run_is_desktop_only ? (
              <InfoNote message="Running a month — calculating everybody's SSNIT and PAYE — happens on the school's own system, where the schedules are printed and signed." />
            ) : null}
          </>
        )
      ) : null}

      <Sheet visible={!!paying} onClose={() => setPaying(null)}
        title={paying ? `Pay ${paying.staff_name}` : 'Pay'}>
        <ErrorNote message={error} />
        {paying ? (
          <>
            <Muted>
              {`Net ${cedis(paying.net_salary)}`}
              {paying.arrear_brought_forward
                ? ` plus ${cedis(paying.arrear_brought_forward)} carried over` : ''}
            </Muted>
            <Field label="Amount actually paid" value={amount} onChangeText={setAmount}
              keyboardType="decimal-pad"
              hint="Anything short of the full amount carries over to next month." />
            <Select label="How" value={method} onChange={setMethod}
              options={METHODS.map(m => ({ label: m, value: m }))} />
            <Button label={busy ? 'Recording…' : 'Record the payment'}
              disabled={busy} onPress={markPaid} icon="check" />
          </>
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}
