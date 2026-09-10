// Nickland Edusoft — one screen failing is not the app failing.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// React's rule is unforgiving and correct: a component that throws while
// rendering takes its whole tree down with it, and what is left is an empty
// <div>. On a phone that is a WHITE SCREEN, with no message, no back button
// and nothing to tell anybody what happened — the app simply stops.
//
// That is not a hypothetical. Fees → Payments called an API method by a name
// the client does not export; the TypeError unmounted everything, and a bursar
// standing at the counter with a parent in front of them saw a blank page.
// The typo is fixed, but the SHAPE of that failure is what mattered: any
// screen, any future mistake, the same white screen.
//
// So the frame around every screen catches it. What is drawn instead is a
// plain apology with the two things a person in a school office can actually
// do — try again, or go back to the app — and the error text underneath for
// whoever is asked to look at it later. The shell around it survives: the top
// bar, the bottom bar and the drawer keep working, so nobody is trapped.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, type, spacing, radius } from './theme';
import { Icon } from './icons';
import { Press } from './motion';

export class ScreenBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Nowhere to send it — a school's PC on the Wi-Fi has no error service and
    // should not acquire one. The console is where somebody looks.
    if (typeof console !== 'undefined' && console.error) {
      console.error('Nickland Edusoft — screen failed:', error, info && info.componentStack);
    }
  }

  // A new route is a new attempt. Without this, one screen that threw would
  // keep its apology on display over every screen opened after it.
  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.wrap}>
        <View style={styles.mark}><Icon name="alert" size={26} color={colors.danger} /></View>
        <Text style={styles.title}>This screen could not be opened</Text>
        <Text style={styles.body}>
          Nothing has been lost and nothing has been saved. Try it again, and if it keeps
          happening tell the school office which screen it was.
        </Text>
        <Press onPress={() => this.setState({ error: null })} accessibilityRole="button">
          <View style={styles.btn}><Text style={styles.btnText}>Try again</Text></View>
        </Press>
        <Text numberOfLines={4} style={styles.detail}>
          {String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)}
        </Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: spacing.xl, gap: spacing.sm, backgroundColor: colors.bg,
  },
  mark: {
    width: 60, height: 60, borderRadius: 30, marginBottom: spacing.xs,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
  },
  title: { ...type.heading, color: colors.text, textAlign: 'center' },
  body: { ...type.body, color: colors.muted, textAlign: 'center', maxWidth: 420 },
  btn: {
    marginTop: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: 11,
    borderRadius: radius.control, backgroundColor: colors.primary, minHeight: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  btnText: { ...type.body, color: '#fff', fontWeight: '700' },
  detail: {
    ...type.small, color: colors.faint, textAlign: 'center', marginTop: spacing.lg,
    maxWidth: 420, fontSize: 11.5,
  },
});

export default ScreenBoundary;
