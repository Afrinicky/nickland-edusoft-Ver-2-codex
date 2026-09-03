// Nickland Edusoft — the shared interface.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Every screen in the phone app and the browser app is assembled from these.
// The shapes come from one reference language and are used consistently:
//
//   A surface is white, hairline-bordered, and 20px round. Structure is carried
//   by borders, not by shadow — shadow is reserved for things that genuinely
//   sit above the page (a sheet, a drawer, the floating action).
//
//   A row inside a surface is 12px round and 44px tall at minimum, because it
//   is tapped by a thumb while its owner is holding something else.
//
//   Violet means "act" or "you are here". It is never decorative. A screen with
//   six accent colours has told the reader nothing.
//
//   Nothing a person reads sits below 4.5:1. `colors.faint` is under the floor
//   and is barred from text — it draws icons and rules and nothing else.
//
// Three things this file deliberately does NOT do, each of which it used to:
//   • a coloured 3px stripe down the left edge of a card (an accent that is
//     never a deliberate choice — it is what you reach for when the hierarchy
//     is not working),
//   • gradients behind body text,
//   • cards nested inside cards.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text as RNText, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Platform, Modal as RNModal, Pressable, Image, Animated, Easing,
} from 'react-native';
import { colors, palette, gradients, type, fontFamily, spacing, radius, shadow, motion, z } from './theme';
import { useLayout, pageWidth } from './responsive';
import { Icon } from './icons';
import { Appear, AppearList, Press, useEased, useReducedMotion, EASE_OUT } from './motion';

// ── gradients without a native dependency ───────────────────────────────────
// The browser gets a real CSS gradient. The phone gets the base colour with a
// soft band laid over it, which reads as the same object without pulling in a
// native module for the sake of a header.
export function Gradient({ colors: stops = gradients.brand, angle = 135, style, children, pointerEvents }) {
  const [from, to] = stops;
  const web = Platform.OS === 'web'
    ? { backgroundImage: `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)` }
    : null;
  return (
    <View pointerEvents={pointerEvents} style={[{ backgroundColor: from, overflow: 'hidden' }, web, style]}>
      {Platform.OS !== 'web' && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: to, opacity: 0.5 }]} />
      )}
      {children}
    </View>
  );
}

// ── text ────────────────────────────────────────────────────────────────────
export function Display({ children, style, color, numberOfLines }) { return <RNText numberOfLines={numberOfLines} style={[type.display, { color: color || colors.text }, style]}>{children}</RNText>; }
export function Title({ children, style, color, numberOfLines }) { return <RNText numberOfLines={numberOfLines} style={[type.title, { color: color || colors.text }, style]}>{children}</RNText>; }
export function Heading({ children, style, color, numberOfLines }) { return <RNText numberOfLines={numberOfLines} style={[type.heading, { color: color || colors.text }, style]}>{children}</RNText>; }
export function Body({ children, style, color, numberOfLines }) { return <RNText numberOfLines={numberOfLines} style={[type.body, { color: color || colors.textSoft }, style]}>{children}</RNText>; }
export function Muted({ children, style, numberOfLines }) { return <RNText numberOfLines={numberOfLines} style={[type.small, { color: colors.muted }, style]}>{children}</RNText>; }
export function Micro({ children, style, color }) { return <RNText style={[type.micro, { color: color || colors.muted, textTransform: 'uppercase' }, style]}>{children}</RNText>; }
export function Figure({ children, style, color, numberOfLines, fit }) {
  return (
    <RNText
      numberOfLines={numberOfLines}
      style={[type.numeric, fit ? { fontSize: figureSize(children) } : null, { color: color || colors.text }, style]}
    >{children}</RNText>
  );
}

// Kept so screens written against the first version still render.
export const H1 = Title;
export const H2 = Heading;

/**
 * The size a figure has to be to fit the space it is given.
 *
 * "GHS 1,240.00" set at 24px in a 118px-wide tile truncates to "GHS 1,2…",
 * and a balance a parent cannot read is a broken screen — worse than a broken
 * one, because it looks fine. Long figures step down rather than being cut.
 * Money is never wrapped or abbreviated: "GHS 1.2k" on a school fee is not an
 * answer to "how much do I owe".
 */
export function figureSize(value, base = 24) {
  const n = String(value ?? '').length;
  if (n <= 6) return base;
  if (n <= 9) return Math.round(base * 0.88);
  if (n <= 12) return Math.round(base * 0.76);
  if (n <= 15) return Math.round(base * 0.64);
  return Math.round(base * 0.56);
}

// ── page frame ──────────────────────────────────────────────────────────────
/**
 * The body of a screen.
 *
 * `variant` decides how wide it is allowed to get on a large window:
 *   page     the default — a working width, up to 1240px
 *   reading  a single column of prose or a form, up to 760px
 *   full     edge to edge; for a table or a chat thread that owns the width
 */
export function Screen({ children, scroll = true, refreshControl, variant = 'page', padded = true, style, footer }) {
  const layout = useLayout();
  const width = variant === 'full' ? { width: '100%' } : pageWidth(layout, variant);
  const pad = padded ? { padding: layout.gutter, gap: spacing.md } : null;
  const Body = scroll ? ScrollView : View;
  const props = scroll
    ? { contentContainerStyle: [styles.screenBody, width, pad, style], refreshControl, showsVerticalScrollIndicator: false, keyboardShouldPersistTaps: 'handled' }
    : { style: [styles.screenBody, width, pad, style] };
  return (
    <View style={styles.screen}>
      <Body style={styles.screenScroll} {...props}>{children}</Body>
      {footer}
    </View>
  );
}

// ── surfaces ────────────────────────────────────────────────────────────────
/**
 * A white surface with a hairline border.
 *
 * `tone` used to draw a 3px coloured stripe down the left edge. It doesn't any
 * more: a side stripe is what you reach for when the hierarchy is not working,
 * and it never is the answer. A toned card now tints its whole border and
 * background very slightly, so the emphasis reads as a property of the card
 * rather than as a bar stuck to it.
 */
export function Card({ children, style, tone, padded = true, onPress, elevated, appear }) {
  const toned = {
    accent:  { borderColor: palette.gold400,   backgroundColor: '#FEFBF3' },
    danger:  { borderColor: palette.red500,    backgroundColor: '#FFF8F8' },
    success: { borderColor: palette.green500,  backgroundColor: '#F5FDF8' },
    data:    { borderColor: palette.teal500,   backgroundColor: '#F4FDFD' },
    primary: { borderColor: colors.primaryLine, backgroundColor: colors.primarySoft },
  }[tone] || null;

  const body = (
    <View style={[styles.card, elevated ? shadow.raised : shadow.rest, padded && styles.cardPad, toned, style]}>
      {children}
    </View>
  );
  const wrapped = onPress
    ? <Press onPress={onPress} accessibilityRole="button">{body}</Press>
    : body;
  return appear ? <Appear delay={appear === true ? 0 : appear}>{wrapped}</Appear> : wrapped;
}

// A titled block. Saves every screen re-inventing "heading, optional action,
// then content" and keeps the spacing between them identical everywhere.
export function Section({ title, subtitle, action, children, style, tone, icon, padded = true, appear }) {
  return (
    <Card style={style} tone={tone} padded={padded} appear={appear}>
      {(title || action) && (
        <View style={styles.sectionHead}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minWidth: 0 }}>
            {icon ? <IconTile name={icon} size={34} /> : null}
            <View style={{ flex: 1, minWidth: 0 }}>
              {title ? <Heading numberOfLines={2}>{title}</Heading> : null}
              {subtitle ? <Muted style={{ marginTop: 2 }}>{subtitle}</Muted> : null}
            </View>
          </View>
          {action ? <View style={{ flexShrink: 0 }}>{action}</View> : null}
        </View>
      )}
      {children}
    </Card>
  );
}

// A small tinted square holding an icon. The app's most repeated motif: it
// gives a row a fixed left edge so a list of them reads as a column.
const TILE_TONES = {
  primary: { bg: colors.primarySoft, fg: colors.primary },
  gold:    { bg: palette.gold100,   fg: palette.gold600 },
  success: { bg: palette.green100,  fg: palette.green600 },
  danger:  { bg: palette.red100,    fg: palette.red600 },
  warning: { bg: palette.amber100,  fg: palette.amber600 },
  info:    { bg: colors.primarySoft, fg: colors.primary },
  violet:  { bg: palette.violet100, fg: palette.violet700 },
  pink:    { bg: palette.pink100,   fg: palette.pink600 },
  data:    { bg: palette.teal100,   fg: palette.teal600 },
  neutral: { bg: colors.borderSoft, fg: colors.muted },
  chrome:  { bg: 'rgba(255,255,255,0.13)', fg: '#FFFFFF' },
};

