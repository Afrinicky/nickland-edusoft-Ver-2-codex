// Nickland Edusoft — Withdrawn bills.
//
// A voided bill is hidden from the bills list, the debtors report and every
// total, which is exactly what makes it worth being able to review: this is
// the only screen where a Proprietor can see what was withdrawn, by whom, and
// on what stated grounds — and put it back if it should not have been.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate } from '../../lib/format.js';

export default function VoidedBillsTab({ perms = {}, onChanged }) {
  const currentTerm = useStore(s => s.currentTerm);
  const showToast = useStore(s => s.showToast);
  const [rows, setRows] = useState([]);
  const [allTerms, setAllTerms] = useState(false);

  async function refresh() {
    const list = await window.api.fees.listVoidedBills(allTerms ? null : currentTerm?.id);
    setRows(list || []);
  }
  useEffect(() => { refresh(); }, [currentTerm, allTerms]);

  async function restore(row) {
    if (!window.confirm(
      `Restore the bill for ${row.surname} ${row.first_name} (${row.term_label})?\n\n` +
      `It goes back on the bills list and starts counting towards the term's totals again.`
    )) return;
    const res = await window.api.fees.restoreBill({ billId: row.id });
    if (!res?.ok) return showToast(res?.error || 'Could not restore the bill', 'error');
    showToast('Bill restored', 'success');
    refresh(); onChanged?.();
  }

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Withdrawn bills</div>
          <div className="text-sm text-muted">
            These do not appear anywhere else and are not chased as debts.
            Money already received against them stays recorded in Finance.
          </div>
        </div>
        <label className="row gap-2">
          <input type="checkbox" checked={allTerms} onChange={e => setAllTerms(e.target.checked)} />
          Show every term
        </label>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Index No</th><th>Name</th><th>Class</th><th>Term</th>
              <th className="text-right">Was billed</th>
              <th className="text-right">Paid</th>
              <th>Voided</th><th>By</th><th>Reason</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="bold">{r.index_number}</td>
                <td>{r.surname} {r.first_name}</td>
                <td>{r.class_name}</td>
                <td>{r.term_label}</td>
                <td className="text-right">{fmtCedi(r.total_billed || 0)}</td>
                <td className="text-right"
                  style={{ color: (r.total_paid || 0) > 0 ? 'var(--warning)' : undefined }}>
                  {fmtCedi(r.total_paid || 0)}
                </td>
                <td className="text-sm text-muted">{fmtDate(r.voided_at)}</td>
                <td className="text-sm">{r.voided_by_name || '—'}</td>
                <td className="text-sm">{r.void_reason}</td>
                <td>
                  {perms.can_manage_issued_bills && (
                    <button className="btn btn-outline btn-sm" onClick={() => restore(r)}>Restore</button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan="10">
                  <div className="empty-state">
                    <h3>Nothing withdrawn</h3>
                    <p>No bill has been voided {allTerms ? 'at all' : 'this term'}.</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
