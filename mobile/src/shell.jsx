// Nickland Edusoft — the frame every signed-in screen sits in.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// One shell, three shapes, decided by the width of the window rather than by
// the platform: a labelled sidebar on a desktop browser, a rail of icons on a
// tablet, and on a phone a bottom bar of four plus a drawer holding everything
// else.
//
// ── Why the chrome is light ─────────────────────────────────────────────────
//
// One screen in this app is dark, and it is the splash. Everything else — the
// top bar, the drawer, the sidebar, the bottom bar — is a white surface with
// hairline borders, and colour appears only where it means something: the
// violet pill on the item you are on, the violet card carrying the one figure
// a screen is about, the violet header over a person's own profile.
//
// That is not a preference. The phone is used outdoors in Ghanaian daylight,
// where a dark panel is a mirror, and a dark rail down the side of a light
// screen is a slab of ink with nothing on it.
//
// ── Why the phone has both a bar and a drawer ───────────────────────────────
//
// A bottom bar can hold four or five destinations before the labels stop being
// words. This app has fifteen. The first version put the other ten behind a
// "More" sheet, which meant the register was one tap away and the broadsheet
// was two-plus-a-scroll — an arbitrary hierarchy nobody chose.
//
// So: the bar carries what a teacher opens between lessons, and the drawer
// carries the whole app, grouped, with the school's crest at the top of it and
// sign-out at the bottom. It is the same list the desktop sidebar shows, in the
// same order, so somebody who learns one has learned the other.
//
// The button in the middle of the bar is not a destination. It is the thing
// you came to do: take the register, enter marks, collect the canteen money.
// A teacher standing at a door has one hand free and that button is under the
// thumb of it.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform, Animated, Pressable, BackHandler,
} from 'react-native';
import { Slot, usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, palette, gradients, type, spacing, radius, shadow, motion, z } from './theme';
import { useLayout } from './responsive';
import { Icon } from './icons';
import { Avatar, Badge, Crest, Gradient, IconButton, Sheet, Heading, Muted, Micro } from './ui';
import { Appear, Press, ScreenTransition, useReducedMotion, EASE_OUT } from './motion';
import { groupModules } from './modules';
import { useAuth } from './auth';
import { useBranding } from './brand';
import { ContactSheet } from './actions';
import { channels as channelsFor, generalMessage } from './contact';

// A detail screen — a pupil's record, one conversation — has no navigation
// entry of its own, so the shell would otherwise head it "Parent" or "Staff".
// This lets the screen name itself without the layout having to know about
// every route beneath it.
const TitleCtx = createContext(() => {});

export function useScreenTitle(title) {
  const set = useContext(TitleCtx);
  useEffect(() => {
    set(title || null);
    return () => set(null);
  }, [set, title]);
}

// The active item is the longest href that prefixes the current path, so
// /staff/student/12 lights up "Pupils" rather than nothing, and /staff itself
// does not light up every route beginning with it.
function activeKey(items, pathname) {
  let best = null; let bestLen = -1;
  for (const i of items) {
    const prefixes = [...(i.match || []), ...(i.href.split('/').length > 2 ? [i.href] : [])];
    const hit = pathname === i.href || prefixes.some(pre => pathname === pre || pathname.startsWith(pre + '/'));
    if (!hit) continue;
    const len = Math.max(i.href.length, ...prefixes.map(x => x.length));
    if (len > bestLen) { best = i; bestLen = len; }
  }
  return best ? best.key : null;
}

