// Timetable — authoring UI: a school-wide bell schedule (periods) plus a
// per-class weekly grid mapping each period to a subject + teacher.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

const NAVY = '#1B3A6B';
const GOLD = '#C9961A';

export default function TimetableIndex() {
  const { classes, subjects, toast, can } = useStore();
  const canEdit = can('academics', 'edit');

  const [periods, setPeriods] = useState([]);
  const [staff, setStaff] = useState([]);
  const [classId, setClassId] = useState(null);
  const [grid, setGrid] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadPeriods() {
    const p = await window.api.timetable.listPeriods();
    setPeriods(p || []);
    return p || [];
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      let p = await loadPeriods();
      if (p.length === 0) { await window.api.timetable.seedDefaultPeriods(); p = await loadPeriods(); }
      try { setStaff(await window.api.staff.list({ status: 'Active' })); } catch (_) { setStaff([]); }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (classes && classes.length && classId == null) setClassId(classes[0].id);
  }, [classes]);

  useEffect(() => {
    if (classId == null) return;
    window.api.timetable.getClass(classId).then(setGrid);
  }, [classId, periods.length]);

  // Any active staff member can be assigned to a period (teaching + support).
  const teachers = staff || [];

  if (loading) return <div style={{ padding: 24 }}>Loading timetable…</div>;

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1 style={{ color: NAVY, margin: '0 0 4px' }}>Timetable</h1>
      <p style={{ color: '#64748B', marginTop: 0 }}>
        Set the school's daily periods once, then fill each class's weekly grid.
      </p>

      <BellSchedule periods={periods} canEdit={canEdit} onChange={loadPeriods} toast={toast} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0 12px', flexWrap: 'wrap' }}>
        <h2 style={{ color: NAVY, margin: 0 }}>Class timetable</h2>
        <select value={classId ?? ''} onChange={e => setClassId(Number(e.target.value))}
          style={selStyle}>
          {(classes || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <ExportButtons classId={classId} className={(classes || []).find(c => c.id === classId)?.name} toast={toast} />
      </div>

      {grid
        ? <ClassGrid grid={grid} subjects={subjects || []} teachers={teachers}
            classId={classId} canEdit={canEdit} onSaved={() => window.api.timetable.getClass(classId).then(setGrid)} toast={toast} />
        : <div>Select a class.</div>}
    </div>
  );
}

function ExportButtons({ classId, className, toast }) {
  const [busy, setBusy] = useState(null);
  async function run(format) {
    if (!classId) return;
    const ext = format === 'excel' ? 'xlsx' : 'pdf';
    const safe = String(className || 'class').replace(/[^a-z0-9]+/gi, '_');
    const res = await window.api.app.showSaveDialog({
      title: `Export Timetable as ${format === 'excel' ? 'Excel' : 'PDF'}`,
      defaultPath: `timetable_${safe}.${ext}`,
      filters: [{ name: format === 'excel' ? 'Excel Workbook' : 'PDF Document', extensions: [ext] }],
    });
    if (res.canceled || !res.filePath) return;
    setBusy(format);
    try {
      const out = format === 'excel'
        ? await window.api.timetable.exportClassExcel({ classId, savePath: res.filePath })
        : await window.api.timetable.exportClassPdf({ classId, savePath: res.filePath });
      if (out.ok) toast(`Timetable exported to ${ext.toUpperCase()}.`, 'success');
      else toast(out.error || 'Export failed.', 'error');
    } catch (e) { toast(e?.message || 'Export failed.', 'error'); }
    finally { setBusy(null); }
  }
  return (
    <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
      <button onClick={() => run('excel')} disabled={!!busy} style={ghostBtn}>{busy === 'excel' ? 'Exporting…' : 'Export Excel'}</button>
      <button onClick={() => run('pdf')} disabled={!!busy} style={ghostBtn}>{busy === 'pdf' ? 'Exporting…' : 'Export PDF'}</button>
    </div>
  );
}

