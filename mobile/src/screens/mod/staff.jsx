// Staff Management — the roll, the register, the notes and the activities.
// Copyright © 2026 Nickland Sales. All rights reserved.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { todayISO, DateStepper, useClasses } from '../../pickers';
import { OfficeScreen, shortDate, useOffice } from '../../office';
import {
  Select, SearchField, DataTable, Muted, Badge, EmptyState, ErrorNote, SuccessNote,
  Button, Sheet, Field, TextArea, SegmentedControl, Avatar, Divider, CheckRow,
} from '../../ui';
import { Panel, Bar, StatRow, Stat } from '../../desk';
import { colors, spacing, type } from '../../theme';

const STATUSES = ['Active', 'Inactive', 'Resigned', 'Retired'];

// ── Dashboard ───────────────────────────────────────────────────────────────

export function StaffDashboard() {
  const state = useOffice((t) => api.adminStaff(t, 'Active'));
  const approvals = useOffice((t) => api.adminApprovals(t));
  const rows = state.data?.staff || [];
  const waiting = (approvals.data?.leave || []).length + (approvals.data?.lesson_notes || []).length;

  const byDesignation = useMemo(() => {
    const m = new Map();
    for (const s of rows) m.set(s.designation || 'Unassigned', (m.get(s.designation || 'Unassigned') || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <OfficeScreen state={state} skeleton={4}>
      <StatRow>
        <Stat index={0} label="On the books" icon="badge" tone="primary" value={rows.length}
              note="Active members of staff" />
        <Stat index={1} label="Teaching" icon="award" tone="data"
              value={rows.filter(s => /teacher/i.test(s.designation || '')).length}
              note="Class and subject teachers" />
        <Stat index={2} label="Waiting on you" icon="check"
              tone={waiting ? 'warning' : 'success'} value={waiting}
              note={waiting ? 'Leave requests and lesson notes' : 'Nothing to approve'} />
      </StatRow>

      <Panel title="Who the school is made of" subtitle="Active staff, by designation">
        <DataTable
          keyExtractor={(r, i) => String(i)}
          empty="Nobody on the books yet."
          columns={[
            { key: 'designation', label: 'Designation', render: (r) => r[0] },
            { key: 'count', label: 'People', align: 'right', width: 100, render: (r) => String(r[1]) },
          ]}
          rows={byDesignation} />
      </Panel>
    </OfficeScreen>
  );
}

// ── The roll ────────────────────────────────────────────────────────────────

export function StaffRoll() {
  const { token, profile } = useAuth();
  const [status, setStatus] = useState('Active');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(null);
  const [saved, setSaved] = useState(null);
  const state = useOffice((t) => api.adminStaff(t, status), [status]);
  const mayEdit = can(profile, 'staff', 'edit');
  const mayAdd = can(profile, 'staff', 'create');
  const designations = state.data?.designations || [];
  const rows = useMemo(() => {
    const list = state.data?.staff || [];
    const needle = q.trim().toLowerCase();
    return needle
      ? list.filter(s => `${s.name || ''} ${s.designation || ''} ${s.staff_number || ''}`.toLowerCase().includes(needle))
      : list;
  }, [state.data, q]);

  return (
    <OfficeScreen state={state} skeleton={6}>
      <Bar left={<>
        <View style={{ minWidth: 300 }}>
          <SegmentedControl value={status} onChange={setStatus}
                            options={STATUSES.map(s => ({ label: s, value: s }))} />
        </View>
        <View style={{ minWidth: 240, flex: 1 }}>
          <SearchField value={q} onChangeText={setQ} placeholder="Find a member of staff" />
        </View>
      </>}
      right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Badge tone="data" label={`${rows.length} ${status.toLowerCase()}`} />
        {mayAdd ? (
          <Button title="Add somebody" icon="plus" size="sm" full={false}
                  onPress={() => setEditing({ role: 'Teaching', status: 'Active' })} />
        ) : null}
      </View>} />

      {saved ? <SuccessNote message={saved} /> : null}

      <Panel padded={false}>
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r) => String(r.id)}
            empty={`Nobody is ${status.toLowerCase()}.`}
            onRowPress={(r) => setOpen(r)}
            columns={[
              { key: 'name', label: 'Member of staff', render: (r) => (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <Avatar name={r.name} photo={r.photo} size={30} />
                  <View style={{ minWidth: 0, flex: 1 }}>
                    <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>{r.name}</Text>
                    <Muted numberOfLines={1}>{r.staff_number || '—'}</Muted>
                  </View>
                </View>
              ) },
              { key: 'designation', label: 'Designation', width: 190 },
              { key: 'phone', label: 'Phone', width: 150 },
              { key: 'date_employed', label: 'Employed', align: 'right', width: 120,
                render: (r) => shortDate(r.date_employed) },
            ]}
            rows={rows} />
        </View>
      </Panel>

      <Sheet visible={!!open} onClose={() => setOpen(null)} title={open ? open.name : ''}>
        {open ? (
          <StaffDetail
            id={open.id}
            mayEdit={mayEdit}
            onAmend={(record) => { setOpen(null); setEditing(record); }}
            onChanged={() => { state.reload(); }}
          />
        ) : null}
      </Sheet>

      <Sheet visible={!!editing} onClose={() => setEditing(null)}
             title={editing && editing.id ? 'Amend the record' : 'A new member of staff'}>
        {editing ? (
          <StaffForm
            value={editing} designations={designations}
            onCancel={() => setEditing(null)}
            onSaved={(name) => {
              setSaved(`${name} saved.`);
              setEditing(null);
              state.reload();
            }} />
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}

// ── The record itself ───────────────────────────────────────────────────────
//
// The pay columns are only sent to an account that may see them, and only
// written by one that may edit payroll — so this form simply does not draw
// them otherwise. An account that can set a salary it cannot read back is
// worse than one that can read it.

function StaffForm({ value, designations, onSaved, onCancel }) {
  const { token, profile } = useAuth();
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const mayPay = can(profile, 'payroll', 'edit');
  const set = (k) => (x) => setV(o => ({ ...o, [k]: x }));

  async function save() {
    setBusy(true); setError(null);
    try {
      if (!String(v.surname || '').trim() || !String(v.first_name || '').trim()) {
        throw new Error('A surname and a first name are required.');
      }
      const body = { ...v };
      if (body.designation_id) body.designation_id = Number(body.designation_id);
      if (!mayPay) { delete body.base_salary; delete body.ssnit_number; delete body.bank_account; delete body.bank_name; }
      await api.adminSaveStaff(token, body);
      onSaved(`${v.surname} ${v.first_name}`.trim());
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <ErrorNote message={error} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Field label="Surname" value={v.surname || ''} onChangeText={set('surname')} />
        </View>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Field label="First name" value={v.first_name || ''} onChangeText={set('first_name')} />
        </View>
      </View>
      <Field label="Other names" value={v.other_names || ''} onChangeText={set('other_names')} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Select label="Gender" value={v.gender || ''} onChange={set('gender')} placeholder="—"
                  options={[{ label: 'Male', value: 'Male' }, { label: 'Female', value: 'Female' }]} />
        </View>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Select label="Teaching or not" value={v.role || 'Teaching'} onChange={set('role')}
                  options={[{ label: 'Teaching', value: 'Teaching' },
                            { label: 'Non-Teaching', value: 'Non-Teaching' }]} />
        </View>
      </View>
      <Select label="Designation" value={String(v.designation_id || '')} onChange={set('designation_id')}
              placeholder="Not set"
              options={designations.map(d => ({ label: d.name, value: String(d.id) }))} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Field label="Phone" value={v.phone || ''} onChangeText={set('phone')} keyboardType="phone-pad" />
        </View>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Field label="Email" value={v.email || ''} onChangeText={set('email')} autoCapitalize="none" />
        </View>
      </View>
      <Field label="Qualification" value={v.qualification || ''} onChangeText={set('qualification')} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Field label="Employed on" value={v.hire_date || ''} onChangeText={set('hire_date')}
                 hint="YYYY-MM-DD" />
        </View>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Select label="Status" value={v.status || 'Active'} onChange={set('status')}
                  options={STATUSES.map(x => ({ label: x, value: x }))} />
        </View>
      </View>

      {mayPay ? (
        <>
          <Divider />
          <Text style={{ ...type.heading, color: colors.text }}>Pay</Text>
          <Muted>Only an account that may edit payroll sees or writes these.</Muted>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1, minWidth: 140 }}>
              <Field label="Basic salary" value={String(v.base_salary ?? '')}
                     onChangeText={set('base_salary')} keyboardType="numeric" />
            </View>
            <View style={{ flex: 1, minWidth: 140 }}>
              <Field label="SSNIT number" value={v.ssnit_number || ''} onChangeText={set('ssnit_number')} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1, minWidth: 140 }}>
              <Field label="Bank" value={v.bank_name || ''} onChangeText={set('bank_name')} />
            </View>
            <View style={{ flex: 1, minWidth: 140 }}>
              <Field label="Account" value={v.bank_account || ''} onChangeText={set('bank_account')} />
            </View>
          </View>
        </>
      ) : null}

      <TextArea label="Notes" value={v.notes || ''} onChangeText={set('notes')} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button title={busy ? 'Saving…' : 'Save'} busy={busy} disabled={busy} onPress={save} />
        <Button title="Cancel" variant="ghost" full={false} onPress={onCancel} />
      </View>
    </>
  );
}

