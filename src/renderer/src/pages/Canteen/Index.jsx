// Nickland Edusoft — Canteen Module (tabbed)
import React, { useState } from 'react';
import CanteenDashboard from './Dashboard.jsx';
import CanteenSheetTab from './CanteenSheetTab.jsx';
import CanteenQuickPayTab from './QuickPayTab.jsx';
import CalendarTab from './CalendarTab.jsx';
import DebtorsTab from './DebtorsTab.jsx';

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'sheet',     label: 'Canteen Sheet' },
  { id: 'quickpay',  label: 'Quick Pay (single day)' },
  { id: 'calendar',  label: 'Calendar' },
  { id: 'debtors',   label: 'Debtors' },
];

export default function CanteenIndex() {
  const [tab, setTab] = useState('dashboard');

  return (
    <div className="canteen-module">
      <div className="page-header">
        <div>
          <div className="page-title">Canteen</div>
          <div className="page-subtitle">Daily-rate canteen payments, attendance-linked exemptions, debtors</div>
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
          </button>
        ))}
      </div>

      <div className="tab-content">
        {tab === 'dashboard' && <CanteenDashboard onSwitchTab={setTab} />}
        {tab === 'sheet'     && <CanteenSheetTab />}
        {tab === 'quickpay'  && <CanteenQuickPayTab />}
        {tab === 'calendar'  && <CalendarTab />}
        {tab === 'debtors'   && <DebtorsTab />}
      </div>
    </div>
  );
}
