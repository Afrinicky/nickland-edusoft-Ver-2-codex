// Payroll — the run, the statutory schedules, and the payslips.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A Ghanaian school's payroll is three documents, not one. The RUN is what
// each person is paid this month. The SSNIT schedule is what the school owes
// the pension fund for them, and the PAYE schedule is what it owes the GRA.
// Both of those are filed monthly, both are late if the office has to wait for
// somebody to be at the one PC that can produce them, and both are computed
// from the same run — which is why they are three tabs and one calculation.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { OfficeScreen, cedis, useOffice } from '../../office';
import {
  Select, DataTable, Muted, Badge, EmptyState, ErrorNote, SuccessNote, Button,
  Sheet, Field, SearchField, Divider,
} from '../../ui';
import { Panel, Bar, StatRow, Stat } from '../../desk';
import { MetricCard, MetricRow, ghs } from '../../dash';
import { useLayout } from '../../responsive';
import { printHtml } from '../../print';
import { colors, spacing, type } from '../../theme';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

/** The month/year picker every tab here shares. */
function useMonth() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const years = [];
  for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 4; y -= 1) years.push(y);
  const picker = (
    <>
      <View style={{ minWidth: 180 }}>
        <Select label="Month" value={String(month)} onChange={(v) => setMonth(Number(v))}
                options={MONTHS.map((m, i) => ({ label: m, value: String(i + 1) }))} />
      </View>
      <View style={{ minWidth: 140 }}>
        <Select label="Year" value={String(year)} onChange={(v) => setYear(Number(v))}
                options={years.map(y => ({ label: String(y), value: String(y) }))} />
      </View>
    </>
  );
  return { month, year, picker };
}

// ── The run ─────────────────────────────────────────────────────────────────