export function AppShell({ nav, title, school, pending = 0, children }) {
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const brand = useBranding();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [screenTitle, setScreenTitle] = useState(null);

  // Already filtered by the layout against this account's permissions. A shell
  // that filters is a shell that has to know about access, and the moment two
  // places know, they disagree.
  const items = nav.items;
  const active = activeKey(items, pathname || '');
  const current = items.find(i => i.key === active);
  const go = useCallback((href) => {
    setDrawerOpen(false); setQuickOpen(false);
    router.push(href);
  }, [router]);

  const schoolName = brand.school?.name || school || 'Nickland Edusoft';
  const person = profile?.user?.full_name || profile?.parent?.full_name || 'Signed in';
  const role = profile?.designation || (profile?.role === 'parent' ? 'Parent' : 'Staff');
  const photo = profile?.photo || profile?.staff?.photo;
  const contactChannels = channelsFor(brand.contact || {});
  const actions = nav.quick || [];

  // The Android back button closes what is open before it leaves the screen.
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (drawerOpen) { setDrawerOpen(false); return true; }
      if (quickOpen) { setQuickOpen(false); return true; }
      return false;
    });
    return () => sub.remove();
  }, [drawerOpen, quickOpen]);

  const chat = contactChannels.length ? (
    <ContactSheet
      visible={chatOpen} onClose={() => setChatOpen(false)}
      channels={contactChannels} school={brand.school}
      message={generalMessage({ school: schoolName, from: person, role })}
      subject={`${person} — ${role}`}
    />
  ) : null;

  const body = (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopBar
        title={screenTitle || title || current?.label || nav.title}
        subtitle={schoolName}
        logo={brand.logo}
        pending={pending}
        person={person}
        photo={photo}
        onMenu={layout.nav === 'bottom' ? () => setDrawerOpen(true) : null}
        onChat={contactChannels.length ? () => setChatOpen(true) : null}
        onAccount={() => go(nav.accountHref)}
      />
      <ScreenTransition id={pathname} style={{ flex: 1 }}>
        {children || <Slot />}
      </ScreenTransition>
    </View>
  );

  const withTitle = (node) => <TitleCtx.Provider value={setScreenTitle}>{node}</TitleCtx.Provider>;

  const drawer = (
    <NavDrawer
      open={drawerOpen} onClose={() => setDrawerOpen(false)}
      items={items} active={active} onGo={go}
      school={schoolName} motto={brand.school?.motto} logo={brand.logo}
      person={person} role={role} photo={photo}
      onSignOut={signOut}
      onChat={contactChannels.length ? () => { setDrawerOpen(false); setChatOpen(true); } : null}
      areaLabel={nav.title}
    />
  );

  // ── phone ──
  if (layout.nav === 'bottom') {
    const bar = nav.primary
      .map(k => (k === 'action' ? { key: 'action' } : items.find(i => i.key === k)))
      .filter(Boolean);

    return withTitle(
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {body}
        <BottomBar
          items={bar} active={active} onGo={go} insets={insets}
          onAction={actions.length ? () => setQuickOpen(true) : null}
          actionIcon={nav.actionIcon || 'plus'}
          actionLabel={nav.actionLabel || 'Quick action'}
        />
        {drawer}
        {chat}

        <Sheet visible={quickOpen} onClose={() => setQuickOpen(false)} title={nav.actionLabel || 'Quick action'}>
          <Muted style={{ marginBottom: spacing.sm }}>{nav.actionHint}</Muted>
          {actions.map((a, i) => (
            <Appear key={a.key} delay={i * motion.stagger} distance={8}>
              <Press onPress={() => go(a.href)} accessibilityRole="button">
                <View style={styles.quickRow}>
                  <View style={styles.quickIcon}><Icon name={a.icon} size={20} color={colors.primary} /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ ...type.body, fontWeight: '700', color: colors.text }}>{a.label}</Text>
                    {a.hint ? <Muted numberOfLines={1}>{a.hint}</Muted> : null}
                  </View>
                  <Icon name="chevron" size={15} color={colors.faint} />
                </View>
              </Press>
            </Appear>
          ))}
        </Sheet>
      </View>
    );
  }

  // ── tablet rail and desktop sidebar: the same component at two widths ──
  const labelled = layout.nav === 'sidebar';
  return withTitle(
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.bg }}>
      <View style={[styles.side, { width: layout.sidebarWidth, paddingTop: insets.top + 14 }]}>
        <View style={[styles.brand, !labelled && { justifyContent: 'center' }]}>
          <Crest logo={brand.logo} size={38} tone="light" />
          {labelled && (
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ ...type.small, color: colors.text, fontWeight: '800', fontSize: 14.5, letterSpacing: -0.2 }}>
                {schoolName}
              </Text>
              <Text style={{ ...type.small, color: colors.muted, fontSize: 11.5, fontWeight: '600' }}>{nav.title}</Text>
            </View>
          )}
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }} style={{ flex: 1 }}>
          {groupModules(items).map(g => (
            <View key={g.group} style={{ marginTop: spacing.md }}>
              {labelled && <Text style={styles.sideGroup}>{g.group}</Text>}
              {g.items.map(i => (
                <SideItem key={i.key} item={i} on={i.key === active} labelled={labelled} onPress={() => go(i.href)} />
              ))}
            </View>
          ))}
        </ScrollView>

        <View style={[styles.sideUser, !labelled && { justifyContent: 'center' }]}>
          <Avatar name={person} photo={photo} size={36} />
          {labelled && (
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ ...type.small, color: colors.text, fontWeight: '700' }}>{person}</Text>
              <Text numberOfLines={1} style={{ ...type.small, color: colors.muted, fontSize: 11.5, fontWeight: '600' }}>{role}</Text>
            </View>
          )}
          {labelled && <IconButton name="logout" size={34} tone="plain" color={colors.danger} onPress={signOut} label="Sign out" />}
        </View>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>{body}</View>
      {chat}
    </View>
  );
}

