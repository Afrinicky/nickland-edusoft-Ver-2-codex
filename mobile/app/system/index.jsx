// The system itself.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// What an administrator actually needs to know: how many accounts there are,
// how many sessions are live, whether the school is taking money online, and
// whether anything has been refused lately. The last one is the important one
// — a run of denials is the earliest sign anybody gets that an account has
// been taken.
import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../src/api';
import { OfficeScreen, useOffice } from '../../src/office';
import { Card, Section, Grid, StatCard, Muted, Button, ListRow, Badge } from '../../src/ui';
import { colors, spacing, type } from '../../src/theme';

export default function SystemOverview() {
  const router = useRouter();
  const state = useOffice((t) => api.systemOverview(t));
  const d = state.data;

  return (
    <OfficeScreen state={state} skeleton={4}>
      {d ? (
        <>
          <Grid min={150}>
            <StatCard label="Accounts" value={d.counts.users} tone="data" icon="users"
              note={d.counts.users_inactive ? `${d.counts.users_inactive} deactivated` : 'All active'}
              onPress={() => router.push('/system/users')} />
            <StatCard label="Roles" value={d.counts.designations} tone="neutral" icon="gear"
              onPress={() => router.push('/system/access')} />
            <StatCard label="Pupils" value={d.counts.students} tone="neutral" icon="badge" />
            <StatCard label="Staff" value={d.counts.staff} tone="neutral" icon="badge" />
          </Grid>

          {d.security ? (
            <Section title="Security" icon="alert" subtitle="The last seven days.">
              <Grid min={150}>
                <StatCard label="Refusals" value={d.security.denials_7d ?? d.security.recent_denials ?? 0}
                  tone={(d.security.denials_7d ?? d.security.recent_denials ?? 0) > 20 ? 'danger'
                       : (d.security.denials_7d ?? d.security.recent_denials ?? 0) ? 'warning' : 'success'}
                  icon="alert" note="Somebody reaching for what they may not have"
                  onPress={() => router.push('/system/audit')} />
                {d.security.failed_logins_7d != null ? (
                  <StatCard label="Failed sign-ins" value={d.security.failed_logins_7d}
                    tone={d.security.failed_logins_7d > 20 ? 'danger'
                         : d.security.failed_logins_7d ? 'warning' : 'success'}
                    icon="lock" onPress={() => router.push('/system/audit')} />
                ) : null}
                {d.sessions ? (
                  <StatCard label="Live sessions" value={d.sessions.live} tone="neutral" icon="check" />
                ) : null}
              </Grid>
            </Section>
          ) : null}

          {d.password_requests ? (
            <Card tone="warning">
              <Text style={{ ...type.body, fontWeight: '800', color: colors.text }}>
                {`${d.password_requests} password reset${d.password_requests === 1 ? '' : 's'} waiting`}
              </Text>
              <Muted>
                Approved face to face, at the school's own system. The whole point of the code you
                read out is that the person asking is standing in front of you.
              </Muted>
            </Card>
          ) : null}

          <Section title="Payments" icon="wallet">
            <Card>
              <Text style={{ ...type.body, fontWeight: '700', color: colors.text }}>
                {d.payments.online_enabled && d.payments.configured
                  ? `Taking payments online through ${d.payments.gateway}`
                  : 'Not taking payments online'}
              </Text>
              <Muted>
                {d.payments.configured
                  ? (d.payments.online_enabled
                      ? 'Parents can settle a bill from the app.'
                      : 'A gateway key is stored but online payments are switched off.')
                  : 'No gateway key is stored. Parents see the school’s own channels instead.'}
              </Muted>
              <Button label="Settings" tone="ghost" size="sm" onPress={() => router.push('/system/settings')} />
            </Card>
          </Section>

          {d.sync ? (
            <Section title="Synchronisation" icon="layers">
              <Card>
                <Muted>
                  {d.sync.enabled
                    ? `${d.sync.pending} record${d.sync.pending === 1 ? '' : 's'} waiting to go up`
                      + (d.sync.failed ? `, ${d.sync.failed} that would not send` : '')
                    : 'This school is not synchronising to the internet.'}
                </Muted>
              </Card>
            </Section>
          ) : null}
        </>
      ) : null}
    </OfficeScreen>
  );
}
