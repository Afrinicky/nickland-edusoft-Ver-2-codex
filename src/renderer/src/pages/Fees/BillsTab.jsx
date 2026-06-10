// Nickland Edusoft — Fee Bills Tab
// List + drill-into-bill view. Bills have TWO clearly-separated sections:
//   1. School Fees (tuition, PTA dues, first-aid, etc — generated per term)
//   2. Books (billed once per academic year, in Term 1; carries forward to T2/T3 as Arrears)
// Two visual rows of separation between the sections.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fullName, fmtCedi, fmtDate } from '../../lib/format.js';
import { previewBills } from '../../lib/printHelpers.js';

export default function BillsTab() {
  const currentTerm = useStore(s => s.currentTerm);
  const classes = useStore(s => s.classes);
  const showToast = useStore(s => s.showToast);
  const [bills, setBills] = useState([]);
  const [classFilter, setClassFilter] = useState('');
  const [owingOnly, setOwingOnly] = useState(false);
  const [openedBillId, setOpenedBillId] = useState(null);

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
    const res = await window.api.fees.generateBillsBulk({
      termId: currentTerm.id,
      scope,
      classId: scope === 'class' ? classFilter || undefined : undefined,
    });
    if (res.ok) { showToast(`Generated ${res.generated} bills`, 'success'); refresh(); }
  }

  if (openedBillId) {
    return <BillDetail billId={openedBillId} onClose={() => { setOpenedBillId(null); refresh(); }} />;
  }

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
        <button className="btn btn-outline" onClick={() => bulkGen('all')}>Generate ALL</button>
        <button className="btn btn-outline" onClick={() => bulkGen('class')} disabled={!classFilter}>
          Generate for class
        </button>
      </div>

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
                <td>{b.surname} {b.first_name}</td>
                <td>{b.class_name}</td>
                <td className="text-right">{fmtCedi(b.total_billed || b.total_amount || 0)}</td>
                <td className="text-right">{fmtCedi(b.total_paid || b.paid_amount || 0)}</td>
                <td className="text-right bold"
                  style={{ color: (b.balance || 0) > 0 ? 'var(--danger)' : 'var(--success)' }}>
                  {fmtCedi(b.balance || 0)}
                </td>
                <td className="text-sm text-muted">{fmtDate(b.generated_at || b.generated_date)}</td>
                <td><button className="btn btn-ghost btn-sm">Open →</button></td>
              </tr>
            ))}
            {bills.length === 0 && (
              <tr>
                <td colSpan="8">
                  <div className="empty-state">
                    <h3>No bills generated yet</h3>
                    <p>Use the "Generate" buttons above.</p>
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

// ── BillDetail: full printable view with Fees + Books sections ─────────
function BillDetail({ billId, onClose }) {
  const { settings } = useStore();
  const [bill, setBill] = useState(null);
  const [propSig, setPropSig] = useState(null);
  const [headSig, setHeadSig] = useState(null);

  const school = settings.school || {};
  const branding = settings.branding || {};
  const sigs = settings.signatures || {};
  const logoPath = branding.school_logo_path;

  useEffect(() => {
    (async () => {
      const b = await window.api.fees.getBill(billId);
      setBill(b);
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

  // Compute totals from items, applying the per-bill discount only to the fee section
  const feeItems = (bill.items || []);
  const feesSubtotal = feeItems.reduce((s, i) => s + (i.amount || 0), 0);
  const discountAmount = bill.discount_amount || 0;
  const feesNet = Math.max(0, feesSubtotal - discountAmount);

  const booksBill = bill.books_bill || null;
  const booksItems = booksBill?.items || [];
  const booksSubtotal = booksItems.reduce((s, i) => s + (i.amount || 0), 0);
  // For Term 1, books appear directly. For Term 2/3, only the outstanding balance appears as "Books Arrears"
  const isFirstTerm = (bill.term_number || 1) === 1;
  const booksArrearsForThisTerm = !isFirstTerm ? (bill.books_arrears_amount || 0) : 0;

  const grandTotal = feesNet + (isFirstTerm ? booksSubtotal : booksArrearsForThisTerm);
  const totalPaid = (bill.total_paid || 0) + (booksBill?.total_paid || 0);
  const grandBalance = grandTotal - totalPaid;

  return (
    <div className="bill-detail-wrap">
      {/* Toolbar — hidden on print */}
      <div className="card no-print" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>← Back to Bills</button>
        <div style={{ flex: 1 }}></div>
        <button className="btn btn-primary" onClick={async () => {
          const r = await previewBills([billId]);
          if (!r.ok) useStore.getState().showToast(r.error, 'error');
        }}>🖨 Print Bill (PDF)</button>
      </div>

      {/* The printable bill */}
      <div className="printable-page" style={{ marginTop: 16 }}>
        {/* Header */}
        <div className="print-header">
          {logoPath && <img src={`file://${logoPath}`} alt="" className="print-logo" />}
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
                  </tr>
                ))
              }
              <tr className="bill-subtotal-row">
                <td colSpan="2"><strong>Sub-total (fees)</strong></td>
                <td className="text-right"><strong>{fmtCedi(feesSubtotal).replace('GHS ', '')}</strong></td>
              </tr>
              {discountAmount > 0 && (
                <>
                  <tr style={{ color: 'var(--success)' }}>
                    <td colSpan="2">
                      Discount {bill.discount_label && `(${bill.discount_label})`}
                      {bill.discount_reason && <div className="text-xs text-muted">{bill.discount_reason}</div>}
                    </td>
                    <td className="text-right">−{fmtCedi(discountAmount).replace('GHS ', '')}</td>
                  </tr>
                  <tr className="bill-net-row">
                    <td colSpan="2"><strong>Net School Fees</strong></td>
                    <td className="text-right"><strong>{fmtCedi(feesNet).replace('GHS ', '')}</strong></td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* ═══ TWO ROWS OF VISUAL SEPARATION ═══ */}
        {(isFirstTerm && booksBill) || booksArrearsForThisTerm > 0 ? (
          <>
            <div className="bill-section-separator"></div>
            <div className="bill-section-separator"></div>

            {/* ─── SECTION 2: BOOKS ───────────────────────────────── */}
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
                ? <img src={`file://${propSig.path}`} alt="" className="signature-image" />
                : <div className="signature-spacer"></div>
              }
              <div className="signature-line"></div>
              <div className="signature-name">{sigs.proprietor_name || '—'}</div>
              <div className="signature-label">Proprietor</div>
            </div>
            <div className="signature-block">
              {headSig?.path
                ? <img src={`file://${headSig.path}`} alt="" className="signature-image" />
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
    </div>
  );
}
