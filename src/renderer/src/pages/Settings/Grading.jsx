import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

export default function Grading() {
  const showToast = useStore(s => s.showToast);
  const [bands, setBands] = useState([]);

  async function refresh() {
    setBands(await window.api.settings.listGradingBands());
  }
  useEffect(() => { refresh(); }, []);

  function setBand(i, field, value) {
    const next = bands.map((b, idx) => idx === i ? { ...b, [field]: value } : b);
    setBands(next);
  }
  function addBand() {
    setBands([...bands, { min_score: 0, max_score: 0, remark: '', display_order: bands.length + 1 }]);
  }
  function removeBand(i) {
    setBands(bands.filter((_, idx) => idx !== i));
  }
  async function save() {
    const cleaned = bands.map((b, i) => ({
      min_score: parseFloat(b.min_score),
      max_score: parseFloat(b.max_score),
      remark: b.remark,
      display_order: i + 1,
    }));
    await window.api.settings.saveGradingBands(cleaned);
    showToast('Grading scale saved');
    refresh();
  }

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Grading bands</div>
          <div className="card-subtitle">Configure remarks for score ranges</div>
        </div>
        <div className="row gap-2">
          <button className="btn btn-outline" onClick={addBand}>+ Add band</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
      <table className="table">
        <thead><tr><th className="text-right">Min %</th><th className="text-right">Max %</th><th>Remark</th><th></th></tr></thead>
        <tbody>
          {bands.map((b, i) => (
            <tr key={i}>
              <td><input className="input text-right" type="number" step="0.01" value={b.min_score ?? ''}
                onChange={e => setBand(i, 'min_score', e.target.value)} /></td>
              <td><input className="input text-right" type="number" step="0.01" value={b.max_score ?? ''}
                onChange={e => setBand(i, 'max_score', e.target.value)} /></td>
              <td><input className="input" value={b.remark ?? ''} onChange={e => setBand(i, 'remark', e.target.value)} /></td>
              <td><button className="btn btn-ghost btn-sm" onClick={() => removeBand(i)}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
