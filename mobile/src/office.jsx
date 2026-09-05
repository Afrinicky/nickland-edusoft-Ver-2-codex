// Nickland Edusoft — the pieces the office screens are built from.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Fourteen modules, one set of habits:
//
//   • A screen asks for its data once and knows three states — loading, an
//     error it can explain, and the thing itself. `useOffice` is that, so no
//     screen invents a fourth.
//   • A screen an account may not open is never drawn in the first place, and
//     a typed URL redirects to Home rather than showing "access denied" —
//     see RequireModule in src/appshell.jsx. Telling somebody a screen exists
//     and they may not have it is the thing the product is written against;
//     the server refuses regardless of what the app drew.
//   • Some work genuinely cannot be done from where you are — recording money
//     needs the school's own system when the app is talking to a projection of
//     it. That is a different answer from "you may not", and it reads
//     differently: `HostOnlyNote` says which, and why.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { useAuth } from './auth';
import { can } from './guard';
import { Card, InfoNote, Muted, Screen, ErrorNote, Skeleton } from './ui';
import { colors, spacing, type } from './theme';

/**
 * Fetch a screen's data, with the three states every screen has.
 *
 * `load` is called with the session token. `reload` re-runs it, and `refreshing`
 * drives the pull-to-refresh control so a screen does not have to keep two
 * pieces of state that mean the same thing.
 */
export function useOffice(load, deps = []) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const run = useCallback(async () => {
    setError(null);
    try {
      setData(await load(token));
    } catch (e) {
      setError(e);
      setData(undefined);          // distinguishable from "not asked yet"
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, ...deps]);

  useEffect(() => { run(); }, [run]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await run();
    setRefreshing(false);
  }, [run]);

  return { data, error, refreshing, reload: run, refresh,
           control: <RefreshControl refreshing={refreshing} onRefresh={refresh} /> };
}

/** A screen's standard body: the error, then the skeleton, then the content. */
export function OfficeScreen({ state, skeleton = 5, children, footer }) {
  return (
    <Screen refreshControl={state.control} footer={footer}>
      {state.error ? (
        state.error.hostOnly
          ? <HostOnlyNote message={state.error.message} />
          : <ErrorNote message={state.error.message} />
      ) : null}
      {state.data === null ? <Card><Skeleton rows={skeleton} height={52} /></Card> : children}
    </Screen>
  );
}

/**
 * "Not from here" — which is not the same as "not you".
 *
 * Taking money and running payroll need the school's own system when the app
 * is reading a projection rather than the school's database. Saying which, and
 * why, is the difference between a limit somebody can work with and an app
 * that looks broken.
 */
export function HostOnlyNote({ message }) {
  return (
    <InfoNote
      message={message || "The school's own system does this. Connect on the school Wi-Fi, or use the online school."}
    />
  );
}

/** A figure with its label, for the row of numbers a portal opens on. */
export function Figures({ children }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>{children}</View>;
}

/**
 * A section a screen draws only if the account may see the module behind it.
 *
 * The alternative — drawing it and filling it with zeroes — is worse than
 * hiding it, because a zero is a claim and it would be a false one.
 */
export function IfAllowed({ module, action = 'view', children }) {
  const { profile } = useAuth();
  if (!can(profile, module, action)) return null;
  return children;
}

/** Ghana's cedi, everywhere, from one place. */
export function cedis(n) {
  const v = Number(n) || 0;
  return 'GHS ' + v.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function shortDate(value) {
  if (!value) return '';
  const d = new Date(String(value).length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** A term named so two of them can be told apart.
 *
 *  Every academic year has a "First Term". A bare term name in a picker
 *  therefore appears twice, and a fee schedule saved against next year's First
 *  Term while the school is running this year's Third Term looks identical to
 *  the right one — until bill generation reports "no schedule applies" and
 *  nobody can see why. Every term shown to a user carries its academic year. */
export function termLabel(term, fallback = '') {
  if (!term) return fallback;
  const label = term.label || term.term_label || '';
  if (!label) return fallback;
  const year = term.year_label || term.academic_year_label || '';
  return year ? `${label} · ${year}` : label;
}

/** A stale figure, named as one. A number without a date is a number nobody
 *  can act on when the connection has been down since Friday. */
export function AsOf({ at }) {
  if (!at) return null;
  return <Muted style={{ marginTop: 2 }}>{`As the school last synchronised — ${shortDate(at)}`}</Muted>;
}
