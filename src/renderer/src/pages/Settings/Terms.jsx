import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtDate } from '../../lib/format.js';
import Modal from '../../components/Modal.jsx';

export default function Terms() {
  const showToast = useStore(s => s.showToast);
  const loadClassesAndTerms = useStore(s => s.loadClassesAndTerms);
  const [years, setYears] = useState([]);
  const [terms, setTerms] = useState([]);
  const [editingYear, setEditingYear] = useState(null);
  const [editingTerm, setEditingTerm] = useState(null);

  async function refresh() {
    setYears(await window.api.settings.listAcademicYears());
    setTerms(await window.api.settings.listTerms());
    await loadClassesAndTerms();
  }
  useEffect(() => { refresh(); }, []);

  async function setCurrent(termId) {
    await window.api.settings.setCurrentTerm(termId);
    refresh();
    showToast('Current term updated');
  }

  return (
    <div>
      <div className="card mb-4">
        <div className="card-header">
          <div className="card-title">Academic years</div>
          <button className="btn btn-primary" onClick={() => setEditingYear({ label: '', start_date: '', end_date: '', is_current: 0 })}>+ Add year</button>
        </div>
        <table className="table">
          <thead><tr><th>Label</th><th>Start</th><th>End</th><th>Current</th><th></th></tr></thead>
          <tbody>
            {years.map(y => (
              <tr key={y.id}>
                <td className="bold">{y.label}</td>
                <td>{fmtDate(y.start_date)}</td>
                <td>{fmtDate(y.end_date)}</td>
                <td>{y.is_current ? <span className="badge badge-success">Current</span> : null}</td>
                <td><button className="btn btn-outline btn-sm" onClick={() => setEditingYear(y)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Terms</div>
          <button className="btn btn-primary" onClick={() => setEditingTerm({ academic_year_id: years[0]?.id, term_number: 1, label: '', start_date: '', end_date: '' })}>+ Add term</button>
        </div>
        <table className="table">
          <thead><tr><th>Year</th><th>Term</th><th>Label</th><th>Start</th><th>End</th><th>Current</th><th></th></tr></thead>
          <tbody>
            {terms.map(t => (
              <tr key={t.id}>
                <td>{t.year_label}</td>
                <td>{t.term_number}</td>
                <td className="bold">{t.label}</td>
                <td>{fmtDate(t.start_date)}</td>
                <td>{fmtDate(t.end_date)}</td>
                <td>{t.is_current ? <span className="badge badge-success">Current</span> :
                  <button className="btn btn-ghost btn-sm" onClick={() => setCurrent(t.id)}>Set current</button>}</td>
                <td><button className="btn btn-outline btn-sm" onClick={() => setEditingTerm(t)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingYear && (
        <Modal title={editingYear.id ? 'Edit academic year' : 'New academic year'} onClose={() => setEditingYear(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setEditingYear(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={async () => {
              await window.api.settings.saveAcademicYear(editingYear);
              setEditingYear(null); refresh(); showToast('Saved');
            }}>Save</button>
          </>}>
          <div className="form-group"><label className="label">Label</label>
            <input className="input" value={editingYear.label ?? ''} onChange={e => setEditingYear({ ...editingYear, label: e.target.value })} placeholder="2025/2026" /></div>
          <div className="form-row">
            <div className="form-group"><label className="label">Start date</label>
              <input className="input" type="date" value={editingYear.start_date || ''} onChange={e => setEditingYear({ ...editingYear, start_date: e.target.value })} /></div>
            <div className="form-group"><label className="label">End date</label>
              <input className="input" type="date" value={editingYear.end_date || ''} onChange={e => setEditingYear({ ...editingYear, end_date: e.target.value })} /></div>
          </div>
          <label className="row gap-2">
            <input type="checkbox" checked={!!editingYear.is_current} onChange={e => setEditingYear({ ...editingYear, is_current: e.target.checked ? 1 : 0 })} />
            <span>Mark as current academic year</span>
          </label>
        </Modal>
      )}
      {editingTerm && (
        <Modal title={editingTerm.id ? 'Edit term' : 'New term'} onClose={() => setEditingTerm(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setEditingTerm(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={async () => {
              await window.api.settings.saveTerm(editingTerm);
              setEditingTerm(null); refresh(); showToast('Saved');
            }}>Save</button>
          </>}>
          <div className="form-row">
            <div className="form-group"><label className="label">Academic year</label>
              <select className="select" value={editingTerm.academic_year_id ?? ''}
                onChange={e => setEditingTerm({ ...editingTerm, academic_year_id: parseInt(e.target.value) })}>
                {years.map(y => <option key={y.id} value={y.id ?? ''}>{y.label}</option>)}
              </select></div>
            <div className="form-group"><label className="label">Term number</label>
              <input className="input" type="number" value={editingTerm.term_number ?? ''}
                onChange={e => setEditingTerm({ ...editingTerm, term_number: parseInt(e.target.value) })} /></div>
          </div>
          <div className="form-group"><label className="label">Label</label>
            <input className="input" value={editingTerm.label ?? ''} onChange={e => setEditingTerm({ ...editingTerm, label: e.target.value })} placeholder="First Term" /></div>
          <div className="form-row">
            <div className="form-group"><label className="label">Start date</label>
              <input className="input" type="date" value={editingTerm.start_date || ''} onChange={e => setEditingTerm({ ...editingTerm, start_date: e.target.value })} /></div>
            <div className="form-group"><label className="label">End date</label>
              <input className="input" type="date" value={editingTerm.end_date || ''} onChange={e => setEditingTerm({ ...editingTerm, end_date: e.target.value })} /></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