// ── one navigation entry in the sidebar ─────────────────────────────────────
function SideItem({ item, on, labelled, onPress }) {
  return (
    <Press onPress={onPress} accessibilityRole="link" accessibilityState={{ selected: on }}>
      <View style={[styles.sideItem, !labelled && styles.railItem, on && styles.sideItemOn]}>
        <Icon name={item.icon} size={19} color={on ? colors.primary : colors.muted} />
        {labelled && (
          <Text numberOfLines={1} style={{
            ...type.small, fontSize: 14,
            color: on ? colors.primary : colors.textSoft, fontWeight: on ? '700' : '600',
          }}>
            {item.label}
          </Text>
        )}
      </View>
    </Press>
  );
}

// ── the phone's drawer ──────────────────────────────────────────────────────
// Slides from the left over a scrim, which is the gesture every Android user
// already has. It is the whole app, grouped exactly as the desktop groups it.
function NavDrawer({
  open, onClose, items, active, onGo, school, motto, logo,
  person, role, photo, onSignOut, onChat, areaLabel,
}) {
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
    const a = Animated.timing(t, {
      toValue: open ? 1 : 0,
      duration: reduced ? 0 : (open ? motion.medium : motion.base),
      easing: EASE_OUT,
      useNativeDriver: Platform.OS !== 'web',
    });
    a.start(({ finished }) => { if (finished && !open) setMounted(false); });
    return () => a.stop();
  }, [open, t, reduced]);

  if (!mounted) return null;

  const width = Math.min(316, Math.max(268, layout.width * 0.84));

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: z.drawer }]} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(20,20,43,0.38)', opacity: t }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close the menu" />
      </Animated.View>

      <Animated.View style={[
        styles.drawer, shadow.floating,
        {
          width, paddingTop: insets.top + 16, paddingBottom: Math.max(insets.bottom, 14),
          transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }) }],
        },
      ]}>
        <View style={styles.drawerBrand}>
          <Crest logo={logo} size={44} tone="light" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={2} style={{ ...type.body, color: colors.text, fontWeight: '800', fontSize: 15.5, letterSpacing: -0.2 }}>
              {school}
            </Text>
            <Text numberOfLines={1} style={{ ...type.small, color: colors.muted, fontSize: 11.5, fontWeight: '600', marginTop: 1 }}>
              {motto || areaLabel}
            </Text>
          </View>
          <IconButton name="close" size={34} tone="plain" color={colors.muted} onPress={onClose} label="Close the menu" />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.md }}>
          {groupModules(items).map(g => (
            <View key={g.group} style={{ marginTop: spacing.md }}>
              <Text style={styles.sideGroup}>{g.group}</Text>
              {g.items.map(i => (
                <SideItem key={i.key} item={i} on={i.key === active} labelled onPress={() => onGo(i.href)} />
              ))}
            </View>
          ))}
        </ScrollView>

        <View style={styles.drawerFoot}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar name={person} photo={photo} size={38} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ ...type.small, color: colors.text, fontWeight: '700' }}>{person}</Text>
              <Text numberOfLines={1} style={{ ...type.small, color: colors.muted, fontSize: 11.5, fontWeight: '600' }}>{role}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: spacing.md }}>
            {onChat ? (
              <Press onPress={onChat} style={{ flex: 1 }} accessibilityRole="button">
                <View style={styles.drawerBtn}>
                  <Icon name="whatsapp" size={17} color={colors.primary} />
                  <Text style={{ ...type.small, color: colors.primary, fontWeight: '700' }}>Message school</Text>
                </View>
              </Press>
            ) : null}
            <Press onPress={onSignOut} accessibilityRole="button" accessibilityLabel="Sign out">
              <View style={[styles.drawerBtn, { backgroundColor: palette.red100, paddingHorizontal: 15 }]}>
                <Icon name="logout" size={17} color={colors.danger} />
              </View>
            </Press>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

