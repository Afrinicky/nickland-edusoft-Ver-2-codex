// Messages — conversations with parents and with colleagues.
// Copyright © 2026 Nickland Sales. All rights reserved.
import React from 'react';
import Threads from '../../../src/screens/staff/messages';
import { RequireModule } from '../../../src/appshell';

export default function Messages() {
  return (
    <RequireModule moduleKey="messages">
      <Threads />
    </RequireModule>
  );
}
