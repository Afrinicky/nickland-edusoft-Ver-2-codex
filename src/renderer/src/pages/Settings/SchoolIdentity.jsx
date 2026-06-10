import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

// School identity: covers everything needed to use the system for any school —
// name, motto, vision/mission, addresses, registrations, logo.
export default function SchoolIdentity() {
  const settings = useStore(s => s.settings);
  const loadSettings = useStore(s => s.loadSettings);
  const showToast = useStore(s => s.showToast);
  const [data, setData] = useState({});
  const [logoSrc, setLogoSrc] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const merged = { ...(settings.school || {}), ...(settings.registration || {}), ...(settings.branding || {}) };
    setData(merged);
    if (merged.school_logo_path) {
      setLogoSrc(`file://${merged.school_logo_path}?t=${Date.now()}`);
    }
  }, [settings]);

  function set(k, v) { setData(prev => ({ ...prev, [k]: v })); }

  async function saveAll() {
    setSaving(true);
    const KEYS = [
      'school_name', 'school_short_name', 'school_abbreviation', 'school_motto',
      'school_vision', 'school_mission', 'school_background', 'school_type',
      'school_levels_offered',
      'school_location', 'school_address', 'school_post_office_address',
      'school_digital_address', 'school_email', 'school_phone_1', 'school_phone_2',
      'school_website',
      'school_organisation', 'school_company_reg_no', 'school_ges_reg_no',
      'school_tin_number', 'school_ssnit_employer_no',
    ];
    for (const k of KEYS) {
      if (data[k] !== undefined) await window.api.settings.set(k, data[k]);
    }
    await loadSettings();
    setSaving(false);
    showToast('School identity saved');
  }

  async function uploadLogo() {
    const res = await window.api.app.showOpenDialog({
      title: 'Select school logo',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }],
      properties: ['openFile'],
    });
    if (res.canceled || res.filePaths.length === 0) return;
    const out = await window.api.settings.uploadLogo(res.filePaths[0]);
    if (out.ok) {
      setLogoSrc(`file://${out.path}?t=${Date.now()}`);
      await loadSettings();
      showToast('Logo updated');
    }
  }

  return (
    <div>
      <div className="card mb-4">
        <h3 className="card-title">School logo</h3>
        <div className="row gap-4" style={{ alignItems: 'center' }}>
          {logoSrc ? (
            <img src={logoSrc} alt="logo" style={{ height: 100, border: '1px solid var(--border)', borderRadius: 8, padding: 8 }} />
          ) : (
            <div style={{ height: 100, width: 100, border: '2px dashed var(--border)', borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
              No logo
            </div>
          )}
          <div>
            <button className="btn btn-primary" onClick={uploadLogo}>Upload new logo</button>
            <div className="helper mt-2">Used in headers, bills, receipts, and report cards.</div>
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <h3 className="card-title">Identity</h3>
        <Field label="Full school name">
          <input className="input" value={data.school_name || ''} onChange={e => set('school_name', e.target.value)} />
        </Field>
        <div className="form-row">
          <Field label="Short name (display)">
            <input className="input" value={data.school_short_name || ''} onChange={e => set('school_short_name', e.target.value)} />
          </Field>
          <Field label="Abbreviation (used in Student IDs)">
            <input className="input" value={data.school_abbreviation || ''} onChange={e => set('school_abbreviation', e.target.value.toUpperCase())} />
            <div className="helper">e.g. "AVE" → AVE/26/00228</div>
          </Field>
        </div>
        <Field label="Motto">
          <input className="input" value={data.school_motto || ''} onChange={e => set('school_motto', e.target.value)} />
        </Field>
        <Field label="Vision">
          <textarea className="textarea" rows="3" value={data.school_vision || ''} onChange={e => set('school_vision', e.target.value)}></textarea>
        </Field>
        <Field label="Mission">
          <textarea className="textarea" rows="3" value={data.school_mission || ''} onChange={e => set('school_mission', e.target.value)}></textarea>
        </Field>
        <Field label="Background / History">
          <textarea className="textarea" rows="4" value={data.school_background || ''} onChange={e => set('school_background', e.target.value)}></textarea>
        </Field>
        <div className="form-row">
          <Field label="School type">
            <input className="input" value={data.school_type || ''}
              placeholder="e.g. Basic School, JHS, SHS"
              onChange={e => set('school_type', e.target.value)} />
          </Field>
          <Field label="Levels offered">
            <input className="input" value={data.school_levels_offered || ''}
              placeholder="e.g. Nursery,Kindergarten,Basic,JHS"
              onChange={e => set('school_levels_offered', e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="card mb-4">
        <h3 className="card-title">Location & contact</h3>
        <Field label="Location">
          <input className="input" value={data.school_location || ''} onChange={e => set('school_location', e.target.value)} />
        </Field>
        <Field label="Full postal address">
          <input className="input" value={data.school_address || ''} onChange={e => set('school_address', e.target.value)} />
        </Field>
        <div className="form-row">
          <Field label="Post Office address">
            <input className="input" value={data.school_post_office_address || ''} onChange={e => set('school_post_office_address', e.target.value)} />
          </Field>
          <Field label="Digital (GPS) address">
            <input className="input" value={data.school_digital_address || ''} onChange={e => set('school_digital_address', e.target.value)} />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Email">
            <input className="input" value={data.school_email || ''} onChange={e => set('school_email', e.target.value)} />
          </Field>
          <Field label="Website">
            <input className="input" value={data.school_website || ''} onChange={e => set('school_website', e.target.value)} />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Phone 1">
            <input className="input" value={data.school_phone_1 || ''} onChange={e => set('school_phone_1', e.target.value)} />
          </Field>
          <Field label="Phone 2">
            <input className="input" value={data.school_phone_2 || ''} onChange={e => set('school_phone_2', e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="card mb-4">
        <h3 className="card-title">Organisation & registration</h3>
        <Field label="Owning organisation">
          <input className="input" value={data.school_organisation || ''} onChange={e => set('school_organisation', e.target.value)} />
          <div className="helper">e.g. Catholic Diocese of Goaso, GES, private board, etc.</div>
        </Field>
        <div className="form-row">
          <Field label="Companies Registration No">
            <input className="input" value={data.school_company_reg_no || ''} onChange={e => set('school_company_reg_no', e.target.value)} />
          </Field>
          <Field label="GES Registration No">
            <input className="input" value={data.school_ges_reg_no || ''} onChange={e => set('school_ges_reg_no', e.target.value)} />
          </Field>
        </div>
        <div className="form-row">
          <Field label="TIN number">
            <input className="input" value={data.school_tin_number || ''} onChange={e => set('school_tin_number', e.target.value)} />
          </Field>
          <Field label="SSNIT Employer number">
            <input className="input" value={data.school_ssnit_employer_no || ''} onChange={e => set('school_ssnit_employer_no', e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={saveAll} disabled={saving}>
          {saving ? 'Saving…' : 'Save all changes'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <div className="form-group"><label className="label">{label}</label>{children}</div>;
}
