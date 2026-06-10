// Nickland Edusoft — Staff Leave Management Tab
// Request-based only, mandatory justification — NO scheduled leave
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtDate, initials } from '../../lib/format.js';

export default function StaffLeaveTab() {
  const showToast = useStore(s => s.showToast);
  const { currentUser } = useStore();
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [showAdd, setShowAdd] = useState(false);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const [reqs, list] = await Promise.all([
      window.api.staff.listLeaveRequests({ status: statusFilter || undefined }),
      window.api.staff.list({ status: 'Active' }),
    ]);
    setRequests(reqs);
    setStaff(list);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, [statusFilter]);

  async function reviewLeave(id, status) {
    const notes = status === 'rejected' ? prompt('Reason for rejection (optional):') : '';
    const res = await window.api.staff.reviewLeave({
      id, status, reviewerId: currentUser?.id, reviewerNotes: notes || null
    });
    if (res.ok) {
      showToast(`Leave ${status}`, 'success');
      refresh();
    }
  }

  const stats = {
    pending: requests.filter(r => r.status === 'pending').length,
    approved: requests.filter(r => r.status === 'approved').length,
    rejected: requests.filter(r => r.status === 'rejected').length,
  };

  return (
    <div className="staff-leave-tab">
      {/* Policy reminder */}
      <div className="info-banner" style={{ background: 'var(--warning-bg)', borderLeftColor: 'var(--warning)' }}>
        <strong>Policy:</strong> Teachers do not have scheduled leave during vacations.
        Any time off requires an approved leave request with written justification.
        Days off without approval are recorded as absent.
      </div>

      {/* Filters + Add */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div className="leave-status-filters">
            <button className={'btn btn-sm ' + (statusFilter === 'pending' ? 'btn-primary' : 'btn-ghost')}
              onClick={() => setStatusFilter('pending')}>
              Pending Review
            </button>
            <button className={'btn btn-sm ' + (statusFilter === 'approved' ? 'btn-primary' : 'btn-ghost')}
              onClick={() => setStatusFilter('approved')}>
              Approved
            </button>
            <button className={'btn btn-sm ' + (statusFilter === 'rejected' ? 'btn-primary' : 'btn-ghost')}
              onClick={() => setStatusFilter('rejected')}>
              Rejected
            </button>
            <button className={'btn btn-sm ' + (statusFilter === '' ? 'btn-primary' : 'btn-ghost')}
              onClick={() => setStatusFilter('')}>
              All
            </button>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Submit Leave Request</button>
        </div>
      </div>

      {/* List */}
      {loading
        ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
        : requests.length === 0
          ? <div className="card empty-state" style={{ marginTop: 14 }}>
              No {statusFilter || 'all'} leave requests.
            </div>
          : <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {requests.map(r => (
                <div key={r.id} className={`card leave-card leave-${r.status}`}>
                  <div className="leave-card-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div className="avatar">{initials({ surname: r.surname, first_name: r.first_name })}</div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{r.surname} {r.first_name}</div>
                        <div className="text-sm text-muted">{r.role} · {r.staff_number}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className={'badge badge-' + leaveStatusBadge(r.status)}>{r.status}</span>
                      <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                        Submitted {fmtDate(r.created_at)}
                      </div>
                    </div>
                  </div>

                  <div className="leave-card-body">
                    <div className="leave-detail-row">
                      <span className="leave-detail-label">Type:</span>
                      <span className="badge badge-primary">{r.leave_type}</span>
                    </div>
                    <div className="leave-detail-row">
                      <span className="leave-detail-label">Dates:</span>
                      <strong>{fmtDate(r.start_date)} → {fmtDate(r.end_date)} ({r.days_requested} days)</strong>
                    </div>
                    <div className="leave-detail-row">
                      <span className="leave-detail-label">Justification:</span>
                      <div className="leave-justification">{r.justification}</div>
                    </div>
                    {r.reviewer_notes && (
                      <div className="leave-detail-row">
                        <span className="leave-detail-label">Reviewer notes:</span>
                        <div className="leave-justification">{r.reviewer_notes}</div>
                      </div>
                    )}
                    {r.reviewer_name && (
                      <div className="text-xs text-muted" style={{ marginTop: 6 }}>
                        Reviewed by {r.reviewer_name} on {fmtDate(r.reviewed_at)}
                      </div>
                    )}
                  </div>

                  {r.status === 'pending' && (
                    <div className="leave-card-actions">
                      <button className="btn btn-outline btn-sm" onClick={() => reviewLeave(r.id, 'rejected')}>Reject</button>
                      <button className="btn btn-primary btn-sm" onClick={() => reviewLeave(r.id, 'approved')}>Approve</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
      }

      {showAdd && (
        <LeaveRequestModal
          staff={staff}
          onClose={() => setShowAdd(false)}
          onSubmitted={() => { setShowAdd(false); refresh(); showToast('Leave request submitted', 'success'); }}
        />
      )}
    </div>
  );
}

function leaveStatusBadge(s) {
  return { pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'muted' }[s] || 'muted';
}

function LeaveRequestModal({ staff, onClose, onSubmitted }) {
  const showToast = useStore(s => s.showToast);
  const [form, setForm] = useState({
    staff_id: '',
    leave_type: 'sick',
    start_date: '',
    end_date: '',
    justification: '',
  });
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!form.staff_id) return showToast('Select a staff member', 'warning');
    if (!form.justification.trim()) return showToast('A written justification is required', 'warning');
    if (form.justification.trim().length < 20) {
      return showToast('Justification must be at least 20 characters — explain the reason clearly', 'warning');
    }
    if (!form.start_date || !form.end_date) return showToast('Start and end dates are required', 'warning');

    setSaving(true);
    const res = await window.api.staff.submitLeaveRequest(form);
    setSaving(false);
    if (res.ok) onSubmitted();
    else showToast(res.error, 'error');
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Submit Leave Request</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form-row">
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>Staff Member</label>
            <select value={form.staff_id ?? ''} onChange={e => setForm({ ...form, staff_id: e.target.value })}>
              <option value="">— Select —</option>
              {staff.map(s => <option key={s.id} value={s.id ?? ''}>{s.surname} {s.first_name} ({s.role})</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Leave Type</label>
            <select value={form.leave_type ?? ''} onChange={e => setForm({ ...form, leave_type: e.target.value })}>
              <option value="sick">Sick</option>
              <option value="maternity">Maternity</option>
              <option value="paternity">Paternity</option>
              <option value="bereavement">Bereavement</option>
              <option value="personal">Personal/Family</option>
              <option value="study">Study</option>
              <option value="emergency">Emergency</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="form-group">
            <label>Start Date</label>
            <input type="date" value={form.start_date ?? ''} onChange={e => setForm({ ...form, start_date: e.target.value })} />
          </div>
          <div className="form-group">
            <label>End Date</label>
            <input type="date" value={form.end_date ?? ''} onChange={e => setForm({ ...form, end_date: e.target.value })} />
          </div>
        </div>

        <div className="form-group" style={{ marginTop: 14 }}>
          <label>Justification (required) <span className="text-danger">*</span></label>
          <textarea rows="4"
            value={form.justification ?? ''}
            onChange={e => setForm({ ...form, justification: e.target.value })}
            placeholder="Provide a clear written reason for this leave request. Minimum 20 characters."
          />
          <div className="form-hint">
            {form.justification.length}/20 minimum characters. The reason will be reviewed before approval.
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Submitting…' : 'Submit Request'}
          </button>
        </div>
      </div>
    </div>
  );
}
