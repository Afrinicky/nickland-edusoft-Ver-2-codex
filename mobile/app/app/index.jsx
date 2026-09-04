// Home — everything this account can open, on one screen.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The installed application opens here rather than on a dashboard, and it is
// right to. A dashboard is an answer to a question; a grid of the eleven things
// you are allowed to do is the question itself, and it is the better first
// screen for somebody who has just sat down with a job in mind.
//
// It is also the plainest possible statement of the product's rule. Two people
// signing in on the same PC see two different grids, and neither is shown a
// card that would refuse them. There is no greyed-out tile, no padlock, no
// "upgrade to see this" — a school's system is not a shop.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, type, spacing, radius, shadow, motion } from '../../src/theme';
import { useLayout } from '../../src/responsive';
import { Icon } from '../../src/icons';
import { Press, Appear } from '../../src/motion';
import { useAuth } from '../../src/auth';
import { useBranding } from '../../src/brand';
import { useModules } from '../../src/appshell';
import MyDay from '../../src/screens/staff/index';
import { firstName } from '../../src/api';
import { Crest } from '../../src/ui';

export default function Home() {
  const layout = useLayout();

  // Two homes, and both of them are the design that was asked for.
  //
  // On a wide screen this is the installed application's Home: a welcome and
  // the grid of what you may open, nothing else. On a phone the app keeps the
  // home it already had — the day, its jobs and today's lessons — and the grid
  // goes underneath it. A teacher at ten past seven wants the register, not a
  // menu; somebody at a desk with a mouse wants the menu.
  if (layout.isDesktop) return <ModuleGrid welcome />;
  return <MyDay grid={<ModuleGrid />} />;
}

/**
 * Everything this account can open, as tiles.
 *
 * `welcome` draws the installed app's greeting above it. Without it the grid
 * is a section on somebody else's page and introduces itself quietly.
 */
function ModuleGrid({ welcome = false }) {
  const router = useRouter();
  const layout = useLayout();
  const { profile } = useAuth();
  const brand = useBranding();
  const { items } = useModules();

  // Home itself is not a card on Home, and neither is Account — a grid whose
  // first tile takes you to the grid you are looking at is a grid nobody
  // designed. "My work" stays: a payslip and a clock-in are a real destination.
  const cards = items.filter(m => m.key !== 'home' && m.key !== 'account');
  const who = firstName(profile?.user?.full_name || '', 'there');

  return (
    <View style={{ width: '100%' }}>
      {welcome ? (
        <View style={styles.hero}>
          {!layout.isDesktop ? <Crest logo={brand.logo} size={54} /> : null}
          <Text style={[styles.welcome, layout.isDesktop && { fontSize: 34 }]}>
            Welcome, {who}!
          </Text>
          <Text style={styles.ask}>What would you like to do today?</Text>
        </View>
      ) : (
        <Text style={styles.sectionTitle}>Everything you can open</Text>
      )}

      <View style={styles.grid}>
        {cards.map((m, i) => (
          <Appear key={m.key} delay={Math.min(i, 8) * motion.stagger} distance={12}>
            <ModuleCard module={m} compact={!layout.isDesktop}
                        onPress={() => router.push(m.href)} />
          </Appear>
        ))}
      </View>

      {cards.length === 0 ? (
        <View style={styles.none}>
          <Text style={styles.noneTitle}>Nothing has been assigned to you yet</Text>
          <Text style={styles.noneBody}>
            Your account is active, but no part of the system has been opened to it.
            Ask the school office to set your access, then sign in again.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * One tile: an icon in a disc, the module's name, and the desktop's own line
 * describing it.
 *
 * The gold rule along the bottom edge is the installed app's; it appears on
 * hover as well as at rest, deepening rather than arriving, so a mouse moving
 * across the grid does not make eleven bars flash on and off.
 */
function ModuleCard({ module, onPress, compact = false }) {
  const [hover, setHover] = React.useState(false);
  return (
    <Press
      onPress={onPress} accessibilityRole="link" accessibilityLabel={module.label}
      onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
    >
      <View style={[styles.card, compact && styles.cardCompact, hover && styles.cardHover]}>
        <View style={[styles.cardIcon, compact && styles.cardIconCompact, hover && styles.cardIconHover]}>
          <Icon name={module.icon} size={compact ? 24 : 30} color={hover ? colors.primary : colors.textSoft} />
        </View>
        {/* On a phone the short name: "Fees", not "Fees Management". Two
            words wrapping to two lines make a row of tiles ragged, and the
            sidebar and the bottom bar already use the short name. */}
        <Text numberOfLines={2} style={styles.cardTitle}>
          {compact ? (module.short || module.label) : module.label}
        </Text>
        {compact ? null : (
          <Text numberOfLines={3} style={styles.cardSub}>{module.sub}</Text>
        )}
        <View style={[styles.cardRule, hover && styles.cardRuleOn]} />
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 6, paddingTop: spacing.xl, paddingBottom: spacing.xxl },
  welcome: { ...type.display, color: colors.primary, fontSize: 27, textAlign: 'center' },
  ask: { ...type.body, color: colors.muted, fontSize: 16, textAlign: 'center' },
  sectionTitle: { ...type.heading, color: colors.text, marginBottom: spacing.md },

  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg,
    justifyContent: 'center',
  },
  card: {
    width: 216, minHeight: 196,
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.lg,
    alignItems: 'center', justifyContent: 'flex-start', gap: 6,
    overflow: 'hidden', ...shadow.rest,
  },
  // On a phone: two to a row, and shorter — the tile is a way in, not a card
  // to read. `sub` is dropped there rather than squeezed to one line.
  cardCompact: { width: 156, minHeight: 132, paddingTop: spacing.lg },
  cardHover: { borderColor: colors.primaryLine, ...shadow.raised },
  cardIcon: {
    width: 68, height: 68, borderRadius: 34, marginBottom: 10,
    backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center',
  },
  cardIconCompact: { width: 52, height: 52, borderRadius: 26, marginBottom: 6 },
  cardIconHover: { backgroundColor: colors.primarySoft },
  cardTitle: { ...type.heading, color: colors.text, textAlign: 'center', fontSize: 16.5 },
  cardSub: { ...type.small, color: colors.muted, textAlign: 'center', lineHeight: 18 },
  cardRule: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: 3,
    backgroundColor: colors.accent, opacity: 0.55,
  },
  cardRuleOn: { opacity: 1 },

  none: {
    marginTop: spacing.xl, padding: spacing.xl, alignItems: 'center', gap: 6,
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  noneTitle: { ...type.heading, color: colors.text, textAlign: 'center' },
  noneBody: { ...type.body, color: colors.muted, textAlign: 'center', maxWidth: 460 },
});
