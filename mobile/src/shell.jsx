// Nickland Edusoft — the frame every signed-in screen sits in.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// One shell, three shapes, decided by the width of the window rather than by
// the platform: a labelled sidebar on a desktop browser, a rail of icons on a
// tablet, a bottom bar on a phone — and the phone shape is what a narrow
// browser window gets too, because a browser window dragged to 380px wide is a
// phone as far as the layout is concerned.
//
// This replaces expo-router's Tabs for the signed-in areas. Tabs draws a bottom
// bar and only a bottom bar; a teacher on a laptop needs the whole of their
// app visible at once, not five of its fifteen screens with the rest behind a
// picker. Routing is unchanged — every screen still has a URL that can be
// typed, bookmarked and shared.

import React, { createContext, useContext, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { Slot, usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, palette, gradients, type, spacing, radius, shadow } from './theme';
import { useLayout } from './responsive';
import { Icon } from './icons';
import { Avatar, Badge, Crest, Gradient, IconButton, Sheet } from './ui';
import { useBranding } from './brand';
import { ContactSheet } from './actions';
import { channels as channelsFor, generalMessage } from './contact';
import { visibleNav, groupNav } from './nav';
import { useAuth } from './auth';

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
    // The area root (/staff, /parent) prefixes every route inside it, so it
    // only counts on an exact match — otherwise a pupil's record would light
    // up "Overview" and nothing else ever would.
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [screenTitle, setScreenTitle] = useState(null);
  const schoolName = brand.school?.name || school || 'Nickland Edusoft';
  const contactChannels = channelsFor(brand.contact || {});

  const items = visibleNav(nav.items, profile);
  const active = activeKey(items, pathname || '');
  const current = items.find(i => i.key === active);
  const go = (href) => { setMoreOpen(false); router.push(href); };

  const person = profile?.user?.full_name || profile?.parent?.full_name || 'Signed in';
  const role = profile?.designation || (profile?.role === 'parent' ? 'Parent' : 'Staff');

  // "Message the school" belongs in the chrome, not on one screen: a parent
  // with a question and a teacher who needs the office both want it wherever
  // they happen to be standing.
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
        photo={profile?.photo || profile?.staff?.photo}
        onChat={contactChannels.length ? () => setChatOpen(true) : null}
        onAccount={() => go(nav.accountHref)}
      />
      <View style={{ flex: 1 }}>{children || <Slot />}</View>
    </View>
  );

  const withTitle = (node) => <TitleCtx.Provider value={setScreenTitle}>{node}</TitleCtx.Provider>;

  if (layout.nav === 'bottom') {
    const primary = nav.primary
      .map(k => (k === 'more' ? { key: 'more', label: 'More', icon: 'filter' } : items.find(i => i.key === k)))
      .filter(Boolean);
    // Anything not on the bar is reachable from More — nothing is unreachable
    // because the phone is narrow.
    const rest = items.filter(i => !nav.primary.includes(i.key));
    return withTitle(
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {body}
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          {primary.map(i => {
            const on = i.key === 'more' ? moreOpen : i.key === active;
            return (
              <TouchableOpacity
                key={i.key} accessibilityRole="tab" accessibilityState={{ selected: on }}
                style={styles.bottomItem} activeOpacity={0.7}
                onPress={() => (i.key === 'more' ? setMoreOpen(true) : go(i.href))}
              >
                <View style={[styles.bottomIcon, on && { backgroundColor: colors.primarySoft }]}>
                  <Icon name={i.icon} size={20} color={on ? colors.primary : colors.muted} />
                </View>
                <Text numberOfLines={1} style={{ fontSize: 10.5, fontWeight: '700', color: on ? colors.primary : colors.muted }}>
                  {i.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {chat}

        <Sheet visible={moreOpen} onClose={() => setMoreOpen(false)} title="Everything else">
          {groupNav(rest).map(g => (
            <View key={g.group} style={{ marginBottom: spacing.md }}>
              <Text style={{ ...type.micro, color: colors.faint, textTransform: 'uppercase', marginBottom: 6 }}>{g.group}</Text>
              {g.items.map(i => (
                <TouchableOpacity key={i.key} onPress={() => go(i.href)} activeOpacity={0.72} style={styles.moreRow}>
                  <View style={[styles.bottomIcon, { backgroundColor: colors.primarySoft }]}>
                    <Icon name={i.icon} size={19} color={colors.primary} />
                  </View>
                  <Text style={{ ...type.body, fontWeight: '700', color: colors.text, flex: 1 }}>{i.label}</Text>
                  <Icon name="chevron" size={15} color={colors.faint} />
                </TouchableOpacity>
              ))}
            </View>
          ))}
          {contactChannels.length ? (
            <TouchableOpacity
              onPress={() => { setMoreOpen(false); setChatOpen(true); }}
              activeOpacity={0.72} style={styles.moreRow}
            >
              <View style={[styles.bottomIcon, { backgroundColor: palette.green100 }]}>
                <Icon name="whatsapp" size={19} color={palette.green600} />
              </View>
              <Text style={{ ...type.body, fontWeight: '700', color: colors.text, flex: 1 }}>Message the school</Text>
              <Icon name="chevron" size={15} color={colors.faint} />
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity onPress={() => { setMoreOpen(false); signOut(); }} activeOpacity={0.72} style={styles.moreRow}>
            <View style={[styles.bottomIcon, { backgroundColor: palette.red100 }]}>
              <Icon name="logout" size={19} color={palette.red600} />
            </View>
            <Text style={{ ...type.body, fontWeight: '700', color: palette.red600, flex: 1 }}>Sign out</Text>
          </TouchableOpacity>
        </Sheet>
      </View>
    );
  }

  // Sidebar (desktop) and rail (tablet) are the same component at two widths.
  const labelled = layout.nav === 'sidebar';
  return withTitle(
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.bg }}>
      <Gradient colors={gradients.chrome} angle={165} style={[styles.side, { width: layout.sidebarWidth, paddingTop: insets.top + 14 }]}>
        <View style={[styles.brand, !labelled && { justifyContent: 'center' }]}>
          {/* The school's own crest, not a generic mark. It was uploaded on the
              desktop years ago and never reached a single phone, because the
              API sent the file path it was stored under. */}
          <Crest logo={brand.logo} size={36} tone="chrome" />
          {labelled && (
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: '#fff', fontWeight: '800', fontSize: 14.5, letterSpacing: -0.2 }}>
                {schoolName}
              </Text>
              <Text style={{ color: colors.onChromeMuted, fontSize: 11, fontWeight: '600' }}>{nav.title}</Text>
            </View>
          )}
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.lg }}>
          {groupNav(items).map(g => (
            <View key={g.group} style={{ marginTop: spacing.md }}>
              {labelled && <Text style={styles.sideGroup}>{g.group}</Text>}
              {g.items.map(i => {
                const on = i.key === active;
                return (
                  <TouchableOpacity
                    key={i.key} accessibilityRole="link" accessibilityState={{ selected: on }}
                    onPress={() => go(i.href)} activeOpacity={0.75}
                    style={[styles.sideItem, !labelled && styles.railItem, on && styles.sideItemOn]}
                  >
                    {on && <View style={styles.sideMarker} />}
                    <Icon name={i.icon} size={19} color={on ? '#fff' : colors.onChromeMuted} />
                    {labelled && (
                      <Text numberOfLines={1} style={{ color: on ? '#fff' : colors.onChromeMuted, fontWeight: on ? '700' : '600', fontSize: 14 }}>
                        {i.label}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </ScrollView>

        <View style={[styles.sideUser, !labelled && { justifyContent: 'center' }]}>
          <Avatar name={person} photo={profile?.photo || profile?.staff?.photo} size={34} tone="chrome" />
          {labelled && (
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{person}</Text>
              <Text numberOfLines={1} style={{ color: colors.onChromeMuted, fontSize: 11, fontWeight: '600' }}>{role}</Text>
            </View>
          )}
          {labelled && <IconButton name="logout" size={32} tone="chrome" onPress={signOut} label="Sign out" />}
        </View>
      </Gradient>

      <View style={{ flex: 1, minWidth: 0 }}>{body}</View>
      {chat}
    </View>
  );
}

function TopBar({ title, subtitle, logo, pending, person, photo, onAccount, onChat }) {
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const phone = layout.nav === 'bottom';
  return (
    <Gradient
      colors={phone ? gradients.chrome : ['#FFFFFF', '#FFFFFF']}
      angle={120}
      style={[
        styles.topBar,
        { paddingTop: (phone ? insets.top : 0) + (phone ? 12 : 0) + 12, paddingHorizontal: layout.gutter },
        !phone && { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: colors.border },
      ]}
    >
      {/* On a phone there is no sidebar, so this is the only place the school's
          crest can appear — and it is the first thing that tells a parent they
          are looking at their own school's app. */}
      {phone ? <Crest logo={logo} size={34} tone="chrome" /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        {subtitle ? (
          <Text numberOfLines={1} style={{ ...type.micro, textTransform: 'uppercase', color: phone ? colors.onChromeMuted : colors.faint }}>
            {subtitle}
          </Text>
        ) : null}
        <Text numberOfLines={1} style={{ ...type.title, fontSize: phone ? 19 : 21, color: phone ? '#fff' : colors.text }}>
          {title}
        </Text>
      </View>
      {pending > 0 ? (
        <Badge tone={phone ? 'chrome' : 'data'} icon="refresh" label={`${pending} waiting`} />
      ) : null}
      {onChat ? (
        <IconButton
          name="whatsapp" size={36} tone={phone ? 'chrome' : 'subtle'}
          onPress={onChat} label="Message the school"
        />
      ) : null}
      {!phone ? (
        <TouchableOpacity onPress={onAccount} activeOpacity={0.8} style={{ marginLeft: spacing.sm }}>
          <Avatar name={person} photo={photo} size={36} />
        </TouchableOpacity>
      ) : null}
    </Gradient>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingBottom: 14,
  },

  side: { paddingHorizontal: 12, paddingBottom: 12 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6, paddingBottom: 12 },
  brandMark: {
    width: 34, height: 34, borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center',
  },
  sideGroup: {
    color: 'rgba(255,255,255,0.42)', fontSize: 10.5, fontWeight: '800',
    letterSpacing: 0.9, textTransform: 'uppercase', paddingHorizontal: 12, marginBottom: 6,
  },
  sideItem: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.sm + 2, marginBottom: 2,
  },
  railItem: { justifyContent: 'center', paddingHorizontal: 0 },
  sideItemOn: { backgroundColor: 'rgba(255,255,255,0.11)' },
  sideMarker: {
    position: 'absolute', left: 0, top: 10, bottom: 10, width: 3,
    borderRadius: 3, backgroundColor: palette.gold400,
  },
  sideUser: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingTop: 12, paddingHorizontal: 6,
    borderTopWidth: 1, borderTopColor: colors.chromeLine,
  },

  bottomBar: {
    flexDirection: 'row', backgroundColor: colors.card,
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6,
    ...(Platform.OS === 'web' ? {} : shadow.raised),
  },
  bottomItem: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 2 },
  bottomIcon: {
    width: 40, height: 26, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  moreRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: 10,
  },
});

export default AppShell;
