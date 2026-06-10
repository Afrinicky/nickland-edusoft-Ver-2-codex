import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import Modal from '../../components/Modal.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';

// Classes module: supports adding sections (e.g. BS6 A, BS6 B) and JHS levels.
// Each class can optionally be a "section of" another class.
export default function Classes() {
  const showToast = useStore(s => s.showToast);
  const loadClassesAndTerms = useStore(s => s.loadClassesAndTerms);
  const [classes, setClasses] = useState([]);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  // F8c — subject mapping state
  const [allSubjects, setAllSubjects] = useState([]);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState([]);
  const [mappingLoading, setMappingLoading] = useState(false);

  async function refresh() {
    const list = await window.api.settings.listClasses();
    setClasses(list);
    await loadClassesAndTerms();
  }
  useEffect(() => { refresh(); }, []);

  // F8c — load the master list of subjects once (used to render checkboxes)
  useEffect(() => {
    (async () => {
      try {
        const subs = await window.api.settings.listSubjects();
        setAllSubjects(Array.isArray(subs) ? subs : []);
      } catch (err) {
        console.warn('[Classes/F8c] could not load subjects list:', err.message);
        setAllSubjects([]);
      }
    })();
  }, []);

  // F8c — when the modal opens for an existing class, pre-fill the checked
  // subjects from the current mapping. For a brand-new class, start empty.
  useEffect(() => {
    if (!editing) {
      setSelectedSubjectIds([]);
      return;
    }
    if (!editing.id) {
      setSelectedSubjectIds([]);
      return;
    }
    (async () => {
      setMappingLoading(true);
      try {
        const mapped = await window.api.settings.getClassSubjects(editing.id);
        setSelectedSubjectIds((mapped || []).map(s => s.id));
      } catch (err) {
        console.warn('[Classes/F8c] could not load class mapping:', err.message);
        setSelectedSubjectIds([]);
      } finally {
        setMappingLoading(false);
      }
    })();
  }, [editing?.id]);

  function toggleSubject(id) {
    setSelectedSubjectIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }
  function selectAllSubjects() {
    setSelectedSubjectIds(allSubjects.map(s => s.id));
  }
  function clearSubjectSelection() {
    setSelectedSubjectIds([]);
  }

  function openNew() {
    setEditing({
      name: '', short_code: '', level_category: 'basic',
      level_order: (classes[classes.length - 1]?.level_order || 0) + 1,
      section: '', parent_class_id: null, capacity: '', is_active: 1,
    });
  }

  function openSection(parent) {
    // Create a sibling section (A/B) of an existing class
    const existingSiblings = classes.filter(c => c.parent_class_id === parent.id || c.id === parent.id);
    const usedSections = existingSiblings.map(c => c.section).filter(Boolean);
    const nextSection = ['A', 'B', 'C', 'D', 'E'].find(s => !usedSections.includes(s)) || 'F';

    setEditing({
      name: `${parent.name} ${nextSection}`,
      short_code: `${parent.short_code}${nextSection}`,
      level_category: parent.level_category,
      level_order: parent.level_order,
      section: nextSection,
      parent_class_id: parent.id,
      capacity: '',
      is_active: 1,
    });
  }

  async function save() {
    if (!editing.name) { alert('Name is required'); return; }
    const res = await window.api.settings.saveClass(editing);
    // F8c — persist the subject mapping using the id returned from saveClass.
    // For new classes the id comes from lastInsertRowid; for edits it's data.id.
    // If saveClass somehow returned no id, fall back gracefully (don't crash;
    // the class itself is already saved).
    const classId = res?.id;
    if (classId) {
      try {
        await window.api.settings.setClassSubjects(classId, selectedSubjectIds);
      } catch (err) {
        console.warn('[Classes/F8c] could not save class-subject mapping:', err.message);
        showToast('Class saved, but subject mapping could not be saved.', 'error');
        setEditing(null);
        refresh();
        return;
      }
    }
    setEditing(null);
    refresh();
    showToast('Class saved');
  }

  async function doDelete() {
    const res = await window.api.settings.deleteClass(confirmDel.id);
    if (res.ok) { showToast('Class deleted'); refresh(); }
    else showToast(res.error, 'error');
    setConfirmDel(null);
  }

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Classes</div>
            <div className="card-subtitle">Add classes, sections (A/B), and JHS levels for any school</div>
          </div>
          <button className="btn btn-primary" onClick={openNew}>+ Add class</button>
        </div>
        <table className="table">
          <thead><tr>
            <th>Order</th><th>Name</th><th>Short code</th><th>Category</th>
            <th>Section</th><th>Parent</th><th>Students</th><th></th>
          </tr></thead>
          <tbody>
            {classes.map(c => (
              <tr key={c.id}>
                <td>{c.level_order}</td>
                <td className="bold">{c.name}</td>
                <td><span className="badge badge-primary">{c.short_code}</span></td>
                <td>{c.level_category}</td>
                <td>{c.section || '—'}</td>
                <td>{c.parent_name || '—'}</td>
                <td>{c.student_count}</td>
                <td className="row gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={() => openSection(c)}>+ Section</button>
                  <button className="btn btn-outline btn-sm" onClick={() => setEditing(c)}>Edit</button>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDel(c)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-muted text-sm mt-3">
          Use <b>+ Section</b> on a class to add a parallel class (e.g. BS6 A, BS6 B) sharing the same level.
        </div>
      </div>

      {editing && (
        <Modal title={editing.id ? 'Edit class' : 'Add class'} onClose={() => setEditing(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Save</button></>}>
          <Field label="Name *">
            <input className="input" value={editing.name ?? ''} onChange={e => setEditing({ ...editing, name: e.target.value })} />
          </Field>
          <div className="form-row">
            <Field label="Short code">
              <input className="input" value={editing.short_code ?? ''} onChange={e => setEditing({ ...editing, short_code: e.target.value })} />
              <div className="helper">Used in IDs and headers (e.g. BS5, JHS1)</div>
            </Field>
            <Field label="Level category">
              <select className="select" value={editing.level_category ?? ''}
                onChange={e => setEditing({ ...editing, level_category: e.target.value })}>
                <option value="nursery">Nursery</option>
                <option value="kindergarten">Kindergarten</option>
                <option value="basic">Basic</option>
                <option value="jhs">Junior High School</option>
                <option value="shs">Senior High School</option>
              </select>
            </Field>
          </div>
          <div className="form-row-3">
            <Field label="Level order">
              <input className="input" type="number" value={editing.level_order ?? ''}
                onChange={e => setEditing({ ...editing, level_order: parseInt(e.target.value) })} />
              <div className="helper">Lower comes first</div>
            </Field>
            <Field label="Section (optional)">
              <input className="input" value={editing.section || ''}
                onChange={e => setEditing({ ...editing, section: e.target.value.toUpperCase() })}
                placeholder="e.g. A or B" />
            </Field>
            <Field label="Capacity">
              <input className="input" type="number" value={editing.capacity || ''}
                onChange={e => setEditing({ ...editing, capacity: parseInt(e.target.value) || null })} />
            </Field>
          </div>
          <Field label="Parent class (if this is a section)">
            <select className="select" value={editing.parent_class_id || ''}
              onChange={e => setEditing({ ...editing, parent_class_id: parseInt(e.target.value) || null })}>
              <option value="">— Standalone class —</option>
              {classes.filter(c => !c.parent_class_id && c.id !== editing.id).map(c =>
                <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
            </select>
          </Field>

          {/* F8c — Class → Subject mapping. Choose which subjects appear on
              this class's report card. If NONE are checked, the report card
              will show ALL subjects (default behaviour preserved for any
              class the user hasn't explicitly mapped). */}
          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>Subjects taught in this class</span>
              <span className="text-xs text-muted" style={{ fontWeight: 400 }}>
                {mappingLoading
                  ? 'Loading…'
                  : `${selectedSubjectIds.length} of ${allSubjects.length} selected`}
              </span>
              <div style={{ flex: 1 }} />
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={selectAllSubjects} disabled={mappingLoading || allSubjects.length === 0}>
                Select all
              </button>
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={clearSubjectSelection} disabled={mappingLoading || selectedSubjectIds.length === 0}>
                Clear
              </button>
            </label>
            <div className="helper" style={{ marginBottom: 8 }}>
              When <b>nothing is checked</b>, the report card shows <b>all active subjects</b> by default.
              To restrict the printed card to a subset, check only the subjects this class is taught.
            </div>
            {allSubjects.length === 0
              ? <div className="text-sm text-muted" style={{ padding: 12, border: '1px dashed #d1d5db', borderRadius: 6 }}>
                  No subjects defined yet. Add subjects under Settings → Subjects first.
                </div>
              : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: '4px 12px',
                  maxHeight: 240,
                  overflowY: 'auto',
                  padding: '8px 10px',
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  background: '#fafafa',
                }}>
                  {allSubjects.map(sub => (
                    <label key={sub.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '4px 0', cursor: 'pointer', fontSize: 13,
                    }}>
                      <input
                        type="checkbox"
                        checked={selectedSubjectIds.includes(sub.id)}
                        onChange={() => toggleSubject(sub.id)}
                        disabled={mappingLoading}
                      />
                      <span>{sub.name}</span>
                      {sub.code && (
                        <span className="text-xs text-muted">({sub.code})</span>
                      )}
                    </label>
                  ))}
                </div>
              )}
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirmDel}
        title="Delete class?"
        message={confirmDel ? `Delete "${confirmDel.name}"? This cannot be undone.` : ''}
        danger
        confirmLabel="Delete"
        onCancel={() => setConfirmDel(null)}
        onConfirm={doDelete}
      />
    </div>
  );
}

function Field({ label, children }) {
  return <div className="form-group"><label className="label">{label}</label>{children}</div>;
}
