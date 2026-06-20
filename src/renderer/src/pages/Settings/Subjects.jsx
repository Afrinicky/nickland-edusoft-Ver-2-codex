import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import Modal from '../../components/Modal.jsx';

export default function Subjects() {
  const showToast = useStore(s => s.showToast);
  const [subjects, setSubjects] = useState([]);
  const [editing, setEditing] = useState(null);

  async function refresh() {
    setSubjects(await window.api.settings.listSubjects());
  }
  useEffect(() => { refresh(); }, []);

  async function save() {
    const res = await window.api.settings.saveSubject(editing);
    // Recompute every stored score for this subject so the new class/exam
    // weights take effect across all sheets in real time.
    const subjectId = res?.id || editing.id;
    if (subjectId) { try { await window.api.scores.recomputeSubject(subjectId); } catch { /* non-fatal */ } }
    setEditing(null); refresh(); showToast('Subject saved');
  }
  async function remove(id) {
    if (!confirm('Mark as inactive?')) return;
    await window.api.settings.deleteSubject(id); refresh();
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">Subjects</div>
        <button className="btn btn-primary" onClick={() => setEditing({ name: '', code: '', class_weight_pct: 40, exam_weight_pct: 60, is_active: 1 })}>+ Add subject</button>
      </div>
      <table className="table">
        <thead><tr><th>Name</th><th>Code</th><th className="text-right">Class %</th><th className="text-right">Exam %</th><th></th></tr></thead>
        <tbody>
          {subjects.map(s => (
            <tr key={s.id}>
              <td className="bold">{s.name}</td>
              <td><span className="badge badge-primary">{s.code}</span></td>
              <td className="text-right">{s.class_weight_pct}%</td>
              <td className="text-right">{s.exam_weight_pct}%</td>
              <td className="row gap-2">
                <button className="btn btn-outline btn-sm" onClick={() => setEditing(s)}>Edit</button>
                <button className="btn btn-ghost btn-sm" onClick={() => remove(s.id)}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <Modal title={editing.id ? 'Edit subject' : 'New subject'} onClose={() => setEditing(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Save</button></>}>
          <div className="form-group"><label className="label">Name</label>
            <input className="input" value={editing.name ?? ''} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
          <div className="form-group"><label className="label">Code</label>
            <input className="input" value={editing.code || ''} onChange={e => setEditing({ ...editing, code: e.target.value })} /></div>
          <div className="form-row">
            <div className="form-group"><label className="label">Class score weight %</label>
              <input className="input" type="number" value={editing.class_weight_pct ?? ''}
                onChange={e => setEditing({ ...editing, class_weight_pct: parseFloat(e.target.value) })} /></div>
            <div className="form-group"><label className="label">Exam score weight %</label>
              <input className="input" type="number" value={editing.exam_weight_pct ?? ''}
                onChange={e => setEditing({ ...editing, exam_weight_pct: parseFloat(e.target.value) })} /></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
