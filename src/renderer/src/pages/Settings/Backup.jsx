import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

// ── formatters ──────────────────────────────────────────────────────────────
function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}
function timeAgo(iso) {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
function whenPhrase(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((that - today) / 86400000);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (dayDiff === 0) return `today at ${time}`;
  if (dayDiff === 1) return `tomorrow at ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
}

const VERDICT = {
  good: { icon: '✓', color: 'var(--success)', title: 'Protected' },
  gap: { icon: '⚠', color: 'var(--warning)', title: 'Protected, with a gap' },
  'at-risk': { icon: '⚠', color: 'var(--danger)', title: 'At risk' },
};

function Indicator({ ok, label, sub }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flex: '1 1 180px', minWidth: 160 }}>
      <span style={{ color: ok ? 'var(--success)' : 'var(--warning)', fontSize: 16, lineHeight: '20px' }}>{ok ? '✓' : '⚠'}</span>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
        <div className="text-xs text-muted">{sub}</div>
      </div>
    </div>
  );
}

function OptionCard({ active, title, badge, children, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        textAlign: 'left', cursor: 'pointer', flex: '1 1 220px',
        border: `1.5px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
        background: active ? 'var(--primary-50)' : 'var(--surface-1)',
        borderRadius: 12, padding: 14,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontWeight: 700, color: active ? 'var(--primary)' : 'var(--text, inherit)' }}>{title}</span>
        {badge && <span className="badge" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>{badge}</span>}
      </div>
      <div className="text-xs text-muted">{children}</div>
    </button>
  );
}

