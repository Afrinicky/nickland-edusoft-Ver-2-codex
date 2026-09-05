// Nickland Edusoft — Admitting a pupil.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The installed application's admission form, field for field. It used to ask
// for seven things — a name, a sex, a date, a class and an admission number —
// while the office PC asked for forty, so a pupil admitted at the gate arrived
// on the roll with no parents, no address, no contact and no medical note, and
// somebody had to type the form in again afterwards.
//
// ── Why it is one long form and not a wizard ────────────────────────────────
//
// Because that is what the office has in front of it: a sheet a parent filled
// in at the gate, worked through top to bottom in one sitting. A wizard that
// hides the address behind a Next button is slower for somebody copying, and
// it hides how much is left.
//
// ── What has to be right, and what does not ─────────────────────────────────
//
// A surname, a first name and a class. Everything else may be blank, because
// an admission form arrives half-filled far more often than it arrives
// complete, and refusing a pupil until a parent remembers their NHIS number is
// not what a school wants from this screen. What IS checked is the shape of
// what was typed — a Ghanaian phone number, an email address, a date of birth
// that has actually happened — because those are wrong silently.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { can } from '../../guard';
import { useOfficeClasses } from '../../pickers';
import { shortDate, useOffice, OfficeScreen } from '../../office';
import {
  Field, Select, Button, DataTable, Muted, Divider, EmptyState,
  ErrorNote, SuccessNote,
} from '../../ui';
import { Panel, StatRow, Stat } from '../../desk';
import { useLayout } from '../../responsive';
import { colors, spacing, type } from '../../theme';

const BLOOD_GROUPS = ['', 'O+', 'O−', 'A+', 'A−', 'B+', 'B−', 'AB+', 'AB−'];
const LIVES_WITH = ['', 'Both parents', 'Father', 'Mother', 'Guardian', 'Other'];

const BLANK = {
  surname: '', first_name: '', other_names: '', gender: 'Male', denomination: '',
  date_of_birth: '', place_of_birth: '', place_of_residence: '',
  nationality: 'Ghanaian', hometown: '', previous_school: '',
  father_name: '', father_contact: '', father_email: '',
  mother_name: '', mother_contact: '', mother_email: '',
  guardian_name: '', guardian_contact: '', guardian_email: '', guardian_relationship: '',
  lives_with: '',
  emergency_contact_name: '', emergency_contact_phone: '',
  street_address: '', house_number: '', digital_address: '', nhis_number: '',
  blood_group: '', allergies: '', medical_notes: '', special_needs: '',
  admission_date: new Date().toISOString().slice(0, 10),
  notes: '', current_class_id: '', index_number: '',
};

/** A pupil's age today, from their date of birth. */
export function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 120 ? age : null;
}

/**
 * What must be right before a record goes on the roll.
 *
 * The same rules the installed application applies, so a form filled in at the
 * gate and the same form filled in at the office are accepted or refused for
 * the same reasons.
 */
export function validateAdmission(data) {
  const p = {};
  if (!String(data.surname || '').trim()) p.surname = 'The surname is needed.';
  if (!String(data.first_name || '').trim()) p.first_name = 'The first name is needed.';
  if (!data.current_class_id) p.current_class_id = 'Choose the class this pupil joins.';

  if (data.date_of_birth) {
    const dob = new Date(data.date_of_birth);
    const age = ageFromDob(data.date_of_birth);
    if (Number.isNaN(dob.getTime()) || dob > new Date()) {
      p.date_of_birth = 'That date has not happened yet.';
    } else if (age != null && age > 30) {
      p.date_of_birth = `That would make this pupil ${age}. Check the year.`;
    }
  }
  for (const [field, label] of [
    ['father_contact', "Father's"], ['mother_contact', "Mother's"],
    ['guardian_contact', "Guardian's"], ['emergency_contact_phone', 'Emergency'],
  ]) {
    const v = String(data[field] || '').replace(/[\s-]/g, '');
    // Ghanaian numbers are 10 digits, or 12 with the +233 country code.
    if (v && !/^(\+?233\d{9}|0\d{9})$/.test(v)) {
      p[field] = `${label} number does not look like a Ghanaian number.`;
    }
  }
  for (const field of ['father_email', 'mother_email', 'guardian_email']) {
    const v = String(data[field] || '').trim();
    if (v && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v)) p[field] = 'That is not an email address.';
  }
  return p;
}