// ── What somebody teaches ───────────────────────────────────────────────────
//
// The most consequential thing on this screen: the teaching scope is built
// from these rows, so they decide whose marks this person can touch. Saved
// wholesale, so what is stored is exactly what the screen showed.

function Assignments({ staffId, rows, onSaved }) {
  const { token } = useAuth();
  const { classes } = useClasses(token);
  // Every subject the school teaches, not the ones for one class: an
  // assignment can name a subject without naming a class.
  const [subjects, setSubjects] = useState([]);
  useEffect(() => {
    let live = true;
    api.subjects(token).then(r => { if (live) setSubjects(r.subjects || []); }).catch(() => {});
    return () => { live = false; };
  }, [token]);
  const [list, setList] = useState(
    (rows || []).map(a => ({ class_group_id: a.class_group_id ? String(a.class_group_id) : '',
                             subject_id: a.subject_id ? String(a.subject_id) : '',
                             is_class_teacher: !!a.is_class_teacher })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.adminSetAssignments(token, staffId, list
        .filter(a => a.class_group_id || a.subject_id)
        .map(a => ({ class_group_id: a.class_group_id ? Number(a.class_group_id) : null,
                     subject_id: a.subject_id ? Number(a.subject_id) : null,
                     is_class_teacher: !!a.is_class_teacher })));
      onSaved();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const at = (i, k) => (x) => setList(l => l.map((a, j) => (j === i ? { ...a, [k]: x } : a)));

  return (
    <View style={{ gap: spacing.sm }}>
      <ErrorNote message={error} />
      <Muted>
        A class with no subject means the whole class. A subject with no class means that
        subject wherever it is taught. The class teacher takes the register and writes the
        report cards, and a class has one.
      </Muted>
      {list.map((a, i) => (
        <View key={i} style={{ gap: 4, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
            <View style={{ flex: 1, minWidth: 130 }}>
              <Select label="Class" value={a.class_group_id} onChange={at(i, 'class_group_id')}
                      placeholder="Every class"
                      options={[{ label: 'Every class', value: '' },
                                ...(classes || []).map(c => ({ label: c.name, value: String(c.id) }))]} />
            </View>
            <View style={{ flex: 1, minWidth: 130 }}>
              <Select label="Subject" value={a.subject_id} onChange={at(i, 'subject_id')}
                      placeholder="Every subject"
                      options={[{ label: 'Every subject', value: '' },
                                ...subjects.map(x => ({ label: x.name, value: String(x.id) }))]} />
            </View>
            <Button title="Remove" variant="ghost" size="sm" full={false}
                    onPress={() => setList(l => l.filter((_, j) => j !== i))} />
          </View>
          <CheckRow title="Class teacher of this class" checked={!!a.is_class_teacher}
                    onToggle={() => at(i, 'is_class_teacher')(!a.is_class_teacher)} />
        </View>
      ))}
      <Button title="Add a class or subject" variant="outline" icon="plus" full={false}
              onPress={() => setList(l => [...l, { class_group_id: '', subject_id: '', is_class_teacher: false }])} />
      <Button title={busy ? 'Saving…' : 'Save what they teach'} busy={busy} disabled={busy} onPress={save} />
    </View>
  );
}

function StaffDetail({ id, mayEdit, onAmend, onChanged }) {
  const state = useOffice((t) => api.adminStaffMember(t, id), [id]);
  const [teaching, setTeaching] = useState(false);
  const s = state.data?.staff || state.data;
  if (!s) return <Muted>Reading the record…</Muted>;
  const rows = [
    ['Designation', s.designation],
    ['Staff number', s.staff_number],
    ['Phone', s.phone],
    ['Email', s.email],
    ['Employed', shortDate(s.date_employed)],
    ['Qualification', s.qualification],
    ['SSNIT number', s.ssnit_number],
    ['Status', s.status],
  ].filter(([, v]) => v);
  return (
    <View style={{ gap: 6 }}>
      {rows.map(([k, v]) => (
        <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between',
                               paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}>
          <Muted>{k}</Muted>
          <Text style={{ ...type.small, fontWeight: '600', color: colors.text }}>{String(v)}</Text>
        </View>
      ))}
      <Text style={{ ...type.heading, color: colors.text, marginTop: spacing.md }}>Teaching</Text>
      {teaching ? (
        <Assignments
          staffId={id}
          rows={state.data?.assignments || s.assignments || []}
          onSaved={() => { setTeaching(false); state.reload(); onChanged && onChanged(); }} />
      ) : (
        <>
          {(state.data?.assignments || s.assignments || []).length
            ? (state.data?.assignments || s.assignments).map((a, i) => (
              <Muted key={i}>{`${a.class_name || 'Every class'}${a.subject_name ? ` · ${a.subject_name}` : ''}${a.is_class_teacher ? ' · class teacher' : ''}`}</Muted>
            ))
            : <Muted>Nothing assigned, so they see no class.</Muted>}
          {mayEdit ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button title="Amend the record" variant="outline" size="sm" full={false}
                      onPress={() => onAmend({ ...s, id })} />
              <Button title="Set what they teach" variant="outline" size="sm" full={false}
                      onPress={() => setTeaching(true)} />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

// ── Status ──────────────────────────────────────────────────────────────────

export function StaffStatus() {
  const state = useOffice((t) => api.adminStaff(t, 'Active'));
  const inactive = useOffice((t) => api.adminStaff(t, 'Inactive'));
  const rows = [...(state.data?.staff || []).map(s => ({ ...s, status: s.status || 'Active' })),
                ...(inactive.data?.staff || [])];

  return (
    <OfficeScreen state={state} skeleton={5}>
      <Panel padded={false} title="Everybody, and where they stand"
             subtitle="Employment status is changed on the school's own system, where the paperwork is.">
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r) => String(r.id)}
            empty="Nobody on the books."
            columns={[
              { key: 'name', label: 'Member of staff' },
              { key: 'designation', label: 'Designation', width: 190 },
              { key: 'date_employed', label: 'Employed', width: 130,
                render: (r) => shortDate(r.date_employed) },
              { key: 'status', label: 'Status', align: 'right', width: 130,
                render: (r) => <Badge tone={r.status === 'Active' ? 'success' : 'neutral'}
                                      label={r.status || 'Active'} /> },
            ]}
            rows={rows} />
        </View>
      </Panel>
    </OfficeScreen>
  );
}

// ── The staff register ──────────────────────────────────────────────────────

export function StaffRegister() {
  const [date, setDate] = useState(todayISO());
  const state = useOffice((t) => api.adminStaffRegister(t, date), [date]);
  const rows = state.data?.staff || state.data?.register || [];
  const inCount = rows.filter(r => r.clock_in).length;

  return (
    <OfficeScreen state={state} skeleton={5}>
      <Bar left={<View style={{ minWidth: 240 }}>
        <DateStepper label="Day" value={date} onChange={setDate} />
      </View>}
      right={<Badge tone={inCount ? 'success' : 'neutral'} label={`${inCount} of ${rows.length} in`} />} />

      <Panel padded={false} title="Who clocked in"
             subtitle="Times are what the person recorded themselves, from wherever they signed in.">
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r, i) => String(r.staff_id ?? r.id ?? i)}
            empty="Nobody has clocked in on this day."
            columns={[
              { key: 'name', label: 'Member of staff',
                render: (r) => r.name || `${r.surname || ''} ${r.first_name || ''}`.trim() },
              { key: 'designation', label: 'Designation', width: 180 },
              { key: 'clock_in', label: 'In', width: 100, render: (r) => r.clock_in || '—' },
              { key: 'clock_out', label: 'Out', width: 100, render: (r) => r.clock_out || '—' },
              { key: 'status', label: 'Status', align: 'right', width: 120,
                render: (r) => <Badge tone={r.clock_in ? 'success' : 'neutral'}
                                      label={r.clock_in ? 'In' : 'Not in'} /> },
            ]}
            rows={rows} />
        </View>
      </Panel>
    </OfficeScreen>
  );
}

// ── Lesson notes ────────────────────────────────────────────────────────────

export function LessonNotes() {
  const { token, profile } = useAuth();
  const [status, setStatus] = useState('submitted');
  const [open, setOpen] = useState(null);
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const state = useOffice((t) => api.lessonNotes(t, { status }), [status]);
  const notes = state.data?.notes || [];
  const mayDecide = can(profile, 'academics', 'edit') || can(profile, 'staff', 'edit');

  async function decide(decision) {
    setBusy(true); setError(null);
    try {
      await api.adminDecideNote(token, open.id, decision, comments.trim());
      setDone(`Lesson note ${decision === 'approved' ? 'acknowledged' : 'sent back'}.`);
      setOpen(null); setComments('');
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      {done ? <SuccessNote message={done} /> : null}

      <Bar left={<View style={{ minWidth: 340 }}>
        <SegmentedControl value={status} onChange={setStatus}
                          options={[{ label: 'Waiting', value: 'submitted' },
                                    { label: 'Acknowledged', value: 'approved' },
                                    { label: 'Sent back', value: 'returned' }]} />
      </View>}
      right={<Badge tone={status === 'submitted' && notes.length ? 'warning' : 'neutral'}
                    label={`${notes.length}`} />} />

      <Panel padded={false}>
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r) => String(r.id)}
            empty={status === 'submitted' ? 'Nothing is waiting on you.' : 'Nothing here.'}
            onRowPress={(r) => { setOpen(r); setComments(''); }}
            columns={[
              { key: 'title', label: 'Lesson note', render: (r) => (
                <View style={{ minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>
                    {r.title || r.topic || 'Untitled'}
                  </Text>
                  <Muted numberOfLines={1}>{[r.staff_name, r.class_name, r.subject_name].filter(Boolean).join(' · ')}</Muted>
                </View>
              ) },
              { key: 'week_of', label: 'Week', width: 130,
                render: (r) => shortDate(r.week_of || r.created_at) },
              { key: 'status', label: 'Status', align: 'right', width: 140,
                render: (r) => <Badge tone={r.status === 'approved' ? 'success'
                                            : r.status === 'returned' ? 'danger' : 'warning'}
                                      label={r.status === 'approved' ? 'Acknowledged'
                                             : r.status === 'returned' ? 'Sent back' : 'Waiting'} /> },
            ]}
            rows={notes} />
        </View>
      </Panel>

      <Sheet visible={!!open} onClose={() => setOpen(null)}
             title={open ? (open.title || open.topic || 'Lesson note') : ''}>
        {open ? (
          <>
            <Muted>{[open.staff_name, open.class_name, open.subject_name].filter(Boolean).join(' · ')}</Muted>
            {['objectives', 'content', 'activities', 'evaluation', 'remarks'].map(k => (
              open[k] ? (
                <View key={k} style={{ marginTop: spacing.md }}>
                  <Text style={{ ...type.micro, color: colors.muted, textTransform: 'uppercase' }}>{k}</Text>
                  <Text style={{ ...type.body, color: colors.textSoft }}>{open[k]}</Text>
                </View>
              ) : null
            ))}
            {mayDecide && open.status === 'submitted' ? (
              <>
                <TextArea label="A comment for the teacher" value={comments} onChangeText={setComments} />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button title="Acknowledge" variant="success" full={false} disabled={busy}
                          onPress={() => decide('approved')} />
                  <Button title="Send it back" variant="outline" full={false} disabled={busy}
                          onPress={() => decide('returned')} />
                </View>
              </>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}

// ── Activities ──────────────────────────────────────────────────────────────

const ACTIVITY_TYPES = [
  { label: 'Club or society', value: 'club' },
  { label: 'Sports', value: 'sports' },
  { label: 'Duty', value: 'duty' },
  { label: 'Meeting', value: 'meeting' },
  { label: 'Training', value: 'training' },
  { label: 'Something else', value: 'other' },
];

export function StaffActivities() {
  const { token, profile } = useAuth();
  const [adding, setAdding] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const state = useOffice((t) => api.staffActivities(t));
  const rows = state.data?.activities || [];
  const mineOnly = state.data?.mine_only;
  const mayAck = state.data?.may_acknowledge;

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.saveStaffActivity(token, {
        id: adding.id || undefined,
        activity_date: adding.activity_date || todayISO(),
        activity_type: adding.activity_type || 'other',
        title: adding.title,
        description: adding.description || null,
        duration_minutes: adding.duration_minutes ? Number(adding.duration_minutes) : null,
        location: adding.location || null,
        hours_contributed: adding.hours_contributed ? Number(adding.hours_contributed) : null,
      });
      setAdding(null);
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      <Bar left={<Muted>
        {mineOnly
          ? 'What you have done beyond your timetable. Your supervisor sees it and acknowledges it.'
          : 'What staff have done beyond their timetable — clubs, duty, the Saturday match.'}
      </Muted>}
      right={<Button title="File an activity" icon="plus" full={false}
                     onPress={() => setAdding({ activity_date: todayISO(), activity_type: 'club' })} />} />

      <Panel padded={false}>
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r) => String(r.id)}
            empty="Nothing has been filed."
            columns={[
              { key: 'title', label: 'What', render: (r) => (
                <View style={{ minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>{r.title}</Text>
                  {r.description ? <Muted numberOfLines={1}>{r.description}</Muted> : null}
                </View>
              ) },
              ...(mineOnly ? [] : [{ key: 'staff_name', label: 'Who', width: 180 }]),
              { key: 'activity_date', label: 'When', width: 120,
                render: (r) => shortDate(r.activity_date) },
              { key: 'hours_contributed', label: 'Hours', align: 'right', width: 90,
                render: (r) => (r.hours_contributed == null ? '—' : String(r.hours_contributed)) },
              { key: 'ack', label: 'Seen', align: 'right', width: 150,
                render: (r) => (r.acknowledged_at
                  ? <Badge tone="success" label={r.acknowledged_by_name || 'Acknowledged'} />
                  : mayAck
                    ? <Button size="sm" variant="outline" full={false} title="Acknowledge"
                              onPress={async () => {
                                try { await api.acknowledgeActivity(token, r.id); state.reload(); }
                                catch (e) { setError(e.message); }
                              }} />
                    : <Muted>Waiting</Muted>) },
            ]}
            rows={rows} />
        </View>
      </Panel>

      <Sheet visible={!!adding} onClose={() => setAdding(null)} title="File an activity">
        {adding ? (
          <>
            <Field label="What was it" value={adding.title || ''}
                   onChangeText={(v) => setAdding(a => ({ ...a, title: v }))}
                   hint="Ran the science club, covered gate duty…" />
            <Select label="Kind" value={adding.activity_type}
                    onChange={(v) => setAdding(a => ({ ...a, activity_type: v }))}
                    options={ACTIVITY_TYPES} />
            <Field label="Date" value={adding.activity_date || ''}
                   onChangeText={(v) => setAdding(a => ({ ...a, activity_date: v }))} hint="YYYY-MM-DD" />
            <Field label="Hours" value={String(adding.hours_contributed ?? '')}
                   onChangeText={(v) => setAdding(a => ({ ...a, hours_contributed: v }))} />
            <Field label="Where" value={adding.location || ''}
                   onChangeText={(v) => setAdding(a => ({ ...a, location: v }))} />
            <TextArea label="What happened" value={adding.description || ''}
                      onChangeText={(v) => setAdding(a => ({ ...a, description: v }))} />
            <Button title={busy ? 'Filing…' : 'File it'} busy={busy} disabled={busy} onPress={save} />
          </>
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}
