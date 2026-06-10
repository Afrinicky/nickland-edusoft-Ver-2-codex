import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/index.js';
import { fullName, initials, fmtCedi } from '../../lib/format.js';
import Modal from '../../components/Modal.jsx';
import StaffForm from './Form.jsx';

export default function StaffStatusTab() {
  const showToast = useStore(s => s.showToast);
  const [staff, setStaff] = useState([]);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('Active');
  const [showAdd, setShowAdd] = useState(false);
  const navigate = useNavigate();

  async function refresh() {
    const list = await window.api.staff.list({
      search: search || undefined, role: role || undefined, status: status || undefined,
    });
    setStaff(list);
  }
  useEffect(() => { refresh(); }, [search, role, status]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Staff</h1>
          <div className="page-subtitle">{staff.length} staff shown</div>
        </div>
        <div className="row gap-2">
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Staff</button>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="search-wrap">
            <input className="search-input" placeholder="Search by name or staff number…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="select" style={{ maxWidth: 220 }} value={role} onChange={e => setRole(e.target.value)}>
            <option value="">All roles</option>
            <option value="Teaching">Teaching</option>
            <option value="Non-Teaching">Non-Teaching</option>
            <option value="Administrative">Administrative</option>
            <option value="Support">Support</option>
          </select>
          <select className="select" style={{ maxWidth: 140 }} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="Active">Active</option>
            <option value="">All</option>
            <option value="Stopped">Stopped</option>
          </select>
        </div>

        <table className="table table-clickable">
          <thead>
            <tr>
              <th></th><th>Staff #</th><th>Name</th><th>Role</th><th>Phone</th>
              <th className="text-right">Base Salary</th><th>SSNIT</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {staff.map(s => (
              <tr key={s.id} onClick={() => navigate(`/staff/${s.id}`)}>
                <td><div className="avatar">{initials(s)}</div></td>
                <td className="bold">{s.staff_number}</td>
                <td>{fullName(s)}</td>
                <td>{s.role}</td>
                <td>{s.phone || '—'}</td>
                <td className="text-right">{fmtCedi(s.base_salary)}</td>
                <td>{s.ssnit_enrolled ? <span className="badge badge-success">Enrolled</span> : <span className="badge badge-muted">Not enrolled</span>}</td>
                <td><span className={'badge ' + (s.status === 'Active' ? 'badge-success' : 'badge-muted')}>{s.status}</span></td>
              </tr>
            ))}
            {staff.length === 0 && (
              <tr><td colSpan="8"><div className="empty-state"><h3>No staff yet</h3></div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <Modal title="Add staff" onClose={() => setShowAdd(false)} size="lg">
          <StaffForm
            onSaved={(id) => { setShowAdd(false); refresh(); showToast('Staff added'); navigate(`/staff/${id}`); }}
            onCancel={() => setShowAdd(false)}
          />
        </Modal>
      )}
    </div>
  );
}
