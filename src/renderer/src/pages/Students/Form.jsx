// Nickland Edusoft — Admitting a pupil.
//
// The school's admission form, on a screen. It is one form rather than a
// wizard because that is what the office has in front of it: a sheet a parent
// filled in at the gate, worked through top to bottom in one sitting.
//
// ── What was missing, and why each one matters ──────────────────────────────
//
// The form collected a name, a class, three contacts and an address. A
// Ghanaian school's admission form asks for more, and every one of these was a
// question the office had to keep on paper because the system had nowhere to
// put the answer:
//
//   • the PREVIOUS SCHOOL, which is what decides the class a pupil enters
//   • NATIONALITY and HOMETOWN, which the GES returns ask for
//   • who the pupil actually LIVES WITH, which is not always the parent whose
//     name is first on the form, and which decides who gets rung
//   • the guardian's RELATIONSHIP, so "Auntie Comfort" is not a mystery to
//     whoever picks up the phone in three years
//   • an EMERGENCY CONTACT separate from the parents, because the whole point
//     of one is that it answers when they do not
//   • BLOOD GROUP, ALLERGIES and medical notes — a child collapses in the yard
//     perhaps twice in a school's life, and that is the moment these exist for
//   • any SPECIAL EDUCATIONAL NEED, so it follows the pupil rather than living
//     in one teacher's memory
//   • the ADMISSION DATE, which was silently set to today, so a pupil admitted
//     mid-term was recorded as having joined on the day somebody typed them in
//
// And the age the form computed was never saved: it was drawn on the screen
// and dropped, so `students.age` was empty on every pupil ever admitted here.
import React, { useState } from 'react';
import { useStore } from '../../store/index.js';
import { computeAge } from '../../lib/format.js';
import { sanitizeForForm } from '../../lib/formSafe.js';
import PhotoUploader from '../../components/PhotoUploader.jsx';

const BLOOD_GROUPS = ['', 'O+', 'O−', 'A+', 'A−', 'B+', 'B−', 'AB+', 'AB−'];
const LIVES_WITH = ['', 'Both parents', 'Father', 'Mother', 'Guardian', 'Other'];

const BLANK = {
  index_number: '',
  surname: '', first_name: '', other_names: '', gender: 'Male', denomination: '',
  age: '', date_of_birth: '', place_of_birth: '', place_of_residence: '',
  nationality: 'Ghanaian', hometown: '', previous_school: '',
  father_name: '', father_contact: '', father_email: '',
  mother_name: '', mother_contact: '', mother_email: '',
  guardian_name: '', guardian_contact: '', guardian_email: '', guardian_relationship: '',
  lives_with: '',
  emergency_contact_name: '', emergency_contact_phone: '',
  street_address: '', house_number: '',
  digital_address: '', nhis_number: '',
  blood_group: '', allergies: '', medical_notes: '', special_needs: '',
  admission_date: new Date().toISOString().slice(0, 10),
  notes: '',
  current_class_id: '', photo_path: '',
};

