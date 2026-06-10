// Nickland Edusoft — PAYE Tax Remittance Schedule (GRA format)
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi } from '../../lib/format.js';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function PAYEScheduleTab() {
  const { settings } = useStore();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const school = settings.school || {};
  const reg = settings.registration || {};

  async function refresh() {
    setLoading(true);
    const res = await window.api.payroll.payeSchedule(month, year);
    setData(res);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [month, year]);

  return (
    <div className="paye-schedule-tab">
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
              🖨 Print PAYE Return
            </button>
          </div>
        </div>
      </div>

      {loading
        ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
        : !data || data.rows.length === 0
          ? <div className="card empty-state" style={{ marginTop: 16 }}>
              No salary records for {MONTHS[month - 1]} {year}. Run payroll first.
            </div>
          : <div className="schedule-document" style={{ marginTop: 16 }}>
              <div className="card">
                <div className="schedule-header">
                  <div className="schedule-header-title">GHANA REVENUE AUTHORITY</div>
                  <div className="schedule-header-sub">P.A.Y.E. Monthly Tax Return Schedule — Income Tax Act 896</div>
                </div>
                <div className="schedule-info-grid">
                  <div><strong>Employer:</strong> {school.school_name || '—'}</div>
                  <div><strong>TIN:</strong> {reg.school_tin_number || '—'}</div>
                  <div><strong>Tax Period:</strong> {MONTHS[month - 1]} {year}</div>
                  <div><strong>Address:</strong> {school.school_address || '—'}</div>
                </div>
              </div>

              {/* Tax bands reference */}
              <div className="card" style={{ marginTop: 16 }}>
                <div className="section-title" style={{ marginBottom: 10 }}>PAYE Tax Bands (Reference)</div>
                <div className="paye-bands-grid">
                  <div className="paye-band">First GHS 490 → <strong>0%</strong></div>
                  <div className="paye-band">Next GHS 110 → <strong>5%</strong></div>
                  <div className="paye-band">Next GHS 130 → <strong>10%</strong></div>
                  <div className="paye-band">Next GHS 3,166.67 → <strong>17.5%</strong></div>
                  <div className="paye-band">Next GHS 16,000 → <strong>25%</strong></div>
                  <div className="paye-band">Next GHS 30,520 → <strong>30%</strong></div>
                  <div className="paye-band">Above → <strong>35%</strong></div>
                </div>
              </div>

              <div className="card" style={{ marginTop: 16 }}>
                <div className="table-wrap">
                  <table className="schedule-table">
                    <thead>
                      <tr>
                        <th>No.</th>
                        <th>Staff No.</th>
                        <th>Name</th>
                        <th className="text-right">Gross Income (GHS)</th>
                        <th className="text-right">SSNIT Worker (Allowable)</th>
                        <th className="text-right">Taxable Income</th>
                        <th className="text-right">PAYE Tax</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((r, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td style={{ fontFamily: 'monospace' }}>{r.staff_number}</td>
                          <td><strong>{r.surname}</strong>, {r.first_name} {r.other_names || ''}</td>
                          <td className="text-right">{fmtCedi(r.gross_salary).replace('GHS ','')}</td>
                          <td className="text-right">{fmtCedi(r.ssnit_worker || 0).replace('GHS ','')}</td>
                          <td className="text-right">{fmtCedi(r.taxable_income).replace('GHS ','')}</td>
                          <td className="text-right"><strong>{fmtCedi(r.paye_tax).replace('GHS ','')}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--surface-2)', fontWeight: 700 }}>
                        <td colSpan="3">TOTALS — {data.rows.length} employees</td>
                        <td className="text-right">{fmtCedi(data.totals.gross).replace('GHS ','')}</td>
                        <td className="text-right">{fmtCedi(data.totals.ssnit).replace('GHS ','')}</td>
                        <td className="text-right">{fmtCedi(data.totals.taxable).replace('GHS ','')}</td>
                        <td className="text-right">{fmtCedi(data.totals.paye).replace('GHS ','')}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="schedule-summary">
                  <div className="schedule-summary-box">
                    <div className="text-xs text-muted">TOTAL PAYE TAX DUE TO GRA</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--primary)' }}>
                      {fmtCedi(data.totals.paye)}
                    </div>
                    <div className="text-xs text-muted" style={{ marginTop: 6 }}>
                      Payable by the 15th day of the following month
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
                    <div className="text-xs text-muted">Position</div>
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
