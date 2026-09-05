// Students — the roll, and everything an office does to it.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The desktop's Students module, tab for tab: a dashboard of who is on the
// roll, the roll itself, the attendance register, the status changes, the
// admissions desk, and the sheet.
//
// ── The sheet ───────────────────────────────────────────────────────────────
//
// The Students Sheet is the one screen the web app was most obviously missing,
// and it is not a table with an edit button. An office works through a pile of
// admission forms by putting a whole class on the screen and typing down it —
// surname, first name, sex, date of birth, the mother's number — the way they
// would fill in a ledger. That is what this is: every cell editable in place,
// changes held until they are saved, and one save for the lot.
//
// Held rather than saved-as-you-type on purpose. A cell that writes on every
// keystroke turns one correction into forty audit rows, and on a school's
// connection it turns a typing session into a queue of requests that finish out
// of order.

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, Platform, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { OfficeScreen, shortDate, useOffice } from '../../office';
import { useOfficeClasses } from '../../pickers';
import {
  SearchField, DataTable, Muted, EmptyState, Badge, Button, Sheet, Field, Select,
  ErrorNote, SuccessNote, SegmentedControl, ProgressBar, Avatar,
} from '../../ui';
import {
  MetricCard, MetricRow, SectionCard, DashRow, BarList, SplitBar, SplitRow,
  EmptyLine, dateLabel, fullName,
} from '../../dash';
import { Panel, Bar, StatRow, Stat } from '../../desk';
import { useLayout } from '../../responsive';
import { colors, spacing, type, radius } from '../../theme';

// One vocabulary, shared with the installed application and with the server
// that enforces it. There were two: the browser offered Active / Withdrawn /
// Graduated / Suspended while the office PC offered Active / Inactive /
// Graduated / Transferred, both writing the same column — so a pupil withdrawn
// at the gate did not appear under the office's "Inactive" filter, a pupil
// transferred at the office was not a status the browser could display, and
// the two screens reported different roll sizes for the same school.
const STATUSES = [
  { value: 'Active', label: 'Active', note: 'On the roll, in class' },
  { value: 'Suspended', label: 'Suspended', note: 'Temporarily out, still on the roll', needsReason: true },
  { value: 'Withdrawn', label: 'Withdrawn', note: 'The parent took them out', needsReason: true },
  { value: 'Transferred', label: 'Transferred', note: 'Left for another school', needsReason: true },
  { value: 'Graduated', label: 'Graduated', note: 'Completed the school' },
  { value: 'Inactive', label: 'Inactive', note: 'No longer attending — the older catch-all', needsReason: true },
];

const statusTone = (s) => (s === 'Active' ? 'success'
  : s === 'Graduated' ? 'primary'
    : s === 'Suspended' ? 'warning' : 'danger');

const needsReason = (s) => !!(STATUSES.find(x => x.value === s) || {}).needsReason;

// ── Dashboard ───────────────────────────────────────────────────────────────

export function StudentsDashboard() {
  const router = useRouter();
  const layout = useLayout();
  const wide = layout.isDesktop;

  const state = useOffice(async (t) => {
    const [overview, rich] = await Promise.all([
      api.adminOverview(t),
      wide ? api.dashStudents(t) : Promise.resolve(null),
    ]);
    return { overview, rich: rich && rich.ok ? rich : null };
  }, [wide]);

  const d = state.data?.overview;
  const rich = state.data?.rich;

  return (
    <OfficeScreen state={state} skeleton={4}>
      {rich ? <StudentsFull d={rich} router={router} />
        : d ? <StudentsPlain d={d} /> : null}
    </OfficeScreen>
  );
}