export default function StudentsAdmissions() {
  const { token, profile } = useAuth();
  const { classes } = useOfficeClasses(token);
  const layout = useLayout();
  const may = can(profile, 'students', 'create');

  const state = useOffice((t) => api.adminStudents(t, { status: 'Active' }));
  const [data, setData] = useState({ ...BLANK });
  const [problems, setProblems] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [admitted, setAdmitted] = useState(null);

  const set = useCallback((k) => (v) => {
    setData(f => ({ ...f, [k]: v }));
    setProblems(p => (p[k] ? { ...p, [k]: null } : p));
  }, []);

  const rows = state.data?.students || [];

  const recent = useMemo(() => rows.slice()
    .sort((a, b) => String(b.admission_date || '').localeCompare(String(a.admission_date || '')))
    .slice(0, 12), [rows]);

  const counts = useMemo(() => {
    const now = new Date();
    const week = new Date(now); week.setDate(now.getDate() - 7);
    const month = new Date(now.getFullYear(), now.getMonth(), 1);
    const year = new Date(now.getFullYear(), 0, 1);
    const dated = rows.filter(s => s.admission_date);
    const since = (d) => dated.filter(s => new Date(s.admission_date) >= d).length;
    return { week: since(week), month: since(month), year: since(year) };
  }, [rows]);

  async function admit() {
    const p = validateAdmission(data);
    setProblems(p);
    if (Object.keys(p).length) {
      return setError('Some details need checking — they are marked below.');
    }
    setError(null); setAdmitted(null);
    setBusy(true);
    try {
      const r = await api.adminAdmit(token, {
        ...data,
        current_class_id: Number(data.current_class_id),
        // The age the form works out from the date of birth. Sent rather than
        // shown and dropped, so the column is not empty on every pupil.
        age: ageFromDob(data.date_of_birth),
        index_number: String(data.index_number || '').trim() || undefined,
      });
      setAdmitted(r.index_number);
      setData({ ...BLANK });
      state.reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (!may) {
    return <EmptyState icon="lock" title="Admissions are not yours to make"
                       message="Your account can read the roll but not add to it." />;
  }

  const age = ageFromDob(data.date_of_birth);
  // Three across on a desk, one on a phone — the same form either way.
  const cols = layout.isDesktop ? 3 : 1;

  return (
    <OfficeScreen state={state} skeleton={3}>
      <ErrorNote message={error} />
      {admitted ? (
        <SuccessNote message={`Admitted — admission number ${admitted}. Write it on the record.`} />
      ) : null}

      <StatRow>
        <Stat index={0} label="This week" icon="users" tone="primary"
              value={String(counts.week)} note="new admissions" />
        <Stat index={1} label="This month" icon="calendar" tone="success"
              value={String(counts.month)} note="new admissions" />
        <Stat index={2} label="This year" icon="chart" tone="data"
              value={String(counts.year)} note={String(new Date().getFullYear())} />
      </StatRow>

      <Panel title="Admit a pupil"
             subtitle="A surname, a first name and a class are all that is required. Everything else can be filled in later — but the shape of what you do type is checked.">

        <Group>Personal information</Group>
        <Row cols={cols}>
          <Cell><Field label="Surname *" value={data.surname} onChangeText={set('surname')}
                       error={problems.surname} /></Cell>
          <Cell><Field label="First name *" value={data.first_name} onChangeText={set('first_name')}
                       error={problems.first_name} /></Cell>
          <Cell><Field label="Other names" value={data.other_names} onChangeText={set('other_names')} /></Cell>
        </Row>
        <Row cols={cols}>
          <Cell><Select label="Sex" value={data.gender} onChange={set('gender')}
                        options={[{ label: 'Male', value: 'Male' }, { label: 'Female', value: 'Female' }]} /></Cell>
          <Cell><Field label="Date of birth" value={data.date_of_birth} onChangeText={set('date_of_birth')}
                       hint={age == null ? 'YYYY-MM-DD' : `${age} years old today`}
                       error={problems.date_of_birth} /></Cell>
          <Cell><Field label="Denomination" value={data.denomination} onChangeText={set('denomination')}
                       hint="e.g. Catholic" /></Cell>
        </Row>
        <Row cols={cols}>
          <Cell><Field label="Place of birth" value={data.place_of_birth} onChangeText={set('place_of_birth')} /></Cell>
          <Cell><Field label="Hometown" value={data.hometown} onChangeText={set('hometown')} /></Cell>
          <Cell><Field label="Nationality" value={data.nationality} onChangeText={set('nationality')} /></Cell>
        </Row>
        <Row cols={cols}>
          <Cell><Field label="Place of residence" value={data.place_of_residence}
                       onChangeText={set('place_of_residence')} /></Cell>
        </Row>

        <Group>Admission</Group>
        <Row cols={cols}>
          <Cell><Select label="Class *" value={String(data.current_class_id || '')}
                        onChange={set('current_class_id')} placeholder="Choose class…"
                        error={problems.current_class_id}
                        options={(classes || []).map(c => ({ label: c.name, value: String(c.id) }))} /></Cell>
          <Cell><Field label="Admission number" value={data.index_number} onChangeText={set('index_number')}
                       hint="Leave empty and one is issued" /></Cell>
          <Cell><Field label="Admitted on" value={data.admission_date} onChangeText={set('admission_date')}
                       hint="The day they actually joined" /></Cell>
        </Row>
        <Row cols={cols}>
          <Cell><Field label="Previous school" value={data.previous_school}
                       onChangeText={set('previous_school')}
                       hint="What decides the class they enter" /></Cell>
        </Row>

        <Group>Parents and guardian</Group>
        <Row cols={cols}>
          <Cell><Field label="Father's name" value={data.father_name} onChangeText={set('father_name')} /></Cell>
          <Cell><Field label="Father's contact" value={data.father_contact} onChangeText={set('father_contact')}
                       keyboardType="phone-pad" placeholder="0244 000 000"
                       error={problems.father_contact} /></Cell>
          <Cell><Field label="Father's email" value={data.father_email} onChangeText={set('father_email')}
                       keyboardType="email-address" hint="for receipt delivery"
                       error={problems.father_email} /></Cell>
        </Row>
        <Row cols={cols}>
          <Cell><Field label="Mother's name" value={data.mother_name} onChangeText={set('mother_name')} /></Cell>
          <Cell><Field label="Mother's contact" value={data.mother_contact} onChangeText={set('mother_contact')}
                       keyboardType="phone-pad" placeholder="0244 000 000"
                       error={problems.mother_contact} /></Cell>
          <Cell><Field label="Mother's email" value={data.mother_email} onChangeText={set('mother_email')}
                       keyboardType="email-address" hint="for receipt delivery"
                       error={problems.mother_email} /></Cell>
        </Row>
        <Row cols={cols}>
          <Cell><Field label="Guardian's name" value={data.guardian_name} onChangeText={set('guardian_name')} /></Cell>
          <Cell><Field label="Relationship" value={data.guardian_relationship}
                       onChangeText={set('guardian_relationship')}
                       hint="Aunt, uncle, grandmother…" /></Cell>
          <Cell><Field label="Guardian's contact" value={data.guardian_contact}
                       onChangeText={set('guardian_contact')} keyboardType="phone-pad"
                       placeholder="0244 000 000" error={problems.guardian_contact} /></Cell>
        </Row>
        <Row cols={cols}>
          <Cell><Field label="Guardian's email" value={data.guardian_email} onChangeText={set('guardian_email')}
                       keyboardType="email-address" hint="for receipt delivery"
                       error={problems.guardian_email} /></Cell>
          <Cell><Select label="The pupil lives with" value={data.lives_with} onChange={set('lives_with')}
                        placeholder="—" hint="Who gets rung first"
                        options={LIVES_WITH.map(v => ({ label: v || '—', value: v }))} /></Cell>
        </Row>
        <Row cols={cols}>
          <Cell><Field label="Emergency contact" value={data.emergency_contact_name}
                       onChangeText={set('emergency_contact_name')}
                       hint="Somebody other than the parents" /></Cell>
          <Cell><Field label="Emergency number" value={data.emergency_contact_phone}
                       onChangeText={set('emergency_contact_phone')} keyboardType="phone-pad"
                       placeholder="0244 000 000" error={problems.emergency_contact_phone} /></Cell>
        </Row>

        <Group>Address</Group>
        <Row cols={cols}>
          <Cell><Field label="Street address" value={data.street_address} onChangeText={set('street_address')} /></Cell>
          <Cell><Field label="House number" value={data.house_number} onChangeText={set('house_number')} /></Cell>
          <Cell><Field label="Digital (GPS) address" value={data.digital_address}
                       onChangeText={set('digital_address')} hint="e.g. BR-0348-9927" /></Cell>
        </Row>
        <Row cols={cols}>
          <Cell><Field label="NHIS number" value={data.nhis_number} onChangeText={set('nhis_number')} /></Cell>
        </Row>

        <Group>Health and support</Group>
        <Muted style={{ marginTop: -6, marginBottom: 8 }}>
          A child collapses in the yard perhaps twice in a school's life. This is the
          moment these three lines exist for, so they are worth the minute now.
        </Muted>
        <Row cols={cols}>
          <Cell><Select label="Blood group" value={data.blood_group} onChange={set('blood_group')}
                        placeholder="—"
                        options={BLOOD_GROUPS.map(v => ({ label: v || '—', value: v }))} /></Cell>
          <Cell><Field label="Allergies" value={data.allergies} onChangeText={set('allergies')}
                       hint="Foods, medicines, insect stings" /></Cell>
          <Cell><Field label="Special educational needs" value={data.special_needs}
                       onChangeText={set('special_needs')} hint="So it follows the pupil" /></Cell>
        </Row>
        <Field label="Medical notes" value={data.medical_notes} onChangeText={set('medical_notes')}
               multiline numberOfLines={2}
               placeholder="Asthma, sickle cell, a medicine that is taken at midday…" />

        <Group>Anything else</Group>
        <Field label="Notes" value={data.notes} onChangeText={set('notes')}
               multiline numberOfLines={2}
               placeholder="Anything the office should know that has no box of its own." />

        <Divider />
        <Button title={busy ? 'Admitting…' : 'Admit this pupil'} icon="check"
                busy={busy} disabled={busy} onPress={admit} />
      </Panel>

      <Panel padded={false} title="Recently admitted" subtitle="The last twelve onto the roll">
        <View style={{ padding: spacing.lg }}>
          <DataTable
            keyExtractor={(r) => String(r.id)}
            empty="Nobody has been admitted yet."
            columns={[
              { key: 'index_number', label: 'Admission no.', width: 150 },
              { key: 'name', label: 'Pupil' },
              { key: 'class_name', label: 'Class', width: 140 },
              { key: 'gender', label: 'Sex', width: 90 },
              { key: 'admission_date', label: 'Admitted', align: 'right', width: 120,
                render: (r) => shortDate(r.admission_date) },
            ]}
            rows={recent} />
        </View>
      </Panel>
    </OfficeScreen>
  );
}

function Group({ children }) {
  return (
    <Text style={{
      ...type.small, color: colors.muted, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 0.5,
      marginTop: spacing.lg, marginBottom: spacing.sm,
    }}>{children}</Text>
  );
}

function Row({ cols, children }) {
  return (
    <View style={{
      flexDirection: cols > 1 ? 'row' : 'column',
      gap: spacing.md, flexWrap: 'wrap',
    }}>{children}</View>
  );
}

function Cell({ children }) {
  return <View style={{ flex: 1, minWidth: 200 }}>{children}</View>;
}
