// Nickland Edusoft — one module, and the sections inside it.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Every module page in the app is this component plus a function that says
// what each tab contains. The heading, the tab strip, which tab is open, what
// happens when a tab the account may not open is asked for, and how the whole
// thing reshapes on a phone are all decided once, here.
//
// ── Tabs live in the URL ────────────────────────────────────────────────────
//
// `/app/academics?tab=timetable`, exactly as the installed application does it.
// That is not a detail:
//
//   • a link pasted into a staff-room chat opens the timetable, not the
//     Academics dashboard with a note saying "now click Timetable",
//   • a refresh does not throw away where somebody was,
//   • the browser's back button steps back through tabs, which is what
//     everybody's hands already expect it to do.
//
// A tab this account may not open is not merely absent from the strip: asking
// for its URL lands on the first tab it CAN open. A URL is typed, bookmarked
// and shared, and "access denied" on a page is a page confirming that the
// thing exists.

import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { colors, type, spacing, radius } from './theme';
import { useLayout } from './responsive';
import { Embedded, EmptyState } from './ui';
import { PageHead, TabStrip } from './desk';
import { useModuleTab } from './appshell';
import { useScreenTitle } from './shell';

/**
 * @param {string}   moduleKey  a key from src/modules.js
 * @param {string}   subtitle   one line saying what the module is for
 * @param {node}     actions    page-level buttons, drawn top right
 * @param {function} children   (tab, ctx) => the body of that tab
 */
export function ModulePage({ moduleKey, subtitle, actions, children }) {
  const { mod, tabs, tab, setTab, can, profile, features } = useModuleTab(moduleKey);
  const layout = useLayout();
  useScreenTitle(mod ? mod.label : null);

  if (!mod) return null;

  const body = typeof children === 'function'
    ? children(tab, { mod, tabs, can, profile, features, setTab })
    : children;

  return (
    <View style={{ width: '100%' }}>
      {/* The phone already carries the module's name in its top bar, so
          repeating it here would be the same eleven characters twice on a
          320px screen. The desktop's top bar carries the SCHOOL's name, so
          there the heading is the only thing naming the page. */}
      {layout.isDesktop
        ? <PageHead title={mod.label} subtitle={subtitle} actions={actions} />
        : (actions ? <View style={styles.phoneActions}>{actions}</View> : null)}

      {layout.isDesktop
        ? <TabStrip tabs={tabs} value={tab} onChange={setTab} />
        : <ChipTabs tabs={tabs} value={tab} onChange={setTab} />}

      <Embedded>
        {body || <EmptyState icon="note" title="Nothing here yet"
                             message="This section has nothing to show for the current term." />}
      </Embedded>
    </View>
  );
}

/**
 * The phone's tab strip: a scrolling row of chips.
 *
 * Chips rather than the desktop's underlines because an underlined strip that
 * scrolls sideways gives no hint that it scrolls — a chip half off the edge of
 * the screen does.
 */
function ChipTabs({ tabs, value, onChange }) {
  if (!tabs || tabs.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
                style={styles.chipsWrap} contentContainerStyle={styles.chips}>
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <Pressable key={t.id} onPress={() => onChange(t.id)}
                     accessibilityRole="tab" accessibilityState={{ selected: on }}
                     style={[styles.chip, on && styles.chipOn]}>
            <Text numberOfLines={1} style={[styles.chipText, on && styles.chipTextOn]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * What a tab shows when the thing behind it is not served from here.
 *
 * Three connection modes reach this app, and they are not equally capable: a
 * school desktop over the Wi-Fi does everything, the online school does
 * everything, and the thin hosted portal holds a PROJECTION — enough to show a
 * parent a balance, not enough to run a payroll against.
 *
 * Saying so plainly beats an empty table or a spinner that never stops. It also
 * says where the thing CAN be done, because a person told "not here" and
 * nothing else has been given a dead end rather than an answer.
 */
export function NotHere({ what, where = 'from the school’s own system' }) {
  return (
    <EmptyState
      icon="alert"
      title={`${what} is not available here`}
      message={`This connection carries a summary of the school rather than the whole of it. Open ${what.toLowerCase()} ${where} — on the school Wi-Fi, or by signing in to the online school.`}
    />
  );
}

const styles = StyleSheet.create({
  phoneActions: {
    flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.md,
  },
  chipsWrap: { marginBottom: spacing.md, marginHorizontal: -spacing.lg, flexGrow: 0 },
  chips: { flexDirection: 'row', gap: 7, paddingHorizontal: spacing.lg },
  chip: {
    paddingHorizontal: 13, paddingVertical: 8, borderRadius: radius.control,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    minHeight: 36, justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...type.small, color: colors.textSoft, fontWeight: '700', fontSize: 12.5 },
  chipTextOn: { color: '#fff' },
});

export default ModulePage;
