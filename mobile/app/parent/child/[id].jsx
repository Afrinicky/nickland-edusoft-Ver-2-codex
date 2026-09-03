// A child's record, as a parent needs it.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// What this screen used to be: seven stacked cards of raw rows — a fee total,
// two attendance counts, a list of subject scores with no context, and a
// "Make a payment" button that took a card number. A parent could not see last
// term's report, could not tell whether a child was improving, could not find
// out what the bill was actually for, and had no way to ask.
//
// What it is now: one record, in the sections a parent actually asks about, and
// no payment anywhere in it.
//
//   Overview   who the child is, where they stand today, and one way to act.
//   Academics  this term's marks against the grading scale, with conduct,
//              interests, talents and the class teacher's remark.
//   Reports    every term the school has published, the trend across them, and
//              a printable report card for any one of them.
//   Register   the term day by day, not a running total.
//   Fees       the bill line by line, arrears carried forward, and every
//              payment ever received — printable as a statement.
//   Canteen    days paid, days owed, and the collections recorded.
//   Homework   what is set, what was handed in, what it was marked.
//   Timetable  the class's week.
//
// Settling a balance opens the school's WhatsApp with the child, the class and
// the figures already written into the message. The app takes no money.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useAuth } from '../../../src/auth';
import { useScreenTitle } from '../../../src/shell';
import { useBranding } from '../../../src/brand';
import { api, money } from '../../../src/api';
import {
  Screen, Card, Section, Hero, HeroStat, Heading, Title, Body, Muted, Micro, Badge,
  Avatar, Button, Tabs, Grid, StatCard, KeyValue, ListRow, Divider, ProgressBar,
  ErrorNote, InfoNote, WarningNote, Skeleton, EmptyState, DataTable, Select, Toolbar,
} from '../../../src/ui';
import { SettleBalance, PrintButton, ContactSchool } from '../../../src/actions';
import { Trend, Bars, Meter, DayStrip, colorForScore, toneForScore } from '../../../src/charts';
import { statementHtml } from '../../../src/print';
import { useLayout } from '../../../src/responsive';
import { colors, palette, spacing, radius, type } from '../../../src/theme';

const TABS = [
  { value: 'overview', label: 'Overview', icon: 'grid' },
  { value: 'academics', label: 'Academics', icon: 'award' },
  { value: 'conduct', label: 'Conduct', icon: 'shield' },
  { value: 'reports', label: 'Reports', icon: 'trend' },
  { value: 'attendance', label: 'Register', icon: 'check' },
  { value: 'fees', label: 'Fees', icon: 'wallet' },
  { value: 'canteen', label: 'Canteen', icon: 'bowl' },
  { value: 'homework', label: 'Homework', icon: 'book' },
  { value: 'timetable', label: 'Timetable', icon: 'calendar' },
];

