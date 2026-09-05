// Nickland Edusoft — Fees Management Module.
//
// Four tabs, in the order the work happens on a school morning:
//
//   Dashboard   where the term stands
//   Payments    taking money in — the counter's screen, and the busiest one
//   Bills       deciding what a family owes, of every kind
//   Discounts   the concessions that change it
//
// ── Why Payments is second ──────────────────────────────────────────────────
//
// Bills are raised once a term. Payments are taken every morning of it. The
// tab a bursar opens forty times a day was third in the strip behind the one
// they open three times a year, which is backwards: the order should follow
// how often a thing is done, not the order the data is created in.
//
// Debtors is gone as a top-level tab. "Who owes" is not a separate activity —
// it is the second half of "what have we billed", and it now sits under those
// totals on the Bills home, where the figures that raise the question are.
import React, { useEffect, useState } from 'react';
import FeesDashboard from './Dashboard.jsx';
import BillsHub from './BillsHub.jsx';
import PaymentsHub from './PaymentsHub.jsx';
import DiscountsTab from './DiscountsTab.jsx';

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'payments',  label: 'Payments' },
  { id: 'bills',     label: 'Bills' },
  { id: 'discounts', label: 'Discounts' },
];

export default function FeesIndex() {
  const [tab, setTab] = useState('dashboard');
  // A tab can be opened on a particular sub-tab — the dashboard's "Take a
  // payment" lands on the single-payment desk, not on whichever sub-tab was
  // last used.
  const [landing, setLanding] = useState(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let live = true;
    async function poll() {
      try { const n = await window.api.paymentIntents.pendingCount(); if (live) setPending(n || 0); } catch (_) {}
    }
    poll();
    const id = setInterval(poll, 30000);
    return () => { live = false; clearInterval(id); };
  }, [tab]);

  // The dashboard's cards deep-link by name. Names that used to be their own
  // tabs are mapped to the tab that now contains them, so an old link never
  // lands nowhere.
  function switchTab(id, sub) {
    const moved = {
      templates: ['bills', 'schoolfees'],
      books: ['bills', 'books'],
      debtors: ['bills', 'home'],
      voided: ['bills', 'voided'],
      canteen: ['bills', 'canteen'],
      bulkpay: ['payments', 'sheet'],
      mobilepay: ['payments', 'mobile'],
      takepayment: ['payments', 'single'],
    };
    const [target, defaultSub] = moved[id] || [id, null];
    setTab(target);
    setLanding(sub || defaultSub);
  }

  return (
    <div className="fees-module">
      <div className="page-header">
        <div>
          <div className="page-title">Fees Management</div>
          <div className="page-subtitle">Payments, bills, discounts and arrears</div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={'tab' + (tab === t.id ? ' active' : '')}
            onClick={() => { setTab(t.id); setLanding(null); }}
          >
            {t.label}
            {t.id === 'payments' && pending > 0 && (
              <span className="topbar-badge" style={{ marginLeft: 6 }}>{pending}</span>
            )}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {tab === 'dashboard' && <FeesDashboard onSwitchTab={switchTab} />}
        {tab === 'payments'  && <PaymentsHub pending={pending} initialTab={landing} />}
        {tab === 'bills'     && <BillsHub initialTab={landing} />}
        {tab === 'discounts' && <DiscountsTab />}
      </div>
    </div>
  );
}
