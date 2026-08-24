// Nickland Edusoft — Mobile App host settings
// Controls the embedded API server that the mobile client (React Native)
// connects to over the LAN, and manages parent accounts + paired devices.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtDate } from '../../lib/format.js';

export default function MobileApp() {
  const showToast = useStore(s => s.showToast);
  const [status, setStatus] = useState(null);
  const [devices, setDevices] = useState([]);
  const [parents, setParents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showNewParent, setShowNewParent] = useState(false);

  async function refresh() {
    try {
      const [s, d, p] = await Promise.all([
        window.api.mobile.status(),
        window.api.mobile.listDevices(),
        window.api.mobile.listParents(),
      ]);
      setStatus(s); setDevices(d.devices || []); setParents(p.parents || []);
    } catch (_) {}
  }
  useEffect(() => { refresh(); }, []);

  async function toggleServer() {
    setBusy(true);
    const res = status?.running ? await window.api.mobile.stop() : await window.api.mobile.start();
    setBusy(false);
    if (!res.ok) showToast(res.error || 'Failed', 'error');
    else showToast(status?.running ? 'Mobile server stopped' : 'Mobile server started', 'success');
    refresh();
  }

  async function setConfig(patch) {
    const res = await window.api.mobile.setConfig(patch);
    if (res && res.ok === false) showToast(res.error || 'Failed', 'error');
    else showToast('Saved', 'success');
    refresh();
  }

  async function revokeDevice(id, name) {
    if (!confirm(`Revoke access for "${name || 'this device'}"?`)) return;
    await window.api.mobile.revokeDevice(id);
    showToast('Device revoked', 'success'); refresh();
  }

  async function revokeParent(id, name) {
    if (!confirm(`Disable parent account "${name}" and sign out its devices?`)) return;
    await window.api.mobile.revokeParent(id);
    showToast('Parent account disabled', 'success'); refresh();
  }

  async function resetParent(id) {
    const pw = prompt('New password for this parent (min 4 chars):');
    if (!pw) return;
    const res = await window.api.mobile.resetParent({ parentId: id, newPassword: pw });
    showToast(res.ok ? 'Password reset' : (res.error || 'Failed'), res.ok ? 'success' : 'error');
  }

  const running = !!status?.running;
  const port = status?.port || 4747;
  const urls = (status?.addresses || []).map(a => `http://${a}:${port}`);
  const webApp = !!status?.web_app;

  return (
    <div className="mobile-app-settings">
      {/* Overview */}
      <div className="card" style={{ background: 'var(--info-bg)', borderLeft: '3px solid var(--info)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 22 }}>📱</span>
          <div className="text-sm" style={{ lineHeight: 1.6 }}>
            This desktop is the <strong>host</strong>. Turn on the mobile server to let the Nickland
            Edusoft mobile app (for parents, teachers, and staff) connect over your local Wi-Fi.
            Parents see only their own children; staff get exactly the access their role allows.
            The database never leaves this computer.
          </div>
        </div>
      </div>

      {/* Server control */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="feature-toggle-row">
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: running ? 'var(--success)' : 'var(--muted)' }} />
              Mobile API server — {running ? 'Running' : 'Stopped'}
            </div>
            <div className="text-sm text-muted" style={{ marginTop: 4 }}>
              {running
                ? 'Phones on the same network can now connect.'
                : 'Start the server to allow mobile connections.'}
              {status?.error && <span style={{ color: 'var(--danger)' }}> · {status.error}</span>}
            </div>
          </div>
          <button className={'btn ' + (running ? 'btn-danger' : 'btn-primary')} disabled={busy} onClick={toggleServer}>
            {busy ? '…' : running ? 'Stop server' : 'Start server'}
          </button>
        </div>

        {running && urls.length > 0 && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'var(--surface-2)' }}>
            <div className="text-sm text-muted">
              {webApp
                ? 'Point the mobile app at one of these addresses — or open it in any browser on the school Wi-Fi, no install needed:'
                : 'Point the mobile app at one of these addresses:'}
            </div>
            {urls.map(u => (
              <div key={u} style={{ fontFamily: 'monospace', fontWeight: 600, marginTop: 4 }}>{u}</div>
            ))}
            {webApp && (
              <div className="text-sm text-muted" style={{ marginTop: 8 }}>
                Staff and parents on the school Wi-Fi can use it straight from a browser. It works
                with the internet down; the desktop serves it.
              </div>
            )}
          </div>
        )}

        <div className="form-row" style={{ marginTop: 14 }}>
          <div className="form-group">
            <label className="label">Port</label>
            <input className="input" type="number" defaultValue={port}
              onBlur={e => { const n = parseInt(e.target.value, 10); if (n >= 1024 && n <= 65535) setConfig({ port: n }); }} />
          </div>
          <div className="form-group">
            <label className="label">Reachable from</label>
            <select className="select" value={status?.bind || 'lan'} onChange={e => setConfig({ bind: e.target.value })}>
              <option value="lan">Local network (LAN)</option>
              <option value="localhost">This computer only</option>
            </select>
          </div>
          <div className="form-group">
            <label className="label">Parent self-registration</label>
            <select className="select" value={status?.self_register ? 'on' : 'off'} onChange={e => setConfig({ selfRegister: e.target.value === 'on' })}>
              <option value="on">Allowed (phone must match a student)</option>
              <option value="off">Off — admin creates parent accounts</option>
            </select>
          </div>
        </div>
      </div>

      {/* Parent accounts */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-header">
          <div className="section-title">Parent accounts ({parents.length})</div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowNewParent(true)}>+ Add parent</button>
        </div>
        {parents.length === 0
          ? <div className="empty-state">No parent accounts yet. Parents can self-register from the app (if their phone matches a student), or add them here.</div>
          : <div className="table-wrap"><table>
              <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Children</th><th>Last login</th><th></th></tr></thead>
              <tbody>
                {parents.map(p => (
                  <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.5 }}>
                    <td><strong>{p.full_name}</strong>{!p.is_active && <span className="text-xs text-muted"> (disabled)</span>}</td>
                    <td className="text-sm" style={{ fontFamily: 'monospace' }}>{p.phone || '—'}</td>
                    <td className="text-sm">{p.email || '—'}</td>
                    <td>{p.child_count}</td>
                    <td className="text-sm">{p.last_login ? fmtDate(p.last_login) : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => resetParent(p.id)}>Reset PW</button>
                      {p.is_active !== 0 && <button className="btn btn-ghost btn-sm" onClick={() => revokeParent(p.id, p.full_name)}>Disable</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
        }
      </div>

      {/* Paired devices */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title">Paired devices ({devices.length})</div>
        {devices.length === 0
          ? <div className="empty-state">No active devices. Devices appear here after someone logs in from the mobile app.</div>
          : <div className="table-wrap"><table>
              <thead><tr><th>User</th><th>Type</th><th>Device</th><th>Last used</th><th></th></tr></thead>
              <tbody>
                {devices.map(d => (
                  <tr key={d.id}>
                    <td><strong>{d.subject_name || '—'}</strong></td>
                    <td><span className={'badge ' + (d.subject_type === 'parent' ? 'badge-muted' : 'badge-success')}>{d.subject_type}</span></td>
                    <td className="text-sm">{d.device_name || '—'} <span className="text-xs text-muted">{d.platform || ''}</span></td>
                    <td className="text-sm">{d.last_used_at ? fmtDate(d.last_used_at) : 'never'}</td>
                    <td><button className="btn btn-danger btn-sm" onClick={() => revokeDevice(d.id, d.device_name)}>Revoke</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
        }
      </div>

      {showNewParent && <NewParentModal onClose={() => setShowNewParent(false)} onDone={() => { setShowNewParent(false); refresh(); }} showToast={showToast} />}
    </div>
  );
}

function NewParentModal({ onClose, onDone, showToast }) {
  const [form, setForm] = useState({ full_name: '', phone: '', email: '', password: '' });
  const [matches, setMatches] = useState(null);
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  async function findChildren() {
    const res = await window.api.mobile.matchStudents({ phone: form.phone, email: form.email });
    setMatches(res.matches || []);
  }
  async function save() {
    if (!form.phone && !form.email) return showToast('Phone or email required', 'warning');
    const res = await window.api.mobile.createParent(form);
    if (!res.ok) return showToast(res.error || 'Failed', 'error');
    showToast(res.temp_password ? `Parent created — temp password: ${res.temp_password}` : 'Parent created', 'success');
    onDone();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><div className="modal-title">Add parent account</div><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="form-group"><label className="label">Full name</label>
          <input className="input" value={form.full_name} onChange={e => set('full_name', e.target.value)} /></div>
        <div className="form-row">
          <div className="form-group"><label className="label">Phone</label>
            <input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} onBlur={findChildren} placeholder="0244…" /></div>
          <div className="form-group"><label className="label">Email (optional)</label>
            <input className="input" type="email" value={form.email} onChange={e => set('email', e.target.value)} onBlur={findChildren} /></div>
        </div>
        <div className="form-group"><label className="label">Password (blank = auto-generate)</label>
          <input className="input" value={form.password} onChange={e => set('password', e.target.value)} /></div>
        {matches != null && (
          <div className="text-sm" style={{ padding: 10, borderRadius: 8, background: 'var(--surface-2)' }}>
            {matches.length === 0
              ? 'No students matched this phone/email. You can still create the account and link children later.'
              : `Will link ${matches.length} child(ren) found by contact match.`}
          </div>
        )}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Create account</button>
        </div>
      </div>
    </div>
  );
}
