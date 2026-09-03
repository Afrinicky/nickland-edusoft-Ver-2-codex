// The parent's own account.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Who is signed in, which of the school's connections this is, how to reach the
// school, and how to leave. It also states plainly what this app does with
// money, because "settle the remaining" appears on every child's page and a
// parent is entitled to know before they tap it that no card details are being
// asked for anywhere.
import React from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../src/auth';
import { useBranding } from '../../src/brand';
import {
  Screen, Card, Section, Hero, Heading, Body, Muted, Micro, Button, Avatar,
  KeyValue, ListRow, MenuRow, InfoNote, Crest, Toolbar, Badge, Gradient,
} from '../../src/ui';
import { Appear } from '../../src/motion';
import { ContactSchool } from '../../src/actions';
import { channels as channelsFor, hrefFor, open as openLink } from '../../src/contact';
import { useLayout } from '../../src/responsive';
import { colors, gradients, spacing, radius, shadow, type } from '../../src/theme';
import { Icon } from '../../src/icons';

export default function Account() {
  const { profile, host, mode, signOut, forgetConnection } = useAuth();
  const brand = useBranding();
  const layout = useLayout();
  const p = profile?.parent || {};
  const where = mode === 'cloud'
    ? `${brand.school?.name || profile?.school?.name || 'School portal'} — over the internet`
    : `${host} — on the school's network`;
  const list = channelsFor(brand.contact || {});

  return (
    <Screen>
      {/* The reference's profile header: the person's own face, centred, on
          the brand colour, with their settings in a plain list underneath. */}
      <Appear distance={12}>
        <Gradient colors={gradients.brand} angle={128} style={[styles.head, shadow.raised]}>
          <View pointerEvents="none" style={styles.headGlow} />
          <View style={{ alignItems: 'center', gap: spacing.md }}>
            <Avatar name={p.full_name || 'Parent'} size={78} tone="chrome" ring />
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Text numberOfLines={2} style={{ ...type.title, color: '#fff', textAlign: 'center' }}>
                {p.full_name || 'Parent'}
              </Text>
              <Text numberOfLines={1} style={{ ...type.small, color: 'rgba(255,255,255,0.76)', fontWeight: '600' }}>
                {[p.phone, p.email].filter(Boolean).join('  ·  ') || 'Parent account'}
              </Text>
            </View>
            <Badge tone="chrome" icon={mode === 'cloud' ? 'refresh' : 'tick'}
              label={mode === 'cloud' ? 'Over the internet' : "On the school's network"} />
          </View>
        </Gradient>
      </Appear>

      <Section title="Your school" icon="school">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md }}>
          <Crest logo={brand.logo} size={48} tone="light" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Heading>{brand.school?.name || profile?.school?.name || 'Your school'}</Heading>
            {brand.school?.motto ? <Muted>{brand.school.motto}</Muted> : null}
          </View>
        </View>
        <KeyValue items={[
          { label: 'Address', value: brand.school?.address },
          { label: 'Digital address', value: brand.school?.digital_address },
          { label: 'Website', value: brand.school?.website },
          { label: 'Connection', value: where },
        ]} />
      </Section>

      <Section title="Reaching the school" icon="whatsapp" subtitle="Questions, absences, fees — any of these gets you a person.">
        {list.length === 0 ? (
          <Muted>The school has not recorded a phone number or an email address yet.</Muted>
        ) : list.map((c, i, arr) => (
          <MenuRow
            key={c.key}
            icon={c.key === 'whatsapp' ? 'whatsapp' : c.icon}
            iconTone={c.key === 'whatsapp' ? 'success' : c.key === 'email' ? 'primary' : 'violet'}
            label={c.label} hint={c.value} last={i === arr.length - 1}
            onPress={() => openLink(hrefFor(c))}
          />
        ))}
      </Section>

      <Section title="About payments" icon="wallet">
        <InfoNote message="No payment is ever taken inside this app. You can see every bill, every balance and every receipt here; paying is arranged with the school office, and the receipt the office issues appears in your child's payment history." />
        <Muted style={{ marginTop: spacing.sm }}>
          If anyone asks you for card details or a mobile-money PIN through this app, it is not the
          school. Ring the number above.
        </Muted>
      </Section>

      <Section title="Your details" icon="user">
        <Muted>
          Your name, phone number and email are held by the school office. Ask them to change
          anything that is wrong — the app shows what they hold.
        </Muted>
      </Section>

      <Section title="Leaving" icon="logout">
        <MenuRow icon="logout" label="Sign out" danger
          hint="You will need your password to come back in"
          onPress={async () => { await signOut(); router.replace('/login'); }} />
        <MenuRow icon="pin" label="Change school" iconTone="neutral" last
          hint="Point this app at a different school"
          onPress={async () => { await forgetConnection(); router.replace('/connect'); }} />
      </Section>

      <Muted style={{ textAlign: 'center', paddingVertical: spacing.md }}>
        Nickland Edusoft · Nickland Sales
      </Muted>
    </Screen>
  );
}

const styles = {
  head: { borderRadius: radius.lg, padding: spacing.xl, overflow: 'hidden' },
  headGlow: {
    position: 'absolute', right: -70, top: -90, width: 250, height: 250,
    borderRadius: 125, backgroundColor: 'rgba(255,255,255,0.08)',
  },
};
