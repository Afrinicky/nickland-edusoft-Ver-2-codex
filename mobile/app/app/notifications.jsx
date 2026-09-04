// Notifications.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React from 'react';
import { ModulePage } from '../../src/module';
import { RequireModule } from '../../src/appshell';
import Notices from '../../src/screens/admin/notices';
import { Compose, NotificationHistory } from '../../src/screens/mod/notify';

export default function Notifications() {
  return (
    <RequireModule moduleKey="notifications">
      <ModulePage moduleKey="notifications" subtitle="Notices in the app, and SMS to telephones">
        {(tab) => {
          switch (tab) {
            case 'compose': return <Compose />;
            case 'notices': return <Notices />;
            case 'history': return <NotificationHistory />;
            default:        return null;
          }
        }}
      </ModulePage>
    </RequireModule>
  );
}
