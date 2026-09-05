// The school this morning — the installed application's Dashboard.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The desktop's Dashboard page, reproduced: the school's name and motto, five
// metric cards across the top, then two rows of three panels — income against
// expenditure, the fee collection donut, the last receipts written; the two
// debtor lists and the school day.
//
// ── Two dashboards, one screen ─────────────────────────────────────────────
//
// The rich version needs the school's own system, which computes it in one
// query set (see electron/server/dashboards_api.js). A browser talking to the
// thin hosted portal cannot have it: the portal holds a projection of the
// school and has no expense ledger to chart or canteen day-status to count.
//
// So this screen asks for both and draws whichever it got. That is not a
// degraded mode with an apology on it — the summary built from /admin/overview
// is a real summary and was the whole of this screen before — it is simply
// less, and it says less rather than showing empty frames where a chart would
// be. Filling them with zeroes would be worse: a zero is a claim.
import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../api';
import { AsOf, OfficeScreen, cedis, useOffice } from '../../office';
import {
  Card, Section, Grid, StatCard, ListRow, Muted, EmptyState, ProgressBar, Button, Badge,
} from '../../ui';
import {
  MetricCard, MetricRow, SectionCard, DashRow, IncomeExpenseChart, CollectionDonut,
  DebtorRow, PaymentRow, ScheduleList, EmptyLine, ViewAll, ghs, whenLabel, fullName,
} from '../../dash';
import { colors, spacing, type } from '../../theme';
import { useLayout } from '../../responsive';

export default function AdminOverview() {
  const router = useRouter();
  const layout = useLayout();

  // ── Why the desktop clone is desktop-only ────────────────────────────────
  //
  // Five metric cards, two charts and six panels are the right shape for a
  // 24-inch monitor in an office and the wrong shape for a phone held in one
  // hand at the school gate. The phone keeps the summary it has always had —
  // the same figures, stacked, in the app's own chrome. This is the same rule
  // the whole app follows (see src/desk.jsx): one system, two densities.
  const wide = layout.isDesktop;

  // Both, in one request pair, so the screen has one loading state rather than
  // flashing the plain summary and then replacing it a moment later.
  const state = useOffice(async (t) => {
    const [overview, rich] = await Promise.all([
      api.adminOverview(t),
      wide ? api.dashMain(t) : Promise.resolve(null),
    ]);
    return { overview, rich: rich && rich.ok ? rich : null };
  }, [wide]);

  const d = state.data?.overview;
  const rich = state.data?.rich;

  return (
    <OfficeScreen state={state} skeleton={4}>
      {rich ? <FullDashboard d={rich} overview={d} router={router} />
        : d ? <PlainSummary d={d} router={router} /> : null}
    </OfficeScreen>
  );
}

// ══ The installed application's Dashboard ═══════════════════════════════════

