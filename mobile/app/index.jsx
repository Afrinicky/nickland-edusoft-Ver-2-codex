// The splash, and the gate behind it.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Every cold start lands here. Reading the saved session out of storage takes
// a moment on a cheap Android handset, and a moment of nothing is how an app
// gets a reputation for being broken. So this moment is spent showing whose
// app it is.
//
// It is the one dark screen in the product, deliberately: the school's crest
// carries better on ink than on white, and it marks the boundary between "not
// yet running" and "running". Everything after it is light, because the rest
// of the app is used outdoors.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Platform, Easing } from 'react-native';
import { Redirect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../src/auth';
import { useBranding } from '../src/brand';
import { Crest } from '../src/ui';
import { useReducedMotion, EASE_OUT } from '../src/motion';
import { colors, gradients, type, spacing, radius } from '../src/theme';
import { Gradient } from '../src/ui';
import { storage } from '../src/storage';

export const SEEN_KEY = 'seenWelcome';

export default function Index() {
  const { ready, host, mode, schoolId, token, profile } = useAuth();
  const brand = useBranding();
  const [seen, setSeen] = useState(null);

  // Has this person been introduced to the app before? Asked once, at the
  // splash, so the answer is already in hand by the time it matters.
  useEffect(() => {
    let live = true;
    storage.get(SEEN_KEY)
      .then(v => { if (live) setSeen(v === '1'); })
      .catch(() => { if (live) setSeen(true); });   // storage refused: don't nag
    return () => { live = false; };
  }, []);

  if (!ready || seen === null) return <Splash logo={brand.logo} school={brand.school?.name} />;
  if (!seen) return <Redirect href="/welcome" />;
  if (!host) return <Redirect href="/connect" />;
  // A portal connection is only usable once a school has been chosen.
  if (mode === 'cloud' && !schoolId) return <Redirect href="/connect" />;
  if (!token || !profile) return <Redirect href="/login" />;
  return <Redirect href={profile.role === 'parent' ? '/parent' : '/staff'} />;
}

/**
 * The crest settles, the name follows, and a determinate-looking bar fills.
 * The bar is honest about being a placeholder — it eases to 90% and waits
 * there rather than pretending to know how long storage will take, which is
 * the difference between a loading state and a lie.
 */
export function Splash({ logo, school }) {
  const reduced = useReducedMotion();
  const rise = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const fill = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) { rise.setValue(1); fill.setValue(1); return undefined; }
    const a = Animated.parallel([
      Animated.timing(rise, { toValue: 1, duration: 520, easing: EASE_OUT, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(fill, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: false }),
    ]);
    a.start();
    return () => a.stop();
  }, [rise, fill, reduced]);

  return (
    <Gradient colors={gradients.chrome} angle={160} style={styles.screen}>
      {/* The one dark screen in the app, so the one place the phone's own
          status bar has to carry light content. */}
      <StatusBar style="light" />
      <Animated.View style={{
        alignItems: 'center', gap: spacing.lg,
        opacity: rise,
        transform: reduced ? undefined : [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
      }}>
        <Crest logo={logo} size={92} tone="chrome" />
        <View style={{ alignItems: 'center', gap: 5 }}>
          <Text numberOfLines={2} style={styles.name}>{school || 'Nickland Edusoft'}</Text>
          <Text style={styles.tag}>Attendance · Marks · Reports · Canteen</Text>
        </View>
      </Animated.View>

      <View style={styles.track} accessibilityLabel="Starting">
        <Animated.View style={[styles.fill, {
          width: fill.interpolate({ inputRange: [0, 1], outputRange: ['8%', '90%'] }),
        }]} />
      </View>

      <Text style={styles.vendor}>Nickland Sales</Text>
    </Gradient>
  );
}

const styles = {
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.xxl },
  name: {
    ...type.title, color: '#fff', fontSize: 24, textAlign: 'center', maxWidth: 320,
  },
  tag: { ...type.small, color: 'rgba(255,255,255,0.56)', fontWeight: '600', letterSpacing: 0.2 },
  track: {
    width: 148, height: 4, borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 4, backgroundColor: '#fff' },
  vendor: {
    ...type.micro, color: 'rgba(255,255,255,0.32)',
    position: 'absolute', bottom: 34,
  },
};
