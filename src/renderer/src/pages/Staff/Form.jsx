import React, { useState } from 'react';
import { sanitizeForForm } from '../../lib/formSafe.js';
import PhotoUploader from '../../components/PhotoUploader.jsx';

export default function StaffForm({ staff, onSaved, onCancel }) {
  const [data, setData] = useState(() => staff ? sanitizeForForm(staff) : {
    surname: '', first_name: '', other_names: '', gender: 'Male', date_of_birth: '',
    phone: '', email: '', address: '', role: 'Teaching',
    qualification: '', specialization: '', bank_account: '', bank_name: '',
    ssnit_number: '', ssnit_enrolled: 0, hire_date: '', base_salary: 0, notes: '',
    photo_path: '',
  });
  const [saving, setSaving] = useState(false);

  function set(k, v) { setData(prev => ({ ...prev, [k]: v })); }

  async function save() {
    if (!data.surname || !data.first_name || !data.role) {
      alert('Surname, first name and role are required');
      return;
    }
    setSaving(true);
    let id;
    if (staff && staff.id) {
      await window.api.staff.update(staff.id, data);
      id = staff.id;
    } else {
      const res = await window.api.staff.create(data);
      id = res.id;
    }
    setSaving(false);
    onSaved(id);
  }

  return (
    <div>
      <div style={{ marginBottom: 20, padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 8 }}>
        <PhotoUploader
          entityType="staff"
          entityId={data.id}
          currentPath={data.photo_path}
          onChange={(newPath) => set('photo_path', newPath)}
          label="Staff photo"
          size={100}
        />
      </div>
      <h4 style={{ fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Personal</h4>
      <div className="form-row-3">
        <Field label="Surname *"><input className="input" value={data.surname ?? ''} onChange={e => set('surname', e.target.value)} /></Field>
        <Field label="First name *"><input className="input" value={data.first_name ?? ''} onChange={e => set('first_name', e.target.value)} /></Field>
        <Field label="Other names"><input className="input" value={data.other_names ?? ''} onChange={e => set('other_names', e.target.value)} /></Field>
      </div>
      <div className="form-row-3">
        <Field label="Gender">
          <select className="select" value={data.gender ?? ''} onChange={e => set('gender', e.target.value)}>
            <option>Male</option><option>Female</option>
          </select>
        </Field>
        <Field label="Date of birth"><input className="input" type="date" value={data.date_of_birth || ''} onChange={e => set('date_of_birth', e.target.value)} /></Field>
        <Field label="Hire date"><input className="input" type="date" value={data.hire_date || ''} onChange={e => set('hire_date', e.target.value)} /></Field>
      </div>

      <h4 style={{ fontSize: 13, color: 'var(--muted)', marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>Contact</h4>
      <div className="form-row">
        <Field label="Phone"><input className="input" value={data.phone ?? ''} onChange={e => set('phone', e.target.value)} /></Field>
        <Field label="Email"><input className="input" value={data.email ?? ''} onChange={e => set('email', e.target.value)} /></Field>
      </div>
      <Field label="Address"><input className="input" value={data.address ?? ''} onChange={e => set('address', e.target.value)} /></Field>

      <h4 style={{ fontSize: 13, color: 'var(--muted)', marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>Role</h4>
      <div className="form-row-3">
        <Field label="Role *">
          <select className="select" value={data.role ?? ''} onChange={e => set('role', e.target.value)}>
            <option>Teaching</option><option>Non-Teaching</option>
            <option>Administrative</option><option>Support</option>
          </select>
        </Field>
        <Field label="Qualification"><input className="input" value={data.qualification ?? ''} onChange={e => set('qualification', e.target.value)} /></Field>
        <Field label="Specialisation"><input className="input" value={data.specialization ?? ''} onChange={e => set('specialization', e.target.value)} /></Field>
      </div>

      <h4 style={{ fontSize: 13, color: 'var(--muted)', marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>Payroll</h4>
      <div className="form-row-3">
        <Field label="Base salary (GHS)">
          <input className="input" type="number" step="0.01" value={data.base_salary ?? ''} onChange={e => set('base_salary', e.target.value)} />
        </Field>
        <Field label="Bank name"><input className="input" value={data.bank_name ?? ''} onChange={e => set('bank_name', e.target.value)} /></Field>
        <Field label="Bank account"><input className="input" value={data.bank_account ?? ''} onChange={e => set('bank_account', e.target.value)} /></Field>
      </div>
      <div className="form-row">
        <Field label="SSNIT number"><input className="input" value={data.ssnit_number ?? ''} onChange={e => set('ssnit_number', e.target.value)} /></Field>
        <Field label="SSNIT enrolled?">
          <label className="row gap-2" style={{ paddingTop: 6 }}>
            <input type="checkbox" checked={!!data.ssnit_enrolled}
              onChange={e => set('ssnit_enrolled', e.target.checked ? 1 : 0)} />
            <span>This staff member contributes to SSNIT</span>
          </label>
        </Field>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 24 }}>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}
function Field({ label, children }) {
  return <div className="form-group"><label className="label">{label}</label>{children}</div>;
}
