import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

export default function Backup() {
  const showToast = useStore(s => s.showToast);
  const [paths, setPaths] = useState(null);
  useEffect(() => {
    (async () => setPaths(await window.api.app.getPaths()))();
  }, []);

  async function openFolder() {
    if (paths) await window.api.app.openFolder(paths.userData);
  }

  return (
    <div className="card">
      <h3 className="card-title">Backup & data location</h3>
      <p className="text-muted text-sm mb-3">
        All school data is stored on this PC in a SQLite database file.
        Back this folder up to Google Drive, Dropbox, or an external drive regularly.
      </p>
      {paths && (
        <>
          <div className="form-group">
            <label className="label">Database & uploads folder</label>
            <input className="input" value={paths.userData ?? ''} readOnly />
          </div>
          <button className="btn btn-primary" onClick={openFolder}>📂 Open folder</button>
        </>
      )}
      <div className="mt-4 card" style={{ background: 'var(--surface-2)' }}>
        <h4 style={{ marginTop: 0, fontSize: 14 }}>Recommended backup routine</h4>
        <ul style={{ paddingLeft: 20, fontSize: 13, lineHeight: 1.8, margin: 0 }}>
          <li>Daily: automatic Google Drive sync of the data folder</li>
          <li>Weekly: copy the data folder to an external USB drive</li>
          <li>Monthly: export students and finance to Excel for offline records</li>
        </ul>
      </div>
    </div>
  );
}
