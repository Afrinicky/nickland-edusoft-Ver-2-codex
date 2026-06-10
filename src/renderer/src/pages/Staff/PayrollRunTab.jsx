// Nickland Edusoft — Monthly Payroll Run (bulk calculation and processing)
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate } from '../../lib/format.js';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function PayrollRunTab() {
  const showToast = useStore(s => s.showToast);
  const { currentUser } = useStore();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [processing, setProcessing] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(null); // staffId currently being marked

  async function refresh() {
    setLoading(true);
    const res = await window.api.payroll.bulkPreview(month, year);
    setPreview(res);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [month, year]);

  async function runPayroll() {
    if (!confirm(`Run payroll for ${MONTHS[month - 1]} ${year}? This will create or update entries for ${preview.previews.length} active staff.`)) return;
    setProcessing(true);
    const res = await window.api.payroll.bulkRun(month, year, paymentDate);
    setProcessing(false);
    if (res.ok) {
      showToast(`Payroll computed: ${res.created} new, ${res.updated} updated`, 'success');
      refresh();
    }
  }

  async function markPaid(salaryId) {
    setMarkingPaid(salaryId);
    const row = preview.previews.find(p => p.existing_id === salaryId);
    const expected = (row?.net_salary || 0) + (row?.arrear_brought_forward || 0);
    const actualStr = prompt(`Actual amount paid (expected: ${fmtCedi(expected)})`, expected.toFixed(2));
    if (!actualStr) { setMarkingPaid(null); return; }
    const actual = parseFloat(actualStr);
    const method = prompt('Payment method', 'Bank Transfer') || 'Bank';
    const ref = prompt('Payment reference (cheque #, transaction ID, etc.) — optional', '');
    const res = await window.api.payroll.markPaid({
      id: salaryId,
      actualAmount: actual,
      paymentMethod: method,
      paymentReference: ref,
      paymentDate,
      paidBy: currentUser?.id,
    });
    setMarkingPaid(null);
    if (res.ok) {
      showToast(`Paid: ${fmtCedi(res.actual)}${res.carry_over > 0 ? `, carry-over ${fmtCedi(res.carry_over)}` : ''}`, 'success');
      refresh();
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;
  }

  return (
    <div className="payroll-run-tab">
      {/* Filters */}
      <div className="card">
        <div className="form-row">
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
          <div className="form-group">
            <label>Payment Date</label>
            <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} />
          </div>
          <div className="form-group" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary btn-full" onClick={runPayroll} disabled={processing}>
              {processing ? 'Running…' : `Compute Payroll for ${MONTHS[month - 1]} ${year}`}
            </button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      {preview && (
        <>
          <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginTop: 16 }}>
            <div className="metric-card">
              <div className="metric-icon blue"><IconUsers /></div>
              <div className="metric-body">
                <div className="metric-label">Active Staff</div>
                <div className="metric-value">{preview.totals.staff_count}</div>
                <div className="metric-sub">With base salary</div>
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-icon green"><IconCash /></div>
              <div className="metric-body">
                <div className="metric-label">Gross Payroll</div>
                <div className="metric-value">{fmtCedi(preview.totals.total_gross)}</div>
                <div className="metric-sub">Before deductions</div>
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-icon orange"><IconShield /></div>
              <div className="metric-body">
                <div className="metric-label">SSNIT</div>
                <div className="metric-value accent">{fmtCedi(preview.totals.total_ssnit_combined)}</div>
                <div className="metric-sub">{fmtCedi(preview.totals.total_ssnit_worker)} W + {fmtCedi(preview.totals.total_ssnit_employer)} E</div>
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-icon red"><IconTax /></div>
              <div className="metric-body">
                <div className="metric-label">PAYE Tax</div>
                <div className="metric-value danger">{fmtCedi(preview.totals.total_paye)}</div>
                <div className="metric-sub">To remit to GRA</div>
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-icon purple"><IconCheck /></div>
              <div className="metric-body">
                <div className="metric-label">Total Net Pay</div>
                <div className="metric-value success">{fmtCedi(preview.totals.total_net)}</div>
                <div className="metric-sub">Total employer cost: {fmtCedi(preview.totals.total_employer_cost)}</div>
              </div>
            </div>
          </div>

          {/* Payroll table */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-header">
              <div className="section-title">Payroll Detail — {MONTHS[month - 1]} {year}</div>
              <span className="text-sm text-muted">
                {preview.previews.filter(p => p.is_paid).length} of {preview.previews.length} paid
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Role</th>
                    <th className="text-right">Gross</th>
                    <th className="text-right">SSNIT (W)</th>
                    <th className="text-right">PAYE</th>
                    <th className="text-right">Arrear B/F</th>
                    <th className="text-right">Net Due</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {preview.previews.map(p => {
                    const due = p.net_salary + (p.arrear_brought_forward || 0);
                    return (
                      <tr key={p.staff_id}>
                        <td>
                          <strong>{p.surname} {p.first_name}</strong>
                          <div className="text-xs text-muted">{p.staff_number}</div>
                        </td>
                        <td className="text-sm">{p.role}</td>
                        <td className="text-right">{fmtCedi(p.gross_salary)}</td>
                        <td className="text-right text-sm text-muted">{fmtCedi(p.ssnit_worker)}</td>
                        <td className="text-right text-sm text-muted">{fmtCedi(p.paye_tax)}</td>
                        <td className="text-right text-sm">
                          {p.arrear_brought_forward > 0
                            ? <span style={{ color: 'var(--warning)' }}>{fmtCedi(p.arrear_brought_forward)}</span>
                            : '—'}
                        </td>
                        <td className="text-right"><strong>{fmtCedi(due)}</strong></td>
                        <td>
                          {p.is_paid
                            ? <span className="badge badge-success">Paid</span>
                            : p.existing_id
                              ? <span className="badge badge-warning">Computed</span>
                              : <span className="badge badge-muted">Not yet</span>
                          }
                        </td>
                        <td>
                          {p.existing_id && !p.is_paid && (
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => markPaid(p.existing_id)}
                              disabled={markingPaid === p.existing_id}
                            >
                              {markingPaid === p.existing_id ? '…' : 'Mark Paid'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--surface-2)', fontWeight: 700 }}>
                    <td colSpan="2">TOTALS</td>
                    <td className="text-right">{fmtCedi(preview.totals.total_gross)}</td>
                    <td className="text-right">{fmtCedi(preview.totals.total_ssnit_worker)}</td>
                    <td className="text-right">{fmtCedi(preview.totals.total_paye)}</td>
                    <td></td>
                    <td className="text-right">{fmtCedi(preview.totals.total_net)}</td>
                    <td colSpan="2"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function IconUsers()  { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="4" fill="currentColor"/><path d="M1 21c0-4 4-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" fill="none"/></svg>; }
function IconCash()   { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="2" y="6" width="20" height="12" rx="2" fill="currentColor"/><circle cx="12" cy="12" r="3" stroke="#fff" strokeWidth="2"/></svg>; }
function IconShield() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2L4 6v6c0 5 4 9 8 10 4-1 8-5 8-10V6l-8-4z" fill="currentColor"/></svg>; }
function IconTax()    { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="2" fill="currentColor"/><path d="M9 8h6M9 12h6M9 16h4" stroke="#fff" strokeWidth="1.5"/></svg>; }
function IconCheck()  { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="currentColor"/><path d="M8 12l3 3 5-6" stroke="#fff" strokeWidth="2.5" fill="none"/></svg>; }
