// The school this morning.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// One page, no tabs — the summary the installed application opens its Dashboard
// on. Every section is drawn only if the account may see the module behind it,
// which is why a bursar's dashboard has no attendance figure and a class
// teacher's has no money on it. Filling a section with zeroes instead would be
// worse than leaving it out: a zero is a claim, and it would be a false one.
import React from 'react';
import Overview from '../../src/screens/admin/index';
import { RequireModule } from '../../src/appshell';

export default function Dashboard() {
  return (
    <RequireModule moduleKey="dashboard">
      <Overview />
    </RequireModule>
  );
}
