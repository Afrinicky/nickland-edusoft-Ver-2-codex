// My work — the teacher's own employment, which the app carried nothing of.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Clock in and out, this month's attendance, leave requests, and payslips. All
// of it is keyed by the signed-in token, not by a staff id in a URL, so no
// amount of guessing reaches a colleague's record — and only paid months appear,
// because an unpaid draft row is the school's working figure, not a statement
// of what anyone is owed.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { useAuth } from '../../src/auth';
import { api, money } from '../../src/api';
import {
  Screen, Card, Section, Title, Heading, Muted, Micro, Button, Badge, Sheet,
  Field, TextArea, Select, ErrorNote, SuccessNote, InfoNote, Skeleton, EmptyState,
  ListRow, Grid, StatCard, KeyValue, Divider, Gradient, Avatar, SegmentedControl,
  DataTable, PendingBadge,
} from '../../src/ui';
import { useLayout } from '../../src/responsive';
import { colors, palette, gradients, spacing, radius, shadow, type } from '../../src/theme';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const LEAVE_TYPES = ['Casual', 'Sick', 'Maternity', 'Paternity', 'Study', 'Compassionate', 'Unpaid'];
const LEAVE_TONE = { pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'neutral' };

export default function MyWork() {
  const { token, profile, mode } = useAuth();
  const layout = useLayout();

  const [tab, setTab] = useState('me');
  const [hr, setHr] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [leave, setLeave] = useState(null);
  const [payslips, setPayslips] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [clocking, setClocking] = useState(false);

  const [asking, setAsking] = useState(false);
  const [form, setForm] = useState({ leaveType: 'Casual', startDate: '', endDate: '', justification: '' });
  const [saving, setSaving] = useState(false);
  const [payslip, setPayslip] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    const settle = (p, f) => p.then(r => r).catch(() => f);
    const [me, att, lv, pay] = await Promise.all([
      settle(api.hrMe(token), { has_staff: false }),
      settle(api.hrAttendance(token), { days: [] }),
      settle(api.leaveRequests(token), { requests: [] }),
      settle(api.payslips(token), { payslips: [] }),
    ]);
    setHr(me); setAttendance(att); setLeave(lv.requests || []); setPayslips(pay.payslips || []);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function punch(direction) {
    setClocking(true); setError(null);
    try { await api.clock(token, direction); await load(); }
    catch (e) { setError(e.message); }
    finally { setClocking(false); }
  }

  async function requestLeave() {
    if (!form.startDate || !form.endDate) { setError('Give both dates.'); return; }
    if (!form.justification.trim()) { setError('Say why you need the leave.'); return; }
    setSaving(true); setError(null); setSaved(null);
    try {
      const r = await api.requestLeave(token, form);
      setAsking(false);
      setForm({ leaveType: 'Casual', startDate: '', endDate: '', justification: '' });
      setSaved(mode === 'cloud'
        ? `${r.days_requested || ''} day request saved and queued — it reaches whoever reviews leave when the school next syncs.`
        : `Request for ${r.days_requested} day${r.days_requested === 1 ? '' : 's'} submitted for review.`);
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  if (hr === null) return <Screen><Card><Skeleton rows={2} height={90} /></Card><Card><Skeleton rows={5} /></Card></Screen>;

  if (!hr.has_staff) {
    return (
      <Screen>
        <ErrorNote message={error} />
        <Card>
          <EmptyState
            icon="badge" title="No staff record"
            message="Your sign-in isn't linked to a staff record, so there is no timetable, leave or payslip to show. Ask the school office to link it."
          />
        </Card>
      </Screen>
    );
  }

  const s = hr.staff || {};
  const today = hr.today?.attendance;
  const clockedIn = today?.clock_in;
  const clockedOut = today?.clock_out;
  const days = attendance?.days || [];
  const present = days.filter(d => d.status === 'present').length;
  const pendingLeave = (leave || []).filter(l => l.status === 'pending').length;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ErrorNote message={error} />
      <SuccessNote message={saved} />

      <Gradient colors={gradients.chrome} angle={140} style={[{ borderRadius: radius.lg, padding: spacing.xl }, shadow.raised]}>
        <View style={{ flexDirection: layout.isPhone ? 'column' : 'row', alignItems: layout.isPhone ? 'flex-start' : 'center', gap: spacing.lg }}>
          <Avatar name={profile?.user?.full_name || s.name} size={layout.isPhone ? 52 : 62} tone="chrome" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: '#fff', fontSize: layout.isPhone ? 21 : 25, fontWeight: '800', letterSpacing: -0.5 }}>
              {profile?.user?.full_name || s.name}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 13.5, fontWeight: '600', marginTop: 3 }}>
              {[s.designation || hr.designation, s.staff_number, s.role].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <View style={{
            backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: radius.md, padding: spacing.md,
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', minWidth: 160,
          }}>
            <Micro style={{ color: 'rgba(255,255,255,0.65)' }}>{clockedIn ? 'On duty since' : 'Not clocked in'}</Micro>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 20, marginTop: 2, fontVariant: ['tabular-nums'] }}>
              {clockedIn ? String(clockedIn).slice(0, 5) : '—:—'}
            </Text>
            {clockedOut
              ? <Muted style={{ color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>Left at {String(clockedOut).slice(0, 5)}</Muted>
              : <Button
                  size="sm" variant={clockedIn ? 'outline' : 'gold'}
                  title={clockedIn ? 'Clock out' : 'Clock in'} busy={clocking}
                  onPress={() => punch(clockedIn ? 'out' : 'in')}
                  style={clockedIn ? { borderColor: 'rgba(255,255,255,0.4)', marginTop: 8 } : { marginTop: 8 }}
                />}
            {today?.pending ? <View style={{ marginTop: 6 }}><PendingBadge label="Queued" /></View> : null}
          </View>
        </View>
      </Gradient>

      <Card>
        <SegmentedControl
          value={tab} onChange={setTab}
          options={[
            { value: 'me', label: 'Record', icon: 'badge' },
            { value: 'attendance', label: 'Attendance', icon: 'calendar' },
            { value: 'leave', label: 'Leave', icon: 'note' },
            { value: 'pay', label: 'Payslips', icon: 'wallet' },
          ]}
        />
      </Card>

      {tab === 'me' && (
        <>
          <Section title="Employment" icon="badge">
            <KeyValue items={[
              { label: 'Staff number', value: s.staff_number },
              { label: 'Designation', value: s.designation || hr.designation },
              { label: 'Role', value: s.role },
              { label: 'Status', value: s.status },
              { label: 'Phone', value: s.phone },
              { label: 'Email', value: s.email },
              { label: 'Qualification', value: s.qualification },
              { label: 'Specialisation', value: s.specialization },
              { label: 'Hired', value: s.hire_date },
              { label: 'SSNIT number', value: s.ssnit_number },
            ]} />
            <Muted style={{ marginTop: spacing.md }}>
              Your own details are changed at the school office — the app shows what they hold.
            </Muted>
          </Section>

          <Section title="What you teach" icon="grid" subtitle="Set by whoever handles staffing.">
            {(hr.assignments || []).length === 0
              ? <Muted>No teaching assignments yet. Until they are set, no classes are open to you.</Muted>
              : (hr.assignments || []).map((a, i) => (
                  <ListRow
                    key={i}
                    icon={a.is_class_teacher ? 'award' : 'book'}
                    iconTone={a.is_class_teacher ? 'gold' : 'primary'}
                    title={a.class_name || (a.subject_name ? `${a.subject_name} — every class` : 'Assignment')}
                    subtitle={a.class_name && a.subject_name ? a.subject_name : (a.class_name ? 'The whole class' : null)}
                    right={a.is_class_teacher ? <Badge tone="gold" label="Class teacher" /> : null}
                  />
                ))}
          </Section>
        </>
      )}

      {tab === 'attendance' && (
        <>
          <Grid min={150}>
            <StatCard label="Days present" value={present} tone="success" icon="check" />
            <StatCard label="Days recorded" value={days.length} icon="calendar" />
            <StatCard label="Month" value={attendance?.month ? MONTHS[attendance.month - 1] : '—'} icon="grid" />
          </Grid>
          <Section title="This month" icon="calendar">
            <DataTable
              keyExtractor={(r) => r.date}
              empty="Nothing recorded this month."
              columns={[
                { key: 'date', label: 'Date' },
                { key: 'clock_in', label: 'In', render: (r) => <Text style={{ ...type.small, color: colors.textSoft, fontVariant: ['tabular-nums'] }}>{r.clock_in ? String(r.clock_in).slice(0, 5) : '—'}</Text> },
                { key: 'clock_out', label: 'Out', render: (r) => <Text style={{ ...type.small, color: colors.textSoft, fontVariant: ['tabular-nums'] }}>{r.clock_out ? String(r.clock_out).slice(0, 5) : '—'}</Text> },
                { key: 'status', label: 'Status', align: 'right', render: (r) => (
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {r.pending ? <PendingBadge label="Queued" /> : null}
                    <Badge tone={r.status === 'present' ? 'success' : 'neutral'} label={r.status || '—'} />
                  </View>
                ) },
              ]}
              rows={days}
            />
          </Section>
        </>
      )}

      {tab === 'leave' && (
        <>
          <Grid min={150}>
            <StatCard label="Pending" value={pendingLeave} tone={pendingLeave ? 'warning' : undefined} icon="clock" />
            <StatCard label="Approved" value={(leave || []).filter(l => l.status === 'approved').length} tone="success" icon="tick" />
          </Grid>
          <Section
            title="Leave requests" icon="note"
            action={<Button size="sm" title="Ask for leave" icon="plus" onPress={() => setAsking(true)} full={false} />}
          >
            {(leave || []).length === 0 ? (
              <EmptyState
                icon="note" title="No requests" message="Ask for leave here and whoever reviews it sees it at the school."
                action={<Button title="Ask for leave" icon="plus" onPress={() => setAsking(true)} full={false} />}
              />
            ) : (leave || []).map((l, i) => (
              <ListRow
                key={l.id ?? `queued-${i}`}
                icon="calendar" iconTone={l.status === 'approved' ? 'success' : l.status === 'rejected' ? 'danger' : 'warning'}
                title={`${l.leave_type} — ${l.days_requested} day${l.days_requested === 1 ? '' : 's'}`}
                subtitle={`${l.start_date} to ${l.end_date}`}
                badge={l.pending ? <PendingBadge /> : <Badge tone={LEAVE_TONE[l.status] || 'neutral'} label={l.status} />}
                meta={l.reviewer_notes ? <Muted numberOfLines={2}>Reviewer: {l.reviewer_notes}</Muted> : null}
              />
            ))}
          </Section>
        </>
      )}

      {tab === 'pay' && (
        <Section title="Payslips" icon="wallet" subtitle="Months the school has marked paid.">
          {(payslips || []).length === 0 ? (
            <EmptyState icon="wallet" title="No payslips" message="Nothing has been paid and recorded against your record yet." />
          ) : (payslips || []).map(p => (
            <ListRow
              key={p.id}
              icon="wallet" iconTone="success"
              title={`${MONTHS[(p.month || 1) - 1]} ${p.year}`}
              subtitle={[p.payment_method, p.payment_date].filter(Boolean).join(' · ')}
              right={<Text style={{ ...type.body, fontWeight: '800', color: colors.success }}>{money(p.actual_amount_paid || p.net_salary)}</Text>}
              onPress={() => setPayslip(p)}
            />
          ))}
        </Section>
      )}

      <Sheet
        visible={asking} onClose={() => setAsking(false)} title="Ask for leave"
        footer={<>
          <Button variant="outline" title="Cancel" onPress={() => setAsking(false)} full={false} />
          <Button title={saving ? 'Submitting…' : 'Submit request'} onPress={requestLeave} busy={saving} full={false} />
        </>}
      >
        <Select
          label="Kind of leave" value={form.leaveType}
          onChange={v => setForm(f => ({ ...f, leaveType: v }))}
          options={LEAVE_TYPES.map(t => ({ value: t, label: t }))}
        />
        <Field label="From" value={form.startDate} onChangeText={v => setForm(f => ({ ...f, startDate: v }))}
          placeholder="YYYY-MM-DD" icon="calendar" maxLength={10} />
        <Field label="To" value={form.endDate} onChangeText={v => setForm(f => ({ ...f, endDate: v }))}
          placeholder="YYYY-MM-DD" icon="calendar" maxLength={10} />
        <TextArea label="Why" value={form.justification} numberOfLines={4}
          onChangeText={v => setForm(f => ({ ...f, justification: v }))}
          placeholder="What the leave is for" />
      </Sheet>

      <Sheet
        visible={!!payslip} onClose={() => setPayslip(null)}
        title={payslip ? `${MONTHS[(payslip.month || 1) - 1]} ${payslip.year}` : ''}
      >
        {payslip ? (
          <>
            <KeyValue columns={2} items={[
              { label: 'Gross salary', value: money(payslip.gross_salary) },
              { label: 'Extra pay', value: payslip.extra_pay ? money(payslip.extra_pay) : null },
              { label: 'For', value: payslip.extra_pay_description },
              { label: 'SSNIT (worker)', value: money(payslip.ssnit_worker) },
              { label: 'PAYE tax', value: money(payslip.paye_tax) },
              { label: 'Other deductions', value: payslip.other_deductions ? money(payslip.other_deductions) : null },
              { label: 'Deduction note', value: payslip.other_deductions_description },
              { label: 'Carried over', value: payslip.carry_over_to_next ? money(payslip.carry_over_to_next) : null },
            ]} />
            <Divider />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Heading>Net paid</Heading>
              <Text style={{ ...type.numeric, color: colors.success }}>
                {money(payslip.actual_amount_paid || payslip.net_salary)}
              </Text>
            </View>
            <Muted style={{ marginTop: 6 }}>
              {[payslip.payment_method, payslip.payment_date, payslip.payment_reference].filter(Boolean).join(' · ')}
            </Muted>
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}