export function PayrollRun() {
  const { token, profile } = useAuth();
  const { month, year, picker } = useMonth();
  const layout = useLayout();
  const wide = layout.isDesktop;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [paying, setPaying] = useState(null);
  const state = useOffice(async (t) => {
    const [run, rich] = await Promise.all([
      api.financePayroll(t, month, year),
      wide ? api.dashPayroll(t, month, year) : Promise.resolve(null),
    ]);
    return { ...run, dash: rich && rich.ok ? rich : null };
  }, [month, year, wide]);

  const mayRun = can(profile, 'payroll', 'create');
  const mayPay = can(profile, 'payroll', 'edit');
  const rows = state.data?.salaries || state.data?.payroll || [];
  const gross = rows.reduce((n, r) => n + (Number(r.gross_salary ?? r.gross) || 0), 0);
  const net = rows.reduce((n, r) => n + (Number(r.net_salary ?? r.net) || 0), 0);
  const paid = rows.filter(r => r.payment_status === 'paid' || r.is_paid).length;
  const dash = state.data?.dash;

  async function run() {
    setBusy(true); setError(null); setDone(null);
    try {
      const r = await api.payrollRun(token, month, year);
      setDone(`${r.created ?? r.count ?? rows.length} salaries worked out for ${MONTHS[month - 1]} ${year}.`);
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function markPaid() {
    setBusy(true); setError(null);
    try {
      await api.markSalaryPaid(token, paying.id, {
        amount: Number(paying.amount) || 0,
        method: paying.method || 'Bank Transfer',
      });
      setPaying(null);
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      {done ? <SuccessNote message={done} /> : null}

      {/* The installed application's own five figures, where there is room for
          them: who is on the run, what it costs, what SSNIT and the GRA take,
          and what actually leaves the account. SSNIT is split into worker and
          employer under the combined figure because those are two separate
          obligations and the return asks for both. */}
      {dash ? (
        <MetricRow columns={5}>
          <MetricCard index={0} tone="blue" icon="users"
                      label="Active Staff" value={dash.metrics.staff_on_run || rows.length}
                      sub={`${MONTHS[month - 1]} ${year} · ${dash.metrics.eligible_staff || 0} on the books`} />
          <MetricCard index={1} tone="green" icon="cash"
                      label="Gross Payroll" value={ghs(dash.metrics.gross)}
                      sub="Before deductions" />
          <MetricCard index={2} tone="orange" icon="shield" valueTone="accent"
                      label="SSNIT" value={ghs(dash.metrics.ssnit_combined)}
                      sub={`${ghs(dash.metrics.ssnit_employee)} W + ${ghs(dash.metrics.ssnit_employer)} E`} />
          <MetricCard index={3} tone="red" icon="note" valueTone="danger"
                      label="PAYE Tax" value={ghs(dash.metrics.paye)} sub="To remit to GRA" />
          <MetricCard index={4} tone="purple" icon="check" valueTone="success"
                      label="Total Net Pay" value={ghs(dash.metrics.net)}
                      sub={`Total employer cost: ${ghs(dash.metrics.employer_cost)}`} />
        </MetricRow>
      ) : (
        <StatRow>
          <Stat index={0} label="On this run" icon="users" tone="primary" value={rows.length}
                note={`${MONTHS[month - 1]} ${year}`} />
          <Stat index={1} label="Gross" icon="wallet" tone="data" value={cedis(gross)}
                note="Before deductions" />
          <Stat index={2} label="Net to pay" icon="cash" tone="success" value={cedis(net)}
                note="What leaves the account" />
          <Stat index={3} label="Paid" icon="check" tone={paid === rows.length && rows.length ? 'success' : 'warning'}
                value={`${paid} of ${rows.length}`}
                note={paid === rows.length && rows.length ? 'Everybody is paid' : 'Some are outstanding'} />
        </StatRow>
      )}

      <Bar left={picker}
           right={mayRun ? (
             <Button title={busy ? 'Working it out…' : 'Run the payroll'} busy={busy} disabled={busy}
                     icon="refresh" full={false} onPress={run} />
           ) : null} />

      <Panel padded={false} title={`Payroll Detail — ${MONTHS[month - 1]} ${year}`}
             subtitle="Gross, the deductions taken from it, and what each person actually receives."
             right={<Muted>{`${paid} of ${rows.length} paid`}</Muted>}>
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r, i) => String(r.id ?? i)}
            empty={`Nothing has been worked out for ${MONTHS[month - 1]} ${year} yet.`}
            columns={[
              { key: 'name', label: 'Member of staff',
                render: (r) => r.staff_name || r.name || `${r.surname || ''} ${r.first_name || ''}`.trim() },
              { key: 'gross_salary', label: 'Gross', align: 'right', width: 120,
                render: (r) => cedis(r.gross_salary ?? r.gross) },
              { key: 'ssnit', label: 'SSNIT', align: 'right', width: 110,
                render: (r) => cedis(r.ssnit_employee ?? r.ssnit ?? 0) },
              { key: 'paye', label: 'PAYE', align: 'right', width: 110,
                render: (r) => cedis(r.paye ?? 0) },
              { key: 'net_salary', label: 'Net', align: 'right', width: 130,
                render: (r) => (
                  <Text style={{ ...type.small, fontWeight: '800', color: colors.text }}>
                    {cedis(r.net_salary ?? r.net)}
                  </Text>
                ) },
              { key: 'status', label: '', align: 'right', width: 140,
                render: (r) => ((r.payment_status === 'paid' || r.is_paid)
                  ? <Badge tone="success" label="Paid" />
                  : mayPay
                    ? <Button size="sm" variant="outline" full={false} title="Mark paid"
                              onPress={() => setPaying({ ...r, amount: r.net_salary ?? r.net,
                                                         method: 'Bank Transfer' })} />
                    : <Badge tone="warning" label="Outstanding" />) },
            ]}
            rows={rows} />
        </View>
      </Panel>

      <Sheet visible={!!paying} onClose={() => setPaying(null)} title="Mark this salary paid">
        {paying ? (
          <>
            <Muted>{paying.staff_name || paying.name}</Muted>
            <Field label="Amount actually paid" value={String(paying.amount ?? '')}
                   onChangeText={(v) => setPaying(p => ({ ...p, amount: v }))} />
            <Select label="How" value={paying.method}
                    onChange={(v) => setPaying(p => ({ ...p, method: v }))}
                    options={['Bank Transfer', 'Cash', 'Mobile Money', 'Cheque']
                      .map(m => ({ label: m, value: m }))} />
            <Button title={busy ? 'Saving…' : 'Mark it paid'} busy={busy} disabled={busy} onPress={markPaid} />
          </>
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}

// ── The statutory schedules ─────────────────────────────────────────────────

export function StatutorySchedule({ kind }) {
  const { month, year, picker } = useMonth();
  const state = useOffice((t) => api.payrollSchedule(t, kind, month, year), [kind, month, year]);
  const rows = state.data?.rows || state.data?.schedule || [];
  const total = rows.reduce((n, r) => n + (Number(r.total ?? r.amount ?? 0) || 0), 0);
  const isSsnit = kind === 'ssnit';

  return (
    <OfficeScreen state={state} skeleton={5}>
      <StatRow>
        <Stat index={0} label={isSsnit ? 'Owed to SSNIT' : 'Owed to the GRA'}
              icon="wallet" tone="danger" value={cedis(total)}
              note={`${MONTHS[month - 1]} ${year}`} />
        <Stat index={1} label="People on it" icon="users" tone="primary" value={rows.length}
              note={isSsnit ? 'Contributing this month' : 'Taxable this month'} />
        {isSsnit ? (
          <Stat index={2} label="Employer's share" icon="badge" tone="data"
                value={cedis(rows.reduce((n, r) => n + (Number(r.employer ?? 0) || 0), 0))}
                note="The school's own 13%" />
        ) : null}
      </StatRow>

      <Bar left={picker}
           right={<Muted>{isSsnit
             ? 'Filed with SSNIT monthly. The rates come from Settings → Payroll.'
             : 'Filed with the Ghana Revenue Authority monthly, on the graduated scale.'}</Muted>} />

      <Panel padded={false}
             title={isSsnit ? 'SSNIT schedule' : 'PAYE schedule'}
             subtitle={isSsnit
               ? "Each person's contribution and the school's, against their SSNIT number."
               : "Taxable pay and the tax on it, filed under the school's TIN."}>
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r, i) => String(r.staff_id ?? r.id ?? i)}
            empty={`Nothing to file for ${MONTHS[month - 1]} ${year} — run the payroll first.`}
            columns={isSsnit ? [
              { key: 'name', label: 'Member of staff',
                render: (r) => r.staff_name || r.name },
              { key: 'ssnit_number', label: 'SSNIT number', width: 180 },
              { key: 'basic', label: 'Basic', align: 'right', width: 120,
                render: (r) => cedis(r.basic ?? r.gross_salary) },
              { key: 'employee', label: "Worker's 5.5%", align: 'right', width: 140,
                render: (r) => cedis(r.employee) },
              { key: 'employer', label: "School's 13%", align: 'right', width: 140,
                render: (r) => cedis(r.employer) },
              { key: 'total', label: 'Total', align: 'right', width: 130,
                render: (r) => cedis(r.total) },
            ] : [
              { key: 'name', label: 'Member of staff',
                render: (r) => r.staff_name || r.name },
              { key: 'staff_number', label: 'Staff number', width: 180 },
              { key: 'gross', label: 'Gross', align: 'right', width: 130,
                render: (r) => cedis(r.gross ?? r.gross_salary) },
              { key: 'taxable', label: 'Taxable', align: 'right', width: 130,
                render: (r) => cedis(r.taxable) },
              { key: 'amount', label: 'Tax', align: 'right', width: 130,
                render: (r) => cedis(r.amount ?? r.paye) },
            ]}
            rows={rows} />
        </View>
      </Panel>
    </OfficeScreen>
  );
}

// ── Payslips ────────────────────────────────────────────────────────────────

export function Payslips() {
  const { token } = useAuth();
  const { month, year, picker } = useMonth();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const state = useOffice((t) => api.financePayroll(t, month, year), [month, year]);

  const rows = useMemo(() => {
    const list = state.data?.salaries || state.data?.payroll || [];
    const needle = q.trim().toLowerCase();
    return needle
      ? list.filter(r => String(r.staff_name || r.name || '').toLowerCase().includes(needle))
      : list;
  }, [state.data, q]);

  async function show(row) {
    const id = row.staff_id ?? row.id;
    setBusy(id); setError(null);
    try { setOpen({ row, slip: await api.payslip(token, id, month, year) }); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  return (
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      <Bar left={<>
        {picker}
        <View style={{ minWidth: 220, flex: 1 }}>
          <SearchField value={q} onChangeText={setQ} placeholder="Find a member of staff" />
        </View>
      </>} />

      <Panel padded={false} title="Payslips"
             subtitle="One per person per month, itemised — what the school hands over on payday.">
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r, i) => String(r.id ?? i)}
            empty={`Nothing has been worked out for ${MONTHS[month - 1]} ${year} yet.`}
            columns={[
              { key: 'name', label: 'Member of staff',
                render: (r) => r.staff_name || r.name },
              { key: 'net_salary', label: 'Net', align: 'right', width: 140,
                render: (r) => cedis(r.net_salary ?? r.net) },
              { key: 'open', label: '', align: 'right', width: 130,
                render: (r) => (
                  <Button size="sm" variant="outline" full={false}
                          title={busy === (r.staff_id ?? r.id) ? 'Opening…' : 'Payslip'}
                          disabled={busy != null} onPress={() => show(r)} />
                ) },
            ]}
            rows={rows} />
        </View>
      </Panel>

      <Sheet visible={!!open} onClose={() => setOpen(null)}
             title={open ? `${open.row.staff_name || open.row.name} — ${MONTHS[month - 1]} ${year}` : ''}>
        {open ? <PayslipBody slip={open.slip.payslip || open.slip} /> : null}
      </Sheet>
    </OfficeScreen>
  );
}

function PayslipBody({ slip }) {
  const lines = [
    ['Basic salary', slip.basic_salary ?? slip.basic],
    ['Allowances', slip.allowances],
    ['Gross', slip.gross_salary ?? slip.gross],
    ['SSNIT (worker)', -(slip.ssnit_employee ?? slip.ssnit ?? 0)],
    ['PAYE', -(slip.paye ?? 0)],
    ['Other deductions', -(slip.other_deductions ?? 0)],
  ].filter(([, v]) => v != null && Number(v) !== 0);

  return (
    <View>
      {lines.map(([k, v]) => (
        <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between',
                               paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}>
          <Muted>{k}</Muted>
          <Text style={{ ...type.small, fontWeight: '600',
                         color: Number(v) < 0 ? colors.danger : colors.text }}>
            {cedis(Math.abs(Number(v)))}
          </Text>
        </View>
      ))}
      <Divider />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm }}>
        <Text style={{ ...type.heading, color: colors.text }}>Net pay</Text>
        <Text style={{ ...type.heading, color: colors.success }}>
          {cedis(slip.net_salary ?? slip.net)}
        </Text>
      </View>
    </View>
  );
}
