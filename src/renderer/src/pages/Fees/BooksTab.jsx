// Nickland Edusoft — Books.
//
// Textbooks are charged ONCE for the academic year — Part B of the bill a
// Ghanaian school prints — and whatever is unpaid carries into Terms 2 and 3
// as arrears on the fees bill. That is why they are not on the term fee: a
// parent who bought the books in September must not be asked for them again
// in January.
//
// ── What was wrong with this screen ─────────────────────────────────────────
//
// It could only charge one class, and charging a class that already had books
// silently did nothing — so a school that got a title or a price wrong had no
// way to correct it. Payments took cash only, with no mode, no reference and
// no receipt a parent could be handed. The action column was two grey icons at
// 45% opacity that nobody could tell were buttons. And there was no way to
// print the bill, which is the one thing a parent asks for at the gate.
import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fullName } from '../../lib/format.js';
import Modal from '../../components/Modal.jsx';
import Receipt from './Receipt.jsx';

export default function BooksTab() {
  const { classes } = useStore();
  const currentUser = useStore(s => s.currentUser);
  const showToast = useStore(s => s.showToast);

  const [academicYears, setAcademicYears] = useState([]);
  const [config, setConfig] = useState({ methods: [], reference_required: [] });
  const [classId, setClassId] = useState('');
  const [yearId, setYearId] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');

  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [amountInputs, setAmountInputs] = useState({});
  const [savingRowId, setSavingRowId] = useState(null);
  const [lastPaid, setLastPaid] = useState({});
  const [selected, setSelected] = useState(() => new Set());

  const [setupModal, setSetupModal] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    (async () => {
      const ys = await window.api.settings.listAcademicYears();
      setAcademicYears(ys || []);
      const cur = (ys || []).find(y => y.is_current);
      if (cur) setYearId(cur.id);
    })();
    window.api.payments.purposes().then(r => r?.ok && setConfig(r)).catch(() => {});
  }, []);

  async function refresh() {
    if (!classId || !yearId) { setRows([]); return; }
    setLoading(true);
    const data = await window.api.books.classPaymentSheet({ classId, academicYearId: yearId });
    setRows(data || []);
    setSelected(new Set());
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [classId, yearId]);

  const needsReference = (config.reference_required || []).includes(method);

  async function save(row) {
    const amount = parseFloat(amountInputs[row.student_id]);
    if (!(amount > 0)) return showToast('Enter a positive amount', 'warning');
    if (needsReference && !reference.trim()) {
      return showToast(`A ${method.toLowerCase()} payment needs its transaction reference`, 'warning');
    }
    setSavingRowId(row.student_id);
    const res = await window.api.payments.take({
      studentId: row.student_id, purpose: 'books',
      referenceId: row.student_books_id,
      amount, method, reference: reference.trim(),
    });
    setSavingRowId(null);
    if (!res?.ok) return showToast(res?.error || 'The payment could not be recorded', 'error');

    setAmountInputs(prev => { const n = { ...prev }; delete n[row.student_id]; return n; });
    setLastPaid(prev => ({
      ...prev,
      [row.student_id]: {
        receiptNo: res.receipt_number, amount,
        paymentId: res.payment_id, source: res.source, receipt: res.receipt,
      },
    }));
    showToast(`${fmtCedi(amount)} — receipt ${res.receipt_number}`, 'success');
    refresh();
  }

  function showReceipt(row) {
    const lp = lastPaid[row.student_id];
    if (!lp) return;
    if (lp.receipt) return setReceipt(lp.receipt);
    window.api.payments.receipt({ source: lp.source, paymentId: lp.paymentId })
      .then(r => r?.ok && setReceipt(r.receipt)).catch(() => {});
  }

  async function print() {
    if (!receipt) return;
    setPrinting(true);
    const res = await window.api.receipts.print({
      paymentSource: receipt.source, paymentId: receipt.payment_id,
    });
    setPrinting(false);
    if (!res?.ok) showToast(res?.error || 'The receipt could not be printed', 'error');
  }

  // Printing the books BILL — the list of titles and what is left to pay,
  // on the same stationery as the fees bill.
  async function printBills(studentIds, what) {
    if (!studentIds.length) return showToast('Nobody selected to print for', 'warning');
    const res = await window.api.reports.generateBooksBills({
      academicYearId: yearId, studentIds,
    });
    if (!res?.ok) return showToast(res?.error || 'The bill could not be produced', 'error');
    await window.api.app.openPdfPreview(res.path);
    showToast(`${studentIds.length} books ${what} ready to print`, 'success');
  }

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const filteredRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r =>
      (!statusFilter || r.status === statusFilter)
      && (!needle || `${r.surname} ${r.first_name} ${r.index_number}`.toLowerCase().includes(needle)));
  }, [rows, statusFilter, q]);

  const totals = useMemo(() => filteredRows.reduce((acc, r) => ({
    billed: acc.billed + (r.books_total || 0),
    paid: acc.paid + (r.books_paid || 0),
    balance: acc.balance + (r.books_balance || 0),
  }), { billed: 0, paid: 0, balance: 0 }), [filteredRows]);

  const className = classes.find(c => String(c.id) === String(classId))?.name;
  const yearLabel = academicYears.find(y => String(y.id) === String(yearId))?.label;

  if (receipt) {
    return (
      <div style={{ display: 'grid', gap: 14, justifyItems: 'center' }}>
        <Receipt receipt={receipt} busy={printing} onPrint={print} onClose={() => setReceipt(null)} />
      </div>
    );
  }

  return (
    <div className="books-tab">
      <div className="card no-print">
        <div className="section-header">
          <div>
            <div className="section-title">Books — {yearLabel || 'no academic year set'}</div>
            <div className="text-sm text-muted">
              Charged once for the year. Anything unpaid carries into the following
              terms as arrears on the school fees bill, so a parent who has bought
              the books is never asked for them twice.
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setSetupModal(true)} disabled={!yearId}>
            📚 Charge books
          </button>
        </div>

        <div className="form-row" style={{ marginTop: 14 }}>
          <div className="form-group">
            <label>Academic Year</label>
            <select value={yearId} onChange={e => setYearId(e.target.value)}>
              <option value="">— Select —</option>
              {academicYears.map(y => <option key={y.id} value={y.id ?? ''}>{y.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Class</label>
            <select value={classId} onChange={e => setClassId(e.target.value)}>
              <option value="">— Select Class —</option>
              {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Filter by Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="paid_full">Paid in Full</option>
              <option value="paid_partial">Partial Payment</option>
              <option value="unpaid">Not Paid</option>
              <option value="not_billed">Not Billed</option>
            </select>
          </div>
        </div>

        {/* How the money is arriving, set once for the sheet — the same shape
            as the bulk payment sheet, because it is the same activity. */}
        <div className="form-row">
          <div className="form-group">
            <label>Find a pupil</label>
            <input className="input" value={q} onChange={e => setQ(e.target.value)}
              placeholder="Surname, first name or admission number" />
          </div>
          <div className="form-group">
            <label>Mode of payment</label>
            <select value={method} onChange={e => setMethod(e.target.value)}>
              {config.methods.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>
              Reference {needsReference ? <span style={{ color: 'var(--danger)' }}>*</span> : '(cash needs none)'}
            </label>
            <input className="input" value={reference} disabled={!needsReference}
              placeholder={needsReference ? 'Transaction ID or slip number' : '—'}
              onChange={e => setReference(e.target.value)} />
          </div>
        </div>

        <div className="text-xs text-muted">
          Every receipt is dated and timed automatically and carries{' '}
          <b>{currentUser?.full_name || currentUser?.username || 'your name'}</b> as the
          person who took the money.
        </div>
      </div>

      {classId && yearId && rows.length > 0 && (
        <div className="dash-metrics" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 16 }}>
          <Metric label="Charged" value={fmtCedi(totals.billed)}
            sub={`${filteredRows.length} pupil(s)`} />
          <Metric label="Collected" value={fmtCedi(totals.paid)} tone="success"
            sub={`${rows.filter(r => r.status === 'paid_full').length} fully paid`} />
          <Metric label="Outstanding" value={fmtCedi(totals.balance)} tone="danger"
            sub={`${rows.filter(r => (r.books_balance || 0) > 0).length} still owing`} />
          <Metric label="Per pupil"
            value={fmtCedi(filteredRows.length ? totals.billed / filteredRows.length : 0)}
            sub={className || 'the class'} />
        </div>
      )}

      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        {classId && yearId && rows.length > 0 && (
          <div className="toolbar no-print">
            <div className="flex-1"></div>
            {selected.size > 0 && (
              <button className="btn btn-primary btn-sm"
                onClick={() => printBills([...selected], 'bill(s)')}>
                🖨 Print {selected.size} selected
              </button>
            )}
            <button className="btn btn-outline btn-sm"
              onClick={() => printBills(filteredRows.map(r => r.student_id), `bill(s) for ${className}`)}>
              🖨 Print all of {className}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>
              🖨 Print this sheet
            </button>
          </div>
        )}

        {!classId || !yearId
          ? <div className="empty-state" style={{ padding: 40 }}>Select an academic year and class</div>
          : loading
            ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
            : filteredRows.length === 0
              ? <div className="empty-state" style={{ padding: 30 }}>
                  {rows.length === 0
                    ? <>Nothing has been charged to {className} for {yearLabel}. Use <b>Charge books</b>.</>
                    : 'No students match the filter'}
                </div>
              : <div className="sheet-wrap" style={{ maxHeight: 'calc(100vh - 520px)' }}>
                <table className="sheet-table bulk-pay-table">
                  <thead>
                    <tr>
                      <th className="sheet-row-num-header no-print" style={{ width: 34 }}>
                        <input type="checkbox"
                          checked={filteredRows.length > 0 && selected.size === filteredRows.length}
                          onChange={() => setSelected(prev => (prev.size === filteredRows.length
                            ? new Set() : new Set(filteredRows.map(r => r.student_id))))} />
                      </th>
                      <th className="sheet-row-num-header">#</th>
                      <th style={{ minWidth: 100 }}>Index No.</th>
                      <th style={{ minWidth: 180 }}>Name</th>
                      <th className="text-right" style={{ minWidth: 110 }}>Books Cost</th>
                      <th className="text-right" style={{ minWidth: 110 }}>Paid</th>
                      <th className="text-right" style={{ minWidth: 110 }}>Balance</th>
                      <th style={{ minWidth: 100 }}>Status</th>
                      <th style={{ minWidth: 130 }} className="bulk-pay-amount-col">Pay Now</th>
                      <th style={{ minWidth: 210 }} className="no-print">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, i) => {
                      const inputVal = amountInputs[row.student_id] || '';
                      const hasInput = inputVal && parseFloat(inputVal) > 0;
                      const lp = lastPaid[row.student_id];
                      const saving = savingRowId === row.student_id;
                      return (
                        <tr key={row.student_id}>
                          <td className="sheet-cell no-print">
                            <input type="checkbox" checked={selected.has(row.student_id)}
                              onChange={() => toggle(row.student_id)} />
                          </td>
                          <td className="sheet-row-num">{i + 1}</td>
                          <td className="sheet-cell" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                            {row.index_number}
                          </td>
                          <td className="sheet-cell">
                            <strong>{row.surname}</strong>, {row.first_name}
                          </td>
                          <td className="sheet-cell text-right">
                            {row.books_total > 0 ? plain(row.books_total) : '—'}
                          </td>
                          <td className="sheet-cell text-right" style={{ color: 'var(--success)' }}>
                            {plain(row.books_paid || 0)}
                          </td>
                          <td className="sheet-cell text-right" style={{
                            fontWeight: 700,
                            color: (row.books_balance || 0) > 0 ? 'var(--danger)' : 'var(--success)',
                          }}>{plain(row.books_balance || 0)}</td>
                          <td className="sheet-cell">
                            <span className={'badge ' + statusBadge(row.status)}>
                              {statusLabel(row.status)}
                            </span>
                          </td>
                          <td className="sheet-cell bulk-pay-amount-col">
                            <input type="number" step="0.01" min="0" value={inputVal}
                              onChange={e => setAmountInputs(prev => ({ ...prev, [row.student_id]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter' && hasInput) save(row); }}
                              placeholder="0.00" className="bulk-pay-amount-input"
                              disabled={saving || row.status === 'not_billed'} />
                          </td>

                          {/* Labelled, not iconography at 45% opacity. */}
                          <td className="sheet-cell no-print">
                            {hasInput || saving ? (
                              <button className="btn btn-sm btn-success" disabled={saving}
                                onClick={() => save(row)} style={{ minWidth: 140 }}>
                                {saving ? 'Saving…' : `💾 Take ${fmtCedi(parseFloat(inputVal) || 0)}`}
                              </button>
                            ) : lp ? (
                              <div className="row gap-2" style={{ alignItems: 'center' }}>
                                <span className="badge badge-success">{lp.receiptNo}</span>
                                <button className="btn btn-sm btn-outline" onClick={() => showReceipt(row)}>
                                  View receipt
                                </button>
                              </div>
                            ) : (
                              <button className="btn btn-sm btn-outline"
                                onClick={() => printBills([row.student_id], 'bill')}>
                                🖨 Print this bill
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--primary-50)', fontWeight: 700 }}>
                      <td className="no-print"></td>
                      <td colSpan="3">TOTALS — {filteredRows.length} students</td>
                      <td className="text-right">{plain(totals.billed)}</td>
                      <td className="text-right" style={{ color: 'var(--success)' }}>{plain(totals.paid)}</td>
                      <td className="text-right" style={{ color: 'var(--danger)' }}>{plain(totals.balance)}</td>
                      <td colSpan="2"></td>
                      <td className="no-print"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
        }
      </div>

      {setupModal && (
        <BooksSetupModal
          classes={classes} classId={classId} academicYearId={yearId} yearLabel={yearLabel}
          onClose={() => setSetupModal(false)}
          onSaved={(msg) => { setSetupModal(false); refresh(); showToast(msg, 'success'); }}
        />
      )}
    </div>
  );
}

function Metric({ label, value, sub, tone }) {
  const cls = tone === 'success' ? 'metric-value success'
    : tone === 'danger' ? 'metric-value danger' : 'metric-value';
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

function plain(n) { return fmtCedi(n).replace('GHS ', ''); }

function statusBadge(s) {
  return {
    paid_full: 'badge-success', paid_partial: 'badge-warning',
    unpaid: 'badge-danger', not_billed: 'badge-muted',
  }[s] || 'badge-muted';
}
function statusLabel(s) {
  return { paid_full: 'Full', paid_partial: 'Partial', unpaid: 'None', not_billed: 'No Bill' }[s] || s;
}

// ── Charging the books ──────────────────────────────────────────────────────
//
// One class, several, or the whole school — and correctable. Charging a class
// that already had books used to do nothing at all, silently, so a wrong price
// stayed on every pupil's account with no way back.
function BooksSetupModal({ classes, classId, academicYearId, yearLabel, onClose, onSaved }) {
  const showToast = useStore(s => s.showToast);
  const [scope, setScope] = useState(classId ? 'class' : 'school');
  const [classIds, setClassIds] = useState(classId ? [Number(classId)] : []);
  const [items, setItems] = useState([{ title: '', amount: '' }]);
  const [frameworks, setFrameworks] = useState([]);
  const [replace, setReplace] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // The Part B of every framework — a school that adopted a bill for its fees
    // should not have to retype the textbooks line from the same document.
    window.api.fees.frameworks('school_fees').then(list => {
      const books = [];
      for (const f of list || []) {
        for (const part of f.parts || []) {
          if (part.kind !== 'books') continue;
          for (const it of part.items) {
            books.push({ from: f.name, title: it.description, amount: it.amount });
          }
        }
      }
      setFrameworks(books.filter(b => b.amount > 0));
    }).catch(() => {});
  }, []);

  const total = items.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);

  async function save() {
    const valid = items.filter(i => String(i.title || '').trim());
    if (!valid.length) return showToast('Add at least one book with a title', 'warning');
    if (scope === 'classes' && classIds.length === 0) {
      return showToast('Choose at least one class', 'warning');
    }
    setSaving(true);
    const res = await window.api.books.generateForClass({
      scope: scope === 'school' ? 'school' : undefined,
      classIds: scope === 'school' ? undefined : classIds,
      academicYearId, items: valid, replace,
    });
    setSaving(false);
    if (!res?.ok) return showToast(res?.error || 'The books could not be charged', 'error');

    const parts = [];
    if (res.created) parts.push(`${res.created} pupil(s) charged`);
    if (res.updated) parts.push(`${res.updated} corrected`);
    if (res.skipped) parts.push(`${res.skipped} already had books — tick "correct" to redo them`);
    onSaved(`${parts.join(' · ')} at ${fmtCedi(res.per_pupil)} each`);
  }

  return (
    <Modal title={`Charge books — ${yearLabel || 'this year'}`} onClose={onClose} size="lg"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Charging…' : 'Charge the books'}
        </button>
      </>}>

      <div className="form-group">
        <label className="label">Charge them to</label>
        <div className="row gap-2">
          <button className={'btn ' + (scope === 'school' ? 'btn-primary' : 'btn-outline')}
            onClick={() => setScope('school')}>The whole school</button>
          <button className={'btn ' + (scope === 'classes' ? 'btn-primary' : 'btn-outline')}
            onClick={() => setScope('classes')}>Chosen classes</button>
        </div>
        <div className="text-xs text-muted">
          Different classes read different books, so most schools charge class by class.
        </div>
      </div>

      {scope === 'classes' && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            {classes.map(c => {
              const on = classIds.includes(c.id);
              return (
                <button key={c.id} className={'btn btn-sm ' + (on ? 'btn-primary' : 'btn-outline')}
                  onClick={() => setClassIds(ids => (on ? ids.filter(x => x !== c.id) : [...ids, c.id]))}>
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {frameworks.length > 0 && (
        <div className="row gap-2" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
          <span className="text-sm text-muted" style={{ alignSelf: 'center' }}>From a framework:</span>
          {frameworks.map(b => (
            <button key={`${b.from}-${b.title}`} className="btn btn-outline btn-sm"
              onClick={() => setItems(list => {
                const clean = list.filter(i => String(i.title || '').trim());
                return [...clean, { title: b.title, amount: b.amount }];
              })}>
              + {b.title} ({fmtCedi(b.amount)})
            </button>
          ))}
        </div>
      )}

      <table className="table">
        <thead>
          <tr><th>Book</th><th className="text-right" style={{ width: 140 }}>Amount</th>
            <th style={{ width: 40 }}></th></tr>
        </thead>
        <tbody>
          {items.map((row, i) => (
            <tr key={i}>
              <td>
                <input className="input" value={row.title ?? ''}
                  placeholder="e.g. English Reader BS4"
                  onChange={e => setItems(list => list.map((r, j) => (j === i ? { ...r, title: e.target.value } : r)))} />
              </td>
              <td>
                <input className="input text-right" type="number" step="0.01" min="0" value={row.amount ?? ''}
                  placeholder="0.00"
                  onChange={e => setItems(list => list.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))} />
              </td>
              <td>
                <button className="btn btn-ghost btn-sm" disabled={items.length === 1}
                  onClick={() => setItems(list => list.filter((_, j) => j !== i))}>✕</button>
              </td>
            </tr>
          ))}
          <tr>
            <td className="text-right bold">Total per pupil</td>
            <td className="text-right bold">{fmtCedi(total)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <button className="btn btn-outline btn-sm"
        onClick={() => setItems(list => [...list, { title: '', amount: '' }])}>+ Add a book</button>

      <label className="row gap-2" style={{ marginTop: 14, alignItems: 'flex-start' }}>
        <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)}
          style={{ marginTop: 3 }} />
        <span>
          <b>Correct pupils who already have books charged</b>
          <div className="text-xs text-muted">
            Rebuilds their charge from this list. Money already received is kept and the
            balance recalculated — a parent who has paid is credited against the new
            figure, not asked for it again. Leave this off and they are skipped.
          </div>
        </span>
      </label>
    </Modal>
  );
}