export default function ChildDetail() {
  const { id } = useLocalSearchParams();
  const { token, profile, mode } = useAuth();
  const brand = useBranding();
  const layout = useLayout();

  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [report, setReport] = useState(null);
  const [reportTermId, setReportTermId] = useState(null);
  const [terms, setTerms] = useState([]);
  const [fees, setFees] = useState(null);
  const [canteen, setCanteen] = useState(null);
  const [register, setRegister] = useState(null);
  const [homework, setHomework] = useState([]);
  const [timetable, setTimetable] = useState(null);
  const [transport, setTransport] = useState(null);
  const [conduct, setConduct] = useState(null);
  const [profileSheet, setProfileSheet] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useScreenTitle(data?.child?.name || 'My child');

  // Each panel is fetched on its own and each is allowed to fail on its own.
  // An older school desktop with none of the new routes still shows the parent
  // everything it does have, rather than an error page.
  const load = useCallback(async () => {
    setError(null);
    const settle = (p, fallback) => p.then(r => r).catch(() => fallback);
    try {
      const [d, rep, rl, f, ct, att, hw, tt, tp, prof, cond] = await Promise.all([
        api.child(token, id),
        settle(api.childReport(token, id), null),
        settle(api.childReports(token, id), { terms: [] }),
        settle(api.childFees(token, id), null),
        settle(api.childCanteen(token, id), null),
        settle(api.childAttendance(token, id), null),
        settle(api.childHomework(token, id), { homework: [] }),
        settle(api.childTimetable(token, id), null),
        settle(api.childTransport(token, id), { transport: null }),
        settle(api.childProfile(token, id), null),
        // Commendations and incidents the school has recorded. A parent has
        // never been able to see either without being sent for.
        settle(api.childConduct(token, id), { events: [] }),
      ]);
      setData(d); setReport(rep); setTerms(rl.terms || []);
      setFees(f); setCanteen(ct); setRegister(att);
      setHomework(hw.homework || []); setTimetable(tt); setTransport(tp.transport);
      setProfileSheet(prof && prof.student ? prof.student : null);
      setConduct(cond.events || []);
      setReportTermId(rep?.term?.id ?? null);
    } catch (e) { setError(e.message); if (!data) setData({ child: null }); }
  }, [token, id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Opening a past term's report replaces only the report panel, so the rest of
  // the screen does not blink while the school's computer answers.
  const openTerm = useCallback(async (termId) => {
    setReportTermId(termId);
    setReport(null);
    try { setReport(await api.childReport(token, id, termId)); }
    catch (e) { setReport({ error: e.message, subjects: [] }); }
  }, [token, id]);

  if (data === null && !error) {
    return <Screen><Card><Skeleton rows={2} height={90} /></Card><Card><Skeleton rows={5} /></Card></Screen>;
  }
  if (!data || !data.child) {
    return (
      <Screen>
        <ErrorNote message={error || 'That child is not linked to your account.'} />
        <Card><EmptyState icon="users" title="Not available" message="Ask the school to link this pupil to your account." /></Card>
      </Screen>
    );
  }

  const c = data.child;
  const feeBal = c.fees?.balance || 0;
  const canteenOwed = c.canteen?.amount_owed || 0;
  const owed = { fees: feeBal, canteen: canteenOwed, books: c.fees?.books_balance || 0, total: feeBal + canteenOwed };
  const att = register?.totals || data.attendance || {};
  const rate = att.total ? Math.round(((att.present || 0) / att.total) * 100) : null;
  const parentName = profile?.parent?.full_name;

  const schoolHeader = report?.school || {
    name: brand.school?.name, motto: brand.school?.motto,
    address: brand.school?.address, phone: brand.contact?.phone,
    email: brand.contact?.email, logo: brand.logo,
  };

  // The school's own documents, fetched from the desktop that built them. Not
  // rebuilt here: a report card a parent prints at home has to be the report
  // card the office prints, and the only way to guarantee that is to print the
  // office's own file.
  const fetchReport = () => api.childReportDocument(token, id, reportTermId);
  const fetchProfile = () => api.childProfileDocument(token, id);

  const printStatement = () => statementHtml({
    school: schoolHeader,
    child: c, term: fees?.term || c.term,
    bill: fees?.bill, items: fees?.items, payments: fees?.payments || data.payments,
    canteen: canteen || c.canteen, history: fees?.history,
  });

  return (
    <Screen refreshControl={
      <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />
    }>
      <ErrorNote message={error} />

      <Hero
        crest={<Avatar name={c.name} photo={c.photo} size={layout.isPhone ? 60 : 76} tone="chrome" ring />}
        eyebrow={c.term?.label || 'This term'}
        title={c.name}
        subtitle={[c.class_name, c.index_number, c.class_teacher ? `Class teacher: ${c.class_teacher}` : null].filter(Boolean).join('  ·  ')}
        right={layout.isPhone ? null : (
          <View style={{ gap: spacing.sm }}>
            <HeroStat label="Owing" value={money(owed.total)} tone={owed.total > 0 ? 'danger' : 'light'} />
            {rate != null ? <HeroStat label="Attendance" value={`${rate}%`} /> : null}
          </View>
        )}
      >
        {layout.isPhone ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}><HeroStat label="Owing" value={money(owed.total)} tone={owed.total > 0 ? 'danger' : 'light'} /></View>
            {rate != null ? <View style={{ flex: 1 }}><HeroStat label="Attendance" value={`${rate}%`} /></View> : null}
          </View>
        ) : null}
      </Hero>

      <Card padded={false} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
        <Tabs value={tab} onChange={setTab} options={TABS} />
      </Card>

      {tab === 'overview' && (
        <Overview
          child={c} owed={owed} rate={rate} attendance={att} report={report} terms={terms}
          parentName={parentName} homework={homework} transport={transport}
          onPrintProfile={fetchProfile} onOpen={setTab}
        />
      )}

      {tab === 'academics' && <Academics report={report} onPrint={fetchReport} />}

      {tab === 'conduct' && <Conduct events={conduct} summary={report?.summary} cloud={mode === 'cloud'} />}

      {tab === 'reports' && (
        <Reports
          terms={terms} report={report} reportTermId={reportTermId}
          onOpenTerm={openTerm} onPrint={fetchReport} cloud={mode === 'cloud'}
        />
      )}

      {tab === 'attendance' && <Register register={register} attendance={att} rate={rate} cloud={mode === 'cloud'} />}

      {tab === 'fees' && (
        <Fees
          child={c} fees={fees} payments={data.payments} owed={owed} term={c.term}
          parentName={parentName} onPrint={printStatement}
        />
      )}

      {tab === 'canteen' && <Canteen child={c} canteen={canteen} owed={owed} parentName={parentName} term={c.term} />}

      {tab === 'homework' && <Homework items={homework} />}

      {tab === 'timetable' && <Timetable tt={timetable} />}
    </Screen>
  );
}

