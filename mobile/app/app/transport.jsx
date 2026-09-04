// Transport.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React from 'react';
import { ModulePage } from '../../src/module';
import { RequireModule } from '../../src/appshell';
import { TransportRoutes, TransportRiders, TransportPayments } from '../../src/screens/mod/logistics';

export default function Transport() {
  return (
    <RequireModule moduleKey="transport">
      <ModulePage moduleKey="transport" subtitle="Routes, who rides them, and what they pay">
        {(tab) => {
          switch (tab) {
            case 'routes':   return <TransportRoutes />;
            case 'riders':   return <TransportRiders />;
            case 'payments': return <TransportPayments />;
            default:         return null;
          }
        }}
      </ModulePage>
    </RequireModule>
  );
}
