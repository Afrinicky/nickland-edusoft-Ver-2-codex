// Nickland Edusoft — Bulk Payment Sheet.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A class at a time, on collection day. When forty parents are outside, the
// office works down a sheet — it does not open forty forms.
//
// The same sheet as the installed application's, with the same columns and the
// same green amount column. What it captures is what a receipt needs: the
// payment purpose, the mode of payment and the transaction reference for
// anything that is not cash, set once at the top — on collection day forty
// parents pay the same way, and re-typing "Cash" forty times is not data entry,
// it is friction.
//
// A row that has been receipted shows its RECEIPT NUMBER, which is the thing a
// bursar actually wants: proof it went through, and a way back to the paper.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { useOfficeClasses } from '../../pickers';
import { cedis, termLabel, useOffice, OfficeScreen } from '../../office';
import {
  Select, DataTable, Muted, Badge, Button, Field, EmptyState,
  ErrorNote, SuccessNote, SearchField,
} from '../../ui';
import { Panel, Bar, StatRow, Stat } from '../../desk';
import { printHtml } from '../../print';
import { ReceiptView } from './receipt';
import { colors, spacing, type } from '../../theme';

const STATUSES = [
  { label: 'All Students', value: '' },
  { label: 'Paid in Full', value: 'paid_full' },
  { label: 'Partial Payment', value: 'paid_partial' },
  { label: 'Not Paid', value: 'unpaid' },
  { label: 'Not Billed', value: 'not_billed' },
];