// The desktop's Students → Dashboard: four counts of the roll by status, the
// class distribution as bars, the boy/girl split, and who was admitted last.
function StudentsFull({ d, router }) {
  const m = d.metrics || {};
  const classes = d.by_class || [];
  const recent = d.recent_admissions || [];

  return (
    <View style={{ width: '100%' }}>
      <MetricRow columns={4}>
        <MetricCard index={0} tone="blue" icon="users"
                    label="Total Students" value={m.total ?? '—'} sub="All time" />
        <MetricCard index={1} tone="green" icon="check" valueTone="success"
                    label="Active Students" value={m.active ?? '—'} sub="Currently enrolled"
                    link="View status →" onPress={() => router.push('/app/students?tab=status')} />
        <MetricCard index={2} tone="orange" icon="alert" valueTone="accent"
                    label="Inactive" value={m.inactive ?? '—'} sub="Suspended / Transferred" />
        <MetricCard index={3} tone="purple" icon="cap"
                    label="Graduated" value={m.graduated ?? '—'} sub="Completed school" />
      </MetricRow>

      <DashRow weights={[1.3, 1]}>
        <SectionCard title="Students by Class"
                     right={<Text style={styles.headNote}>
                       {`${m.active || 0} active students across ${classes.length} classes`}
                     </Text>}>
          <BarList empty="No students admitted yet"
                   items={classes.map(c => ({ label: c.name, value: c.count }))} />
        </SectionCard>

        <SectionCard title="Gender Distribution"
                     right={<Text style={styles.headNote}>Active students</Text>}>
          <View style={{ marginBottom: 14 }}>
            <SplitRow color="#3B82F6" label="Male" count={m.male || 0} pct={m.male_pct || 0} />
            <SplitRow color="#EC4899" label="Female" count={m.female || 0} pct={m.female_pct || 0} />
          </View>
          <SplitBar segments={[
            { value: m.male || 0, color: '#3B82F6' },
            { value: m.female || 0, color: '#EC4899' },
          ]} />
        </SectionCard>
      </DashRow>

      <SectionCard title="Recent Admissions" viewAll="Admit new student →"
                   onViewAll={() => router.push('/app/students?tab=admissions')}>
        {recent.length === 0
          ? <EmptyLine>No admissions yet</EmptyLine>
          : recent.map((r, i, arr) => (
            <AdmissionRow key={r.id} student={r} last={i === arr.length - 1}
                          onPress={() => router.push(`/app/students/${r.id}`)} />
          ))}
      </SectionCard>
    </View>
  );
}

function AdmissionRow({ student, onPress, last }) {
  const [hover, setHover] = useState(false);
  return (
    <Pressable onPress={onPress}
               onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
               style={[styles.admissionRow, last && { borderBottomWidth: 0 },
                       hover && { backgroundColor: colors.surfaceAlt }]}>
      <Avatar name={fullName(student)} photo={student.photo_path} size={38} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={styles.admissionName}>{fullName(student)}</Text>
        <Text numberOfLines={1} style={styles.admissionMeta}>
          {`${student.index_number || '—'} · ${student.class_name || 'Unassigned'}`}
        </Text>
      </View>
      <Text style={styles.admissionDate}>{dateLabel(student.admission_date)}</Text>
    </Pressable>
  );
}

// What a projection of the school can honestly show: the roll and the classes
// it is spread across, from the summary every connection serves.
function StudentsPlain({ d }) {
  const roll = d.enrolment;
  const classes = d.by_class || [];
  const biggest = Math.max(1, ...classes.map(c => Number(c.pupils) || 0));
  return (
    <>
      <StatRow>
        <Stat index={0} label="On the roll" icon="users" tone="primary"
              value={roll ? roll.total : '—'}
              note={roll ? `${roll.boys || 0} boys · ${roll.girls || 0} girls` : 'Not available'} />
        <Stat index={1} label="Classes" icon="layers" tone="data" value={classes.length}
              note={classes.length ? `Largest: ${classes.reduce((a, c) => (c.pupils > (a.pupils || 0) ? c : a), {}).name || '—'}` : ''} />
        {d.attendance ? (
          <Stat index={2} label="Present today" icon="check"
                tone={d.attendance.rate == null ? 'primary'
                      : d.attendance.rate >= 90 ? 'success' : d.attendance.rate >= 75 ? 'warning' : 'danger'}
                value={d.attendance.present}
                note={d.attendance.rate == null ? 'No register marked yet'
                                                : `${d.attendance.rate}% of those marked`} />
        ) : null}
        {d.attendance ? (
          <Stat index={3} label="Registers marked" icon="note" tone="warning"
                value={`${d.attendance.classes_marked} of ${d.attendance.classes_total}`}
                note={d.attendance.classes_marked === d.attendance.classes_total
                      ? 'Every class is in' : 'Some classes have not marked'} />
        ) : null}
      </StatRow>

      <Panel title="Enrolment by class" subtitle="Active pupils, this term">
        {classes.length === 0 ? (
          <EmptyState icon="users" title="No classes yet"
                      message="Set the school's classes up in Settings, then admit pupils into them." />
        ) : classes.map((c) => (
          <View key={c.id} style={{ marginBottom: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ ...type.small, fontWeight: '700', color: colors.text }}>{c.name}</Text>
              <Text style={{ ...type.small, fontWeight: '700', color: colors.muted }}>{c.pupils}</Text>
            </View>
            <ProgressBar value={Number(c.pupils) || 0} max={biggest} />
          </View>
        ))}
      </Panel>
    </>
  );
}