// ── overview ────────────────────────────────────────────────────────────────
function Overview({ child, owed, rate, attendance, report, terms, parentName, homework, transport, onPrintProfile, onOpen }) {
  const sum = report?.summary || {};
  const dueSoon = (homework || []).filter(h => h.due_date && h.my_status !== 'submitted').slice(0, 3);
  const trendPoints = (terms || []).slice(0, 6).reverse()
    .filter(t => t.average_score != null)
    .map(t => ({ label: shortTerm(t.label), value: t.average_score }));

  return (
    <>
      <Grid min={158}>
        <StatCard
          label="Term average" icon="award" tone="data"
          value={sum.average_score != null ? Number(sum.average_score).toFixed(1) : '—'}
          note={sum.class_rank ? `Position ${sum.class_rank} of ${sum.number_on_roll || '—'}` : 'Not published yet'}
        />
        <StatCard
          label="Attendance" icon="check" value={rate == null ? '—' : `${rate}%`}
          tone={rate == null ? undefined : rate >= 90 ? 'success' : rate >= 75 ? 'warning' : 'danger'}
          note={attendance.total ? `${attendance.present || 0} of ${attendance.total} days` : undefined}
        />
        <StatCard
          label="School fees" icon="wallet" value={money(owed.fees)}
          tone={owed.fees > 0 ? 'danger' : 'success'}
          note={owed.fees > 0 ? 'Outstanding' : 'Fully settled'}
        />
        <StatCard
          label="Canteen" icon="bowl" value={money(owed.canteen)}
          tone={owed.canteen > 0 ? 'danger' : 'success'}
          note={child.canteen?.unpaid_days ? `${child.canteen.unpaid_days} unpaid day${child.canteen.unpaid_days === 1 ? '' : 's'}` : 'Nothing owing'}
        />
      </Grid>

      {owed.total > 0 ? (
        <Card tone="accent">
          <Heading>{money(owed.total)} outstanding</Heading>
          <Muted style={{ marginTop: 4, marginBottom: spacing.md }}>
            No payment is taken in the app. Tap below and the school's office will confirm the amount
            and how to pay it — you can see the full breakdown under Fees and Canteen.
          </Muted>
          <SettleBalance child={child} owed={owed} term={child.term} parentName={parentName} />
        </Card>
      ) : (
        <Card tone="success">
          <Heading>Everything is settled</Heading>
          <Muted style={{ marginTop: 4 }}>Nothing is owing on fees or the canteen this term.</Muted>
        </Card>
      )}

      {trendPoints.length > 1 ? (
        <Section title="How the terms compare" icon="trend" subtitle="Average mark, term by term.">
          <Trend points={trendPoints} label="Term average" />
        </Section>
      ) : null}

      {child.fees?.billed ? (
        <Section title="This term's bill" icon="wallet"
          action={<Button size="sm" variant="ghost" title="See the bill" onPress={() => onOpen('fees')} full={false} />}>
          <ProgressBar
            value={child.fees.paid} max={child.fees.billed}
            tone={owed.fees > 0 ? 'warning' : 'success'}
            label={`${money(child.fees.paid)} of ${money(child.fees.billed)} paid`}
          />
          {child.fees.arrears > 0 ? (
            <Muted style={{ marginTop: spacing.sm }}>
              Includes {money(child.fees.arrears)} carried forward from a previous term.
            </Muted>
          ) : null}
        </Section>
      ) : null}

      {dueSoon.length ? (
        <Section title="Homework to hand in" icon="book"
          action={<Button size="sm" variant="ghost" title="All homework" onPress={() => onOpen('homework')} full={false} />}>
          {dueSoon.map(h => (
            <ListRow
              key={h.id} icon="book" iconTone={h.my_status === 'missing' ? 'danger' : 'primary'}
              title={h.title} subtitle={[h.subject_name, h.due_date ? `Due ${h.due_date}` : null].filter(Boolean).join(' · ')}
            />
          ))}
        </Section>
      ) : null}

      {transport ? (
        <Section title="Transport" icon="pin">
          <KeyValue items={[
            { label: 'Route', value: transport.route_name },
            { label: 'Stop', value: transport.stop_name },
            { label: 'Pick-up', value: transport.pickup_time },
            { label: 'Driver', value: [transport.driver_name, transport.driver_phone].filter(Boolean).join(' · ') },
            { label: 'Transport fee', value: transport.balance > 0 ? `${money(transport.balance)} outstanding` : 'Settled' },
          ]} />
        </Section>
      ) : null}

      <Section title="The school's record" icon="note" subtitle="What the office holds for this pupil.">
        <Toolbar>
          <PrintButton fetch={onPrintProfile} title="Print profile" />
          <ContactSchool variant="outline" size="sm" title="Message the school" icon="whatsapp" />
        </Toolbar>
      </Section>
    </>
  );
}

