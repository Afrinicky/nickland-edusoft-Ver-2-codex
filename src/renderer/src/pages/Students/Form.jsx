import React, { useState } from 'react';
import { useStore } from '../../store/index.js';
import { computeAge } from '../../lib/format.js';
import { sanitizeForForm } from '../../lib/formSafe.js';
import PhotoUploader from '../../components/PhotoUploader.jsx';

export default function StudentForm({ student, onSaved, onCancel }) {
  const classes = useStore(s => s.classes);
  const [data, setData] = useState(() => student ? sanitizeForForm(student) : {
    surname: '', first_name: '', other_names: '', gender: 'Male', denomination: '',
    age: '', date_of_birth: '', place_of_birth: '', place_of_residence: '',
    father_name: '', father_contact: '', mother_name: '', mother_contact: '',
    guardian_name: '', guardian_contact: '', street_address: '', house_number: '',
    digital_address: '', nhis_number: '', current_class_id: '', photo_path: '',
  });
  const [saving, setSaving] = useState(false);

  function set(field, value) {
    setData(prev => ({ ...prev, [field]: value }));
  }

  async function save() {
    if (!data.surname || !data.first_name) {
      alert('Surname and First Name are required');
      return;
    }
    if (!data.current_class_id) {
      alert('Please choose a class');
      return;
    }
    setSaving(true);
    let result;
    if (student && student.id) {
      result = await window.api.students.update(student.id, data);
      onSaved(student.id);
    } else {
      result = await window.api.students.create(data);
      onSaved(result.id);
    }
    setSaving(false);
  }

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
      <h4 style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Personal information
      </h4>
      <div className="form-row-3">
        <Field label="Surname *">
          <input className="input" value={data.surname || ''} onChange={e => set('surname', e.target.value)} />
        </Field>
        <Field label="First name *">
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
        <Field label="Date of birth">
          <input className="input" type="date" value={data.date_of_birth || ''} onChange={e => set('date_of_birth', e.target.value)} />
        </Field>
        <Field label="Age (computed)">
          <input
            className="input"
            type="text"
            value={computeAge(data.date_of_birth) ?? data.age ?? ''}
            placeholder="Enter date of birth"
            readOnly
            style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}
          />
        </Field>
        <Field label="Denomination">
          <input className="input" value={data.denomination || ''} onChange={e => set('denomination', e.target.value)} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Place of birth">
          <input className="input" value={data.place_of_birth || ''} onChange={e => set('place_of_birth', e.target.value)} />
        </Field>
        <Field label="Place of residence">
          <input className="input" value={data.place_of_residence || ''} onChange={e => set('place_of_residence', e.target.value)} />
        </Field>
      </div>

      <h4 style={{ fontSize: 13, color: 'var(--muted)', marginTop: 16, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Class
      </h4>
      <Field label="Class *">
        <select className="select" value={data.current_class_id || ''} onChange={e => set('current_class_id', parseInt(e.target.value))}>
          <option value="">Choose class…</option>
          {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
        </select>
      </Field>

      <h4 style={{ fontSize: 13, color: 'var(--muted)', marginTop: 16, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Parents / Guardian
      </h4>
      <div className="form-row">
        <Field label="Father's name">
          <input className="input" value={data.father_name || ''} onChange={e => set('father_name', e.target.value)} />
        </Field>
        <Field label="Father's contact">
          <input className="input" value={data.father_contact || ''} onChange={e => set('father_contact', e.target.value)} />
        </Field>
        <Field label="Mother's name">
          <input className="input" value={data.mother_name || ''} onChange={e => set('mother_name', e.target.value)} />
        </Field>
        <Field label="Mother's contact">
          <input className="input" value={data.mother_contact || ''} onChange={e => set('mother_contact', e.target.value)} />
        </Field>
        <Field label="Guardian's name">
          <input className="input" value={data.guardian_name || ''} onChange={e => set('guardian_name', e.target.value)} />
        </Field>
        <Field label="Guardian's contact">
          <input className="input" value={data.guardian_contact || ''} onChange={e => set('guardian_contact', e.target.value)} />
        </Field>
      </div>

      <h4 style={{ fontSize: 13, color: 'var(--muted)', marginTop: 16, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Address
      </h4>
      <div className="form-row">
        <Field label="Street address">
          <input className="input" value={data.street_address || ''} onChange={e => set('street_address', e.target.value)} />
        </Field>
        <Field label="House number">
          <input className="input" value={data.house_number || ''} onChange={e => set('house_number', e.target.value)} />
        </Field>
        <Field label="Digital (GPS) address">
          <input className="input" value={data.digital_address || ''} onChange={e => set('digital_address', e.target.value)} />
        </Field>
        <Field label="NHIS number">
          <input className="input" value={data.nhis_number || ''} onChange={e => set('nhis_number', e.target.value)} />
        </Field>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 24 }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? <><span className="spinner" /> Saving…</> : 'Save student'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <div className="form-group"><label className="label">{label}</label>{children}</div>;
}
