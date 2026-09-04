// Everything that used to be a portal route.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The app was four areas — /staff, /finance, /admin, /system — and it is now
// one list of modules under /app. Those old paths are in people's bookmarks, in
// staff-room chats, in the sign-in redirect of a phone that has not updated,
// and in the notification a parent tapped last week. None of them should land
// on a blank page.
//
// So every one of them still resolves, to the module and tab that now does the
// job. This is a catch-all rather than sixty stub files because expo-router
// resolves a concrete route before it reaches here: anything that still exists
// is served, and only what has genuinely moved arrives at this component.
import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../src/auth';
import { landingHref } from '../src/modules';
import { Loading } from '../src/ui';

// Longest first, so /staff/student/12 is not caught by /staff.
const MOVED = [
  ['/staff/attendance',   '/app/students?tab=register'],
  ['/staff/students',     '/app/students?tab=roll'],
  ['/staff/student/',     '/app/students/'],
  ['/staff/scores',       '/app/academics?tab=examscores'],
  ['/staff/assessments',  '/app/academics?tab=classscores'],
  ['/staff/results',      '/app/academics?tab=results'],
  ['/staff/homework',     '/app/academics?tab=homework'],
  ['/staff/insight',      '/app/academics?tab=insight'],
  ['/staff/timetable',    '/app/academics?tab=timetable'],
  ['/staff/notes',        '/app/staff?tab=lessonnotes'],
  ['/staff/canteen',      '/app/canteen?tab=quickpay'],
  ['/staff/debtors',      '/app/fees?tab=debtors'],
  ['/staff/messages',     '/app/messages'],
  ['/staff/message/',     '/app/messages/'],
  ['/staff/notices',      '/app/notifications?tab=notices'],
  ['/staff/account',      '/app/account'],
  ['/staff/me',           '/app/me'],
  ['/finance/collections','/app/fees?tab=payments'],
  ['/finance/debtors',    '/app/fees?tab=debtors'],
  ['/finance/bills',      '/app/fees?tab=bills'],
  ['/finance/online',     '/app/fees?tab=online'],
  ['/finance/student/',   '/app/fees/'],
  ['/finance/expenses',   '/app/finance?tab=expenses'],
  ['/finance/statement',  '/app/finance?tab=statement'],
  ['/finance/stock',      '/app/inventory?tab=items'],
  ['/finance/payroll',    '/app/payroll?tab=run'],
  ['/admin/academics',    '/app/academics?tab=dashboard'],
  ['/admin/approvals',    '/app/staff?tab=leave'],
  ['/admin/students',     '/app/students?tab=roll'],
  ['/admin/staff',        '/app/staff?tab=roll'],
  ['/admin/notices',      '/app/notifications?tab=notices'],
  ['/system/users',       '/app/settings?tab=users'],
  ['/system/access',      '/app/settings?tab=access'],
  ['/system/audit',       '/app/settings?tab=audit'],
  ['/system/settings',    '/app/settings?tab=school'],
  ['/finance',            '/app/finance'],
  ['/admin',              '/app/dashboard'],
  ['/system',             '/app/settings'],
  ['/staff',              '/app'],
];

export default function Legacy() {
  const { ready, token, profile } = useAuth();
  const params = useLocalSearchParams();
  const segments = [].concat(params.legacy || []);
  const path = '/' + segments.join('/');

  for (const [from, to] of MOVED) {
    if (path === from) return <Redirect href={to} />;
    // A trailing-slash entry carries an id: /staff/student/12 → /app/students/12
    if (from.endsWith('/') && path.startsWith(from)) {
      return <Redirect href={to + path.slice(from.length)} />;
    }
  }

  if (!ready) return <Loading label="Starting…" />;
  return <Redirect href={token && profile ? landingHref(profile) : '/'} />;
}