// ── academics ───────────────────────────────────────────────────────────────
function Academics({ report, onPrint }) {
  if (report === null) return <Card><Skeleton rows={6} /></Card>;
  const subjects = report.subjects || [];
  const sum = report.summary || {};

  if (!subjects.length) {
    return (
      <Card>
        <EmptyState
          icon="award" title="No marks published yet"
          message="Marks appear here as soon as the school publishes them for the term."
        />
      </Card>
    );
  }

  const best = subjects.reduce((a, b) => ((b.total_score || 0) > (a.total_score || 0) ? b : a), subjects[0]);
  const weakest = subjects.reduce((a, b) => ((b.total_score ?? 101) < (a.total_score ?? 101) ? b : a), subjects[0]);

  return (
    <>
      <Grid min={158}>
        <StatCard label="Average" value={sum.average_score != null ? Number(sum.average_score).toFixed(1) : '—'} tone="data" icon="chart" />
        <StatCard label="Position" value={sum.class_rank ? `${sum.class_rank}` : '—'} icon="award"
          note={sum.number_on_roll ? `of ${sum.number_on_roll} on roll` : undefined} />
        <StatCard label="Strongest" value={best?.total_score ?? '—'} tone="success" icon="trend" note={best?.subject} />
        <StatCard label="Needs work" value={weakest?.total_score ?? '—'} tone="warning" icon="alert" note={weakest?.subject} />
      </Grid>

      <Section
        title={`Marks — ${report.term?.label || 'this term'}`} icon="award"
        subtitle="Class work and examination combined, against the school's grading scale."
        action={<PrintButton fetch={onPrint} title="Print report" />}
      >
        <Bars items={subjects.map(s => ({
          label: s.subject,
          value: s.total_score,
          note: [s.class_score != null ? `CW ${s.class_score}` : null, s.exam_score != null ? `Exam ${s.exam_score}` : null]
            .filter(Boolean).join(' · '),
        }))} />
      </Section>

      <Section title="Subject by subject" icon="list">
        {subjects.map((s, i) => (
          <View key={i} style={{ paddingVertical: 9, borderBottomWidth: i === subjects.length - 1 ? 0 : 1, borderBottomColor: colors.borderSoft }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text style={{ ...type.body, fontWeight: '700', color: colors.text, flex: 1 }}>{s.subject}</Text>
              <Badge tone={toneForScore(s.total_score)} label={s.total_score == null ? '—' : String(s.total_score)} />
            </View>
            <Muted style={{ marginTop: 2 }}>
              {[
                s.class_score != null ? `Class work ${s.class_score}` : null,
                s.exam_score != null ? `Exam ${s.exam_score}` : null,
                s.grade_remark || gradeFor(s.total_score, report.grading_bands),
              ].filter(Boolean).join('  ·  ')}
            </Muted>
          </View>
        ))}
      </Section>

      <Remarks summary={sum} />
    </>
  );
}

// Conduct, interests, talents and the class teacher's remark. These are the
// part of a report card a parent reads first and the app never showed.
function Remarks({ summary }) {
  const s = summary || {};
  const blocks = [
    { label: 'Conduct', icon: 'shield', value: s.conduct_traits },
    { label: 'Interests', icon: 'sparkle', value: s.learner_interests },
    { label: 'Talents', icon: 'award', value: s.learner_talents },
    { label: "Class teacher's remark", icon: 'note', value: s.teacher_remarks },
  ].filter(b => b.value);
  if (!blocks.length) {
    return (
      <Card>
        <EmptyState icon="note" title="No remarks yet" message="The class teacher writes conduct and remarks at the end of term." />
      </Card>
    );
  }
  return (
    <Section title="Conduct and remarks" icon="shield">
      {blocks.map((b, i) => (
        <View key={b.label} style={{ marginTop: i ? spacing.md : 0 }}>
          <Micro>{b.label}</Micro>
          <Text style={{ ...type.body, color: colors.text, marginTop: 3 }}>{b.value}</Text>
        </View>
      ))}
    </Section>
  );
}

// ── reports, current and past ───────────────────────────────────────────────
function Reports({ terms, report, reportTermId, onOpenTerm, onPrint, cloud }) {
  const points = (terms || []).slice().reverse()
    .filter(t => t.average_score != null)
    .map(t => ({ label: shortTerm(t.label), value: t.average_score }));

  const ranks = (terms || []).slice().reverse()
    .filter(t => t.class_rank != null)
    .map(t => ({ label: shortTerm(t.label), value: t.class_rank }));

  return (
    <>
      {cloud ? (
        <InfoNote message="Over the internet the portal carries the current term. On the school's Wi-Fi you can open every past term as well." />
      ) : null}

      {points.length > 1 ? (
        <Section title="Performance over time" icon="trend" subtitle="Average mark across the terms the school has published.">
          <Trend points={points} label="Average mark" />
          {ranks.length > 1 ? (
            <View style={{ marginTop: spacing.xl }}>
              <Trend points={ranks} label="Position in class" tone="primary" min={1} />
              <Muted style={{ marginTop: 6 }}>Lower is better — 1 is top of the class.</Muted>
            </View>
          ) : null}
        </Section>
      ) : null}

      <Section title="Report cards" icon="award" subtitle="Tap a term to open its report.">
        {(terms || []).length === 0 ? (
          <Muted>No report has been published yet.</Muted>
        ) : (terms || []).map(t => {
          const open = String(t.id) === String(reportTermId);
          return (
            <ListRow
              key={t.id ?? t.label}
              icon="award" iconTone={open ? 'gold' : 'primary'}
              title={t.label}
              subtitle={[
                t.average_score != null ? `Average ${Number(t.average_score).toFixed(1)}` : 'Average not computed',
                t.class_rank ? `Position ${t.class_rank}${t.number_on_roll ? ` of ${t.number_on_roll}` : ''}` : null,
                t.subject_count ? `${t.subject_count} subject${t.subject_count === 1 ? '' : 's'}` : null,
              ].filter(Boolean).join('  ·  ')}
              badge={open ? <Badge tone="gold" label="Open" /> : null}
              onPress={t.id ? () => onOpenTerm(t.id) : undefined}
            />
          );
        })}
      </Section>

      {report === null ? <Card><Skeleton rows={5} /></Card> : (
        <Section
          title={`Report card — ${report.term?.label || 'this term'}`} icon="print"
          action={<PrintButton fetch={onPrint} title="Print" />}
        >
          <ErrorNote message={report.error} />
          <KeyValue items={[
            { label: 'Average', value: report.summary?.average_score != null ? Number(report.summary.average_score).toFixed(1) : null },
            { label: 'Position', value: report.summary?.class_rank ? `${report.summary.class_rank} of ${report.summary.number_on_roll || '—'}` : null },
            { label: 'Attendance', value: report.attendance?.total ? `${report.attendance.present} of ${report.attendance.total} days` : null },
            { label: 'Vacation', value: report.dates?.vacation },
            { label: 'School reopens', value: report.dates?.reopening },
          ]} />
          <Divider />
          {(report.subjects || []).length === 0
            ? <Muted>No marks were recorded for this term.</Muted>
            : <Bars items={(report.subjects || []).map(s => ({ label: s.subject, value: s.total_score, note: s.grade_remark }))} />}
          <View style={{ marginTop: spacing.md }}>
            <Remarks summary={report.summary} />
          </View>
        </Section>
      )}
    </>
  );
}

// ── the register ────────────────────────────────────────────────────────────
function Register({ register, attendance, rate, cloud }) {
  const days = register?.days || [];
  return (
    <>
      <Grid min={150}>
        <StatCard label="Present" value={attendance.present ?? '—'} tone="success" icon="check" />
        <StatCard label="Absent" value={attendance.absent ?? '—'} tone={attendance.absent ? 'danger' : undefined} icon="alert" />
        {attendance.late != null ? <StatCard label="Late" value={attendance.late} tone={attendance.late ? 'warning' : undefined} icon="clock" /> : null}
        <StatCard label="Days recorded" value={attendance.total ?? '—'} icon="calendar" />
      </Grid>

      <Section title="Attendance rate" icon="chart" subtitle={register?.term?.label}>
        <Meter
          value={attendance.present || 0} total={attendance.total || 0}
          label="Days present" goodAbove={90}
          caption={rate == null ? 'Nothing recorded this term yet.'
            : rate >= 90 ? 'Good attendance. Keep it up.'
              : rate >= 75 ? 'Attendance is slipping — the school may be in touch.'
                : 'Attendance is low. Please speak to the class teacher.'}
        />
      </Section>

      {days.length ? (
        <Section title="Day by day" icon="calendar" subtitle="Most recent first.">
          <DayStrip days={days} />
          <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md, flexWrap: 'wrap' }}>
            <Legend color={palette.green600} label="Present" />
            <Legend color={palette.amber600} label="Late" />
            <Legend color={palette.red600} label="Absent" />
          </View>
        </Section>
      ) : cloud ? (
        <InfoNote message="Day-by-day attendance comes from the school's own computer. On its Wi-Fi you can see every day of the term." />
      ) : (
        <Card><EmptyState icon="calendar" title="Nothing recorded" message="The register has not been marked for this term yet." /></Card>
      )}
    </>
  );
}

