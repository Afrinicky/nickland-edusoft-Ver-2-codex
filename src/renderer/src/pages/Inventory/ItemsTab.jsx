// Nickland Edusoft — Inventory Items Tab
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate } from '../../lib/format.js';

export default function InventoryItemsTab() {
  const showToast = useStore(s => s.showToast);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState({ search: '', category: '', lowStock: false });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [opened, setOpened] = useState(null);  // item detail view

  async function refresh() {
    setLoading(true);
    const list = await window.api.inventory.listItems(filter);
    setItems(list);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [filter]);

  if (opened) {
    return <ItemDetail itemId={opened} onClose={() => { setOpened(null); refresh(); }} />;
  }

  return (
    <div className="inventory-items-tab">
      <div className="card no-print">
        <div className="section-header">
          <div className="section-title">Inventory Items</div>
          <button className="btn btn-primary" onClick={() => setEditing({})}>+ Add Item</button>
        </div>
        <div className="form-row" style={{ marginTop: 14 }}>
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label>Search</label>
            <input type="text" value={filter.search ?? ''} onChange={e => setFilter({ ...filter, search: e.target.value })}
              placeholder="Item name…" />
          </div>
          <div className="form-group">
            <label>Category</label>
            <select value={filter.category ?? ''} onChange={e => setFilter({ ...filter, category: e.target.value })}>
              <option value="">All Categories</option>
              <option value="supplies">Supplies</option>
              <option value="canteen_supplies">Canteen Supplies</option>
              <option value="construction">Construction</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 24 }}>
              <input type="checkbox" checked={filter.lowStock}
                onChange={e => setFilter({ ...filter, lowStock: e.target.checked })} />
              Show only low-stock items
            </label>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        {loading
          ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
          : items.length === 0
            ? <div className="empty-state">No items found</div>
            : <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Category</th>
                      <th>Unit</th>
                      <th className="text-right">On Hand</th>
                      <th className="text-right">Unit Cost</th>
                      <th className="text-right">Total Value</th>
                      <th className="text-right">Reorder Level</th>
                      <th>Movements</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => {
                      const lowStock = item.reorder_level > 0 && item.quantity_on_hand <= item.reorder_level;
                      const totalValue = item.quantity_on_hand * item.unit_cost;
                      return (
                        <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => setOpened(item.id)}>
                          <td>
                            <strong>{item.name}</strong>
                            {item.location && <div className="text-xs text-muted">{item.location}</div>}
                          </td>
                          <td><span className="badge badge-muted">{item.category || '—'}</span></td>
                          <td>{item.unit}</td>
                          <td className="text-right">
                            <strong style={{ color: lowStock ? 'var(--warning)' : 'inherit' }}>
                              {item.quantity_on_hand}
                            </strong>
                            {lowStock && <span className="text-xs" style={{ marginLeft: 4 }}>⚠</span>}
                          </td>
                          <td className="text-right">{fmtCedi(item.unit_cost)}</td>
                          <td className="text-right"><strong>{fmtCedi(totalValue)}</strong></td>
                          <td className="text-right text-muted">{item.reorder_level || '—'}</td>
                          <td className="text-sm text-muted">{item.movement_count}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
        }
      </div>

      {editing !== null && (
        <ItemFormModal
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); showToast('Saved', 'success'); }}
        />
      )}
    </div>
  );
}

