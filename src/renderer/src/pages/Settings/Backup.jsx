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
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60); if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60); if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24); return `${days} day${days === 1 ? '' : 's'} ago`;
}
function whenPhrase(iso) {
  if (!iso) return '';
  const d = new Date(iso), today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const dd = Math.round((that - today) / 86400000);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (dd === 0) return `today at ${time}`;
  if (dd === 1) return `tomorrow at ${time}`;
  if (dd > 1 && dd < 7) return `${d.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
  return `${d.toLocaleDateString()} at ${time}`;
}

const VERDICT = {
  good: { icon: '✓', color: 'var(--success)', title: 'Protected' },
  gap: { icon: '⚠', color: 'var(--warning)', title: 'Protected, with a gap' },
  'at-risk': { icon: '⚠', color: 'var(--danger)', title: 'At risk' },
};
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The "Add somewhere" gallery — matches what the SECH_LIMS reference offers.
const DEST_TYPES = [
  { type: 'network', title: 'Server or shared folder', tag: 'On your network',
    blurb: 'The simplest way off this computer. Point it at a shared folder on the office server. Nothing to buy, nothing to install, and it keeps working when the internet does not.',
    works: 'Windows shared folders, Samba, a mapped drive, any NAS with file sharing.' },
  { type: 'local', title: 'Another folder on this computer', tag: 'Same machine',
    blurb: 'A second disk, or a USB drive left plugged in. Protects against the system disk failing — worth having as well as an off-site copy, not instead of one.',
    works: 'Any folder you can browse to on this PC.' },
  { type: 's3', title: 'S3 storage', tag: 'Your server, or cloud',
    blurb: 'One setting reaches a great many providers, because they all speak the same protocol. Run MinIO on hardware you own for nothing, or use Backblaze B2 / Wasabi for a few dollars a month.',
    works: 'MinIO, Backblaze B2, Wasabi, Cloudflare R2, AWS S3, DigitalOcean Spaces, Synology, QNAP.' },
  { type: 'webdav', title: 'Nextcloud, ownCloud or a NAS', tag: 'WebDAV',
    blurb: 'If the office already runs Nextcloud, or the NAS has WebDAV switched on, this needs nothing more than a username and password.',
    works: 'Nextcloud, ownCloud, Synology, QNAP, Koofr, and most NAS boxes.' },
  { type: 'gdrive', title: 'Google Drive', tag: 'Needs internet',
    blurb: 'A Drive folder via a service account, because this computer runs unattended and cannot complete a sign-in prompt. Free for the first 15 GB.',
    works: 'A Google account with the Drive API enabled and a service-account key.' },
];

function Indicator({ ok, label, sub }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flex: '1 1 180px', minWidth: 160 }}>
      <span style={{ color: ok ? 'var(--success)' : 'var(--warning)', fontSize: 16, lineHeight: '20px' }}>{ok ? '✓' : '⚠'}</span>
      <div><div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div><div className="text-xs text-muted">{sub}</div></div>
    </div>
  );
}
function Chip({ active, children, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{ cursor: 'pointer', padding: '7px 13px', borderRadius: 999, fontWeight: 600, fontSize: 13,
        border: `1.5px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
        background: active ? 'var(--primary)' : 'var(--surface-1)', color: active ? '#fff' : 'inherit' }}>
      {children}
    </button>
  );
}

