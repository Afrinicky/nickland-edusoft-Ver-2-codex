// The signed-in application: one menu, gated by what the account holds.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Every module page sits under this. The shell decides which chrome to draw —
// the installed desktop's sidebar and status strip on a wide window, the app's
// bottom bar and drawer on a phone — and both are built from the same list of
// modules. See src/appshell.jsx.
import React from 'react';
import { Slot } from 'expo-router';
import { ModuleShell } from '../../src/appshell';

export default function AppLayout() {
  return <ModuleShell><Slot /></ModuleShell>;
}