function FullDashboard({ d, overview, router }) {
  const m = d.metrics || {};
  const charts = d.charts || {};
  const school = d.school || {};

  // The one thing the desktop cannot show and this can: what is sitting in
  // somebody's queue. It is drawn above the figures because it is the only
  // part of the page that is a job rather than a reading.
  const waiting = (overview?.approvals?.leave || 0) + (overview?.approvals?.lesson_notes || 0);

  return (
    <View style={{ width: '100%' }}>
      <View style={{ marginBottom: 4 }}>
        <Text style={styles.schoolName}>{school.name || 'The school'}</Text>
        {school.motto ? <Text style={styles.schoolMotto}>{school.motto}</Text> : null}
      </View>

      {waiting ? (
        <Card tone="warning" onPress={() => router.push('/app/staff?tab=leave')}>
          <Text style={{ ...type.body, fontWeight: '800', color: colors.text }}>
            {waiting} thing{waiting === 1 ? '' : 's'} waiting on you
          </Text>
          <Muted>
            {[overview.approvals.leave ? `${overview.approvals.leave} leave request${overview.approvals.leave === 1 ? '' : 's'}` : null,
              overview.approvals.lesson_notes ? `${overview.approvals.lesson_notes} lesson note${overview.approvals.lesson_notes === 1 ? '' : 's'}` : null,
             ].filter(Boolean).join(' and ')}
          </Muted>
        </Card>
      ) : null}

      <MetricRow columns={5}>
        <MetricCard index={0} tone="blue" icon="users"
                    label="Total Students" value={m.student_total ?? '—'}
                    sub={`${m.class_count || 0} Classes`}
                    link="View all students →" onPress={() => router.push('/app/students')} />
        <MetricCard index={1} tone="green" icon="cash" valueTone="success"
                    label="Total Income" value={ghs(m.income_total)} sub="This Term"
                    link="View income report →" onPress={() => router.push('/app/finance')} />
        <MetricCard index={2} tone="red" icon="note" valueTone="danger"
                    label="Outstanding Fees" value={ghs(m.fees_outstanding)}
                    sub={`${m.debtor_count || 0} Students`}
                    link="View debtors →" onPress={() => router.push('/app/fees?tab=debtors')} />
        <MetricCard index={3} tone="orange" icon="bowl" valueTone="accent"
                    label="Canteen Owed" value={ghs(m.canteen_owed)}
                    sub={`${m.canteen_unpaid_students || 0} Students`}
                    link="View canteen debtors →" onPress={() => router.push('/app/canteen?tab=debtors')} />
        <MetricCard index={4} tone="purple" icon="user"
                    label="Staff Members" value={m.staff_active ?? '—'} sub="Active Staff"
                    link="View staff →" onPress={() => router.push('/app/staff')} />
      </MetricRow>

      <DashRow weights={[1.4, 1, 1.2]}>
        <SectionCard title="Income vs Expenses (This Term)">
          <IncomeExpenseChart income={charts.income_by_month} expense={charts.expense_by_month} />
        </SectionCard>

        <SectionCard title="Fee Collection Summary">
          <CollectionDonut collected={m.fees_collected} outstanding={m.fees_outstanding}
                           total={m.total_billed} pct={m.collection_pct} />
        </SectionCard>

        <SectionCard title="Recent Payments" viewAll="View all →"
                     onViewAll={() => router.push('/app/finance')}>
          {(d.recent_payments || []).length === 0
            ? <EmptyLine>No payments yet</EmptyLine>
            : d.recent_payments.map((p, i, arr) => (
              <PaymentRow key={`${p.payment_type}-${p.id}`}
                          code={p.index_number} name={fullName(p)} note={p.payment_type}
                          amount={ghs(p.amount)} when={whenLabel(p.payment_date)}
                          last={i === arr.length - 1} />
            ))}
        </SectionCard>
      </DashRow>

      <DashRow weights={[1.4, 1, 1.2]}>
        <SectionCard title="Top Fee Debtors" viewAll="View all →"
                     onViewAll={() => router.push('/app/fees?tab=debtors')}>
          {(d.top_fee_debtors || []).length === 0
            ? <EmptyLine>No debtors</EmptyLine>
            : d.top_fee_debtors.map((r, i, arr) => (
              <DebtorRow key={r.student_id} person={r} amount={r.balance}
                         days={r.days_outstanding} last={i === arr.length - 1}
                         onPress={() => router.push(`/app/students/${r.student_id}`)} />
            ))}
        </SectionCard>

        <SectionCard title="Canteen Debtors" viewAll="View all →"
                     onViewAll={() => router.push('/app/canteen?tab=debtors')}>
          {(d.top_canteen_debtors || []).length === 0
            ? <EmptyLine>No debtors</EmptyLine>
            : d.top_canteen_debtors.map((r, i, arr) => (
              <DebtorRow key={r.student_id} person={r} amount={r.amount_owed}
                         days={r.unpaid_days} last={i === arr.length - 1}
                         onPress={() => router.push(`/app/students/${r.student_id}`)} />
            ))}
        </SectionCard>

        <SectionCard title="Today's Schedule" icon="calendar"
                     footer={<ViewAll label="View full academic calendar →"
                                      onPress={() => router.push('/app/academics?tab=timetable')} />}>
          <ScheduleList items={d.schedule} />
        </SectionCard>
      </DashRow>
    </View>
  );
}

// ══ What a projection can honestly show ═════════════════════════════════════
//
// Enrolment, who turned up, the staff room, what is waiting to be approved —
// and the fee position only if this account may see fees at all. A head
// teacher without finance gets the school without the money, not the school
// with zeroes in it.

