// Nickland Edusoft — Bills home.
//
// The first screen of Bills answers the two questions an owner opens the
// module to ask: what have we charged this term, and who has not paid.
//
// Before this, the answers were spread across six tabs and a separate Debtors
// tab that only ever covered SCHOOL fees — so a school that ran a canteen and
// a bus had no single place that said what it had billed. Every kind of bill
// now reports the same five figures side by side, and the debtors list that
// used to be its own tab is here, under the totals it explains.
import React from 'react';
import { fmtCedi, fullName } from '../../lib/format.js';

export default function BillsHome({ summary, onOpen, onPrintDebtors }) {
  if (!summary) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;
  }

  const kinds = summary.kinds || [];
  const debtors = summary.debtors || [];
  const byClass = summary.by_class || [];

  // Totals across every kind. `null` means "this kind does not keep its own
  // collection figure" (extra charges settle on the term bill), which is not
  // the same as zero and must not be added in as one.
  const totals = kinds.reduce((acc, k) => ({
    billed: acc.billed + (Number(k.billed) || 0),
    paid: acc.paid + (k.paid == null ? 0 : Number(k.paid) || 0),
    outstanding: acc.outstanding + (k.outstanding == null ? 0 : Number(k.outstanding) || 0),
  }), { billed: 0, paid: 0, outstanding: 0 });
  const rate = totals.billed > 0 ? Math.round((totals.paid / totals.billed) * 100) : 0;

  return (
    <div>
      {/* ── What the term has been charged, in total ─────────────────── */}
      <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Metric label="Billed this term" value={fmtCedi(totals.billed)}
          sub={summary.term?.full_label || ''} />
        <Metric label="Collected" value={fmtCedi(totals.paid)} tone="success"
          sub={`${rate}% of what was billed`} />
        <Metric label="Outstanding" value={fmtCedi(totals.outstanding)} tone="danger"
          sub={`${debtors.length} pupil(s) owing on fees`} />
        <Metric label="Withdrawn" value={String(summary.voided?.count || 0)}
          sub={(summary.voided?.count || 0) > 0
            ? `${fmtCedi(summary.voided.billed)} taken off the books`
            : 'Nothing withdrawn this term'} />
      </div>

      {/* ── Every kind of bill, in one place ──────────────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-title">What the school bills for</div>
            <div className="text-sm text-muted">
              Each kind keeps its own books. Open one to raise, amend or print it.
            </div>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bill</th>
                <th className="text-right">Raised</th>
                <th className="text-right">Billed</th>
                <th className="text-right">Collected</th>
                <th className="text-right">Outstanding</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {kinds.map(k => (
                <tr key={k.key} style={{ cursor: 'pointer' }} onClick={() => onOpen(k.tab)}>
                  <td>
                    <div className="bold">{k.label}</div>
                    <div className="text-xs text-muted">{k.note}</div>
                  </td>
                  <td className="text-right">
                    {k.raised || 0}{k.unit ? <span className="text-xs text-muted"> {k.unit}</span> : null}
                  </td>
                  <td className="text-right">{fmtCedi(k.billed || 0)}</td>
                  <td className="text-right" style={{ color: 'var(--success)' }}>
                    {k.paid == null ? <span className="text-muted">on the term bill</span> : fmtCedi(k.paid)}
                  </td>
                  <td className="text-right bold"
                    style={{ color: (k.outstanding || 0) > 0 ? 'var(--danger)' : 'var(--success)' }}>
                    {k.outstanding == null ? '—' : fmtCedi(k.outstanding)}
                  </td>
                  <td>
                    {k.ready
                      ? <span className="badge badge-success">Raised</span>
                      : <span className="badge badge-warning">Not raised</span>}
                  </td>
                  <td className="text-right">
                    <button className="btn btn-ghost btn-sm">Open →</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="dash-row" style={{ gridTemplateColumns: '1fr 1.25fr', marginTop: 16 }}>
        {/* ── Collection, class by class ──────────────────────────────── */}
        <div className="card">
          <div className="section-header">
            <div className="section-title">Collection by class</div>
            <span className="text-sm text-muted">{summary.term?.full_label}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  <th className="text-right">Bills</th>
                  <th className="text-right">Billed</th>
                  <th className="text-right">Owing</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                {byClass.map(c => (
                  <tr key={c.id}>
                    <td className="bold">{c.short_code || c.name}</td>
                    <td className="text-right">{c.bills}</td>
                    <td className="text-right">{fmtCedi(c.billed)}</td>
                    <td className="text-right td-danger">{fmtCedi(c.outstanding)}</td>
                    <td style={{ minWidth: 90 }}>
                      <div className="avg-bar">
                        <div className="avg-bar-fill" style={{
                          width: `${c.rate}%`,
                          background: c.rate >= 70 ? '#15803D' : c.rate >= 40 ? '#B45309' : '#B91C1C',
                        }} />
                      </div>
                      <div className="text-xs text-muted" style={{ marginTop: 2 }}>{c.rate}%</div>
                    </td>
                  </tr>
                ))}
                {byClass.length === 0 && (
                  <tr><td colSpan="5"><div className="empty-state">No classes set up</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Who owes — what used to be the Debtors tab ──────────────── */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Who owes</div>
              <div className="text-sm text-muted">
                {debtors.length} pupil{debtors.length === 1 ? '' : 's'} · {fmtCedi(summary.debtor_total || 0)} outstanding
                {' · '}biggest first
              </div>
            </div>
            {debtors.length > 0 && (
              <button className="btn btn-outline btn-sm" onClick={onPrintDebtors}>🖨 Print the list</button>
            )}
          </div>
          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table>
              <thead>
                <tr>
                  <th>Index No</th><th>Name</th><th>Class</th><th>Contact</th>
                  <th className="text-right">Owing</th><th className="text-right">Days</th>
                </tr>
              </thead>
              <tbody>
                {debtors.map(d => (
                  <tr key={d.id}>
                    <td className="bold">{d.index_number}</td>
                    <td>{fullName(d)}</td>
                    <td>{d.class_name}</td>
                    <td className="text-sm">
                      {d.father_contact || d.mother_contact || d.guardian_contact || '—'}
                    </td>
                    <td className="text-right bold" style={{ color: 'var(--danger)' }}>
                      {fmtCedi(d.balance)}
                    </td>
                    <td className="text-right text-sm text-muted">{d.days_outstanding ?? '—'}</td>
                  </tr>
                ))}
                {debtors.length === 0 && (
                  <tr>
                    <td colSpan="6">
                      <div className="empty-state">
                        <h3>Nobody owes anything</h3>
                        <p>Every bill raised this term is settled.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, sub, tone }) {
  const cls = tone === 'success' ? 'metric-value success'
    : tone === 'danger' ? 'metric-value danger'
    : 'metric-value';
  return (
    <div className="metric-card">
      <div className="metric-body">
        <div className="metric-label">{label}</div>
        <div className={cls}>{value}</div>
        {sub && <div className="metric-sub">{sub}</div>}
      </div>
    </div>
  );
}