function ItemFormModal({ item, onClose, onSaved }) {
  const showToast = useStore(s => s.showToast);
  const [form, setForm] = useState({
    id: item.id || null,
    name: item.name || '',
    category: item.category || 'supplies',
    unit: item.unit || 'piece',
    unit_cost: item.unit_cost || 0,
    initial_quantity: 0,
    reorder_level: item.reorder_level || 0,
    location: item.location || '',
    notes: item.notes || '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.name.trim()) return showToast('Name is required', 'warning');
    setSaving(true);
    const res = await window.api.inventory.saveItem(form);
    setSaving(false);
    if (res.ok) onSaved();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{form.id ? 'Edit' : 'Add'} Inventory Item</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form-group">
          <label>Name <span className="text-danger">*</span></label>
          <input type="text" value={form.name ?? ''} onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. A4 Paper Ream" autoFocus />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Category</label>
            <select value={form.category ?? ''} onChange={e => setForm({ ...form, category: e.target.value })}>
              <option value="supplies">Supplies</option>
              <option value="canteen_supplies">Canteen Supplies</option>
              <option value="construction">Construction</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </div>
          <div className="form-group">
            <label>Unit</label>
            <input type="text" value={form.unit ?? ''} onChange={e => setForm({ ...form, unit: e.target.value })}
              placeholder="piece, ream, box, kg…" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Unit Cost (GHS)</label>
            <input type="number" step="0.01" min="0" value={form.unit_cost ?? ''}
              onChange={e => setForm({ ...form, unit_cost: parseFloat(e.target.value) || 0 })} />
          </div>
          {!form.id && (
            <div className="form-group">
              <label>Initial Quantity</label>
              <input type="number" step="0.01" min="0" value={form.initial_quantity ?? ''}
                onChange={e => setForm({ ...form, initial_quantity: parseFloat(e.target.value) || 0 })} />
            </div>
          )}
          <div className="form-group">
            <label>Reorder Level</label>
            <input type="number" step="0.01" min="0" value={form.reorder_level ?? ''}
              onChange={e => setForm({ ...form, reorder_level: parseFloat(e.target.value) || 0 })}
              placeholder="0 = no alert" />
          </div>
        </div>
        <div className="form-group">
          <label>Storage Location</label>
          <input type="text" value={form.location ?? ''} onChange={e => setForm({ ...form, location: e.target.value })}
            placeholder="e.g. Stationery Cabinet" />
        </div>
        <div className="form-group">
          <label>Notes</label>
          <textarea rows="2" value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !form.name.trim()}>
            {saving ? 'Saving…' : 'Save Item'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemDetail({ itemId, onClose }) {
  const { currentUser } = useStore();
  const showToast = useStore(s => s.showToast);
  const [item, setItem] = useState(null);
  const [showMove, setShowMove] = useState(null);

  async function refresh() {
    const d = await window.api.inventory.getItem(itemId);
    setItem(d);
  }
  useEffect(() => { refresh(); }, [itemId]);

  if (!item) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;

  return (
    <div className="inventory-item-detail">
      <div className="card no-print">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>← Back to Items</button>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-header">
          <div>
            <h2 style={{ margin: 0 }}>{item.name}</h2>
            <div className="text-sm text-muted">
              <span className="badge badge-muted">{item.category || 'Uncategorized'}</span>
              {item.location && <span style={{ marginLeft: 10 }}>· {item.location}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline" onClick={() => setShowMove('in')}>⬇ Stock In</button>
            <button className="btn btn-outline" onClick={() => setShowMove('out')}>⬆ Stock Out</button>
          </div>
        </div>
        <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 14 }}>
          <div className="metric-card"><div className="metric-body">
            <div className="metric-label">On Hand</div>
            <div className="metric-value">{item.quantity_on_hand} {item.unit}</div>
          </div></div>
          <div className="metric-card"><div className="metric-body">
            <div className="metric-label">Unit Cost</div>
            <div className="metric-value">{fmtCedi(item.unit_cost)}</div>
          </div></div>
          <div className="metric-card"><div className="metric-body">
            <div className="metric-label">Total Value</div>
            <div className="metric-value">{fmtCedi(item.quantity_on_hand * item.unit_cost)}</div>
          </div></div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title">Movement History</div>
        {item.movements.length === 0
          ? <div className="empty-state">No movements yet</div>
          : <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Date</th><th>Type</th><th className="text-right">Qty</th><th className="text-right">Unit Cost</th><th className="text-right">Total</th><th>Reference</th><th>Notes</th></tr>
                </thead>
                <tbody>
                  {item.movements.map(m => (
                    <tr key={m.id}>
                      <td>{fmtDate(m.movement_date)}</td>
                      <td>
                        <span className={'badge ' + (m.movement_type === 'in' ? 'badge-success' : 'badge-warning')}>
                          {m.movement_type === 'in' ? '⬇ In' : '⬆ Out'}
                        </span>
                      </td>
                      <td className="text-right">{m.quantity}</td>
                      <td className="text-right">{fmtCedi(m.unit_cost)}</td>
                      <td className="text-right">{fmtCedi(m.total_cost)}</td>
                      <td className="text-sm" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                        {m.transaction_number || m.reference || '—'}
                      </td>
                      <td className="text-sm text-muted">{m.expense_description || m.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        }
      </div>

      {showMove && (
        <MovementModal
          itemId={itemId}
          type={showMove}
          item={item}
          recordedBy={currentUser?.id}
          onClose={() => setShowMove(null)}
          onSaved={() => { setShowMove(null); refresh(); showToast('Movement recorded', 'success'); }}
        />
      )}
    </div>
  );
}

function MovementModal({ itemId, type, item, recordedBy, onClose, onSaved }) {
  const showToast = useStore(s => s.showToast);
  const [form, setForm] = useState({
    quantity: 0,
    unit_cost: item.unit_cost || 0,
    movement_date: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.quantity || form.quantity <= 0) return showToast('Quantity required', 'warning');
    if (type === 'out' && form.quantity > item.quantity_on_hand) {
      if (!confirm(`Stock-out quantity exceeds on-hand. Continue anyway?`)) return;
    }
    setSaving(true);
    const res = await window.api.inventory.recordMovement({
      inventory_item_id: itemId,
      movement_type: type,
      quantity: form.quantity,
      unit_cost: form.unit_cost,
      movement_date: form.movement_date,
      notes: form.notes,
      recorded_by: recordedBy,
    });
    setSaving(false);
    if (res.ok) onSaved();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Stock {type === 'in' ? 'In' : 'Out'} — {item.name}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Quantity ({item.unit})</label>
            <input type="number" step="0.01" min="0" value={form.quantity ?? ''}
              onChange={e => setForm({ ...form, quantity: parseFloat(e.target.value) || 0 })} autoFocus />
          </div>
          {type === 'in' && (
            <div className="form-group">
              <label>Unit Cost (GHS)</label>
              <input type="number" step="0.01" min="0" value={form.unit_cost ?? ''}
                onChange={e => setForm({ ...form, unit_cost: parseFloat(e.target.value) || 0 })} />
            </div>
          )}
          <div className="form-group">
            <label>Date</label>
            <input type="date" value={form.movement_date ?? ''}
              onChange={e => setForm({ ...form, movement_date: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label>Notes</label>
          <textarea rows="2" value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })}
            placeholder={type === 'in' ? 'e.g. From supplier X' : 'e.g. Issued to canteen'} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Recording…' : `Record Stock ${type === 'in' ? 'In' : 'Out'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
