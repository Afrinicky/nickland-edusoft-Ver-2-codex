import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function Backup() {
  const showToast = useStore(s => s.showToast);
  const can = useStore(s => s.can);
  const currentUser = useStore(s => s.currentUser);

  // Full-access roles only (backend enforces this too).
  const fullAccess = can('settings', 'edit') ||
    ['Proprietor', 'Administrator'].includes(currentUser?.designation);

  const [paths, setPaths] = useState(null);
  const [info, setInfo] = useState(null);
  const [backups, setBackups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');
  const [resetText, setResetText] = useState('');
  const [cfg, setCfg] = useState(null);

  async function loadInfo() {
    try {
      setPaths(await window.api.app.getPaths());
      const i = await window.api.backup.getInfo();
      if (i?.ok) setInfo(i);
      const list = await window.api.backup.list();
      if (list?.ok) setBackups(list.backups || []);
      const c = await window.api.backup.getConfig();
      if (c?.ok) setCfg(c.config);
    } catch (e) { /* ignore */ }
  }

  useEffect(() => { loadInfo(); }, []);

  async function saveCfg(patch) {
    setCfg(prev => ({ ...prev, ...patch }));
    const res = await window.api.backup.setConfig(patch);
    if (res?.ok) setCfg(res.config);
  }

  async function pickFolder(key) {
    const res = await window.api.backup.pickFolder();
    if (res?.ok) saveCfg({ [key]: res.folder });
  }

  async function runAutoNow() {
    setBusy(true);
    try {
      const res = await window.api.backup.runAuto();
      if (res?.ok) {
        const dests = (res.copies || []).filter(c => c.ok).length;
        showToast(`Backup done: ${res.fileName}${dests ? ` · copied to ${dests} destination(s)` : ''}`, 'success');
        await loadInfo();
      } else showToast(res?.error || 'Backup failed', 'error');
    } catch (e) { showToast('Backup failed: ' + (e.message || e), 'error'); }
    finally { setBusy(false); }
  }

  async function openDataFolder() {
    if (paths) await window.api.app.openFolder(paths.userData);
  }

  async function openBackupsFolder() {
    await window.api.backup.openFolder();
  }

  async function handleCreate() {
    setBusy(true);
    try {
      const res = await window.api.backup.create();
      if (res?.ok) {
        showToast(`Backup ZIP saved: ${res.fileName}`, 'success');
        await loadInfo();
      } else {
        showToast(res?.error || 'Backup failed', 'error');
      }
    } catch (e) {
      showToast('Backup failed: ' + (e.message || e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore() {
    if (!selected) { showToast('Choose a backup to restore first', 'warning'); return; }
    const chosen = backups.find(b => b.path === selected);
    const ok = window.confirm(
      `RESTORE WARNING\n\n` +
      `This will REPLACE all current data with the backup:\n${chosen?.fileName}\n\n` +
      `A safety backup of your current data will be created automatically first.\n` +
      `The app will restart after restoring.\n\nContinue?`
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await window.api.backup.restore(selected);
      if (res?.ok) {
        showToast(`Restore complete. Safety backup: ${res.safetyBackup}. Restarting…`, 'success');
      } else {
        showToast(res?.error || 'Restore failed', 'error');
        setBusy(false);
      }
    } catch (e) {
      showToast('Restore failed: ' + (e.message || e), 'error');
      setBusy(false);
    }
  }

  async function handleFactoryReset() {
    if (resetText !== 'RESET') {
      showToast('Type RESET in the box to enable factory reset', 'warning');
      return;
    }
    const ok = window.confirm(
      `FACTORY RESET — FINAL CONFIRMATION\n\n` +
      `This will erase ALL school data (students, staff, fees, scores, settings, ` +
      `uploaded files) and return the app to first-time setup.\n\n` +
      `A safety backup will be created automatically first, and your existing ` +
      `backups will NOT be deleted.\n\nThis cannot be undone. Continue?`
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await window.api.backup.factoryReset({ confirmText: 'RESET' });
      if (res?.ok) {
        showToast(`Factory reset done. Safety backup: ${res.safetyBackup}. Restarting…`, 'success');
      } else {
        showToast(res?.error || 'Factory reset failed', 'error');
        setBusy(false);
      }
    } catch (e) {
      showToast('Factory reset failed: ' + (e.message || e), 'error');
      setBusy(false);
    }
  }

  if (!fullAccess) {
    return (
      <div className="card">
        <h3 className="card-title">Backup & Recovery</h3>
        <p className="text-muted text-sm">
          Backup, restore and factory reset are restricted to Administrator / Proprietor accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="settings-stack" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Data location */}
      <div className="card">
        <h3 className="card-title">Backup & data location</h3>
        <p className="text-muted text-sm mb-3">
          All school data is stored on this PC in a SQLite database plus uploaded files
          (logo, signatures, photos, documents). Use the tools below to make safe backups.
        </p>
        {paths && (
          <div className="form-group">
            <label className="label">Database & uploads folder</label>
            <input className="input" value={paths.userData ?? ''} readOnly />
          </div>
        )}
        {info && (
          <div className="form-group">
            <label className="label">Backups folder</label>
            <input className="input" value={info.folder ?? ''} readOnly />
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={openDataFolder}>📂 Open data folder</button>
          <button className="btn btn-outline" onClick={openBackupsFolder}>🗂️ Open backups folder</button>
        </div>
      </div>

      {/* Create Backup */}
      <div className="card">
        <h3 className="card-title">Create Backup</h3>
        <p className="text-muted text-sm mb-3">
          Creates a <strong>Backup ZIP</strong> containing the database and all uploaded files,
          saved with a date &amp; time stamp in the backups folder.
        </p>
        <button className="btn btn-primary" onClick={handleCreate} disabled={busy}>
          {busy ? 'Working…' : '💾 Create Backup ZIP'}
        </button>
      </div>

      {/* Automated backups */}
      <div className="card">
        <div className="section-header">
          <h3 className="card-title">Automated backups</h3>
          <label className="row gap-2" style={{ alignItems: 'center' }}>
            <input type="checkbox" checked={cfg?.enabled || false} onChange={e => saveCfg({ enabled: e.target.checked })} />
            <span className="text-sm">{cfg?.enabled ? 'On' : 'Off'}</span>
          </label>
        </div>
        <p className="text-muted text-sm mb-3">
          Back up on a schedule to this PC and to extra destinations. A “cloud” backup is simply a
          folder your computer syncs to a drive of choice (Google Drive Desktop, OneDrive, Dropbox…) —
          point a destination there and your existing sync app uploads it. Manual backups are also copied
          to these destinations.
        </p>

        {cfg?.enabled && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label className="label">Frequency</label>
                <select className="select" value={cfg.frequency} onChange={e => saveCfg({ frequency: e.target.value })}>
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              {cfg.frequency !== 'hourly' && (
                <div className="form-group">
                  <label className="label">Time</label>
                  <input className="input" type="time" value={cfg.time} onChange={e => saveCfg({ time: e.target.value })} />
                </div>
              )}
              {cfg.frequency === 'weekly' && (
                <div className="form-group">
                  <label className="label">Day</label>
                  <select className="select" value={cfg.dayOfWeek} onChange={e => saveCfg({ dayOfWeek: parseInt(e.target.value, 10) })}>
                    {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label className="label">Keep newest</label>
                <input className="input" type="number" min="1" value={cfg.retention} onChange={e => saveCfg({ retention: parseInt(e.target.value, 10) || 1 })} />
              </div>
            </div>

            <div className="form-group">
              <label className="label">Extra local / LAN / network folder</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" value={cfg.folderPath || ''} onChange={e => saveCfg({ folderPath: e.target.value })} placeholder="e.g. \\\\server\\backups or D:\\Backups" />
                <button className="btn btn-outline" onClick={() => pickFolder('folderPath')}>Browse…</button>
              </div>
            </div>
            <div className="form-group">
              <label className="label">Cloud-sync folder (Google Drive / OneDrive / Dropbox)</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" value={cfg.cloudPath || ''} onChange={e => saveCfg({ cloudPath: e.target.value })} placeholder="e.g. C:\\Users\\you\\Google Drive\\School Backups" />
                <button className="btn btn-outline" onClick={() => pickFolder('cloudPath')}>Browse…</button>
              </div>
            </div>
            {cfg.lastAutoAt && <p className="text-xs text-muted">Last automatic backup: {new Date(cfg.lastAutoAt).toLocaleString()}</p>}
          </>
        )}
        <button className="btn btn-primary" onClick={runAutoNow} disabled={busy} style={{ marginTop: 8 }}>
          {busy ? 'Working…' : '☁️ Back up now to all destinations'}
        </button>
      </div>

      {/* Restore Backup */}
      <div className="card">
        <h3 className="card-title">Restore Previous Backup</h3>
        <p className="text-muted text-sm mb-3">
          Replaces current data with a previous backup. A safety backup of your current data
          is created automatically before restoring. The app restarts afterwards.
        </p>
        {backups.length === 0 ? (
          <p className="text-muted text-sm">No backups found yet. Create one above first.</p>
        ) : (
          <>
            <div className="form-group">
              <label className="label">Choose a backup</label>
              <select className="input" value={selected} onChange={e => setSelected(e.target.value)}>
                <option value="">— Select a backup —</option>
                {backups.map(b => (
                  <option key={b.path} value={b.path}>
                    {b.fileName} ({formatBytes(b.size)}) — {new Date(b.modified).toLocaleString()}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn btn-danger" onClick={handleRestore} disabled={busy || !selected}>
              ♻️ Restore Selected Backup
            </button>
          </>
        )}
      </div>

      {/* Factory Reset */}
      <div className="card" style={{ borderColor: 'var(--danger)' }}>
        <h3 className="card-title" style={{ color: 'var(--danger)' }}>Factory Reset</h3>
        <p className="text-muted text-sm mb-3">
          Erases ALL school data and returns the app to first-time setup. A safety backup is
          created automatically first, and existing backups are kept. This cannot be undone.
        </p>
        <div className="form-group">
          <label className="label">Type <strong>RESET</strong> to enable</label>
          <input
            className="input"
            value={resetText}
            onChange={e => setResetText(e.target.value)}
            placeholder="RESET"
            style={{ maxWidth: 220 }}
          />
        </div>
        <button
          className="btn btn-danger"
          onClick={handleFactoryReset}
          disabled={busy || resetText !== 'RESET'}
        >
          ⚠️ Factory Reset
        </button>
      </div>

    </div>
  );
}
