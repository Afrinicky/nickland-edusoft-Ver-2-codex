// Taking money, and the day's receipts.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The one screen in the app that turns a figure into money in the school's
// books. Everything about it is arranged so the person using it can see what
// they are about to do before they do it: the pupil is chosen from a search
// that shows what they owe, the amount is checked against that balance, and
// the receipt number comes back on screen so it can be written on the slip.
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { can } from '../../src/guard';
import { OfficeScreen, cedis, shortDate, useOffice } from '../../src/office';
import {
  Card, Section, Muted, Button, Field, Select, SearchField, ListRow, EmptyState,
  DataTable, Badge, Sheet, ErrorNote, InfoNote, StatCard, Grid,
} from '../../src/ui';
import { colors, spacing, type } from '../../src/theme';

const METHODS = ['Cash', 'Mobile Money', 'Bank Transfer', 'Cheque'];

export default function Collections() {
  const { token, profile } = useAuth();
  const router = useRouter();
  const state = useOffice((t) => api.financeCollections(t));

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const mayTake = can(profile, 'fees', 'create');

  async function search(text) {
    setQ(text);
    if (text.trim().length < 2) { setFound(null); return; }
    try { setFound((await api.financeStudents(token, { q: text.trim() })).students || []); }
    catch (e) { setError(e.message); }
  }

  async function take() {
    setError(null);
    const value = Number(amount);
    if (!chosen) return setError('Choose the pupil the payment is for.');
    if (!(value > 0)) return setError('Enter an amount greater than zero.');
    // Checked here as well as on the server, so somebody keying in a hurry is
    // stopped before the receipt is issued rather than after.
    if (chosen.balance > 0 && value > chosen.balance) {
      return setError(`${chosen.name} owes ${cedis(chosen.balance)}. Enter that or less, or take the extra at the office.`);
    }
    setBusy(true);
    try {
      const r = await api.financeTakePayment(token, {
        studentId: chosen.id, amount: value, method, reference: reference || undefined,
      });
      setReceipt(r);
      setOpen(false);
      setChosen(null); setAmount(''); setReference(''); setQ(''); setFound(null);
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const d = state.data;

  return (
    <OfficeScreen state={state} skeleton={6}>
      {receipt ? (
        <Card tone="success">
          <Text style={{ ...type.body, fontWeight: '800', color: colors.text }}>
            Receipt {receipt.receipt_number}
          </Text>
          <Muted>{cedis(receipt.amount)} recorded. Write the number on the slip.</Muted>
          <Button label="Done" tone="ghost" size="sm" onPress={() => setReceipt(null)} />
        </Card>
      ) : null}

      {d ? (
        <>
          <Grid min={162}>
            <StatCard label={`Taken ${shortDate(d.from)} – ${shortDate(d.to)}`}
              value={cedis(d.total)} tone="success" icon="wallet" />
            <StatCard label="Receipts" value={d.count} tone="data" icon="check" />
          </Grid>

          {mayTake ? (
            <Card>
              <Button label="Take a payment" icon="plus" onPress={() => { setError(null); setOpen(true); }} />
            </Card>
          ) : (
            <InfoNote message="This account may read the day's collections but not take a payment." />
          )}

          <Section title="Receipts" icon="check" subtitle="Newest first.">
            {(d.payments || []).length === 0 ? (
              <Card><EmptyState icon="wallet" title="Nothing yet"
                message="No fee payment has been recorded in this window." /></Card>
            ) : (
              <DataTable
                keyExtractor={(r) => String(r.id)}
                columns={[
                  { key: 'student', label: 'Pupil', render: (r) => (
                    <View>
                      <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                        {r.student_name}
                      </Text>
                      <Muted numberOfLines={1}>{`${r.receipt_number} · ${r.class_name || ''}`}</Muted>
                    </View>
                  ) },
                  { key: 'payment_date', label: 'Date', width: 96, render: (r) => shortDate(r.payment_date) },
                  { key: 'payment_method', label: 'How', width: 120 },
                  { key: 'amount', label: 'Amount', align: 'right', width: 128, render: (r) => (
                    <Text style={{
                      ...type.small, fontWeight: '800', fontVariant: ['tabular-nums'],
                      color: r.is_reversed ? colors.faint : colors.success,
                      textDecorationLine: r.is_reversed ? 'line-through' : 'none',
                    }}>{cedis(r.amount)}</Text>
                  ) },
                ]}
                rows={d.payments}
                onRowPress={(r) => router.push(`/finance/student/${r.student_id}`)}
              />
            )}
          </Section>
        </>
      ) : null}

      <Sheet visible={open} onClose={() => setOpen(false)} title="Take a payment">
        <ErrorNote message={error} />
        {chosen ? (
          <Card tone="primary">
            <Text style={{ ...type.body, fontWeight: '800', color: colors.text }}>{chosen.name}</Text>
            <Muted>{`${chosen.class_name || ''} · ${chosen.index_number || ''}`}</Muted>
            <Text style={{ ...type.small, marginTop: 6, fontWeight: '700',
                           color: chosen.balance > 0 ? colors.danger : colors.success }}>
              {chosen.balance > 0 ? `Owes ${cedis(chosen.balance)}` : 'Nothing outstanding'}
            </Text>
            <Button label="Choose somebody else" tone="ghost" size="sm" onPress={() => setChosen(null)} />
          </Card>
        ) : (
          <>
            <SearchField value={q} onChangeText={search} placeholder="Surname, first name or admission number" />
            {(found || []).slice(0, 12).map((s, i) => (
              <ListRow key={s.id} title={s.name}
                subtitle={`${s.class_name || ''} · ${s.index_number || ''}`}
                right={<Text style={{ ...type.small, fontWeight: '700',
                                      color: s.balance > 0 ? colors.danger : colors.muted }}>
                  {s.balance > 0 ? cedis(s.balance) : '—'}</Text>}
                onPress={() => { setChosen(s); setAmount(s.balance > 0 ? String(s.balance) : ''); }}
                last={i === Math.min(11, (found || []).length - 1)} />
            ))}
            {found && found.length === 0 ? <Muted>Nobody matches that.</Muted> : null}
          </>
        )}

        {chosen ? (
          <>
            <Field label="Amount" value={amount} onChangeText={setAmount}
              keyboardType="decimal-pad" hint="In cedis." />
            <Select label="How it was paid" value={method} onChange={setMethod}
              options={METHODS.map(m => ({ label: m, value: m }))} />
            <Field label="Reference" value={reference} onChangeText={setReference}
              hint="Optional — a momo or deposit reference, so it can be found later." />
            <Button label={busy ? 'Recording…' : 'Record the payment'}
              disabled={busy} onPress={take} icon="check" />
          </>
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}
