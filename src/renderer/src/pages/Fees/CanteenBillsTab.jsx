// Nickland Edusoft — Canteen billing.
//
// The canteen is billed by the DAY, not by the term: what a family owes is the
// daily rate times the number of feeding days the school actually opens for.
// So the term's canteen calendar is not a canteen-module detail — it IS the
// canteen bill, and it belongs where the school's other bills are raised.
//
// The calendar itself is unchanged: same generator, same holidays, same day
// grid. What is new is that the bill it implies can be seen and printed from
// here, which is what a parent asks for at the gate in week one.
import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate, fullName, termLabel } from '../../lib/format.js';
import Modal from '../../components/Modal.jsx';

const DAY_TONES = {
  school_day: { bg: 'var(--primary-50)', fg: 'var(--primary)', label: 'Feeding day' },
  holiday: { bg: 'var(--surface-3)', fg: 'var(--muted)', label: 'Holiday' },
  weekend: { bg: 'var(--surface-3)', fg: 'var(--muted)', label: 'Weekend' },
};

export default function CanteenBillsTab() {
  const currentTerm = useStore(s => s.currentTerm);
  const classes = useStore(s => s.classes);
  const showToast = useStore(s => s.showToast);
  const canSetUp = useStore(s => s.can)('settings', 'edit');

  const [calendar, setCalendar] = useState([]);
  const [rate, setRate] = useState(0);
  const [showSetup, setShowSetup] = useState(false);
  const [classFilter, setClassFilter] = useState('');
  const [roll, setRoll] = useState([]);
  const [selected, setSelected] = useState(() => new Set());

  async function refresh() {
    if (!currentTerm) return;
    const [list, settings] = await Promise.all([
      window.api.canteen.listCalendar(currentTerm.id),
      window.api.settings.getAll(),
    ]);
    setCalendar(list || []);
    // Settings come back grouped by category, and the daily rate has moved
    // category once already — so it is looked for by name across all of them
    // rather than at one fixed path that would silently read as GHS 0.00.
    let raw = null;
    for (const group of Object.values(settings || {})) {
      if (group && group.canteen_daily_rate != null) { raw = group.canteen_daily_rate; break; }
    }
    setRate(parseFloat(raw) || 0);
  }
  useEffect(() => { refresh(); }, [currentTerm]);

  useEffect(() => {
    (async () => {
      const list = await window.api.students.list({
        status: 'Active', classId: classFilter || undefined,
      });
      setRoll(list || []);
      setSelected(new Set());
    })();
  }, [classFilter]);

  const feedingDays = useMemo(
    () => calendar.filter(d => d.day_type === 'school_day').length, [calendar]);
  const perPupil = Math.round(feedingDays * rate * 100) / 100;

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function print(studentIds, what) {
    if (!studentIds.length) return showToast('Nobody selected to print for', 'warning');
    if (!feedingDays) return showToast('Lay out the term’s calendar first', 'warning');
    const res = await window.api.reports.generateCanteenBills({
      termId: currentTerm.id, studentIds, dailyRate: rate,
    });
    if (!res?.ok) return showToast(res?.error || 'The bill could not be produced', 'error');
    await window.api.app.openPdfPreview(res.path);
    showToast(`${studentIds.length} canteen ${what} ready to print`, 'success');
  }

  const className = classes.find(c => String(c.id) === String(classFilter))?.name;

  return (
    <div>
      {/* ── What the term's canteen comes to ────────────────────────── */}
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Metric label="Feeding days" value={feedingDays}
          sub={termLabel(currentTerm) || 'no term running'} />
        <Metric label="Daily rate" value={fmtCedi(rate)}
          sub="Settings → Canteen" />
        <Metric label="Per pupil, the term" value={fmtCedi(perPupil)}
          sub={`${feedingDays} day(s) × ${fmtCedi(rate)}`} />
        <Metric label="Whole school" value={fmtCedi(perPupil * roll.length)}
          sub={`${roll.length} pupil(s)${className ? ` in ${className}` : ' active'}`} />
      </div>

      {/* ── The calendar, unchanged ─────────────────────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-title">Term calendar — {termLabel(currentTerm)}</div>
            <div className="card-subtitle">
              {calendar.length} day(s) laid out · {feedingDays} charged for
            </div>
          </div>
          {canSetUp && (
            <button className="btn btn-primary" onClick={() => setShowSetup(true)}>
              {calendar.length ? 'Lay it out again' : 'Set up calendar'}
            </button>
          )}
        </div>

        {calendar.length === 0 ? (
          <div className="empty-state">
            <h3>No calendar yet for this term</h3>
            <p>{canSetUp
              ? 'Generate the term’s school days and holidays — the canteen bill is worked out from them.'
              : 'The school office sets this up. Canteen days cannot be collected until they do.'}</p>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 40px)', gap: 4 }}>
              {calendar.map(d => {
                const tone = DAY_TONES[d.day_type] || DAY_TONES.holiday;
                return (
                  <div key={d.date}
                    title={`${fmtDate(d.date)} · ${tone.label}${d.label ? ` · ${d.label}` : ''}`}
                    style={{
                      width: 40, height: 40, borderRadius: 6,
                      border: '1px solid var(--border)', fontSize: 11,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: tone.bg, color: tone.fg,
                    }}>
                    {new Date(d.date).getDate()}
                  </div>
                );
              })}
            </div>
            <div className="row gap-2 text-xs text-muted" style={{ marginTop: 10, flexWrap: 'wrap' }}>
              {Object.entries(DAY_TONES).map(([k, t]) => (
                <span key={k} className="row gap-2" style={{ alignItems: 'center' }}>
                  <span style={{
                    width: 12, height: 12, borderRadius: 3,
                    background: t.bg, border: '1px solid var(--border)', display: 'inline-block',
                  }} />
                  {t.label}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Printing the bill ───────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="toolbar">
          <select className="select" value={classFilter} style={{ maxWidth: 220 }}
            onChange={e => setClassFilter(e.target.value)}>
            <option value="">Every class</option>
            {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
          </select>
          <div className="flex-1"></div>
          {selected.size > 0 && (
            <button className="btn btn-primary btn-sm"
              onClick={() => print([...selected], 'bill(s)')}>
              🖨 Print {selected.size} selected
            </button>
          )}
          <button className="btn btn-outline btn-sm" disabled={!roll.length}
            onClick={() => print(roll.map(s => s.id), classFilter ? `bill(s) for ${className}` : 'bill(s)')}>
            🖨 Print {classFilter ? `all of ${className}` : 'the whole school'}
          </button>
        </div>

        <div className="table-wrap" style={{ maxHeight: 420 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input type="checkbox"
                    checked={roll.length > 0 && selected.size === roll.length}
                    onChange={() => setSelected(prev =>
                      (prev.size === roll.length ? new Set() : new Set(roll.map(s => s.id))))} />
                </th>
                <th>Index No</th><th>Name</th><th>Class</th>
                <th className="text-right">Days</th>
                <th className="text-right">Owing for the term</th>
              </tr>
            </thead>
            <tbody>
              {roll.map(s => (
                <tr key={s.id}>
                  <td><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} /></td>
                  <td className="bold">{s.index_number}</td>
                  <td>{fullName(s)}</td>
                  <td>{s.class_name}</td>
                  <td className="text-right">{feedingDays}</td>
                  <td className="text-right bold">{fmtCedi(perPupil)}</td>
                </tr>
              ))}
              {roll.length === 0 && (
                <tr><td colSpan="6"><div className="empty-state">Nobody active in that class</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showSetup && (
        <SetupModal term={currentTerm} onClose={() => setShowSetup(false)}
          onDone={() => { setShowSetup(false); refresh(); showToast('Calendar generated', 'success'); }} />
      )}
    </div>
  );
}

function Metric({ label, value, sub }) {
  return (
    <div className="metric-card">
      <div className="metric-body">
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
        {sub && <div className="metric-sub">{sub}</div>}
      </div>
    </div>
  );
}

// The generator, exactly as the canteen module had it — same dates, same
// weekend rule, same named holidays. Moving a screen is not an excuse to
// change what it does.
function SetupModal({ term, onClose, onDone }) {
  const [start, setStart] = useState(term?.start_date || '');
  const [end, setEnd] = useState(term?.end_date || '');
  const [excludeWeekends, setExcludeWeekends] = useState(true);
  const [holidays, setHolidays] = useState([]);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await window.api.canteen.setupTermCalendar({
      termId: term.id, startDate: start, endDate: end, excludeWeekends,
      holidays: holidays.filter(h => h.date),
    });
    setBusy(false);
    if (res?.ok) onDone();
  }

  return (
    <Modal title="Set up term calendar" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>
          {busy ? 'Generating…' : 'Generate calendar'}
        </button>
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
        <input type="checkbox" checked={excludeWeekends}
          onChange={e => setExcludeWeekends(e.target.checked)} />
        <span>Treat weekends (Sat/Sun) as holidays</span>
      </label>

      <h4 style={{ fontSize: 13 }}>Holidays / non-school days</h4>
      {holidays.map((h, i) => (
        <div key={i} className="row gap-2 mb-2">
          <input className="input" type="date" value={h.date ?? ''}
            onChange={e => { const c = [...holidays]; c[i].date = e.target.value; setHolidays(c); }} />
          <input className="input" placeholder="Label (e.g. Christmas)" value={h.label ?? ''}
            onChange={e => { const c = [...holidays]; c[i].label = e.target.value; setHolidays(c); }} />
          <button className="btn btn-ghost btn-sm"
            onClick={() => setHolidays(holidays.filter((_, idx) => idx !== i))}>✕</button>
        </div>
      ))}
      <button className="btn btn-outline btn-sm"
        onClick={() => setHolidays([...holidays, { date: '', label: '' }])}>+ Add holiday</button>
    </Modal>
  );
}
