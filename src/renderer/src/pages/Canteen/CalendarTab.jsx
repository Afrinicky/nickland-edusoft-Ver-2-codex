import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate } from '../../lib/format.js';
import Modal from '../../components/Modal.jsx';

export default function CalendarTab() {
  const currentTerm = useStore(s => s.currentTerm);
  const showToast = useStore(s => s.showToast);
  const [calendar, setCalendar] = useState([]);
  const [showSetup, setShowSetup] = useState(false);

  async function refresh() {
    if (!currentTerm) return;
    const list = await window.api.canteen.listCalendar(currentTerm.id);
    setCalendar(list);
  }
  useEffect(() => { refresh(); }, [currentTerm]);

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Term calendar — {currentTerm?.label}</div>
          <div className="card-subtitle">{calendar.length} days configured</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowSetup(true)}>Set up calendar</button>
      </div>

      {calendar.length === 0 ? (
        <div className="empty-state">
          <h3>No calendar yet for this term</h3>
          <p>Click "Set up calendar" to auto-generate school days and holidays.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 40px)', gap: 4 }}>
          {calendar.map(d => (
            <div key={d.date} title={`${d.date} · ${d.day_type} · ${d.label || ''}`}
              style={{
                width: 40, height: 40,
                borderRadius: 6,
                border: '1px solid var(--border)',
                fontSize: 11,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background:
                  d.day_type === 'school_day' ? 'var(--primary-50)' :
                  d.day_type === 'holiday' ? 'var(--surface-3)' :
                  '#fff',
                color: d.day_type === 'school_day' ? 'var(--primary)' : 'var(--muted)',
              }}>
              {new Date(d.date).getDate()}
            </div>
          ))}
        </div>
      )}

      {showSetup && (
        <SetupModal term={currentTerm} onClose={() => setShowSetup(false)}
          onDone={() => { setShowSetup(false); refresh(); showToast('Calendar generated'); }} />
      )}
    </div>
  );
}

function SetupModal({ term, onClose, onDone }) {
  const [start, setStart] = useState(term?.start_date || '');
  const [end, setEnd] = useState(term?.end_date || '');
  const [excludeWeekends, setExcludeWeekends] = useState(true);
  const [holidays, setHolidays] = useState([]);

  function addHoliday() {
    setHolidays([...holidays, { date: '', label: '' }]);
  }

  async function save() {
    const validHolidays = holidays.filter(h => h.date);
    const res = await window.api.canteen.setupTermCalendar({
      termId: term.id, startDate: start, endDate: end, excludeWeekends, holidays: validHolidays
    });
    if (res.ok) onDone();
  }

  return (
    <Modal title="Set up term calendar" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>Generate calendar</button>
      </>}>
      <div className="form-row">
        <div className="form-group">
          <label className="label">Start date</label>
          <input className="input" type="date" value={start} onChange={e => setStart(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="label">End date</label>
          <input className="input" type="date" value={end} onChange={e => setEnd(e.target.value)} />
        </div>
      </div>
      <label className="row gap-2 mb-3">
        <input type="checkbox" checked={excludeWeekends} onChange={e => setExcludeWeekends(e.target.checked)} />
        <span>Treat weekends (Sat/Sun) as holidays</span>
      </label>

      <h4 style={{ fontSize: 13 }}>Holidays / non-school days</h4>
      {holidays.map((h, i) => (
        <div key={i} className="row gap-2 mb-2">
          <input className="input" type="date" value={h.date ?? ''}
            onChange={e => { const c = [...holidays]; c[i].date = e.target.value; setHolidays(c); }} />
          <input className="input" placeholder="Label (e.g. Christmas)" value={h.label ?? ''}
            onChange={e => { const c = [...holidays]; c[i].label = e.target.value; setHolidays(c); }} />
          <button className="btn btn-ghost btn-sm" onClick={() => setHolidays(holidays.filter((_, idx) => idx !== i))}>✕</button>
        </div>
      ))}
      <button className="btn btn-outline btn-sm" onClick={addHoliday}>+ Add holiday</button>
    </Modal>
  );
}

