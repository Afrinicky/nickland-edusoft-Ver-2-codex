// Purchasing & Inventory.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React from 'react';
import { ModulePage } from '../../src/module';
import { RequireModule } from '../../src/appshell';
import {
  InventoryDashboard, InventoryItems, InventoryMovements,
} from '../../src/screens/mod/logistics';

export default function Inventory() {
  return (
    <RequireModule moduleKey="inventory">
      <ModulePage moduleKey="inventory" subtitle="Items, stock and purchase tracking">
        {(tab) => {
          switch (tab) {
            case 'dashboard': return <InventoryDashboard />;
            case 'items':     return <InventoryItems />;
            case 'movements': return <InventoryMovements />;
            default:          return null;
          }
        }}
      </ModulePage>
    </RequireModule>
  );
}
