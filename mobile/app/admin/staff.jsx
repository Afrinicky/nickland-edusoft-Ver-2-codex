// The staff register.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A salary is PAYROLL, not staff. Somebody who may see the staff register is
// not thereby entitled to know what everybody earns, so the pay columns are
// absent unless this account also holds payroll — absent, not blanked, because
// a blank field invites somebody to try to fill it.
import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { api } from '../../src/api';
import { OfficeScreen, cedis, shortDate, useOffice } from '../../src/office';
import {
  Card, Section, Grid, StatCard, SearchField, DataTable, Muted, EmptyState, Badge,
  Sheet, SegmentedControl, ListRow,
} from '../../src/ui';
import { colors, spacing, type } from '../../src/theme';

export default function Staff() {
  const [status, setStatus] = useState('Active');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const state = useOffice((t) => api.adminStaff(t, status), [status]);
  const detail = useOffice((t) => (open ? api.adminStaffMember(t, open.id) : Promise.resolve(null)), [open]);

  const d = state.data;
  const rows = useMemo(() => {
    const list = d?.staff || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(r => `${r.name || ''} ${r.staff_number || ''} ${r.designation || ''} ${r.role || ''}`
      .toLowerCase().includes(needle));
  }, [d, q]);

  const person = detail.data?.staff;

  return (
    <OfficeScreen state={state} skeleton={6}>
      <Card>
        <SegmentedControl value={status} onChange={setStatus} options={[
          { label: 'Active', value: 'Active' },
          { label: 'Inactive', value: 'Inactive' },
          { label: 'Resigned', value: 'Resigned' },
        ]} />
      </Card>

      {d ? (
        (d.staff || []).length === 0 ? (
          <Card><EmptyState icon="badge" title="Nobody here"
            message="There is no member of staff in this state." /></Card>
        ) : (
          <>
            <Grid min={150}>
              <StatCard label={status} value={d.staff.length} tone="data" icon="badge" />
              <StatCard label="In today" tone="success" icon="check"
                value={d.staff.filter(s => s.today === 'present').length} />
            </Grid>
            <Card><SearchField value={q} onChangeText={setQ} placeholder="Find somebody" /></Card>

            <Section title="Staff" icon="badge">
              <DataTable
                keyExtractor={(r) => String(r.id)}
                empty="Nobody matches that."
                onRowPress={(r) => setOpen(r)}
                columns={[
                  { key: 'name', label: 'Name', render: (r) => (
                    <View>
                      <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                        {r.name}
                      </Text>
                      <Muted numberOfLines={1}>{[r.staff_number, r.designation || r.role].filter(Boolean).join(' · ')}</Muted>
                    </View>
                  ) },
                  { key: 'assignments', label: 'Classes', align: 'right', width: 84 },
                  { key: 'today', label: 'Today', width: 104,
                    render: (r) => (r.today === 'present'
                      ? <Badge label="In" tone="success" />
                      : <Badge label="Not marked" tone="neutral" />) },
                ]}
                rows={rows} />
            </Section>
          </>
        )
      ) : null}

      <Sheet visible={!!open} onClose={() => setOpen(null)} title={open ? open.name : 'Staff'}>
        {detail.data === null ? <Muted>Loading…</Muted> : person ? (
          <>
            <Card tone="primary">
              <Text style={{ ...type.body, fontWeight: '800', color: colors.text }}>{person.name}</Text>
              <Muted>{[person.staff_number, person.designation || person.role].filter(Boolean).join(' · ')}</Muted>
              {person.phone ? <Muted>{person.phone}</Muted> : null}
              {person.hire_date ? <Muted>{`Since ${shortDate(person.hire_date)}`}</Muted> : null}
            </Card>

            {detail.data.may_see_pay ? (
              <Card>
                <Muted>Pay</Muted>
                <Text style={{ ...type.body, fontWeight: '800', color: colors.text }}>
                  {person.base_salary ? cedis(person.base_salary) : 'Not set'}
                </Text>
                {person.bank_name ? <Muted>{`${person.bank_name} · ${person.bank_account || ''}`}</Muted> : null}
              </Card>
            ) : (
              <Muted>What this person earns is payroll, and this account does not hold it.</Muted>
            )}

            {(detail.data.assignments || []).length ? (
              <Section title="Teaches" icon="layers">
                <Card padded={false}>
                  {detail.data.assignments.map((a, i, arr) => (
                    <ListRow key={i}
                      title={a.class_name || 'Any class'}
                      subtitle={a.subject_name || 'Every subject'}
                      right={a.is_class_teacher ? <Badge label="Class teacher" tone="primary" /> : null}
                      last={i === arr.length - 1} />
                  ))}
                </Card>
              </Section>
            ) : null}

            {(detail.data.leave || []).length ? (
              <Section title="Leave" icon="badge">
                <Card padded={false}>
                  {detail.data.leave.slice(0, 6).map((l, i, arr) => (
                    <ListRow key={l.id}
                      title={`${l.leave_type} · ${l.days_requested} day${l.days_requested === 1 ? '' : 's'}`}
                      subtitle={`${shortDate(l.start_date)} to ${shortDate(l.end_date)}`}
                      right={<Badge label={l.status}
                        tone={l.status === 'approved' ? 'success' : l.status === 'rejected' ? 'danger' : 'warning'} />}
                      last={i === arr.length - 1} />
                  ))}
                </Card>
              </Section>
            ) : null}
          </>
        ) : <Muted>That record could not be opened.</Muted>}
      </Sheet>
    </OfficeScreen>
  );
}
