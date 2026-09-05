// Nickland Edusoft — Taking one payment.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The counter's screen, matching the installed application's field for field.
// A parent arrives, says who they are and what they have come to pay for,
// hands over money, and leaves with a receipt. Everything here exists because
// one of those four steps needs it.
//
// ── Finding the pupil ───────────────────────────────────────────────────────
//
// A search box alone is not enough at a counter. What the person taking money
// actually has in front of them is "the Basic 5 parents, the ones still owing",
// so the roll narrows by class and by whether there is a balance, and each row
// already carries what is owed — opening a record to find that out is what
// makes a queue.
//
// ── What is captured ────────────────────────────────────────────────────────
//
// The payment purpose (school fees, books, canteen, transport, an extra
// charge), the amount, how it was paid and — for anything but cash — the
// transaction reference, which is enforced rather than suggested. The date, the
// time and who took the money are the clock and the signed-in account, never
// typed in.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { useOfficeClasses } from '../../pickers';
import { cedis, shortDate } from '../../office';
import {
  Select, SearchField, DataTable, Muted, ChoiceRow, EmptyState, ErrorNote, SuccessNote,
  Button, Field, Loading, Divider,
} from '../../ui';
import { Panel, Bar } from '../../desk';
import { useLayout } from '../../responsive';
import { printHtml } from '../../print';
import { ReceiptView } from './receipt';
import { colors, spacing, type } from '../../theme';

const OWING = [
  { label: 'Everyone', value: '' },
  { label: 'Still owing', value: 'owing' },
  { label: 'Settled up', value: 'settled' },
  { label: 'Not billed yet', value: 'unbilled' },
];

