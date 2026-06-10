import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/index.js';

// Branding & appearance: configurable colour palette, font, foreground mode.
// Changes here apply instantly to the whole app and are persisted to settings.
export default function Branding() {
  const theme = useStore(s => s.theme);
  const updateTheme = useStore(s => s.updateTheme);
  const showToast = useStore(s => s.showToast);

  const [local, setLocal] = useState(theme);
  useEffect(() => { setLocal(theme); }, [theme]);

  function applyLive(patch) {
    updateTheme(patch);
  }

  async function reset() {
    await updateTheme({
      primary: '#1B3A6B',
      accent: '#C9961A',
      background: '#FFFFFF',
      foreground: '#0F172A',
      fgMode: 'dark',
      fontFamily: 'Inter',
      fontSize: 14,
    });
    showToast('Reset to default theme');
  }

  return (
    <div>
      <div className="card mb-4">
        <h3 className="card-title">School colours</h3>
        <p className="text-muted text-sm mb-4">Combine your school's colours with a white background.</p>

        <div className="form-row">
          <ColorField label="Primary colour" value={local.primary ?? ''}
            onChange={v => applyLive({ primary: v })} />
          <ColorField label="Accent colour" value={local.accent ?? ''}
            onChange={v => applyLive({ accent: v })} />
        </div>
        <div className="form-row">
          <ColorField label="Background colour" value={local.background ?? ''}
            onChange={v => applyLive({ background: v })} />
          <ColorField label="Foreground (text) colour" value={local.foreground ?? ''}
            onChange={v => applyLive({ foreground: v })} />
        </div>

        <div className="form-group">
          <label className="label">Foreground mode</label>
          <div className="row gap-3">
            <label className="row gap-2">
              <input type="radio" checked={local.fgMode === 'dark'} onChange={() => applyLive({ fgMode: 'dark' })} />
              <span>Dark text (on light background)</span>
            </label>
            <label className="row gap-2">
              <input type="radio" checked={local.fgMode === 'light'} onChange={() => applyLive({ fgMode: 'light' })} />
              <span>White text (on dark surfaces)</span>
            </label>
          </div>
          <div className="helper">Use white text only if you also change background colour to dark.</div>
        </div>
      </div>

      <div className="card mb-4">
        <h3 className="card-title">Typography</h3>

        <div className="form-row">
          <div className="form-group">
            <label className="label">Font family</label>
            <select className="select" value={local.fontFamily ?? ''}
              onChange={e => applyLive({ fontFamily: e.target.value })}>
              <option value="Inter">Inter (default)</option>
              <option value="Roboto">Roboto</option>
              <option value="Open Sans">Open Sans</option>
              <option value="Lato">Lato</option>
              <option value="Poppins">Poppins</option>
              <option value="Source Sans 3">Source Sans 3</option>
            </select>
          </div>
          <div className="form-group">
            <label className="label">Base font size: {local.fontSize}px</label>
            <input type="range" min="12" max="18" step="1" value={local.fontSize ?? ''}
              onChange={e => applyLive({ fontSize: parseInt(e.target.value) })}
              style={{ width: '100%' }} />
          </div>
        </div>

        <div className="card" style={{ background: 'var(--surface-2)' }}>
          <div className="text-muted text-sm mb-2">Preview:</div>
          <h2 style={{ margin: 0, color: 'var(--primary)' }}>School Management System</h2>
          <p>This is a preview of how text will appear across the app. Adjust the font and size above to find what works best.</p>
          <div className="row gap-2 mt-2">
            <button className="btn btn-primary">Primary action</button>
            <button className="btn btn-accent">Accent action</button>
            <button className="btn btn-outline">Outline</button>
          </div>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-outline" onClick={reset}>Reset to defaults</button>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }) {
  return (
    <div className="form-group">
      <label className="label">{label}</label>
      <div className="row gap-2">
        <input type="color" value={value} onChange={e => onChange(e.target.value)}
          style={{ width: 48, height: 38, border: '1px solid var(--border)', borderRadius: 6, padding: 2 }} />
        <input className="input" value={value} onChange={e => onChange(e.target.value)} style={{ flex: 1 }} />
      </div>
    </div>
  );
}
