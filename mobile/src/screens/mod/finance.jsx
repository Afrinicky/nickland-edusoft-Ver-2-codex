// Finance — the ledgers, the cashbook, the audit and the budgets.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Fees are money the school is OWED. Finance is money the school HAS: what came
// in from every source, what went out, and whether the two agree. They are
// different modules on the desktop for that reason, and they are here.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { OfficeScreen, cedis, shortDate, useOffice } from '../../office';
import {
  Select, DataTable, Muted, Badge, EmptyState, ErrorNote, SuccessNote, Button,
  Sheet, Field, TextArea, Loading, Divider, ProgressBar, SearchField,
} from '../../ui';
import { Panel, Bar, StatRow, Stat } from '../../desk';
import { todayISO } from '../../pickers';
import { colors, spacing, type } from '../../theme';

const INCOME_CATEGORIES = ['School fees', 'Canteen', 'Transport', 'Books', 'Donation',
                           'Grant', 'Rent', 'Other'];
const EXPENSE_CATEGORIES = ['Salaries', 'Utilities', 'Maintenance', 'Stationery', 'Food',
                            'Transport', 'Rent', 'Statutory', 'Other'];

// ── Income ──────────────────────────────────────────────────────────────────

export function Income() {
  const { token, profile } = useAuth();
  const [adding, setAdding] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [category, setCategory] = useState('');
  const state = useOffice((t) => api.financeIncome(t, { category: category || undefined }), [category]);
  const may = can(profile, 'finance', 'create');

  const rows = state.data?.income || state.data?.records || [];
  const total = rows.reduce((n, r) => n + (Number(r.amount) || 0), 0);

  async function save() {
    setBusy(true); setError(null); setDone(null);
    try {
      await api.financeRecordIncome(token, {
        category: adding.category, amount: Number(adding.amount) || 0,
        description: adding.description || null,
        payerName: adding.payer_name || null,
        paymentMethod: adding.payment_method || 'Cash',
        transactionDate: adding.transaction_date || todayISO(),
      });
      setDone(`${cedis(adding.amount)} recorded.`);
      setAdding(null);
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      {done ? <SuccessNote message={done} /> : null}

      <StatRow>
        <Stat index={0} label="Income this term" icon="cash" tone="success" value={cedis(total)}
              note={`${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`} />
      </StatRow>

      <Bar left={<View style={{ minWidth: 220 }}>
        <Select label="Category" value={category} onChange={setCategory} placeholder="Everything"
                options={[{ label: 'Everything', value: '' },
                          ...INCOME_CATEGORIES.map(c => ({ label: c, value: c }))]} />
      </View>}
      right={may ? <Button title="Record income" icon="plus" full={false}
                           onPress={() => setAdding({ category: 'Other', payment_method: 'Cash',
                                                      transaction_date: todayISO() })} /> : null} />

      <Panel padded={false} title="Money in"
             subtitle="Fees post themselves here as they are receipted. Everything else is entered.">
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r, i) => String(r.id ?? i)}
            empty="Nothing has come in this term."
            columns={[
              { key: 'transaction_date', label: 'Date', width: 110,
                render: (r) => shortDate(r.transaction_date || r.date) },
              { key: 'category', label: 'Category', width: 150 },
              { key: 'description', label: 'What it was' },
              { key: 'payer_name', label: 'From', width: 160 },
              { key: 'amount', label: 'Amount', align: 'right', width: 130,
                render: (r) => (
                  <Text style={{ ...type.small, fontWeight: '700', color: colors.success }}>
                    {cedis(r.amount)}
                  </Text>
                ) },
            ]}
            rows={rows} />
        </View>
      </Panel>

      <Sheet visible={!!adding} onClose={() => setAdding(null)} title="Record income">
        {adding ? (
          <>
            <Muted>Anything that is not a fee receipt: a donation, rent, a grant.</Muted>
            <Select label="Category" value={adding.category}
                    onChange={(v) => setAdding(a => ({ ...a, category: v }))}
                    options={INCOME_CATEGORIES.map(c => ({ label: c, value: c }))} />
            <Field label="Amount" value={String(adding.amount ?? '')}
                   onChangeText={(v) => setAdding(a => ({ ...a, amount: v }))} />
            <Field label="From whom" value={adding.payer_name || ''}
                   onChangeText={(v) => setAdding(a => ({ ...a, payer_name: v }))} />
            <Field label="Date" value={adding.transaction_date || ''}
                   onChangeText={(v) => setAdding(a => ({ ...a, transaction_date: v }))} hint="YYYY-MM-DD" />
            <Select label="How" value={adding.payment_method}
                    onChange={(v) => setAdding(a => ({ ...a, payment_method: v }))}
                    options={['Cash', 'Bank Transfer', 'Mobile Money', 'Cheque']
                      .map(m => ({ label: m, value: m }))} />
            <TextArea label="What it was for" value={adding.description || ''}
                      onChangeText={(v) => setAdding(a => ({ ...a, description: v }))} />
            <Button title={busy ? 'Recording…' : 'Record it'} busy={busy} disabled={busy} onPress={save} />
          </>
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}

// ── The cashbook ────────────────────────────────────────────────────────────

export function Cashbook() {
  const state = useOffice((t) => api.cashbook(t));
  const d = state.data;
  const rows = d?.entries || [];

  return (
    <OfficeScreen state={state} skeleton={6}>
      <StatRow>
        <Stat index={0} label="In" icon="cash" tone="success" value={cedis(d?.total_in)}
              note={d ? `From ${shortDate(d.from)}` : ''} />
        <Stat index={1} label="Out" icon="wallet" tone="danger" value={cedis(d?.total_out)}
              note={d ? `To ${shortDate(d.to)}` : ''} />
        <Stat index={2} label="Closing balance" icon="chart"
              tone={(d?.closing_balance ?? 0) >= 0 ? 'primary' : 'danger'}
              value={cedis(d?.closing_balance)}
              note="What the two ledgers say is left" />
      </StatRow>

      <Panel padded={false} title="The cashbook"
             subtitle="Every entry in date order, with the balance after it. The first thing an auditor asks for.">
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r, i) => String(i)}
            empty="Nothing has moved this term."
            columns={[
              { key: 'date', label: 'Date', width: 110, render: (r) => shortDate(r.date) },
              { key: 'description', label: 'Entry',
                render: (r) => r.description || r.category || '—' },
              { key: 'category', label: 'Category', width: 150 },
              { key: 'in', label: 'In', align: 'right', width: 120,
                render: (r) => (r.kind === 'income'
                  ? <Text style={{ ...type.small, fontWeight: '700', color: colors.success }}>{cedis(r.amount)}</Text>
                  : <Muted>—</Muted>) },
              { key: 'out', label: 'Out', align: 'right', width: 120,
                render: (r) => (r.kind === 'expense'
                  ? <Text style={{ ...type.small, fontWeight: '700', color: colors.danger }}>{cedis(r.amount)}</Text>
                  : <Muted>—</Muted>) },
              { key: 'balance', label: 'Balance', align: 'right', width: 140,
                render: (r) => (
                  <Text style={{ ...type.small, fontWeight: '800', color: colors.text }}>{cedis(r.balance)}</Text>
                ) },
            ]}
            rows={rows} />
        </View>
      </Panel>
    </OfficeScreen>
  );
}

