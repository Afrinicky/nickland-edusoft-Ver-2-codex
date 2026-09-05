// Nickland Edusoft — one signed-in frame, whatever it is opened on.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// This is the single place that answers "what can this person open, and what
// should the window around it look like". Everything below it — every module
// page — is handed a list it may draw and never asks the question again.
//
// ── Two chromes, one list ───────────────────────────────────────────────────
//
//   ≥ 1180px   the installed desktop application, reproduced: coloured
//              sidebar, top bar with the school's name and the search box,
//              a status strip along the bottom. See src/desk.jsx.
//   below      the phone and tablet app, unchanged: bottom bar, drawer,
//              quick-action button. See src/shell.jsx.
//
// The MODULES are identical either way. That is the point of the change: an
// office that uses the installed app on a PC and the browser on a laptop and
// the app on a phone is using one system with one menu, not three products
// that happen to share a database.
//
// ── Where the portals went ──────────────────────────────────────────────────
//
// They are still there — the server computes them, and they still decide what
// an account may reach. What is gone is the CHIP STRIP that used to sit at the
// top of the sidebar offering "Teaching · Finance · Administration". It was the
// one place in the product that told somebody what kind of person the system
// had filed them as, and it made a head teacher choose a costume before they
// could do their job. Now the system works it out and draws the menu.

