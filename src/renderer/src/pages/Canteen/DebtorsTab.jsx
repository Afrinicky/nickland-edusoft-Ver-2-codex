import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi } from '../../lib/format.js';

export default function CanteenDebtorsTab() {
  const currentTerm = useStore(s => s.currentTerm);
  const [debtors, setDebtors] = useState([]);
  useEffect(() => {
    (async () => {
      if (!currentTerm) return;
      const list = await window.api.canteen.debtorsReport(currentTerm.id);
      setDebtors(list);
    })();
  }, [currentTerm]);
  const total = debtors.reduce((s, d) => s + (d.amount_owed || 0), 0);
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Canteen debtors</div>
          <div className="card-subtitle">{debtors.length} students · {fmtCedi(total)} owed</div>
        </div>
      </div>
      <table className="table">
        <thead><tr><th>Index</th><th>Name</th><th>Class</th><th className="text-right">Unpaid days</th><th className="text-right">Amount owed</th></tr></thead>
        <tbody>
          {debtors.map(d => (
            <tr key={d.id}>
              <td>{d.index_number}</td>
              <td>{d.surname} {d.first_name}</td>
              <td>{d.class_name}</td>
              <td className="text-right">{d.unpaid_days}</td>
              <td className="text-right bold" style={{ color: 'var(--danger)' }}>{fmtCedi(d.amount_owed)}</td>
            </tr>
          ))}
          {debtors.length === 0 && <tr><td colSpan="5"><div className="empty-state"><h3>No canteen debtors 🎉</h3></div></td></tr>}
        </tbody>
      </table>
    </div>
  );
}