export default function Backup() {
  const showToast = useStore(s => s.showToast);
  const can = useStore(s => s.can);
  const currentUser = useStore(s => s.currentUser);

  const fullAccess = can('settings', 'edit') ||
    ['Proprietor', 'Administrator'].includes(currentUser?.designation);

  const [paths, setPaths] = useState(null);
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState(null);
  const [backups, setBackups] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [dests, setDests] = useState([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);   // { id, label }
  const [resetText, setResetText] = useState('');
  const [showReset, setShowReset] = useState(false);

  async function loadAll() {
    try {
      setPaths(await window.api.app.getPaths());
      const [i, st, list, c, d] = await Promise.all([
        window.api.backup.getInfo(),
        window.api.backup.status(),
        window.api.backup.list(),
        window.api.backup.getConfig(),
        window.api.backup.listDestinations(),
      ]);
      if (i?.ok) setInfo(i);
      if (st?.ok) setStatus(st);
      if (list?.ok) setBackups(list.backups || []);
      if (c?.ok) setCfg(c.config);
      if (d?.ok) setDests(d.destinations || []);
    } catch (e) { /* ignore */ }
  }
  useEffect(() => { loadAll(); }, []);

  async function saveCfg(patch) {
    setCfg(prev => ({ ...prev, ...patch }));
    const res = await window.api.backup.setConfig(patch);
    if (res?.ok) { setCfg(res.config); loadAll(); }
  }

  async function backUpNow() {
    setBusy(true);
    try {
      const res = await window.api.backup.runAuto();
      if (res?.ok) {
        const okDests = (res.copies || []).filter(c => c.ok).length;
        showToast(`Backup done${okDests ? ` · copied to ${okDests} destination(s)` : ''}`, 'success');
        await loadAll();
      } else showToast(res?.error || 'Backup failed', 'error');
    } catch (e) { showToast('Backup failed: ' + (e.message || e), 'error'); }
    finally { setBusy(false); }
  }

  // ── destinations ──
  async function addDestination(kind) {
    const picked = await window.api.backup.pickFolder();
    if (!picked?.ok) return;
    const label = kind === 'network' ? 'Hospital / office server or shared folder' : 'Folder on this computer';
    const res = await window.api.backup.addDestination({ label, kind, path: picked.folder });
    if (res?.ok) { showToast('Destination added', 'success'); await loadAll(); }
    else showToast(res?.error || 'Could not add destination', 'error');
  }
  async function testDest(d) {
    const res = await window.api.backup.testDestination({ id: d.id });
    showToast(res?.ok ? `“${d.label}” is reachable and writable` : `Cannot reach “${d.label}”: ${res?.error || 'unreachable'}`,
      res?.ok ? 'success' : 'error');
    loadAll();
  }
  async function togglePause(d) {
    const res = await window.api.backup.updateDestination({ id: d.id, patch: { paused: !d.paused } });
    if (res?.ok) loadAll();
  }
  async function removeDest(d) {
    if (!window.confirm(`Stop copying backups to “${d.label}”?\n\n${d.path}\n\nBackups already there are left untouched.`)) return;
    const res = await window.api.backup.removeDestination(d.id);
    if (res?.ok) { showToast('Destination removed', 'success'); await loadAll(); }
  }
  async function saveEdit() {
    if (!editing) return;
    const res = await window.api.backup.updateDestination({ id: editing.id, patch: { label: editing.label } });
    setEditing(null);
    if (res?.ok) loadAll();
  }
  async function retryNow() {
    const res = await window.api.backup.retry();
    if (res?.ok) { showToast(res.delivered ? `Delivered ${res.delivered} waiting copy(ies)` : 'Nothing could be delivered yet', res.delivered ? 'success' : 'warning'); loadAll(); }
  }

  // ── primary folder ──
  async function changeFolder() {
    const picked = await window.api.backup.pickFolder();
    if (!picked?.ok) return;
    const res = await window.api.backup.setPrimaryFolder(picked.folder);
    if (res?.ok) { showToast('Backup folder changed', 'success'); await loadAll(); }
    else showToast(res?.error || 'Could not use that folder', 'error');
  }
  async function useDefaultFolder() {
    const res = await window.api.backup.setPrimaryFolder('');
    if (res?.ok) { showToast('Using the default backup folder', 'success'); await loadAll(); }
  }

  // ── restore ──
  async function restore(backupPath, name) {
    if (!window.confirm(
      `RESTORE\n\nThis replaces ALL current data with:\n${name}\n\n` +
      `A pre-restore snapshot of your current data is taken first, and the app restarts afterwards.\n\nContinue?`
    )) return;
    setBusy(true);
    try {
      const res = await window.api.backup.restore(backupPath);
      if (res?.ok) showToast(`Restore complete. Snapshot: ${res.safetyBackup}. Restarting…`, 'success');
      else { showToast(res?.error || 'Restore failed', 'error'); setBusy(false); }
    } catch (e) { showToast('Restore failed: ' + (e.message || e), 'error'); setBusy(false); }
  }
  async function restoreFromFile() {
    const picked = await window.api.backup.pickFile();
    if (!picked?.ok) return;
    await restore(picked.path, picked.path.split(/[\\/]/).pop());
  }
  async function saveCopy(backupPath) {
    const res = await window.api.backup.saveCopy(backupPath);
    if (res?.ok) showToast('Copy saved', 'success');
    else if (!res?.canceled) showToast(res?.error || 'Could not save a copy', 'error');
  }

  async function factoryReset() {
    if (resetText !== 'RESET') { showToast('Type RESET to enable factory reset', 'warning'); return; }
    if (!window.confirm(
      `FACTORY RESET — FINAL\n\nErases ALL data and returns to first-time setup. A pre-reset ` +
      `snapshot is taken first and existing backups are kept. This cannot be undone. Continue?`
    )) return;
    setBusy(true);
    try {
      const res = await window.api.backup.factoryReset({ confirmText: 'RESET' });
      if (res?.ok) showToast(`Factory reset done. Snapshot: ${res.safetyBackup}. Restarting…`, 'success');
      else { showToast(res?.error || 'Factory reset failed', 'error'); setBusy(false); }
    } catch (e) { showToast('Factory reset failed: ' + (e.message || e), 'error'); setBusy(false); }
  }

  if (!fullAccess) {
    return (
      <div className="card">
        <h3 className="card-title">Backup &amp; Restore</h3>
        <p className="text-muted text-sm">Backup, restore and factory reset are restricted to Administrator / Proprietor accounts.</p>
      </div>
    );
  }

  const v = VERDICT[status?.status?.verdict || 'gap'];
  const mode = cfg?.mode || 'manual';
  const waitingTotal = dests.reduce((n, d) => n + (d.waiting || 0), 0);

  return (
    <div className="settings-stack" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Hero status ── */}
      <div className="card">
        <h3 className="card-title">Backup &amp; Restore</h3>
        <p className="text-muted text-sm mb-3">
          A backup is the whole school in one file — the database and every uploaded file (logo,
          signatures, photos, documents). Take one on a schedule, keep a sensible number, and put a
          copy somewhere the building is not.
        </p>

        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap',
          border: `1px solid var(--border)`, borderLeft: `4px solid ${v.color}`, borderRadius: 12, padding: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--surface-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: v.color }}>{v.icon}</div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{v.title}</div>
            <div className="text-sm text-muted">
              Last backup {timeAgo(status?.lastBackupAt)}
              {status?.lastBackupSize ? ` · ${formatBytes(status.lastBackupSize)}` : ''}
              {status ? ` · ${status.keptHere} kept here (${formatBytes(status.totalHereBytes)})` : ''}
            </div>
          </div>
          <button className="btn btn-primary" onClick={backUpNow} disabled={busy}>
            {busy ? 'Working…' : '⬇ Back up now'}
          </button>
        </div>

        {status && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
            <Indicator ok={status.status.recent.ok} label="Recent copy" sub={timeAgo(status.status.recent.at)} />
            <Indicator ok={status.status.scheduled.ok} label="Runs on its own"
              sub={status.status.scheduled.ok ? `next ${whenPhrase(status.status.scheduled.nextAt)}` : 'off — set a schedule below'} />
            <Indicator ok={status.status.offsite.ok} label="Copy off site"
              sub={status.status.offsite.configured === 0 ? 'no destination yet'
                : status.status.offsite.failing ? `${status.status.offsite.failing} destination(s) failing`
                : `${status.status.offsite.active} destination(s) ok`} />
          </div>
        )}
      </div>

      {/* ── When backups happen ── */}
      <div className="card">
        <h3 className="card-title">Local backups on this computer</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <OptionCard active={mode === 'manual'} title="Manual only" onClick={() => saveCfg({ mode: 'manual' })}>
            A backup happens only when someone presses “Back up now”. Nothing runs on its own.
          </OptionCard>
          <OptionCard active={mode !== 'manual'} title="Automatic" badge="Recommended"
            onClick={() => saveCfg({ mode: mode === 'manual' ? 'nightly' : mode })}>
            The computer takes one on a schedule, whether or not anyone remembers.
          </OptionCard>
        </div>

        {mode !== 'manual' && (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <OptionCard active={mode === 'nightly'} title="Every night" onClick={() => saveCfg({ mode: 'nightly' })}>
                One backup overnight. Losing at most a day of records is the right trade for most schools.
              </OptionCard>
              <OptionCard active={mode === 'twice'} title="Twice a day" onClick={() => saveCfg({ mode: 'twice' })}>
                A midday copy as well, for a busy office where half a day of lost work would hurt.
              </OptionCard>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="label">{mode === 'twice' ? 'Morning time' : 'Time each night'}</label>
                <input className="input" type="time" value={cfg?.time || '02:00'}
                  onChange={e => saveCfg({ time: e.target.value })} />
              </div>
              {mode === 'twice' && (
                <div className="form-group">
                  <label className="label">Afternoon time</label>
                  <input className="input" type="time" value={cfg?.time2 || '14:00'}
                    onChange={e => saveCfg({ time2: e.target.value })} />
                </div>
              )}
              <div className="form-group">
                <label className="label">Keep newest</label>
                <input className="input" type="number" min="1" value={cfg?.retention || 10}
                  onChange={e => saveCfg({ retention: parseInt(e.target.value, 10) || 1 })} />
              </div>
            </div>
            <p className="text-xs text-muted">
              Older automatic backups beyond that number are removed here (and at each destination). Manual
              backups and pre-restore snapshots are always kept.
            </p>
          </>
        )}
      </div>

      {/* ── Where backups are kept ── */}
      <div className="card">
        <h3 className="card-title">Where backups are kept</h3>
        <p className="text-muted text-sm mb-3">The first copy of every backup is written here.</p>
        <div className="form-group">
          <input className="input" value={info?.folder || ''} readOnly />
        </div>
        <div className="text-xs" style={{ marginBottom: 10, color: info?.reachable === false ? 'var(--danger)' : 'var(--muted)' }}>
          {info?.isDefault ? 'Default location on this computer.'
            : info?.reachable === false ? 'That folder cannot be reached right now — backups fall back to the default location until it returns.'
            : 'Custom location.'}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={changeFolder}>📁 Change folder</button>
          {!info?.isDefault && <button className="btn btn-ghost" onClick={useDefaultFolder}>Use default</button>}
          <button className="btn btn-ghost" onClick={() => window.api.backup.openFolder()}>🗂️ Open folder</button>
        </div>
      </div>

      {/* ── Where copies go (destinations) ── */}
      <div className="card">
        <div className="section-header">
          <h3 className="card-title">Where copies go</h3>
          {waitingTotal > 0 && (
            <button className="btn btn-sm btn-outline" onClick={retryNow}>↻ Retry {waitingTotal} waiting</button>
          )}
        </div>
        <p className="text-muted text-sm mb-3">
          Every backup is copied here as well as kept locally — a shared folder on the network, a second
          disk, a USB drive, or a folder a cloud client (Google Drive, OneDrive, Dropbox) syncs. A copy
          that cannot be delivered is remembered and retried, never lost.
        </p>

        {dests.length === 0 && <p className="text-muted text-sm">No destinations yet — backups are only on this computer. Add one below.</p>}

        {dests.map(d => {
          const dot = d.paused ? 'var(--muted)' : d.lastError ? 'var(--danger)' : 'var(--success)';
          return (
            <div key={d.id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot, flex: '0 0 auto' }} />
                <div style={{ flex: 1, minWidth: 180 }}>
                  {editing?.id === d.id ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input className="input" value={editing.label} onChange={e => setEditing({ ...editing, label: e.target.value })} style={{ maxWidth: 320 }} />
                      <button className="btn btn-sm btn-primary" onClick={saveEdit}>Save</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontWeight: 600 }}>{d.label}{d.paused ? ' · paused' : ''}</div>
                      <div className="text-xs text-muted" style={{ fontFamily: 'monospace' }}>{d.path}</div>
                    </>
                  )}
                </div>
                {d.waiting > 0 && <span className="badge" style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}>{d.waiting} waiting</span>}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm btn-outline" onClick={() => testDest(d)}>Test</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditing({ id: d.id, label: d.label })}>Edit</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => togglePause(d)}>{d.paused ? 'Resume' : 'Pause'}</button>
                  <button className="btn btn-sm btn-danger" onClick={() => removeDest(d)}>Remove</button>
                </div>
              </div>
              {d.lastError && !d.paused && (
                <div className="text-xs" style={{ color: 'var(--danger)', marginLeft: 19, marginTop: 4 }}>
                  Last copy failed: {d.lastError}. It will be retried automatically.
                </div>
              )}
            </div>
          );
        })}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="btn btn-outline" onClick={() => addDestination('network')}>➕ Network / shared folder</button>
          <button className="btn btn-outline" onClick={() => addDestination('local')}>➕ Second disk or USB folder</button>
        </div>
      </div>

      {/* ── Restore ── */}
      <div className="card">
        <h3 className="card-title">Restore</h3>
        <p className="text-muted text-sm mb-3">
          Replaces current data with a previous backup. A pre-restore snapshot of your current data is
          taken first, so restoring the wrong file can itself be undone. The app restarts afterwards.
        </p>

        {backups.length === 0 ? (
          <p className="text-muted text-sm">No backups yet. Take one above first.</p>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            {backups.map((b, i) => (
              <div key={b.path} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                borderTop: i ? '1px solid var(--border)' : 'none', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {b.label}
                    <span className="text-xs text-muted" style={{ fontWeight: 400 }}> · {formatBytes(b.size)} · {new Date(b.modified).toLocaleString()}</span>
                  </div>
                  <div className="text-xs text-muted" style={{ fontFamily: 'monospace' }}>{b.fileName}</div>
                </div>
                <button className="btn btn-sm btn-ghost" onClick={() => saveCopy(b.path)}>Save a copy</button>
                <button className="btn btn-sm btn-danger" onClick={() => restore(b.path, b.fileName)} disabled={busy}>Restore</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--border)' }}>
          <h4 style={{ margin: '0 0 6px', fontSize: 14 }}>Restore from a file</h4>
          <p className="text-muted text-xs mb-2">
            For a backup kept off this computer — one you saved to a USB drive, the network, or wherever
            else copies are sent.
          </p>
          <button className="btn btn-outline" onClick={restoreFromFile} disabled={busy}>📂 Choose a backup file…</button>
        </div>
      </div>

      {/* ── Factory reset ── */}
      <div className="card">
        <div className="section-header">
          <h3 className="card-title" style={{ color: 'var(--danger)' }}>Factory reset</h3>
          <button className="btn btn-sm btn-ghost" onClick={() => setShowReset(v => !v)}>{showReset ? 'Hide' : 'Show'}</button>
        </div>
        <p className="text-muted text-sm">Erase everything and return to first-time setup. Kept out of the way on purpose.</p>
        {showReset && (
          <div style={{ marginTop: 12 }}>
            <p className="text-muted text-sm mb-3">
              A pre-reset snapshot is taken first and your existing backups are kept. This cannot be undone.
            </p>
            <div className="form-group">
              <label className="label">Type <strong>RESET</strong> to enable</label>
              <input className="input" value={resetText} onChange={e => setResetText(e.target.value)} placeholder="RESET" style={{ maxWidth: 220 }} />
            </div>
            <button className="btn btn-danger" onClick={factoryReset} disabled={busy || resetText !== 'RESET'}>⚠️ Factory reset</button>
          </div>
        )}
      </div>

    </div>
  );
}
