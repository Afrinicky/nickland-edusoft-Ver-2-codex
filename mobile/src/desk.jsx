// Nickland Edusoft — the desktop application, in a browser.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A teacher's phone and an office PC are not the same machine and should not
// be given the same screen. The phone chrome in src/shell.jsx is built for one
// hand, in sunlight, between lessons: a bottom bar, big targets, a card per
// idea. It is right there and wrong on a 24-inch monitor, where the same design
// becomes a column of enormous cards with a metre of white either side.
//
// What belongs on that monitor is the application the school already knows —
// the installed desktop, which every one of these offices has been running for
// two years. So at desktop width the browser draws THAT: the coloured sidebar
// with the school's crest at the top and the clock at the bottom, the white top
// bar with the school's name and the search box, the tab strip under a page
// heading, and the thin status strip along the bottom saying which database is
// open and when it was last backed up.
//
// This file is that chrome. It is a deliberate, close reproduction of
// src/renderer/src/styles/index.css — the same 220px sidebar, the same 60px top
// bar, the same 30px status strip, the same gold rule down the left of the item
// you are on. Somebody who uses the installed app in the morning and the
// browser in the afternoon should not have to be told they are the same system.
//
// ── What it is NOT ─────────────────────────────────────────────────────────
//
// It is not a second design system. Every colour comes from the same tokens
// (src/theme.js) as the phone, so a school that sets its colours sets them
// once; every control comes from the same kit (src/ui.jsx). What differs is
// density and shape, which is what actually differs between a phone and a desk.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, TextInput, Platform,
} from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { colors, type, spacing, radius, shadow, motion } from './theme';
import { useLayout } from './responsive';
import { Icon } from './icons';
import { Avatar, Crest, IconButton, Sheet, Muted } from './ui';
import { Press, Appear } from './motion';
import { activeModule, groupModules } from './modules';

// The installed app's measurements, to the pixel where it matters.
export const DESK = {
  sidebar: 236,
  sidebarWide: 268,
  topbar: 62,
  statusbar: 30,
  gutter: 24,
};

// ── the shell ───────────────────────────────────────────────────────────────

/**
 * The whole window: sidebar, top bar, page, status strip.
 *
 * `items` is what this account may open — already filtered, because a shell
 * that filters is a shell that has to know about permissions, and it does not.
 */
export function DeskShell({
  items, school, motto, logo, person, role, photo, term, pending = 0,
  status, onSignOut, onSearch, children,
}) {
  const layout = useLayout();
  const pathname = usePathname() || '';
  const router = useRouter();
  const active = activeModule(items, pathname);
  const width = layout.width >= 1600 ? DESK.sidebarWide : DESK.sidebar;

  return (
    <View style={styles.shell}>
      <DeskSidebar
        items={items} active={active} width={width}
        school={school} logo={logo}
        person={person} role={role} photo={photo}
        onGo={(href) => router.push(href)} onSignOut={onSignOut}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <DeskTopBar
          school={school} motto={motto} logo={logo} term={term}
          pending={pending} onSearch={onSearch}
          onGo={(href) => router.push(href)} items={items}
        />
        <ScrollView
          style={styles.content}
          contentContainerStyle={{ padding: DESK.gutter, paddingBottom: DESK.gutter * 2 }}
          showsVerticalScrollIndicator
        >
          <View style={{ width: '100%', maxWidth: 1480, marginHorizontal: 'auto' }}>
            {children}
          </View>
        </ScrollView>
        <DeskStatusBar status={status} person={person} />
      </View>
    </View>
  );
}

// ── the sidebar ─────────────────────────────────────────────────────────────
//
// The school's colour, full height, crest at the top and the clock at the
// bottom — which is not decoration. A register is taken at a time, a payment is
// receipted at a time, and the clock on the wall of a Ghanaian school office is
// not always the one everybody agrees on. The system's own time, where it can
// be seen, settles arguments.

function DeskSidebar({ items, active, width, school, logo, person, role, photo, onGo, onSignOut }) {
  const clock = useClock();
  return (
    <View style={[styles.side, { width }]}>
      <View style={styles.sideBrand}>
        <Crest logo={logo} size={44} tone="chrome" />
        <Text numberOfLines={3} style={styles.sideSchool}>{school}</Text>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingVertical: 10, paddingHorizontal: 10 }}>
        {items.map((item) => (
          <SideItem key={item.key} item={item} on={active && active.key === item.key}
                    onPress={() => onGo(item.href)} />
        ))}
      </ScrollView>

      <View style={styles.sideUser}>
        <Avatar name={person} photo={photo} size={36} tone="chrome" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={styles.sideUserName}>{person}</Text>
          <Text numberOfLines={1} style={styles.sideUserRole}>{role}</Text>
        </View>
        <IconButton name="logout" size={32} tone="plain" color="rgba(255,255,255,0.55)"
                    onPress={onSignOut} label="Sign out" />
      </View>

      <View style={styles.sideClock}>
        <Text style={styles.sideTime}>{clock.time}</Text>
        <Text style={styles.sideDate}>{clock.date}</Text>
      </View>
    </View>
  );
}

