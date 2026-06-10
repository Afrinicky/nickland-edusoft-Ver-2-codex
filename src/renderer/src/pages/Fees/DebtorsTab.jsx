import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fullName, fmtCedi, fmtDate } from '../../lib/format.js';

export default function DebtorsTab() {
  const currentTerm = useStore(s => s.currentTerm);
  const showToast = useStore(s => s.showToast);
  const [debtors, setDebtors] = useState([]);

  async function refresh() {
    if (!currentTerm) return;
    const list = await window.api.fees.debtorsReport(currentTerm.id);
    setDebtors(list);
  }
  useEffect(() => { refresh(); }, [currentTerm]);

  async function printPdf() {
    if (!currentTerm) return;
    const res = await window.api.reports.generateDebtorsList(currentTerm.id, {});
    if (res.ok) showToast(`PDF saved: ${res.path.split(/[\\/]/).pop()}`);
  }

  const total = debtors.reduce((s, d) => s + (d.balance || 0), 0);
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Outstanding fees</div>
          <div className="card-subtitle">{debtors.length} student{debtors.length !== 1 ? 's' : ''} · {fmtCedi(total)} outstanding</div>
        </div>
        <button className="btn btn-primary" onClick={printPdf}>🖨 Print list</button>
      </div>
      <table className="table">
        <thead><tr><th>Index</th><th>Name</th><th>Class</th><th>Contact</th><th className="text-right">Balance</th></tr></thead>
        <tbody>
          {debtors.map(d => (
            <tr key={d.id}>
              <td className="bold">{d.index_number}</td>
              <td>{d.surname} {d.first_name}</td>
              <td>{d.class_name}</td>
              <td>{d.father_contact || d.mother_contact || d.guardian_contact || '—'}</td>
              <td className="text-right bold" style={{ color: 'var(--danger)' }}>{fmtCedi(d.balance)}</td>
            </tr>
          ))}
          {debtors.length === 0 && <tr><td colSpan="5"><div className="empty-state"><h3>No outstanding fees 🎉</h3></div></td></tr>}
        </tbody>
      </table>
    </div>
  );
}
