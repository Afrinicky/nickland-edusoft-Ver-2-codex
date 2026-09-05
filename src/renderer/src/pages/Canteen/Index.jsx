// Nickland Edusoft — Canteen Module (tabbed)
import React, { useState } from 'react';
import CanteenDashboard from './Dashboard.jsx';
import CanteenSheetTab from './CanteenSheetTab.jsx';
import CanteenQuickPayTab from './QuickPayTab.jsx';
import DebtorsTab from './DebtorsTab.jsx';
import { useStore } from '../../store/index.js';

// The term calendar has moved to Fees → Bills → Canteen.
//
// It was never really a canteen-module setting: the calendar IS the canteen
// bill — the daily rate times the days the school actually opens — and it
// belongs with the school's other bills, beside the school fees and the books.
// What stays here is collecting the money, which is the class teacher's job.
const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'sheet',     label: 'Canteen Sheet' },
  { id: 'quickpay',  label: 'Quick Pay (single day)' },
  { id: 'debtors',   label: 'Debtors' },
];

export default function CanteenIndex() {
  const can = useStore(s => s.can);
  const tabs = TABS.filter(t => !t.need || can(t.need[0], t.need[1]));
  const [tab, setTab] = useState('dashboard');
  // A tab reached by a stale selection after access was withdrawn must not
  // stay open.
  const active = tabs.some(t => t.id === tab) ? tab : 'dashboard';

  return (
    <div className="canteen-module">
      <div className="page-header">
        <div>
          <div className="page-title">Canteen</div>
          <div className="page-subtitle">
            Daily-rate canteen payments, attendance-linked exemptions, debtors
            {' · '}the term's feeding calendar is under <b>Fees → Bills → Canteen</b>
          </div>
        </div>
      </div>

      <div className="tabs">
        {tabs.map(t => (
          <button
            key={t.id}
            className={'tab' + (active === t.id ? ' active' : '')}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {active === 'dashboard' && <CanteenDashboard onSwitchTab={setTab} />}
        {active === 'sheet'     && <CanteenSheetTab />}
        {active === 'quickpay'  && <CanteenQuickPayTab />}
        {active === 'debtors'   && <DebtorsTab />}
      </div>
    </div>
  );
}