export default function TakePayment() {
  const { token, profile } = useAuth();
  const { classes } = useOfficeClasses(token);
  const layout = useLayout();
  const wide = layout.isDesktop;
  const may = can(profile, 'fees', 'create');

  const [config, setConfig] = useState({ purposes: [], methods: [], reference_required: [] });
  const [q, setQ] = useState('');
  const [classId, setClassId] = useState('');
  const [owing, setOwing] = useState('');
  const [roll, setRoll] = useState(null);
  const [error, setError] = useState(null);

  const [selected, setSelected] = useState(null);
  const [account, setAccount] = useState(null);

  const [purpose, setPurpose] = useState('school_fees');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [note, setNote] = useState(null);

  useEffect(() => {
    api.paymentPurposes(token)
      .then(r => { if (r && r.ok) setConfig(r); })
      .catch(e => setError(e.message));
  }, [token]);

  // Debounced: typing a surname must not be one query a keystroke against a
  // school of eight hundred.
  useEffect(() => {
    let live = true;
    const id = setTimeout(async () => {
      try {
        const r = await api.paymentStudents(token, {
          q: q.trim() || undefined,
          classId: classId || undefined,
          owing: owing || undefined,
        });
        if (live) setRoll(r.students || []);
      } catch (e) { if (live) { setError(e.message); setRoll([]); } }
    }, 220);
    return () => { live = false; clearTimeout(id); };
  }, [token, q, classId, owing]);

  const open = useCallback(async (student) => {
    setSelected(student);
    setReceipt(null);
    setAccount(null);
    setError(null);
    try {
      const r = await api.paymentAccount(token, student.id);
      setAccount(r);
      const biggest = (r.accounts || [])
        .filter(a => a.payable && (a.balance || 0) > 0)
        .sort((a, b) => b.balance - a.balance)[0];
      if (biggest) { setPurpose(biggest.purpose); setAmount(String(biggest.balance)); }
      else setAmount('');
    } catch (e) { setError(e.message); }
  }, [token]);

  const chosen = useMemo(
    () => (account?.accounts || []).find(a => a.purpose === purpose) || null,
    [account, purpose]);

  const needsReference = (config.reference_required || []).includes(method);

  async function take() {
    if (!selected) return setError('Choose the pupil first.');
    const value = Number(amount);
    if (!(value > 0)) return setError('Enter the amount handed over.');
    if (needsReference && !reference.trim()) {
      return setError(`A ${method.toLowerCase()} payment needs its transaction reference.`);
    }
    setBusy(true); setError(null); setNote(null);
    try {
      const res = await api.takePayment(token, {
        studentId: selected.id,
        purpose,
        referenceId: chosen?.reference_id || undefined,
        amount: value,
        method,
        reference: reference.trim(),
        notes: notes.trim(),
      });
      setReceipt(res.receipt);
      setAmount(''); setReference(''); setNotes('');
      const sent = (res.delivered || []).length ? ` · sent by ${res.delivered.join(' & ')}` : '';
      setNote(`${cedis(value)} receipted — ${res.receipt_number}${sent}`);
      open(selected);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function print() {
    if (!receipt) return;
    setPrinting(true);
    try {
      const doc = await api.receiptHtml(token, receipt.source, receipt.payment_id,
        { purpose: receipt.purpose });
      await printHtml(doc);
    } catch (e) { setError(e.message); }
    finally { setPrinting(false); }
  }

  if (!may) {
    return <EmptyState icon="lock" title="Taking payments is not yours"
                       message="Your account can see what is owed but not receipt a payment." />;
  }

  const finder = (
    <Panel padded={false} title="Who is paying"
           subtitle={roll === null ? 'Looking…' : `${roll.length} pupil(s)${owing === 'owing' ? ' still owing' : ''}`}>
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Bar left={<>
          <View style={{ flex: 2, minWidth: 200 }}>
            <SearchField value={q} onChangeText={setQ}
                         placeholder="Surname, first name or admission number" />
          </View>
          <View style={{ minWidth: 160 }}>
            <Select label="" value={classId} onChange={setClassId} placeholder="Every class"
                    options={[{ label: 'Every class', value: '' },
                              ...(classes || []).map(c => ({ label: c.name, value: String(c.id) }))]} />
          </View>
          <View style={{ minWidth: 150 }}>
            <Select label="" value={owing} onChange={setOwing} options={OWING} />
          </View>
        </>} />

        {roll === null ? <Loading label="Reading the roll…" /> : (
          <DataTable
            keyExtractor={(r) => String(r.id)}
            onRowPress={open}
            empty="Nobody matches that. Try a different spelling, or clear the filters."
            columns={[
              { key: 'index_number', label: 'Index No', width: 120 },
              { key: 'name', label: 'Pupil',
                render: (r) => (
                  <View style={{ minWidth: 0 }}>
                    <Text numberOfLines={1} style={{
                      ...type.small, fontWeight: '700',
                      color: selected?.id === r.id ? colors.primary : colors.text,
                    }}>{`${r.surname || ''} ${r.first_name || ''}`.trim()}</Text>
                    <Muted numberOfLines={1}>{r.class_name}</Muted>
                  </View>
                ) },
              { key: 'fees_balance', label: 'Fees owing', align: 'right', width: 130,
                render: (r) => (r.bill_id ? (
                  <Text style={{
                    ...type.small, fontWeight: '700',
                    color: (r.fees_balance || 0) > 0 ? colors.danger : '#15803D',
                    fontVariant: ['tabular-nums'],
                  }}>{cedis(r.fees_balance)}</Text>
                ) : <Muted>no bill</Muted>) },
            ]}
            rows={roll} />
        )}
      </View>
    </Panel>
  );

  const desk = (
    <View style={{ gap: spacing.md }}>
      {receipt ? (
        <Panel>
          <ReceiptView receipt={receipt} busy={printing} onPrint={print}
                       onClose={() => setReceipt(null)} />
        </Panel>
      ) : null}

      {!selected ? (
        <EmptyState icon="wallet" title="Nobody chosen"
                    message="Pick a pupil on the left. What they owe — school fees, books, the canteen, the bus — comes up here, and one form takes the money for any of it." />
      ) : (
        <>
          <Panel title={`${selected.surname || ''} ${selected.first_name || ''}`.trim()}
                 subtitle={[selected.index_number, selected.class_name, account?.student?.contact]
                   .filter(Boolean).join(' · ')}
                 right={(
                   <View style={{ alignItems: 'flex-end' }}>
                     <Muted>Owed in total</Muted>
                     <Text style={{
                       ...type.heading,
                       color: (account?.total_balance || 0) > 0 ? colors.danger : '#15803D',
                     }}>{cedis(account?.total_balance || 0)}</Text>
                   </View>
                 )}>
            {/* What they owe, purpose by purpose. Tapping one chooses the
                purpose and fills in the balance — nobody at a counter wants to
                read a dropdown and a balance table and match them by eye. */}
            <View style={{ gap: 6 }}>
              {(account?.accounts || []).map(a => (
                <ChoiceRow key={a.purpose}
                           selected={purpose === a.purpose}
                           disabled={!a.payable}
                           title={a.label}
                           subtitle={a.note
                             + (a.billed > 0 && a.paid != null
                               ? ` · ${cedis(a.paid)} of ${cedis(a.billed)} paid` : '')}
                           right={(
                             <Text style={{
                               ...type.body, fontWeight: '800', fontVariant: ['tabular-nums'],
                               color: (a.balance || 0) > 0 ? colors.danger : colors.text,
                             }}>
                               {a.balance == null ? 'on the term bill' : cedis(a.balance)}
                             </Text>
                           )}
                           onSelect={() => {
                             setPurpose(a.purpose);
                             if (a.balance != null && a.balance > 0) setAmount(String(a.balance));
                           }} />
              ))}
              {!account ? <Loading label="Reading the account…" /> : null}
            </View>
          </Panel>

          <Panel title="The payment">
            <ErrorNote message={error} />
            {note ? <SuccessNote message={note} /> : null}

            <Select label="Payment purpose" value={purpose} onChange={setPurpose}
                    hint={config.purposes.find(p => p.key === purpose)?.note}
                    options={config.purposes.map(p => ({ label: p.label, value: p.key }))} />

            <Field label="Amount handed over" value={amount} onChangeText={setAmount}
                   keyboardType="decimal-pad" placeholder="0.00"
                   hint={chosen && chosen.balance != null
                     ? (chosen.balance > 0
                       ? `Outstanding ${cedis(chosen.balance)}`
                       : 'Settled — anything taken now stays as credit')
                     : undefined} />
            {chosen && chosen.balance > 0 ? (
              <Button title={`Pay all ${cedis(chosen.balance)}`} variant="ghost" size="sm"
                      full={false} onPress={() => setAmount(String(chosen.balance))} />
            ) : null}

            <Select label="Mode of payment" value={method} onChange={setMethod}
                    options={config.methods.map(m => ({ label: m, value: m }))} />

            <Field label={needsReference ? 'Reference (required)' : 'Reference (optional)'}
                   value={reference} onChangeText={setReference}
                   editable={needsReference || method !== 'Cash'}
                   placeholder={needsReference ? 'Transaction ID from the SMS or slip' : 'Not needed for cash'}
                   hint={needsReference
                     ? 'Without it there is nothing to check against when the payment is queried.'
                     : undefined} />

            <Field label="Note (optional)" value={notes} onChangeText={setNotes}
                   placeholder="Anything the receipt should say" />

            <Divider />
            <Muted>
              {`Dated ${shortDate(new Date().toISOString().slice(0, 10))} at `
               + `${new Date().toTimeString().slice(0, 5)} · received by `
               + `${profile?.full_name || profile?.username || 'you'} · receipt prints on `
               + `${paperLabel(config.paper_size)}`}
            </Muted>

            <Button title={busy ? 'Recording…' : `Take ${amount ? cedis(Number(amount) || 0) : 'the payment'}`}
                    icon="check" busy={busy} disabled={busy || !amount} onPress={take} />
          </Panel>

          {(account?.history || []).length ? (
            <Panel padded={false} title="What this pupil has already paid">
              <View style={{ padding: spacing.lg }}>
                <DataTable
                  keyExtractor={(r) => `${r.source}-${r.id}`}
                  columns={[
                    { key: 'receipt_number', label: 'Receipt', width: 140 },
                    { key: 'source', label: 'For', width: 120, render: (r) => sourceLabel(r.source) },
                    { key: 'payment_date', label: 'Date', width: 110,
                      render: (r) => shortDate(r.payment_date) },
                    { key: 'payment_method', label: 'How', width: 130,
                      render: (r) => (
                        <View style={{ minWidth: 0 }}>
                          <Text style={{ ...type.small, color: colors.text }}>{r.payment_method}</Text>
                          {r.reference ? <Muted numberOfLines={1}>{r.reference}</Muted> : null}
                        </View>
                      ) },
                    { key: 'amount', label: 'Amount', align: 'right', width: 120,
                      render: (r) => (
                        <Text style={{
                          ...type.small, fontWeight: '700', color: '#15803D',
                          fontVariant: ['tabular-nums'],
                        }}>{cedis(r.amount)}</Text>
                      ) },
                  ]}
                  rows={account.history} />
              </View>
            </Panel>
          ) : null}
        </>
      )}
    </View>
  );

  // A phone stacks; a desk puts the roll beside the form, because the counter
  // is looking at both at once.
  if (!wide) {
    return (
      <View style={{ gap: spacing.md }}>
        <ErrorNote message={error} />
        {selected ? desk : finder}
        {selected ? (
          <Button title="← Choose somebody else" variant="ghost"
                  onPress={() => { setSelected(null); setAccount(null); setReceipt(null); }} />
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' }}>
      <View style={{ flex: 1.1, minWidth: 340 }}>
        <ErrorNote message={error} />
        {finder}
      </View>
      <View style={{ flex: 1, minWidth: 340 }}>{desk}</View>
    </View>
  );
}

function sourceLabel(source) {
  return { fees: 'School fees', books: 'Books', canteen: 'Canteen', transport: 'Transport' }[source] || source;
}

function paperLabel(size) {
  return {
    roll80: 'an 80 mm thermal roll', roll58: 'a 58 mm thermal roll',
    A4: 'A4', A5: 'A5', Letter: 'Letter paper',
  }[size] || 'an 80 mm thermal roll';
}
