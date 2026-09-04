// The teacher's day, before anything else.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Ordered by what a teacher actually opens the app for at ten past seven in the
// morning, which is not "how many pupils does this school have".
//
//   1. Who they are, and one figure: how much of today is done.
//   2. What today still needs — the register untaken, the canteen uncollected,
//      the lesson note due. Each row is the job, its state, and a way into it.
//   3. Today's lessons.
//   4. Notices, and the school's numbers last.
//
// "Today's progress" is a real count, not decoration: it is the share of the
// day's jobs this account has actually finished. A ring that always reads 100%
// would be worse than no ring.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../auth';
import { useBranding } from '../../brand';
import { api, money, firstName } from '../../api';
import {
  Screen, Card, Section, Grid, StatCard, Heading, Title, Body, Muted, Micro,
  Button, Badge, ErrorNote, Skeleton, IconTile, EmptyState, ListRow, Divider,
  ProgressRing, Avatar, Crest, Toolbar, MenuRow,
} from '../../ui';
import { ContactSchool } from '../../actions';
import { Appear, AppearList, Press, useCountUp } from '../../motion';
import { Icon } from '../../icons';
import { visibleNav, STAFF_NAV } from '../../nav';
import { useLayout } from '../../responsive';
import { colors, palette, gradients, spacing, radius, shadow, type } from '../../theme';
import { Gradient } from '../../ui';

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const { token, profile, mode } = useAuth();
  const router = useRouter();
  const layout = useLayout();
  const brand = useBranding();
  const [data, setData] = useState(null);
  const [timetable, setTimetable] = useState(null);
  const [hr, setHr] = useState(null);
  const [notices, setNotices] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [clocking, setClocking] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    // Each panel fails on its own. One refused module must not blank the
    // whole screen — a teacher without fees still has a register to take.
    const settle = (p, fallback) => p.then(r => r).catch(() => fallback);
    const [d, t, h, n] = await Promise.all([
      settle(api.dashboard(token), { metrics: {}, denied: true }),
      settle(api.myTimetable(token), { days: [], today: null }),
      settle(api.hrMe(token), { has_staff: false }),
      settle(api.announcements(token), { announcements: [], denied: true }),
    ]);
    setData(d); setTimetable(t); setHr(h); setNotices(n.announcements || []);
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function punch(direction) {
    setClocking(true);
    try {
      await api.clock(token, direction);
      setHr(await api.hrMe(token).catch(() => hr));
    } catch (e) { setError(e.message); }
    finally { setClocking(false); }
  }

  const nav = useMemo(() => visibleNav(STAFF_NAV, profile), [profile]);

  // ── what today still needs ──
  // Derived rather than fetched: every fact here is already on the screen.
  const today = timetable?.today;
  const lessons = (today?.periods || []).filter(p => !p.is_break);
  const clockedIn = hr?.today?.attendance?.clock_in;
  const clockedOut = hr?.today?.attendance?.clock_out;
  const has = (key) => nav.some(i => i.key === key);

  const jobs = useMemo(() => {
    const out = [];
    if (hr?.has_staff) {
      out.push({
        key: 'clock', icon: 'clock', label: 'Sign in for the day',
        state: clockedOut ? 'done' : clockedIn ? 'doing' : 'todo',
        note: clockedIn ? `On duty since ${String(clockedIn).slice(0, 5)}` : 'Not clocked in yet',
        onPress: clockedIn || clockedOut ? null : () => punch('in'),
      });
    }
    if (has('attendance')) {
      out.push({
        key: 'attendance', icon: 'check', label: "Take today's register",
        state: 'todo', note: lessons.length ? `${lessons.length} lesson${lessons.length === 1 ? '' : 's'} today` : 'Whichever class is yours',
        href: '/app/students?tab=register',
      });
    }
    if (has('canteen')) {
      out.push({
        key: 'canteen', icon: 'bowl', label: 'Canteen collection',
        state: 'todo', note: 'Quick pay — a class in one pass',
        href: '/app/canteen?tab=quickpay',
      });
    }
    if (has('notes')) {
      out.push({
        key: 'notes', icon: 'note', label: 'Lesson note',
        state: 'todo', note: "Write today's and submit it",
        href: '/app/staff?tab=lessonnotes',
      });
    }
    if (has('scores')) {
      out.push({
        key: 'scores', icon: 'chart', label: 'Enter exam marks',
        state: 'todo', note: 'A class and a subject at a time',
        href: '/app/academics?tab=examscores',
      });
    }
    return out;
  }, [hr, clockedIn, clockedOut, lessons.length, nav]);

  const doneCount = jobs.filter(j => j.state === 'done').length;
  const pct = jobs.length ? Math.round((doneCount / jobs.length) * 100) : 0;

  if (data === null) {
    return <Screen><Skeleton rows={1} height={150} /><Skeleton rows={3} height={64} /></Screen>;
  }

  const m = data.metrics || {};
  const now = new Date();
  const name = profile?.user?.full_name;

  return (
    <Screen refreshControl={
      <RefreshControl refreshing={refreshing} tintColor={colors.primary}
        onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />
    }>
      <ErrorNote message={error} />

      {/* The greeting sits on the page, not on a slab of colour — the way the
          reference has it. Violet appears once, on the card carrying the one
          figure the screen is about. */}
      <Appear distance={10}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: 2 }}>
          <Avatar name={name || 'Teacher'} photo={profile?.photo} size={46} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ ...type.title, color: colors.text, fontSize: layout.isCompact ? 20 : 23 }}>
              Hi, {firstName(name)}
            </Text>
            <Muted numberOfLines={1} style={{ marginTop: 2 }}>
              {greeting()} · {now.toLocaleDateString('en-GB', {
                weekday: layout.isCompact ? 'short' : 'long',
                day: 'numeric',
                month: layout.isCompact ? 'short' : 'long',
              })}
            </Muted>
          </View>
          {hr?.has_staff && !clockedOut ? (
            <Button
              size="sm" variant={clockedIn ? 'outline' : 'primary'} full={false}
              icon="clock" busy={clocking}
              title={clockedIn ? 'Clock out' : 'Clock in'}
              onPress={() => punch(clockedIn ? 'out' : 'in')}
            />
          ) : null}
        </View>
      </Appear>

      <Appear distance={12} delay={60}>
        <Gradient colors={gradients.brand} angle={128} style={[styles.progress, shadow.raised]}>
          <View pointerEvents="none" style={styles.progressGlow} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ ...type.micro, color: 'rgba(255,255,255,0.72)' }}>TODAY'S PROGRESS</Text>
              <Text numberOfLines={2} style={{ ...type.body, color: '#fff', fontWeight: '700', fontSize: 16, marginTop: 6 }}>
                {jobs.length === 0
                  ? 'Nothing assigned to you yet'
                  : doneCount === jobs.length
                    ? "Everything on today's list is done."
                    : `${doneCount} of ${jobs.length} done — ${jobs.find(j => j.state !== 'done')?.label.toLowerCase()} next.`}
              </Text>
              <Text numberOfLines={1} style={{ ...type.small, color: 'rgba(255,255,255,0.64)', marginTop: 5 }}>
                {[data.term?.label, clockedIn ? `On duty since ${String(clockedIn).slice(0, 5)}` : null]
                  .filter(Boolean).join('  ·  ')}
              </Text>
            </View>
            <ProgressRing value={pct} size={74} thickness={8} tone="chrome" />
          </View>
        </Gradient>
      </Appear>

      {/* What today needs. Each row is a job, its state, and a way into it. */}
      {jobs.length > 0 && (
        <Section
          title="Today" icon="list"
          subtitle="What the day still needs from you."
          action={<Button size="sm" variant="ghost" title="Timetable" full={false} onPress={() => router.push('/app/academics?tab=timetable')} />}
        >
          <AppearList>
            {jobs.map((j, i) => (
              <ListRow
                key={j.key}
                icon={j.icon}
                iconTone={j.state === 'done' ? 'success' : j.state === 'doing' ? 'warning' : 'primary'}
                title={j.label}
                subtitle={j.note}
                last={i === jobs.length - 1}
                badge={
                  j.state === 'done' ? <Badge tone="success" label="Done" icon="tick" />
                    : j.state === 'doing' ? <Badge tone="warning" label="In progress" />
                      : <Badge tone="neutral" label="To do" />
                }
                onPress={j.href ? () => router.push(j.href) : j.onPress || undefined}
              />
            ))}
          </AppearList>
        </Section>
      )}

      {/* Today's lessons. The single most-asked question of the school day. */}
      <Section
        title="Today's lessons" icon="calendar"
        subtitle={today ? today.label : 'Not a school day'}
        action={<Button size="sm" variant="ghost" title="Full week" onPress={() => router.push('/app/academics?tab=timetable')} full={false} />}
      >
        {lessons.length === 0
          ? <Muted>{timetable?.has_staff === false
              ? "Your account isn't linked to a staff record, so there's no timetable to show. Ask the school office."
              : 'No lessons scheduled today.'}</Muted>
          : (
            <AppearList>
              {lessons.slice(0, 6).map((p, i, arr) => (
                <ListRow
                  key={i}
                  icon="clock" iconTone="violet"
                  title={p.subject_name || 'Lesson'}
                  subtitle={[p.class_name, p.period_label].filter(Boolean).join(' · ')}
                  last={i === arr.length - 1}
                  right={<Text style={{ ...type.small, fontWeight: '700', color: colors.textSoft, fontVariant: ['tabular-nums'] }}>
                    {p.start_time}–{p.end_time}
                  </Text>}
                />
              ))}
            </AppearList>
          )}
      </Section>

      {/* The school's numbers — last, and only the ones this account may see. */}
      {!data.denied && (
        <Grid min={152}>
          <StatCard label="Active pupils" value={m.students ?? '—'} icon="users" />
          <StatCard label="Active staff" value={m.staff ?? '—'} icon="badge" />
          {m.fees_collected != null && <StatCard label="Fees collected" value={money(m.fees_collected)} tone="success" icon="cash" />}
          {m.fees_outstanding != null && <StatCard label="Fees outstanding" value={money(m.fees_outstanding)} tone="danger" icon="alert" />}
        </Grid>
      )}

      {notices && notices.length > 0 && (
        <Section
          title="Notices" icon="bell"
          action={<Button size="sm" variant="ghost" title="All notices" onPress={() => router.push('/app/notifications?tab=notices')} full={false} />}
        >
          {notices.slice(0, 3).map((a, i, arr) => (
            <View key={a.id ?? i} style={{ paddingVertical: 9, borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomColor: colors.borderSoft }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Text numberOfLines={1} style={{ ...type.body, fontWeight: '700', color: colors.text, flexShrink: 1 }}>{a.title}</Text>
                {a.pending ? <Badge tone="data" label="Waiting to sync" /> : null}
              </View>
              <Muted numberOfLines={2} style={{ marginTop: 2 }}>{a.body}</Muted>
            </View>
          ))}
        </Section>
      )}

      {/* The school itself, and a way to reach the office. */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' }}>
          <Crest logo={brand.logo} size={44} tone="light" />
          <View style={{ flex: 1, minWidth: 150 }}>
            <Heading numberOfLines={1}>{brand.school?.name || profile?.school?.name || 'Your school'}</Heading>
            {brand.school?.motto ? <Muted numberOfLines={1}>{brand.school.motto}</Muted> : null}
          </View>
          <ContactSchool variant="subtle" size="sm" title="Message the school" icon="whatsapp" />
        </View>
      </Card>

      {mode === 'cloud' && (
        <Muted style={{ textAlign: 'center', paddingVertical: spacing.sm }}>
          Signed in over the internet. Figures are the school's last sync; anything you write is
          queued and applied when its computer next connects.
        </Muted>
      )}
    </Screen>
  );
}

const styles = {
  progress: { borderRadius: radius.lg, padding: spacing.xl, overflow: 'hidden' },
  progressGlow: {
    position: 'absolute', right: -60, top: -70, width: 210, height: 210,
    borderRadius: 105, backgroundColor: 'rgba(255,255,255,0.09)',
  },
};