import React, { useCallback, useMemo } from 'react';
import { Redirect, usePathname, useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from './auth';
import { useBranding, useSkin } from './brand';
import { useLayout } from './responsive';
import { Loading } from './ui';
import { AppShell } from './shell';
import { DeskShell } from './desk';
import {
  visibleModules, visibleTabs, visibleSubs, firstTab, quickActions, bottomBar,
  moduleByKey, landingHref, allows,
} from './modules';

/**
 * What this account may open, and the school it belongs to.
 *
 * One hook, so a page never assembles the answer itself. `features` come from
 * `/me`, which the server computes from the school's own switches — a school
 * that does not run a canteen has no canteen module anywhere, rather than an
 * empty one on some screens.
 */
export function useModules() {
  const { profile } = useAuth();
  const features = (profile && profile.features) || EMPTY;
  const items = useMemo(() => visibleModules(profile, features), [profile, features]);
  return { profile, features, items };
}

const EMPTY = {};

/**
 * The frame around every signed-in staff screen.
 *
 * Guards on the way in: no session goes to the splash, a parent goes to the
 * parent app. Neither is an error page — an "access denied" screen tells
 * somebody that what they reached exists and invites them to keep trying.
 */
export function ModuleShell({ children }) {
  const { ready, token, profile, signOut } = useAuth();
  const brand = useBranding();
  const layout = useLayout();
  const router = useRouter();
  const pathname = usePathname() || '';
  const { items, features } = useModules();

  // The desktop layout wears the installed application's colours; the phone
  // wears the app's. A school that has set its own overrides both.
  useSkin(layout.isDesktop ? 'desk' : 'app');

  const go = useCallback((href) => router.push(href), [router]);

  if (!ready) return <Loading label="Starting…" />;
  if (!token || !profile) return <Redirect href="/" />;
  if (profile.role === 'parent') return <Redirect href="/parent" />;

  const school = brand.school?.name || profile.school?.name || 'Nickland Edusoft';
  const motto = brand.school?.motto || '';
  const person = profile.user?.full_name || 'Signed in';
  const role = profile.designation || 'Staff';
  const photo = profile.photo || profile.staff?.photo;

  // Home is the one screen the installed application draws without a sidebar,
  // and the browser draws it the same way. See DeskShell's `bare` for why.
  const atHome = pathname === '/app' || pathname === '/app/' || pathname === '/app/index';

  if (layout.isDesktop) {
    return (
      <DeskShell
        bare={atHome}
        items={items}
        school={school} motto={motto} logo={brand.logo}
        person={person} role={role} photo={photo}
        term={profile.term || brand.term}
        session={profile.session}
        onSignOut={signOut}
        onSearch={(q) => q && go(`/app/students?tab=roll&q=${encodeURIComponent(q)}`)}
        status={{
          connected: true,
          connection: connectionLabel(),
          school,
          version: `Nickland Edusoft ${profile.version || ''}`.trim(),
        }}
      >
        {children}
      </DeskShell>
    );
  }

  // ── phone and tablet ──
  // The same modules, in the app's own chrome. `primary` is worked out from
  // what this account actually does rather than fixed, so a bursar's bar has
  // Fees on it and a teacher's has Academics, and neither is shown the other.
  const nav = {
    title: 'Nickland Edusoft',
    items,
    primary: bottomBar(items, profile),
    quick: quickActions(profile, features),
    accountHref: '/app/account',
    actionIcon: 'plus',
    actionLabel: 'What do you need to do?',
    actionHint: 'The jobs of a school day, one tap from anywhere in the app.',
  };

  return <AppShell nav={nav} school={school}>{children}</AppShell>;
}

function connectionLabel() {
  if (typeof window === 'undefined' || !window.location) return 'Connected';
  return window.location.host || 'Connected';
}

/**
 * One module's page: the heading, the tabs this account may open, and the body.
 *
 * `tab` lives in the query string — `/app/academics?tab=timetable` — exactly as
 * the installed application does it, so a link copied out of one works in the
 * other, a tab survives a refresh, and the browser's back button steps through
 * tabs the way somebody expects it to.
 *
 * A tab the account may not open is not merely hidden: reaching its URL lands
 * on the first one it CAN open, because a URL can be typed, bookmarked or
 * pasted into a staff-room chat.
 */
export function useModuleTab(moduleKey) {
  const { profile, features } = useModules();
  const router = useRouter();
  const params = useLocalSearchParams();
  const mod = moduleByKey(moduleKey);
  const tabs = useMemo(() => visibleTabs(mod, profile, features), [mod, profile, features]);

  const asked = typeof params.tab === 'string' ? params.tab : null;
  const allowed = tabs.some(t => t.id === asked);
  const active = allowed ? asked : (tabs[0] ? tabs[0].id : null);

  const setTab = useCallback((id) => {
    router.replace(`${mod.href}?tab=${encodeURIComponent(id)}`);
  }, [router, mod]);

  return { mod, tabs, tab: active, setTab, params, profile, features,
           can: (action = 'view') => allows(profile, mod.module, action) };
}

/**
 * The section INSIDE a tab, also in the URL.
 *
 * `/app/fees?tab=bills&sub=schoolfees`. Same reasons as the tab itself: a link
 * pasted into a staff-room chat opens the school fees, a refresh does not
 * throw away where somebody was, and the back button steps back through the
 * sections the way everybody's hands expect.
 *
 * A section this account may not open is not merely absent from the strip —
 * asking for its URL lands on the first one it can open.
 */
export function useSubTab(moduleKey, tabId, fallback) {
  const { profile, features } = useModules();
  const router = useRouter();
  const params = useLocalSearchParams();
  const mod = moduleByKey(moduleKey);

  // The sections come from src/modules.js, where the rest of the app's shape
  // lives — including which of them this account may open. A screen that kept
  // its own list would be a second place the access rules had to be right.
  const list = useMemo(
    () => visibleSubs(mod, tabId, profile, features),
    [mod, tabId, profile, features]);
  const asked = typeof params.sub === 'string' ? params.sub : null;
  const allowed = list.some(s => s.id === asked);
  const preferred = fallback && list.some(s => s.id === fallback) ? fallback : null;
  const active = allowed ? asked : (preferred || (list[0] ? list[0].id : null));

  const setSub = useCallback((id) => {
    router.replace(`${mod.href}?tab=${encodeURIComponent(tabId)}&sub=${encodeURIComponent(id)}`);
  }, [router, mod, tabId]);

  return { subs: list, sub: active, setSub };
}

/**
 * Refuse a module outright.
 *
 * The server refuses it too — this is the courtesy half, so somebody who
 * follows a stale bookmark lands where they belong instead of on a page that
 * confirms the existence of something they were told they may not have.
 */
export function RequireModule({ moduleKey, action = 'view', children }) {
  const { ready, token, profile } = useAuth();
  const { features } = useModules();
  const mod = moduleByKey(moduleKey);

  if (!ready) return <Loading label="Starting…" />;
  if (!token || !profile) return <Redirect href="/" />;
  if (profile.role === 'parent') return <Redirect href="/parent" />;
  if (!mod) return <Redirect href="/app" />;
  if (!mod.always && !allows(profile, mod.module, action)) return <Redirect href={landingHref(profile)} />;
  return children;
}

export default ModuleShell;
