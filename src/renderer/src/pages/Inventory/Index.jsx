// Nickland Edusoft — Purchasing & Inventory Module (tabbed)
import React, { useState } from 'react';
import InventoryDashboard from './Dashboard.jsx';
import InventoryItemsTab from './ItemsTab.jsx';
import InventoryMovementsTab from './MovementsTab.jsx';

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'items',     label: 'Items' },
  { id: 'movements', label: 'Movements' },
];

export default function InventoryIndex() {
  const [tab, setTab] = useState('dashboard');
  return (
    <div className="inventory-module">
      <div className="page-header">
        <div>
          <div className="page-title">Purchasing & Inventory</div>
          <div className="page-subtitle">
            Items, stock levels, and movements — purchases recorded as expenses
            (categories: supplies, canteen supplies, construction, maintenance)
            are automatically logged here.
          </div>
        </div>
      </div>
      <div className="tabs">
        {TABS.map(t => (
          <button key={t.id} className={'tab' + (tab === t.id ? ' active' : '')} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="tab-content">
        {tab === 'dashboard' && <InventoryDashboard onSwitchTab={setTab} />}
        {tab === 'items'     && <InventoryItemsTab />}
        {tab === 'movements' && <InventoryMovementsTab />}
      </div>
    </div>
  );
}
