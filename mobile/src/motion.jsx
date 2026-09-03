// Nickland Edusoft — motion.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Four rules, and they are the whole of it:
//
//   1. Content is visible by default. A reveal ENHANCES something already
//      painted; it never gates it. An animation that has to fire before text
//      appears will one day not fire — a background tab, a headless render, a
//      slow phone that drops the frame — and the screen ships blank.
//
//   2. Ease-out only, exponential. No bounce, no elastic, no spring overshoot.
//      This is a school's records; a report card that boings has misjudged the
//      room.
//
//   3. Motion earns its place or it is not there. What moves here: a screen
//      arriving, a list settling in (staggered, capped at eight — past that it
//      is a wait, not a flourish), a press, a drawer, a tab indicator, a
//      figure counting up. Nothing else.
//
//   4. Reduced motion is not a downgrade. A person who has asked their phone
//      to stop moving things gets the same interface, instantly, with a short
//      crossfade instead of travel.
//
// Everything below drives `transform` and `opacity` only, on the native driver
// where there is one, so nothing here can cause a layout pass mid-animation.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, View, AccessibilityInfo } from 'react-native';
import { motion } from './theme';

// cubic-bezier(0.16, 1, 0.3, 1) — the curve the desktop CSS uses, so the two
// surfaces decelerate identically.
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_OUT_SOFT = Easing.bezier(0.33, 1, 0.68, 1);

// ── does this person want things to move? ───────────────────────────────────
// On the web this is `prefers-reduced-motion`; on a phone it is the OS
// accessibility switch. Both are watched, because a person can change their
// mind while the app is open.
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.matchMedia) {
      try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
    }
    return false;
  });

  useEffect(() => {
    let live = true;
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || !window.matchMedia) return undefined;
      let mq;
      try { mq = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch (_) { return undefined; }
      const onChange = (e) => { if (live) setReduced(e.matches); };
      // Safari before 14 has only the deprecated listener.
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
      return () => {
        live = false;
        if (mq.removeEventListener) mq.removeEventListener('change', onChange);
        else if (mq.removeListener) mq.removeListener(onChange);
      };
    }
    AccessibilityInfo.isReduceMotionEnabled?.().then(v => { if (live) setReduced(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', v => { if (live) setReduced(!!v); });
    return () => { live = false; sub?.remove?.(); };
  }, []);

  return reduced;
}

// ── a thing arriving ────────────────────────────────────────────────────────
/**
 * Fades in and travels a short distance. Starts at opacity 0 only for the
 * first frame — the element is mounted and laid out the whole time, so a
 * screenshot, a print, or a browser that never runs the animation still shows
 * it. Under reduced motion the travel is dropped and only the fade remains.
 *
 * `from` is the direction it comes from: 'up' | 'down' | 'left' | 'right' | 'none'.
 */
export function Appear({
  children, delay = 0, distance = 10, from = 'up',
  duration = motion.medium, style, ...rest
}) {
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(t, {
      toValue: 1,
      duration: reduced ? motion.fast : duration,
      delay: reduced ? 0 : delay,
      easing: EASE_OUT,
      useNativeDriver: Platform.OS !== 'web',
    });
    anim.start();
    return () => anim.stop();
  }, [t, delay, duration, reduced]);

  const travel = reduced || from === 'none' ? 0 : distance;
  const axis = from === 'left' || from === 'right' ? 'translateX' : 'translateY';
  const sign = from === 'down' || from === 'right' ? -1 : 1;

  const transform = travel
    ? [{ [axis]: t.interpolate({ inputRange: [0, 1], outputRange: [travel * sign, 0] }) }]
    : undefined;

  return (
    <Animated.View style={[{ opacity: t, transform }, style]} {...rest}>
      {children}
    </Animated.View>
  );
}

/**
 * The same thing for a list: each child enters a beat after the one above it.
 * Capped at `motion.staggerMax` so the ninth row does not wait half a second
 * to exist — past that everything lands together.
 */