function PlainSummary({ d, router }) {
  const waiting = (d?.approvals?.leave || 0) + (d?.approvals?.lesson_notes || 0);
  return (
    <>
      <Card tone="primary">
        <Text style={{ ...type.body, fontWeight: '700', color: colors.text }}>
          {d.school?.name || 'The school'}
        </Text>
        <Muted>{d.term ? d.term.label : 'No term is running'}</Muted>
        {d.stale ? <AsOf at={d.updated_at} /> : null}
      </Card>

      {waiting ? (
        <Card tone="warning" onPress={() => router.push('/app/staff?tab=leave')}>
          <Text style={{ ...type.body, fontWeight: '800', color: colors.text }}>
            {waiting} thing{waiting === 1 ? '' : 's'} waiting on you
          </Text>
          <Muted>
            {[d.approvals.leave ? `${d.approvals.leave} leave request${d.approvals.leave === 1 ? '' : 's'}` : null,
              d.approvals.lesson_notes ? `${d.approvals.lesson_notes} lesson note${d.approvals.lesson_notes === 1 ? '' : 's'}` : null,
             ].filter(Boolean).join(' and ')}
          </Muted>
        </Card>
      ) : null}

      {d.enrolment ? (
        <Grid min={150}>
          <StatCard label="On the roll" value={d.enrolment.total} tone="data" icon="users"
            note={`${d.enrolment.boys} boys · ${d.enrolment.girls} girls`} />
          {d.attendance ? (
            <StatCard label="Present today" value={d.attendance.present}
              tone={d.attendance.rate == null ? 'neutral'
                   : d.attendance.rate >= 90 ? 'success' : d.attendance.rate >= 75 ? 'warning' : 'danger'}
              icon="check"
              note={d.attendance.rate == null ? 'No register marked yet' : `${d.attendance.rate}% of those marked`} />
          ) : null}
          {d.attendance ? (
            <StatCard label="Registers marked" tone="neutral" icon="layers"
              value={`${d.attendance.classes_marked} of ${d.attendance.classes_total}`} />
          ) : null}
          {d.staff ? (
            <StatCard label="Staff in" value={d.staff.clocked_in} tone="neutral" icon="badge"
              note={`of ${d.staff.total} on the books`} />
          ) : null}
        </Grid>
      ) : null}

      {d.fees ? (
        <Section title="Fees" icon="wallet"
          action={<Button label="The office" tone="ghost" size="sm" onPress={() => router.push('/app/finance')} />}>
          <Grid min={150}>
            <StatCard label="Collected" value={cedis(d.fees.collected)} tone="success" icon="check" />
            <StatCard label="Outstanding" value={cedis(d.fees.outstanding)} tone="danger" icon="trend" />
          </Grid>
          <Card>
            <ProgressBar value={d.fees.collection_rate} max={100}
              tone={d.fees.collection_rate >= 75 ? 'success' : d.fees.collection_rate >= 40 ? 'warning' : 'danger'}
              label={`${d.fees.collection_rate}% of what was billed`} />
          </Card>
        </Section>
      ) : null}

      {(d.by_class || []).length ? (
        <Section title="The classes" icon="layers" subtitle="Who is where.">
          <Card padded={false}>
            {d.by_class.map((c, i) => (
              <ListRow key={c.id} title={c.name}
                subtitle={c.short_code}
                right={<Text style={{ ...type.small, fontWeight: '800',
                                      fontVariant: ['tabular-nums'], color: colors.text }}>
                  {c.pupils}</Text>}
                last={i === d.by_class.length - 1} />
            ))}
          </Card>
        </Section>
      ) : null}

      {(d.classes || []).length ? (
        <Section title="How they are doing" icon="trend"
          action={<Button label="In detail" tone="ghost" size="sm" onPress={() => router.push('/app/academics?tab=dashboard')} />}>
          <Card padded={false}>
            {d.classes.filter(c => c.entries).slice(0, 6).map((c, i, arr) => (
              <ListRow key={c.id} title={c.name}
                subtitle={`${c.entries} mark${c.entries === 1 ? '' : 's'} entered`}
                right={<Badge label={c.average == null ? '—' : String(c.average)}
                  tone={c.average == null ? 'neutral' : c.average >= 60 ? 'success'
                       : c.average >= 45 ? 'warning' : 'danger'} />}
                last={i === arr.length - 1} />
            ))}
          </Card>
        </Section>
      ) : null}

      {!d.enrolment && !d.staff && !d.fees ? (
        <Card>
          <EmptyState icon="grid" title="Nothing to show yet"
            message="This account holds the administration portal but none of the modules that fill it." />
        </Card>
      ) : null}
    </>
  );
}

const styles = {
  schoolName: { ...type.display, fontSize: 24, color: colors.primary, letterSpacing: -0.3 },
  schoolMotto: { ...type.body, fontSize: 14, color: colors.accent, fontWeight: '600', fontStyle: 'italic', marginTop: 2 },
};
