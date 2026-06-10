import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

export default function CanteenSettings() {
  const settings = useStore(s => s.settings);
  const loadSettings = useStore(s => s.loadSettings);
  const showToast = useStore(s => s.showToast);
  const [dailyRate, setDailyRate] = useState('5.00');

  useEffect(() => {
    if (settings.canteen) {
      setDailyRate(settings.canteen.canteen_daily_rate || '5.00');
    }
  }, [settings]);

  async function save() {
    await window.api.settings.set('canteen_daily_rate', dailyRate);
    await loadSettings();
    showToast('Canteen settings saved');
  }

  return (
    <div className="card">
      <h3 className="card-title">Canteen</h3>
      <p className="text-muted text-sm mb-3">Used to compute how many school days a payment covers.</p>
      <div className="form-group">
        <label className="label">Daily rate (GHS)</label>
        <input className="input" type="number" step="0.01" value={dailyRate}
          onChange={e => setDailyRate(e.target.value)} style={{ maxWidth: 200 }} />
        <div className="helper">e.g. GHS 5.00 per school day. GHS 65 paid = 13 days covered.</div>
      </div>
      <button className="btn btn-primary" onClick={save}>Save</button>
    </div>
  );
}
