// Nickland Edusoft — Fees Management Module (tabbed)
import React, { useState } from 'react';
import FeesDashboard from './Dashboard.jsx';
import BillsTab from './BillsTab.jsx';
import TemplatesTab from './TemplatesTab.jsx';
import DebtorsTab from './DebtorsTab.jsx';
import BulkPaySheet from './BulkPaySheet.jsx';
import DiscountsTab from './DiscountsTab.jsx';
import BooksTab from './BooksTab.jsx';

const TABS = [
  { id: 'dashboard',  label: 'Dashboard' },
  { id: 'bulkpay',    label: 'Bulk Payment Sheet' },
  { id: 'bills',      label: 'Bills' },
  { id: 'templates',  label: 'Fees Template' },
  { id: 'discounts',  label: 'Discounts' },
  { id: 'books',      label: 'Books' },
  { id: 'debtors',    label: 'Debtors' },
];

export default function FeesIndex() {
  const [tab, setTab] = useState('dashboard');

  return (
    <div className="fees-module">
      <div className="page-header">
        <div>
          <div className="page-title">Fees Management</div>
          <div className="page-subtitle">Bills, payments, templates, discounts, books, debtors</div>
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
        {tab === 'dashboard'  && <FeesDashboard onSwitchTab={setTab} />}
        {tab === 'bulkpay'    && <BulkPaySheet />}
        {tab === 'bills'      && <BillsTab />}
        {tab === 'templates'  && <TemplatesTab />}
        {tab === 'discounts'  && <DiscountsTab />}
        {tab === 'books'      && <BooksTab />}
        {tab === 'debtors'    && <DebtorsTab />}
      </div>
    </div>
  );
}
