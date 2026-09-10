// Nickland Edusoft — Cloud sync settings (thin-cloud, multi-school portal)
// The desktop stays the source of truth; this pushes a small view (balances,
// receipts, notices) to the school's page on the portal and pulls parent edits.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtDate } from '../../lib/format.js';

export default function Cloud() {
  const showToast = useStore(s => s.showToast);
  const [st, setSt] = useState(null);
  const [form, setForm] = useState({ baseUrl: '', apiKey: '', schoolId: '' });
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const [showConflicts, setShowConflicts] = useState(false);

  async function refresh() {
    const s = await window.api.cloud.status();
    if (s?.ok) { setSt(s); setForm(f => ({ baseUrl: s.base_url || '', apiKey: f.apiKey, schoolId: s.school_id || '' })); }
  }
  useEffect(() => { refresh(); }, []);

  async function save() {
    const patch = { baseUrl: form.baseUrl, schoolId: form.schoolId };
    if (form.apiKey) patch.apiKey = form.apiKey;
    await window.api.cloud.configure(patch);
    showToast('Cloud settings saved', 'success');
    refresh();
  }
  async function toggle(on) {
    const r = await window.api.cloud.configure({ enabled: on });
    if (!on) showToast('Cloud sync disabled', 'success');
    else if (r?.backfilled) {
      const n = Object.values(r.backfilled).reduce((a, b) => a + b, 0);
      showToast(`Cloud sync enabled — queued ${n} existing record(s) for the website`, 'success');
    } else showToast(r?.ok === false ? (r.error || 'Could not enable sync') : 'Cloud sync enabled', r?.ok === false ? 'error' : 'success');
    refresh();
  }

  async function backfill() {
    setBusy(true);
    const r = await window.api.cloud.backfill();
    setBusy(false);
    if (r?.ok) {
      const c = r.counts;
      showToast(`Queued ${r.total}: ${c.students} student(s), ${c.parents} parent(s), ${c.announcements} notice(s), ${c.receipts} receipt(s)`, 'success');
    } else showToast(r?.error || 'Could not queue the re-send', 'error');
    refresh();
  }
  async function test() { setBusy(true); const r = await window.api.cloud.test(); setBusy(false); showToast(r.ok ? `Connected${r.school ? ' — ' + (r.school.name || r.school) : ''}` : (r.error || 'Failed'), r.ok ? 'success' : 'error'); }
  async function pushNow() { setBusy(true); const r = await window.api.cloud.pushNow(); setBusy(false); showToast(r.ok ? `Pushed ${r.pushed} update(s)` : (r.error || 'Push failed'), r.ok ? 'success' : 'error'); refresh(); }
  // "More to come" matters after a long outage: a school whose computer was off
  // for a month has thousands of queued changes, and a pull that stops at a
  // full batch with no explanation looks stuck rather than busy.
  async function pullNow() {
    setBusy(true);
    const r = await window.api.cloud.pullNow();
    setBusy(false);
    showToast(
      r.ok
        ? `Applied ${r.applied} change(s)${r.more ? ' — more still to come, the next sync will carry on' : ''}`
        : (r.error || 'Pull failed'),
      r.ok ? 'success' : 'error');
    refresh();
  }

  // What the school kept when a teacher's off-LAN work disagreed with it. Shown
  // only when there is something to show: a row reading "0" every day trains
  // people to stop reading it.
  async function loadConflicts() {
    const r = await window.api.cloud.conflicts({ limit: 50 });
    setConflicts(r?.ok ? (r.conflicts || []) : []);
    setShowConflicts(true);
  }

  async function dismissConflict(id) {
    await window.api.cloud.conflictReviewed(id);
    setConflicts(cs => cs.filter(c => c.id !== id));
    refresh();
  }

  return (
    <div className="settings-stack" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="section-header">
          <h3 className="card-title">Cloud portal sync</h3>
          <label className="row gap-2" style={{ alignItems: 'center' }}>
            <input type="checkbox" checked={st?.enabled || false} onChange={e => toggle(e.target.checked)} />
            <span className="text-sm">{st?.enabled ? 'On' : 'Off'}</span>
          </label>
        </div>
        <p className="text-muted text-sm">
          Connect this school to its page on the Nickland Edusoft website so parents and staff can reach it
          over the internet. Your database stays here — only a small view (current balances, receipts, notices)
          is sent up, and parent profile edits are pulled back down. Everything keeps working offline.
        </p>
      </div>

      <div className="card">
        <h3 className="card-title">Connection</h3>
        <div className="form-group">
          <label className="label">Portal URL</label>
          <input className="input" value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.nicklandedusoft.app" />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="label">School ID</label>
            <input className="input" value={form.schoolId} onChange={e => setForm({ ...form, schoolId: e.target.value })} placeholder="issued when you enrol" />
          </div>
          <div className="form-group">
            <label className="label">School API key</label>
            <input className="input" type="password" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} placeholder={st?.configured ? '•••••• (saved)' : 'paste your key'} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={save}>Save</button>
          <button className="btn btn-outline" onClick={test} disabled={busy}>Test connection</button>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">Status</h3>
        <div className="text-sm" style={{ lineHeight: 1.8 }}>
          <div>Configured: <strong>{st?.configured ? 'Yes' : 'No'}</strong></div>
          <div>Pending to send: <strong>{st?.pending ?? 0}</strong></div>
          <div>Last push: <strong>{st?.last_push_at ? fmtDate(st.last_push_at) : '—'}</strong></div>
          <div>Last pull: <strong>{st?.last_pull_at ? fmtDate(st.last_pull_at) : '—'}</strong></div>
          {st?.conflicts > 0 && (
            <div style={{ color: 'var(--warning)' }}>
              Kept this computer's version: <strong>{st.conflicts}</strong>{' '}
              <button className="btn btn-ghost btn-sm" onClick={loadConflicts}>See which</button>
            </div>
          )}
        </div>

        {showConflicts && (
          <div style={{ marginTop: 10 }}>
            <p className="text-sm text-muted" style={{ lineHeight: 1.6 }}>
              A teacher entered these away from the school, but this computer's record had
              already moved on by the time the change arrived. <strong>This computer's
              version was kept.</strong> Nothing here has changed anything — open the mark
              or the report card if one of them should be the teacher's figure after all.
            </p>
            {!conflicts.length && <p className="text-sm">Nothing outstanding.</p>}
            {conflicts.map(c => (
              <div key={c.id} className="row" style={{
                justifyContent: 'space-between', alignItems: 'baseline',
                gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span className="text-sm">
                  <strong>{c.student_name || `Pupil #${c.student_id}`}</strong>
                  {c.subject_name ? ` · ${c.subject_name}` : ''}
                  {' — kept '}<strong>{c.local_value ?? '(blank)'}</strong>
                  {' rather than '}{c.cloud_value ?? '(blank)'}
                  {c.user_name ? ` from ${c.user_name}` : ''}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => dismissConflict(c.id)}>Seen</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn btn-outline" onClick={pushNow} disabled={busy || !st?.enabled}>⬆ Push now</button>
          <button className="btn btn-outline" onClick={pullNow} disabled={busy || !st?.enabled}>⬇ Pull now</button>
          <button className="btn btn-outline" onClick={backfill} disabled={busy || !st?.enabled}>↻ Re-send everything</button>
        </div>
        <p className="text-xs text-muted" style={{ marginTop: 8 }}>Sync also runs automatically every few minutes while enabled.</p>
        <p className="text-xs text-muted" style={{ marginTop: 4 }}>
          <strong>Re-send everything</strong> queues every active student, parent account, notice and recent
          receipt again. It runs by itself the first time you switch sync on; use it after importing a class
          list, or if the website ever looks out of step with this computer.
        </p>
      </div>
    </div>
  );
}
