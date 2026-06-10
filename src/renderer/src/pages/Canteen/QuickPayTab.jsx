// Nickland Edusoft — Canteen Quick Pay (mark multiple students paid in one go)
import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate, initials } from '../../lib/format.js';

export default function CanteenQuickPayTab() {
  const { classes, currentUser } = useStore();
  const showToast = useStore(s => s.showToast);
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [roster, setRoster] = useState([]);
  const [selected, setSelected] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dailyRate, setDailyRate] = useState(5);

  useEffect(() => {
    (async () => {
      const s = await window.api.settings.getAll();
      setDailyRate(parseFloat(s?.canteen?.canteen_daily_rate || '5'));
    })();
  }, []);

  async function loadRoster() {
    if (!classId) { setRoster([]); return; }
    setLoading(true);
    const data = await window.api.canteen.classRosterForDate(classId, date);
    setRoster(data);
    // Default-select students who are present AND unpaid
    const next = {};
    for (const s of data) {
      if (s.canteen_status === 'unpaid' && s.attendance_status !== 'absent') {
        next[s.id] = true;
      }
    }
    setSelected(next);
    setLoading(false);
  }

  useEffect(() => {
    if (classId && date) loadRoster();
  }, [classId, date]);

  const toggle = (id) => setSelected(prev => ({ ...prev, [id]: !prev[id] }));
  const selectAll = () => setSelected(Object.fromEntries(roster.map(r => [r.id, true])));
  const selectPresent = () => {
    const next = {};
    for (const r of roster) {
      if (r.attendance_status !== 'absent' && r.canteen_status === 'unpaid') next[r.id] = true;
    }
    setSelected(next);
  };
  const clearAll = () => setSelected({});

  const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => parseInt(k));
  const selectedCount = selectedIds.length;
  const totalAmount = selectedCount * dailyRate;

  async function process() {
    if (selectedIds.length === 0) {
      showToast('Select at least one student', 'warning');
      return;
    }
    setSaving(true);
    const res = await window.api.canteen.markBulkPaid({
      studentIds: selectedIds,
      date,
      paymentMethod: 'Cash',
      receivedBy: currentUser?.id || null,
    });
    setSaving(false);
    if (res.ok) {
      showToast(`Marked ${res.count} student${res.count > 1 ? 's' : ''} paid — ${fmtCedi(res.total)} total`, 'success');
      loadRoster();
    } else {
      showToast(res.error || 'Failed', 'error');
    }
  }

  async function markAbsentExempt() {
    const absentIds = roster
      .filter(r => r.attendance_status === 'absent' && r.canteen_status === 'unpaid')
      .map(r => r.id);
    if (absentIds.length === 0) {
      showToast('No absent students to exempt', 'info');
      return;
    }
    for (const id of absentIds) {
      await window.api.canteen.markExempt({ studentId: id, dates: [date], reason: 'Absent' });
    }
    showToast(`Exempted ${absentIds.length} absent student${absentIds.length > 1 ? 's' : ''}`, 'success');
    loadRoster();
  }

  return (
    <div className="quick-pay-tab">
      <div className="card">
        <div className="section-header">
          <div className="section-title">Quick Daily Collection</div>
          <span className="text-sm text-muted">Mark multiple students paid for one day</span>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Class</label>
            <select value={classId} onChange={e => setClassId(e.target.value)}>
              <option value="">— Select Class —</option>
              {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Daily Rate</label>
            <input type="text" value={fmtCedi(dailyRate)} readOnly
              style={{ background: 'var(--surface-2)', color: 'var(--muted)' }} />
          </div>
        </div>
      </div>

      {classId && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Class Roster — {fmtDate(date)}</div>
              <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                {selectedCount} selected · <strong>{fmtCedi(totalAmount)}</strong> total
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={selectPresent} title="Select all present + unpaid students">
                Select Present
              </button>
              <button className="btn btn-ghost btn-sm" onClick={selectAll}>Select All</button>
              <button className="btn btn-ghost btn-sm" onClick={clearAll}>Clear</button>
              <button className="btn btn-outline btn-sm" onClick={markAbsentExempt}>
                Exempt Absentees
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={selectedCount === 0 || saving}
                onClick={process}
              >
                {saving ? 'Processing…' : `Mark Paid (${selectedCount})`}
              </button>
            </div>
          </div>

          {loading ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
            : roster.length === 0
              ? <div className="empty-state">No students in this class</div>
              : <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>
                          <input type="checkbox"
                            checked={selectedCount === roster.length && roster.length > 0}
                            onChange={(e) => e.target.checked ? selectAll() : clearAll()}
                          />
                        </th>
                        <th>Index No.</th>
                        <th>Name</th>
                        <th>Attendance</th>
                        <th>Canteen Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roster.map(s => {
                        const isPaid = s.canteen_status === 'paid';
                        const isExempt = s.canteen_status === 'exempt';
                        const isAbsent = s.attendance_status === 'absent';
                        const disabled = isPaid || isExempt;
                        return (
                          <tr key={s.id} style={disabled ? { opacity: 0.6 } : {}}>
                            <td>
                              <input
                                type="checkbox"
                                checked={!!selected[s.id]}
                                onChange={() => toggle(s.id)}
                                disabled={disabled}
                              />
                            </td>
                            <td style={{ fontFamily: 'monospace' }} className="td-muted">{s.index_number}</td>
                            <td><strong>{s.surname} {s.first_name}</strong></td>
                            <td>
                              {s.attendance_status === 'present' && <span className="badge badge-success">Present</span>}
                              {isAbsent && <span className="badge badge-danger">Absent</span>}
                              {s.attendance_status === 'late' && <span className="badge badge-warning">Late</span>}
                              {!s.attendance_status && <span className="text-muted text-xs">Not marked</span>}
                            </td>
                            <td>
                              {isPaid && <span className="badge badge-success">Paid</span>}
                              {isExempt && <span className="badge badge-muted">Exempt</span>}
                              {s.canteen_status === 'unpaid' && <span className="badge badge-warning">Unpaid</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
          }
        </div>
      )}
    </div>
  );
}
