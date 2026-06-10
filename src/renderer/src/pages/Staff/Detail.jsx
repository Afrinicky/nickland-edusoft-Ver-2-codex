import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../../store/index.js';
import { fullName, initials, fmtDate, fmtCedi } from '../../lib/format.js';
import Modal from '../../components/Modal.jsx';
import StaffForm from './Form.jsx';

export default function StaffDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const showToast = useStore(s => s.showToast);
  const [staff, setStaff] = useState(null);
  const [salaries, setSalaries] = useState([]);
  const [editing, setEditing] = useState(false);

  async function load() {
    const s = await window.api.staff.get(parseInt(id));
    setStaff(s);
    const sals = await window.api.staff.listSalaries(parseInt(id));
    setSalaries(sals);
  }
  useEffect(() => { load(); }, [id]);

  if (!staff) return <div className="text-muted">Loading…</div>;

  return (
    <div>
      <button className="btn btn-ghost btn-sm mb-3" onClick={() => navigate('/staff')}>← Back to Staff</button>
      <div className="card">
        <div className="row gap-4" style={{ alignItems: 'flex-start' }}>
          <div className="avatar avatar-lg">{initials(staff)}</div>
          <div className="flex-1">
            <h2 style={{ margin: 0, fontSize: 22 }}>{fullName(staff)}</h2>
            <div className="text-muted text-sm mt-1">
              <span className="bold" style={{ color: 'var(--accent)' }}>{staff.staff_number}</span> ·
              {' '}{staff.role} · {staff.gender}
            </div>
            <div className="row gap-2 mt-3">
              <span className={'badge ' + (staff.status === 'Active' ? 'badge-success' : 'badge-muted')}>{staff.status}</span>
              {staff.ssnit_enrolled ? <span className="badge badge-success">SSNIT enrolled</span> : <span className="badge badge-muted">No SSNIT</span>}
              {staff.qualification && <span className="badge badge-primary">{staff.qualification}</span>}
            </div>
          </div>
          <button className="btn btn-outline" onClick={() => setEditing(true)}>Edit</button>
        </div>
      </div>

      <div className="card mt-4">
        <h3 className="card-title">Details</h3>
        <table className="table">
          <tbody>
            <tr><td style={{ width: 180, color: 'var(--muted)' }}>Phone</td><td>{staff.phone || '—'}</td></tr>
            <tr><td style={{ color: 'var(--muted)' }}>Email</td><td>{staff.email || '—'}</td></tr>
            <tr><td style={{ color: 'var(--muted)' }}>Address</td><td>{staff.address || '—'}</td></tr>
            <tr><td style={{ color: 'var(--muted)' }}>Date of birth</td><td>{fmtDate(staff.date_of_birth)}</td></tr>
            <tr><td style={{ color: 'var(--muted)' }}>Hire date</td><td>{fmtDate(staff.hire_date)}</td></tr>
            <tr><td style={{ color: 'var(--muted)' }}>Specialisation</td><td>{staff.specialization || '—'}</td></tr>
            <tr><td style={{ color: 'var(--muted)' }}>Base salary</td><td>{fmtCedi(staff.base_salary)}</td></tr>
            <tr><td style={{ color: 'var(--muted)' }}>Bank</td><td>{staff.bank_name || '—'} · {staff.bank_account || '—'}</td></tr>
            <tr><td style={{ color: 'var(--muted)' }}>SSNIT no</td><td>{staff.ssnit_number || '—'}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card mt-4">
        <div className="card-header">
          <div className="card-title">Salary history</div>
        </div>
        <table className="table">
          <thead><tr>
            <th>Period</th><th className="text-right">Gross</th><th className="text-right">Extra</th>
            <th className="text-right">Net</th><th className="text-right">Paid</th><th>Status</th>
          </tr></thead>
          <tbody>
            {salaries.length === 0 ? (
              <tr><td colSpan="6" className="text-muted text-center">No salary records yet — see <a href="#/payroll">Payroll</a></td></tr>
            ) : salaries.map(s => (
              <tr key={s.id}>
                <td>{monthName(s.month)} {s.year}</td>
                <td className="text-right">{fmtCedi(s.gross_salary)}</td>
                <td className="text-right">{fmtCedi(s.extra_pay)}</td>
                <td className="text-right bold">{fmtCedi(s.net_salary)}</td>
                <td className="text-right">{fmtCedi(s.actual_amount_paid)}</td>
                <td><span className={'badge ' + (s.is_paid ? 'badge-success' : 'badge-warning')}>{s.is_paid ? 'Paid' : 'Pending'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title="Edit staff" onClose={() => setEditing(false)} size="lg">
          <StaffForm staff={staff}
            onSaved={() => { setEditing(false); load(); showToast('Staff updated'); }}
            onCancel={() => setEditing(false)} />
        </Modal>
      )}
    </div>
  );
}

function monthName(m) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1] || '';
}