export default function StudentForm({ student, onSaved, onCancel }) {
  const classes = useStore(s => s.classes);
  const showToast = useStore(s => s.showToast);
  const [data, setData] = useState(() => (student
    ? { ...BLANK, ...sanitizeForForm(student) }
    : { ...BLANK }));
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState({});

  function set(field, value) {
    setData(prev => ({ ...prev, [field]: value }));
    if (problems[field]) setProblems(p => ({ ...p, [field]: null }));
  }

  // What must be right before a record goes on the roll. Everything else is
  // allowed to be blank — an admission form arrives half-filled far more often
  // than it arrives complete, and refusing the pupil until a parent remembers
  // their NHIS number is not what a school wants from this screen.
  function validate() {
    const p = {};
    if (!String(data.surname || '').trim()) p.surname = 'The surname is needed.';
    if (!String(data.first_name || '').trim()) p.first_name = 'The first name is needed.';
    if (!data.current_class_id) p.current_class_id = 'Choose the class this pupil joins.';

    if (data.date_of_birth) {
      const dob = new Date(data.date_of_birth);
      const age = computeAge(data.date_of_birth);
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
    setProblems(p);
    return Object.keys(p).length === 0;
  }

  async function save() {
    if (!validate()) {
      showToast('Some details need checking — they are marked in red', 'warning');
      return;
    }
    setSaving(true);
    // The age the form computed. It used to be displayed and dropped, so the
    // column was empty on every pupil admitted through this screen.
    const payload = { ...data, age: computeAge(data.date_of_birth) ?? data.age ?? null };

    let result;
    if (student && student.id) {
      result = await window.api.students.update(student.id, payload);
      setSaving(false);
      if (result && result.ok === false) return showToast(result.error || 'Update failed', 'error');
      onSaved(student.id);
    } else {
      result = await window.api.students.create(payload);
      setSaving(false);
      if (result && result.ok === false) return showToast(result.error || 'Could not add student', 'error');
      onSaved(result.id, result.index_number);
    }
  }

  const age = computeAge(data.date_of_birth);

  return (
    <div>
      <div style={{ marginBottom: 20, padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 8 }}>
        <PhotoUploader
          entityType="students"
          entityId={data.id}
          currentPath={data.photo_path}
          onChange={(newPath) => set('photo_path', newPath)}
          label="Student photo"
          size={100}
        />
      </div>

      <Section>Personal information</Section>
      <div className="form-row-3">
        <Field label="Surname *" error={problems.surname}>
          <input className="input" value={data.surname || ''} onChange={e => set('surname', e.target.value)} />
        </Field>
        <Field label="First name *" error={problems.first_name}>
          <input className="input" value={data.first_name || ''} onChange={e => set('first_name', e.target.value)} />
        </Field>
        <Field label="Other names">
          <input className="input" value={data.other_names || ''} onChange={e => set('other_names', e.target.value)} />
        </Field>
      </div>
      <div className="form-row-4">
        <Field label="Gender">
          <select className="select" value={data.gender || ''} onChange={e => set('gender', e.target.value)}>
            <option>Male</option>
            <option>Female</option>
          </select>
        </Field>
        <Field label="Date of birth" error={problems.date_of_birth}>
          <input className="input" type="date" value={data.date_of_birth || ''}
            onChange={e => set('date_of_birth', e.target.value)} />
        </Field>
        <Field label="Age" hint={age == null ? 'Worked out from the date of birth' : 'as of today'}>
          <input className="input" type="text" readOnly
            value={age ?? data.age ?? ''}
            placeholder="Enter date of birth"
            style={{ background: 'var(--surface-2)', color: 'var(--muted)' }} />
        </Field>
        <Field label="Denomination">
          <input className="input" value={data.denomination || ''}
            onChange={e => set('denomination', e.target.value)} placeholder="e.g. Catholic" />
        </Field>
      </div>
      <div className="form-row-4">
        <Field label="Place of birth">
          <input className="input" value={data.place_of_birth || ''} onChange={e => set('place_of_birth', e.target.value)} />
        </Field>
        <Field label="Hometown">
          <input className="input" value={data.hometown || ''} onChange={e => set('hometown', e.target.value)} />
        </Field>
        <Field label="Nationality">
          <input className="input" value={data.nationality || ''} onChange={e => set('nationality', e.target.value)} />
        </Field>
        <Field label="Place of residence">
          <input className="input" value={data.place_of_residence || ''}
            onChange={e => set('place_of_residence', e.target.value)} />
        </Field>
      </div>

      <Section>Admission</Section>
      <div className="form-row-4">
        <Field label="Class *" error={problems.current_class_id}>
          <select className="select" value={data.current_class_id || ''}
            onChange={e => set('current_class_id', parseInt(e.target.value, 10) || '')}>
            <option value="">Choose class…</option>
            {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Index number" hint={student ? '' : 'Leave blank to auto-assign'}>
          <input className="input" style={{ fontFamily: 'monospace' }}
            value={data.index_number || ''} onChange={e => set('index_number', e.target.value)}
            placeholder={student ? '' : 'AVE/18/00001'} />
        </Field>
        <Field label="Admitted on" hint="The day they actually joined">
          <input className="input" type="date" value={data.admission_date || ''}
            onChange={e => set('admission_date', e.target.value)} />
        </Field>
        <Field label="Previous school" hint="What decides the class they enter">
          <input className="input" value={data.previous_school || ''}
            onChange={e => set('previous_school', e.target.value)} />
        </Field>
      </div>

      <Section>Parents and guardian</Section>
      <div className="form-row-3">
        <Field label="Father's name">
          <input className="input" value={data.father_name || ''} onChange={e => set('father_name', e.target.value)} />
        </Field>
        <Field label="Father's contact" error={problems.father_contact}>
          <input className="input" value={data.father_contact || ''} placeholder="0244 000 000"
            onChange={e => set('father_contact', e.target.value)} />
        </Field>
        <Field label="Father's email" error={problems.father_email} hint="for receipt delivery">
          <input className="input" type="email" value={data.father_email || ''}
            onChange={e => set('father_email', e.target.value)} />
        </Field>
      </div>
      <div className="form-row-3">
        <Field label="Mother's name">
          <input className="input" value={data.mother_name || ''} onChange={e => set('mother_name', e.target.value)} />
        </Field>
        <Field label="Mother's contact" error={problems.mother_contact}>
          <input className="input" value={data.mother_contact || ''} placeholder="0244 000 000"
            onChange={e => set('mother_contact', e.target.value)} />
        </Field>
        <Field label="Mother's email" error={problems.mother_email} hint="for receipt delivery">
          <input className="input" type="email" value={data.mother_email || ''}
            onChange={e => set('mother_email', e.target.value)} />
        </Field>
      </div>
      <div className="form-row-4">
        <Field label="Guardian's name">
          <input className="input" value={data.guardian_name || ''} onChange={e => set('guardian_name', e.target.value)} />
        </Field>
        <Field label="Relationship" hint="Aunt, uncle, grandmother…">
          <input className="input" value={data.guardian_relationship || ''}
            onChange={e => set('guardian_relationship', e.target.value)} />
        </Field>
        <Field label="Guardian's contact" error={problems.guardian_contact}>
          <input className="input" value={data.guardian_contact || ''} placeholder="0244 000 000"
            onChange={e => set('guardian_contact', e.target.value)} />
        </Field>
        <Field label="Guardian's email" error={problems.guardian_email} hint="for receipt delivery">
          <input className="input" type="email" value={data.guardian_email || ''}
            onChange={e => set('guardian_email', e.target.value)} />
        </Field>
      </div>
      <div className="form-row-3">
        <Field label="The pupil lives with" hint="Who gets rung first">
          <select className="select" value={data.lives_with || ''} onChange={e => set('lives_with', e.target.value)}>
            {LIVES_WITH.map(v => <option key={v} value={v}>{v || '—'}</option>)}
          </select>
        </Field>
        <Field label="Emergency contact" hint="Somebody other than the parents">
          <input className="input" value={data.emergency_contact_name || ''}
            onChange={e => set('emergency_contact_name', e.target.value)} />
        </Field>
        <Field label="Emergency number" error={problems.emergency_contact_phone}>
          <input className="input" value={data.emergency_contact_phone || ''} placeholder="0244 000 000"
            onChange={e => set('emergency_contact_phone', e.target.value)} />
        </Field>
      </div>

      <Section>Address</Section>
      <div className="form-row-4">
        <Field label="Street address">
          <input className="input" value={data.street_address || ''} onChange={e => set('street_address', e.target.value)} />
        </Field>
        <Field label="House number">
          <input className="input" value={data.house_number || ''} onChange={e => set('house_number', e.target.value)} />
        </Field>
        <Field label="Digital (GPS) address" hint="e.g. BR-0348-9927">
          <input className="input" value={data.digital_address || ''}
            onChange={e => set('digital_address', e.target.value)} />
        </Field>
        <Field label="NHIS number">
          <input className="input" value={data.nhis_number || ''} onChange={e => set('nhis_number', e.target.value)} />
        </Field>
      </div>

      <Section>Health and support</Section>
      <div className="text-sm text-muted" style={{ marginTop: -6, marginBottom: 10 }}>
        A child collapses in the yard perhaps twice in a school's life. This is the
        moment these three lines exist for, so they are worth the minute now.
      </div>
      <div className="form-row-3">
        <Field label="Blood group">
          <select className="select" value={data.blood_group || ''} onChange={e => set('blood_group', e.target.value)}>
            {BLOOD_GROUPS.map(v => <option key={v} value={v}>{v || '—'}</option>)}
          </select>
        </Field>
        <Field label="Allergies" hint="Foods, medicines, insect stings">
          <input className="input" value={data.allergies || ''} onChange={e => set('allergies', e.target.value)} />
        </Field>
        <Field label="Special educational needs" hint="So it follows the pupil">
          <input className="input" value={data.special_needs || ''} onChange={e => set('special_needs', e.target.value)} />
        </Field>
      </div>
      <div className="form-group">
        <label className="label">Medical notes</label>
        <textarea className="input" rows={2} value={data.medical_notes || ''}
          onChange={e => set('medical_notes', e.target.value)}
          placeholder="Asthma, sickle cell, a medicine that is taken at midday…" />
      </div>

      <Section>Anything else</Section>
      <div className="form-group">
        <label className="label">Notes</label>
        <textarea className="input" rows={2} value={data.notes || ''}
          onChange={e => set('notes', e.target.value)}
          placeholder="Anything the office should know that has no box of its own." />
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 24 }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? <><span className="spinner" /> Saving…</> : (student ? 'Save changes' : 'Admit this pupil')}
        </button>
      </div>
    </div>
  );
}

function Section({ children }) {
  return (
    <h4 style={{
      fontSize: 13, color: 'var(--muted)', marginTop: 18, marginBottom: 12,
      textTransform: 'uppercase', letterSpacing: 0.5,
    }}>{children}</h4>
  );
}

function Field({ label, hint, error, children }) {
  return (
    <div className="form-group">
      <label className="label">{label}</label>
      {children}
      {error
        ? <div className="text-xs" style={{ color: 'var(--danger)' }}>{error}</div>
        : hint ? <div className="text-xs text-muted">{hint}</div> : null}
    </div>
  );
}
