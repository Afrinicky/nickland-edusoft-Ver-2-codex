// Nickland Edusoft — Discounts Sheet
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate } from '../../lib/format.js';

export default function DiscountsTab() {
  const { classes, currentUser } = useStore();
  const showToast = useStore(s => s.showToast);
  const [discounts, setDiscounts] = useState([]);
  const [filter, setFilter] = useState({ classId: '', activeOnly: true });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  async function refresh() {
    setLoading(true);
    const list = await window.api.discounts.list(filter);
    setDiscounts(list);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [filter]);

  async function revoke(d) {
    const reason = prompt(`Revoke ${d.discount_type === 'percent' ? d.discount_value + '%' : 'GHS ' + d.discount_value} discount for ${d.surname} ${d.first_name}?\n\nReason for revocation (required):`);
    if (!reason || !reason.trim()) return;
    const res = await window.api.discounts.revoke({ id: d.id, reason: reason.trim(), revokedBy: currentUser?.id });
    if (res.ok) {
      showToast('Discount revoked', 'success');
      refresh();
    } else showToast(res.error, 'error');
  }

  return (
    <div className="discounts-tab">
      <div className="card no-print">
        <div className="section-header">
          <div>
            <div className="section-title">Student Discounts</div>
            <div className="text-sm text-muted">
              Manage fee and books discounts. Apply at student profile or here directly.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => window.print()}>🖨 Print List</button>
            <button className="btn btn-primary" onClick={() => setEditing({})}>+ Add Discount</button>
          </div>
        </div>
        <div className="form-row" style={{ marginTop: 14 }}>
          <div className="form-group">
            <label>Class</label>
            <select value={filter.classId ?? ''} onChange={e => setFilter({ ...filter, classId: e.target.value })}>
              <option value="">All Classes</option>
              {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Show</label>
            <select value={filter.activeOnly ? 'active' : 'all'} onChange={e => setFilter({ ...filter, activeOnly: e.target.value === 'active' })}>
              <option value="active">Active only</option>
              <option value="all">All (active + revoked)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        {loading
          ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
          : discounts.length === 0
            ? <div className="empty-state">No discounts match the filter</div>
            : <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Index No.</th>
                      <th>Student</th>
                      <th>Class</th>
                      <th>Discount</th>
                      <th>Applies To</th>
                      <th>Reason</th>
                      <th>Granted By</th>
                      <th>Status</th>
                      <th className="no-print"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {discounts.map(d => (
                      <tr key={d.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{d.index_number}</td>
                        <td><strong>{d.surname}</strong>, {d.first_name} {d.other_names || ''}</td>
                        <td>{d.short_code}</td>
                        <td>
                          <strong>
                            {d.discount_type === 'percent'
                              ? `${d.discount_value}%`
                              : fmtCedi(d.discount_value)}
                          </strong>
                        </td>
                        <td><span className="badge badge-primary">{d.applies_to}</span></td>
                        <td className="text-sm">{d.reason}</td>
                        <td className="text-sm text-muted">{d.granted_by_name || '—'}</td>
                        <td>
                          {d.is_active
                            ? <span className="badge badge-success">Active</span>
                            : <span className="badge badge-muted">Revoked</span>
                          }
                        </td>
                        <td className="no-print">
                          {d.is_active && (
                            <>
                              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(d)}>Edit</button>
                              <button className="btn btn-ghost btn-sm" onClick={() => revoke(d)}>Revoke</button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
        }
      </div>

      {editing !== null && (
        <DiscountModal
          discount={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); showToast('Saved', 'success'); }}
        />
      )}
    </div>
  );
}

function DiscountModal({ discount, onClose, onSaved }) {
  const { currentUser } = useStore();
  const showToast = useStore(s => s.showToast);
  const [students, setStudents] = useState([]);
  const [form, setForm] = useState({
    id: discount.id || null,
    student_id: discount.student_id || '',
    discount_type: discount.discount_type || 'percent',
    discount_value: discount.discount_value || '',
    applies_to: discount.applies_to || 'fees',
    reason: discount.reason || '',
    is_active: discount.is_active !== undefined ? discount.is_active : 1,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!form.id) {
      (async () => {
        const list = await window.api.students.list({ status: 'Active' });
        setStudents(list);
      })();
    }
  }, []);

  async function save() {
    if (!form.student_id) return showToast('Select a student', 'warning');
    if (!form.reason.trim()) return showToast('Reason is required', 'warning');
    setSaving(true);
    const res = await window.api.discounts.save({ ...form, granted_by: currentUser?.id });
    setSaving(false);
    if (res.ok) onSaved();
    else showToast(res.error, 'error');
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{form.id ? 'Edit' : 'Add'} Discount</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {!form.id && (
          <div className="form-group">
            <label>Student</label>
            <select value={form.student_id ?? ''} onChange={e => setForm({ ...form, student_id: e.target.value })}>
              <option value="">— Select Student —</option>
              {students.map(s => (
                <option key={s.id} value={s.id ?? ''}>
                  {s.surname} {s.first_name} ({s.index_number}) · {s.class_name || 'No class'}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="form-row">
          <div className="form-group">
            <label>Type</label>
            <select value={form.discount_type ?? ''} onChange={e => setForm({ ...form, discount_type: e.target.value })}>
              <option value="percent">Percent (%)</option>
              <option value="fixed">Fixed Amount (GHS)</option>
            </select>
          </div>
          <div className="form-group">
            <label>Value</label>
            <input type="number" step="0.01" min="0"
              value={form.discount_value ?? ''}
              onChange={e => setForm({ ...form, discount_value: parseFloat(e.target.value) || 0 })}
              placeholder={form.discount_type === 'percent' ? '0 to 100' : '0.00'} />
          </div>
          <div className="form-group">
            <label>Applies To</label>
            <select value={form.applies_to ?? ''} onChange={e => setForm({ ...form, applies_to: e.target.value })}>
              <option value="fees">School Fees</option>
              <option value="books">Books</option>
              <option value="both">Both</option>
            </select>
          </div>
        </div>
        <div className="form-group">
          <label>Reason <span className="text-danger">*</span></label>
          <textarea rows="3" value={form.reason ?? ''} onChange={e => setForm({ ...form, reason: e.target.value })}
            placeholder="e.g. Staff child, Sibling discount, Scholarship, Hardship case" />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Discount'}
          </button>
        </div>
      </div>
    </div>
  );
}
