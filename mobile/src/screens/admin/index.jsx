// The school this morning.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Enrolment, who turned up, the staff room, what is waiting to be approved —
// and the fee position only if this account may see fees at all. A head
// teacher without finance gets the school without the money, not the school
// with zeroes in it.
import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../api';
import { AsOf, OfficeScreen, cedis, useOffice } from '../../office';
import {
  Card, Section, Grid, StatCard, ListRow, Muted, EmptyState, ProgressBar, Button, Badge,
} from '../../ui';
import { colors, spacing, type } from '../../theme';

export default function AdminOverview() {
  const router = useRouter();
  const state = useOffice((t) => api.adminOverview(t));
  const d = state.data;

  const waiting = (d?.approvals?.leave || 0) + (d?.approvals?.lesson_notes || 0);

  return (
    <OfficeScreen state={state} skeleton={4}>
      {d ? (
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
      ) : null}
    </OfficeScreen>
  );
}
