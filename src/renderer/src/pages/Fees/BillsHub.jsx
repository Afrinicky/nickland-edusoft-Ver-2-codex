// Nickland Edusoft — Bills.
//
// Everything the school charges for, arranged the way a school thinks about it
// rather than the way the tables are laid out.
//
//   Home           what has been billed, and who has not paid
//   School fees    the term's fee — built, raised, amended, printed
//   Canteen        the term's feeding days, and the bill they imply
//   Books          the year's textbooks
//   Extra charges  what came up mid-term
//   Withdrawn      what was taken off the books, and why
//
// ── What changed, and why ───────────────────────────────────────────────────
//
// Bills used to open on a LIST of school-fees bills, with fee templates as a
// sibling tab, and Debtors as a separate top-level tab that only ever counted
// school fees. Three things were wrong with that. A school that also ran a
// canteen and a bus had no screen that said what it had billed in total. The
// template — the thing a bill is made FROM — sat beside the bill rather than
// inside it, so schools generated bills before writing a schedule. And Debtors
// answered "who owes" in a different place from the totals that raise the
// question.
//
// So: one home that reports every kind of bill on the same five figures and
// carries the debtors list underneath them, and one tab per kind of bill,
// each of which raises, amends and prints its own.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import BillsHome from './BillsHome.jsx';
import SchoolFeesTab from './SchoolFeesTab.jsx';
import CanteenBillsTab from './CanteenBillsTab.jsx';
import BooksTab from './BooksTab.jsx';
import SupplementaryTab from './SupplementaryTab.jsx';
import VoidedBillsTab from './VoidedBillsTab.jsx';

export default function BillsHub({ initialTab }) {
  const currentTerm = useStore(s => s.currentTerm);
  const showToast = useStore(s => s.showToast);
  const [sub, setSub] = useState(initialTab || 'home');
  const [summary, setSummary] = useState(null);
  const [overview, setOverview] = useState(null);
  const [perms, setPerms] = useState({ can_manage_issued_bills: false });

  async function refresh() {
    if (!currentTerm) return;
    try {
      const [s, o, p] = await Promise.all([
        window.api.fees.billsSummary(currentTerm.id),
        window.api.fees.billingOverview(currentTerm.id),
        window.api.fees.billingPermissions(),
      ]);
      setSummary(s && s.ok ? s : null);
      setOverview(o && o.ok ? o : null);
      setPerms(p || { can_manage_issued_bills: false });
    } catch (_) {
      // The sub-tabs each read their own data and still work without the
      // summary strip, so a failure here is not a failure of the screen.
    }
  }
  useEffect(() => { refresh(); }, [currentTerm, sub]);

  const counts = overview?.counts || {};

  const SUBS = [
    { id: 'home', label: 'Home' },
    { id: 'schoolfees', label: 'School Fees' },
    { id: 'canteen', label: 'Canteen' },
    { id: 'books', label: 'Books' },
    { id: 'extras', label: 'Extra Charges' },
    { id: 'voided', label: 'Withdrawn Bills', badge: counts.voided_bills || 0 },
  ];

  async function printDebtors() {
    if (!currentTerm) return;
    const res = await window.api.reports.generateDebtorsList(currentTerm.id, {});
    if (!res?.ok) return showToast(res?.error || 'The list could not be produced', 'error');
    await window.api.app.openPdfPreview(res.path);
  }

  return (
    <div>
      {/* Anything stopping the school getting paid, said once, at the top. */}
      {(overview?.warnings || []).length > 0 && sub === 'home' && (
        <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
          {overview.warnings.map((w, i) => (
            <div key={i} className="text-sm"
              style={{
                padding: '8px 12px', borderRadius: 6,
                background: w.level === 'error' ? 'var(--danger-bg, #fef2f2)' : 'var(--warning-bg, #fffbeb)',
                color: w.level === 'error' ? 'var(--danger)' : 'var(--warning)',
              }}>
              {w.level === 'error' ? '⛔ ' : '⚠ '}{w.message}
              {w.level === 'error' && (
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }}
                  onClick={() => setSub('schoolfees')}>Raise the term's fees →</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="sub-tabs">
        {SUBS.map(s => (
          <button key={s.id} className={'sub-tab' + (sub === s.id ? ' active' : '')}
            onClick={() => setSub(s.id)}>
            {s.label}
            {s.badge > 0 && <span className="topbar-badge" style={{ marginLeft: 6 }}>{s.badge}</span>}
          </button>
        ))}
      </div>

      {sub === 'home' && (
        <BillsHome summary={summary} onOpen={setSub} onPrintDebtors={printDebtors} />
      )}
      {sub === 'schoolfees' && (
        <SchoolFeesTab overview={overview} perms={perms} onChanged={refresh} />
      )}
      {sub === 'canteen' && <CanteenBillsTab />}
      {sub === 'books' && <BooksTab />}
      {sub === 'extras' && (
        <SupplementaryTab overview={overview} perms={perms} onChanged={refresh} />
      )}
      {sub === 'voided' && <VoidedBillsTab perms={perms} onChanged={refresh} />}
    </div>
  );
}
