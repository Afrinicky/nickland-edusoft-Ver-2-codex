// Nickland Edusoft — Staff Attendance Tab (software clock-in/out)
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fullName, initials, fmtDate } from '../../lib/format.js';

export default function StaffAttendanceTab() {
  const showToast = useStore(s => s.showToast);
  const [enabled, setEnabled] = useState(false);
  const [staff, setStaff] = useState([]);
  const [today, setToday] = useState({});
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [viewMode, setViewMode] = useState('today');  // 'today' or 'history'
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [history, setHistory] = useState([]);

  async function refresh() {
    setLoading(true);
    const [statusRes, list] = await Promise.all([
      window.api.staff.clockinStatus(),
      window.api.staff.list({ status: 'Active' }),
    ]);
    setEnabled(statusRes.enabled);
    setStaff(list);

    // Get today's attendance for all staff
    const todayMap = {};
    for (const s of list) {
      const att = await window.api.staff.todayAttendance(s.id);
      if (att) todayMap[s.id] = att;
    }
    setToday(todayMap);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

  async function loadHistory(staffId) {
    setSelectedStaffId(staffId);
    if (!staffId) { setHistory([]); return; }
    const now = new Date();
    const list = await window.api.staff.listAttendance(parseInt(staffId), now.getMonth() + 1, now.getFullYear());
    setHistory(list);
  }

  async function handleClockIn(staffId) {
    const res = await window.api.staff.clockIn(staffId);
    if (res.ok) {
      showToast(`Clocked in at ${res.time}`, 'success');
      refresh();
    } else showToast(res.error, 'warning');
  }

  async function handleClockOut(staffId) {
    const res = await window.api.staff.clockOut(staffId);
    if (res.ok) {
      showToast(`Clocked out at ${res.time}`, 'success');
      refresh();
    } else showToast(res.error, 'warning');
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;
  }

  if (!enabled) {
    return (
      <div className="card empty-state-card">
        <div style={{ fontSize: 48 }}>🔒</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 12 }}>Staff Clock-In is Disabled</div>
        <p className="text-sm text-muted" style={{ marginTop: 8, maxWidth: 400 }}>
          To start recording staff attendance, enable the software clock-in feature in <strong>Settings → Security</strong>.
          Hardware clock-in (biometric/RFID) has not yet been implemented.
        </p>
      </div>
    );
  }

  return (
    <div className="staff-attendance-tab">
      <div className="sub-tabs">
        <button className={'sub-tab' + (viewMode === 'today' ? ' active' : '')} onClick={() => setViewMode('today')}>Today's Attendance</button>
        <button className={'sub-tab' + (viewMode === 'history' ? ' active' : '')} onClick={() => setViewMode('history')}>Individual History</button>
      </div>

      {viewMode === 'today' && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Today's Clock-In Status</div>
              <div className="text-sm text-muted" style={{ marginTop: 4 }}>{fmtDate(date)}</div>
            </div>
            <div className="text-sm text-muted">
              {Object.values(today).filter(a => a.clock_in).length} / {staff.length} clocked in
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Clock In</th>
                  <th>Clock Out</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {staff.map(s => {
                  const att = today[s.id];
                  const isClockedIn = att?.clock_in && !att?.clock_out;
                  const isComplete = att?.clock_in && att?.clock_out;
                  return (
                    <tr key={s.id}>
                      <td><div className="avatar avatar-sm">{initials(s)}</div></td>
                      <td><strong>{s.surname} {s.first_name}</strong></td>
                      <td className="text-sm">{s.role}</td>
                      <td className="text-sm">
                        {att?.clock_in
                          ? <span className="td-success" style={{ fontFamily: 'monospace' }}>{att.clock_in}</span>
                          : <span className="text-muted">—</span>
                        }
                      </td>
                      <td className="text-sm">
                        {att?.clock_out
                          ? <span style={{ fontFamily: 'monospace' }}>{att.clock_out}</span>
                          : <span className="text-muted">—</span>
                        }
                      </td>
                      <td>
                        {isComplete && <span className="badge badge-muted">Day complete</span>}
                        {isClockedIn && <span className="badge badge-success">Currently on duty</span>}
                        {!att && <span className="badge badge-warning">Not clocked in</span>}
                      </td>
                      <td>
                        {!att?.clock_in && (
                          <button className="btn btn-primary btn-sm" onClick={() => handleClockIn(s.id)}>Clock In</button>
                        )}
                        {isClockedIn && (
                          <button className="btn btn-outline btn-sm" onClick={() => handleClockOut(s.id)}>Clock Out</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewMode === 'history' && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="form-row">
            <div className="form-group">
              <label>Select Staff Member</label>
              <select value={selectedStaffId} onChange={e => loadHistory(e.target.value)}>
                <option value="">— Select —</option>
                {staff.map(s => <option key={s.id} value={s.id ?? ''}>{s.surname} {s.first_name} ({s.staff_number})</option>)}
              </select>
            </div>
          </div>

          {selectedStaffId && (
            <div style={{ marginTop: 16 }}>
              <div className="section-title" style={{ marginBottom: 10 }}>This Month's History</div>
              {history.length === 0
                ? <div className="empty-state">No attendance records this month</div>
                : <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>Date</th><th>Clock In</th><th>Clock Out</th><th>Hours</th><th>Status</th></tr>
                      </thead>
                      <tbody>
                        {history.map(h => {
                          let hours = '—';
                          if (h.clock_in && h.clock_out) {
                            const [hi, mi] = h.clock_in.split(':').map(Number);
                            const [ho, mo] = h.clock_out.split(':').map(Number);
                            const mins = (ho * 60 + mo) - (hi * 60 + mi);
                            hours = `${Math.floor(mins / 60)}h ${mins % 60}m`;
                          }
                          return (
                            <tr key={h.id}>
                              <td>{fmtDate(h.date)}</td>
                              <td style={{ fontFamily: 'monospace' }}>{h.clock_in || '—'}</td>
                              <td style={{ fontFamily: 'monospace' }}>{h.clock_out || '—'}</td>
                              <td>{hours}</td>
                              <td><span className={'badge ' + (h.status === 'present' ? 'badge-success' : 'badge-warning')}>{h.status}</span></td>
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
      )}
    </div>
  );
}
