// Nickland Edusoft — Canteen Multi-Day WHONET Sheet
// Students × multiple days. Click cells to cycle status: unpaid → paid → exempt → unpaid.
// Mirrors the Attendance Register pattern.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

function getWeekStart(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}
function fmtISO(d) { return d.toISOString().slice(0, 10); }
function weekDates(weekStart) {
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return fmtISO(d);
  });
}
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
function fmtDayLabel(iso) {
  const d = new Date(iso);
  const day = DAY_NAMES[(d.getDay() + 6) % 7] || '';
  const date = d.getDate();
  const month = d.toLocaleString('en-GB', { month: 'short' });
  return `${day} ${date} ${month}`;
}

const STATUS_CYCLE = { unpaid: 'paid', paid: 'exempt', exempt: 'unpaid' };
const STATUS_SYMBOL = { unpaid: '–', paid: '✓', exempt: 'E' };

export default function CanteenSheetTab() {
  const { classes, currentUser } = useStore();
  const showToast = useStore(s => s.showToast);
  const [classId, setClassId] = useState('');
  const [anchorDate, setAnchorDate] = useState(fmtISO(new Date()));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dailyRate, setDailyRate] = useState(5);
  const [updating, setUpdating] = useState({});  // 'sid|date' -> true while saving

  const weekStart = getWeekStart(anchorDate);
  const dates = weekDates(weekStart);

  useEffect(() => {
    (async () => {
      const s = await window.api.settings.getAll();
      setDailyRate(parseFloat(s?.canteen?.canteen_daily_rate || '5'));
    })();
  }, []);

  async function refresh() {
    if (!classId) { setRows([]); return; }
    setLoading(true);
    const data = await window.api.canteen.classRosterForRange(classId, dates);
    setRows(data);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [classId, anchorDate]);

  async function cycleCell(studentId, date) {
    const row = rows.find(r => r.student_id === studentId);
    if (!row) return;
    const current = row.canteen[date] || 'unpaid';
    const next = STATUS_CYCLE[current];
    const key = `${studentId}|${date}`;
    setUpdating(prev => ({ ...prev, [key]: true }));
    const res = await window.api.canteen.setDayStatus({
      studentId, date, status: next,
      receivedBy: currentUser?.id, paymentMethod: 'Cash',
    });
    setUpdating(prev => { const n = { ...prev }; delete n[key]; return n; });
    if (res.ok) {
      // Update locally to avoid full refetch flicker
      setRows(prev => prev.map(r => {
        if (r.student_id !== studentId) return r;
        const canteen = { ...r.canteen, [date]: next };
        const paid = Object.values(canteen).filter(v => v === 'paid').length;
        const exempt = Object.values(canteen).filter(v => v === 'exempt').length;
        return { ...r, canteen, paid_count: paid, exempt_count: exempt, unpaid_count: dates.length - paid - exempt };
      }));
    } else {
      showToast(res.error || 'Could not update cell', 'error');
    }
  }

  async function markRow(studentId, status) {
    // Mark all 5 days of the week for one student
    for (const d of dates) {
      await window.api.canteen.setDayStatus({
        studentId, date: d, status, receivedBy: currentUser?.id, paymentMethod: 'Cash',
      });
    }
    showToast(`Week marked ${status} for student`, 'success');
    refresh();
  }

  function shiftWeek(deltaDays) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + deltaDays);
    setAnchorDate(fmtISO(d));
  }

  // Stats for the visible week
  const totalCells = rows.length * dates.length;
  const totalPaid = rows.reduce((s, r) => s + r.paid_count, 0);
  const totalExempt = rows.reduce((s, r) => s + r.exempt_count, 0);
  const totalUnpaid = totalCells - totalPaid - totalExempt;
  const weekRevenue = totalPaid * dailyRate;

  return (
    <div className="canteen-sheet">
      <div className="card no-print">
        <div className="section-header">
          <div>
            <div className="section-title">Canteen Sheet — Multi-Day</div>
            <div className="text-sm text-muted">
              Click cells to cycle: – (unpaid) → ✓ (paid) → E (exempt) → – . Marking paid
              creates a one-day payment and records income automatically.
            </div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => window.print()}>🖨 Print Sheet</button>
        </div>
        <div className="form-row" style={{ marginTop: 14, alignItems: 'flex-end' }}>
          <div className="form-group">
            <label>Class</label>
            <select value={classId} onChange={e => setClassId(e.target.value)}>
              <option value="">— Select Class —</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Week</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => shiftWeek(-7)}>‹ Prev</button>
              <input type="date" value={anchorDate} onChange={e => setAnchorDate(e.target.value)} />
              <button className="btn btn-ghost btn-sm" onClick={() => shiftWeek(7)}>Next ›</button>
            </div>
          </div>
          <div className="form-group">
            <label>Daily rate</label>
            <div style={{ fontWeight: 600, padding: '8px 0' }}>GHS {dailyRate.toFixed(2)}</div>
          </div>
        </div>

        {classId && rows.length > 0 && (
          <div style={{
            display: 'flex', gap: 16, marginTop: 12,
            padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8,
            fontSize: 13,
          }}>
            <div><strong>{totalPaid}</strong> paid cells</div>
            <div style={{ color: 'var(--muted)' }}>·</div>
            <div><strong>{totalExempt}</strong> exempt</div>
            <div style={{ color: 'var(--muted)' }}>·</div>
            <div><strong>{totalUnpaid}</strong> unpaid</div>
            <div style={{ flex: 1 }} />
            <div>
              Week revenue: <strong style={{ color: 'var(--primary)' }}>GHS {weekRevenue.toFixed(2)}</strong>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        {!classId
          ? <div className="empty-state" style={{ padding: 40 }}>Select a class to view the canteen sheet</div>
          : loading
            ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
            : rows.length === 0
              ? <div className="empty-state" style={{ padding: 30 }}>No active students in this class</div>
              : <div className="sheet-wrap">
                  <table className="sheet-table register-table">
                    <thead>
                      <tr>
                        <th className="sheet-row-num-header">#</th>
                        <th style={{ minWidth: 90 }}>Index No.</th>
                        <th style={{ minWidth: 160 }}>Name</th>
                        {dates.map(d => (
                          <th key={d} className="register-date-header">
                            <div className="register-date-vertical">{fmtDayLabel(d)}</div>
                          </th>
                        ))}
                        <th style={{ minWidth: 60 }} className="text-center">Paid</th>
                        <th style={{ minWidth: 80 }} className="text-center">Week Cost</th>
                        <th style={{ minWidth: 140 }} className="no-print">Quick Mark</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => {
                        const cost = row.paid_count * dailyRate;
                        return (
                          <tr key={row.student_id}>
                            <td className="sheet-row-num">{i + 1}</td>
                            <td className="sheet-cell" style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.index_number}</td>
                            <td className="sheet-cell"><strong>{row.surname}</strong>, {row.first_name}</td>
                            {dates.map(d => {
                              const st = row.canteen[d] || 'unpaid';
                              const att = row.attendance[d];
                              const key = `${row.student_id}|${d}`;
                              const busy = !!updating[key];
                              const cls = 'register-day-cell ' + (
                                st === 'paid' ? 'register-present' :
                                st === 'exempt' ? 'canteen-cell-exempt' :
                                att === 'absent' ? 'canteen-cell-absent-bg' : ''
                              );
                              return (
                                <td key={d} className={cls}
                                  onClick={() => !busy && cycleCell(row.student_id, d)}
                                  title={`${st}${att ? ' · attendance: ' + att : ''}`}
                                >
                                  {busy ? '…' : STATUS_SYMBOL[st]}
                                </td>
                              );
                            })}
                            <td className="sheet-cell text-center" style={{ fontWeight: 700 }}>{row.paid_count}/5</td>
                            <td className="sheet-cell text-center" style={{ fontWeight: 600, color: 'var(--primary)' }}>
                              GHS {cost.toFixed(2)}
                            </td>
                            <td className="sheet-cell no-print">
                              <button className="btn btn-success btn-sm" onClick={() => markRow(row.student_id, 'paid')}>All ✓</button>
                              <button className="btn btn-ghost btn-sm" onClick={() => markRow(row.student_id, 'unpaid')}>Clear</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
        }
      </div>

      <div className="sheet-help no-print" style={{ marginTop: 12 }}>
        <strong>How to use:</strong> Click any day cell to cycle its status · ✓ = paid (auto-records income at GHS {dailyRate.toFixed(2)}) · E = exempt (free meal — no charge, no income recorded) · – = unpaid · Use <strong>All ✓</strong> to mark the entire week paid for a student · Cells highlight light-red if the student was marked absent that day so you don't accidentally bill them.
      </div>
    </div>
  );
}
