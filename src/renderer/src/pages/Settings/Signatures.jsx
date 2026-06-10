// Nickland Edusoft — Signature Management Settings
// Manages proprietor + headmaster signatures with per-role embed toggles
// Access control: signatures linked to specific users — only the assigned
// user can embed their own signature on documents
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

export default function Signatures() {
  const { settings, loadSettings } = useStore();
  const showToast = useStore(s => s.showToast);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // We need to reload settings after any change
  useEffect(() => {
    (async () => {
      const list = await window.api.auth.listUsers();
      setUsers(list);
      setLoading(false);
    })();
  }, []);

  // Refresh settings whenever this page mounts (in case the parent didn't reload)
  useEffect(() => { loadSettings(); }, []);

  const sigs = settings.signatures || {};

  return (
    <div className="signatures-settings">
      <div className="card" style={{ background: 'var(--info-bg)', borderLeft: '3px solid var(--info)' }}>
        <strong>How signatures work:</strong>
        <ul style={{ marginTop: 8, marginLeft: 20, fontSize: 13, lineHeight: 1.6 }}>
          <li>Upload the signature image (PNG with transparent background recommended).</li>
          <li>Assign it to a specific user — only that signed-in user can embed it on documents.</li>
          <li>Toggle <strong>Embed on documents</strong> ON to start including the signature on printed materials.</li>
          <li>Even when toggled ON, signatures only appear when the assigned signer is logged in.</li>
        </ul>
      </div>

      <SignatureSection
        role="proprietor"
        label="Proprietor's Signature"
        description="Used on official school documents, attestations, testimonials, certificates, and financial reports."
        sigPath={sigs.proprietor_signature_path}
        name={sigs.proprietor_name}
        userId={sigs.proprietor_user_id}
        embedEnabled={sigs.embed_proprietor_signature === 'true'}
        users={users}
        showToast={showToast}
        reload={loadSettings}
      />

      <SignatureSection
        role="headmaster"
        label="Headmaster / Head Teacher's Signature"
        description="Used on academic reports, end-of-term reports, recommendation letters, and academic correspondence."
        sigPath={sigs.headmaster_signature_path}
        name={sigs.headmaster_name}
        userId={sigs.headmaster_user_id}
        embedEnabled={sigs.embed_headmaster_signature === 'true'}
        users={users}
        showToast={showToast}
        reload={loadSettings}
      />

      <TerminalReportSettings settings={settings} reload={loadSettings} showToast={showToast} />
    </div>
  );
}

// Settings for the Terminal Report layout: vacation date, reopening date,
// proprietor name (printed alongside the signature), current exam title,
// and a sliding signature size used by the report-card generator.
function TerminalReportSettings({ settings, reload, showToast }) {
  const sigs = settings.signatures || {};
  const [form, setForm] = useState({
    vacation_date:      sigs.vacation_date || '',
    reopening_date:     sigs.reopening_date || '',
    proprietor_name:    sigs.proprietor_name || '',
    current_exam_title: sigs.current_exam_title || '',
    signature_size_mm:  sigs.signature_size_mm || '22',
  });
  const [saving, setSaving] = useState(false);

  // Re-sync from settings when they reload
  useEffect(() => {
    setForm({
      vacation_date:      sigs.vacation_date || '',
      reopening_date:     sigs.reopening_date || '',
      proprietor_name:    sigs.proprietor_name || '',
      current_exam_title: sigs.current_exam_title || '',
      signature_size_mm:  sigs.signature_size_mm || '22',
    });
  }, [
    sigs.vacation_date, sigs.reopening_date, sigs.proprietor_name,
    sigs.current_exam_title, sigs.signature_size_mm,
  ]);

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v ?? '' })); }

  async function save() {
    setSaving(true);
    for (const [key, value] of Object.entries(form)) {
      await window.api.settings.set(key, value ?? '');
    }
    setSaving(false);
    showToast('Terminal report settings saved', 'success');
    reload();
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="section-header">
        <div>
          <div className="section-title">Terminal Report Layout</div>
          <div className="text-sm text-muted">
            Used by the End of Term report card. Update at the start of each term.
          </div>
        </div>
      </div>

      <div className="form-row" style={{ marginTop: 14 }}>
        <div className="form-group" style={{ flex: 2 }}>
          <label>Current exam title (printed under school name)</label>
          <input type="text" value={form.current_exam_title ?? ''}
            onChange={e => set('current_exam_title', e.target.value)}
            placeholder="e.g. END OF SECOND TERM EXAMINATION, 2025/2026" />
          <div className="form-hint">
            Leave blank to auto-compose from the current term and academic year.
          </div>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Vacation date</label>
          <input type="text" value={form.vacation_date ?? ''}
            onChange={e => set('vacation_date', e.target.value)}
            placeholder="e.g. Wednesday, 1st April 2026" />
        </div>
        <div className="form-group">
          <label>Reopening date</label>
          <input type="text" value={form.reopening_date ?? ''}
            onChange={e => set('reopening_date', e.target.value)}
            placeholder="e.g. Tuesday, 21st April 2026" />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group" style={{ flex: 2 }}>
          <label>Proprietor's name (printed on report)</label>
          <input type="text" value={form.proprietor_name ?? ''}
            onChange={e => set('proprietor_name', e.target.value)}
            placeholder="e.g. Very Rev. Fr. Nicholas Afriyie" />
          <div className="form-hint">
            Appears next to "Proprietor's Name:" on the terminal report — only when
            the Proprietor signature toggle above is ON.
          </div>
        </div>
        <div className="form-group">
          <label>Signature size (mm height)</label>
          <input type="number" min="10" max="40" step="1"
            value={form.signature_size_mm ?? ''}
            onChange={e => set('signature_size_mm', e.target.value)} />
          <div className="form-hint">Default 22mm. Smaller = more compact.</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Terminal Report Settings'}
        </button>
      </div>
    </div>
  );
}