function Legend({ color, label }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <Muted>{label}</Muted>
    </View>
  );
}

// ── fees, itemised ──────────────────────────────────────────────────────────
function Fees({ child, fees, payments, owed, term, parentName, onPrint }) {
  const bill = fees?.bill;
  const items = fees?.items || [];
  const history = fees?.history || [];
  const list = fees?.payments || payments || [];
  const layout = useLayout();

  return (
    <>
      <Grid min={158}>
        <StatCard label="Billed this term" value={money(bill?.total_billed ?? child.fees?.billed)} icon="note" />
        <StatCard label="Paid" value={money(bill?.total_paid ?? child.fees?.paid)} tone="success" icon="check" />
        <StatCard label="Balance" value={money(bill?.balance ?? owed.fees)} tone={(bill?.balance ?? owed.fees) > 0 ? 'danger' : 'success'} icon="wallet" />
        {(bill?.arrears_from_prev || child.fees?.arrears) ? (
          <StatCard label="Brought forward" value={money(bill?.arrears_from_prev ?? child.fees.arrears)} tone="warning" icon="alert"
            note="Carried in from a previous term" />
        ) : null}
      </Grid>

      {owed.total > 0 ? (
        <Card tone="accent">
          <Heading>Settling this balance</Heading>
          <Muted style={{ marginTop: 4, marginBottom: spacing.md }}>
            The app never takes money. Tap below to message the school and the office will tell you
            exactly how to pay — mobile money, bank or at the office — and issue the receipt.
          </Muted>
          <SettleBalance child={child} owed={owed} term={term} parentName={parentName} />
        </Card>
      ) : null}

      {items.length ? (
        <Section
          title="What the bill is made of" icon="list" subtitle={fees?.term?.label || term?.label}
          action={<PrintButton build={onPrint} title="Print statement" />}
        >
          {items.map((i, n) => (
            <View key={n} style={{
              flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8,
              borderBottomWidth: n === items.length - 1 ? 0 : 1, borderBottomColor: colors.borderSoft,
            }}>
              <Text style={{ ...type.body, color: colors.text, flex: 1 }}>{i.description}</Text>
              {i.is_arrear ? <Badge tone="warning" label="Brought forward" /> : null}
              <Text style={{ ...type.body, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] }}>
                {money(i.amount)}
              </Text>
            </View>
          ))}
          {bill?.discount_amount ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.md }}>
              <Muted>Discount{bill.discount_reason ? ` — ${bill.discount_reason}` : ''}</Muted>
              <Text style={{ ...type.body, fontWeight: '800', color: colors.success }}>− {money(bill.discount_amount)}</Text>
            </View>
          ) : null}
        </Section>
      ) : (
        <Section title="The bill" icon="list"
          action={<PrintButton build={onPrint} title="Print statement" />}>
          <Muted>
            The itemised bill comes from the school's own computer. The totals above are current.
          </Muted>
        </Section>
      )}

      {fees?.books ? (
        <Section title="Books" icon="book" subtitle={fees.books.year_label}>
          <ProgressBar
            value={fees.books.total_paid} max={fees.books.total_amount || 1}
            tone={fees.books.balance > 0 ? 'warning' : 'success'}
            label={`${money(fees.books.total_paid)} of ${money(fees.books.total_amount)} paid`}
          />
          {(fees.books.items || []).map((b, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8 }}>
              <Muted>{b.title}</Muted>
              <Muted>{money(b.amount)}</Muted>
            </View>
          ))}
        </Section>
      ) : null}

      <Section title="Payment history" icon="cash" subtitle="Every receipt the school has issued for this pupil.">
        {list.length === 0 ? (
          <EmptyState icon="box" title="No payments recorded" message="Payments appear here once the school's office has receipted them." />
        ) : layout.canTable ? (
          <DataTable
            keyExtractor={(r, i) => String(r.receipt_number || i)}
            empty="No payments recorded."
            columns={[
              { key: 'payment_date', label: 'Date' },
              { key: 'receipt_number', label: 'Receipt', render: (r) => <Text style={{ ...type.small, color: colors.textSoft }}>{r.receipt_number || '—'}</Text> },
              { key: 'term_label', label: 'Term', render: (r) => <Text style={{ ...type.small, color: colors.muted }}>{r.term_label || '—'}</Text> },
              { key: 'payment_method', label: 'Method' },
              {
                key: 'amount', label: 'Amount', align: 'right',
                render: (r) => <Text style={{ ...type.small, fontWeight: '800', color: colors.success, fontVariant: ['tabular-nums'] }}>{money(r.amount)}</Text>,
              },
            ]}
            rows={list}
          />
        ) : list.map((p, i) => (
          <ListRow
            key={i} icon="cash" iconTone="success"
            title={money(p.amount)}
            subtitle={[p.payment_date, p.payment_method, p.receipt_number].filter(Boolean).join(' · ')}
          />
        ))}
      </Section>

      {history.length > 1 ? (
        <Section title="Term by term" icon="trend" subtitle="How each term's bill was settled.">
          {history.map((h, i) => (
            <View key={i} style={{ paddingVertical: 9, borderBottomWidth: i === history.length - 1 ? 0 : 1, borderBottomColor: colors.borderSoft }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ ...type.body, fontWeight: '700', color: colors.text, flex: 1 }}>{h.term_label}</Text>
                <Badge tone={h.balance > 0 ? 'danger' : 'success'} label={h.balance > 0 ? `${money(h.balance)} left` : 'Settled'} />
              </View>
              <Muted style={{ marginTop: 2 }}>
                Billed {money(h.total_billed)} · Paid {money(h.total_paid)}
                {h.arrears_from_prev ? ` · Included ${money(h.arrears_from_prev)} brought forward` : ''}
              </Muted>
            </View>
          ))}
        </Section>
      ) : null}
    </>
  );
}