function BellSchedule({ periods, canEdit, onChange, toast }) {
  const [form, setForm] = useState({ label: '', start_time: '', end_time: '', is_break: false });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function add() {
    if (!form.label || !form.start_time || !form.end_time) { toast('Label, start and end time are required.', 'error'); return; }
    const r = await window.api.timetable.savePeriod({ ...form, display_order: periods.length });
    if (r.ok) { setForm({ label: '', start_time: '', end_time: '', is_break: false }); onChange(); toast('Period added.', 'success'); }
    else toast(r.error || 'Could not save.', 'error');
  }
  async function remove(id) {
    await window.api.timetable.deletePeriod(id);
    onChange(); toast('Period removed.', 'success');
  }

  return (
    <div style={cardStyle}>
      <h3 style={{ margin: '0 0 10px', color: NAVY }}>Bell schedule</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#64748B', fontSize: 13 }}>
            <th style={thStyle}>Period</th><th style={thStyle}>Start</th><th style={thStyle}>End</th><th style={thStyle}>Type</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {periods.map(p => (
            <tr key={p.id} style={{ borderTop: '1px solid #E7EBF1' }}>
              <td style={tdStyle}>{p.label}</td>
              <td style={tdStyle}>{p.start_time}</td>
              <td style={tdStyle}>{p.end_time}</td>
              <td style={tdStyle}>{p.is_break ? <span style={{ color: GOLD, fontWeight: 700 }}>Break</span> : 'Lesson'}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                {canEdit && <button onClick={() => remove(p.id)} style={linkBtn}>Remove</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Label (e.g. Period 1)" value={form.label} onChange={e => set('label', e.target.value)} style={inputStyle} />
          <input placeholder="08:00" value={form.start_time} onChange={e => set('start_time', e.target.value)} style={{ ...inputStyle, width: 90 }} />
          <input placeholder="08:40" value={form.end_time} onChange={e => set('end_time', e.target.value)} style={{ ...inputStyle, width: 90 }} />
          <label style={{ fontSize: 13, color: '#64748B', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={form.is_break} onChange={e => set('is_break', e.target.checked)} /> Break
          </label>
          <button onClick={add} style={primaryBtn}>Add period</button>
        </div>
      )}
    </div>
  );
}

function ClassGrid({ grid, subjects, teachers, classId, canEdit, onSaved, toast }) {
  const days = grid.days || [];
  const periods = grid.periods || [];
  const [saving, setSaving] = useState(null);

  async function save(dayValue, periodId, patch, current) {
    setSaving(`${dayValue}:${periodId}`);
    const subjectId = 'subject_id' in patch ? patch.subject_id : (current?.subject_id || null);
    const teacherId = 'teacher_id' in patch ? patch.teacher_id : (current?.teacher_id || null);
    const r = await window.api.timetable.saveEntry({ classId, dayOfWeek: dayValue, periodId, subjectId: subjectId || null, teacherId: teacherId || null });
    setSaving(null);
    if (r.ok) onSaved(); else toast(r.error || 'Could not save.', 'error');
  }

  return (
    <div style={{ ...cardStyle, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
        <thead>
          <tr>
            <th style={{ ...gTh, width: 130 }}>Period</th>
            {days.map(d => <th key={d.value} style={gTh}>{d.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {periods.map(p => (
            <tr key={p.id}>
              <td style={{ ...gTd, background: '#F8FAFC', fontWeight: 600 }}>
                <div>{p.label}</div>
                <div style={{ fontSize: 11, color: '#94A3B8' }}>{p.start_time}–{p.end_time}</div>
              </td>
              {p.is_break
                ? <td colSpan={days.length} style={{ ...gTd, textAlign: 'center', color: GOLD, fontWeight: 700, background: '#FFFBEB' }}>{p.label}</td>
                : days.map(d => {
                    const cell = grid.entries[`${d.value}:${p.id}`];
                    const busy = saving === `${d.value}:${p.id}`;
                    if (!canEdit) {
                      return <td key={d.value} style={gTd}>
                        {cell ? <><div style={{ fontWeight: 600 }}>{cell.subject_name || '—'}</div><div style={{ fontSize: 11, color: '#64748B' }}>{cell.teacher_name || ''}</div></> : <span style={{ color: '#CBD5E1' }}>—</span>}
                      </td>;
                    }
                    return (
                      <td key={d.value} style={{ ...gTd, opacity: busy ? 0.5 : 1 }}>
                        <select value={cell?.subject_id || ''} onChange={e => save(d.value, p.id, { subject_id: e.target.value ? Number(e.target.value) : null }, cell)} style={cellSel}>
                          <option value="">— subject —</option>
                          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <select value={cell?.teacher_id || ''} onChange={e => save(d.value, p.id, { teacher_id: e.target.value ? Number(e.target.value) : null }, cell)} style={{ ...cellSel, marginTop: 4 }}>
                          <option value="">— teacher —</option>
                          {teachers.map(t => <option key={t.id} value={t.id}>{[t.first_name, t.surname].filter(Boolean).join(' ')}</option>)}
                        </select>
                      </td>
                    );
                  })}
            </tr>
          ))}
        </tbody>
      </table>
      {!canEdit && <p style={{ color: '#94A3B8', fontSize: 13, marginTop: 10 }}>You have view-only access to the timetable.</p>}
    </div>
  );
}

const cardStyle = { background: '#fff', border: '1px solid #E7EBF1', borderRadius: 12, padding: 16, marginTop: 12 };
const thStyle = { padding: '6px 8px', fontWeight: 600 };
const tdStyle = { padding: '8px' };
const gTh = { padding: '8px', background: NAVY, color: '#fff', fontSize: 13, textAlign: 'left', border: '1px solid #E7EBF1' };
const gTd = { padding: '6px', border: '1px solid #E7EBF1', verticalAlign: 'top', fontSize: 13 };
const cellSel = { width: '100%', padding: '5px 6px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12 };
const selStyle = { padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, minWidth: 200 };
const inputStyle = { padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, width: 160 };
const primaryBtn = { background: NAVY, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' };
const ghostBtn = { background: '#fff', color: NAVY, border: '1px solid #E2E8F0', borderRadius: 8, padding: '8px 14px', fontWeight: 600, cursor: 'pointer' };
const linkBtn = { background: 'none', border: 'none', color: '#B91C1C', cursor: 'pointer', fontWeight: 600 };