export function AppearList({ children, delay = 0, step = motion.stagger, from = 'up', distance = 10, style }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={style}>
      {items.map((child, i) => (
        <Appear key={child.key ?? i} from={from} distance={distance}
          delay={delay + Math.min(i, motion.staggerMax) * step}>
          {child}
        </Appear>
      ))}
    </View>
  );
}

// ── a press ─────────────────────────────────────────────────────────────────
/**
 * The whole surface dips very slightly under a finger and comes back. Two
 * things it is not: a colour change (which reads as a state, not a press) and
 * a bounce. 0.975 is deliberately almost invisible — you feel it rather than
 * watch it.
 */
export function Press({ children, onPress, disabled, scaleTo = 0.975, style, ...rest }) {
  const reduced = useReducedMotion();
  const s = useRef(new Animated.Value(1)).current;

  const to = useCallback((v, duration) => {
    Animated.timing(s, {
      toValue: v, duration, easing: EASE_OUT, useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [s]);

  if (reduced || disabled) {
    return <Pressable onPress={disabled ? undefined : onPress} disabled={disabled} style={style} {...rest}>{children}</Pressable>;
  }

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => to(scaleTo, 90)}
      onPressOut={() => to(1, 260)}
      style={style}
      {...rest}
    >
      <Animated.View style={{ transform: [{ scale: s }] }}>{children}</Animated.View>
    </Pressable>
  );
}

// ── a figure that lands ─────────────────────────────────────────────────────
/**
 * Counts a number up to its value once, on first paint. Used for the two or
 * three figures a screen is actually about — an attendance rate, a balance —
 * never for every number on the page, which would turn a dashboard into a
 * slot machine. Renders the final value immediately under reduced motion.
 */
export function useCountUp(value, { duration = motion.slow, enabled = true } = {}) {
  const reduced = useReducedMotion();
  const target = Number.isFinite(Number(value)) ? Number(value) : 0;
  const [shown, setShown] = useState(reduced || !enabled ? target : 0);
  const raf = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    if (reduced || !enabled) { setShown(target); return undefined; }
    // Only on the first real value: a refresh that returns the same figure
    // should not replay the count.
    if (started.current) { setShown(target); return undefined; }
    started.current = true;

    const t0 = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / duration);
      // The same exponential deceleration as EASE_OUT, in closed form.
      const eased = 1 - Math.pow(1 - p, 4);
      setShown(target * eased);
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else setShown(target);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, duration, reduced, enabled]);

  return shown;
}

// ── a value that slides ─────────────────────────────────────────────────────
/**
 * An Animated.Value that eases to whatever it is given. Behind the progress
 * bar, the ring and the tab indicator, so none of them jump.
 */
export function useEased(value, { duration = motion.medium, native = false } = {}) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(Number(value) || 0)).current;
  useEffect(() => {
    const anim = Animated.timing(v, {
      toValue: Number(value) || 0,
      duration: reduced ? 0 : duration,
      easing: EASE_OUT,
      useNativeDriver: native && Platform.OS !== 'web',
    });
    anim.start();
    return () => anim.stop();
  }, [v, value, duration, reduced, native]);
  return v;
}

// ── the screen itself ───────────────────────────────────────────────────────
/**
 * Wraps a whole screen's body so navigating between tabs is a settle rather
 * than a cut. Deliberately small: 6px and 260ms. Anything more and moving
 * around the app feels like waiting for it.
 */
export function ScreenTransition({ children, id, style }) {
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    if (reduced) { t.setValue(1); return undefined; }
    t.setValue(0);
    const anim = Animated.timing(t, {
      toValue: 1, duration: motion.medium, easing: EASE_OUT,
      useNativeDriver: Platform.OS !== 'web',
    });
    anim.start();
    return () => anim.stop();
  }, [id, t, reduced]);

  return (
    <Animated.View
      style={[
        { flex: 1, opacity: t,
          transform: reduced ? undefined : [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

export default { Appear, AppearList, Press, ScreenTransition, useReducedMotion, useCountUp, useEased, EASE_OUT };