// ── canteen ─────────────────────────────────────────────────────────────────
function Canteen({ child, canteen, owed, parentName, term }) {
  const ct = canteen || {};
  const rate = ct.daily_rate || child.canteen?.daily_rate;
  const unpaid = ct.unpaid_days ?? child.canteen?.unpaid_days ?? 0;
  const amount = ct.amount_owed ?? child.canteen?.amount_owed ?? 0;

  return (
    <>
      <Grid min={150}>
        <StatCard label="Days owing" value={unpaid} tone={unpaid ? 'warning' : 'success'} icon="bowl" />
        <StatCard label="Amount owing" value={money(amount)} tone={amount > 0 ? 'danger' : 'success'} icon="wallet" />
        {ct.paid_days != null ? <StatCard label="Days paid" value={ct.paid_days} tone="success" icon="check" /> : null}
        {rate ? <StatCard label="Daily rate" value={money(rate)} icon="cash" /> : null}
      </Grid>

      {amount > 0 ? (
        <Card tone="accent">
          <Heading>{money(amount)} for the canteen</Heading>
          <Muted style={{ marginTop: 4, marginBottom: spacing.md }}>
            {unpaid} school day{unpaid === 1 ? '' : 's'} unpaid{rate ? ` at ${money(rate)} a day` : ''}.
            Canteen money is collected at the school — message the office to arrange it.
          </Muted>
          <SettleBalance child={child} owed={{ ...owed, fees: 0 }} term={term} parentName={parentName} />
        </Card>
      ) : null}

      {(ct.days || []).length ? (
        <Section title="Day by day" icon="calendar" subtitle="Most recent first.">
          <DayStrip days={ct.days} />
          <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md, flexWrap: 'wrap' }}>
            <Legend color={palette.green600} label="Paid" />
            <Legend color={palette.red600} label="Unpaid" />
            <Legend color={colors.muted} label="Excused" />
          </View>
        </Section>
      ) : null}

      <Section title="Collections recorded" icon="cash">
        {(ct.payments || []).length === 0 ? (
          <Muted>Nothing has been collected against this pupil yet.</Muted>
        ) : (ct.payments || []).map((p, i) => (
          <ListRow
            key={i} icon="bowl" iconTone="success"
            title={money(p.amount)}
            subtitle={[p.payment_date, p.days_covered ? `${p.days_covered} day${p.days_covered === 1 ? '' : 's'}` : null, p.notes]
              .filter(Boolean).join(' · ')}
          />
        ))}
      </Section>
    </>
  );
}

