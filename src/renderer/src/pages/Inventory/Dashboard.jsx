// Nickland Edusoft — Inventory Dashboard
import React, { useEffect, useState } from 'react';
import { fmtCedi, fmtDate } from '../../lib/format.js';

export default function InventoryDashboard({ onSwitchTab }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const d = await window.api.inventory.dashboard();
    setData(d);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  if (loading || !data) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;
  }

  return (
    <div className="inventory-dashboard">
      {/* Metrics */}
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="metric-card">
          <div className="metric-body">
            <div className="metric-label">Total Items</div>
            <div className="metric-value">{data.metrics.total_items}</div>
            <div className="metric-sub">Distinct inventory items</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-body">
            <div className="metric-label">Stock Value</div>
            <div className="metric-value">{fmtCedi(data.metrics.total_value)}</div>
            <div className="metric-sub">Qty × unit cost</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-body">
            <div className="metric-label">Low Stock</div>
            <div className="metric-value" style={{ color: data.metrics.low_stock_count > 0 ? 'var(--warning)' : 'var(--success)' }}>
              {data.metrics.low_stock_count}
            </div>
            <div className="metric-sub">Items at/below reorder level</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-body">
            <div className="metric-label">Auto-Recorded</div>
            <div className="metric-value">{data.metrics.auto_records}</div>
            <div className="metric-sub">From purchase expenses</div>
          </div>
        </div>
      </div>

      {/* Low stock + by category */}
      <div className="dash-row" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 18 }}>
        <div className="card">
          <div className="section-header">
            <div className="section-title">Low Stock Alerts</div>
            <span className="section-view-all" onClick={() => onSwitchTab('items')}>View all →</span>
          </div>
          {data.low_stock.length === 0
            ? <div className="empty-state">All items above reorder levels ✓</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.low_stock.map(item => (
                  <div key={item.id} className="low-stock-row">
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</div>
                      <div className="text-xs text-muted">
                        Reorder at {item.reorder_level} {item.unit}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{
                        fontSize: 16, fontWeight: 700,
                        color: item.quantity_on_hand === 0 ? 'var(--danger)' : 'var(--warning)',
                      }}>
                        {item.quantity_on_hand} {item.unit}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>
        <div className="card">
          <div className="section-header">
            <div className="section-title">Inventory by Category</div>
          </div>
          {data.by_category.length === 0
            ? <div className="empty-state">No items categorized yet</div>
            : <div className="class-bar-list">
                {data.by_category.map(c => {
                  const max = Math.max(...data.by_category.map(x => x.value));
                  return (
                    <div key={c.category} className="class-bar-row">
                      <div className="class-bar-label">{labelize(c.category)}</div>
                      <div className="class-bar-track">
                        <div className="class-bar-fill" style={{ width: `${(c.value / max) * 100}%` }} />
                      </div>
                      <div className="class-bar-count" style={{ minWidth: 110, textAlign: 'right' }}>
                        {fmtCedi(c.value)} <span className="text-xs text-muted">({c.items})</span>
                      </div>
                    </div>
                  );
                })}
              </div>
          }
        </div>
      </div>

      {/* Recent movements */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="section-header">
          <div className="section-title">Recent Movements</div>
          <span className="section-view-all" onClick={() => onSwitchTab('movements')}>View all →</span>
        </div>
        {data.recent_movements.length === 0
          ? <div className="empty-state">No movements yet — purchases recorded under supplies/maintenance/construction will appear here automatically</div>
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
                          {m.movement_type === 'in' ? '⬇ Stock In' : '⬆ Stock Out'}
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

function labelize(s) {
  if (!s) return 'Uncategorized';
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
