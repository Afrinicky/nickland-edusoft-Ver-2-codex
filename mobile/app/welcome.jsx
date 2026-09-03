// Welcome, and the three things the app is for.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Shown once, before the sign-in box, and never again. Two jobs:
//
//   Say whose app this is. A teacher handed a link by the head, or a parent
//   sent one over WhatsApp, arrives with no idea what they are opening. The
//   crest and the school's own name answer that before anything is asked of
//   them.
//
//   Say what it does — in the words of the job, not of the software. "Take the
//   register from your phone" is a thing a teacher recognises; "attendance
//   management module" is not.
//
// It is skippable from the first slide. Somebody who has used it before and is
// only reinstalling should not have to read three screens to sign in.
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBranding } from '../src/brand';
import { storage } from '../src/storage';
import { SEEN_KEY } from './index';
import { Button, Crest, Dots, IconTile, Heading, Body, Muted } from '../src/ui';
import { Appear } from '../src/motion';
import { useLayout } from '../src/responsive';
import { colors, palette, type, spacing, radius, shadow } from '../src/theme';

const SLIDES = [
  {
    icon: 'school',
    tone: 'primary',
    title: 'Your school, in your pocket',
    body: 'The register, exam marks, report cards, homework and the morning canteen collection — the whole school day, from the phone already in your hand.',
    points: ['Works on the school Wi-Fi with the internet down', 'Nothing to install — it opens in a browser'],
  },
  {
    icon: 'award',
    tone: 'gold',
    title: 'Parents see what matters',
    body: "Marks against the grading scale, conduct and the class teacher's remark, every past report with the trend across them, the register day by day, and the bill line by line.",
    points: ['Print a report card exactly as the office prints it', 'Message the school when something needs saying'],
  },
  {
    icon: 'shield',
    tone: 'success',
    title: 'No money changes hands here',
    body: 'You can see every balance and every receipt the school has issued. Paying is arranged with the office — the app will never ask you for a card number or a mobile-money PIN.',
    points: ['Settle a balance over the school’s own WhatsApp', 'Anyone asking for a PIN in here is not the school'],
  },
];

export default function Welcome() {
  const brand = useBranding();
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const [i, setI] = useState(0);
  const last = i === SLIDES.length - 1;

  const done = useCallback(async () => {
    try { await storage.set(SEEN_KEY, '1'); } catch (_) { /* storage refused; carry on */ }
    router.replace('/connect');
  }, []);

  const slide = SLIDES[i];

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 20, paddingBottom: Math.max(insets.bottom, 20) + 8 }]}>
      <View style={styles.head}>
        <Crest logo={brand.logo} size={40} tone="light" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ ...type.body, fontWeight: '800', color: colors.text }}>
            {brand.school?.name || 'Nickland Edusoft'}
          </Text>
          {brand.school?.motto ? <Muted numberOfLines={1}>{brand.school.motto}</Muted> : null}
        </View>
        {!last ? <Button variant="ghost" size="sm" title="Skip" full={false} onPress={done} /> : null}
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { maxWidth: 560, alignSelf: 'center', width: '100%' }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Keyed on the slide so each one enters rather than the text simply
            swapping underneath the reader. */}
        <Appear key={i} distance={14} from="right">
          <View style={{ alignItems: 'center', gap: spacing.lg }}>
            <IconTile name={slide.icon} tone={slide.tone} size={layout.isCompact ? 88 : 104} />
            <Text style={[type.title, { fontSize: layout.isCompact ? 24 : 27, color: colors.text, textAlign: 'center' }]}>
              {slide.title}
            </Text>
            <Text style={[type.body, { color: colors.textSoft, textAlign: 'center', maxWidth: 440, lineHeight: 23 }]}>
              {slide.body}
            </Text>
            <View style={{ gap: 9, width: '100%', maxWidth: 400, marginTop: 4 }}>
              {slide.points.map(p => (
                <View key={p} style={styles.point}>
                  <View style={styles.tick} />
                  <Text style={[type.small, { color: colors.textSoft, flex: 1, fontWeight: '600' }]}>{p}</Text>
                </View>
              ))}
            </View>
          </View>
        </Appear>
      </ScrollView>

      <View style={[styles.foot, { maxWidth: 560, alignSelf: 'center', width: '100%' }]}>
        <Dots count={SLIDES.length} index={i} />
        <View style={{ flex: 1 }} />
        {i > 0 ? <Button variant="ghost" title="Back" full={false} onPress={() => setI(i - 1)} /> : null}
        <Button
          title={last ? 'Get started' : 'Next'}
          iconRight="arrow" full={false}
          onPress={last ? done : () => setI(i + 1)}
        />
      </View>
    </View>
  );
}

const styles = {
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.xl },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  body: { flexGrow: 1, justifyContent: 'center', paddingVertical: spacing.xl },
  point: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.card, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: 11, paddingHorizontal: 13,
  },
  tick: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, flexShrink: 0,
  },
  foot: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.lg },
};
