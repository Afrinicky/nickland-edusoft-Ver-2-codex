// Nickland Edusoft — Inventory Movements Tab
import React, { useEffect, useState } from 'react';
import { fmtCedi, fmtDate } from '../../lib/format.js';

export default function InventoryMovementsTab() {
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      const d = await window.api.inventory.dashboard();
      setData(d);
    })();
  }, []);

  if (!data) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;

  return (
    <div className="inventory-movements-tab">
      <div className="card">
        <div className="section-header">
          <div className="section-title">All Movements</div>
          <button className="btn btn-outline btn-sm" onClick={() => window.print()}>🖨 Print</button>
        </div>
        {data.recent_movements.length === 0
          ? <div className="empty-state">No inventory movements yet</div>
          : <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Date</th><th>Item</th><th>Type</th><th className="text-right">Quantity</th><th className="text-right">Unit Cost</th><th className="text-right">Total</th></tr>
                </thead>
                <tbody>
                  {data.recent_movements.map(m => (
                    <tr key={m.id}>
                      <td>{fmtDate(m.movement_date)}</td>
                      <td><strong>{m.item_name}</strong></td>
                      <td>
                        <span className={'badge ' + (m.movement_type === 'in' ? 'badge-success' : 'badge-warning')}>
                          {m.movement_type === 'in' ? '⬇ In' : '⬆ Out'}
                        </span>
                      </td>
                      <td className="text-right">{m.quantity} {m.unit}</td>
                      <td className="text-right">{fmtCedi(m.unit_cost)}</td>
                      <td className="text-right"><strong>{fmtCedi(m.total_cost)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        }
      </div>
    </div>
  );
}