// ── Audit & tracker ─────────────────────────────────────────────────────────

export function FinanceAudit() {
  const state = useOffice((t) => api.financeAudit(t));
  const d = state.data;
  const checks = d?.checks || d?.discrepancies || [];
  const clean = checks.every(c => c.ok !== false && !c.difference);

  return (
    <OfficeScreen state={state} skeleton={5}>
      <StatRow>
        <Stat index={0} label="Fees receipted" icon="check" tone="primary"
              value={cedis(d?.fees_collected)} note="From the payments table" />
        <Stat index={1} label="Posted to the ledger" icon="chart" tone="data"
              value={cedis(d?.ledger_income)} note="What the income ledger holds" />
        <Stat index={2} label="Difference" icon={clean ? 'check' : 'alert'}
              tone={clean ? 'success' : 'danger'}
              value={cedis(d?.difference ?? 0)}
              note={clean ? 'The two agree' : 'The two do not agree'} />
      </StatRow>

      <Panel title="What this checks"
             subtitle="Every receipt written should appear once in the income ledger, and nowhere twice.">
        <Muted>
          A fee receipt posts itself to the ledger as it is written. When the two figures differ,
          something was recorded by hand that should not have been, or a posting failed and was
          never retried. Both are worth an hour of somebody's time; neither is visible from a
          balance alone.
        </Muted>
      </Panel>

      {checks.length ? (
        <Panel padded={false} title="Line by line">
          <View style={{ padding: spacing.lg }}>
            <DataTable
              keyExtractor={(r, i) => String(r.id ?? i)}
              columns={[
                { key: 'label', label: 'Check', render: (r) => r.label || r.name || r.category },
                { key: 'expected', label: 'Expected', align: 'right', width: 140,
                  render: (r) => cedis(r.expected) },
                { key: 'found', label: 'Found', align: 'right', width: 140,
                  render: (r) => cedis(r.found ?? r.actual) },
                { key: 'difference', label: 'Difference', align: 'right', width: 140,
                  render: (r) => (
                    <Text style={{ ...type.small, fontWeight: '700',
                                   color: Number(r.difference) ? colors.danger : colors.success }}>
                      {cedis(r.difference)}
                    </Text>
                  ) },
              ]}
              rows={checks} />
          </View>
        </Panel>
      ) : null}
    </OfficeScreen>
  );
}