export function IconTile({ name, size = 38, tone = 'primary', color }) {
  const t = TILE_TONES[tone] || TILE_TONES.primary;
  return (
    <View style={{
      width: size, height: size, borderRadius: size * 0.3,
      backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <Icon name={name} size={Math.round(size * 0.52)} color={color || t.fg} />
    </View>
  );
}

// A numbered circle. The reference's own device for an ordered list, and the
// only place a number is set in a filled disc.
export function StepNumber({ n, size = 28, tone = 'primary' }) {
  const t = TILE_TONES[tone] || TILE_TONES.primary;
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: tone === 'primary' ? colors.primary : t.fg,
      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <RNText style={{ ...type.small, fontWeight: '800', color: '#fff', fontSize: size * 0.46 }}>{n}</RNText>
    </View>
  );
}

// ── buttons ─────────────────────────────────────────────────────────────────
const BUTTON_TONES = {
  primary: { bg: colors.primary,     fg: '#fff',           border: 'transparent' },
  gold:    { bg: palette.gold500,    fg: '#241900',        border: 'transparent' },
  danger:  { bg: colors.danger,      fg: '#fff',           border: 'transparent' },
  success: { bg: colors.success,     fg: '#fff',           border: 'transparent' },
  outline: { bg: 'transparent',      fg: colors.primary,   border: colors.primaryLine },
  subtle:  { bg: colors.primarySoft, fg: colors.primary,   border: 'transparent' },
  ghost:   { bg: 'transparent',      fg: colors.primary,   border: 'transparent' },
  chrome:  { bg: 'rgba(255,255,255,0.14)', fg: '#fff',     border: 'rgba(255,255,255,0.22)' },
};

export function Button({
  title, onPress, disabled, busy, variant = 'primary', size = 'md',
  icon, iconRight, full = true, style, accessibilityLabel,
}) {
  const t = BUTTON_TONES[variant] || BUTTON_TONES.primary;
  const dims = size === 'sm'
    ? { pv: 9,  ph: 14, fs: 13,   icon: 15, r: radius.sm }
    : size === 'lg'
      ? { pv: 16, ph: 22, fs: 16, icon: 20, r: radius.md }
      : { pv: 13, ph: 18, fs: 15, icon: 17, r: radius.sm + 2 };
  const off = disabled || busy;

  return (
    <Press
      onPress={off ? undefined : onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={{ alignSelf: full ? 'stretch' : 'flex-start' }}
    >
      <View
        style={[
          styles.btn,
          {
            backgroundColor: t.bg,
            borderColor: t.border,
            borderWidth: t.border === 'transparent' ? 0 : 1,
            paddingVertical: dims.pv,
            paddingHorizontal: dims.ph,
            borderRadius: dims.r,
            opacity: off ? 0.45 : 1,
          },
          variant === 'primary' && !off ? shadow.rest : null,
          style,
        ]}
      >
        {busy
          ? <Spinner size={dims.icon} color={t.fg} track={variant === 'primary' ? 'rgba(255,255,255,0.32)' : colors.border} />
          : (icon ? <Icon name={icon} size={dims.icon} color={t.fg} /> : null)}
        <RNText numberOfLines={1} style={{ ...type.body, color: t.fg, fontWeight: '700', fontSize: dims.fs, letterSpacing: -0.1 }}>
          {title}
        </RNText>
        {iconRight ? <Icon name={iconRight} size={dims.icon} color={t.fg} /> : null}
      </View>
    </Press>
  );
}

export function IconButton({ name, onPress, tone = 'subtle', size = 40, color, disabled, label, badge }) {
  const t = tone === 'chrome'
    ? { bg: 'rgba(255,255,255,0.13)', fg: '#fff' }
    : tone === 'plain'
      ? { bg: 'transparent', fg: colors.muted }
      : tone === 'surface'
        ? { bg: colors.card, fg: colors.text }
        : { bg: colors.primarySoft, fg: colors.primary };
  return (
    <Press
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      <View style={{
        width: size, height: size, borderRadius: size * 0.3,
        backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={name} size={Math.round(size * 0.48)} color={color || t.fg} />
        {badge ? <View style={styles.dotBadge} /> : null}
      </View>
    </Press>
  );
}

// Floating action — the phone's "add one". On a desktop the same action is a
// button in the section header, so this only draws where it belongs.
export function Fab({ name = 'plus', label, onPress }) {
  const layout = useLayout();
  if (!layout.isPhone) return null;
  return (
    <Appear from="down" distance={16} delay={120}>
      <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.fabWrap}>
        <View style={[styles.fab, shadow.floating]}>
          <Icon name={name} size={22} color="#fff" />
          {label ? <RNText style={{ ...type.body, color: '#fff', fontWeight: '700' }}>{label}</RNText> : null}
        </View>
      </Press>
    </Appear>
  );
}

// ── inputs ──────────────────────────────────────────────────────────────────
export function Field({ label, value, onChangeText, hint, error, icon, right, style, inputStyle, ...rest }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ marginBottom: spacing.md }, style]}>
      {label ? (
        <RNText style={[type.small, { color: colors.textSoft, fontWeight: '600', marginBottom: 7 }]}>{label}</RNText>
      ) : null}
      <View style={[
        styles.inputWrap,
        focused && { borderColor: colors.primary, backgroundColor: '#fff', ...shadow.rest },
        error && { borderColor: colors.danger, backgroundColor: '#FFFAFA' },
      ]}>
        {icon ? <Icon name={icon} size={17} color={focused ? colors.primary : colors.faint} /> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholderTextColor={colors.muted}
          style={[styles.input, inputStyle]}
          {...rest}
        />
        {right || null}
      </View>
      {error
        ? <RNText style={[type.small, { color: colors.danger, marginTop: 5 }]}>{error}</RNText>
        : hint ? <Muted style={{ marginTop: 5 }}>{hint}</Muted> : null}
    </View>
  );
}

export function TextArea(props) {
  return (
    <Field
      {...props}
      multiline
      numberOfLines={props.numberOfLines || 4}
      inputStyle={[{ minHeight: (props.numberOfLines || 4) * 21, paddingTop: 10, textAlignVertical: 'top' }, props.inputStyle]}
    />
  );
}

/**
 * A choice, as a field that opens a panel.
 *
 * This used to be a wall of pills. It read acceptably with four options and
 * badly with eleven: the form lost its shape, every class in the school shouted
 * at the same volume, and on a phone the "Class" and "Subject" pickers together
 * pushed the actual work off the bottom of the screen.
 *
 * So a Select is now one closed row that states the current answer, and a panel
 * that opens over the page to change it. The panel is a bottom sheet on a phone
 * — the thumb is at the bottom of the phone, not the top — and a popover
 * anchored under the field on a tablet or a desktop, where there is a pointer
 * and the field has a fixed position on screen worth pointing back at.
 *
 * Inside the panel each option is a row, not a pill: a leading marker, the name
 * at reading weight, whatever qualifies it underneath in muted text, and a tick
 * on the one in force. Rows can be searched once there are more than eight of
 * them, and grouped when the options come with a `group`.
 *
 * Props are unchanged from the pill version, so every existing call site keeps
 * working; `columns` is accepted and ignored.
 */
