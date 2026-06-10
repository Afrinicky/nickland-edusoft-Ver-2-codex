import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi } from '../../lib/format.js';
import Modal from '../../components/Modal.jsx';

export default function PayrollLegacy() {
  const showToast = useStore(s => s.showToast);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);

  async function refresh() {
    const list = await window.api.staff.payrollSummary(month, year);
    setRows(list);
  }
  useEffect(() => { refresh(); }, [month, year]);

  const totals = rows.reduce((acc, r) => ({
    gross: acc.gross + (r.gross_salary || 0),
    net: acc.net + (r.net_salary || 0),
    paid: acc.paid + (r.actual_amount_paid || 0),
  }), { gross: 0, net: 0, paid: 0 });

  async function printPayslip(salaryId) {
    if (!salaryId) { showToast('Save salary first', 'error'); return; }
    const res = await window.api.reports.generatePayslip(salaryId, {});
    if (res.ok) showToast(`Payslip: ${res.path.split(/[\\/]/).pop()}`);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Payroll</h1>
          <div className="page-subtitle">Manage monthly staff salaries</div>
        </div>
        <div className="row gap-2">
          <select className="select" value={month} onChange={e => setMonth(parseInt(e.target.value))}>
            {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
          <input className="input" type="number" value={year} style={{ maxWidth: 100 }}
            onChange={e => setYear(parseInt(e.target.value))} />
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-tile"><div className="stat-label">Total gross</div><div className="stat-value">{fmtCedi(totals.gross)}</div></div>
        <div className="stat-tile"><div className="stat-label">Total net</div><div className="stat-value">{fmtCedi(totals.net)}</div></div>
        <div className="stat-tile"><div className="stat-label">Total paid</div><div className="stat-value accent">{fmtCedi(totals.paid)}</div></div>
        <div className="stat-tile"><div className="stat-label">Staff</div><div className="stat-value">{rows.length}</div></div>
      </div>

      <div className="card">
        <table className="table">
          <thead><tr>
            <th>Staff</th><th>Role</th>
            <th className="text-right">Gross</th><th className="text-right">Extra</th>
            <th className="text-right">SSNIT W</th><th className="text-right">PAYE</th>
            <th className="text-right">Net</th><th className="text-right">Paid</th>
            <th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td><div className="bold">{r.surname} {r.first_name}</div><div className="text-sm text-muted">{r.staff_number}</div></td>
                <td>{r.role}</td>
                <td className="text-right">{fmtCedi(r.gross_salary)}</td>
                <td className="text-right">{fmtCedi(r.extra_pay)}</td>
                <td className="text-right">{fmtCedi(r.ssnit_worker)}</td>
                <td className="text-right">{fmtCedi(r.paye_tax)}</td>
                <td className="text-right bold">{fmtCedi(r.net_salary)}</td>
                <td className="text-right">{fmtCedi(r.actual_amount_paid)}</td>
                <td><span className={'badge ' + (r.is_paid ? 'badge-success' : 'badge-warning')}>
                  {r.is_paid ? 'Paid' : 'Pending'}
                </span></td>
                <td className="row gap-2">
                  <button className="btn btn-outline btn-sm" onClick={() => setEditing(r)}>Edit</button>
                  {r.salary_id && <button className="btn btn-ghost btn-sm" onClick={() => printPayslip(r.salary_id)}>🖨</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <SalaryEditor row={editing} month={month} year={year}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); showToast('Salary saved'); }}
        />
      )}
    </div>
  );
}

function SalaryEditor({ row, month, year, onClose, onSaved }) {
  const [data, setData] = useState({
    staff_id: row.id, month, year,
    gross_salary: row.gross_salary || 0,
    extra_pay: row.extra_pay || 0,
    extra_pay_description: '',
    arrear_brought_forward: row.arrear_brought_forward || 0,
    paye_tax: row.paye_tax || 0,
    other_deductions: row.other_deductions || 0,
    other_deductions_description: '',
    actual_amount_paid: row.actual_amount_paid || 0,
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: 'Cash',
    is_paid: !!row.is_paid,
    notes: '',
  });

  async function save() {
    const res = await window.api.staff.saveSalary({
      ...data,
      gross_salary: parseFloat(data.gross_salary) || 0,
      extra_pay: parseFloat(data.extra_pay) || 0,
      arrear_brought_forward: parseFloat(data.arrear_brought_forward) || 0,
      paye_tax: parseFloat(data.paye_tax) || 0,
      other_deductions: parseFloat(data.other_deductions) || 0,
      actual_amount_paid: parseFloat(data.actual_amount_paid) || 0,
    });
    if (res.ok) onSaved();
  }

  return (
    <Modal title={`Salary · ${row.surname} ${row.first_name} · ${monthName(month)} ${year}`}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>Save</button>
      </>}>
      <div className="form-row">
        <Field label="Gross salary"><input className="input" type="number" value={data.gross_salary ?? ''}
          onChange={e => setData({ ...data, gross_salary: e.target.value })} /></Field>
        <Field label="Extra pay"><input className="input" type="number" value={data.extra_pay ?? ''}
          onChange={e => setData({ ...data, extra_pay: e.target.value })} /></Field>
      </div>
      <Field label="Extra pay description">
        <input className="input" value={data.extra_pay_description ?? ''}
          onChange={e => setData({ ...data, extra_pay_description: e.target.value })} />
      </Field>
      <div className="form-row-3">
        <Field label="Arrears B/F"><input className="input" type="number" value={data.arrear_brought_forward ?? ''}
          onChange={e => setData({ ...data, arrear_brought_forward: e.target.value })} /></Field>
        <Field label="PAYE tax"><input className="input" type="number" value={data.paye_tax ?? ''}
          onChange={e => setData({ ...data, paye_tax: e.target.value })} /></Field>
        <Field label="Other deductions"><input className="input" type="number" value={data.other_deductions ?? ''}
          onChange={e => setData({ ...data, other_deductions: e.target.value })} /></Field>
      </div>
      <Field label="Other deductions description">
        <input className="input" value={data.other_deductions_description ?? ''}
          onChange={e => setData({ ...data, other_deductions_description: e.target.value })} />
      </Field>
      <div className="form-row">
        <Field label="Actual amount paid"><input className="input" type="number" value={data.actual_amount_paid ?? ''}
          onChange={e => setData({ ...data, actual_amount_paid: e.target.value })} /></Field>
        <Field label="Payment date"><input className="input" type="date" value={data.payment_date ?? ''}
          onChange={e => setData({ ...data, payment_date: e.target.value })} /></Field>
      </div>
      <Field label="Mark as paid">
        <label className="row gap-2 mt-2">
          <input type="checkbox" checked={data.is_paid}
            onChange={e => setData({ ...data, is_paid: e.target.checked })} />
          <span>This salary has been paid out</span>
        </label>
      </Field>
    </Modal>
  );
}
function Field({ label, children }) {
  return <div className="form-group"><label className="label">{label}</label>{children}</div>;
}
function monthName(m) {
  return ['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1] || '';
}
