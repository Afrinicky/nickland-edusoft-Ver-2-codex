// Nickland Edusoft — Staff Activities Tab
// Log of non-teaching activities: meetings, duty, supervision, professional development.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { sanitizeForForm } from '../../lib/formSafe.js';

const ACTIVITY_TYPES = [
  'Staff Meeting', 'Department Meeting', 'Parent-Teacher Meeting',
  'Duty (Morning/Closing)', 'Bus Duty', 'Hostel/Boarding Duty',
  'Extracurricular Supervision', 'Sports Coaching', 'Club Patron',
  'Professional Development / Workshop', 'Training Attended', 'Training Delivered',
  'School Function', 'Inspection / Visit', 'Other',
];

export default function ActivitiesTab() {
  const { currentUser, classes } = useStore();
  const showToast = useStore(s => s.showToast);
  const [activities, setActivities] = useState([]);
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState({
    fromDate: '', toDate: '', activityType: '',
  });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const isSupervisor = ['Administrator', 'Proprietor', 'Head Teacher'].includes(currentUser?.designation);

  async function refresh() {
    setLoading(true);
    const data = await window.api.staffActivities.list({
      fromDate: filter.fromDate || undefined,
      toDate: filter.toDate || undefined,
      activityType: filter.activityType || undefined,
    });
    setActivities(data || []);
    // Get my-own summary (if linked to staff)
    try {
      const s = await window.api.staffActivities.summary({
        fromDate: filter.fromDate || undefined,
        toDate: filter.toDate || undefined,
      });
      setSummary(s.ok ? s : null);
    } catch (e) { setSummary(null); }
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [filter.fromDate, filter.toDate, filter.activityType]);

  async function handleDelete(id) {
    if (!confirm('Delete this activity?')) return;
    const res = await window.api.staffActivities.delete(id);
    if (res.ok) { showToast('Deleted', 'success'); refresh(); }
    else showToast(res.error || 'Could not delete', 'error');
  }

  async function ack(id) {
    const res = await window.api.staffActivities.acknowledge(id);
    if (res.ok) { showToast('Acknowledged', 'success'); refresh(); }
    else showToast(res.error || 'Could not acknowledge', 'error');
  }

  return (
    <div className="activities-tab">
      <div className="card no-print">
        <div className="section-header">
          <div>
            <div className="section-title">Staff Activities Log</div>
            <div className="text-sm text-muted">
              {isSupervisor
                ? 'All staff activity records. Acknowledge entries to confirm them.'
                : 'Your record of meetings, duties, supervision, and professional development.'}
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            + Log Activity
          </button>
        </div>

        <div className="form-row" style={{ marginTop: 14 }}>
          <div className="form-group">
            <label>From</label>
            <input type="date" value={filter.fromDate} onChange={e => setFilter({ ...filter, fromDate: e.target.value })} />
          </div>
          <div className="form-group">
            <label>To</label>
            <input type="date" value={filter.toDate} onChange={e => setFilter({ ...filter, toDate: e.target.value })} />
          </div>
          <div className="form-group" style={{ flex: 2 }}>
            <label>Type</label>
            <select value={filter.activityType} onChange={e => setFilter({ ...filter, activityType: e.target.value })}>
              <option value="">All types</option>
              {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Summary card */}
      {summary?.ok && summary.total.count > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
            <div>
              <div className="text-xs text-muted">Total Activities</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{summary.total.count}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Total Hours Contributed</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--primary)' }}>
                {(summary.total.hours || 0).toFixed(1)}
              </div>
            </div>
            <div style={{ flex: 1, fontSize: 12, color: 'var(--muted)' }}>
              {summary.by_type.slice(0, 4).map(b => (
                <div key={b.activity_type}>
                  <strong>{b.count}</strong> × {b.activity_type}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        {loading
          ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
          : activities.length === 0
            ? <div className="empty-state">No activities logged in this period.</div>
            : <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Title</th>
                      {isSupervisor && <th>Staff</th>}
                      <th>Class</th>
                      <th className="text-center">Hours</th>
                      <th>Status</th>
                      <th style={{ width: 110 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {activities.map(a => (
                      <tr key={a.id}>
                        <td className="text-sm">{a.activity_date}</td>
                        <td><span className="badge badge-muted" style={{ fontSize: 11 }}>{a.activity_type}</span></td>
                        <td>
                          <strong>{a.title}</strong>
                          {a.location && <div className="text-xs text-muted">{a.location}</div>}
                        </td>
                        {isSupervisor && <td className="text-sm">{a.staff_name || '—'}</td>}
                        <td className="text-sm">{a.class_name || '—'}</td>
                        <td className="text-center">{a.hours_contributed != null ? a.hours_contributed.toFixed(1) : '—'}</td>
                        <td>
                          {a.acknowledged_by
                            ? <span className="badge badge-success" title={`By ${a.acknowledged_by_name || 'supervisor'}`}>✓ Ack</span>
                            : <span className="badge badge-warning">Pending</span>
                          }
                        </td>
                        <td>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(a)}>Edit</button>
                          {isSupervisor && !a.acknowledged_by && (
                            <button className="btn btn-ghost btn-sm" onClick={() => ack(a.id)} title="Acknowledge">✓</button>
                          )}
                          <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(a.id)}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
        }
      </div>

      {editing !== null && (
        <ActivityModal
          activity={editing}
          classes={classes}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function ActivityModal({ activity, classes, onClose, onSaved }) {
  const showToast = useStore(s => s.showToast);
  const [form, setForm] = useState(() => sanitizeForForm(activity.id ? activity : {
    activity_date: new Date().toISOString().slice(0, 10),
    activity_type: 'Staff Meeting',
    title: '', description: '', location: '',
    duration_minutes: '', hours_contributed: '',
    related_class_id: '',
  }));
  const [saving, setSaving] = useState(false);

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v ?? '' })); }

  async function save() {
    if (!form.title.trim()) return showToast('Title is required', 'warning');
    if (!form.activity_date) return showToast('Date is required', 'warning');
    setSaving(true);
    const res = await window.api.staffActivities.save({
      ...form,
      duration_minutes: form.duration_minutes ? parseInt(form.duration_minutes) : null,
      hours_contributed: form.hours_contributed ? parseFloat(form.hours_contributed) : null,
    });
    setSaving(false);
    if (res.ok) { showToast('Saved', 'success'); onSaved(); }
    else showToast(res.error || 'Could not save', 'error');
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{activity.id ? 'Edit Activity' : 'Log Activity'}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Date <span className="text-danger">*</span></label>
            <input type="date" value={form.activity_date ?? ''} onChange={e => set('activity_date', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Activity Type</label>
            <select value={form.activity_type ?? ''} onChange={e => set('activity_type', e.target.value)}>
              {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Title <span className="text-danger">*</span></label>
          <input type="text" value={form.title ?? ''} onChange={e => set('title', e.target.value)}
            placeholder="e.g. Morning duty supervision" />
        </div>

        <div className="form-group">
          <label>Description</label>
          <textarea rows="3" value={form.description ?? ''} onChange={e => set('description', e.target.value)}
            placeholder="Notes about the activity…" />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Location</label>
            <input type="text" value={form.location ?? ''} onChange={e => set('location', e.target.value)}
              placeholder="e.g. Staff room" />
          </div>
          <div className="form-group">
            <label>Related class (optional)</label>
            <select value={form.related_class_id ?? ''} onChange={e => set('related_class_id', e.target.value)}>
              <option value="">— None —</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Duration (minutes)</label>
            <input type="number" min="0" value={form.duration_minutes ?? ''}
              onChange={e => set('duration_minutes', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Hours contributed (decimal)</label>
            <input type="number" min="0" step="0.25" value={form.hours_contributed ?? ''}
              onChange={e => set('hours_contributed', e.target.value)} />
            <div className="form-hint">Used for PD credit / overtime tracking</div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
