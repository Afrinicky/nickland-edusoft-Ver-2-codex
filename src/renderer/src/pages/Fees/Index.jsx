// Nickland Edusoft — Fees Management Module.
//
// Five tabs, in the order the work happens: see where the term stands, decide
// what pupils owe, take the money, apply concessions, chase what is left.
// Templates, extra charges, books and withdrawn bills all live under Bills,
// because they are all part of deciding what a parent owes — as separate
// top-level tabs they gave no hint that a template is the thing a bill is made
// from, and schools were generating bills before writing a schedule.
import React, { useEffect, useState } from 'react';
import FeesDashboard from './Dashboard.jsx';
import BillsHub from './BillsHub.jsx';
import PaymentsHub from './PaymentsHub.jsx';
import DebtorsTab from './DebtorsTab.jsx';
import DiscountsTab from './DiscountsTab.jsx';

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'bills',     label: 'Bills' },
  { id: 'payments',  label: 'Payments' },
  { id: 'discounts', label: 'Discounts' },
  { id: 'debtors',   label: 'Debtors' },
];

export default function FeesIndex() {
  const [tab, setTab] = useState('dashboard');
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

  // The dashboard's cards deep-link into the sub-tabs, so a name it hands back
  // is mapped to the tab that now contains it.
  function switchTab(id) {
    const moved = { templates: 'bills', books: 'bills', bulkpay: 'payments', mobilepay: 'payments' };
    setTab(moved[id] || id);
  }

  return (
    <div className="fees-module">
      <div className="page-header">
        <div>
          <div className="page-title">Fees Management</div>
          <div className="page-subtitle">Bills and templates, payments, discounts, debtors</div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={'tab' + (tab === t.id ? ' active' : '')}
            onClick={() => setTab(t.id)}
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
        {tab === 'bills'     && <BillsHub />}
        {tab === 'payments'  && <PaymentsHub pending={pending} />}
        {tab === 'discounts' && <DiscountsTab />}
        {tab === 'debtors'   && <DebtorsTab />}
      </div>
    </div>
  );
}