// ── Budgets ─────────────────────────────────────────────────────────────────

export function Budgets() {
  const { token, profile } = useAuth();
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const state = useOffice((t) => api.budgets(t));
  const may = can(profile, 'finance', 'edit');
  const rows = state.data?.budgets || [];

  async function open(row) {
    setError(null);
    try {
      const r = await api.budgets(token, row.id);
      const b = r.budget || r;
      setEditing({ ...b, items: b.items || [] });
    } catch (e) { setError(e.message); }
  }

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.saveBudget(token, {
        id: editing.id || undefined,
        title: editing.title,
        budget_type: editing.budget_type || 'term',
        period_label: editing.period_label || null,
        notes: editing.notes || null,
        status: editing.status || 'draft',
        items: (editing.items || [])
          .filter(i => String(i.description || '').trim())
          .map(i => ({
            item_type: i.item_type || 'expense',
            category: i.category || 'Other',
            description: i.description,
            projected_amount: Number(i.projected_amount) || 0,
            actual_amount: Number(i.actual_amount) || 0,
          })),
      });
      setEditing(null);
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={4}>
      <ErrorNote message={error} />
      <Bar left={<Muted>What the school planned to spend, against what it did. A statement says what happened; a budget says whether that was the intention.</Muted>}
           right={may ? <Button title="New budget" icon="plus" full={false}
                                onPress={() => setEditing({ budget_type: 'term', status: 'draft',
                                                            items: [{ item_type: 'expense', description: '', projected_amount: '' }] })} /> : null} />

      {rows.length === 0 ? (
        <EmptyState icon="chart" title="No budgets yet"
                    message="Write one for the term: what you expect to come in, what you expect to spend, and on what." />
      ) : (
        <Panel padded={false}>
          <View style={{ padding: spacing.lg }}>
            <DataTable
              keyExtractor={(r) => String(r.id)}
              onRowPress={open}
              columns={[
                { key: 'title', label: 'Budget', render: (r) => (
                  <View style={{ minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>{r.title}</Text>
                    <Muted numberOfLines={1}>{r.term_label || r.period_label || r.budget_type}</Muted>
                  </View>
                ) },
                { key: 'planned_income', label: 'Planned in', align: 'right', width: 140,
                  render: (r) => cedis(r.planned_income) },
                { key: 'planned_expense', label: 'Planned out', align: 'right', width: 140,
                  render: (r) => cedis(r.planned_expense) },
                { key: 'actual_expense', label: 'Spent', align: 'right', width: 140,
                  render: (r) => (
                    <Text style={{ ...type.small, fontWeight: '700',
                                   color: Number(r.actual_expense) > Number(r.planned_expense)
                                     ? colors.danger : colors.text }}>
                      {cedis(r.actual_expense)}
                    </Text>
                  ) },
                { key: 'status', label: 'Status', align: 'right', width: 120,
                  render: (r) => <Badge tone={r.status === 'active' ? 'success' : 'neutral'}
                                        label={r.status || 'draft'} /> },
              ]}
              rows={rows} />
          </View>
        </Panel>
      )}

      <Sheet visible={!!editing} onClose={() => setEditing(null)}
             title={editing && editing.id ? 'Amend the budget' : 'A new budget'}>
        {editing ? (
          <>
            <Field label="Title" value={editing.title || ''}
                   onChangeText={(v) => setEditing(e => ({ ...e, title: v }))}
                   hint="e.g. Second Term 2025/2026" />
            <Select label="Kind" value={editing.budget_type || 'term'}
                    onChange={(v) => setEditing(e => ({ ...e, budget_type: v }))}
                    options={[{ label: 'A term', value: 'term' },
                              { label: 'An academic year', value: 'year' },
                              { label: 'A project', value: 'project' }]} />
            <Select label="Status" value={editing.status || 'draft'}
                    onChange={(v) => setEditing(e => ({ ...e, status: v }))}
                    options={[{ label: 'Draft', value: 'draft' },
                              { label: 'Active', value: 'active' },
                              { label: 'Closed', value: 'closed' }]} />

            <Divider />
            <Text style={{ ...type.heading, color: colors.text }}>Lines</Text>
            {(editing.items || []).map((item, i) => (
              <View key={i} style={{ gap: 6, paddingVertical: 8,
                                     borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}>
                <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <View style={{ width: 130 }}>
                    <Select label="In or out" value={item.item_type || 'expense'}
                            onChange={(v) => setEditing(e => ({ ...e,
                              items: e.items.map((x, j) => (j === i ? { ...x, item_type: v } : x)) }))}
                            options={[{ label: 'Spend', value: 'expense' },
                                      { label: 'Receive', value: 'income' }]} />
                  </View>
                  <View style={{ flex: 1, minWidth: 160 }}>
                    <Field label="What" value={item.description || ''}
                           onChangeText={(v) => setEditing(e => ({ ...e,
                             items: e.items.map((x, j) => (j === i ? { ...x, description: v } : x)) }))} />
                  </View>
                  <View style={{ width: 120 }}>
                    <Field label="Planned" value={String(item.projected_amount ?? '')}
                           onChangeText={(v) => setEditing(e => ({ ...e,
                             items: e.items.map((x, j) => (j === i ? { ...x, projected_amount: v } : x)) }))} />
                  </View>
                  <View style={{ width: 120 }}>
                    <Field label="Actual" value={String(item.actual_amount ?? '')}
                           onChangeText={(v) => setEditing(e => ({ ...e,
                             items: e.items.map((x, j) => (j === i ? { ...x, actual_amount: v } : x)) }))} />
                  </View>
                  <Button title="Remove" variant="ghost" size="sm" full={false}
                          onPress={() => setEditing(e => ({ ...e, items: e.items.filter((_, j) => j !== i) }))} />
                </View>
              </View>
            ))}
            <Button title="Add a line" variant="outline" icon="plus" full={false}
                    onPress={() => setEditing(e => ({ ...e,
                      items: [...(e.items || []), { item_type: 'expense', description: '', projected_amount: '' }] }))} />
            <Button title={busy ? 'Saving…' : 'Save the budget'} busy={busy} disabled={busy} onPress={save} />
          </>
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}

// ── The workbook ────────────────────────────────────────────────────────────
//
// The one place in Finance that is not served here, and it is not a permission
// matter — it is what the workbook IS. It exists so a school whose computer has
// died can keep trading in Excel and import the result back: a file written to
// that machine's disk and read from it again. There is nothing for a browser to
// do with it, and a tab that silently drew nothing would read as broken.
//
// So the tab stays and says where the job is done. Somebody looking for the
// workbook has a reason to be looking, and "it is on the office computer" is
// the answer they need.
export function Workbook() {
  return (
    <Panel title="The finance workbook"
           subtitle="Built and read back on the school's own computer">
      <EmptyState
        icon="book"
        title="The workbook is built on the office computer"
        message={
          'Finance → Workbook on the installed application writes the whole of the '
          + "school's money — fees, canteen, books, transport, other income, expenses "
          + 'and payroll — into one Excel file, and reads a filled-in copy back in. '
          + 'Both halves are files on that machine, so the browser has nothing to '
          + 'open. Everything else in Finance is here.'
        }
      />
    </Panel>
  );
}