function SideItem({ item, on, onPress }) {
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
      accessibilityRole="link" accessibilityState={{ selected: !!on }}
      style={[styles.sideItem, (hover || on) && styles.sideItemLit, on && styles.sideItemOn]}
    >
      <View style={styles.sideIcon}>
        <Icon name={item.icon} size={19} color={on ? '#fff' : 'rgba(255,255,255,0.72)'} />
      </View>
      {/* Two lines rather than an ellipsis: "Purchasing & Inven…" in a
          navigation list is a module nobody can name out loud. */}
      <Text numberOfLines={2} style={[styles.sideLabel, on && styles.sideLabelOn]}>
        {item.label}
      </Text>
    </Pressable>
  );
}

// ── the top bar ─────────────────────────────────────────────────────────────

function DeskTopBar({ school, motto, logo, term, pending, onSearch, onGo, items }) {
  const has = (k) => items.some(i => i.key === k);
  return (
    <View style={styles.top}>
      <View style={styles.topBrand}>
        <Crest logo={logo} size={38} tone="light" rounded />
        <View style={{ minWidth: 0 }}>
          <Text numberOfLines={1} style={styles.topSchool}>{school}</Text>
          {motto ? <Text numberOfLines={1} style={styles.topMotto}>{motto}</Text> : null}
        </View>
      </View>

      <SearchBox onSubmit={onSearch} />

      <View style={{ flex: 1 }} />

      {has('notifications') ? (
        <IconButton name="bell" size={38} tone="subtle" label="Notices"
                    badge={pending > 0 ? pending : null}
                    onPress={() => onGo('/app/notifications')} />
      ) : null}
      {has('messages') ? (
        <IconButton name="chat" size={38} tone="subtle" label="Messages"
                    onPress={() => onGo('/app/messages')} />
      ) : null}

      {term ? (
        <View style={styles.termPill}>
          <Text style={styles.termYear}>{term.year_label || term.year || ''}</Text>
          <Text style={styles.termLabel}>{term.label || ''}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The search box, with the keyboard shortcut printed on it.
 *
 * Ctrl+K is bound for real rather than drawn as decoration — a shortcut a
 * screenshot promises and the app does not honour is worse than none.
 */
function SearchBox({ onSubmit }) {
  const ref = useRef(null);
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
        e.preventDefault();
        if (ref.current && ref.current.focus) ref.current.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <View style={[styles.search, focus && styles.searchOn]}>
      <Icon name="search" size={16} color={colors.muted} />
      <TextInput
        ref={ref}
        value={q} onChangeText={setQ}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        onSubmitEditing={() => onSubmit && onSubmit(q)}
        placeholder="Search students, staff, receipts…"
        placeholderTextColor={colors.faint}
        accessibilityLabel="Search"
        style={styles.searchInput}
        returnKeyType="search"
      />
      <Text style={styles.searchKey}>Ctrl + K</Text>
    </View>
  );
}

// ── the status strip ────────────────────────────────────────────────────────
//
// The installed app's bottom line: which database is open, when it was last
// backed up, who is signed in, which version. In the browser two of those
// change meaning — the "database" is the school's server and the backup is its
// business, not this machine's — so it says what is actually true here rather
// than copying words that would be a lie.

function DeskStatusBar({ status, person }) {
  const bits = status || {};
  return (
    <View style={styles.status}>
      <StatusItem dot={bits.connected === false ? 'off' : 'on'}
                  label={bits.connection || 'Connected'} />
      {bits.school ? <StatusItem label={bits.school} /> : null}
      <StatusItem icon="user" label={`Signed in: ${person}`} />
      <View style={{ flex: 1 }} />
      <Text style={styles.statusText}>{bits.version || 'Nickland Edusoft'}</Text>
    </View>
  );
}

function StatusItem({ dot, icon, label }) {
  return (
    <View style={styles.statusItem}>
      {dot ? <View style={[styles.dot, dot === 'off' && styles.dotOff]} /> : null}
      {icon ? <Icon name={icon} size={12} color="rgba(255,255,255,0.55)" /> : null}
      <Text numberOfLines={1} style={styles.statusText}>{label}</Text>
    </View>
  );
}

// ── the pieces a module page is built from ──────────────────────────────────

/**
 * A page heading: what this module is, and one line saying what it is for.
 *
 * The desktop puts the actions for the whole page up here on the right, which
 * is where somebody who has come to DO something looks first.
 */
export function PageHead({ title, subtitle, actions, children }) {
  const layout = useLayout();
  return (
    <View style={[styles.head, !layout.isDesktop && { flexDirection: 'column', alignItems: 'stretch', gap: spacing.md }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.headTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headSub}>{subtitle}</Text> : null}
        {children}
      </View>
      {actions ? <View style={styles.headActions}>{actions}</View> : null}
    </View>
  );
}

/**
 * The tab strip under a page heading.
 *
 * Underlined rather than pilled, and scrollable, because Academics has ten of
 * them and a wrapped double row of pills makes a page look like a form nobody
 * finished. The one you are on is marked with the primary colour and a rule
 * beneath it — the same mark the installed app uses.
 */
export function TabStrip({ tabs, value, onChange }) {
  if (!tabs || tabs.length < 2) return null;
  return (
    <View style={styles.tabsWrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.tabs}>
        {tabs.map((t) => {
          const on = t.id === value;
          return (
            <Pressable key={t.id} onPress={() => onChange(t.id)}
                       accessibilityRole="tab" accessibilityState={{ selected: on }}
                       style={[styles.tab, on && styles.tabOn]}>
              <Text numberOfLines={1} style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * A row of controls above a table: filters on the left, actions on the right.
 * Wraps on a narrow window rather than scrolling sideways, because a filter you
 * cannot see is a filter that is silently applied.
 */
export function Bar({ left, right, style }) {
  return (
    <View style={[styles.bar, style]}>
      <View style={styles.barSide}>{left}</View>
      <View style={[styles.barSide, { justifyContent: 'flex-end' }]}>{right}</View>
    </View>
  );
}

/** A white panel with a hairline border — what a section of a page sits in. */
export function Panel({ title, subtitle, right, children, padded = true, style }) {
  return (
    <View style={[styles.panel, style]}>
      {(title || right) ? (
        <View style={styles.panelHead}>
          <View style={{ flex: 1, minWidth: 0 }}>
            {title ? <Text style={styles.panelTitle}>{title}</Text> : null}
            {subtitle ? <Text style={styles.panelSub}>{subtitle}</Text> : null}
          </View>
          {right}
        </View>
      ) : null}
      <View style={padded ? { padding: spacing.lg } : null}>{children}</View>
    </View>
  );
}

/**
 * The metric row across the top of a dashboard.
 *
 * A tinted disc, a label, the figure, and one line of context under it. The
 * context line is the part that matters: "GHS 0.00" means nothing and
 * "GHS 0.00 — 0 students" means the school has no arrears, which is a different
 * statement and the one a head teacher is actually reading for.
 */
export function StatRow({ children }) {
  return <View style={styles.statRow}>{children}</View>;
}

const STAT_TONES = {
  primary: { fill: colors.primarySoft, ink: colors.primary },
  success: { fill: '#E9F7EF', ink: colors.success },
  danger:  { fill: '#FDECEC', ink: colors.danger },
  warning: { fill: '#FDF4E3', ink: colors.warning },
  accent:  { fill: colors.accentSoft, ink: colors.accent },
  data:    { fill: '#E4F4F4', ink: colors.data },
};

export function Stat({ label, value, note, icon, tone = 'primary', onPress, action, index = 0 }) {
  const t = STAT_TONES[tone] || STAT_TONES.primary;
  return (
    <Appear delay={Math.min(index, 6) * motion.stagger} distance={10}>
      <Press onPress={onPress} disabled={!onPress}>
        <View style={styles.stat}>
          <View style={styles.statTop}>
            {icon ? (
              <View style={[styles.statIcon, { backgroundColor: t.fill }]}>
                <Icon name={icon} size={19} color={t.ink} />
              </View>
            ) : null}
            <Text numberOfLines={2} style={styles.statLabel}>{label}</Text>
          </View>
          <Text numberOfLines={1} style={[styles.statValue, { color: t.ink }]}>{value}</Text>
          {note ? <Text numberOfLines={1} style={styles.statNote}>{note}</Text> : null}
          {action ? <Text numberOfLines={1} style={styles.statAction}>{action} →</Text> : null}
        </View>
      </Press>
    </Appear>
  );
}

// ── the clock ───────────────────────────────────────────────────────────────
// Ticks on the minute rather than the second: a second hand in the corner of a
// records system is a thing that redraws 86,400 times a day to tell nobody
// anything.
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const toMinute = 60000 - (Date.now() % 60000);
    let interval = null;
    const timeout = setTimeout(() => { tick(); interval = setInterval(tick, 60000); }, toMinute);
    return () => { clearTimeout(timeout); if (interval) clearInterval(interval); };
  }, []);
  return useMemo(() => ({
    time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    date: now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  }), [now]);
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },

  // ── sidebar ──
  side: { backgroundColor: colors.primary, flexShrink: 0 },
  sideBrand: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 18, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.10)',
  },
  sideSchool: {
    ...type.micro, color: '#fff', flex: 1, fontSize: 11.5, lineHeight: 15,
    fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase',
  },
  sideItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, paddingHorizontal: 12, borderRadius: radius.control,
    marginBottom: 2, minHeight: 40,
    // The gold rule on the active item is a LEFT BORDER on the desktop, which
    // shifts the label 3px when it appears. Reserved on every row instead, so
    // the list does not twitch as you move down it.
    borderLeftWidth: 3, borderLeftColor: 'transparent',
  },
  sideItemLit: { backgroundColor: 'rgba(255,255,255,0.10)' },
  sideItemOn: { backgroundColor: 'rgba(255,255,255,0.16)', borderLeftColor: colors.accent },
  sideIcon: { width: 22, alignItems: 'center' },
  sideLabel: { ...type.small, color: 'rgba(255,255,255,0.72)', fontSize: 13, fontWeight: '600', flex: 1, lineHeight: 17 },
  sideLabelOn: { color: '#fff', fontWeight: '700' },

  sideUser: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.10)',
  },
  sideUserName: { ...type.small, color: '#fff', fontSize: 12.5, fontWeight: '700' },
  sideUserRole: { ...type.small, color: 'rgba(255,255,255,0.55)', fontSize: 11 },
  sideClock: { paddingHorizontal: 16, paddingBottom: 14 },
  sideTime: { ...type.title, color: '#fff', fontSize: 18, letterSpacing: -0.2 },
  sideDate: { ...type.small, color: 'rgba(255,255,255,0.5)', fontSize: 10.5, marginTop: 1 },

  // ── top bar ──
  top: {
    height: DESK.topbar, flexDirection: 'row', alignItems: 'center', gap: 16,
    paddingLeft: 24, paddingRight: 20,
    backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  topBrand: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 0, maxWidth: 340 },
  topSchool: { ...type.heading, color: colors.primary, fontSize: 16 },
  topMotto: { ...type.small, color: colors.accent, fontSize: 11, fontWeight: '600' },

  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    flex: 1, maxWidth: 420, minWidth: 180, height: 38, paddingHorizontal: 12,
    backgroundColor: colors.surfaceAlt, borderRadius: radius.control,
    borderWidth: 1, borderColor: colors.border,
  },
  searchOn: { borderColor: colors.primary, backgroundColor: colors.card },
  searchInput: {
    flex: 1, minWidth: 0, ...type.small, color: colors.text,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  searchKey: { ...type.micro, color: colors.faint, fontSize: 10.5, letterSpacing: 0.2 },

  termPill: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.control,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt,
    alignItems: 'center', flexShrink: 0,
  },
  termYear: { ...type.small, color: colors.text, fontWeight: '800', fontSize: 13 },
  termLabel: { ...type.micro, color: colors.muted, fontSize: 10, textTransform: 'none' },

  // ── content ──
  content: { flex: 1, backgroundColor: colors.bg },

  // ── status strip ──
  status: {
    height: DESK.statusbar, flexDirection: 'row', alignItems: 'center', gap: 20,
    paddingHorizontal: 20, backgroundColor: colors.chrome,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
  },
  statusItem: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
  statusText: { ...type.small, color: 'rgba(255,255,255,0.58)', fontSize: 11 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#22C55E' },
  dotOff: { backgroundColor: '#EF4444' },

  // ── page furniture ──
  head: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  headTitle: { ...type.display, color: colors.text, fontSize: 26, letterSpacing: -0.6 },
  headSub: { ...type.body, color: colors.muted, marginTop: 3 },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },

  tabsWrap: { borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: spacing.lg },
  tabs: { flexDirection: 'row', gap: 2, paddingRight: spacing.lg },
  tab: {
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabOn: { borderBottomColor: colors.primary },
  tabText: { ...type.small, color: colors.muted, fontWeight: '600', fontSize: 13.5 },
  tabTextOn: { color: colors.primary, fontWeight: '800' },

  bar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    flexWrap: 'wrap', marginBottom: spacing.md,
  },
  barSide: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', flex: 1, minWidth: 0 },

  panel: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg,
    overflow: 'hidden', ...shadow.rest,
  },
  panelHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  panelTitle: { ...type.heading, color: colors.text },
  panelSub: { ...type.small, color: colors.muted, marginTop: 1 },

  statRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.lg,
  },
  stat: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, minWidth: 210, flexGrow: 1, flexBasis: 210,
    ...shadow.rest,
  },
  statTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  statIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  statLabel: { ...type.small, color: colors.muted, fontWeight: '600', flex: 1 },
  statValue: { ...type.numeric, fontSize: 25 },
  statNote: { ...type.small, color: colors.muted, marginTop: 3, fontSize: 12 },
  statAction: { ...type.small, color: colors.primary, fontWeight: '700', marginTop: 8, fontSize: 12.5 },
});

export default DeskShell;