export default function Backup() {
  const showToast = useStore(s => s.showToast);
  const can = useStore(s => s.can);
  const currentUser = useStore(s => s.currentUser);
  const fullAccess = can('settings', 'edit') || ['Proprietor', 'Administrator'].includes(currentUser?.designation);

  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState(null);
  const [backups, setBackups] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [dests, setDests] = useState([]);
  const [encAvailable, setEncAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);    // inline label edit { id, label }
  const [adding, setAdding] = useState(null);       // add/edit form { mode:'add'|'edit', id?, type, label, path, config, error, verifying }
  const [resetText, setResetText] = useState('');
  const [showReset, setShowReset] = useState(false);

  async function loadAll() {
    try {
      const [i, st, list, c, d] = await Promise.all([
        window.api.backup.getInfo(), window.api.backup.status(), window.api.backup.list(),
        window.api.backup.getConfig(), window.api.backup.listDestinations(),
      ]);
      if (i?.ok) setInfo(i);
      if (st?.ok) setStatus(st);
      if (list?.ok) setBackups(list.backups || []);
      if (c?.ok) setCfg(c.config);
      if (d?.ok) { setDests(d.destinations || []); setEncAvailable(d.encryptionAvailable !== false); }
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

  // ── add / edit destination form ──
  function openAdd(type) {
    setAdding({ mode: 'add', type, label: '', path: '', config: {}, error: null, verifying: false });
  }
  function openEditConnection(d) {
    // Pre-fill non-secret fields; secrets stay blank ("keep what is stored").
    setAdding({ mode: 'edit', id: d.id, type: d.type, label: d.label, path: d.path || '', config: { ...(d.config || {}) }, error: null, verifying: false });
  }
  async function browseInto() {
    const r = await window.api.backup.pickFolder();
    if (r?.ok) setAdding(a => ({ ...a, path: r.folder }));
  }
  function setField(k, v) { setAdding(a => ({ ...a, [k]: v })); }
  function setCfgField(k, v) { setAdding(a => ({ ...a, config: { ...a.config, [k]: v } })); }

  async function submitAdd() {
    if (!adding) return;
    setAdding(a => ({ ...a, verifying: true, error: null }));
    try {
      let res;
      if (adding.mode === 'edit') {
        res = await window.api.backup.updateDestination({ id: adding.id, patch: { label: adding.label, path: adding.path, config: adding.config } });
      } else {
        res = await window.api.backup.addDestination({ label: adding.label, type: adding.type, path: adding.path, config: adding.config });
      }
      if (res?.ok) { showToast(adding.mode === 'edit' ? 'Destination updated' : 'Destination added and verified', 'success'); setAdding(null); await loadAll(); }
      else setAdding(a => ({ ...a, verifying: false, error: res?.error || 'Could not verify this destination.' }));
    } catch (e) { setAdding(a => ({ ...a, verifying: false, error: e.message || String(e) })); }
  }

  async function testDest(d) {
    const res = await window.api.backup.testDestination({ id: d.id });
    showToast(res?.ok ? `“${d.label}” is reachable` : `Cannot reach “${d.label}”: ${res?.error || 'unreachable'}`, res?.ok ? 'success' : 'error');
    loadAll();
  }
  async function togglePause(d) { const r = await window.api.backup.updateDestination({ id: d.id, patch: { paused: !d.paused } }); if (r?.ok) loadAll(); }
  async function removeDest(d) {
    if (!window.confirm(`Stop copying backups to “${d.label}”?\n\nBackups already there are left untouched.`)) return;
    const r = await window.api.backup.removeDestination(d.id); if (r?.ok) { showToast('Destination removed', 'success'); await loadAll(); }
  }
  async function saveLabel() { if (!editing) return; const r = await window.api.backup.updateDestination({ id: editing.id, patch: { label: editing.label } }); setEditing(null); if (r?.ok) loadAll(); }
  async function retryNow() { const r = await window.api.backup.retry(); if (r?.ok) { showToast(r.delivered ? `Delivered ${r.delivered} waiting copy(ies)` : 'Nothing could be delivered yet', r.delivered ? 'success' : 'warning'); loadAll(); } }

  async function changeFolder() { const r = await window.api.backup.pickFolder(); if (!r?.ok) return; const s = await window.api.backup.setPrimaryFolder(r.folder); if (s?.ok) { showToast('Backup folder changed', 'success'); await loadAll(); } else showToast(s?.error || 'Could not use that folder', 'error'); }
  async function useDefaultFolder() { const s = await window.api.backup.setPrimaryFolder(''); if (s?.ok) { showToast('Using the default backup folder', 'success'); await loadAll(); } }

  async function restore(backupPath, name) {
    if (!window.confirm(`RESTORE\n\nThis replaces ALL current data with:\n${name}\n\nA pre-restore snapshot is taken first, and the app restarts afterwards.\n\nContinue?`)) return;
    setBusy(true);
    try { const res = await window.api.backup.restore(backupPath);
      if (res?.ok) showToast(`Restore complete. Snapshot: ${res.safetyBackup}. Restarting…`, 'success');
      else { showToast(res?.error || 'Restore failed', 'error'); setBusy(false); }
    } catch (e) { showToast('Restore failed: ' + (e.message || e), 'error'); setBusy(false); }
  }
  async function restoreFromFile() { const r = await window.api.backup.pickFile(); if (r?.ok) await restore(r.path, r.path.split(/[\\/]/).pop()); }
  async function saveCopy(bp) { const r = await window.api.backup.saveCopy(bp); if (r?.ok) showToast('Copy saved', 'success'); else if (!r?.canceled) showToast(r?.error || 'Could not save a copy', 'error'); }

  async function factoryReset() {
    if (resetText !== 'RESET') { showToast('Type RESET to enable factory reset', 'warning'); return; }
    if (!window.confirm(`FACTORY RESET — FINAL\n\nErases ALL data and returns to first-time setup. A pre-reset snapshot is taken first and existing backups are kept. This cannot be undone. Continue?`)) return;
    setBusy(true);
    try { const res = await window.api.backup.factoryReset({ confirmText: 'RESET' });
      if (res?.ok) showToast(`Factory reset done. Snapshot: ${res.safetyBackup}. Restarting…`, 'success');
      else { showToast(res?.error || 'Factory reset failed', 'error'); setBusy(false); }
    } catch (e) { showToast('Factory reset failed: ' + (e.message || e), 'error'); setBusy(false); }
  }

  if (!fullAccess) {
    return (<div className="card"><h3 className="card-title">Backup &amp; Restore</h3>
      <p className="text-muted text-sm">Backup, restore and factory reset are restricted to Administrator / Proprietor accounts.</p></div>);
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
          A backup is the whole school in one file — the database and every uploaded file. Take one on a
          schedule, keep a sensible number, and put a copy somewhere the building is not.
        </p>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap',
          border: `1px solid var(--border)`, borderLeft: `4px solid ${v.color}`, borderRadius: 12, padding: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: v.color }}>{v.icon}</div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{v.title}</div>
            <div className="text-sm text-muted">
              Last backup {timeAgo(status?.lastBackupAt)}
              {status?.lastBackupSize ? ` · ${formatBytes(status.lastBackupSize)}` : ''}
              {status ? ` · ${status.keptHere} kept here (${formatBytes(status.totalHereBytes)})` : ''}
            </div>
          </div>
          <button className="btn btn-primary" onClick={backUpNow} disabled={busy}>{busy ? 'Working…' : '⬇ Back up now'}</button>
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
        <h3 className="card-title">When backups happen</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <Chip active={mode === 'manual'} onClick={() => saveCfg({ mode: 'manual' })}>Manual only</Chip>
          <Chip active={mode === 'nightly'} onClick={() => saveCfg({ mode: 'nightly' })}>Once a day</Chip>
          <Chip active={mode === 'twice'} onClick={() => saveCfg({ mode: 'twice' })}>Twice a day</Chip>
          <Chip active={mode === 'weekly'} onClick={() => saveCfg({ mode: 'weekly' })}>Weekly</Chip>
          <Chip active={mode === 'monthly'} onClick={() => saveCfg({ mode: 'monthly' })}>Monthly</Chip>
          <Chip active={mode === 'custom' || mode === 'hourly'} onClick={() => saveCfg({ mode: 'custom' })}>Custom</Chip>
        </div>

        {mode === 'manual' && <p className="text-muted text-sm">Backups happen only when someone presses “Back up now”. Nothing runs on its own.</p>}

        {mode !== 'manual' && (
          <div className="form-row">
            {(mode === 'nightly' || mode === 'twice' || mode === 'weekly' || mode === 'monthly') && (
              <div className="form-group">
                <label className="label">{mode === 'twice' ? 'Morning time' : 'Time'}</label>
                <input className="input" type="time" value={cfg?.time || '02:00'} onChange={e => saveCfg({ time: e.target.value })} />
              </div>
            )}
            {mode === 'twice' && (
              <div className="form-group"><label className="label">Afternoon time</label>
                <input className="input" type="time" value={cfg?.time2 || '14:00'} onChange={e => saveCfg({ time2: e.target.value })} /></div>
            )}
            {mode === 'weekly' && (
              <div className="form-group"><label className="label">Day of week</label>
                <select className="select" value={cfg?.dayOfWeek ?? 0} onChange={e => saveCfg({ dayOfWeek: parseInt(e.target.value, 10) })}>
                  {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select></div>
            )}
            {mode === 'monthly' && (
              <div className="form-group"><label className="label">Day of month</label>
                <select className="select" value={cfg?.dayOfMonth ?? 1} onChange={e => saveCfg({ dayOfMonth: parseInt(e.target.value, 10) })}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
                </select></div>
            )}
            {(mode === 'custom' || mode === 'hourly') && (
              <>
                <div className="form-group"><label className="label">Every</label>
                  <input className="input" type="number" min="1" style={{ maxWidth: 90 }}
                    value={cfg?.everyN ?? 3} onChange={e => saveCfg({ mode: 'custom', everyN: parseInt(e.target.value, 10) || 1 })} /></div>
                <div className="form-group"><label className="label">&nbsp;</label>
                  <select className="select" value={cfg?.everyUnit || 'days'} onChange={e => saveCfg({ mode: 'custom', everyUnit: e.target.value })}>
                    <option value="hours">hours</option><option value="days">days</option>
                  </select></div>
                {(cfg?.everyUnit || 'days') === 'days' && (
                  <div className="form-group"><label className="label">At</label>
                    <input className="input" type="time" value={cfg?.time || '02:00'} onChange={e => saveCfg({ time: e.target.value })} /></div>
                )}
              </>
            )}
            <div className="form-group"><label className="label">Keep newest</label>
              <input className="input" type="number" min="1" style={{ maxWidth: 110 }} value={cfg?.retention || 10}
                onChange={e => saveCfg({ retention: parseInt(e.target.value, 10) || 1 })} /></div>
          </div>
        )}
        {mode !== 'manual' && status?.status?.scheduled?.nextAt && (
          <p className="text-xs text-muted">Next backup {whenPhrase(status.status.scheduled.nextAt)}. Older automatic backups beyond “keep newest” are removed; manual backups and snapshots are always kept.</p>
        )}
      </div>

      {/* ── Where backups are kept ── */}
      <div className="card">
        <h3 className="card-title">Where backups are kept</h3>
        <p className="text-muted text-sm mb-3">The first copy of every backup is written here.</p>
        <div className="form-group"><input className="input" value={info?.folder || ''} readOnly /></div>
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

      {/* ── Where copies go ── */}
      <div className="card">
        <div className="section-header">
          <h3 className="card-title">Where copies go</h3>
          {waitingTotal > 0 && <button className="btn btn-sm btn-outline" onClick={retryNow}>↻ Retry {waitingTotal} waiting</button>}
        </div>
        <p className="text-muted text-sm mb-3">
          Every backup is copied here as well as kept locally. A copy that cannot be delivered is remembered
          and retried, never lost.{!encAvailable && ' This computer has no secure keystore, so passwords and keys are stored in the clear — prefer a shared folder here.'}
        </p>

        {dests.length === 0 && <p className="text-muted text-sm">No destinations yet — backups are only on this computer. Add one below.</p>}

        {dests.map(d => {
          const dot = d.paused ? 'var(--muted)' : d.lastError ? 'var(--danger)' : 'var(--success)';
          const where = d.remote
            ? (d.type === 's3' ? `${(d.config?.endpoint) || 's3'} · ${d.config?.bucket || ''}`
              : d.type === 'webdav' ? (d.config?.url || 'webdav')
              : d.type === 'gdrive' ? `Google Drive${d.config?.folderId ? ` · folder ${d.config.folderId}` : ''}` : d.type)
            : d.path;
          return (
            <div key={d.id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot, flex: '0 0 auto' }} />
                <div style={{ flex: 1, minWidth: 180 }}>
                  {editing?.id === d.id ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input className="input" value={editing.label} onChange={e => setEditing({ ...editing, label: e.target.value })} style={{ maxWidth: 320 }} />
                      <button className="btn btn-sm btn-primary" onClick={saveLabel}>Save</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  ) : (<>
                    <div style={{ fontWeight: 600 }}>{d.label}{d.paused ? ' · paused' : ''}</div>
                    <div className="text-xs text-muted" style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{where}</div>
                  </>)}
                </div>
                {d.waiting > 0 && <span className="badge" style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}>{d.waiting} waiting</span>}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn btn-sm btn-outline" onClick={() => testDest(d)}>Test</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditing({ id: d.id, label: d.label })}>Rename</button>
                  {d.remote && <button className="btn btn-sm btn-ghost" onClick={() => openEditConnection(d)}>Edit</button>}
                  <button className="btn btn-sm btn-ghost" onClick={() => togglePause(d)}>{d.paused ? 'Resume' : 'Pause'}</button>
                  <button className="btn btn-sm btn-danger" onClick={() => removeDest(d)}>Remove</button>
                </div>
              </div>
              {d.lastError && !d.paused && <div className="text-xs" style={{ color: 'var(--danger)', marginLeft: 19, marginTop: 4 }}>Last copy failed: {d.lastError}. It will be retried automatically.</div>}
            </div>
          );
        })}

        {/* Add form (verify-before-save), or the gallery */}
        {adding ? (
          <AddForm form={adding} setField={setField} setCfgField={setCfgField} browseInto={browseInto}
            onSubmit={submitAdd} onCancel={() => setAdding(null)} />
        ) : (
          <>
            <div style={{ fontWeight: 700, marginTop: 16, marginBottom: 8 }}>Add somewhere</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
              {DEST_TYPES.map(t => (
                <button key={t.type} type="button" onClick={() => openAdd(t.type)}
                  style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'var(--surface-1)' }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>{t.title}</div>
                  <div className="text-xs" style={{ color: 'var(--accent-700)', fontWeight: 600, marginBottom: 6 }}>{t.tag}</div>
                  <div className="text-xs text-muted">{t.blurb}</div>
                  <div className="text-xs text-muted" style={{ marginTop: 6, fontStyle: 'italic' }}>{t.works}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Restore ── */}
      <div className="card">
        <h3 className="card-title">Restore</h3>
        <p className="text-muted text-sm mb-3">
          Replaces current data with a previous backup. A pre-restore snapshot is taken first, so restoring
          the wrong file can itself be undone. The app restarts afterwards.
        </p>
        {backups.length === 0 ? <p className="text-muted text-sm">No backups yet. Take one above first.</p> : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            {backups.map((b, i) => (
              <div key={b.path} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: i ? '1px solid var(--border)' : 'none', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{b.label}
                    <span className="text-xs text-muted" style={{ fontWeight: 400 }}> · {formatBytes(b.size)} · {new Date(b.modified).toLocaleString()}</span></div>
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
          <p className="text-muted text-xs mb-2">For a backup kept off this computer — a USB drive, the network, or wherever else copies are sent.</p>
          <button className="btn btn-outline" onClick={restoreFromFile} disabled={busy}>📂 Choose a backup file…</button>
        </div>
      </div>

      {/* ── Factory reset ── */}
      <div className="card">
        <div className="section-header">
          <h3 className="card-title" style={{ color: 'var(--danger)' }}>Factory reset</h3>
          <button className="btn btn-sm btn-ghost" onClick={() => setShowReset(x => !x)}>{showReset ? 'Hide' : 'Show'}</button>
        </div>
        <p className="text-muted text-sm">Erase everything and return to first-time setup. Kept out of the way on purpose.</p>
        {showReset && (
          <div style={{ marginTop: 12 }}>
            <p className="text-muted text-sm mb-3">A pre-reset snapshot is taken first and your existing backups are kept. This cannot be undone.</p>
            <div className="form-group"><label className="label">Type <strong>RESET</strong> to enable</label>
              <input className="input" value={resetText} onChange={e => setResetText(e.target.value)} placeholder="RESET" style={{ maxWidth: 220 }} /></div>
            <button className="btn btn-danger" onClick={factoryReset} disabled={busy || resetText !== 'RESET'}>⚠️ Factory reset</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── the per-provider add / edit form ────────────────────────────────────────
function AddForm({ form, setField, setCfgField, browseInto, onSubmit, onCancel }) {
  const t = form.type;
  const c = form.config || {};
  const meta = DEST_TYPES.find(x => x.type === t) || { title: 'Destination', works: '' };
  const secretPh = form.mode === 'edit' ? '•••••••• (leave blank to keep)' : '';

  return (
    <div style={{ border: '1px solid var(--primary)', borderRadius: 12, padding: 14, marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h4 style={{ margin: 0 }}>{form.mode === 'edit' ? 'Edit' : 'Add'} — {meta.title}</h4>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
      <p className="text-xs text-muted mb-3">Works with: {meta.works} Nothing is saved until it has been checked against the real thing.</p>

      <div className="form-group"><label className="label">Name it</label>
        <input className="input" value={form.label} onChange={e => setField('label', e.target.value)} placeholder={meta.title} /></div>

      {(t === 'network' || t === 'local') && (
        <div className="form-group"><label className="label">Folder path</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" value={form.path} onChange={e => setField('path', e.target.value)}
              placeholder={t === 'network' ? '\\\\server\\backups\\lims   or   /mnt/server/backups' : 'D:\\Backups'} />
            <button className="btn btn-outline" onClick={browseInto}>Browse…</button>
          </div>
          {t === 'network' && <p className="text-xs text-muted" style={{ marginTop: 6 }}>A UNC path on Windows, or a mount point on Linux. If it opens in the file manager on this machine, it will work here.</p>}
        </div>
      )}

      {t === 's3' && (<>
        <div className="form-group"><label className="label">Endpoint</label>
          <input className="input" value={c.endpoint || ''} onChange={e => setCfgField('endpoint', e.target.value)} placeholder="https://s3.us-west-004.backblazeb2.com" /></div>
        <div className="form-row">
          <div className="form-group"><label className="label">Region (optional)</label>
            <input className="input" value={c.region || ''} onChange={e => setCfgField('region', e.target.value)} placeholder="us-east-1" /></div>
          <div className="form-group"><label className="label">Bucket</label>
            <input className="input" value={c.bucket || ''} onChange={e => setCfgField('bucket', e.target.value)} placeholder="lab-backups" /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="label">Access key ID</label>
            <input className="input" value={c.accessKeyId || ''} onChange={e => setCfgField('accessKeyId', e.target.value)} /></div>
          <div className="form-group"><label className="label">Secret access key</label>
            <input className="input" type="password" value={c.secretAccessKey || ''} onChange={e => setCfgField('secretAccessKey', e.target.value)} placeholder={secretPh} /></div>
        </div>
        <div className="form-group"><label className="label">Folder prefix (optional)</label>
          <input className="input" value={c.prefix || ''} onChange={e => setCfgField('prefix', e.target.value)} placeholder="school-backups" /></div>
      </>)}

      {t === 'webdav' && (<>
        <div className="form-group"><label className="label">WebDAV address</label>
          <input className="input" value={c.url || ''} onChange={e => setCfgField('url', e.target.value)} placeholder="https://cloud.example.org/remote.php/dav/files/user/Backups" /></div>
        <div className="form-row">
          <div className="form-group"><label className="label">Username</label>
            <input className="input" value={c.username || ''} onChange={e => setCfgField('username', e.target.value)} /></div>
          <div className="form-group"><label className="label">Password or app password</label>
            <input className="input" type="password" value={c.password || ''} onChange={e => setCfgField('password', e.target.value)} placeholder={secretPh} /></div>
        </div>
        <p className="text-xs text-muted">Use an app password rather than the account password where the server offers one.</p>
      </>)}

      {t === 'gdrive' && (<>
        <p className="text-xs text-muted mb-2">
          In the Google Cloud console: create a project, enable the Drive API, create a service account, add a JSON
          key, then share a Drive folder with the service account's email as an Editor. Paste the whole JSON below.
        </p>
        <div className="form-group"><label className="label">Service-account key (paste the whole JSON)</label>
          <textarea className="input" rows={4} value={c.serviceAccountJson || ''} onChange={e => setCfgField('serviceAccountJson', e.target.value)}
            placeholder={secretPh || '{ "type": "service_account", "project_id": "…", "client_email": "…", "private_key": "…" }'} /></div>
        <div className="form-group"><label className="label">Destination folder ID (optional)</label>
          <input className="input" value={c.folderId || ''} onChange={e => setCfgField('folderId', e.target.value)} placeholder="1AbC2dEfGhIjKlMnOpQrStUvWxYz" /></div>
      </>)}

      {form.error && <div className="text-sm" style={{ color: 'var(--danger)', marginBottom: 10 }}>⚠ {form.error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" onClick={onSubmit} disabled={form.verifying}>
          {form.verifying ? 'Checking…' : (form.mode === 'edit' ? 'Save and verify' : 'Add and verify')}
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