export function Select({
  label, value, options, onChange, hint, error,
  empty = 'Nothing to choose from.',
  placeholder = 'Choose…',
  loading, loadingLabel = 'Loading…',
  title, icon, groups, searchable, disabled,
  columns, // accepted for compatibility with the pill version; no longer used
}) {
  const list = options || [];
  const layout = useLayout();
  const reduced = useReducedMotion();
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState(null);
  const t = useRef(new Animated.Value(0)).current;

  const selected = useMemo(
    () => list.find(o => String(o.value) === String(value)) || null,
    [list, value],
  );

  const groupList = useMemo(() => {
    if (groups && groups.length) return groups;
    const seen = [];
    for (const o of list) {
      if (o.group && !seen.some(g => g.value === o.group)) seen.push({ value: o.group, label: o.group });
    }
    return seen.length > 1 ? seen : [];
  }, [groups, list]);

  // The reference has no search box, and for a school it does not need one: a
  // basic school has eleven or twelve classes and the level tabs already cut
  // that to three or four. The box only appears for a list long enough that
  // scanning it is genuinely work — a roll of pupils, not a rack of classes.
  const showSearch = searchable != null ? searchable : list.length > 14;
  const showGroups = groupList.length > 1 && list.length > 6;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter(o => {
      if (group && o.group !== group) return false;
      if (!q) return true;
      return `${o.label || ''} ${o.note || ''}`.toLowerCase().includes(q);
    });
  }, [list, query, group]);

  const close = useCallback(() => setOpen(false), []);

  const openPanel = useCallback(() => {
    if (disabled || list.length === 0) return;
    setQuery('');
    const node = triggerRef.current;
    if (node && node.measureInWindow) {
      node.measureInWindow((x, y, width, height) => {
        setAnchor({ x, y, width, height });
        setOpen(true);
      });
    } else {
      setAnchor(null);
      setOpen(true);
    }
  }, [disabled, list.length]);

  React.useEffect(() => {
    if (!open) return undefined;
    t.setValue(reduced ? 1 : 0);
    const a = Animated.timing(t, {
      toValue: 1, duration: reduced ? 0 : motion.fast,
      easing: EASE_OUT, useNativeDriver: Platform.OS !== 'web',
    });
    a.start();
    return () => a.stop();
  }, [open, t, reduced]);

  // Escape closes it in a browser, as every other dropdown on the machine does.
  React.useEffect(() => {
    if (!open || Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  const choose = useCallback((o) => {
    setOpen(false);
    if (onChange) onChange(o.value);
  }, [onChange]);

  const emptied = list.length === 0;

  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? (
        <RNText style={[type.small, { color: colors.textSoft, fontWeight: '600', marginBottom: 7 }]}>{label}</RNText>
      ) : null}

      {loading ? (
        // The second half of a cascade, waiting on the first. The field keeps
        // its place in the form and says what it is doing, rather than being
        // absent and then shoving the rest of the screen down when it arrives.
        <View style={[styles.selectTrigger, styles.selectTriggerOff]}>
          <Spinner size={18} />
          <RNText numberOfLines={1} style={{ ...type.body, color: colors.muted, flex: 1 }}>{loadingLabel}</RNText>
        </View>
      ) : emptied ? (
        <View style={[styles.selectTrigger, styles.selectTriggerOff]}>
          <RNText numberOfLines={2} style={{ ...type.small, color: colors.muted, flex: 1 }}>{empty}</RNText>
        </View>
      ) : (
        <View ref={triggerRef} collapsable={false}>
          <Press onPress={openPanel} disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${label || title || 'Choose'}: ${selected ? selected.label : placeholder}`}
            accessibilityState={{ expanded: open, disabled: !!disabled }}>
            <View style={[
              styles.selectTrigger,
              open && styles.selectTriggerOpen,
              disabled && styles.selectTriggerOff,
            ]}>
              {icon ? (
                <View style={styles.selectIcon}>
                  <Icon name={icon} size={16} color={colors.primary} />
                </View>
              ) : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                <RNText numberOfLines={1} style={{
                  ...type.body, fontWeight: '700',
                  color: selected ? colors.text : colors.muted,
                }}>{selected ? selected.label : placeholder}</RNText>
                {selected && selected.note ? (
                  <RNText numberOfLines={1} style={{ ...type.small, color: colors.muted, marginTop: 1 }}>
                    {selected.note}
                  </RNText>
                ) : null}
              </View>
              <View style={[styles.selectCaret, open && { backgroundColor: colors.primarySoft }]}>
                <Icon name="chevron" size={14} color={open ? colors.primary : colors.textSoft}
                  style={{ transform: [{ rotate: open ? '270deg' : '90deg' }] }} />
              </View>
            </View>
          </Press>
        </View>
      )}

      {error
        ? <RNText style={[type.small, { color: colors.danger, marginTop: 5 }]}>{error}</RNText>
        : hint ? <Muted style={{ marginTop: 6 }}>{hint}</Muted> : null}

      {open ? (
        <SelectPanel
          t={t} layout={layout} anchor={anchor} onClose={close}
          title={title || label || 'Choose'}
          showSearch={showSearch} query={query} onQuery={setQuery}
          groups={showGroups ? groupList : null} group={group} onGroup={setGroup}
          options={shown} value={value} onChoose={choose}
        />
      ) : null}
    </View>
  );
}

/**
 * The panel itself, built to one reference: a folder-tab strip across the top,
 * and a white card of rows sitting under it.
 *
 * Two things it deliberately is not:
 *
 *   It is not a bottom sheet on a phone. It was, and rising from the bottom of
 *   the screen put the list as far as it is possible to get from the field you
 *   tapped — you press "Class" at the top of a form and the answer appears by
 *   your other thumb. It is anchored under the field on every screen size.
 *
 *   It is not held to a fixed height. It takes the room that is actually below
 *   the field, down to a margin off the bottom of the window. A list of eleven
 *   classes on a tall phone shows eleven classes; the same list on a short
 *   laptop scrolls. Capping it at 420px made every panel scroll on a screen
 *   with space to spare.
 */
function SelectPanel({
  t, layout, anchor, onClose, title,
  showSearch, query, onQuery, groups, group, onGroup,
  options, value, onChoose,
}) {
  // Where it sits: under the field if there is any room, above it when there
  // genuinely is not, and never past the edge of the window on either side.
  const frame = useMemo(() => {
    const gap = 6;
    const margin = spacing.md;
    if (!anchor) {
      return {
        left: margin, right: margin,
        top: Math.round(layout.height * 0.12),
        maxHeight: Math.round(layout.height * 0.7),
      };
    }
    // As wide as the field, so the open panel reads as the field expanding
    // rather than as a separate object that happens to be nearby. Clamped so a
    // full-width desktop form does not produce a menu the width of a cinema.
    const width = Math.min(
      Math.max(anchor.width, 260), 460,
      Math.max(240, layout.width - margin * 2),
    );
    const left = Math.min(
      Math.max(margin, anchor.x),
      Math.max(margin, layout.width - width - margin),
    );
    const below = layout.height - (anchor.y + anchor.height) - gap - margin;
    const above = anchor.y - gap - margin;
    const flip = below < 220 && above > below;
    return {
      left, width,
      top: flip ? undefined : anchor.y + anchor.height + gap,
      bottom: flip ? layout.height - anchor.y + gap : undefined,
      maxHeight: Math.max(180, flip ? above : below),
    };
  }, [anchor, layout.width, layout.height]);

  const tabs = groups ? [{ value: null, label: 'All' }, ...groups] : null;

  return (
    <RNModal transparent animationType="none" visible onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, {
        backgroundColor: 'rgba(14,11,36,0.10)', opacity: t,
      }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>

      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <Animated.View
          style={[
            { position: 'absolute' }, frame,
            {
              opacity: t,
              transform: [
                { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) },
                { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] }) },
              ],
            },
          ]}>

          {/* The strip. Folder tabs on a recessed ground: the one in force is a
              raised white tab with a rule under its label, the rest sit flat.
              With no groups to switch between it carries the title instead, so
              the panel always opens with the same shape at the top. */}
          <View style={styles.selectStrip}>
            {tabs ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                style={{ flexGrow: 0, flexShrink: 1 }}
                contentContainerStyle={{ alignItems: 'stretch' }}>
                {tabs.map(g => {
                  const on = (g.value || null) === (group || null);
                  return (
                    <Press key={String(g.value)} onPress={() => onGroup(g.value || null)}
                      accessibilityRole="tab" accessibilityState={{ selected: on }}>
                      <View style={[styles.selectTab, on && styles.selectTabOn]}>
                        <RNText numberOfLines={1} style={{
                          ...type.body, fontWeight: '700',
                          color: on ? colors.text : colors.textSoft,
                        }}>{g.label}</RNText>
                        <View style={[styles.selectTabRule, on && styles.selectTabRuleOn]} />
                      </View>
                    </Press>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={{ flex: 1, justifyContent: 'center', paddingLeft: spacing.md }}>
                <RNText numberOfLines={1} style={{ ...type.body, fontWeight: '700', color: colors.text }}>
                  {title}
                </RNText>
              </View>
            )}
            <Press onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <View style={styles.selectStripClose}>
                <Icon name="chevron" size={14} color={colors.textSoft}
                  style={{ transform: [{ rotate: '270deg' }] }} />
              </View>
            </Press>
          </View>

          {/* The card of rows, layered over the strip. */}
          <View style={[styles.selectCard, shadow.floating]}>
            {showSearch ? (
              <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.md }}>
                <SearchField value={query} onChangeText={onQuery} placeholder="Type to narrow the list…"
                  onClear={() => onQuery('')} />
              </View>
            ) : null}

            <ScrollView
              style={{ flexGrow: 0, flexShrink: 1 }}
              contentContainerStyle={{ paddingVertical: 6 }}
              keyboardShouldPersistTaps="handled">
              {options.length === 0 ? (
                <View style={{ padding: spacing.xl, alignItems: 'center' }}>
                  <Muted>Nothing here matches that.</Muted>
                </View>
              ) : options.map((o, i) => {
                const on = String(o.value) === String(value);
                return (
                  <Press key={`${String(o.value)}-${i}`} onPress={() => onChoose(o)}
                    accessibilityRole="radio" accessibilityState={{ selected: on }}>
                    <View style={styles.optionRow}>
                      <View style={[styles.optionMark, on && styles.optionMarkOn]}>
                        {o.icon
                          ? <Icon name={o.icon} size={17} color={on ? '#fff' : colors.primary} />
                          : (
                            <RNText numberOfLines={1} style={{
                              ...type.small, fontWeight: '800', fontSize: 12,
                              color: on ? '#fff' : colors.primary,
                            }}>{o.mark || initialsOf(o.label)}</RNText>
                          )}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <RNText numberOfLines={1} style={{
                          ...type.body, fontWeight: '700',
                          color: on ? colors.primary : colors.text,
                        }}>{o.label}</RNText>
                        {o.note ? (
                          <RNText numberOfLines={1} style={{ ...type.small, color: colors.muted, marginTop: 2 }}>
                            {o.note}
                          </RNText>
                        ) : null}
                      </View>
                      {o.meta ? (
                        <RNText numberOfLines={1} style={{ ...type.small, color: colors.muted }}>{o.meta}</RNText>
                      ) : null}
                      {on ? <Icon name="tick" size={18} color={colors.primary} /> : null}
                    </View>
                    {/* Inset rule: it starts where the text starts, so the run
                        of circles down the left edge is unbroken. */}
                    {i < options.length - 1 ? <View style={styles.optionRule} /> : null}
                  </Press>
                );
              })}
            </ScrollView>
          </View>
        </Animated.View>
      </View>
    </RNModal>
  );
}

// The fallback marker on an option row, used when the option carries no `mark`
// of its own. Word initials, plus a trailing number when the name ends in one:
// "Basic 4" → B4, "Nursery 1" → N1, "English Language" → EL, "Cash" → CA.
//
// It reads the FIRST letter of each word. Reading whatever letter happened to
// sit before the digit is how "Basic 1" once came out as "C1".
function initialsOf(label) {
  const s = String(label || '').trim();
  if (!s) return '—';
  const words = s.split(/\s+/).filter(Boolean);
  const tail = words.length > 1 && /^\d+$/.test(words[words.length - 1])
    ? words.pop()
    : null;
  const letters = words
    .map(w => (w.match(/[A-Za-z0-9]/) || [''])[0])
    .join('')
    .toUpperCase();
  if (tail) return `${letters.slice(0, 2)}${tail}`.slice(0, 3);
  if (letters.length > 1) return letters.slice(0, 2);
  return s.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '—';
}

export function SearchField({ value, onChangeText, placeholder = 'Search…', onClear }) {
  return (
    <View style={styles.search}>
      <Icon name="search" size={17} color={colors.faint} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={[styles.input, { paddingVertical: Platform.OS === 'web' ? 11 : 9 }]}
        returnKeyType="search"
        accessibilityLabel={placeholder}
      />
      {value ? (
        <IconButton name="close" size={26} tone="plain" color={colors.muted}
          onPress={() => (onClear ? onClear() : onChangeText(''))} label="Clear search" />
      ) : null}
    </View>
  );
}

export function DateField({ label, value, onChange, hint }) {
  return (
    <Field
      label={label} value={value} onChangeText={onChange}
      placeholder="YYYY-MM-DD" keyboardType={Platform.OS === 'web' ? 'default' : 'numbers-and-punctuation'}
      icon="calendar" hint={hint} maxLength={10}
    />
  );
}

// ── rows, lists and tables ──────────────────────────────────────────────────
export function Row({ left, right, onPress, style }) {
  const body = (
    <View style={[styles.row, style]}>
      <View style={{ flex: 1, minWidth: 0 }}>{left}</View>
      <View style={{ alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
  return onPress ? <Press onPress={onPress}>{body}</Press> : body;
}

/**
 * The workhorse row: a mark on the left, a name and a line of detail, and
 * whatever the row is worth on the right. A face beats an icon wherever there
 * is one — a teacher scanning a roll recognises the photograph long before the
 * name.
 */
export function ListRow({ title, subtitle, meta, icon, iconTone, right, onPress, badge, avatar, style, last }) {
  const body = (
    <View style={[styles.listRow, !last && styles.listRowDivider, style]}>
      {avatar || (icon ? <IconTile name={icon} tone={iconTone} size={38} /> : null)}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <RNText numberOfLines={2} style={{ ...type.body, fontWeight: '700', color: colors.text, flexShrink: 1 }}>{title}</RNText>
          {badge ? <View style={{ flexShrink: 0 }}>{badge}</View> : null}
        </View>
        {subtitle ? <Muted numberOfLines={1} style={{ marginTop: 2 }}>{subtitle}</Muted> : null}
        {meta ? <View style={{ marginTop: 6 }}>{meta}</View> : null}
      </View>
      {right ? <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>{right}</View> : null}
      {onPress ? <Icon name="chevron" size={16} color={colors.faint} /> : null}
    </View>
  );
  return onPress ? <Press onPress={onPress} accessibilityRole="button">{body}</Press> : body;
}

/**
 * A settings-style row: tinted icon, label, chevron. Distinct from ListRow —
 * this one is navigation, so it has no subtitle, no figure, and a fixed height
 * that makes a column of them scan as a menu rather than as data.
 */
export function MenuRow({ icon, label, iconTone = 'primary', onPress, right, danger, last, hint }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.menuRow, !last && styles.listRowDivider]}>
        <IconTile name={icon} tone={danger ? 'danger' : iconTone} size={34} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <RNText numberOfLines={1} style={{
            ...type.body, fontWeight: '600',
            color: danger ? colors.danger : colors.text,
          }}>{label}</RNText>
          {hint ? <Muted numberOfLines={1} style={{ marginTop: 1 }}>{hint}</Muted> : null}
        </View>
        {right || null}
        {onPress && !danger ? <Icon name="chevron" size={15} color={colors.faint} /> : null}
      </View>
    </Press>
  );
}

export function Divider({ style }) { return <View style={[styles.divider, style]} />; }

/**
 * A table where there is room for one, and stacked rows where there is not.
 * A broadsheet of thirteen subjects has to be readable on a handset, and a
 * table squeezed to 360px is not it.
 */
export function DataTable({ columns, rows, keyExtractor, onRowPress, empty = 'Nothing to show.', dense }) {
  const layout = useLayout();
  const key = keyExtractor || ((r, i) => String(r.id ?? i));

  if (!rows || rows.length === 0) {
    return <View style={{ paddingVertical: spacing.lg }}><Muted>{empty}</Muted></View>;
  }

  if (!layout.canTable) {
    return (
      <AppearList style={{ gap: 8 }}>
        {rows.map((r, i) => {
          const body = (
            <View style={styles.stackCard}>
              {columns.map(c => {
                const v = c.render ? c.render(r) : r[c.key];
                if (v == null || v === '') return null;
                return (
                  <View key={c.key} style={styles.stackLine}>
                    <Micro style={{ flexShrink: 0 }}>{c.label}</Micro>
                    <View style={{ flex: 1, alignItems: 'flex-end' }}>
                      {typeof v === 'string' || typeof v === 'number'
                        ? <RNText numberOfLines={2} style={{ ...type.small, fontWeight: '600', color: colors.text, textAlign: 'right' }}>{v}</RNText>
                        : v}
                    </View>
                  </View>
                );
              })}
            </View>
          );
          return onRowPress
            ? <Press key={key(r, i)} onPress={() => onRowPress(r)}>{body}</Press>
            : <View key={key(r, i)}>{body}</View>;
        })}
      </AppearList>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minWidth: '100%' }}>
      <View style={{ flex: 1, minWidth: '100%' }}>
        <View style={styles.tableHead}>
          {columns.map(c => (
            <View key={c.key} style={{ width: c.width, flex: c.width ? undefined : 1, alignItems: align(c.align) }}>
              <Micro>{c.label}</Micro>
            </View>
          ))}
        </View>
        {rows.map((r, i) => {
          const body = (
            <View style={[styles.tableRow, dense && { paddingVertical: 8 }]}>
              {columns.map(c => (
                <View key={c.key} style={{ width: c.width, flex: c.width ? undefined : 1, alignItems: align(c.align) }}>
                  {c.render
                    ? c.render(r)
                    : <RNText numberOfLines={1} style={{ ...type.small, color: colors.textSoft, fontWeight: '500' }}>{r[c.key] ?? '—'}</RNText>}
                </View>
              ))}
            </View>
          );
          return onRowPress
            ? <Press key={key(r, i)} onPress={() => onRowPress(r)}>{body}</Press>
            : <View key={key(r, i)}>{body}</View>;
        })}
      </View>
    </ScrollView>
  );
}

const align = (a) => (a === 'right' ? 'flex-end' : a === 'center' ? 'center' : 'flex-start');

// ── figures ─────────────────────────────────────────────────────────────────
export function StatCard({ label, value, tone, icon, note, onPress, style }) {
  const fg = tone === 'success' ? colors.success
    : tone === 'danger' ? colors.danger
    : tone === 'warning' ? colors.warning
    : tone === 'data' ? colors.data
    : colors.text;
  const body = (
    <View style={[styles.stat, shadow.rest, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Micro numberOfLines={1} style={{ flexShrink: 1 }}>{label}</Micro>
        {icon ? <Icon name={icon} size={16} color={colors.faint} /> : null}
      </View>
      <RNText
        numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
        style={{ ...type.numeric, fontSize: figureSize(value), color: fg, marginTop: 9 }}
      >{value}</RNText>
      {note ? <Muted numberOfLines={2} style={{ marginTop: 3 }}>{note}</Muted> : null}
    </View>
  );
  return onPress
    ? <Press onPress={onPress} accessibilityRole="button" style={{ flexGrow: 1 }}>{body}</Press>
    : body;
}

/**
 * Lays cards out in the number of columns the window can take.
 *
 * The width is measured rather than expressed as a percentage. A percentage
 * basis of 25% for four columns plus three 12px gaps comes to more than the
 * container, so the fourth card wrapped onto its own line and every four-card
 * row in the app rendered as three-and-one.
 */
export function Grid({ children, min = 168, gap = spacing.md, columns, stagger = true }) {
  const layout = useLayout();
  const [width, setWidth] = useState(0);
  const items = React.Children.toArray(children).filter(Boolean);
  const wanted = columns || layout.columns;

  const fit = width > 0 ? Math.max(1, Math.floor((width + gap) / (min + gap))) : wanted;
  const cols = Math.max(1, Math.min(wanted, fit, items.length || 1));
  const basis = width > 0 ? (width - gap * (cols - 1)) / cols : undefined;

  return (
    <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {items.map((child, i) => {
        const cell = (
          <View
            key={i}
            style={basis
              ? { width: basis, flexGrow: 0, flexShrink: 0 }
              : { flexGrow: 1, flexBasis: `${Math.floor(1000 / cols) / 10}%`, minWidth: min }}
          >
            {child}
          </View>
        );
        return stagger
          ? <Appear key={i} delay={Math.min(i, motion.staggerMax) * motion.stagger} distance={8}
              style={basis ? { width: basis } : { flexGrow: 1, flexBasis: `${Math.floor(1000 / cols) / 10}%`, minWidth: min }}>
              {child}
            </Appear>
          : cell;
      })}
    </View>
  );
}

export function ProgressBar({ value, max = 100, tone = 'primary', height = 9, label }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  const w = useEased(pct);
  const fill = tone === 'success' ? colors.success : tone === 'danger' ? colors.danger
    : tone === 'warning' ? colors.warning : colors.primary;
  return (
    <View>
      {label ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
          <Muted numberOfLines={1} style={{ flexShrink: 1 }}>{label}</Muted>
          <RNText style={{ ...type.small, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] }}>{Math.round(pct)}%</RNText>
        </View>
      ) : null}
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
        style={{ height, borderRadius: height, backgroundColor: colors.borderSoft, overflow: 'hidden' }}
      >
        <Animated.View style={{
          width: w.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
          height: '100%', borderRadius: height, backgroundColor: fill,
        }} />
      </View>
    </View>
  );
}

/**
 * A proportion as a ring, for the one figure a screen is really about.
 *
 * Drawn as a dial of segments rather than as two clipped half-discs. The
 * half-disc trick is the usual way to do this without SVG and it needs
 * `transformOrigin`, which the React Native version this app ships does not
 * support — the first build of this component rendered a full ring at 0%,
 * which is the worst possible failure for a progress indicator. Segments have
 * no such trap: each one is a bar placed by trigonometry, so what you compute
 * is exactly what is drawn, on a handset and in a browser alike.
 */
export function ProgressRing({ value = 0, size = 76, thickness = 8, tone = 'primary', label, segments = 44 }) {
  const reduced = useReducedMotion();
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const fill = tone === 'success' ? colors.success : tone === 'danger' ? colors.danger
    : tone === 'warning' ? colors.warning : tone === 'chrome' ? '#fff' : colors.primary;
  const track = tone === 'chrome' ? 'rgba(255,255,255,0.24)' : colors.borderSoft;

  // Sweeps up to its value once, so the figure lands rather than appears.
  const [shown, setShown] = useState(reduced ? pct : 0);
  const raf = useRef(null);
  React.useEffect(() => {
    if (reduced) { setShown(pct); return undefined; }
    const from = shown; const t0 = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / motion.slow);
      setShown(from + (pct - from) * (1 - Math.pow(1 - p, 4)));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
    // `shown` is read once as a starting point, deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct, reduced]);

  const lit = Math.round((shown / 100) * segments);
  const r = (size - thickness) / 2;
  const len = Math.max(4, thickness * 1.05);

  return (
    <View
      style={{ width: size, height: size }}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
    >
      {Array.from({ length: segments }).map((_, i) => {
        // Twelve o'clock is 0 and it runs clockwise, the way a person reads a
        // dial rather than the way trigonometry numbers one.
        const a = (i / segments) * Math.PI * 2 - Math.PI / 2;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: size / 2 + Math.cos(a) * r - len / 2,
              top: size / 2 + Math.sin(a) * r - thickness / 2,
              width: len, height: thickness, borderRadius: thickness / 2,
              backgroundColor: i < lit ? fill : track,
              transform: [{ rotateZ: `${(a * 180) / Math.PI + 90}deg` }],
            }}
          />
        );
      })}
      <View style={{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' }}>
        <RNText style={{
          ...type.body, fontWeight: '800', fontSize: Math.round(size * 0.25),
          color: tone === 'chrome' ? '#fff' : colors.text, fontVariant: ['tabular-nums'],
        }}>{Math.round(shown)}%</RNText>
        {label ? (
          <RNText numberOfLines={1} style={{
            ...type.small, fontSize: 9.5,
            color: tone === 'chrome' ? 'rgba(255,255,255,0.72)' : colors.muted,
          }}>{label}</RNText>
        ) : null}
      </View>
    </View>
  );
}

// ── labels ──────────────────────────────────────────────────────────────────
const BADGE_TONES = {
  neutral: { bg: colors.borderSoft,  fg: colors.muted },
  primary: { bg: colors.primarySoft, fg: colors.primary },
  success: { bg: palette.green100,   fg: palette.green700 },
  danger:  { bg: palette.red100,     fg: palette.red700 },
  warning: { bg: palette.amber100,   fg: palette.amber700 },
  info:    { bg: colors.primarySoft, fg: colors.primary },
  gold:    { bg: palette.gold100,    fg: palette.gold700 },
  data:    { bg: palette.teal100,    fg: palette.teal700 },
  pink:    { bg: palette.pink100,    fg: palette.pink600 },
  chrome:  { bg: 'rgba(255,255,255,0.16)', fg: '#fff' },
};

export function Badge({ label, tone = 'neutral', icon, style }) {
  const t = BADGE_TONES[tone] || BADGE_TONES.neutral;
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }, style]}>
      {icon ? <Icon name={icon} size={11} color={t.fg} /> : null}
      <RNText numberOfLines={1} style={{ ...type.small, fontSize: 11, color: t.fg, fontWeight: '700', letterSpacing: 0.1 }}>{label}</RNText>
    </View>
  );
}

// Work a teacher has done that has not reached the school's computer yet. It
// gets its own mark everywhere it appears, because "saved" and "saved here,
// waiting" are not the same promise.
export function PendingBadge({ label = 'Waiting to sync' }) {
  return <Badge tone="data" icon="refresh" label={label} />;
}

/**
 * Two to four mutually exclusive views, with the selection sliding rather than
 * jumping. Above four, use `Tabs` — this one divides its width evenly and at
 * five options nothing is readable.
 */
export function SegmentedControl({ value, options, onChange, style }) {
  const [w, setW] = useState(0);
  const idx = Math.max(0, options.findIndex(o => String(o.value) === String(value)));
  const x = useEased(idx);
  const cell = options.length ? (w - 8) / options.length : 0;

  return (
    <View style={[styles.segment, style]} onLayout={e => setW(e.nativeEvent.layout.width)}>
      {cell > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.segmentThumb, shadow.rest, {
            width: cell,
            transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, cell] }) }],
          }]}
        />
      ) : null}
      {options.map(o => {
        const on = String(o.value) === String(value);
        return (
          <Pressable
            key={String(o.value)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)} style={styles.segmentItem}
          >
            {o.icon ? <Icon name={o.icon} size={15} color={on ? colors.primary : colors.muted} /> : null}
            <RNText numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: on ? colors.primary : colors.muted }}>
              {o.label}
            </RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Many views. Scrolls instead of squeezing — a child's record has eight
 * sections and a segmented control at eight is unreadable.
 */
export function Tabs({ value, options, onChange, style }) {
  return (
    <ScrollView
      horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={[{ gap: 7, paddingVertical: 2 }, style]}
    >
      {options.map(o => {
        const on = String(o.value) === String(value);
        return (
          <Press key={String(o.value)} onPress={() => onChange(o.value)}
            accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <View style={[styles.tab, on && styles.tabOn]}>
              {o.icon ? <Icon name={o.icon} size={15} color={on ? '#fff' : colors.muted} /> : null}
              <RNText numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: on ? '#fff' : colors.textSoft }}>
                {o.label}
              </RNText>
              {o.count != null && o.count !== 0 ? (
                <View style={[styles.tabCount, on && { backgroundColor: 'rgba(255,255,255,0.26)' }]}>
                  <RNText style={{ ...type.small, fontSize: 10.5, fontWeight: '800', color: on ? '#fff' : colors.primary }}>{o.count}</RNText>
                </View>
              ) : null}
            </View>
          </Press>
        );
      })}
    </ScrollView>
  );
}

// The pager dots under an onboarding slide. The active one is a stadium, not a
// bigger circle — it reads as "you are here" rather than as a different dot.
export function Dots({ count, index, tone = 'primary' }) {
  const on = tone === 'chrome' ? '#fff' : colors.primary;
  const off = tone === 'chrome' ? 'rgba(255,255,255,0.34)' : colors.primaryLine;
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }} accessibilityLabel={`Step ${index + 1} of ${count}`}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{
          height: 7, width: i === index ? 22 : 7, borderRadius: 7,
          backgroundColor: i === index ? on : off,
        }} />
      ))}
    </View>
  );
}

// ── selection ───────────────────────────────────────────────────────────────
// A tick box that is a real target: the whole row is pressable, not a 16px
// square a teacher has to aim at while forty children file past.
export function CheckRow({ checked, onToggle, title, subtitle, right, avatar, disabled, tone }) {
  return (
    <Press
      onPress={disabled ? undefined : onToggle} disabled={disabled}
      accessibilityRole="checkbox" accessibilityState={{ checked: !!checked, disabled: !!disabled }}
    >
      <View style={[styles.checkRow, checked && styles.checkRowOn, disabled && { opacity: 0.5 }]}>
        <View style={[styles.box, checked && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
          {checked ? <Icon name="tick" size={13} color="#fff" /> : null}
        </View>
        {avatar || null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <RNText numberOfLines={1} style={{ ...type.body, fontWeight: '700', color: colors.text }}>{title}</RNText>
          {subtitle ? <Muted numberOfLines={1}>{subtitle}</Muted> : null}
        </View>
        {right || null}
      </View>
    </Press>
  );
}

/** One of several mutually exclusive options, as a bordered row with a radio. */
export function ChoiceRow({ selected, onSelect, title, subtitle, right, badge, disabled }) {
  return (
    <Press onPress={disabled ? undefined : onSelect} disabled={disabled}
      accessibilityRole="radio" accessibilityState={{ selected: !!selected, disabled: !!disabled }}>
      <View style={[styles.choiceRow, selected && styles.choiceRowOn, disabled && { opacity: 0.5 }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <RNText numberOfLines={1} style={{ ...type.body, fontWeight: '700', color: colors.text, flexShrink: 1 }}>{title}</RNText>
            {badge || null}
          </View>
          {subtitle ? <Muted numberOfLines={2} style={{ marginTop: 2 }}>{subtitle}</Muted> : null}
        </View>
        {right || null}
        <View style={[styles.radio, selected && { borderColor: colors.primary }]}>
          {selected ? <View style={styles.radioDot} /> : null}
        </View>
      </View>
    </Press>
  );
}

// ── people ──────────────────────────────────────────────────────────────────
/**
 * A face where there is one, initials where there is not. The `photo` prop was
 * on this component from the first version and never read: every pupil and
 * every teacher in the app was two letters in a circle while their photograph
 * sat on the school's hard disk. A photograph that fails to decode falls back
 * to the initials rather than to an empty hole.
 */
export function Avatar({ name, photo, size = 40, tone = 'primary', ring, square }) {
  const [broken, setBroken] = useState(false);
  const initials = useMemo(() => String(name || '?')
    .split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?', [name]);
  const bg = tone === 'chrome' ? 'rgba(255,255,255,0.18)' : colors.primarySoft;
  const fg = tone === 'chrome' ? '#fff' : colors.primary;
  const show = photo && !broken;
  return (
    <View style={{
      width: size, height: size, borderRadius: square ? size * 0.28 : size / 2,
      backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', flexShrink: 0,
      ...(ring ? {
        borderWidth: Math.max(2, Math.round(size * 0.045)),
        borderColor: tone === 'chrome' ? 'rgba(255,255,255,0.34)' : colors.card,
      } : null),
    }}>
      {show ? (
        <Image
          source={{ uri: photo }} onError={() => setBroken(true)}
          accessibilityLabel={name ? `Photograph of ${name}` : 'Photograph'}
          style={{ width: '100%', height: '100%' }} resizeMode="cover"
        />
      ) : (
        <RNText style={{ ...type.body, color: fg, fontWeight: '800', fontSize: Math.round(size * 0.36) }}>{initials}</RNText>
      )}
    </View>
  );
}

/**
 * The school's crest. Falls back to the app's own mark, so a school that has
 * never uploaded one gets something deliberate rather than a gap.
 */
// `tone` used to default to 'chrome' — a near-transparent white tile with a
// pale violet mark on it, which was right when this only ever sat on a dark
// header. There is no dark header any more, and the default rendered as an
// invisible white square on the sign-in page of a school with no crest set.
export function Crest({ logo, size = 40, tone = 'light', rounded = true }) {
  const [broken, setBroken] = useState(false);
  const ok = logo && !broken;
  const bg = ok
    ? '#fff'
    : tone === 'chrome' ? 'rgba(255,255,255,0.13)' : colors.primarySoft;
  const fg = tone === 'chrome' ? palette.violet300 : colors.primary;
  return (
    <View style={{
      width: size, height: size, borderRadius: rounded ? size * 0.28 : 0,
      backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', padding: ok ? size * 0.08 : 0, flexShrink: 0,
    }}>
      {ok ? (
        <Image source={{ uri: logo }} onError={() => setBroken(true)} accessibilityLabel="School crest"
          style={{ width: '100%', height: '100%' }} resizeMode="contain" />
      ) : (
        <Icon name="school" size={Math.round(size * 0.55)} color={fg} />
      )}
    </View>
  );
}

// ── states ──────────────────────────────────────────────────────────────────
/**
 * The spinner. A ring in the hairline colour with one arc in violet, turning
 * once every three-quarters of a second — fast enough to read as working,
 * slow enough not to buzz.
 *
 * It is drawn from a border rather than an SVG or a platform indicator, so it
 * is the same object on the phone and in the browser and costs nothing to
 * render. The platform `ActivityIndicator` was the previous answer and it is
 * grey, differently shaped on each OS, and belongs to no design system.
 *
 * Under `prefers-reduced-motion` it stops turning and shows the ring at rest;
 * the label beside it is doing the talking by then anyway.
 */
export function Spinner({ size = 22, color = colors.primary, track = colors.primaryLine, style }) {
  const reduced = useReducedMotion();
  const spin = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (reduced) return undefined;
    spin.setValue(0);
    const loop = Animated.loop(Animated.timing(spin, {
      toValue: 1, duration: 760, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web',
    }));
    loop.start();
    return () => loop.stop();
  }, [spin, reduced]);

  const bw = Math.max(2, Math.round(size * 0.115));
  return (
    <Animated.View
      accessibilityRole="progressbar"
      style={[{
        width: size, height: size, borderRadius: size / 2,
        borderWidth: bw, borderColor: track, borderTopColor: color, borderRightColor: color,
        transform: reduced ? undefined : [{
          rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
        }],
      }, style]}
    />
  );
}

/**
 * Three dots that rise in sequence. Used where a spinner would be too loud —
 * beside a line of text, inside a row that is refreshing itself in place.
 */
export function LoadingDots({ size = 6, color = colors.primary, style }) {
  const reduced = useReducedMotion();
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  React.useEffect(() => {
    if (reduced) return undefined;
    const runs = dots.map((d, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 140),
      Animated.timing(d, { toValue: 1, duration: 320, easing: EASE_OUT, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(d, { toValue: 0, duration: 320, easing: EASE_OUT, useNativeDriver: Platform.OS !== 'web' }),
      Animated.delay((2 - i) * 140),
    ])));
    runs.forEach(r => r.start());
    return () => runs.forEach(r => r.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading"
      style={[{ flexDirection: 'row', alignItems: 'center', gap: size * 0.7 }, style]}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={{
          width: size, height: size, borderRadius: size / 2, backgroundColor: color,
          opacity: reduced ? 0.5 : d.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
          transform: reduced ? undefined : [{
            translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.7] }),
          }],
        }} />
      ))}
    </View>
  );
}

/**
 * The whole-screen wait. It fades in over 180ms rather than appearing at once,
 * so a request that comes back in 80ms — which on the school's own Wi-Fi most
 * of them do — never flashes a spinner at the reader.
 */
export function Loading({ label, size = 30 }) {
  return (
    <Appear>
      <View style={styles.center}>
        <Spinner size={size} />
        {label ? <Muted style={{ marginTop: spacing.md }}>{label}</Muted> : null}
      </View>
    </Appear>
  );
}

/**
 * Shown while a list loads, in the shape the list will take. A spinner tells a
 * teacher on a slow phone nothing about what is coming. It breathes rather than
 * sweeps: a shimmer that travels is a second thing moving on a screen that is
 * already waiting.
 */
export function Skeleton({ rows = 4, height = 56 }) {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 720, easing: EASE_OUT, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 0, duration: 720, easing: EASE_OUT, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);

  // Each row breathes a beat behind the one above it. One block blinking reads
  // as a broken screen; a run of rows offset by a fraction reads as a list on
  // its way. The offset is capped so a twenty-row skeleton does not end up
  // with a row that is out of phase with every other.
  return (
    <View style={{ gap: 10 }} accessibilityRole="progressbar" accessibilityLabel="Loading">
      {Array.from({ length: rows }).map((_, i) => {
        const phase = (i % 4) * 0.14;
        const opacity = reduced ? 1 : pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [0.48 + phase, 0.94 + phase * 0.06],
        });
        return (
          <Animated.View key={i} style={{
            height, borderRadius: radius.sm, backgroundColor: colors.borderSoft, opacity,
          }} />
        );
      })}
    </View>
  );
}

export function EmptyState({ icon = 'note', title, message, action }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xl, gap: 7 }}>
      <IconTile name={icon} size={56} tone="primary" />
      {title ? <Heading style={{ marginTop: 6, textAlign: 'center' }}>{title}</Heading> : null}
      {message ? <Muted style={{ textAlign: 'center', maxWidth: 380 }}>{message}</Muted> : null}
      {action ? <View style={{ marginTop: 10 }}>{action}</View> : null}
    </View>
  );
}

/**
 * A small tinted line saying what just happened.
 *
 * Two rules about where one of these goes, both learned the hard way:
 *
 *   It belongs beside the thing it is about. These used to be rendered at the
 *   top of the screen — so a teacher pressing Save at the bottom of a register
 *   of forty pupils got "Saved" somewhere above the fold, out of sight, and
 *   pressed Save again. Put it against the button, the field or the card that
 *   caused it.
 *
 *   It is small. A full-width slab with a paragraph in it reads as a warning
 *   about the app; a short line with a round icon reads as an answer to what
 *   you just did.
 */
function Note({ message, tone, icon, style }) {
  if (!message) return null;
  const t = BADGE_TONES[tone] || BADGE_TONES.neutral;
  return (
    <Appear distance={5}>
      <View
        style={[styles.note, { backgroundColor: t.bg }, style]}
        accessibilityRole={tone === 'danger' ? 'alert' : 'text'}
        accessibilityLiveRegion={tone === 'danger' ? 'assertive' : 'polite'}
      >
        <View style={[styles.noteDot, { backgroundColor: t.fg }]}>
          <Icon name={icon} size={11} color={t.bg} />
        </View>
        <RNText style={{ ...type.small, color: t.fg, flex: 1, fontWeight: '600', lineHeight: 18 }}>{message}</RNText>
      </View>
    </Appear>
  );
}

export function ErrorNote({ message, style }) { return <Note message={message} tone="danger" icon="alert" style={style} />; }
export function InfoNote({ message, style }) { return <Note message={message} tone="primary" icon="note" style={style} />; }
export function SuccessNote({ message, style }) { return <Note message={message} tone="success" icon="tick" style={style} />; }
export function WarningNote({ message, style }) { return <Note message={message} tone="warning" icon="alert" style={style} />; }

/**
 * The pair of them, for the common case: a screen holds one `error` and one
 * `success` and wants whichever is set shown next to the action.
 *
 * A success clears itself after a few seconds — it has been read by then, and
 * "Saved" still sitting there five minutes later makes the reader wonder
 * whether it means the last save or this one. An error stays until something
 * is done about it.
 */
export function Flash({ error, success, info, warning, onClear, style }) {
  React.useEffect(() => {
    if (!success || !onClear) return undefined;
    const id = setTimeout(onClear, 4200);
    return () => clearTimeout(id);
  }, [success, onClear]);

  if (error) return <ErrorNote message={error} style={style} />;
  if (success) return <SuccessNote message={success} style={style} />;
  if (warning) return <WarningNote message={warning} style={style} />;
  if (info) return <InfoNote message={info} style={style} />;
  return null;
}

// ── modal ───────────────────────────────────────────────────────────────────
// A centred panel on a desktop, a sheet rising from the bottom on a phone —
// the same component, because the content is identical and only the gesture
// people expect differs.
export function Sheet({ visible, onClose, title, children, footer, width = 560 }) {
  const layout = useLayout();
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!visible) return undefined;
    t.setValue(reduced ? 1 : 0);
    const a = Animated.timing(t, {
      toValue: 1, duration: reduced ? 0 : motion.medium,
      easing: require('./motion').EASE_OUT, useNativeDriver: Platform.OS !== 'web',
    });
    a.start(); return () => a.stop();
  }, [visible, t, reduced]);

  if (!visible) return null;
  const rise = layout.isPhone ? 40 : 14;

  return (
    <RNModal transparent animationType="none" visible onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(14,11,36,0.46)', opacity: t }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <View pointerEvents="box-none" style={[
        StyleSheet.absoluteFill,
        { justifyContent: layout.isPhone ? 'flex-end' : 'center', alignItems: 'center', padding: layout.isPhone ? 0 : spacing.xl },
      ]}>
        <Animated.View style={[
          styles.sheet, shadow.floating,
          { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) }] },
          layout.isPhone
            ? { width: '100%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, maxHeight: '90%' }
            : { width: '100%', maxWidth: width, maxHeight: '86%' },
        ]}>
          {layout.isPhone ? <View style={styles.grabber} /> : null}
          <View style={styles.sheetHead}>
            <Heading style={{ flex: 1 }} numberOfLines={2}>{title}</Heading>
            <IconButton name="close" size={34} tone="plain" color={colors.muted} onPress={onClose} label="Close" />
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={styles.sheetFoot}>{footer}</View> : null}
        </Animated.View>
      </View>
    </RNModal>
  );
}

// ── the school, at the top of a screen ──────────────────────────────────────
export function Hero({ crest, eyebrow, title, subtitle, right, tone = 'brand', children }) {
  const layout = useLayout();
  return (
    <Appear distance={12}>
      <Gradient colors={gradients[tone] || gradients.brand} angle={128} style={[styles.hero, shadow.raised]}>
        <View pointerEvents="none" style={styles.heroGlow} />
        <View style={{
          flexDirection: layout.isPhone ? 'column' : 'row',
          alignItems: layout.isPhone ? 'flex-start' : 'center', gap: spacing.lg,
        }}>
          {crest ? <View>{crest}</View> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            {eyebrow ? (
              <RNText numberOfLines={1} style={{ ...type.micro, color: 'rgba(255,255,255,0.72)' }}>
                {String(eyebrow).toUpperCase()}
              </RNText>
            ) : null}
            <RNText numberOfLines={2} style={{
              ...type.title, color: '#fff', fontSize: layout.isPhone ? 23 : 29, marginTop: 4,
            }}>{title}</RNText>
            {subtitle ? (
              <RNText style={{ ...type.small, color: 'rgba(255,255,255,0.78)', fontWeight: '600', marginTop: 5 }}>
                {subtitle}
              </RNText>
            ) : null}
          </View>
          {right || null}
        </View>
        {children ? <View style={{ marginTop: spacing.lg }}>{children}</View> : null}
      </Gradient>
    </Appear>
  );
}

// A figure carved out of a hero — white on violet, so it belongs to the header
// rather than sitting on it.
export function HeroStat({ label, value, tone = 'light', note }) {
  return (
    <View style={styles.heroStat}>
      <RNText style={{ ...type.micro, color: 'rgba(255,255,255,0.66)' }}>{String(label).toUpperCase()}</RNText>
      <RNText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={{
        ...type.body, color: tone === 'danger' ? palette.gold400 : '#fff',
        fontSize: figureSize(value, 19), fontWeight: '800', marginTop: 3, fontVariant: ['tabular-nums'],
      }}>{value}</RNText>
      {note ? <RNText style={{ ...type.small, fontSize: 11.5, color: 'rgba(255,255,255,0.64)', marginTop: 1 }}>{note}</RNText> : null}
    </View>
  );
}

export function Toolbar({ children, style }) {
  return <View style={[{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }, style]}>{children}</View>;
}

// ── key/value ───────────────────────────────────────────────────────────────
export function KeyValue({ items, columns }) {
  const layout = useLayout();
  const cols = columns || (layout.isPhone ? 2 : 3);
  const rows = (items || []).filter(i => i && i.value != null && i.value !== '');
  if (!rows.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
      {rows.map((i, n) => (
        <View key={n} style={{ flexGrow: 1, flexBasis: `${Math.floor(100 / cols) - 2}%`, minWidth: 128 }}>
          <Micro>{i.label}</Micro>
          <RNText style={{ ...type.body, color: colors.text, fontWeight: '600', marginTop: 3 }}>{i.value}</RNText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenScroll: { flex: 1 },
  screenBody: { flexGrow: 1 },

  card: {
    backgroundColor: colors.card, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  cardPad: { padding: spacing.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },

  btn: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, minHeight: 40 },
  fabWrap: { position: 'absolute', right: spacing.lg, bottom: spacing.lg + 6 },
  fab: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: 15, paddingHorizontal: 19,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  dotBadge: {
    position: 'absolute', top: 7, right: 7, width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.danger, borderWidth: 1.5, borderColor: colors.card,
  },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    backgroundColor: colors.surfaceAlt, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: 13, minHeight: 46,
  },
  input: {
    flex: 1, paddingVertical: Platform.OS === 'web' ? 12 : 10,
    fontSize: 15, fontWeight: '500', color: colors.text, fontFamily,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    backgroundColor: colors.surfaceAlt, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: 15, minHeight: 46,
  },
  // ── the dropdown: a closed field, and the panel it opens ──────────────────
  selectTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    minHeight: 52, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.sm, backgroundColor: colors.card,
    borderWidth: 1.5, borderColor: colors.border,
  },
  selectTriggerOpen: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  selectTriggerOff: { backgroundColor: colors.surfaceAlt, opacity: 0.75 },
  selectIcon: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  selectCaret: {
    width: 26, height: 26, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  // The strip across the top: a recessed ground carrying folder tabs. The tab
  // in force is raised — white, square-shouldered at the bottom so it joins the
  // card below it — and carries a rule under its label.
  selectStrip: {
    flexDirection: 'row', alignItems: 'stretch',
    backgroundColor: colors.surfaceAlt,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border,
    minHeight: 52, paddingTop: 4, paddingHorizontal: 4, overflow: 'hidden',
  },
  selectTab: {
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 18, paddingTop: 10, minHeight: 48,
    borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm,
  },
  selectTabOn: { backgroundColor: colors.card },
  selectTabRule: { height: 3, borderRadius: 2, alignSelf: 'stretch', marginTop: 7, backgroundColor: 'transparent' },
  selectTabRuleOn: { backgroundColor: colors.primary },
  selectStripClose: {
    width: 44, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch',
  },
  // The card of rows, joined to the strip above it.
  selectCard: {
    backgroundColor: colors.card,
    borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    flexShrink: 1,
  },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    minHeight: 64, paddingVertical: 10, paddingHorizontal: spacing.md,
  },
  // Round, as the reference has them. A circle beside a name reads as a person
  // or a place; a rounded square reads as another button on a screen that
  // already has enough of those.
  optionMark: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  optionMarkOn: { backgroundColor: colors.primary },
  // Starts where the text starts, so the run of circles down the left is
  // unbroken by rules cutting across it.
  optionRule: {
    height: 1, backgroundColor: colors.borderSoft,
    marginLeft: spacing.md + 42 + 14, marginRight: spacing.md,
  },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 11, minHeight: 56 },
  listRowDivider: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 11, minHeight: 54 },
  divider: { height: 1, backgroundColor: colors.borderSoft, marginVertical: spacing.md },

  tableHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingBottom: 9, borderBottomWidth: 1.5, borderBottomColor: colors.border,
  },
  tableRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  stackCard: {
    backgroundColor: colors.surfaceAlt, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.borderSoft, padding: spacing.md, gap: 5,
  },
  stackLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },

  stat: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg, minHeight: 96,
  },

  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.xs, alignSelf: 'flex-start',
  },

  segment: {
    flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radius.sm + 2,
    padding: 4, borderWidth: 1, borderColor: colors.border,
  },
  segmentThumb: {
    position: 'absolute', top: 4, bottom: 4, left: 4,
    borderRadius: radius.control, backgroundColor: colors.card,
  },
  segmentItem: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: radius.control, minHeight: 38,
  },

  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 15, borderRadius: radius.control,
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, minHeight: 40,
  },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabCount: {
    minWidth: 19, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 6,
    backgroundColor: colors.primarySoft, alignItems: 'center',
  },

  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: 11, paddingHorizontal: 12, borderRadius: radius.sm,
    borderWidth: 1.5, borderColor: colors.borderSoft, backgroundColor: colors.card, minHeight: 60,
  },
  checkRowOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  box: {
    width: 23, height: 23, borderRadius: 7, borderWidth: 2,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card, flexShrink: 0,
  },

  choiceRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: 14, paddingHorizontal: 15, borderRadius: radius.sm,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card,
    marginBottom: 9, minHeight: 62,
  },
  choiceRowOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.primary },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  note: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingVertical: 9, paddingHorizontal: 11,
    borderRadius: radius.sm, marginBottom: spacing.sm,
  },
  noteDot: {
    width: 19, height: 19, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },

  sheet: {
    backgroundColor: colors.card, borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 4,
    backgroundColor: colors.border, marginTop: 10,
  },
  sheetHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  sheetFoot: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.surfaceAlt,
  },

  hero: { borderRadius: radius.lg, padding: spacing.xl, overflow: 'hidden' },
  heroGlow: {
    position: 'absolute', right: -70, top: -80, width: 240, height: 240,
    borderRadius: 120, backgroundColor: 'rgba(255,255,255,0.08)',
  },
  heroStat: {
    backgroundColor: 'rgba(255,255,255,0.13)', borderRadius: radius.sm,
    paddingVertical: 10, paddingHorizontal: 13, minWidth: 108,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
  },
});

export default {
  Screen, Card, Section, Button, Field, ListRow, MenuRow, Badge, Avatar, Crest,
  Tabs, SegmentedControl, Dots, ProgressRing, ChoiceRow, Hero, Sheet,
};
