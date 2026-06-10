import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fullName, fmtCedi, fmtDate } from '../../lib/format.js';
import Modal from '../../components/Modal.jsx';

export default function TemplatesTab() {
  const showToast = useStore(s => s.showToast);
  const classes = useStore(s => s.classes);
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null);

  async function refresh() {
    const list = await window.api.fees.listTemplates();
    setTemplates(list);
  }
  useEffect(() => { refresh(); }, []);

  async function openNew() {
    setEditing({ name: '', class_group_id: '', items: [], is_active: 1 });
  }
  async function openEdit(tpl) {
    const full = await window.api.fees.getTemplate(tpl.id);
    setEditing(full);
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">Fee templates</div>
        <button className="btn btn-primary" onClick={openNew}>+ New template</button>
      </div>
      <table className="table">
        <thead><tr><th>Name</th><th>Class</th><th>Term</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {templates.map(t => (
            <tr key={t.id}>
              <td className="bold">{t.name}</td>
              <td>{t.class_name || 'All classes'}</td>
              <td>{t.term_label || 'All terms'}</td>
              <td>{t.is_active ? <span className="badge badge-success">Active</span> : <span className="badge badge-muted">Inactive</span>}</td>
              <td><button className="btn btn-outline btn-sm" onClick={() => openEdit(t)}>Edit</button></td>
            </tr>
          ))}
          {templates.length === 0 && <tr><td colSpan="5"><div className="empty-state"><h3>No fee templates yet</h3></div></td></tr>}
        </tbody>
      </table>

      {editing && (
        <TemplateEditor template={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); showToast('Template saved'); }}
        />
      )}
    </div>
  );
}

function TemplateEditor({ template, onClose, onSaved }) {
  const classes = useStore(s => s.classes);
  const [data, setData] = useState({
    ...template,
    items: template.items && template.items.length > 0
      ? template.items
      : [{ item_number: 1, description: '', amount: 0 }],
  });

  function addItem() {
    setData({ ...data, items: [...data.items, { item_number: data.items.length + 1, description: '', amount: 0 }] });
  }
  function removeItem(i) {
    setData({ ...data, items: data.items.filter((_, idx) => idx !== i) });
  }
  function setItem(i, field, value) {
    const items = data.items.map((it, idx) => idx === i ? { ...it, [field]: value } : it);
    setData({ ...data, items });
  }

  async function save() {
    if (!data.name) { alert('Name is required'); return; }
    const res = await window.api.fees.saveTemplate(data);
    if (res.ok) onSaved();
  }

  const total = data.items.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);

  return (
    <Modal title={data.id ? 'Edit template' : 'New template'} onClose={onClose} size="lg"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>Save</button>
      </>}>
      <div className="form-row">
        <div className="form-group">
          <label className="label">Template name</label>
          <input className="input" value={data.name ?? ''} onChange={e => setData({ ...data, name: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="label">Class</label>
          <select className="select" value={data.class_group_id || ''}
            onChange={e => setData({ ...data, class_group_id: parseInt(e.target.value) || null })}>
            <option value="">— Apply to all classes —</option>
            {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
          </select>
        </div>
      </div>

      <h4 style={{ fontSize: 13 }}>Line items</h4>
      <table className="table">
        <thead><tr><th>#</th><th>Description</th><th className="text-right">Amount</th><th></th></tr></thead>
        <tbody>
          {data.items.map((item, i) => (
            <tr key={i}>
              <td><input className="input" style={{ width: 60 }} type="number" value={item.item_number ?? ''}
                onChange={e => setItem(i, 'item_number', parseInt(e.target.value))} /></td>
              <td><input className="input" value={item.description ?? ''}
                onChange={e => setItem(i, 'description', e.target.value)} /></td>
              <td><input className="input text-right" type="number" step="0.01" value={item.amount ?? ''}
                onChange={e => setItem(i, 'amount', e.target.value)} /></td>
              <td><button className="btn btn-ghost btn-sm" onClick={() => removeItem(i)}>✕</button></td>
            </tr>
          ))}
          <tr><td colSpan="3" className="text-right bold">Total</td><td className="text-right bold">{fmtCedi(total)}</td></tr>
        </tbody>
      </table>
      <button className="btn btn-outline btn-sm" onClick={addItem}>+ Add line item</button>
    </Modal>
  );
}