// ── homework ────────────────────────────────────────────────────────────────
function Homework({ items }) {
  if (!items || !items.length) {
    return <Card><EmptyState icon="book" title="No homework set" message="Assignments for this class appear here as teachers set them." /></Card>;
  }
  return (
    <Section title="Homework" icon="book" subtitle={`${items.length} assignment${items.length === 1 ? '' : 's'}`}>
      {items.map((h, i) => (
        <View key={h.id ?? i} style={{ paddingVertical: 10, borderBottomWidth: i === items.length - 1 ? 0 : 1, borderBottomColor: colors.borderSoft }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text style={{ ...type.body, fontWeight: '700', color: colors.text, flex: 1 }}>{h.title}</Text>
            {h.my_marks != null && h.max_marks != null
              ? <Badge tone={toneForScore((h.my_marks / h.max_marks) * 100)} label={`${h.my_marks}/${h.max_marks}`} />
              : h.my_status && h.my_status !== 'pending'
                ? <Badge tone={h.my_status === 'missing' ? 'danger' : h.my_status === 'late' ? 'warning' : 'success'}
                    label={h.my_status === 'missing' ? 'Not handed in' : h.my_status === 'late' ? 'Late' : 'Handed in'} />
                : null}
          </View>
          <Muted style={{ marginTop: 2 }}>
            {[h.subject_name, h.due_date ? `Due ${h.due_date}` : null].filter(Boolean).join('  ·  ')}
          </Muted>
          {h.description ? <Body style={{ marginTop: 4 }}>{h.description}</Body> : null}
        </View>
      ))}
    </Section>
  );
}

// ── timetable ───────────────────────────────────────────────────────────────
function Timetable({ tt }) {
  if (!tt || !tt.periods || !tt.periods.length) {
    return <Card><EmptyState icon="calendar" title="No timetable" message="The class timetable appears here once the school has set it." /></Card>;
  }
  const days = (tt.days || []).map(d => ({
    ...d,
    lessons: (tt.periods || [])
      .filter(p => !p.is_break)
      .map(p => ({ p, cell: tt.entries[`${d.value}:${p.id}`] }))
      .filter(x => x.cell && (x.cell.subject_name || x.cell.teacher_name)),
  })).filter(d => d.lessons.length);

  if (!days.length) {
    return <Card><EmptyState icon="calendar" title="Nothing scheduled" message="No lessons have been placed on this class's timetable." /></Card>;
  }

  return (
    <>
      {days.map(d => (
        <Section key={d.value} title={d.label} icon="calendar">
          {d.lessons.map(({ p, cell }, i) => (
            <ListRow
              key={i} icon="clock" iconTone="primary"
              title={cell.subject_name || 'Lesson'}
              subtitle={cell.teacher_name || undefined}
              right={<Text style={{ ...type.small, fontWeight: '700', color: colors.textSoft, fontVariant: ['tabular-nums'] }}>
                {p.start_time}–{p.end_time}
              </Text>}
            />
          ))}
        </Section>
      ))}
    </>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────
function gradeFor(score, bands) {
  if (score == null) return null;
  const hit = (bands || []).find(b => score >= b.min_score && score <= b.max_score);
  return hit ? hit.remark : null;
}

// "First Term 2025/2026" is wider than a chart label can be. This keeps the
// part that distinguishes one point from the next.
function shortTerm(label) {
  const s = String(label || '');
  const m = s.match(/(first|second|third|1st|2nd|3rd|term\s*\d)/i);
  const year = s.match(/(\d{4})\s*[/-]\s*(\d{2,4})/);
  const head = m ? m[0].replace(/term\s*/i, 'T').replace(/first/i, 'T1').replace(/second/i, 'T2').replace(/third/i, 'T3') : s.slice(0, 6);
  return year ? `${head} ${year[1].slice(2)}` : head;
}


// ── conduct ─────────────────────────────────────────────────────────────────
// The end-of-term picture (what the class teacher wrote on the report card)
// and the running log (what happened, and when). A parent had access to
// neither: the remarks were buried under a list of scores and the log lived on
// the school's own computer.
const CONDUCT_KIND = {
  achievement: { label: 'Commendation', icon: 'award', tone: 'success' },
  misconduct: { label: 'Incident', icon: 'alert', tone: 'danger' },
  health: { label: 'Health', icon: 'shield', tone: 'info' },
  note: { label: 'Note', icon: 'note', tone: 'primary' },
};

function Conduct({ events, summary, cloud }) {
  const list = events || [];
  const good = list.filter(e => e.event_type === 'achievement').length;
  const bad = list.filter(e => e.event_type === 'misconduct').length;

  return (
    <>
      <Remarks summary={summary} />

      {list.length ? (
        <Grid min={150}>
          <StatCard label="Commendations" value={good} tone="success" icon="award" />
          <StatCard label="Incidents" value={bad} tone={bad ? 'warning' : 'success'} icon="alert" />
          <StatCard label="Entries" value={list.length} icon="note" />
        </Grid>
      ) : null}

      <Section title="What the school has recorded" icon="shield" subtitle="Most recent first.">
        {list.length === 0 ? (
          <EmptyState
            icon="shield" title="Nothing recorded"
            message={cloud
              ? "Conduct entries are kept on the school's own computer. On the school's network you can see them here."
              : 'Nothing has been written about conduct this term — which for most children is exactly as it should be.'}
          />
        ) : list.map(e => {
          const k = CONDUCT_KIND[e.event_type] || CONDUCT_KIND.note;
          return (
            <ListRow
              key={e.id}
              icon={k.icon} iconTone={k.tone}
              title={e.title}
              subtitle={[e.date, e.recorded_by_name].filter(Boolean).join(' · ')}
              badge={<Badge tone={k.tone} label={k.label} />}
              meta={e.description ? <Body numberOfLines={4}>{e.description}</Body> : null}
            />
          );
        })}
      </Section>
    </>
  );
}
