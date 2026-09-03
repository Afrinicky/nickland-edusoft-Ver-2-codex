// The teacher's overview — what today needs, before anything else.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Ordered by what a teacher actually opens the app for: today's lessons and the
// register, then the work waiting, then the school's numbers. The numbers were
// at the top in the first version, which put the least useful thing on the
// screen a teacher sees fifty times a week.
import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../src/auth';
import { api, money } from '../../src/api';
import {
  Screen, Card, Section, Grid, StatCard, Heading, Title, Body, Muted, Micro,
  Button, Badge, ErrorNote, Skeleton, IconTile, Gradient, EmptyState, ListRow, Divider,
  Hero, HeroStat, Avatar, Crest, Toolbar,
} from '../../src/ui';
import { useBranding } from '../../src/brand';
import { ContactSchool } from '../../src/actions';
import { Icon } from '../../src/icons';
import { visibleNav, STAFF_NAV } from '../../src/nav';
import { useLayout } from '../../src/responsive';
import { colors, palette, gradients, spacing, radius, shadow, type } from '../../src/theme';

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

  if (data === null) {
    return <Screen><Skeleton rows={2} height={92} /><Skeleton rows={4} height={64} /></Screen>;
  }

  const m = data.metrics || {};
  const nav = visibleNav(STAFF_NAV, profile).filter(i => !['dashboard', 'account', 'me'].includes(i.key));
  const today = timetable?.today;
  const lessons = (today?.periods || []).filter(p => !p.is_break);
  const clockedIn = hr?.today?.attendance?.clock_in;
  const clockedOut = hr?.today?.attendance?.clock_out;
  const now = new Date();

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ErrorNote message={error} />

      {/* Who, where, when — and the one action that belongs to arriving. */}
      <Hero
        crest={<Avatar name={profile?.user?.full_name || 'Teacher'} photo={profile?.photo}
          size={layout.isPhone ? 54 : 66} tone="chrome" ring />}
        eyebrow={greeting()}
        title={profile?.user?.full_name || 'Teacher'}
        subtitle={[profile?.designation, data.term?.label, `${DAY[now.getDay()]} ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`]
          .filter(Boolean).join('  ·  ')}
        right={hr?.has_staff ? (
          <View style={styles.clock}>
            <Micro style={{ color: 'rgba(255,255,255,0.65)' }}>{clockedIn ? 'On duty since' : 'Not clocked in'}</Micro>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 20, marginTop: 2, fontVariant: ['tabular-nums'] }}>
              {clockedIn ? String(clockedIn).slice(0, 5) : '—:—'}
            </Text>
            {clockedOut ? (
              <Muted style={{ color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>Left at {String(clockedOut).slice(0, 5)}</Muted>
            ) : (
              <Button
                size="sm" variant={clockedIn ? 'outline' : 'gold'}
                title={clockedIn ? 'Clock out' : 'Clock in'}
                busy={clocking}
                onPress={() => punch(clockedIn ? 'out' : 'in')}
                style={clockedIn ? { borderColor: 'rgba(255,255,255,0.4)', marginTop: 8 } : { marginTop: 8 }}
              />
            )}
          </View>
        ) : null}
      />

      {/* The school's own crest and a way to reach the office, on the first
          screen of the day. Neither had a home in the app before. */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' }}>
          <Crest logo={brand.logo} size={44} tone="light" />
          <View style={{ flex: 1, minWidth: 160 }}>
            <Heading>{brand.school?.name || profile?.school?.name || 'Your school'}</Heading>
            {brand.school?.motto ? <Muted numberOfLines={1}>{brand.school.motto}</Muted> : null}
          </View>
          <Toolbar>
            <ContactSchool variant="subtle" size="sm" title="Message the school" icon="whatsapp" />
          </Toolbar>
        </View>
      </Card>

      {/* Today's lessons. The single most-asked question of the school day. */}
      <Section
        title="Today's lessons" icon="calendar"
        subtitle={today ? today.label : 'Not a school day'}
        action={<Button size="sm" variant="ghost" title="Full week" onPress={() => router.push('/staff/timetable')} full={false} />}
      >
        {lessons.length === 0
          ? <Muted>{timetable?.has_staff === false
              ? "Your account isn't linked to a staff record, so there's no timetable to show. Ask the school office."
              : 'No lessons scheduled today.'}</Muted>
          : lessons.slice(0, 6).map((p, i) => (
              <ListRow
                key={i}
                icon="clock" iconTone="primary"
                title={p.subject_name || 'Lesson'}
                subtitle={[p.class_name, p.period_label].filter(Boolean).join(' · ')}
                right={<Text style={{ ...type.small, fontWeight: '700', color: colors.textSoft, fontVariant: ['tabular-nums'] }}>
                  {p.start_time}–{p.end_time}
                </Text>}
              />
            ))}
      </Section>

      {/* Everything the account may do, as one grid rather than five taps. */}
      {/* On a desktop the sidebar already lists every screen, so this would be
          the same list twice. It earns its place where navigation is a bottom
          bar of five and a More sheet. */}
      {nav.length > 0 && !layout.isDesktop && (
        <Section title="Jump to" icon="grid">
          <Grid min={132} columns={layout.isDesktop ? 5 : layout.isTablet ? 4 : 2}>
            {nav.map(a => (
              <TouchableOpacity key={a.key} onPress={() => router.push(a.href)} activeOpacity={0.82} style={styles.action}>
                <IconTile name={a.icon} size={40} tone="primary" />
                <Text numberOfLines={2} style={{ ...type.small, fontWeight: '700', color: colors.text, textAlign: 'center' }}>
                  {a.label}
                </Text>
              </TouchableOpacity>
            ))}
          </Grid>
        </Section>
      )}

      {/* The school's numbers, last — and only the ones this account may see. */}
      {!data.denied && (
        <Grid min={150}>
          <StatCard label="Active pupils" value={m.students ?? '—'} icon="users" />
          <StatCard label="Active staff" value={m.staff ?? '—'} icon="badge" />
          {m.fees_collected != null && <StatCard label="Fees collected" value={money(m.fees_collected)} tone="success" icon="wallet" />}
          {m.fees_outstanding != null && <StatCard label="Fees outstanding" value={money(m.fees_outstanding)} tone="danger" icon="alert" />}
        </Grid>
      )}

      {notices && notices.length > 0 && (
        <Section
          title="Notices" icon="bell"
          action={<Button size="sm" variant="ghost" title="All notices" onPress={() => router.push('/staff/notices')} full={false} />}
        >
          {notices.slice(0, 3).map((a, i) => (
            <View key={a.id ?? i} style={{ paddingVertical: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ ...type.body, fontWeight: '700', color: colors.text, flexShrink: 1 }}>{a.title}</Text>
                {a.pending ? <Badge tone="data" label="Waiting to sync" /> : null}
              </View>
              <Muted numberOfLines={2} style={{ marginTop: 2 }}>{a.body}</Muted>
              {i < 2 && <Divider />}
            </View>
          ))}
        </Section>
      )}

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
  clock: {
    backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: radius.md,
    padding: spacing.md, minWidth: 150,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  action: {
    alignItems: 'center', gap: 8, paddingVertical: spacing.md, paddingHorizontal: 6,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderSoft,
    backgroundColor: colors.surfaceAlt,
  },
};
