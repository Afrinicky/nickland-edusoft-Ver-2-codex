import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

export default function PayrollSettings() {
  const settings = useStore(s => s.settings);
  const loadSettings = useStore(s => s.loadSettings);
  const showToast = useStore(s => s.showToast);
  const [ssnitW, setSsnitW] = useState('5.5');
  const [ssnitE, setSsnitE] = useState('13.0');

  useEffect(() => {
    if (settings.payroll) {
      setSsnitW(settings.payroll.ssnit_worker_pct || '5.5');
      setSsnitE(settings.payroll.ssnit_employer_pct || '13.0');
    }
  }, [settings]);

  async function save() {
    await window.api.settings.set('ssnit_worker_pct', ssnitW);
    await window.api.settings.set('ssnit_employer_pct', ssnitE);
    await loadSettings();
    showToast('Payroll settings saved');
  }

  return (
    <div className="card">
      <h3 className="card-title">SSNIT rates</h3>
      <div className="form-row">
        <div className="form-group">
          <label className="label">Worker contribution %</label>
          <input className="input" type="number" step="0.01" value={ssnitW} onChange={e => setSsnitW(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="label">Employer contribution %</label>
          <input className="input" type="number" step="0.01" value={ssnitE} onChange={e => setSsnitE(e.target.value)} />
        </div>
      </div>
      <button className="btn btn-primary" onClick={save}>Save</button>
    </div>
  );
}
