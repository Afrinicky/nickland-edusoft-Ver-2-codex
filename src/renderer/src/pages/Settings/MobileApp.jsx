// Nickland Edusoft — Mobile App (companion app sync settings — scaffold)
// The mobile app is not yet released; this page prepares the desktop host
// for future integration.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

export default function MobileApp() {
  const { settings, loadSettings } = useStore();
  const showToast = useStore(s => s.showToast);
  const mobile = settings.mobile || {};
  const [status, setStatus] = useState(null);
  const [token, setToken] = useState(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await window.api.mobileSync.status();
      setStatus(s);
    })();
  }, [settings.mobile]);

  async function toggleEnabled() {
    const cur = mobile.mobile_sync_enabled === 'true';
    await window.api.settings.set('mobile_sync_enabled', cur ? 'false' : 'true');
    showToast(`Mobile sync ${cur ? 'disabled' : 'enabled'}`, 'success');
    loadSettings();
  }

  async function generateToken() {
    setGenerating(true);
    const res = await window.api.mobileSync.generateToken();
    setGenerating(false);
    if (res.ok) {
      setToken(res);
      showToast('Pairing token generated — valid for 10 minutes', 'success');
    }
  }

  async function changePort() {
    const newPort = prompt('Enter port number for mobile sync (default 4747):', mobile.mobile_sync_port || '4747');
    if (!newPort) return;
    const n = parseInt(newPort, 10);
    if (isNaN(n) || n < 1024 || n > 65535) {
      showToast('Port must be a number between 1024 and 65535', 'warning');
      return;
    }
    await window.api.settings.set('mobile_sync_port', String(n));
    showToast('Port updated', 'success');
    loadSettings();
  }

  const enabled = mobile.mobile_sync_enabled === 'true';
  const devices = status?.devices || [];

  return (
    <div className="mobile-app-settings">
      {/* Status banner */}
      <div className="card" style={{ background: 'var(--warning-bg)', borderLeft: '3px solid var(--warning)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ fontSize: 22 }}>📱</span>
          <div>
            <strong>Mobile companion app — coming in a future release</strong>
            <div className="text-sm" style={{ marginTop: 6, lineHeight: 1.6 }}>
              This desktop application is the <strong>host</strong> — it holds the canonical
              school data. A separate mobile app for iOS and Android is planned for the future.
              When released, you'll be able to pair phones to this desktop instance for on-the-go
              access to dashboards, fees, attendance, and notifications.
              <br /><br />
              The settings on this page reserve the infrastructure for that future release.
              Enabling mobile sync today does not expose any data — there's no companion app yet.
            </div>
          </div>
        </div>
      </div>

      {/* Master toggle */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="feature-toggle-row">
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Enable Mobile Sync (when available)</div>
            <div className="text-sm text-muted" style={{ marginTop: 4 }}>
              Reserve a network port and prepare this desktop to host the future companion app.
              Required before pairing devices.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="text-sm" style={{ color: enabled ? 'var(--success)' : 'var(--muted)' }}>
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
            <label className="toggle-switch">
              <input type="checkbox" checked={enabled} onChange={toggleEnabled} />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      {/* Sync configuration */}
      {enabled && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title">Sync Configuration</div>

          <div className="form-row" style={{ marginTop: 14 }}>
            <div className="form-group">
              <label>Sync Port</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 600 }}>
                  :{mobile.mobile_sync_port || '4747'}
                </span>
                <button className="btn btn-outline btn-sm" onClick={changePort}>Change Port</button>
              </div>
              <div className="form-hint">
                The TCP port the desktop will listen on for mobile app connections.
                Default: 4747. The mobile companion app will scan this port over the local network.
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Server Status</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: status?.server_running ? 'var(--success)' : 'var(--muted)',
                }}></span>
                <span className="text-sm">
                  {status?.server_running
                    ? 'Server is running and listening'
                    : 'Server is not running (companion app not yet released)'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pairing */}
      {enabled && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Pair a Mobile Device</div>
              <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                Generate a one-time 6-digit code. Enter it on the mobile app to authorize that
                device to access this desktop's data.
              </div>
            </div>
            <button className="btn btn-primary" onClick={generateToken} disabled={generating}>
              {generating ? 'Generating…' : 'Generate Pairing Code'}
            </button>
          </div>
          {token && (
            <div className="pairing-token-display">
              <div className="text-sm text-muted">Pairing code (valid 10 minutes)</div>
              <div className="pairing-token-code">{token.token}</div>
              <div className="text-xs text-muted">
                Expires at {new Date(token.expires_at).toLocaleTimeString()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Paired devices */}
      {enabled && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-header">
            <div className="section-title">Paired Devices ({devices.length})</div>
          </div>
          {devices.length === 0
            ? <div className="empty-state">
                No devices paired yet. When the mobile companion app is released,
                paired phones and tablets will appear here.
              </div>
            : <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Device</th><th>Paired By</th><th>Paired On</th><th>Last Seen</th><th></th></tr>
                  </thead>
                  <tbody>
                    {devices.map(d => (
                      <tr key={d.id}>
                        <td><strong>{d.name}</strong> <div className="text-xs text-muted">{d.platform}</div></td>
                        <td>{d.paired_by_user || '—'}</td>
                        <td className="text-sm">{d.paired_at || '—'}</td>
                        <td className="text-sm">{d.last_seen || '—'}</td>
                        <td>
                          <button className="btn btn-danger btn-sm"
                            onClick={async () => {
                              if (confirm(`Revoke access for "${d.name}"?`)) {
                                await window.api.mobileSync.revokeDevice(d.id);
                                showToast('Device access revoked', 'success');
                                loadSettings();
                              }
                            }}>
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          }
        </div>
      )}

      {/* Architecture note */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title">For Developers</div>
        <div className="text-sm" style={{ lineHeight: 1.6, marginTop: 8 }}>
          The mobile companion app will follow this architecture:
          <ul style={{ marginLeft: 20, marginTop: 8 }}>
            <li><strong>Desktop is HOST</strong> — holds canonical SQLite database, runs the sync server.</li>
            <li><strong>Mobile is CLIENT</strong> — discovers desktop via mDNS, authenticates with bearer tokens.</li>
            <li><strong>LAN-only</strong> — no cloud, no internet exposure. Phones must be on the same Wi-Fi.</li>
            <li><strong>Read-mostly v1</strong> — initial release will be view-only with some scoped writes (attendance marking, message drafts).</li>
            <li><strong>Token revocation</strong> — each paired device gets a unique bearer token, individually revocable.</li>
          </ul>
          <div className="text-xs text-muted" style={{ marginTop: 12 }}>
            See <code>electron/ipc/mobile_sync.js</code> for the full architectural blueprint.
          </div>
        </div>
      </div>
    </div>
  );
}
