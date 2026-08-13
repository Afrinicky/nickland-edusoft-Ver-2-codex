// Homework / assignments — set and manage work per class.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

const NAVY = '#1B3A6B';

export default function HomeworkIndex() {
  const { classes, subjects, currentUser, toast, can } = useStore();
  const canEdit = can('academics', 'edit');
  const [classId, setClassId] = useState(null);
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ subjectId: '', title: '', description: '', dueDate: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => { if (classes && classes.length && classId == null) setClassId(classes[0].id); }, [classes]);

  async function load() {
    if (classId == null) return;
    setList(await window.api.homework.listClass(classId, true));
  }
  useEffect(() => { load(); }, [classId]);

  async function save() {
    if (!form.title.trim()) { toast('A title is required.', 'error'); return; }
    const r = await window.api.homework.save({
      classId, subjectId: form.subjectId ? Number(form.subjectId) : null,
      teacherId: currentUser?.staffId || null,
      title: form.title, description: form.description, dueDate: form.dueDate,
    });
    if (r.ok) { setForm({ subjectId: '', title: '', description: '', dueDate: '' }); toast('Homework set.', 'success'); load(); }
    else toast(r.error || 'Could not save.', 'error');
  }
  async function remove(id) {
    await window.api.homework.delete(id);
    toast('Homework removed.', 'success'); load();
  }

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h1 style={{ color: NAVY, margin: '0 0 4px' }}>Homework</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0 16px' }}>
        <label style={{ color: '#64748B', fontWeight: 600 }}>Class</label>
        <select value={classId ?? ''} onChange={e => setClassId(Number(e.target.value))} style={inp}>
          {(classes || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {canEdit && (
        <div style={card}>
          <h3 style={{ marginTop: 0, color: NAVY }}>Set new homework</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Subject (optional)</label>
              <select value={form.subjectId} onChange={e => set('subjectId', e.target.value)} style={inp}>
                <option value="">— none —</option>
                {(subjects || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Due date</label>
              <input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} style={inp} />
            </div>
          </div>
          <label style={lbl}>Title</label>
          <input value={form.title} onChange={e => set('title', e.target.value)} style={inp} placeholder="e.g. Maths exercise 4, questions 1–10" />
          <label style={lbl}>Details (optional)</label>
          <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} style={{ ...inp, resize: 'vertical' }} />
          <button style={primaryBtn} onClick={save}>Set homework</button>
        </div>
      )}

      <div style={{ ...card, marginTop: 16 }}>
        <h3 style={{ marginTop: 0, color: NAVY }}>Homework for this class</h3>
        {list.length === 0 && <div style={{ color: '#94A3B8' }}>None yet.</div>}
        {list.map(h => (
          <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid #E7EBF1' }}>
            <div>
              <div style={{ fontWeight: 700 }}>{h.title}</div>
              <div style={{ fontSize: 13, color: '#64748B' }}>
                {[h.subject_name, h.teacher_name, h.due_date ? `Due ${h.due_date}` : ''].filter(Boolean).join(' · ')}
              </div>
              {h.description && <div style={{ fontSize: 13, marginTop: 4 }}>{h.description}</div>}
            </div>
            {canEdit && <button style={linkBtn} onClick={() => remove(h.id)}>Remove</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

const card = { background: '#fff', border: '1px solid #E7EBF1', borderRadius: 12, padding: 16 };
const inp = { width: '100%', padding: '9px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14 };
const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: '#64748B', margin: '10px 0 4px' };
const primaryBtn = { background: NAVY, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontWeight: 700, cursor: 'pointer', marginTop: 12 };
const linkBtn = { background: 'none', border: 'none', color: '#B91C1C', cursor: 'pointer', fontWeight: 600 };
