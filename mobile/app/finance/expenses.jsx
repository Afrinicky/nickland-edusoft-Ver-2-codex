// Expenditure — what the school has spent, and what nobody has signed off.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Recording an expense and approving one are two acts by two accounts. That is
// stricter than the desktop, which lets the person entering it sign it off in
// the same breath, and it is the ordinary separation of duties a school's
// auditor asks about. It costs one tap.
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { can } from '../../src/guard';
import { OfficeScreen, cedis, shortDate, useOffice } from '../../src/office';
import {
  Card, Section, Grid, StatCard, Button, Field, Select, Sheet, DataTable,
  Muted, EmptyState, Badge, ErrorNote, TextArea,
} from '../../src/ui';
import { colors, type } from '../../src/theme';

const CATEGORIES = [
  'salary', 'supplies', 'canteen_supplies', 'utilities', 'rent', 'maintenance',
  'construction', 'transport', 'training', 'statutory', 'other',
];
const METHODS = ['Cash', 'Bank Transfer', 'Mobile Money', 'Cheque'];

export default function Expenses() {
  const { token, profile } = useAuth();
  const state = useOffice((t) => api.financeExpenses(t));
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('supplies');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [payee, setPayee] = useState('');
  const [method, setMethod] = useState('Cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const mayRecord = can(profile, 'finance', 'create');
  const d = state.data;

  async function record() {
    setError(null);
    if (!description.trim()) return setError('Say what the payment was for.');
    if (!(Number(amount) > 0)) return setError('Enter an amount greater than zero.');
    setBusy(true);
    try {
      await api.financeRecordExpense(token, {
        category, amount: Number(amount), description: description.trim(),
        payee: payee.trim() || undefined, method,
      });
      setOpen(false); setAmount(''); setDescription(''); setPayee('');
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={6}>
      {d ? (
        <>
          <Grid min={162}>
            <StatCard label={`Spent ${shortDate(d.from)} – ${shortDate(d.to)}`}
              value={cedis(d.total)} tone="warning" icon="note" />
            <StatCard label="Entries" value={(d.records || []).length} tone="data" icon="layers" />
            {d.unapproved ? (
              <StatCard label="Awaiting approval" value={d.unapproved} tone="danger" icon="alert" />
            ) : null}
          </Grid>

          {mayRecord ? (
            <Card><Button label="Record an expense" icon="plus" onPress={() => { setError(null); setOpen(true); }} /></Card>
          ) : null}

          {(d.categories || []).length ? (
            <Section title="Where it went" icon="chart">
              <Card padded={false}>
                <DataTable dense keyExtractor={(r) => r.category}
                  columns={[
                    { key: 'category', label: 'Category',
                      render: (r) => String(r.category).replace(/_/g, ' ') },
                    { key: 'n', label: 'Entries', align: 'right', width: 84 },
                    { key: 'total', label: 'Total', align: 'right', width: 128,
                      render: (r) => <Text style={{ ...type.small, fontWeight: '800',
                                                    fontVariant: ['tabular-nums'] }}>{cedis(r.total)}</Text> },
                  ]}
                  rows={d.categories} />
              </Card>
            </Section>
          ) : null}

          <Section title="Expenditure" icon="note" subtitle="Newest first.">
            {(d.records || []).length === 0 ? (
              <Card><EmptyState icon="note" title="Nothing recorded"
                message="No expenditure has been entered in this window." /></Card>
            ) : (
              <DataTable
                keyExtractor={(r) => String(r.id)}
                columns={[
                  { key: 'description', label: 'What for', render: (r) => (
                    <View>
                      <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                        {r.description}
                      </Text>
                      <Muted numberOfLines={1}>
                        {[String(r.category).replace(/_/g, ' '), r.payee_name].filter(Boolean).join(' · ')}
                      </Muted>
                    </View>
                  ) },
                  { key: 'date', label: 'Date', width: 96, render: (r) => shortDate(r.date) },
                  { key: 'approved', label: 'Signed off', width: 120,
                    render: (r) => (r.approved_by_name
                      ? <Badge label={r.approved_by_name} tone="success" />
                      : <Badge label="Waiting" tone="warning" />) },
                  { key: 'amount', label: 'Amount', align: 'right', width: 124,
                    render: (r) => <Text style={{ ...type.small, fontWeight: '800',
                                                  fontVariant: ['tabular-nums'] }}>{cedis(r.amount)}</Text> },
                ]}
                rows={d.records} />
            )}
          </Section>
        </>
      ) : null}

      <Sheet visible={open} onClose={() => setOpen(false)} title="Record an expense">
        <ErrorNote message={error} />
        <Muted>Somebody other than you approves it. That is the point.</Muted>
        <Select label="What it was spent on" value={category} onChange={setCategory}
          options={CATEGORIES.map(c => ({ label: c.replace(/_/g, ' '), value: c }))} />
        <Field label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <TextArea label="What the payment was for" value={description} onChangeText={setDescription}
          hint="A sentence somebody reading the books in a year will understand." />
        <Field label="Paid to" value={payee} onChangeText={setPayee} hint="Optional." />
        <Select label="How it was paid" value={method} onChange={setMethod}
          options={METHODS.map(m => ({ label: m, value: m }))} />
        <Button label={busy ? 'Recording…' : 'Record it'} disabled={busy} onPress={record} icon="check" />
      </Sheet>
    </OfficeScreen>
  );
}
