// Nickland Edusoft — Withdrawn bills.
//
// A voided bill is hidden from the bills list, the debtors report and every
// total, which is exactly what makes it worth being able to review: this is
// the only screen where a Proprietor can see what was withdrawn, by whom, and
// on what stated grounds — and put it back if it should not have been.
//
// A bill can now also be withdrawn FROM here, not only from the bill itself.
// The office's own phrasing is "take these off", plural, and walking into each
// pupil's bill one at a time to do it is how half a list gets done.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate, fullName, termLabel } from '../../lib/format.js';
import Modal from '../../components/Modal.jsx';

export default function VoidedBillsTab({ perms = {}, onChanged }) {
  const currentTerm = useStore(s => s.currentTerm);
  const classes = useStore(s => s.classes);
  const showToast = useStore(s => s.showToast);
  const [rows, setRows] = useState([]);
  const [allTerms, setAllTerms] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  async function refresh() {
    const list = await window.api.fees.listVoidedBills(allTerms ? null : currentTerm?.id);
    setRows(list || []);
  }
  useEffect(() => { refresh(); }, [currentTerm, allTerms]);

  async function restore(row) {
    if (!window.confirm(
      `Restore the bill for ${fullName(row)} (${termLabel(row)})?\n\n`
      + "It goes back on the bills list and starts counting towards the term's totals again."
    )) return;
    const res = await window.api.fees.restoreBill({ billId: row.id });
    if (!res?.ok) return showToast(res?.error || 'Could not restore the bill', 'error');
    showToast('Bill restored', 'success');
    refresh(); onChanged?.();
  }

  const totalWithdrawn = rows.reduce((n, r) => n + (r.total_billed || 0), 0);
  const paidAgainst = rows.reduce((n, r) => n + (r.total_paid || 0), 0);

  return (
    <div>
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <Metric label="Bills withdrawn" value={rows.length}
          sub={allTerms ? 'across every term' : termLabel(currentTerm, 'this term')} />
        <Metric label="Taken off the books" value={fmtCedi(totalWithdrawn)}
          sub="not chased, not counted anywhere" />
        <Metric label="Money received against them" value={fmtCedi(paidAgainst)}
          sub={paidAgainst > 0 ? 'still recorded in Finance' : 'nothing was received'} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-title">Withdrawn bills</div>
            <div className="text-sm text-muted">
              These do not appear anywhere else and are not chased as debts.
              Money already received against them stays recorded in Finance.
            </div>
          </div>
          <div className="row gap-2">
            <label className="row gap-2">
              <input type="checkbox" checked={allTerms} onChange={e => setAllTerms(e.target.checked)} />
              Show every term
            </label>
            {perms.can_manage_issued_bills && (
              <button className="btn btn-outline" onClick={() => setWithdrawing(true)}>
                Withdraw a bill
              </button>
            )}
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Index No</th><th>Name</th><th>Class</th><th>Term</th>
                <th className="text-right">Was billed</th>
                <th className="text-right">Paid</th>
                <th>Withdrawn</th><th>By</th><th>Why</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="bold">{r.index_number}</td>
                  <td>{fullName(r)}</td>
                  <td>{r.class_name}</td>
                  <td>{termLabel(r)}</td>
                  <td className="text-right">{fmtCedi(r.total_billed || 0)}</td>
                  <td className="text-right"
                    style={{ color: (r.total_paid || 0) > 0 ? 'var(--warning)' : undefined }}>
                    {fmtCedi(r.total_paid || 0)}
                  </td>
                  <td className="text-sm text-muted">{fmtDate(r.voided_at)}</td>
                  <td className="text-sm">{r.voided_by_name || '—'}</td>
                  <td className="text-sm">{r.void_reason}</td>
                  <td className="text-right">
                    {perms.can_manage_issued_bills && (
                      <button className="btn btn-outline btn-sm" onClick={() => restore(r)}>
                        Put it back
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan="10">
                    <div className="empty-state">
                      <h3>Nothing withdrawn</h3>
                      <p>No bill has been taken off the books {allTerms ? 'at all' : 'this term'}.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {withdrawing && (
        <WithdrawModal classes={classes} termId={currentTerm?.id}
          onClose={() => setWithdrawing(false)}
          onDone={(n) => {
            setWithdrawing(false); refresh(); onChanged?.();
            showToast(`${n} bill(s) withdrawn`, 'success');
          }} />
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

// ── Withdrawing from here ───────────────────────────────────────────────────
// The reason is not optional and is not a formality: it is what the Proprietor
// reads six months later when a parent produces a bill nobody can find.
function WithdrawModal({ classes, termId, onClose, onDone }) {
  const showToast = useStore(s => s.showToast);
  const [classId, setClassId] = useState('');
  const [bills, setBills] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const list = await window.api.fees.listBills({ termId, classId: classId || undefined });
      setBills(list || []);
      setSelected(new Set());
    })();
  }, [classId, termId]);

  async function withdraw() {
    if (reason.trim().length < 5) {
      return showToast('Say why — this is written to the audit trail', 'warning');
    }
    setBusy(true);
    let done = 0;
    let lastError = null;
    for (const id of selected) {
      const res = await window.api.fees.voidBill({ billId: id, reason: reason.trim() });
      if (res?.ok) done += 1; else lastError = res?.error;
    }
    setBusy(false);
    if (done === 0) return showToast(lastError || 'Nothing could be withdrawn', 'error');
    if (lastError) showToast(`${done} withdrawn — the rest: ${lastError}`, 'warning');
    onDone(done);
  }

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <Modal title="Withdraw a bill" onClose={onClose} size="lg"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || selected.size === 0} onClick={withdraw}>
          {busy ? 'Withdrawing…' : `Withdraw ${selected.size || ''} bill(s)`}
        </button>
      </>}>
      <p className="text-sm">
        A withdrawn bill disappears from the bills list, the arrears and every total.
        Money already received against it stays recorded in Finance — withdrawing a
        bill is not a refund.
      </p>

      <div className="form-group">
        <label className="label">Class</label>
        <select className="select" value={classId} onChange={e => setClassId(e.target.value)}>
          <option value="">Every class</option>
          {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
        </select>
      </div>

      <div className="table-wrap" style={{ maxHeight: 300 }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 34 }}></th>
              <th>Index No</th><th>Name</th><th>Class</th>
              <th className="text-right">Billed</th>
              <th className="text-right">Paid</th>
            </tr>
          </thead>
          <tbody>
            {bills.map(b => (
              <tr key={b.id}>
                <td><input type="checkbox" checked={selected.has(b.id)} onChange={() => toggle(b.id)} /></td>
                <td className="bold">{b.index_number}</td>
                <td>{fullName(b)}</td>
                <td>{b.class_name}</td>
                <td className="text-right">{fmtCedi(b.total_billed || 0)}</td>
                <td className="text-right"
                  style={{ color: (b.total_paid || 0) > 0 ? 'var(--warning)' : undefined }}>
                  {fmtCedi(b.total_paid || 0)}
                </td>
              </tr>
            ))}
            {bills.length === 0 && (
              <tr><td colSpan="6"><div className="empty-state">No bills in that class this term</div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="form-group" style={{ marginTop: 12 }}>
        <label className="label">Why (required)</label>
        <textarea className="input" rows={3} value={reason} onChange={e => setReason(e.target.value)}
          placeholder="e.g. Pupil withdrew before the term started — bill raised in error." />
        <div className="text-xs text-muted">
          Stored against your name. This is what somebody reads when the decision is
          questioned later.
        </div>
      </div>
    </Modal>
  );
}