// ── the phone's bottom bar ──────────────────────────────────────────────────
function BottomBar({ items, active, onGo, insets, onAction, actionIcon, actionLabel }) {
  return (
    <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {items.map(i => {
        if (i.key === 'action') {
          return (
            <View key="action" style={styles.bottomAction}>
              <Press onPress={onAction} accessibilityRole="button" accessibilityLabel={actionLabel}>
                <View style={[styles.actionBtn, shadow.raised]}>
                  <Icon name={actionIcon} size={24} color="#fff" />
                </View>
              </Press>
            </View>
          );
        }
        const on = i.key === active;
        return (
          <Pressable
            key={i.key} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={styles.bottomItem} onPress={() => onGo(i.href)}
          >
            <View style={[styles.bottomIcon, on && { backgroundColor: colors.primarySoft }]}>
              <Icon name={i.icon} size={20} color={on ? colors.primary : colors.muted} />
            </View>
            <Text numberOfLines={1} style={{
              ...type.small, fontSize: 10.5, fontWeight: '700',
              color: on ? colors.primary : colors.muted,
            }}>
              {i.short || i.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── the top bar ─────────────────────────────────────────────────────────────
function TopBar({ title, subtitle, logo, pending, person, photo, onAccount, onChat, onMenu }) {
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const phone = layout.nav === 'bottom';
  return (
    <View style={[
      styles.topBar,
      { paddingTop: (phone ? insets.top + 10 : 0) + 12, paddingHorizontal: layout.gutter },
    ]}>
      {phone ? (
        <IconButton name="menu" size={38} tone="subtle" onPress={onMenu} label="Open the menu" />
      ) : null}
      {phone ? <Crest logo={logo} size={34} tone="light" /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        {subtitle ? (
          <Text numberOfLines={1} style={{ ...type.micro, color: colors.muted }}>
            {String(subtitle).toUpperCase()}
          </Text>
        ) : null}
        <Text numberOfLines={1} style={{ ...type.title, fontSize: phone ? 19 : 21, color: colors.text }}>
          {title}
        </Text>
      </View>
      {pending > 0 ? <Badge tone="data" icon="refresh" label={`${pending} waiting`} /> : null}
      {onChat ? (
        <IconButton name="whatsapp" size={38} tone="subtle" onPress={onChat} label="Message the school" />
      ) : null}
      {!phone ? (
        <TouchableOpacity onPress={onAccount} activeOpacity={0.8} style={{ marginLeft: spacing.xs }} accessibilityRole="button" accessibilityLabel="Your account">
          <Avatar name={person} photo={photo} size={38} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: 14,
    backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border,
  },

  side: {
    paddingHorizontal: 12, paddingBottom: 12,
    backgroundColor: colors.card, borderRightWidth: 1, borderRightColor: colors.border,
  },
  brand: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 6, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  sideGroup: {
    ...type.micro, color: colors.muted, fontSize: 10.5,
    paddingHorizontal: 12, marginBottom: 6, textTransform: 'uppercase',
  },
  sideItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 11, paddingHorizontal: 12, borderRadius: radius.sm, marginBottom: 2, minHeight: 44,
  },
  railItem: { justifyContent: 'center', paddingHorizontal: 0 },
  // The item you are on is a violet pill — the same mark the bottom bar and the
  // tab strip use, so "you are here" looks the same everywhere in the app.
  sideItemOn: { backgroundColor: colors.primarySoft },
  sideUser: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingTop: 12, paddingHorizontal: 6,
    borderTopWidth: 1, borderTopColor: colors.border,
  },

  drawer: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    backgroundColor: colors.card, paddingHorizontal: 12,
    borderTopRightRadius: radius.xl, borderBottomRightRadius: radius.xl,
    borderRightWidth: 1, borderRightColor: colors.border,
  },
  drawerBrand: {
    flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 4, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  drawerFoot: {
    paddingTop: 14, paddingHorizontal: 4,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  drawerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: colors.primarySoft, borderRadius: radius.sm,
    paddingVertical: 11, paddingHorizontal: 12, minHeight: 44,
  },

  bottomBar: {
    flexDirection: 'row', alignItems: 'flex-end', backgroundColor: colors.card,
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 7,
    ...(Platform.OS === 'web' ? {} : shadow.raised),
  },
  bottomItem: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 2, minHeight: 48 },
  bottomIcon: { width: 44, height: 27, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  bottomAction: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 4 },
  actionBtn: {
    width: 54, height: 54, borderRadius: 27, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: -26,
    borderWidth: 4, borderColor: colors.card,
  },

  quickRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: 11, minHeight: 56,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  quickIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
});

export default AppShell;
