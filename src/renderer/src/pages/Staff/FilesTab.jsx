// Nickland Edusoft — Staff Files Tab (HR records: documents, medical, training, performance)
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fullName, initials, fmtDate } from '../../lib/format.js';

export default function StaffFilesTab() {
  const [staff, setStaff] = useState([]);
  const [staffId, setStaffId] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      const list = await window.api.staff.list({ status: 'Active' });
      setStaff(list);
    })();
  }, []);

  const filtered = search
    ? staff.filter(s =>
        (`${s.surname} ${s.first_name}`.toLowerCase().includes(search.toLowerCase())) ||
        (s.staff_number || '').toLowerCase().includes(search.toLowerCase())
      )
    : staff;

  return (
    <div className="staff-files-tab">
      <div className="files-layout">
        {/* Left: staff picker */}
        <div className="card files-staff-list">
          <input
            type="text"
            placeholder="Search staff..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 10 }}
          />
          <div className="files-staff-scroll">
            {filtered.map(s => (
              <div
                key={s.id}
                className={'files-staff-item' + (staffId === s.id ? ' active' : '')}
                onClick={() => setStaffId(s.id)}
              >
                <div className="avatar avatar-sm">{initials(s)}</div>
                <div className="files-staff-info">
                  <div className="files-staff-name">{s.surname} {s.first_name}</div>
                  <div className="files-staff-meta">{s.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: file panels */}
        <div className="files-content">
          {!staffId
            ? <div className="card empty-state-card">
                <IconFolder size={48} />
                <div style={{ fontSize: 15, fontWeight: 500, marginTop: 12 }}>Select a staff member to view their HR records</div>
              </div>
            : <StaffFilePanels staffId={staffId} />
          }
        </div>
      </div>
    </div>
  );
}

// ── File Panels for a selected staff ───────────────────
function StaffFilePanels({ staffId }) {
  const showToast = useStore(s => s.showToast);
  const [staff, setStaff] = useState(null);
  const [sub, setSub] = useState('documents');

  useEffect(() => {
    (async () => {
      const s = await window.api.staff.get(staffId);
      setStaff(s);
    })();
  }, [staffId]);

  if (!staff) return <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>;

  return (
    <div className="staff-files-panels">
      <div className="card files-header-card">
        <div className="avatar avatar-lg">{initials(staff)}</div>
        <div>
          <div className="files-staff-name-lg">{fullName(staff)}</div>
          <div className="text-sm text-muted">
            <strong>{staff.staff_number}</strong> · {staff.role}
          </div>
        </div>
      </div>

      <div className="sub-tabs">
        <button className={'sub-tab' + (sub === 'documents' ? ' active' : '')} onClick={() => setSub('documents')}>Documents & IDs</button>
        <button className={'sub-tab' + (sub === 'medical' ? ' active' : '')} onClick={() => setSub('medical')}>Medical Records</button>
        <button className={'sub-tab' + (sub === 'training' ? ' active' : '')} onClick={() => setSub('training')}>Training & CPD</button>
        <button className={'sub-tab' + (sub === 'performance' ? ' active' : '')} onClick={() => setSub('performance')}>Performance Reviews</button>
      </div>

      <div style={{ marginTop: 16 }}>
        {sub === 'documents'   && <DocumentsPanel staffId={staffId} />}
        {sub === 'medical'     && <MedicalPanel staffId={staffId} />}
        {sub === 'training'    && <TrainingPanel staffId={staffId} />}
        {sub === 'performance' && <PerformancePanel staffId={staffId} />}
      </div>
    </div>
  );
}

// ── Documents Panel ────────────────────────────────────
function DocumentsPanel({ staffId }) {
  const showToast = useStore(s => s.showToast);
  const [docs, setDocs] = useState([]);
  const [showAdd, setShowAdd] = useState(false);

  async function refresh() {
    const list = await window.api.staff.listDocuments(staffId);
    setDocs(list);
  }
  useEffect(() => { refresh(); }, [staffId]);

  async function handleDelete(id) {
    if (!confirm('Delete this document?')) return;
    await window.api.staff.deleteDocument(id);
    showToast('Document deleted', 'success');
    refresh();
  }

  return (
    <div className="card">
      <div className="section-header">
        <div className="section-title">Documents & Identification</div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Add Document</button>
      </div>
      {docs.length === 0
        ? <div className="empty-state">No documents on file yet</div>
        : <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Type</th><th>Title</th><th>Issue Date</th><th>Expiry Date</th><th>Notes</th><th></th></tr>
              </thead>
              <tbody>
                {docs.map(d => (
                  <tr key={d.id}>
                    <td><span className="badge badge-primary">{d.doc_type}</span></td>
                    <td><strong>{d.title}</strong></td>
                    <td>{d.issue_date ? fmtDate(d.issue_date) : '—'}</td>
                    <td>
                      {d.expiry_date
                        ? <span style={{ color: new Date(d.expiry_date) < new Date() ? 'var(--danger)' : 'inherit' }}>
                            {fmtDate(d.expiry_date)}
                          </span>
                        : '—'}
                    </td>
                    <td className="text-sm text-muted">{d.notes || '—'}</td>
                    <td>
                      {d.file_path && (
                        <button className="btn btn-ghost btn-sm" title="Open document"
                          onClick={async () => {
                            const res = await window.api.app.openFile(d.file_path);
                            if (!res.ok) showToast(res.error || 'Could not open file', 'error');
                          }}>👁 Open</button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(d.id)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      }

      {showAdd && (
        <AddDocumentModal
          staffId={staffId}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); refresh(); showToast('Document added', 'success'); }}
        />
      )}
    </div>
  );
}

function AddDocumentModal({ staffId, onClose, onSaved }) {
  const [form, setForm] = useState({
    doc_type: 'national_id',
    title: '',
    issue_date: '',
    expiry_date: '',
    notes: '',
    sourcePath: null,
  });
  const [saving, setSaving] = useState(false);

  async function pickFile() {
    const res = await window.api.app.showOpenDialog({
      title: 'Select Document',
      properties: ['openFile'],
      filters: [{ name: 'Documents/Images', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'] }],
    });
    if (!res.canceled && res.filePaths.length > 0) {
      setForm({ ...form, sourcePath: res.filePaths[0] });
    }
  }

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true);
    await window.api.staff.uploadDocument({ staff_id: staffId, ...form });
    setSaving(false);
    onSaved();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Add Document</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form-group">
          <label>Document Type</label>
          <select value={form.doc_type ?? ''} onChange={e => setForm({ ...form, doc_type: e.target.value })}>
            <option value="national_id">National ID</option>
            <option value="ghana_card">Ghana Card</option>
            <option value="passport">Passport</option>
            <option value="ssnit_card">SSNIT Card</option>
            <option value="tin_certificate">TIN Certificate</option>
            <option value="academic_certificate">Academic Certificate</option>
            <option value="professional_certificate">Professional Certificate</option>
            <option value="contract">Employment Contract</option>
            <option value="appointment_letter">Appointment Letter</option>
            <option value="ges_certificate">GES Certificate</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="form-group">
          <label>Title</label>
          <input type="text" value={form.title ?? ''} onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. BECE Certificate 2010" autoFocus />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Issue Date</label>
            <input type="date" value={form.issue_date ?? ''} onChange={e => setForm({ ...form, issue_date: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Expiry Date (if any)</label>
            <input type="date" value={form.expiry_date ?? ''} onChange={e => setForm({ ...form, expiry_date: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label>File</label>
          <button className="btn btn-outline btn-full" onClick={pickFile}>
            {form.sourcePath ? `✓ ${form.sourcePath.split(/[/\\]/).pop()}` : 'Choose file…'}
          </button>
        </div>
        <div className="form-group">
          <label>Notes</label>
          <textarea rows="2" value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !form.title.trim()}>
            {saving ? 'Saving…' : 'Save Document'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Medical Panel ──────────────────────────────────────
function MedicalPanel({ staffId }) {
  const showToast = useStore(s => s.showToast);
  const [data, setData] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const m = await window.api.staff.getMedical(staffId);
      setData(m || {});
    })();
  }, [staffId]);

  async function save() {
    setSaving(true);
    await window.api.staff.saveMedical({ staff_id: staffId, ...data });
    setSaving(false);
    showToast('Medical record saved', 'success');
  }

  return (
    <div className="card">
      <div className="section-header">
        <div className="section-title">Medical Records</div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Blood Group</label>
          <select value={data.blood_group || ''} onChange={e => setData({ ...data, blood_group: e.target.value })}>
            <option value="">— Select —</option>
            {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(b => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>NHIS Number</label>
          <input type="text" value={data.nhis_number || ''} onChange={e => setData({ ...data, nhis_number: e.target.value })} />
        </div>
      </div>
      <div className="form-group">
        <label>Known Medical Conditions</label>
        <textarea rows="2" value={data.known_conditions || ''}
          onChange={e => setData({ ...data, known_conditions: e.target.value })}
          placeholder="e.g. Asthma, hypertension, diabetes…" />
      </div>
      <div className="form-group">
        <label>Allergies</label>
        <textarea rows="2" value={data.allergies || ''}
          onChange={e => setData({ ...data, allergies: e.target.value })}
          placeholder="e.g. Penicillin, peanuts…" />
      </div>

      <div className="form-section">Emergency Contact</div>
      <div className="form-row">
        <div className="form-group">
          <label>Name</label>
          <input type="text" value={data.emergency_contact_name || ''}
            onChange={e => setData({ ...data, emergency_contact_name: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Phone</label>
          <input type="text" value={data.emergency_contact_phone || ''}
            onChange={e => setData({ ...data, emergency_contact_phone: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Relation</label>
          <input type="text" value={data.emergency_contact_relation || ''}
            onChange={e => setData({ ...data, emergency_contact_relation: e.target.value })}
            placeholder="e.g. Spouse, Brother, Mother" />
        </div>
      </div>
      <div className="form-group">
        <label>Additional Notes</label>
        <textarea rows="2" value={data.notes || ''}
          onChange={e => setData({ ...data, notes: e.target.value })} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Medical Record'}
        </button>
      </div>
    </div>
  );
}

// ── Training Panel ─────────────────────────────────────
function TrainingPanel({ staffId }) {
  const showToast = useStore(s => s.showToast);
  const [list, setList] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);

  async function refresh() {
    const data = await window.api.staff.listTraining(staffId);
    setList(data);
  }
  useEffect(() => { refresh(); }, [staffId]);

  async function handleDelete(id) {
    if (!confirm('Delete this training record?')) return;
    await window.api.staff.deleteTraining(id);
    showToast('Training deleted', 'success');
    refresh();
  }

  return (
    <div className="card">
      <div className="section-header">
        <div className="section-title">Training & Professional Development</div>
        <button className="btn btn-primary btn-sm" onClick={() => { setEditing({}); setShowAdd(true); }}>+ Add Training</button>
      </div>
      {list.length === 0
        ? <div className="empty-state">No training records yet</div>
        : <div className="training-list">
            {list.map(t => (
              <div key={t.id} className="training-item">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{t.title}</div>
                  <div className="text-sm text-muted">
                    {t.provider && <>by {t.provider} · </>}
                    {t.start_date && fmtDate(t.start_date)}
                    {t.end_date && ` – ${fmtDate(t.end_date)}`}
                  </div>
                  {t.notes && <div className="text-sm" style={{ marginTop: 4 }}>{t.notes}</div>}
                </div>
                <div>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(t); setShowAdd(true); }}>Edit</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(t.id)}>×</button>
                </div>
              </div>
            ))}
          </div>
      }

      {showAdd && (
        <TrainingFormModal
          staffId={staffId}
          training={editing}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); refresh(); showToast('Saved', 'success'); }}
        />
      )}
    </div>
  );
}

function TrainingFormModal({ staffId, training, onClose, onSaved }) {
  const [form, setForm] = useState(training || {});
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!form.title?.trim()) return;
    setSaving(true);
    await window.api.staff.saveTraining({ staff_id: staffId, ...form });
    setSaving(false);
    onSaved();
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{form.id ? 'Edit Training' : 'Add Training'}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form-group">
          <label>Title</label>
          <input type="text" value={form.title || ''} onChange={e => setForm({ ...form, title: e.target.value })} autoFocus />
        </div>
        <div className="form-group">
          <label>Provider / Organisation</label>
          <input type="text" value={form.provider || ''} onChange={e => setForm({ ...form, provider: e.target.value })} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Start Date</label>
            <input type="date" value={form.start_date || ''} onChange={e => setForm({ ...form, start_date: e.target.value })} />
          </div>
          <div className="form-group">
            <label>End Date</label>
            <input type="date" value={form.end_date || ''} onChange={e => setForm({ ...form, end_date: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label>Notes</label>
          <textarea rows="2" value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !form.title?.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Performance Panel ──────────────────────────────────
function PerformancePanel({ staffId }) {
  const showToast = useStore(s => s.showToast);
  const [list, setList] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const { currentUser } = useStore();

  async function refresh() {
    const data = await window.api.staff.listPerformance(staffId);
    setList(data);
  }
  useEffect(() => { refresh(); }, [staffId]);

  return (
    <div className="card">
      <div className="section-header">
        <div className="section-title">Performance Reviews</div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ New Review</button>
      </div>
      {list.length === 0
        ? <div className="empty-state">No performance reviews yet</div>
        : <div className="performance-list">
            {list.map(p => (
              <div key={p.id} className="performance-item">
                <div className="performance-header">
                  <div>
                    <div style={{ fontWeight: 600 }}>{p.review_period}</div>
                    <div className="text-xs text-muted">
                      Reviewed by {p.reviewer_name || 'Unknown'} on {fmtDate(p.reviewed_at)}
                    </div>
                  </div>
                  <div className="performance-rating">
                    <span style={{ fontSize: 22, fontWeight: 700, color: ratingColor(p.overall_rating) }}>
                      {p.overall_rating || '—'}/5
                    </span>
                  </div>
                </div>
                <div className="performance-criteria">
                  <RatingBar label="Teaching Quality" value={p.teaching_quality ?? ''} />
                  <RatingBar label="Punctuality" value={p.punctuality ?? ''} />
                  <RatingBar label="Professionalism" value={p.professionalism ?? ''} />
                </div>
                {p.comments && (
                  <div className="performance-comments">
                    <div className="text-xs text-muted">Comments:</div>
                    <p style={{ marginTop: 4 }}>{p.comments}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
      }
      {showAdd && (
        <PerformanceFormModal
          staffId={staffId}
          reviewerId={currentUser?.id}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); refresh(); showToast('Review saved', 'success'); }}
        />
      )}
    </div>
  );
}

function RatingBar({ label, value }) {
  return (
    <div className="rating-bar-row">
      <div className="rating-bar-label">{label}</div>
      <div className="rating-bar-track">
        {[1,2,3,4,5].map(n => (
          <div key={n} className={'rating-bar-pip' + (value >= n ? ' filled' : '')} />
        ))}
      </div>
      <div className="rating-bar-val">{value || '—'}/5</div>
    </div>
  );
}

function PerformanceFormModal({ staffId, reviewerId, onClose, onSaved }) {
  const [form, setForm] = useState({
    review_period: '',
    overall_rating: 3,
    teaching_quality: 3,
    punctuality: 3,
    professionalism: 3,
    comments: '',
  });
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!form.review_period.trim()) return;
    setSaving(true);
    await window.api.staff.savePerformance({ staff_id: staffId, reviewer_id: reviewerId, ...form });
    setSaving(false);
    onSaved();
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">New Performance Review</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form-group">
          <label>Review Period</label>
          <input type="text" value={form.review_period ?? ''}
            onChange={e => setForm({ ...form, review_period: e.target.value })}
            placeholder="e.g. Term 2 of 2025/2026, or Annual 2025" autoFocus />
        </div>
        {['overall_rating', 'teaching_quality', 'punctuality', 'professionalism'].map(k => (
          <div key={k} className="form-group">
            <label>{k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} (1–5)</label>
            <input type="number" min="1" max="5" step="1" value={form[k]}
              onChange={e => setForm({ ...form, [k]: parseInt(e.target.value) || 0 })} />
          </div>
        ))}
        <div className="form-group">
          <label>Comments</label>
          <textarea rows="3" value={form.comments ?? ''} onChange={e => setForm({ ...form, comments: e.target.value })} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !form.review_period.trim()}>
            {saving ? 'Saving…' : 'Save Review'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ratingColor(r) {
  if (!r) return 'var(--muted)';
  if (r >= 4) return 'var(--success)';
  if (r >= 3) return 'var(--info)';
  if (r >= 2) return 'var(--warning)';
  return 'var(--danger)';
}

function IconFolder({ size = 22 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" strokeWidth="2"/>
  </svg>;
}