// ── The roll ────────────────────────────────────────────────────────────────

export function StudentsRoll({ initialQuery = '' }) {
  const router = useRouter();
  const { token } = useAuth();
  const [classId, setClassId] = useState('');
  const [q, setQ] = useState(initialQuery);
  const { classes } = useOfficeClasses(token);
  const state = useOffice((t) => api.adminStudents(t, { status: 'Active', classId: classId || undefined }), [classId]);
  const d = state.data;

  const rows = useMemo(() => filterPupils(d?.students, q), [d, q]);

  return (
    <OfficeScreen state={state} skeleton={6}>
      <Bar
        left={<>
          <View style={{ minWidth: 240, flex: 1 }}>
            <SearchField value={q} onChangeText={setQ} placeholder="Name, admission number or class" />
          </View>
          <View style={{ minWidth: 190 }}>
            <Select label="Class" value={classId} onChange={setClassId} placeholder="Every class"
                    options={[{ label: 'Every class', value: '' },
                              ...(classes || []).map(c => ({ label: c.name, value: String(c.id) }))]} />
          </View>
        </>}
        right={<Badge tone="data" label={`${rows.length} on the roll`} />}
      />

      <Panel padded={false}>
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r) => String(r.id)}
            empty="Nobody matches that."
            onRowPress={(r) => router.push(`/app/students/${r.id}`)}
            columns={pupilColumns()}
            rows={rows} />
        </View>
      </Panel>
    </OfficeScreen>
  );
}

function pupilColumns() {
  return [
    { key: 'name', label: 'Pupil', render: (r) => (
      <View style={{ minWidth: 0 }}>
        <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text }}>{r.name}</Text>
        <Muted numberOfLines={1}>{r.index_number}</Muted>
      </View>
    ) },
    { key: 'class_name', label: 'Class', width: 150 },
    { key: 'gender', label: 'Sex', width: 80 },
    { key: 'age', label: 'Age', align: 'right', width: 64,
      render: (r) => (r.age == null ? '—' : String(r.age)) },
    { key: 'admission_date', label: 'Admitted', align: 'right', width: 116,
      render: (r) => shortDate(r.admission_date) },
  ];
}

function filterPupils(list, q) {
  const all = list || [];
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return all;
  return all.filter(r => `${r.name || ''} ${r.index_number || ''} ${r.class_name || ''}`
    .toLowerCase().includes(needle));
}

// ── Admissions ──────────────────────────────────────────────────────────────
//
// The admission form is the installed application's, field for field, and it
// is long enough to be worth its own file. It is re-exported here so the
// route's imports do not have to know that.
export { default as StudentsAdmissions } from './admissions';

// ── The Students Sheet ──────────────────────────────────────────────────────
//
// A whole class on one screen, corrected in place — thirty-nine columns and
// the server's own column rules. Also its own file, for the same reason.
export { default as StudentsSheet } from './students-sheet';

// ── Status ──────────────────────────────────────────────────────────────────
//
// Withdrawing, graduating, suspending and readmitting. Kept apart from the roll
// because it is the one change to a pupil's record a PARENT notices — the app
// stops showing their child — and it deserves a screen where that is the only
// thing on it, rather than being a menu on a row in a list of four hundred.

