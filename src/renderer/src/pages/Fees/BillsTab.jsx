// Nickland Edusoft — Student Bills.
//
// The list of what each pupil owes this term, and the one place a bill can be
// issued, corrected or withdrawn. Bills have clearly-separated sections:
//   1. School Fees (tuition and the standing levies — once per term)
//   2. Additional charges raised during the term (excursion, sports week…)
//   3. Books (billed once per academic year, carried into T2/T3 as Arrears)
//
// Correcting or withdrawing an issued bill is restricted to the Proprietor and
// the Administrator. A bill is what a parent was told they owe, so changing one
// after the fact is a decision with consequences; the controls are hidden from
// everyone else and the Node side refuses the call regardless.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtCedi, fmtDate } from '../../lib/format.js';
import { previewBills } from '../../lib/printHelpers.js';
import Modal from '../../components/Modal.jsx';
import { mediaUrl } from '../../lib/media.js';

export default function BillsTab({ overview, perms = {}, onChanged, onGoToTemplates }) {
  const currentTerm = useStore(s => s.currentTerm);
  const classes = useStore(s => s.classes);
  const showToast = useStore(s => s.showToast);
  const [bills, setBills] = useState([]);
  const [classFilter, setClassFilter] = useState('');
  const [owingOnly, setOwingOnly] = useState(false);
  const [openedBillId, setOpenedBillId] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!currentTerm) return;
    const list = await window.api.fees.listBills({
      termId: currentTerm.id,
      classId: classFilter || undefined,
      owing: owingOnly || undefined,
    });
    setBills(list);
  }
  useEffect(() => { refresh(); }, [currentTerm, classFilter, owingOnly]);

  async function bulkGen(scope) {
    if (!currentTerm) return;
    const label = scope === 'class'
      ? (classes.find(c => String(c.id) === String(classFilter))?.name || 'this class')
      : 'every active pupil';
    if (!window.confirm(
      `Generate this term's school fees bill for ${label}?\n\n` +
      `Pupils who already have a bill will have theirs refreshed from the current ` +
      `fee template. Payments already received, and any extra charges raised this ` +
      `term, are kept.`
    )) return;

    setBusy(true);
    const res = await window.api.fees.generateBillsBulk({
      termId: currentTerm.id,
      scope,
      classId: scope === 'class' ? classFilter || undefined : undefined,
    });
    setBusy(false);
    if (!res?.ok) return showToast(res?.error || 'Bills could not be generated', 'error');

    if (res.generated > 0) showToast(`Generated ${res.generated} bill(s)`, 'success');
    // Silent skips are how a school ends up with unbilled pupils and no idea
    // why, so the reason is reported rather than counted and dropped.
    if (res.skipped > 0) {
      const reason = res.problems?.[0]?.reason || 'no reason recorded';
      showToast(`${res.skipped} pupil(s) skipped — ${reason}`, res.generated > 0 ? 'warning' : 'error');
    }
    refresh();
    onChanged?.();
  }

  if (openedBillId) {
    return (
      <BillDetail billId={openedBillId} perms={perms}
        onClose={() => { setOpenedBillId(null); refresh(); onChanged?.(); }} />
    );
  }

  const noTemplate = (overview?.coverage || []).some(c => c.template_scope === 'none' && c.active_students > 0);

  return (
    <div className="card">
      <div className="toolbar">
        <select className="select" value={classFilter}
          onChange={e => setClassFilter(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">All classes</option>
          {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
        </select>
        <label className="row gap-2">
          <input type="checkbox" checked={owingOnly} onChange={e => setOwingOnly(e.target.checked)} />
          Owing only
        </label>
        <div className="flex-1"></div>
        {bills.length > 0 && (
          <button className="btn btn-ghost" onClick={async () => {
            const r = await previewBills(bills.map(b => b.id));
            if (!r.ok) showToast(r.error, 'error');
          }}>🖨 Print {bills.length} bill(s)</button>
        )}
        <button className="btn btn-outline" disabled={busy} onClick={() => bulkGen('class')}
          title={classFilter ? '' : 'Choose a class first'}>
          Generate for class
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={() => bulkGen('all')}>
          {busy ? 'Working…' : 'Generate ALL bills'}
        </button>
      </div>

      {noTemplate && (
        <div className="text-sm" style={{ padding: '8px 12px', color: 'var(--danger)' }}>
          Some classes have no fee template, so their pupils cannot be billed at all.
          <button className="btn btn-ghost btn-sm" onClick={onGoToTemplates}>Fix in Fee Templates →</button>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Index No</th><th>Name</th><th>Class</th>
              <th className="text-right">Total Billed</th>
              <th className="text-right">Paid</th>
              <th className="text-right">Balance</th>
              <th>Generated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {bills.map(b => (
              <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => setOpenedBillId(b.id)}>
                <td className="bold">{b.index_number}</td>
                <td>
                  {b.surname} {b.first_name}
                  {(b.supplementary_total || 0) > 0 && (
                    <span className="badge badge-muted" style={{ marginLeft: 6 }}
                      title="Includes charges raised during the term">
                      +{fmtCedi(b.supplementary_total)}
                    </span>
                  )}
                </td>
                <td>{b.class_name}</td>
                <td className="text-right">{fmtCedi(b.total_billed || 0)}</td>
                <td className="text-right">{fmtCedi(b.total_paid || 0)}</td>
                <td className="text-right bold"
                  style={{ color: (b.balance || 0) > 0 ? 'var(--danger)' : 'var(--success)' }}>
                  {fmtCedi(b.balance || 0)}
                </td>
                <td className="text-sm text-muted">{fmtDate(b.generated_at)}</td>
                <td><button className="btn btn-ghost btn-sm">Open →</button></td>
              </tr>
            ))}
            {bills.length === 0 && (
              <tr>
                <td colSpan="8">
                  <div className="empty-state">
                    <h3>No bills for this term yet</h3>
                    <p>
                      Make sure the term's fee template is set up, then use
                      <b> Generate ALL bills</b>.
                    </p>
                    <button className="btn btn-outline btn-sm" onClick={onGoToTemplates}>
                      Open Fee Templates
                    </button>
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

// ── BillDetail: full printable view with Fees + Extras + Books sections ──
function BillDetail({ billId, perms = {}, onClose }) {
  const { settings } = useStore();
  const showToast = useStore(s => s.showToast);
  const [bill, setBill] = useState(null);
  const [propSig, setPropSig] = useState(null);
  const [headSig, setHeadSig] = useState(null);
  const [action, setAction] = useState(null);   // 'void' | 'delete' | 'edit' | 'add'
  const [editItem, setEditItem] = useState(null);

  const school = settings.school || {};
  const branding = settings.branding || {};
  const sigs = settings.signatures || {};
  const logoPath = branding.school_logo_path;

  async function load() {
    const b = await window.api.fees.getBill(billId);
    setBill(b);
  }

  useEffect(() => {
    (async () => {
      await load();
      const userId = useStore.getState().currentUser?.id;
      if (sigs.embed_proprietor_signature === 'true') {
        const res = await window.api.settings.getSignatureForUse({ role: 'proprietor', currentUserId: userId });
        if (res.ok) setPropSig(res);
      }
      if (sigs.embed_headmaster_signature === 'true') {
        const res = await window.api.settings.getSignatureForUse({ role: 'headmaster', currentUserId: userId });
        if (res.ok) setHeadSig(res);
      }
    })();
  }, [billId]);

  if (!bill) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;

  const allItems = bill.items || [];
  const typeOf = (i) => i.charge_type || (i.is_arrear ? 'arrear' : 'fees');
  const feeItems = allItems.filter(i => typeOf(i) !== 'extra');
  const extraItems = allItems.filter(i => typeOf(i) === 'extra');

  const feesSubtotal = feeItems.reduce((s, i) => s + (i.amount || 0), 0);
  const extrasSubtotal = extraItems.reduce((s, i) => s + (i.amount || 0), 0);
  const discountAmount = bill.discount_amount || 0;
  const feesNet = Math.max(0, feesSubtotal + extrasSubtotal - discountAmount);

  const booksBill = bill.books_bill || null;
  const booksItems = booksBill?.items || [];
  const booksSubtotal = booksItems.reduce((s, i) => s + (i.amount || 0), 0);
  const isFirstTerm = (bill.term_number || 1) === 1;
  const booksArrearsForThisTerm = !isFirstTerm ? (bill.books_arrears_amount || 0) : 0;

  const grandTotal = feesNet + (isFirstTerm ? booksSubtotal : booksArrearsForThisTerm);
  const totalPaid = (bill.total_paid || 0) + (booksBill?.total_paid || 0);
  const grandBalance = grandTotal - totalPaid;

  return (
    <div className="bill-detail-wrap">
      {/* Toolbar — hidden on print */}
      <div className="card no-print" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>← Back to Bills</button>
        <div style={{ flex: 1 }}></div>

        {/* Restricted controls. The Node side re-checks; hiding them here just
            avoids offering buttons that would only ever be refused. */}
        {perms.can_manage_issued_bills && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditItem(null); setAction('add'); }}>
              + Add a charge
            </button>
            {(bill.total_paid || 0) > 0
              ? <button className="btn btn-outline btn-sm" onClick={() => setAction('void')}>Void bill</button>
              : <>
                  <button className="btn btn-outline btn-sm" onClick={() => setAction('void')}>Void bill</button>
                  <button className="btn btn-danger btn-sm" onClick={() => setAction('delete')}>Delete bill</button>
                </>
            }
          </>
        )}
        <button className="btn btn-primary" onClick={async () => {
          const r = await previewBills([billId]);
          if (!r.ok) showToast(r.error, 'error');
        }}>🖨 Print Bill (PDF)</button>
      </div>

      {perms.can_manage_issued_bills && (
        <div className="card no-print text-xs text-muted" style={{ marginTop: -6 }}>
          Editing or withdrawing a bill changes what this parent was told they owe.
          Every change is recorded in the audit trail against your name, with the reason you give.
        </div>
      )}

      {/* The printable bill */}
      <div className="printable-page" style={{ marginTop: 16 }}>
        {/* Header */}
        <div className="print-header">
          {logoPath && <img src={mediaUrl(logoPath)} alt="" className="print-logo" />}
          <div className="print-school-block">
            <h1 className="print-school-name">{(school.school_name || 'School').toUpperCase()}</h1>
            {school.school_motto && <div className="print-school-motto">"{school.school_motto}"</div>}
            <div className="print-school-meta">
              {school.school_address && <div>{school.school_address}</div>}
              <div>
                {school.school_phone_1 && <span>Tel: {school.school_phone_1}</span>}
                {school.school_email && <span> · {school.school_email}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="print-divider"></div>

        <div className="print-title">STUDENT BILL</div>

        {/* Bill identity */}
        <div className="bill-meta-grid">
          <div><strong>Receipt/Bill No:</strong> #{bill.id}</div>
          <div><strong>Date:</strong> {fmtDate(bill.generated_at)}</div>
          <div><strong>Student:</strong> {bill.surname} {bill.first_name} {bill.other_names || ''}</div>
          <div><strong>Index No:</strong> {bill.index_number}</div>
          <div><strong>Class:</strong> {bill.class_name}</div>
          <div><strong>Term:</strong> {bill.term_label} ({bill.year_label || ''})</div>
        </div>

        {/* ─── SECTION 1: SCHOOL FEES ─────────────────────────── */}
        <div className="bill-section bill-section-fees">
          <div className="bill-section-header">
            <h3>SCHOOL FEES — {bill.term_label}</h3>
          </div>
          <table className="bill-items-table">
            <thead>
              <tr>
                <th style={{ width: 50 }}>#</th>
                <th>Description</th>
                <th className="text-right" style={{ width: 130 }}>Amount (GHS)</th>
                {perms.can_manage_issued_bills && <th className="no-print" style={{ width: 70 }}></th>}
              </tr>
            </thead>
            <tbody>
              {feeItems.length === 0
                ? <tr><td colSpan="3" className="text-muted text-center" style={{ padding: 12 }}>No fee items</td></tr>
                : feeItems.map((it, i) => (
                  <tr key={it.id || i} className={it.is_arrear ? 'bill-arrear-row' : ''}>
                    <td>{i + 1}</td>
                    <td>
                      {it.description}
                      {it.is_arrear === 1 && <span className="badge badge-warning" style={{ marginLeft: 8 }}>Arrears</span>}
                    </td>
                    <td className="text-right">{fmtCedi(it.amount).replace('GHS ', '')}</td>
                    {perms.can_manage_issued_bills && (
                      <td className="no-print">
                        <button className="btn btn-ghost btn-sm"
                          onClick={() => { setEditItem(it); setAction('edit'); }}>Edit</button>
                      </td>
                    )}
                  </tr>
                ))
              }
              <tr className="bill-subtotal-row">
                <td colSpan="2"><strong>Sub-total (fees)</strong></td>
                <td className="text-right"><strong>{fmtCedi(feesSubtotal).replace('GHS ', '')}</strong></td>
                {perms.can_manage_issued_bills && <td className="no-print"></td>}
              </tr>
            </tbody>
          </table>
        </div>

        {/* ─── SECTION 2: ADDITIONAL CHARGES THIS TERM ────────── */}
        {extraItems.length > 0 && (
          <>
            <div className="bill-section-separator"></div>
            <div className="bill-section bill-section-extras">
              <div className="bill-section-header">
                <h3>
                  ADDITIONAL CHARGES THIS TERM
                  <span className="text-sm" style={{ fontWeight: 400, marginLeft: 8 }}>
                    — raised during {bill.term_label}
                  </span>
                </h3>
              </div>
              <table className="bill-items-table">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>#</th>
                    <th>Description</th>
                    <th className="text-right" style={{ width: 130 }}>Amount (GHS)</th>
                    {perms.can_manage_issued_bills && <th className="no-print" style={{ width: 70 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {extraItems.map((it, i) => (
                    <tr key={it.id || i}>
                      <td>{i + 1}</td>
                      <td>{it.description}</td>
                      <td className="text-right">{fmtCedi(it.amount).replace('GHS ', '')}</td>
                      {perms.can_manage_issued_bills && (
                        <td className="no-print">
                          <button className="btn btn-ghost btn-sm"
                            onClick={() => { setEditItem(it); setAction('edit'); }}>Edit</button>
                        </td>
                      )}
                    </tr>
                  ))}
                  <tr className="bill-subtotal-row">
                    <td colSpan="2"><strong>Sub-total (additional charges)</strong></td>
                    <td className="text-right"><strong>{fmtCedi(extrasSubtotal).replace('GHS ', '')}</strong></td>
                    {perms.can_manage_issued_bills && <td className="no-print"></td>}
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        {discountAmount > 0 && (
          <table className="bill-items-table">
            <tbody>
              <tr style={{ color: 'var(--success)' }}>
                <td colSpan="2">
                  Discount {bill.discount_label && `(${bill.discount_label})`}
                  {bill.discount_reason && <div className="text-xs text-muted">{bill.discount_reason}</div>}
                </td>
                <td className="text-right">−{fmtCedi(discountAmount).replace('GHS ', '')}</td>
              </tr>
              <tr className="bill-net-row">
                <td colSpan="2"><strong>Net after discount</strong></td>
                <td className="text-right"><strong>{fmtCedi(feesNet).replace('GHS ', '')}</strong></td>
              </tr>
            </tbody>
          </table>
        )}

        {/* ═══ TWO ROWS OF VISUAL SEPARATION ═══ */}
        {(isFirstTerm && booksBill) || booksArrearsForThisTerm > 0 ? (
          <>
            <div className="bill-section-separator"></div>
            <div className="bill-section-separator"></div>

            {/* ─── SECTION 3: BOOKS ───────────────────────────────── */}
            <div className="bill-section bill-section-books">
              <div className="bill-section-header">
                <h3>
                  BOOKS
                  {isFirstTerm
                    ? <span className="text-sm" style={{ fontWeight: 400, marginLeft: 8 }}>— {bill.year_label || 'Current Year'}</span>
                    : <span className="badge badge-warning" style={{ marginLeft: 10 }}>Arrears carried forward</span>
                  }
                </h3>
              </div>
              <table className="bill-items-table">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>#</th>
                    <th>Description</th>
                    <th className="text-right" style={{ width: 130 }}>Amount (GHS)</th>
                  </tr>
                </thead>
                <tbody>
                  {isFirstTerm
                    ? booksItems.map((it, i) => (
                        <tr key={it.id}>
                          <td>{i + 1}</td>
                          <td>{it.title}</td>
                          <td className="text-right">{fmtCedi(it.amount).replace('GHS ', '')}</td>
                        </tr>
                      ))
                    : <tr>
                        <td>1</td>
                        <td>
                          Books Arrears (unpaid balance from earlier in {bill.year_label || 'this year'})
                          {booksBill?.notes && <div className="text-xs text-muted">{booksBill.notes}</div>}
                        </td>
                        <td className="text-right">{fmtCedi(booksArrearsForThisTerm).replace('GHS ', '')}</td>
                      </tr>
                  }
                  <tr className="bill-subtotal-row">
                    <td colSpan="2">
                      <strong>{isFirstTerm ? 'Sub-total (books)' : 'Books arrears total'}</strong>
                    </td>
                    <td className="text-right">
                      <strong>
                        {fmtCedi(isFirstTerm ? booksSubtotal : booksArrearsForThisTerm).replace('GHS ', '')}
                      </strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {/* Grand totals */}
        <div className="bill-totals-section">
          <table className="bill-totals-table">
            <tbody>
              <tr>
                <td>GRAND TOTAL DUE</td>
                <td className="text-right"><strong>{fmtCedi(grandTotal)}</strong></td>
              </tr>
              <tr>
                <td>Total Paid</td>
                <td className="text-right" style={{ color: 'var(--success)' }}>
                  −{fmtCedi(totalPaid)}
                </td>
              </tr>
              <tr style={{ borderTop: '2px solid #000' }}>
                <td><strong>BALANCE OUTSTANDING</strong></td>
                <td className="text-right">
                  <strong style={{
                    fontSize: 18,
                    color: grandBalance > 0 ? 'var(--danger)' : 'var(--success)',
                  }}>
                    {fmtCedi(grandBalance)}
                  </strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Signature footer */}
        <div className="print-footer">
          <div className="print-signature-grid">
            <div className="signature-block">
              {propSig?.path
                ? <img src={mediaUrl(propSig.path)} alt="" className="signature-image" />
                : <div className="signature-spacer"></div>
              }
              <div className="signature-line"></div>
              <div className="signature-name">{sigs.proprietor_name || '—'}</div>
              <div className="signature-label">Proprietor</div>
            </div>
            <div className="signature-block">
              {headSig?.path
                ? <img src={mediaUrl(headSig.path)} alt="" className="signature-image" />
                : <div className="signature-spacer"></div>
              }
              <div className="signature-line"></div>
              <div className="signature-name">{sigs.headmaster_name || '—'}</div>
              <div className="signature-label">Headmaster / Head Teacher</div>
            </div>
          </div>
          <div className="print-footer-meta">
            Generated on {fmtDate(new Date().toISOString())} ·
            {' '}This is an official bill from {school.school_name || 'the school'} ·
            {' '}Powered by Nickland Edusoft
          </div>
        </div>
      </div>

      {action && (
        <BillActionModal
          bill={bill}
          action={action}
          item={editItem}
          onClose={() => { setAction(null); setEditItem(null); }}
          onDone={async (closeBill) => {
            setAction(null); setEditItem(null);
            if (closeBill) onClose(); else await load();
          }}
        />
      )}
    </div>
  );
}

// One dialog for every restricted change, because they share the same shape:
// say what will happen, take a reason, write it to the audit trail.
function BillActionModal({ bill, action, item, onClose, onDone }) {
  const showToast = useStore(s => s.showToast);
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState(item?.description || '');
  const [amount, setAmount] = useState(item?.amount ?? '');
  const [busy, setBusy] = useState(false);

  const titles = {
    void: 'Void this bill',
    delete: 'Delete this bill',
    edit: 'Correct a line on this bill',
    add: 'Add a charge to this bill',
  };

  async function submit(remove = false) {
    if (reason.trim().length < 5) return showToast('Please give a reason — it goes on the audit trail.', 'warning');
    setBusy(true);
    let res;
    if (action === 'void') res = await window.api.fees.voidBill({ billId: bill.id, reason });
    else if (action === 'delete') res = await window.api.fees.deleteBill({ billId: bill.id, reason });
    else res = await window.api.fees.adjustBillItem({
      billId: bill.id,
      itemId: item?.id,
      description, amount: parseFloat(amount) || 0,
      reason, remove,
    });
    setBusy(false);

    if (!res?.ok) return showToast(res?.error || 'That change was refused.', 'error');
    if (res.warning) showToast(res.warning, 'warning');
    else showToast('Done — recorded in the audit trail.', 'success');
    onDone(action === 'void' || action === 'delete');
  }

  return (
    <Modal title={titles[action]} onClose={onClose} size="sm"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        {action === 'edit' && (
          <button className="btn btn-outline" disabled={busy} onClick={() => submit(true)}>
            Remove this line
          </button>
        )}
        <button className={'btn ' + (action === 'delete' ? 'btn-danger' : 'btn-primary')}
          disabled={busy} onClick={() => submit(false)}>
          {busy ? 'Working…' : (action === 'delete' ? 'Delete permanently' : 'Confirm')}
        </button>
      </>}>

      <div className="text-sm" style={{ marginBottom: 12 }}>
        <b>{bill.surname} {bill.first_name}</b> · {bill.index_number} · {bill.term_label}
      </div>

      {action === 'void' && (
        <p className="text-sm">
          The bill stays on record but is withdrawn: it disappears from the bills list,
          the debtors report and every total, and it will not be carried forward as arrears.
          {(bill.total_paid || 0) > 0 && (
            <> The <b>{fmtCedi(bill.total_paid)}</b> already received stays recorded in Finance —
            reverse those payments separately if the money is being refunded.</>
          )}
          {' '}You can restore it later from <b>Bills → Voided</b>.
        </p>
      )}

      {action === 'delete' && (
        <p className="text-sm" style={{ color: 'var(--danger)' }}>
          This removes the bill and its line items permanently. It is only possible because
          nothing has been paid against it. If in doubt, <b>void</b> it instead — a voided bill
          can be restored.
        </p>
      )}

      {(action === 'edit' || action === 'add') && (
        <>
          <div className="form-group">
            <label className="label">Description</label>
            <input className="input" value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Late registration" />
          </div>
          <div className="form-group">
            <label className="label">Amount (GHS)</label>
            <input className="input" type="number" step="0.01" value={amount}
              onChange={e => setAmount(e.target.value)} />
          </div>
        </>
      )}

      <div className="form-group">
        <label className="label">Reason (required)</label>
        <textarea className="input" rows={3} value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Why is this bill being changed? This is stored against your name." />
      </div>
    </Modal>
  );
}
