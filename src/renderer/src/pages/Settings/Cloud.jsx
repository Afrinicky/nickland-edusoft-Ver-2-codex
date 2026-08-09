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
  async function toggle(on) { await window.api.cloud.configure({ enabled: on }); showToast(on ? 'Cloud sync enabled' : 'Cloud sync disabled', 'success'); refresh(); }
  async function test() { setBusy(true); const r = await window.api.cloud.test(); setBusy(false); showToast(r.ok ? `Connected${r.school ? ' — ' + (r.school.name || r.school) : ''}` : (r.error || 'Failed'), r.ok ? 'success' : 'error'); }
  async function pushNow() { setBusy(true); const r = await window.api.cloud.pushNow(); setBusy(false); showToast(r.ok ? `Pushed ${r.pushed} update(s)` : (r.error || 'Push failed'), r.ok ? 'success' : 'error'); refresh(); }
  async function pullNow() { setBusy(true); const r = await window.api.cloud.pullNow(); setBusy(false); showToast(r.ok ? `Applied ${r.applied} change(s)` : (r.error || 'Pull failed'), r.ok ? 'success' : 'error'); refresh(); }

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
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn btn-outline" onClick={pushNow} disabled={busy || !st?.enabled}>⬆ Push now</button>
          <button className="btn btn-outline" onClick={pullNow} disabled={busy || !st?.enabled}>⬇ Pull now</button>
        </div>
        <p className="text-xs text-muted" style={{ marginTop: 8 }}>Sync also runs automatically every few minutes while enabled.</p>
      </div>
    </div>
  );
}
