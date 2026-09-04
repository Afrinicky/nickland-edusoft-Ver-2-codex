// The roll — the whole school, not one teacher's classes.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { OfficeScreen, shortDate, useOffice } from '../../office';
import {
  Card, Section, Grid, StatCard, SearchField, DataTable, Muted, EmptyState, Badge,
  Button, Sheet, Field, Select, ErrorNote, SegmentedControl,
} from '../../ui';
import { colors, spacing, type } from '../../theme';

const STATUSES = ['Active', 'Withdrawn', 'Graduated', 'Suspended'];

export default function Students() {
  const { token, profile } = useAuth();
  const [status, setStatus] = useState('Active');
  const [q, setQ] = useState('');
  const state = useOffice((t) => api.adminStudents(t, { status }), [status]);
  const classes = useOffice((t) => api.classes(t));

  const [admitting, setAdmitting] = useState(false);
  const [surname, setSurname] = useState('');
  const [firstName, setFirstName] = useState('');
  const [gender, setGender] = useState('');
  const [classId, setClassId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [admitted, setAdmitted] = useState(null);

  const [changing, setChanging] = useState(null);
  const [newStatus, setNewStatus] = useState('Withdrawn');
  const [reason, setReason] = useState('');

  const mayAdmit = can(profile, 'students', 'create');
  const mayEdit = can(profile, 'students', 'edit');
  const d = state.data;

  const rows = useMemo(() => {
    const list = d?.students || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(r => `${r.name || ''} ${r.index_number || ''} ${r.class_name || ''}`
      .toLowerCase().includes(needle));
  }, [d, q]);

  async function admit() {
    setError(null);
    if (!surname.trim() || !firstName.trim()) return setError('A surname and a first name are required.');
    setBusy(true);
    try {
      const r = await api.adminAdmit(token, {
        surname: surname.trim(), firstName: firstName.trim(),
        gender: gender || undefined, classId: classId ? Number(classId) : undefined,
      });
      setAdmitted(r.index_number);
      setAdmitting(false); setSurname(''); setFirstName(''); setGender(''); setClassId('');
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function changeStatus() {
    setError(null);
    if (newStatus !== 'Active' && reason.trim().length < 3) return setError('Give the reason.');
    setBusy(true);
    try {
      await api.adminStudentStatus(token, changing.id, newStatus, reason.trim());
      setChanging(null); setReason('');
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={6}>
      <ErrorNote message={error} />
      {admitted ? (
        <Card tone="success">
          <Text style={{ ...type.body, fontWeight: '800', color: colors.text }}>Admitted</Text>
          <Muted>{`Admission number ${admitted}. Write it on the record.`}</Muted>
          <Button label="Done" tone="ghost" size="sm" onPress={() => setAdmitted(null)} />
        </Card>
      ) : null}

      <Card>
        <SegmentedControl value={status} onChange={setStatus}
          options={STATUSES.map(s => ({ label: s, value: s }))} />
      </Card>

      {mayAdmit && status === 'Active' ? (
        <Card><Button label="Admit a pupil" icon="plus" onPress={() => { setError(null); setAdmitting(true); }} /></Card>
      ) : null}

      {d ? (
        (d.students || []).length === 0 ? (
          <Card><EmptyState icon="users" title={`Nobody ${status.toLowerCase()}`}
            message="There is no pupil in this state." /></Card>
        ) : (
          <>
            <Grid min={150}>
              <StatCard label={status} value={d.students.length} tone="data" icon="users" />
            </Grid>
            <Card><SearchField value={q} onChangeText={setQ} placeholder="Find a pupil or a class" /></Card>
            <Section title="Pupils" icon="users">
              <DataTable
                keyExtractor={(r) => String(r.id)}
                empty="Nobody matches that."
                onRowPress={mayEdit ? (r) => { setError(null); setChanging(r);
                  setNewStatus(r.status === 'Active' ? 'Withdrawn' : 'Active'); setReason(''); } : undefined}
                columns={[
                  { key: 'name', label: 'Pupil', render: (r) => (
                    <View>
                      <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                        {r.name}
                      </Text>
                      <Muted numberOfLines={1}>{r.index_number}</Muted>
                    </View>
                  ) },
                  { key: 'class_name', label: 'Class', width: 140 },
                  { key: 'age', label: 'Age', align: 'right', width: 64,
                    render: (r) => (r.age == null ? '—' : String(r.age)) },
                  { key: 'admission_date', label: 'Admitted', align: 'right', width: 106,
                    render: (r) => shortDate(r.admission_date) },
                ]}
                rows={rows} />
            </Section>
          </>
        )
      ) : null}

      <Sheet visible={admitting} onClose={() => setAdmitting(false)} title="Admit a pupil">
        <ErrorNote message={error} />
        <Muted>An admission number is issued automatically unless the school has its own.</Muted>
        <Field label="Surname" value={surname} onChangeText={setSurname} />
        <Field label="First name" value={firstName} onChangeText={setFirstName} />
        <Select label="Gender" value={gender} onChange={setGender}
          options={[{ label: 'Female', value: 'Female' }, { label: 'Male', value: 'Male' }]} />
        <Select label="Class" value={classId} onChange={setClassId}
          options={(classes.data?.classes || []).map(c => ({ label: c.name, value: String(c.id) }))} />
        <Button label={busy ? 'Admitting…' : 'Admit'} disabled={busy} onPress={admit} icon="check" />
      </Sheet>

      <Sheet visible={!!changing} onClose={() => setChanging(null)}
        title={changing ? changing.name : 'Change status'}>
        <ErrorNote message={error} />
        {changing ? (
          <>
            <Muted>
              {`Currently ${changing.status}. A parent notices this first — the app stops showing their child.`}
            </Muted>
            <Select label="New status" value={newStatus} onChange={setNewStatus}
              options={STATUSES.map(s => ({ label: s, value: s }))} />
            {newStatus !== 'Active' ? (
              <Field label="Why" value={reason} onChangeText={setReason}
                hint="Recorded against the pupil, and in the audit trail." />
            ) : null}
            <Button label={busy ? 'Saving…' : 'Change it'} disabled={busy}
              tone={newStatus === 'Active' ? 'primary' : 'danger'} onPress={changeStatus} />
          </>
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}
