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
  KeyValue, ListRow, InfoNote, Crest, Toolbar,
} from '../../src/ui';
import { ContactSchool } from '../../src/actions';
import { channels as channelsFor, hrefFor, open as openLink } from '../../src/contact';
import { useLayout } from '../../src/responsive';
import { colors, spacing } from '../../src/theme';
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
      <Hero
        crest={<Avatar name={p.full_name || 'Parent'} size={layout.isPhone ? 54 : 66} tone="chrome" ring />}
        eyebrow="Signed in as"
        title={p.full_name || 'Parent'}
        subtitle={[p.phone, p.email].filter(Boolean).join('  ·  ') || 'Parent account'}
      />

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
        ) : list.map(c => (
          <ListRow
            key={c.key}
            icon={c.key === 'whatsapp' ? 'whatsapp' : c.icon}
            iconTone={c.key === 'whatsapp' ? 'success' : c.key === 'email' ? 'info' : 'primary'}
            title={c.label} subtitle={c.value}
            right={<Icon name="chevron" size={15} color={colors.faint} />}
            onPress={() => openLink(hrefFor(c))}
          />
        ))}
        <View style={{ marginTop: spacing.md }}>
          <ContactSchool variant="subtle" title="Message the school" icon="whatsapp" full />
        </View>
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

      <Card>
        <Toolbar>
          <Button title="Sign out" variant="danger" icon="logout" full={false}
            onPress={async () => { await signOut(); router.replace('/login'); }} />
          <Button title="Change school" variant="ghost" full={false}
            onPress={async () => { await forgetConnection(); router.replace('/connect'); }} />
        </Toolbar>
      </Card>
    </Screen>
  );
}
