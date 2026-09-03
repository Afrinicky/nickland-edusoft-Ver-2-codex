// Welcome — one screen, then the sign-in box.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// This was three slides: a headline, a paragraph and two bullet points each,
// with dots and a Next button, before anybody could reach a password field.
// Nine claims about the software, read once, by people who had already decided
// to open it. A teacher handed a link by the head does not need to be told what
// a register is, and a parent sent one over WhatsApp is trying to see a mark.
//
// One job survives, and it is worth a screen: say whose app this is, so nobody
// types a password into something they cannot identify. Crest, name, button.
import React, { useCallback } from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { useBranding } from '../src/brand';
import { storage } from '../src/storage';
import { SEEN_KEY } from './index';
import { Button, Crest } from '../src/ui';
import { Appear } from '../src/motion';
import { colors, type, spacing } from '../src/theme';

export default function Welcome() {
  const brand = useBranding();
  const school = brand.school?.name;

  const done = useCallback(async () => {
    // A storage that refuses is not a reason to block the door — the worst
    // case is that this screen is seen twice.
    try { await storage.set(SEEN_KEY, '1'); } catch (_) {}
    router.replace('/login');
  }, []);

  return (
    <View style={{
      flex: 1, backgroundColor: colors.bg,
      alignItems: 'center', justifyContent: 'center',
      paddingHorizontal: spacing.lg, paddingVertical: spacing.xl,
    }}>
      <Appear distance={14}>
        <View style={{ alignItems: 'center', gap: spacing.lg, maxWidth: 360 }}>
          <Crest logo={brand.logo} size={80} />
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text numberOfLines={3} style={{
              ...type.title, fontSize: 26, color: colors.text, textAlign: 'center',
            }}>{school || 'Nickland Edusoft'}</Text>
            <Text style={{ ...type.body, color: colors.muted, textAlign: 'center' }}>
              Staff and parents, same app.
            </Text>
          </View>
          <View style={{ alignSelf: 'stretch', marginTop: spacing.sm }}>
            <Button title="Continue" onPress={done} size="lg" />
          </View>
        </View>
      </Appear>
    </View>
  );
}