function SignatureSection({ role, label, description, sigPath, name, userId, embedEnabled, users, showToast, reload }) {
  const [editingName, setEditingName] = useState(name || '');
  const [editingUserId, setEditingUserId] = useState(userId || '');
  const [saving, setSaving] = useState(false);

  async function pickFile() {
    const res = await window.api.app.showOpenDialog({
      title: `Choose ${label}`,
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return;

    setSaving(true);
    const result = await window.api.settings.uploadSignature({
      role,
      sourcePath: res.filePaths[0],
      name: editingName,
      userId: editingUserId ? parseInt(editingUserId) : null,
    });
    setSaving(false);
    if (result.ok) {
      showToast(`${label} uploaded`, 'success');
      reload();
    } else {
      showToast(result.error, 'error');
    }
  }

  async function saveDetails() {
    setSaving(true);
    // Save name + user separately via raw set
    await window.api.settings.set(`${role}_name`, editingName);
    await window.api.settings.set(`${role}_user_id`, editingUserId ? String(editingUserId) : '');
    setSaving(false);
    showToast('Details updated', 'success');
    reload();
  }

  async function toggleEmbed() {
    if (!sigPath && !embedEnabled) {
      return showToast('Upload a signature first before enabling embedding', 'warning');
    }
    if (!userId && !embedEnabled) {
      return showToast('Assign this signature to a user first', 'warning');
    }
    await window.api.settings.set(
      `embed_${role}_signature`,
      embedEnabled ? 'false' : 'true'
    );
    showToast(
      `${label} embedding ${embedEnabled ? 'disabled' : 'enabled'}`,
      'success'
    );
    reload();
  }

  async function removeSignature() {
    if (!confirm(`Remove ${label}? This will also disable embedding.`)) return;
    await window.api.settings.removeSignature(role);
    showToast('Signature removed', 'success');
    reload();
  }

  // Filter users to designations relevant for this role
  const relevantUsers = users.filter(u => {
    const d = (u.designation_name || '').toLowerCase();
    if (role === 'proprietor') return d === 'proprietor' || d === 'administrator';
    if (role === 'headmaster') return d === 'head teacher' || d === 'administrator';
    return true;
  });

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-header">
        <div>
          <div className="section-title">{label}</div>
          <div className="text-sm text-muted" style={{ marginTop: 4 }}>{description}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="text-sm" style={{ color: embedEnabled ? 'var(--success)' : 'var(--muted)' }}>
            {embedEnabled ? '✓ Embedding ON' : 'Embedding OFF'}
          </span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={embedEnabled}
              onChange={toggleEmbed}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div className="signature-row">
        <div className="signature-preview">
          {sigPath
            ? <img src={`file://${sigPath}?v=${Date.now()}`} alt="" />
            : <div className="signature-preview-empty">
                <span>No signature uploaded</span>
              </div>
          }
        </div>
        <div className="signature-details">
          <div className="form-group">
            <label>Signer's Name</label>
            <input
              type="text"
              value={editingName}
              onChange={e => setEditingName(e.target.value)}
              placeholder="e.g. Rev. Fr. John Doe"
            />
          </div>
          <div className="form-group">
            <label>Assign to User (the signed-in user who can apply this signature)</label>
            <select value={editingUserId} onChange={e => setEditingUserId(e.target.value)}>
              <option value="">— Not assigned —</option>
              {relevantUsers.map(u => (
                <option key={u.id} value={u.id ?? ''}>
                  {u.full_name} ({u.designation_name || 'No designation'})
                </option>
              ))}
            </select>
            <div className="form-hint">
              {role === 'proprietor'
                ? 'Only users with Proprietor or Administrator designation are shown.'
                : 'Only users with Head Teacher or Administrator designation are shown.'}
              {' '}Only the assigned user can apply this signature when logged in.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={pickFile} disabled={saving}>
              {saving ? 'Uploading…' : (sigPath ? 'Replace Signature' : 'Upload Signature')}
            </button>
            <button className="btn btn-outline btn-sm" onClick={saveDetails} disabled={saving}>
              Save Details
            </button>
            {sigPath && (
              <button className="btn btn-danger btn-sm" onClick={removeSignature}>
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
