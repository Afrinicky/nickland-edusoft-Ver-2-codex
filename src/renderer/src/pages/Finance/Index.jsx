// Nickland Edusoft — Finance Module (tabbed, accountant-grade)
import React, { useState } from 'react';
import FinanceDashboard from './Dashboard.jsx';
import IncomeTab from './IncomeTab.jsx';
import ExpensesTab from './ExpensesTab.jsx';
import BalancingTab from './BalancingTab.jsx';
import FinancialStatementTab from './FinancialStatementTab.jsx';
import AuditTab from './AuditTab.jsx';
import BudgetsTab from './BudgetsTab.jsx';

const TABS = [
  { id: 'dashboard',  label: 'Dashboard' },
  { id: 'income',     label: 'Income' },
  { id: 'expenses',   label: 'Expenses & Reports' },
  { id: 'balancing',  label: 'Cashbook' },
  { id: 'statement',  label: 'Financial Statement' },
  { id: 'audit',      label: 'Audit & Tracker' },
  { id: 'budgets',    label: 'Budgets' },
];

export default function FinanceIndex() {
  const [tab, setTab] = useState('dashboard');

  return (
    <div className="finance-module">
      <div className="page-header">
        <div>
          <div className="page-title">Finance</div>
          <div className="page-subtitle">Income, expenses, cashbook, financial statements, audit, budgets</div>
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
        {tab === 'dashboard' && <FinanceDashboard onSwitchTab={setTab} />}
        {tab === 'income'    && <IncomeTab />}
        {tab === 'expenses'  && <ExpensesTab />}
        {tab === 'balancing' && <BalancingTab onSwitchTab={setTab} />}
        {tab === 'statement' && <FinancialStatementTab />}
        {tab === 'audit'     && <AuditTab />}
        {tab === 'budgets'   && <BudgetsTab />}
      </div>
    </div>
  );
}
