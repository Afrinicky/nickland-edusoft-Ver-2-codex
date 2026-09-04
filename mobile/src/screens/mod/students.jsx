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
import { View, Text, TextInput, ScrollView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { OfficeScreen, shortDate, useOffice } from '../../office';
import { useClasses } from '../../pickers';
import {
  SearchField, DataTable, Muted, EmptyState, Badge, Button, Sheet, Field, Select,
  ErrorNote, SuccessNote, SegmentedControl, ProgressBar,
} from '../../ui';
import { Panel, Bar, StatRow, Stat } from '../../desk';
import { useLayout } from '../../responsive';
import { colors, spacing, type, radius } from '../../theme';

const STATUSES = ['Active', 'Withdrawn', 'Graduated', 'Suspended'];

// ── Dashboard ───────────────────────────────────────────────────────────────

export function StudentsDashboard() {
  const state = useOffice((t) => api.adminOverview(t));
  const d = state.data;
  const roll = d?.enrolment;
  const classes = d?.by_class || [];
  const biggest = Math.max(1, ...classes.map(c => Number(c.pupils) || 0));

  return (
    <OfficeScreen state={state} skeleton={4}>
      {d ? (
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
      ) : null}
    </OfficeScreen>
  );
}

// ── The roll ────────────────────────────────────────────────────────────────

export function StudentsRoll({ initialQuery = '' }) {
  const router = useRouter();
  const { token } = useAuth();
  const [classId, setClassId] = useState('');
  const [q, setQ] = useState(initialQuery);
  const { classes } = useClasses(token);
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

export function StudentsAdmissions() {
  const { token, profile } = useAuth();
  const { classes } = useClasses(token);
  const state = useOffice((t) => api.adminStudents(t, { status: 'Active' }));
  const [form, setForm] = useState(blankAdmission());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [admitted, setAdmitted] = useState(null);
  const may = can(profile, 'students', 'create');

  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v }));

  const recent = useMemo(() => (state.data?.students || [])
    .slice()
    .sort((a, b) => String(b.admission_date || '').localeCompare(String(a.admission_date || '')))
    .slice(0, 12), [state.data]);

  async function admit() {
    setError(null); setAdmitted(null);
    if (!form.surname.trim() || !form.firstName.trim()) {
      return setError('A surname and a first name are required.');
    }
    setBusy(true);
    try {
      const r = await api.adminAdmit(token, {
        surname: form.surname.trim(),
        firstName: form.firstName.trim(),
        otherNames: form.otherNames.trim() || undefined,
        gender: form.gender || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        classId: form.classId ? Number(form.classId) : undefined,
        indexNumber: form.indexNumber.trim() || undefined,
      });
      setAdmitted(r.index_number);
      setForm(blankAdmission());
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (!may) {
    return <EmptyState icon="lock" title="Admissions are not yours to make"
                       message="Your account can read the roll but not add to it." />;
  }

  return (
    <OfficeScreen state={state} skeleton={3}>
      <ErrorNote message={error} />
      {admitted ? (
        <SuccessNote message={`Admitted — admission number ${admitted}. Write it on the record.`} />
      ) : null}

      <Panel title="Admit a pupil"
             subtitle="An admission number is issued automatically unless the school has its own.">
        <View style={styles.formGrid}>
          <View style={styles.formCell}><Field label="Surname" value={form.surname} onChangeText={set('surname')} /></View>
          <View style={styles.formCell}><Field label="First name" value={form.firstName} onChangeText={set('firstName')} /></View>
          <View style={styles.formCell}><Field label="Other names" value={form.otherNames} onChangeText={set('otherNames')} /></View>
          <View style={styles.formCell}>
            <Select label="Sex" value={form.gender} onChange={set('gender')}
                    options={[{ label: 'Female', value: 'Female' }, { label: 'Male', value: 'Male' }]} />
          </View>
          <View style={styles.formCell}>
            <Field label="Date of birth" value={form.dateOfBirth} onChangeText={set('dateOfBirth')}
                   hint="YYYY-MM-DD" />
          </View>
          <View style={styles.formCell}>
            <Select label="Class" value={form.classId} onChange={set('classId')}
                    options={(classes || []).map(c => ({ label: c.name, value: String(c.id) }))} />
          </View>
          <View style={styles.formCell}>
            <Field label="Admission number" value={form.indexNumber} onChangeText={set('indexNumber')}
                   hint="Leave empty and one is issued" />
          </View>
        </View>
        <Button title={busy ? 'Admitting…' : 'Admit the pupil'} busy={busy} disabled={busy}
                icon="check" full={false} onPress={admit} />
      </Panel>

      <Panel title="Recently admitted" subtitle="The last twelve onto the roll">
        <DataTable
          keyExtractor={(r) => String(r.id)}
          empty="Nobody has been admitted yet."
          columns={[
            { key: 'name', label: 'Pupil' },
            { key: 'index_number', label: 'Admission no.', width: 150 },
            { key: 'class_name', label: 'Class', width: 140 },
            { key: 'admission_date', label: 'Admitted', align: 'right', width: 116,
              render: (r) => shortDate(r.admission_date) },
          ]}
          rows={recent} />
      </Panel>
    </OfficeScreen>
  );
}

const blankAdmission = () => ({
  surname: '', firstName: '', otherNames: '', gender: '',
  dateOfBirth: '', classId: '', indexNumber: '',
});

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
  const state = useOffice((t) => api.adminStudents(t, { status }), [status]);
  const [changing, setChanging] = useState(null);
  const [newStatus, setNewStatus] = useState('Withdrawn');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const may = can(profile, 'students', 'edit');
  const rows = useMemo(() => filterPupils(state.data?.students, q), [state.data, q]);

  async function change() {
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
    <OfficeScreen state={state} skeleton={5}>
      <ErrorNote message={error} />
      <Bar
        left={<>
          <View style={{ minWidth: 320 }}>
            <SegmentedControl value={status} onChange={setStatus}
                              options={STATUSES.map(s => ({ label: s, value: s }))} />
          </View>
          <View style={{ minWidth: 220, flex: 1 }}>
            <SearchField value={q} onChangeText={setQ} placeholder="Find a pupil" />
          </View>
        </>}
        right={<Badge tone={status === 'Active' ? 'success' : 'neutral'} label={`${rows.length} ${status.toLowerCase()}`} />}
      />

      <Panel padded={false}>
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r) => String(r.id)}
            empty={`Nobody is ${status.toLowerCase()}.`}
            onRowPress={may ? (r) => {
              setError(null); setChanging(r);
              setNewStatus(r.status === 'Active' ? 'Withdrawn' : 'Active'); setReason('');
            } : undefined}
            columns={[
              ...pupilColumns().slice(0, 2),
              { key: 'status', label: 'Status', width: 120,
                render: (r) => <Badge tone={r.status === 'Active' ? 'success' : 'neutral'} label={r.status} /> },
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
                    options={STATUSES.map(s => ({ label: s, value: s }))} />
            {newStatus !== 'Active' ? (
              <Field label="Why" value={reason} onChangeText={setReason}
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

// ── The sheet ───────────────────────────────────────────────────────────────

const SHEET_COLUMNS = [
  { key: 'surname',         label: 'Surname',      width: 150 },
  { key: 'first_name',      label: 'First name',   width: 150 },
  { key: 'other_names',     label: 'Other names',  width: 150 },
  { key: 'gender',          label: 'Sex',          width: 90, choices: ['Female', 'Male'] },
  { key: 'date_of_birth',   label: 'Born',         width: 130, hint: 'YYYY-MM-DD' },
  { key: 'father_name',     label: "Father",       width: 170 },
  { key: 'father_contact',  label: "Father's phone", width: 150 },
  { key: 'mother_name',     label: 'Mother',       width: 170 },
  { key: 'mother_contact',  label: "Mother's phone", width: 150 },
  { key: 'guardian_name',   label: 'Guardian',     width: 170 },
  { key: 'guardian_contact',label: "Guardian's phone", width: 150 },
  { key: 'place_of_residence', label: 'Residence', width: 170 },
];

export function StudentsSheet() {
  const { token, profile } = useAuth();
  const layout = useLayout();
  const { classes } = useClasses(token);
  const [classId, setClassId] = useState('');
  const state = useOffice(
    (t) => (classId ? api.adminStudents(t, { status: 'Active', classId }) : Promise.resolve({ ok: true, students: [] })),
    [classId]);

  // id → { column: value }. Only what has been TOUCHED, so a save sends the
  // corrections and not four hundred unchanged rows.
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(0);
  const may = can(profile, 'students', 'edit');

  const rows = state.data?.students || [];
  const dirtyIds = Object.keys(edits).filter(id => Object.keys(edits[id] || {}).length);

  const edit = useCallback((id, key, value) => {
    setEdits(e => ({ ...e, [id]: { ...(e[id] || {}), [key]: value } }));
  }, []);

  async function save() {
    setError(null); setBusy(true);
    let done = 0;
    try {
      // One request per corrected pupil, in order. A batch endpoint would be
      // faster and would also mean a single bad row rejecting thirty good ones.
      for (const id of dirtyIds) {
        await api.adminUpdateStudent(token, id, edits[id]);
        done += 1;
      }
      setEdits({});
      setSaved(done);
      state.reload();
    } catch (e) {
      setError(`${e.message}${done ? ` — ${done} pupil${done === 1 ? '' : 's'} saved before it stopped.` : ''}`);
    } finally { setBusy(false); }
  }

  if (!may) {
    return <EmptyState icon="lock" title="The sheet is read-only for your account"
                       message="You can see the roll under All Students. Correcting a record needs edit access to Students." />;
  }

  return (
    <OfficeScreen state={state} skeleton={6}>
      <ErrorNote message={error} />
      {saved ? <SuccessNote message={`${saved} pupil${saved === 1 ? '' : 's'} corrected.`} /> : null}

      <Bar
        left={<View style={{ minWidth: 240 }}>
          <Select label="Class" value={classId} onChange={(v) => { setEdits({}); setSaved(0); setClassId(v); }}
                  placeholder="Choose a class to open its sheet"
                  options={(classes || []).map(c => ({ label: c.name, value: String(c.id) }))} />
        </View>}
        right={<>
          {dirtyIds.length ? <Badge tone="warning" label={`${dirtyIds.length} unsaved`} /> : null}
          <Button title={busy ? 'Saving…' : 'Save changes'} busy={busy}
                  disabled={busy || !dirtyIds.length} icon="check" full={false} onPress={save} />
          {dirtyIds.length ? (
            <Button title="Discard" variant="ghost" full={false} disabled={busy}
                    onPress={() => setEdits({})} />
          ) : null}
        </>}
      />

      {!classId ? (
        <EmptyState icon="layers" title="Pick a class"
                    message="The sheet opens one class at a time — four hundred rows on one screen is not a sheet anybody can work down." />
      ) : rows.length === 0 ? (
        <EmptyState icon="users" title="Nobody in this class"
                    message="Admit pupils into it, or move them from another class." />
      ) : !layout.canTable ? (
        <EmptyState icon="alert" title="The sheet needs a wider screen"
                    message="Typing across fourteen columns on a handset is not a sheet. Open a pupil from All Students to correct one record, or use this on a tablet or a PC." />
      ) : (
        <Panel padded={false} title={`${rows.length} pupils`}
               subtitle="Type into a cell to correct it. Nothing is written until you save.">
          <SheetGrid rows={rows} edits={edits} onEdit={edit} />
        </Panel>
      )}
    </OfficeScreen>
  );
}

function SheetGrid({ rows, edits, onEdit }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator style={{ width: '100%' }}>
      <View>
          <View style={styles.sheetHead}>
            <View style={[styles.sheetCell, { width: 46 }]}><Text style={styles.sheetHeadText}>#</Text></View>
            {SHEET_COLUMNS.map(c => (
              <View key={c.key} style={[styles.sheetCell, { width: c.width }]}>
                <Text numberOfLines={1} style={styles.sheetHeadText}>{c.label}</Text>
              </View>
            ))}
          </View>
          {rows.map((r, i) => (
            <View key={r.id} style={[styles.sheetRow, i % 2 ? styles.sheetRowAlt : null]}>
              <View style={[styles.sheetCell, { width: 46 }]}>
                <Text style={styles.sheetIndex}>{i + 1}</Text>
              </View>
              {SHEET_COLUMNS.map(c => (
                <SheetCell
                  key={c.key} column={c} row={r}
                  value={(edits[r.id] && c.key in edits[r.id]) ? edits[r.id][c.key] : (r[c.key] ?? '')}
                  dirty={!!(edits[r.id] && c.key in edits[r.id])}
                  onChange={(v) => onEdit(r.id, c.key, v)} />
              ))}
            </View>
          ))}
      </View>
    </ScrollView>
  );
}

function SheetCell({ column, value, dirty, onChange }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={[styles.sheetCell, { width: column.width }]}>
      <TextInput
        value={value == null ? '' : String(value)}
        onChangeText={onChange}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        placeholder={column.hint || ''}
        placeholderTextColor={colors.faint}
        accessibilityLabel={column.label}
        style={[styles.sheetInput, dirty && styles.sheetInputDirty, focus && styles.sheetInputFocus]}
      />
    </View>
  );
}

const styles = {
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.md },
  formCell: { minWidth: 220, flexGrow: 1, flexBasis: 220 },

  sheetHead: {
    flexDirection: 'row', backgroundColor: colors.surfaceAlt,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  sheetHeadText: {
    ...type.micro, color: colors.muted, fontSize: 10.5, paddingHorizontal: 8, paddingVertical: 9,
  },
  sheetRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  sheetRowAlt: { backgroundColor: colors.surfaceAlt },
  sheetCell: { paddingHorizontal: 3, paddingVertical: 3, justifyContent: 'center' },
  sheetIndex: { ...type.small, color: colors.faint, fontSize: 11.5, textAlign: 'center' },
  sheetInput: {
    ...type.small, color: colors.text, fontSize: 13,
    paddingHorizontal: 7, paddingVertical: 7, minHeight: 34,
    borderRadius: radius.xs, borderWidth: 1, borderColor: 'transparent',
    backgroundColor: 'transparent',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  // A corrected cell stays marked until it is saved, so somebody who has typed
  // down forty rows can see at a glance what they have touched.
  sheetInputDirty: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  sheetInputFocus: { borderColor: colors.primary, backgroundColor: colors.card },
};
