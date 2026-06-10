// Nickland Edusoft — SSNIT Contribution Schedule
// Format aligned with SSNIT Tier 1 monthly schedule
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi } from '../../lib/format.js';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function SSNITScheduleTab() {
  const { settings } = useStore();
  const showToast = useStore(s => s.showToast);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const school = settings.school || {};
  const reg = settings.registration || {};

  async function refresh() {
    setLoading(true);
    const res = await window.api.payroll.ssnitSchedule(month, year);
    setData(res);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [month, year]);

  return (
    <div className="ssnit-schedule-tab">
      <div className="card no-print">
        <div className="form-row" style={{ alignItems: 'flex-end' }}>
          <div className="form-group">
            <label>Month</label>
            <select value={month} onChange={e => setMonth(parseInt(e.target.value))}>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Year</label>
            <select value={year} onChange={e => setYear(parseInt(e.target.value))}>
              {Array.from({ length: 7 }, (_, i) => now.getFullYear() - 3 + i).map(y =>
                <option key={y} value={y}>{y}</option>
              )}
            </select>
          </div>
          <div className="form-group" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary btn-full" onClick={() => window.print()}>
              🖨 Print Schedule
            </button>
          </div>
        </div>
      </div>

      {loading
        ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
        : !data || data.rows.length === 0
          ? <div className="card empty-state" style={{ marginTop: 16 }}>
              No SSNIT-enrolled staff have salary records for {MONTHS[month - 1]} {year}.
              Run payroll first.
            </div>
          : <div className="schedule-document" style={{ marginTop: 16 }}>
              {/* Schedule header */}
              <div className="card">
                <div className="schedule-header">
                  <div className="schedule-header-title">SSNIT MONTHLY CONTRIBUTION SCHEDULE</div>
                  <div className="schedule-header-sub">Tier 1 — Basic National Social Security Scheme</div>
                </div>
                <div className="schedule-info-grid">
                  <div><strong>Employer Name:</strong> {school.school_name || '—'}</div>
                  <div><strong>SSNIT Employer No.:</strong> {reg.school_ssnit_employer_no || '—'}</div>
                  <div><strong>Period:</strong> {MONTHS[month - 1]} {year}</div>
                  <div><strong>TIN:</strong> {reg.school_tin_number || '—'}</div>
                  <div><strong>Address:</strong> {school.school_address || '—'}</div>
                  <div><strong>Phone:</strong> {school.school_phone_1 || '—'}</div>
                </div>
              </div>

              {/* Schedule table */}
              <div className="card" style={{ marginTop: 16 }}>
                <div className="table-wrap">
                  <table className="schedule-table">
                    <thead>
                      <tr>
                        <th>No.</th>
                        <th>SSNIT No.</th>
                        <th>Staff No.</th>
                        <th>Surname</th>
                        <th>First Name</th>
                        <th>Sex</th>
                        <th>DOB</th>
                        <th className="text-right">Gross Salary (GHS)</th>
                        <th className="text-right">Worker 5.5%</th>
                        <th className="text-right">Employer 13%</th>
                        <th className="text-right">Total 18.5%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((r, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td style={{ fontFamily: 'monospace' }}>{r.ssnit_number || '—'}</td>
                          <td style={{ fontFamily: 'monospace' }}>{r.staff_number}</td>
                          <td>{r.surname}</td>
                          <td>{r.first_name} {r.other_names || ''}</td>
                          <td>{r.gender === 'Male' ? 'M' : r.gender === 'Female' ? 'F' : '—'}</td>
                          <td className="text-sm">{r.date_of_birth || '—'}</td>
                          <td className="text-right">{fmtCedi(r.gross_salary).replace('GHS ','')}</td>
                          <td className="text-right">{fmtCedi(r.ssnit_worker).replace('GHS ','')}</td>
                          <td className="text-right">{fmtCedi(r.ssnit_employer).replace('GHS ','')}</td>
                          <td className="text-right"><strong>{fmtCedi((r.ssnit_worker || 0) + (r.ssnit_employer || 0)).replace('GHS ','')}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--surface-2)', fontWeight: 700 }}>
                        <td colSpan="7">TOTALS — {data.rows.length} contributors</td>
                        <td className="text-right">{fmtCedi(data.totals.gross).replace('GHS ','')}</td>
                        <td className="text-right">{fmtCedi(data.totals.worker).replace('GHS ','')}</td>
                        <td className="text-right">{fmtCedi(data.totals.employer).replace('GHS ','')}</td>
                        <td className="text-right">{fmtCedi(data.totals.combined).replace('GHS ','')}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="schedule-summary">
                  <div className="schedule-summary-box">
                    <div className="text-xs text-muted">TOTAL DUE TO SSNIT</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--primary)' }}>
                      {fmtCedi(data.totals.combined)}
                    </div>
                    <div className="text-xs text-muted" style={{ marginTop: 6 }}>
                      Worker {fmtCedi(data.totals.worker)} + Employer {fmtCedi(data.totals.employer)}
                    </div>
                  </div>
                </div>

                <div className="schedule-footer">
                  <div className="signature-block">
                    <div className="signature-line"></div>
                    <div className="text-xs text-muted">Authorized Signature</div>
                  </div>
                  <div className="signature-block">
                    <div className="signature-line"></div>
                    <div className="text-xs text-muted">Date</div>
                  </div>
                </div>
              </div>
            </div>
      }
    </div>
  );
}