export function StudentsStatus() {
  const { token, profile } = useAuth();
  const [status, setStatus] = useState('Active');
  const [q, setQ] = useState('');
  const state = useOffice((t) => api.adminStudents(t, { status: status || undefined }), [status]);
  const [changing, setChanging] = useState(null);
  const [newStatus, setNewStatus] = useState('Withdrawn');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const may = can(profile, 'students', 'edit');
  const rows = useMemo(() => filterPupils(state.data?.students, q), [state.data, q]);

  async function change() {
    setError(null);
    if (needsReason(newStatus) && reason.trim().length < 3) return setError('Give the reason.');
    setBusy(true);
    try {
      await api.adminStudentStatus(token, changing.id, newStatus, reason.trim());
      setChanging(null); setReason('');
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      <Bar
        left={<>
          <View style={{ minWidth: 200 }}>
            <Select label="" value={status} onChange={setStatus}
                    options={[{ label: 'Every status', value: '' },
                              ...STATUSES.map(s => ({ label: s.label, value: s.value }))]} />
          </View>
          <View style={{ minWidth: 220, flex: 1 }}>
            <SearchField value={q} onChangeText={setQ} placeholder="Find a pupil" />
          </View>
        </>}
        right={<Badge tone={statusTone(status)}
                      label={`${rows.length} ${status ? status.toLowerCase() : 'on record'}`} />}
      />

      <Panel padded={false}>
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r) => String(r.id)}
            empty={status ? `Nobody is ${status.toLowerCase()}.` : 'Nobody is on the roll.'}
            onRowPress={may ? (r) => {
              setError(null); setChanging(r);
              setNewStatus(r.status === 'Active' ? 'Withdrawn' : 'Active'); setReason('');
            } : undefined}
            columns={[
              ...pupilColumns().slice(0, 2),
              { key: 'status', label: 'Status', width: 150,
                render: (r) => (
                  <View style={{ minWidth: 0 }}>
                    <Badge tone={statusTone(r.status)} label={r.status || 'Active'} />
                    {/* Why they are off the roll, on the row. It used to live
                        only in the audit log, so this column was blank beside
                        every withdrawn pupil and nobody could see the reason. */}
                    {r.status !== 'Active' && r.inactive_reason
                      ? <Muted numberOfLines={1}>{r.inactive_reason}</Muted> : null}
                  </View>
                ) },
              { key: 'go', label: '', width: 110, align: 'right',
                render: () => (may ? <Muted>Change →</Muted> : null) },
            ]}
            rows={rows} />
        </View>
      </Panel>

      <Sheet visible={!!changing} onClose={() => setChanging(null)}
             title={changing ? changing.name : 'Change status'}>
        <ErrorNote message={error} />
        {changing ? (
          <>
            <Muted>
              {`Currently ${changing.status}. A parent notices this first — the app stops showing their child.`}
            </Muted>
            <Select label="New status" value={newStatus} onChange={setNewStatus}
                    hint={(STATUSES.find(s => s.value === newStatus) || {}).note}
                    options={STATUSES.map(s => ({ label: s.label, value: s.value, note: s.note }))} />
            {needsReason(newStatus) ? (
              <Field label="Why (required)" value={reason} onChangeText={setReason}
                     hint="Recorded against the pupil, and in the audit trail." />
            ) : null}
            <Button title={busy ? 'Saving…' : 'Change it'} busy={busy} disabled={busy}
                    variant={newStatus === 'Active' ? 'primary' : 'danger'} onPress={change} />
          </>
        ) : null}
      </Sheet>
    </OfficeScreen>
  );
}

const styles = {
  headNote: { ...type.small, fontSize: 12, color: colors.muted },
  admissionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 8, borderRadius: 6,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  admissionName: { ...type.small, fontSize: 13, fontWeight: '600', color: colors.text },
  admissionMeta: { ...type.small, fontSize: 11, color: colors.muted, marginTop: 2 },
  admissionDate: { ...type.small, fontSize: 12, color: colors.muted, flexShrink: 0 },

};