export default function BulkPaySheet() {
  const { token, profile } = useAuth();
  const { classes } = useOfficeClasses(token);
  const may = can(profile, 'fees', 'create');

  const [config, setConfig] = useState({ purposes: [], methods: [], reference_required: [] });
  const [purpose, setPurpose] = useState('school_fees');
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');

  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [amounts, setAmounts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [lastPaid, setLastPaid] = useState({});
  const [busyAll, setBusyAll] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    api.paymentPurposes(token).then(r => r && r.ok && setConfig(r)).catch(() => {});
  }, [token]);

  const state = useOffice(
    (t) => (classId ? api.feesBulkSheet(t, classId) : Promise.resolve({ ok: true, rows: [] })),
    [classId]);


  const rows = state.data?.rows || state.data?.students || [];
  const needsReference = (config.reference_required || []).includes(method);
  const purposeLabel = config.purposes.find(p => p.key === purpose)?.label || 'School Fees';

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r =>
      (!status || r.status === status)
      && (!needle || `${r.surname} ${r.first_name} ${r.index_number}`.toLowerCase().includes(needle)));
  }, [rows, status, q]);

  const totals = useMemo(() => filtered.reduce((a, r) => ({
    gross: a.gross + (r.gross_billed || 0),
    discount: a.discount + (r.discount_amount || 0),
    net: a.net + (r.net_billed || 0),
    paid: a.paid + (r.fees_paid || 0),
    balance: a.balance + (r.balance || 0),
  }), { gross: 0, discount: 0, net: 0, paid: 0, balance: 0 }), [filtered]);

  const entered = Object.entries(amounts).filter(([, v]) => Number(v) > 0);
  const enteredTotal = entered.reduce((n, [, v]) => n + Number(v), 0);

  const take = useCallback(async (row) => {
    const amount = Number(amounts[row.student_id]);
    if (!(amount > 0)) return setError('Enter a positive amount before saving.');
    if (needsReference && !reference.trim()) {
      return setError(`A ${method.toLowerCase()} payment needs its transaction reference — `
        + 'put it in at the top of the sheet.');
    }
    setSavingId(row.student_id); setError(null);
    try {
      const res = await api.takePayment(token, {
        studentId: row.student_id, purpose,
        referenceId: purpose === 'school_fees' ? row.bill_id : undefined,
        amount, method, reference: reference.trim(),
      });
      setAmounts(prev => { const n = { ...prev }; delete n[row.student_id]; return n; });
      setLastPaid(prev => ({
        ...prev,
        [row.student_id]: {
          receiptNo: res.receipt_number, amount,
          paymentId: res.payment_id, source: res.source, receipt: res.receipt,
        },
      }));
      setNote(`${cedis(amount)} — receipt ${res.receipt_number}`);
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setSavingId(null); }
  }, [token, amounts, purpose, method, reference, needsReference, state]);

  async function takeAll() {
    if (!entered.length) return setError('Nothing typed in yet.');
    if (needsReference && !reference.trim()) {
      return setError(`A ${method.toLowerCase()} payment needs its transaction reference.`);
    }
    setBusyAll(true); setError(null);
    let done = 0;
    let lastError = null;
    const paid = {};
    for (const [studentId, value] of entered) {
      const row = rows.find(r => String(r.student_id) === String(studentId));
      try {
        const res = await api.takePayment(token, {
          studentId: Number(studentId), purpose,
          referenceId: purpose === 'school_fees' ? row?.bill_id : undefined,
          amount: Number(value), method, reference: reference.trim(),
        });
        done += 1;
        paid[studentId] = {
          receiptNo: res.receipt_number, amount: Number(value),
          paymentId: res.payment_id, source: res.source, receipt: res.receipt,
        };
      } catch (e) { lastError = e.message; }
    }
    setBusyAll(false);
    setLastPaid(prev => ({ ...prev, ...paid }));
    setAmounts({});
    if (done) setNote(`${done} payment(s) receipted — ${cedis(enteredTotal)}`);
    if (lastError) setError(`Some could not be taken: ${lastError}`);
    state.reload();
  }

  function showReceipt(row) {
    const lp = lastPaid[row.student_id];
    if (!lp) return;
    if (lp.receipt) return setReceipt(lp.receipt);
    api.paymentReceipt(token, lp.source, lp.paymentId)
      .then(r => setReceipt(r.receipt)).catch(e => setError(e.message));
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

  if (receipt) {
    return (
      <Panel>
        <ReceiptView receipt={receipt} busy={printing} onPrint={print}
                     onClose={() => setReceipt(null)} />
      </Panel>
    );
  }

  return (
    <OfficeScreen state={state} skeleton={6}>
      <ErrorNote message={error} />
      {note ? <SuccessNote message={note} /> : null}

      <Panel title="Bulk Payment Sheet"
             subtitle={`Enter payments quickly for an entire class · Term: ${termLabel(state.data?.term, '—')}`}>
        <Bar left={<>
          <View style={{ minWidth: 190 }}>
            <Select label="Class" value={classId} onChange={(v) => { setAmounts({}); setClassId(v); }}
                    placeholder="— Select Class —"
                    options={(classes || []).map(c => ({ label: c.name, value: String(c.id) }))} />
          </View>
          <View style={{ minWidth: 180 }}>
            <Select label="Filter by Status" value={status} onChange={setStatus} options={STATUSES} />
          </View>
          <View style={{ minWidth: 200 }}>
            <SearchField value={q} onChangeText={setQ} placeholder="Find a pupil" />
          </View>
        </>} />

        {/* What every payment on this sheet is for, and how it arrived. */}
        <Bar left={<>
          <View style={{ minWidth: 190 }}>
            <Select label="Payment purpose" value={purpose} onChange={setPurpose}
                    options={config.purposes.map(p => ({ label: p.label, value: p.key }))} />
          </View>
          <View style={{ minWidth: 180 }}>
            <Select label="Mode of payment" value={method} onChange={setMethod}
                    options={config.methods.map(m => ({ label: m, value: m }))} />
          </View>
          <View style={{ minWidth: 200 }}>
            <Field label={needsReference ? 'Reference (required)' : 'Reference (cash needs none)'}
                   value={reference} onChangeText={setReference}
                   editable={needsReference}
                   placeholder={needsReference ? 'Transaction ID or slip number' : '—'} />
          </View>
        </>} />

        <Muted>
          {`Every receipt written from this sheet is dated and timed automatically and carries `
           + `${profile?.full_name || profile?.username || 'your name'} as the person who took the money.`}
          {purpose !== 'school_fees'
            ? ` Amounts below are taken as ${purposeLabel}, not as school fees — the balances in the table are still the fees ones.`
            : ''}
        </Muted>
      </Panel>

      {classId && rows.length ? (
        <StatRow>
          <Stat index={0} label="Billed (Net)" icon="layers" tone="primary"
                value={cedis(totals.net)} note={`After ${cedis(totals.discount)} discounts`} />
          <Stat index={1} label="Collected" icon="check" tone="success"
                value={cedis(totals.paid)}
                note={`${rows.filter(r => r.status === 'paid_full').length} fully paid`} />
          <Stat index={2} label="Outstanding" icon="alert" tone="danger"
                value={cedis(totals.balance)}
                note={`${rows.filter(r => (r.balance || 0) > 0).length} debtors`} />
          <Stat index={3} label="Collection Rate" icon="trend" tone="data"
                value={`${totals.net > 0 ? Math.round((totals.paid / totals.net) * 100) : 0}%`} />
        </StatRow>
      ) : null}

      {!classId ? (
        <EmptyState icon="wallet" title="Select a class to begin"
                    message="On collection day the office works down a class, not through forty separate forms." />
      ) : (
        <Panel padded={false} title={`${filtered.length} pupil(s)`}
               subtitle="Type what each parent has handed over. Nothing is receipted until you press the row's button.">
          <View style={{ padding: spacing.lg }}>
            <DataTable
              keyExtractor={(r) => String(r.student_id)}
              empty="No students match the filter"
              columns={[
                { key: 'index_number', label: 'Index No.', width: 120 },
                { key: 'name', label: 'Name',
                  render: (r) => (
                    <Text numberOfLines={1} style={{ ...type.small, color: colors.text }}>
                      <Text style={{ fontWeight: '800' }}>{r.surname}</Text>
                      {`, ${r.first_name} ${r.other_names || ''}`.trimEnd()}
                    </Text>
                  ) },
                { key: 'gross_billed', label: 'Term Fees', align: 'right', width: 110,
                  render: (r) => cedis(r.gross_billed) },
                { key: 'discount_amount', label: 'Discount', align: 'right', width: 105,
                  render: (r) => ((r.discount_amount || 0) > 0
                    ? <Text style={{ ...type.small, color: '#15803D' }}>
                        {`− ${cedis(r.discount_amount)}`}
                      </Text>
                    : <Muted>—</Muted>) },
                { key: 'net_billed', label: 'Net Billed', align: 'right', width: 115,
                  render: (r) => (
                    <Text style={{ ...type.small, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                      {cedis(r.net_billed)}
                    </Text>
                  ) },
                { key: 'fees_paid', label: 'Total Paid', align: 'right', width: 115,
                  render: (r) => (
                    <Text style={{ ...type.small, color: '#15803D', fontVariant: ['tabular-nums'] }}>
                      {cedis(r.fees_paid)}
                    </Text>
                  ) },
                { key: 'balance', label: 'Balance', align: 'right', width: 115,
                  render: (r) => (
                    <Text style={{
                      ...type.small, fontWeight: '800',
                      color: (r.balance || 0) > 0 ? colors.danger : '#15803D',
                      fontVariant: ['tabular-nums'],
                    }}>{cedis(r.balance)}</Text>
                  ) },
                { key: 'status', label: 'Status', width: 110,
                  render: (r) => <Badge tone={statusTone(r.status)} label={statusLabel(r.status)} /> },
                { key: 'pay', label: 'Amount Paid Now', align: 'right', width: 150,
                  render: (r) => (
                    <View style={{ width: 130 }}>
                      <Field label="" value={amounts[r.student_id] || ''}
                             keyboardType="decimal-pad" placeholder="0.00"
                             editable={!(purpose === 'school_fees' && r.status === 'not_billed')}
                             onChangeText={(v) => setAmounts(a => ({ ...a, [r.student_id]: v }))} />
                    </View>
                  ) },

                // Labelled, never iconography at 45% opacity.
                { key: 'act', label: 'Actions', width: 210, render: (r) => {
                  const has = Number(amounts[r.student_id]) > 0;
                  const lp = lastPaid[r.student_id];
                  const saving = savingId === r.student_id;
                  if (has || saving) {
                    return (
                      <Button title={saving ? 'Saving…' : `Take ${cedis(Number(amounts[r.student_id]) || 0)}`}
                              icon="check" size="sm" full={false} busy={saving} disabled={saving}
                              onPress={() => take(r)} />
                    );
                  }
                  if (lp) {
                    return (
                      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                        <Badge tone="success" label={lp.receiptNo} />
                        <Button title="View receipt" size="sm" variant="outline" full={false}
                                onPress={() => showReceipt(r)} />
                      </View>
                    );
                  }
                  return <Muted>Type an amount to take a payment</Muted>;
                } },
              ]}
              rows={filtered} />
          </View>
        </Panel>
      )}

      {/* The whole column at once — the office's own instruction on collection
          day is "take them all". */}
      {entered.length ? (
        <Panel>
          <Bar left={(
            <View style={{ minWidth: 240 }}>
              <Text style={{ ...type.heading, color: colors.text }}>
                {`${entered.length} payment(s) typed in · ${cedis(enteredTotal)}`}
              </Text>
              <Muted>
                {`As ${purposeLabel}, paid by ${method}${reference ? ` · ref ${reference}` : ''}. `
                 + 'Nothing is receipted until you press this.'}
              </Muted>
            </View>
          )}
          right={<>
            <Button title="Clear the column" variant="ghost" full={false}
                    onPress={() => setAmounts({})} />
            <Button title={busyAll ? 'Receipting…' : `Receipt all ${entered.length}`}
                    icon="check" full={false} busy={busyAll} disabled={busyAll} onPress={takeAll} />
          </>} />
        </Panel>
      ) : null}
    </OfficeScreen>
  );
}

function statusTone(s) {
  return { paid_full: 'success', paid_partial: 'warning', unpaid: 'danger' }[s] || 'data';
}
function statusLabel(s) {
  return { paid_full: 'Full', paid_partial: 'Partial', unpaid: 'None', not_billed: 'No Bill' }[s] || s;
}
