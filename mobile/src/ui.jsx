// Nickland Edusoft — the shared interface.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Every screen in the phone app and the browser app is assembled from these.
// Two things they are built to do that the first version did not:
//
//   Fit the machine they are on. The old Screen capped itself at 640px on the
//   web and stopped — which made a laptop show a phone-shaped column down the
//   middle of a 27-inch monitor. Width is now a decision each component takes
//   from `useLayout()`: the same Card is full-bleed on a handset and one cell
//   of a grid on a desktop, and a table renders as a table where there is room
//   and as stacked rows where there is not.
//
//   Say what kind of thing they are. A figure is set in tabular numerals, a
//   status is a coloured pill, work not yet at the school is marked pending,
//   and a destructive button does not look like a save. Colour follows the
//   rules in theme.js: structure, action, judgement, data — nothing decorative.

import React, { useMemo, useState } from 'react';
import {
  View, Text as RNText, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, ScrollView, Platform, Modal as RNModal, Pressable, Image,
} from 'react-native';
import { colors, palette, gradients, type, spacing, radius, shadow } from './theme';
import { useLayout, pageWidth } from './responsive';
import { Icon } from './icons';

// ── gradients without a native dependency ───────────────────────────────────
// The browser gets a real CSS gradient. The phone gets the base colour with two
// soft bands laid over it, which reads as the same object without pulling in a
// native module for the sake of a header.
export function Gradient({ colors: stops = gradients.brand, angle = 135, style, children, pointerEvents }) {
  const [from, to] = stops;
  const web = Platform.OS === 'web'
    ? { backgroundImage: `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)` }
    : null;
  return (
    <View pointerEvents={pointerEvents} style={[{ backgroundColor: from, overflow: 'hidden' }, web, style]}>
      {Platform.OS !== 'web' && (
        <>
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: to, opacity: 0.55 }]} />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: from, opacity: 0.45 }]} />
        </>
      )}
      {children}
    </View>
  );
}

// ── text ────────────────────────────────────────────────────────────────────
export function Display({ children, style, color }) { return <RNText style={[type.display, { color: color || colors.text }, style]}>{children}</RNText>; }
export function Title({ children, style, color }) { return <RNText style={[type.title, { color: color || colors.text }, style]}>{children}</RNText>; }
export function Heading({ children, style, color }) { return <RNText style={[type.heading, { color: color || colors.text }, style]}>{children}</RNText>; }
export function Body({ children, style, color, numberOfLines }) { return <RNText numberOfLines={numberOfLines} style={[type.body, { color: color || colors.textSoft }, style]}>{children}</RNText>; }
export function Muted({ children, style, numberOfLines }) { return <RNText numberOfLines={numberOfLines} style={[type.small, { color: colors.muted }, style]}>{children}</RNText>; }
export function Micro({ children, style, color }) { return <RNText style={[type.micro, { color: color || colors.faint, textTransform: 'uppercase' }, style]}>{children}</RNText>; }
export function Figure({ children, style, color }) { return <RNText style={[type.numeric, { color: color || colors.text }, style]}>{children}</RNText>; }

// Kept so screens written against the first version still render.
export const H1 = Title;
export const H2 = Heading;

// ── page frame ──────────────────────────────────────────────────────────────
/**
 * The body of a screen.
 *
 * `variant` decides how wide it is allowed to get on a large window:
 *   page     the default — a working width, up to 1240px
 *   reading  a single column of prose or a form, up to 760px
 *   full     edge to edge; for a table or a chat thread that owns the width
 */
export function Screen({ children, scroll = true, refreshControl, variant = 'page', padded = true, style }) {
  const layout = useLayout();
  const width = variant === 'full' ? { width: '100%' } : pageWidth(layout, variant);
  const pad = padded ? { padding: layout.gutter, gap: spacing.md } : null;
  const Body = scroll ? ScrollView : View;
  const props = scroll
    ? { contentContainerStyle: [styles.screenBody, width, pad, style], refreshControl, showsVerticalScrollIndicator: false }
    : { style: [styles.screenBody, width, pad, style] };
  return <Body style={styles.screen} {...props}>{children}</Body>;
}

// ── surfaces ────────────────────────────────────────────────────────────────
export function Card({ children, style, tone, padded = true, onPress, elevated }) {
  const toneStyle = tone === 'accent' ? { borderLeftWidth: 3, borderLeftColor: colors.accent }
    : tone === 'danger' ? { borderLeftWidth: 3, borderLeftColor: colors.danger }
    : tone === 'success' ? { borderLeftWidth: 3, borderLeftColor: colors.success }
    : tone === 'data' ? { borderLeftWidth: 3, borderLeftColor: colors.data }
    : null;
  const body = (
    <View style={[styles.card, elevated ? shadow.raised : shadow.rest, padded && styles.cardPad, toneStyle, style]}>
      {children}
    </View>
  );
  if (!onPress) return body;
  return <TouchableOpacity activeOpacity={0.82} onPress={onPress}>{body}</TouchableOpacity>;
}

// A titled block. Saves every screen re-inventing "heading, optional action,
// then content" and keeps the spacing between them identical everywhere.
export function Section({ title, subtitle, action, children, style, tone, icon }) {
  return (
    <Card style={style} tone={tone}>
      {(title || action) && (
        <View style={styles.sectionHead}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            {icon ? <IconTile name={icon} size={30} /> : null}
            <View style={{ flex: 1 }}>
              {title ? <Heading>{title}</Heading> : null}
              {subtitle ? <Muted style={{ marginTop: 2 }}>{subtitle}</Muted> : null}
            </View>
          </View>
          {action || null}
        </View>
      )}
      {children}
    </Card>
  );
}

// A small tinted square holding an icon. The app's most repeated motif: it
// gives a row a fixed left edge so a list of them reads as a column.
export function IconTile({ name, size = 36, tone = 'primary', color }) {
  const tones = {
    primary: { bg: colors.primarySoft, fg: colors.primary },
    gold: { bg: colors.accentSoft, fg: palette.gold600 },
    success: { bg: palette.green100, fg: palette.green600 },
    danger: { bg: palette.red100, fg: palette.red600 },
    warning: { bg: palette.amber100, fg: palette.amber600 },
    info: { bg: palette.blue100, fg: palette.blue600 },
    violet: { bg: palette.violet100, fg: palette.violet500 },
    data: { bg: '#DFF6F8', fg: palette.cyan600 },
    chrome: { bg: 'rgba(255,255,255,0.12)', fg: '#FFFFFF' },
  };
  const t = tones[tone] || tones.primary;
  return (
    <View style={{
      width: size, height: size, borderRadius: size * 0.32,
      backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon name={name} size={size * 0.55} color={color || t.fg} />
    </View>
  );
}

// ── buttons ─────────────────────────────────────────────────────────────────
const BUTTON_TONES = {
  primary: { bg: colors.primary, fg: '#fff', border: 'transparent' },
  gold: { bg: palette.gold500, fg: '#1B1300', border: 'transparent' },
  danger: { bg: colors.danger, fg: '#fff', border: 'transparent' },
  success: { bg: colors.success, fg: '#fff', border: 'transparent' },
  outline: { bg: 'transparent', fg: colors.primary, border: colors.border },
  subtle: { bg: colors.primarySoft, fg: colors.primary, border: 'transparent' },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
};

export function Button({
  title, onPress, disabled, busy, variant = 'primary', size = 'md',
  icon, iconRight, full = true, style,
}) {
  const t = BUTTON_TONES[variant] || BUTTON_TONES.primary;
  const dims = size === 'sm'
    ? { paddingVertical: 8, paddingHorizontal: 12, fontSize: 13, icon: 15 }
    : size === 'lg'
      ? { paddingVertical: 15, paddingHorizontal: 20, fontSize: 16, icon: 20 }
      : { paddingVertical: 12, paddingHorizontal: 16, fontSize: 15, icon: 17 };
  const off = disabled || busy;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onPress}
      disabled={off}
      activeOpacity={0.85}
      style={[
        styles.btn,
        {
          backgroundColor: t.bg,
          borderColor: t.border,
          borderWidth: t.border === 'transparent' ? 0 : 1,
          paddingVertical: dims.paddingVertical,
          paddingHorizontal: dims.paddingHorizontal,
          opacity: off ? 0.5 : 1,
          alignSelf: full ? 'stretch' : 'flex-start',
        },
        variant === 'primary' && !off ? shadow.rest : null,
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={t.fg} /> : (icon ? <Icon name={icon} size={dims.icon} color={t.fg} /> : null)}
      <RNText style={{ color: t.fg, fontWeight: '700', fontSize: dims.fontSize, letterSpacing: -0.1 }}>{title}</RNText>
      {iconRight ? <Icon name={iconRight} size={dims.icon} color={t.fg} /> : null}
    </TouchableOpacity>
  );
}

export function IconButton({ name, onPress, tone = 'subtle', size = 38, color, disabled, label }) {
  const bg = tone === 'chrome' ? 'rgba(255,255,255,0.12)' : tone === 'plain' ? 'transparent' : colors.primarySoft;
  const fg = color || (tone === 'chrome' ? '#fff' : colors.primary);
  return (
    <TouchableOpacity
      accessibilityRole="button" accessibilityLabel={label}
      onPress={onPress} disabled={disabled} activeOpacity={0.75}
      style={{
        width: size, height: size, borderRadius: size * 0.32,
        backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Icon name={name} size={size * 0.5} color={fg} />
    </TouchableOpacity>
  );
}

// Floating action — the phone's "add one". On a desktop the same action is a
// button in the section header, so this only draws where it belongs.
export function Fab({ name = 'plus', label, onPress }) {
  const layout = useLayout();
  if (!layout.isPhone) return null;
  return (
    <TouchableOpacity
      accessibilityRole="button" accessibilityLabel={label}
      onPress={onPress} activeOpacity={0.88}
      style={[styles.fab, shadow.floating]}
    >
      <Icon name={name} size={22} color="#fff" />
      {label ? <RNText style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{label}</RNText> : null}
    </TouchableOpacity>
  );
}

// ── inputs ──────────────────────────────────────────────────────────────────
export function Field({ label, value, onChangeText, hint, error, icon, right, style, inputStyle, ...rest }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ marginBottom: spacing.md }, style]}>
      {label ? <Micro style={{ marginBottom: 6, color: colors.muted }}>{label}</Micro> : null}
      <View style={[
        styles.inputWrap,
        focused && { borderColor: colors.primary, backgroundColor: '#fff' },
        error && { borderColor: colors.danger },
      ]}>
        {icon ? <Icon name={icon} size={17} color={focused ? colors.primary : colors.faint} /> : null}
        <TextInput
          style={[styles.input, inputStyle]}
          value={value == null ? '' : String(value)}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          {...rest}
        />
        {right || null}
      </View>
      {error ? <Muted style={{ color: colors.danger, marginTop: 4 }}>{error}</Muted>
        : hint ? <Muted style={{ marginTop: 4 }}>{hint}</Muted> : null}
    </View>
  );
}

export function TextArea(props) {
  return (
    <Field
      {...props}
      multiline
      numberOfLines={props.numberOfLines || 4}
      autoCapitalize="sentences"
      inputStyle={[{ minHeight: (props.numberOfLines || 4) * 22, textAlignVertical: 'top', paddingTop: 6 }, props.inputStyle]}
    />
  );
}

/**
 * A picker built from pills rather than a native select.
 *
 * A native picker means a platform module and three different behaviours; a
 * teacher choosing between six classes is better served by seeing all six.
 * Long lists fall back to a scrolling row.
 */
export function Select({ label, value, options, onChange, hint, empty = 'Nothing to choose from.', columns }) {
  const layout = useLayout();
  const wrap = columns || (layout.isPhone ? 2 : 4);
  const opts = options || [];
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Micro style={{ marginBottom: 6, color: colors.muted }}>{label}</Micro> : null}
      {opts.length === 0
        ? <Muted>{empty}</Muted>
        : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {opts.map((o) => {
              const active = String(o.value) === String(value);
              return (
                <TouchableOpacity
                  key={String(o.value)}
                  accessibilityRole="button"
                  onPress={() => onChange(o.value)}
                  activeOpacity={0.8}
                  style={[
                    styles.selectPill,
                    { minWidth: wrap <= 2 ? '48%' : undefined },
                    active && { backgroundColor: colors.primary, borderColor: colors.primary },
                  ]}
                >
                  <RNText numberOfLines={1} style={{ color: active ? '#fff' : colors.textSoft, fontWeight: '600', fontSize: 14 }}>
                    {o.label}
                  </RNText>
                  {o.note ? (
                    <RNText style={{ color: active ? 'rgba(255,255,255,0.75)' : colors.faint, fontSize: 11, fontWeight: '600' }}>
                      {o.note}
                    </RNText>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      {hint ? <Muted style={{ marginTop: 6 }}>{hint}</Muted> : null}
    </View>
  );
}

export function SearchField({ value, onChangeText, placeholder = 'Search…', onClear }) {
  return (
    <View style={styles.searchWrap}>
      <Icon name="search" size={17} color={colors.faint} />
      <TextInput
        style={[styles.input, { paddingVertical: Platform.OS === 'web' ? 10 : 8 }]}
        value={value} onChangeText={onChangeText}
        placeholder={placeholder} placeholderTextColor={colors.faint}
        autoCapitalize="none" returnKeyType="search"
      />
      {value ? <IconButton name="close" size={28} tone="plain" color={colors.faint} onPress={() => (onClear ? onClear() : onChangeText(''))} label="Clear search" /> : null}
    </View>
  );
}

// A date as typed text, validated on the way out. A native date picker is a
// platform module per platform; a school types 2026-09-14 faster than it
// spins three wheels.
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
      <View style={{ flex: 1 }}>{left}</View>
      <View style={{ alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
  return onPress ? <TouchableOpacity activeOpacity={0.7} onPress={onPress}>{body}</TouchableOpacity> : body;
}

export function ListRow({ title, subtitle, meta, icon, iconTone, right, onPress, badge, avatar, style }) {
  const body = (
    <View style={[styles.listRow, style]}>
      {/* A face beats an icon wherever there is one: a teacher scanning a roll
          for a child recognises the photograph long before the name. */}
      {avatar || (icon ? <IconTile name={icon} tone={iconTone} size={38} /> : null)}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <RNText numberOfLines={1} style={{ ...type.body, fontWeight: '700', color: colors.text, flexShrink: 1 }}>{title}</RNText>
          {badge || null}
        </View>
        {subtitle ? <Muted numberOfLines={1} style={{ marginTop: 1 }}>{subtitle}</Muted> : null}
        {meta ? <View style={{ marginTop: 6 }}>{meta}</View> : null}
      </View>
      {right ? <View style={{ alignItems: 'flex-end' }}>{right}</View> : null}
      {onPress ? <Icon name="chevron" size={16} color={colors.faint} /> : null}
    </View>
  );
  return onPress ? <TouchableOpacity activeOpacity={0.72} onPress={onPress}>{body}</TouchableOpacity> : body;
}

export function Divider({ style }) { return <View style={[styles.divider, style]} />; }

/**
 * A table where there is room for one, and stacked rows where there is not.
 *
 * `columns` is [{ key, label, width?, align?, render? }]. On a phone the first
 * column becomes the row's title and the rest become labelled lines beneath it,
 * so a broadsheet is readable on a handset instead of scrolling sideways
 * forever.
 */
export function DataTable({ columns, rows, keyExtractor, onRowPress, empty = 'Nothing to show.', dense }) {
  const layout = useLayout();
  if (!rows || rows.length === 0) return <Muted>{empty}</Muted>;
  const key = keyExtractor || ((r, i) => String(r.id ?? i));

  if (!layout.canTable) {
    const [first, ...rest] = columns;
    return (
      <View>
        {rows.map((r, i) => {
          const body = (
            <View key={key(r, i)} style={styles.stackRow}>
              <RNText style={{ ...type.body, fontWeight: '700', color: colors.text }}>
                {first.render ? first.render(r) : r[first.key]}
              </RNText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
                {rest.map(c => (
                  <View key={c.key} style={{ minWidth: 92 }}>
                    <Micro>{c.label}</Micro>
                    <RNText style={{ ...type.small, color: colors.textSoft, marginTop: 1 }}>
                      {c.render ? c.render(r) : (r[c.key] ?? '—')}
                    </RNText>
                  </View>
                ))}
              </View>
            </View>
          );
          return onRowPress
            ? <TouchableOpacity key={key(r, i)} activeOpacity={0.72} onPress={() => onRowPress(r)}>{body}</TouchableOpacity>
            : body;
        })}
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minWidth: '100%' }}>
      <View style={{ flex: 1, minWidth: '100%' }}>
        <View style={styles.tableHead}>
          {columns.map(c => (
            <View key={c.key} style={{ width: c.width, flex: c.width ? undefined : 1, paddingHorizontal: 6 }}>
              <Micro style={{ textAlign: c.align || 'left' }}>{c.label}</Micro>
            </View>
          ))}
        </View>
        {rows.map((r, i) => {
          const body = (
            <View style={[styles.tableRow, dense && { paddingVertical: 7 }]}>
              {columns.map(c => (
                <View key={c.key} style={{ width: c.width, flex: c.width ? undefined : 1, paddingHorizontal: 6 }}>
                  {c.render
                    ? <View style={{ alignItems: c.align === 'right' ? 'flex-end' : c.align === 'center' ? 'center' : 'flex-start' }}>{c.render(r)}</View>
                    : <RNText numberOfLines={1} style={{ ...type.small, color: colors.textSoft, textAlign: c.align || 'left' }}>{r[c.key] ?? '—'}</RNText>}
                </View>
              ))}
            </View>
          );
          return onRowPress
            ? <TouchableOpacity key={key(r, i)} activeOpacity={0.72} onPress={() => onRowPress(r)}>{body}</TouchableOpacity>
            : <View key={key(r, i)}>{body}</View>;
        })}
      </View>
    </ScrollView>
  );
}

// ── figures ─────────────────────────────────────────────────────────────────
export function StatCard({ label, value, tone, icon, note, onPress, style }) {
  const fg = tone === 'success' ? colors.success
    : tone === 'danger' ? colors.danger
    : tone === 'warning' ? colors.warning
    : tone === 'data' ? colors.data
    : colors.text;
  const body = (
    <View style={[styles.stat, shadow.rest, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Micro>{label}</Micro>
        {icon ? <Icon name={icon} size={16} color={colors.faint} /> : null}
      </View>
      <Figure color={fg} style={{ marginTop: 8 }}>{value}</Figure>
      {note ? <Muted style={{ marginTop: 2 }}>{note}</Muted> : null}
    </View>
  );
  return onPress ? <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={{ flexGrow: 1, flexBasis: 0 }}>{body}</TouchableOpacity> : body;
}

// Lays cards out in the number of columns the window can take.
//
// The width is measured rather than expressed as a percentage. A percentage
// basis of 25% for four columns plus three 12px gaps comes to more than the
// container, so the fourth card wrapped onto its own line and every four-card
// row in the app rendered as three-and-one. Measuring costs one extra render
// on mount and gets it right at every window size.
export function Grid({ children, min = 160, gap = spacing.md, columns }) {
  const layout = useLayout();
  const [width, setWidth] = useState(0);
  const items = React.Children.toArray(children).filter(Boolean);
  const wanted = columns || layout.columns;

  // Never more columns than the content can bear at `min`, and never more than
  // there are cards — three cards across four columns leaves a hole.
  const fit = width > 0 ? Math.max(1, Math.floor((width + gap) / (min + gap))) : wanted;
  const cols = Math.max(1, Math.min(wanted, fit, items.length || 1));
  const basis = width > 0 ? (width - gap * (cols - 1)) / cols : undefined;

  return (
    <View
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}
    >
      {items.map((child, i) => (
        <View
          key={i}
          style={basis
            ? { width: basis, flexGrow: 0, flexShrink: 0 }
            : { flexGrow: 1, flexBasis: `${Math.floor(1000 / cols) / 10}%`, minWidth: min }}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

export function ProgressBar({ value, max = 100, tone = 'primary', height = 8, label }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  const fill = tone === 'success' ? colors.success : tone === 'danger' ? colors.danger
    : tone === 'warning' ? colors.warning : colors.primary;
  return (
    <View>
      {label ? <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Muted>{label}</Muted><Muted>{Math.round(pct)}%</Muted>
      </View> : null}
      <View style={{ height, borderRadius: height, backgroundColor: colors.borderSoft, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', borderRadius: height, backgroundColor: fill }} />
      </View>
    </View>
  );
}

// ── labels ──────────────────────────────────────────────────────────────────
const BADGE_TONES = {
  neutral: { bg: colors.borderSoft, fg: colors.muted },
  primary: { bg: colors.primarySoft, fg: colors.primary },
  success: { bg: palette.green100, fg: palette.green600 },
  danger: { bg: palette.red100, fg: palette.red600 },
  warning: { bg: palette.amber100, fg: palette.amber600 },
  info: { bg: palette.blue100, fg: palette.blue600 },
  gold: { bg: colors.accentSoft, fg: palette.gold600 },
  data: { bg: '#DFF6F8', fg: palette.cyan600 },
  chrome: { bg: 'rgba(255,255,255,0.14)', fg: '#fff' },
};

export function Badge({ label, tone = 'neutral', icon, style }) {
  const t = BADGE_TONES[tone] || BADGE_TONES.neutral;
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }, style]}>
      {icon ? <Icon name={icon} size={11} color={t.fg} /> : null}
      <RNText style={{ color: t.fg, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 }}>{label}</RNText>
    </View>
  );
}

// Work a teacher has done that has not reached the school's computer yet. It
// gets its own mark everywhere it appears, because "saved" and "saved here,
// waiting" are not the same promise.
export function PendingBadge({ label = 'Waiting to sync' }) {
  return <Badge tone="data" icon="refresh" label={label} />;
}

export function SegmentedControl({ value, options, onChange, style }) {
  return (
    <View style={[styles.segment, style]}>
      {options.map(o => {
        const active = String(o.value) === String(value);
        return (
          <TouchableOpacity
            key={String(o.value)} accessibilityRole="tab" accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)} activeOpacity={0.8}
            style={[styles.segmentItem, active && styles.segmentItemActive]}
          >
            {o.icon ? <Icon name={o.icon} size={15} color={active ? colors.primary : colors.muted} /> : null}
            <RNText numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '700', color: active ? colors.primary : colors.muted }}>
              {o.label}
            </RNText>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// A face where there is one, initials where there is not.
//
// The `photo` prop has been on this component since the first version and was
// never once read: every screen passed a pupil's or a teacher's picture in and
// got two letters in a circle back. It is read now — the server sends the image
// itself rather than a path into the school's hard disk — and a photograph that
// fails to decode falls back to the initials rather than to an empty hole.
export function Avatar({ name, photo, size = 40, tone = 'primary', ring, square }) {
  const [broken, setBroken] = useState(false);
  const initials = useMemo(() => String(name || '?')
    .split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?', [name]);
  const bg = tone === 'chrome' ? 'rgba(255,255,255,0.16)' : colors.primarySoft;
  const fg = tone === 'chrome' ? '#fff' : colors.primary;
  const radiusOf = square ? size * 0.26 : size / 2;
  const show = photo && !broken;
  return (
    <View style={{
      width: size, height: size, borderRadius: radiusOf, backgroundColor: bg,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      ...(ring ? {
        borderWidth: Math.max(2, size * 0.045),
        borderColor: tone === 'chrome' ? 'rgba(255,255,255,0.35)' : colors.card,
      } : null),
    }}>
      {show ? (
        <Image
          source={{ uri: photo }}
          onError={() => setBroken(true)}
          accessibilityLabel={name ? `Photograph of ${name}` : 'Photograph'}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        />
      ) : (
        <RNText style={{ color: fg, fontWeight: '800', fontSize: size * 0.36 }}>{initials}</RNText>
      )}
    </View>
  );
}

// The school's crest. Falls back to the app's own mark, so a school that has
// never uploaded one still gets something deliberate rather than a gap.
export function Crest({ logo, size = 40, tone = 'chrome', rounded = true }) {
  const [broken, setBroken] = useState(false);
  const bg = tone === 'chrome' ? 'rgba(255,255,255,0.12)' : colors.primarySoft;
  const fg = tone === 'chrome' ? palette.gold400 : colors.primary;
  return (
    <View style={{
      width: size, height: size, borderRadius: rounded ? size * 0.3 : 0,
      backgroundColor: logo && !broken ? (tone === 'chrome' ? 'rgba(255,255,255,0.94)' : '#fff') : bg,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      padding: logo && !broken ? size * 0.08 : 0,
    }}>
      {logo && !broken ? (
        <Image
          source={{ uri: logo }} onError={() => setBroken(true)} accessibilityLabel="School crest"
          style={{ width: '100%', height: '100%' }} resizeMode="contain"
        />
      ) : (
        <Icon name="school" size={size * 0.55} color={fg} />
      )}
    </View>
  );
}

// ── states ──────────────────────────────────────────────────────────────────
export function Loading({ label }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} size="large" />
      {label ? <Muted style={{ marginTop: spacing.sm }}>{label}</Muted> : null}
    </View>
  );
}

// Shown while a list loads, in the shape the list will take. A spinner tells a
// teacher on a slow phone nothing about what is coming.
export function Skeleton({ rows = 4, height = 54 }) {
  return (
    <View style={{ gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={{ height, borderRadius: radius.md, backgroundColor: colors.borderSoft, opacity: 1 - i * 0.12 }} />
      ))}
    </View>
  );
}

export function EmptyState({ icon = 'note', title, message, action }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xl, gap: 6 }}>
      <IconTile name={icon} size={52} tone="primary" />
      {title ? <Heading style={{ marginTop: 6, textAlign: 'center' }}>{title}</Heading> : null}
      {message ? <Muted style={{ textAlign: 'center', maxWidth: 380 }}>{message}</Muted> : null}
      {action ? <View style={{ marginTop: 10 }}>{action}</View> : null}
    </View>
  );
}

function Note({ message, tone, icon }) {
  if (!message) return null;
  const t = BADGE_TONES[tone] || BADGE_TONES.neutral;
  return (
    <View style={[styles.note, { backgroundColor: t.bg }]}>
      <Icon name={icon} size={16} color={t.fg} />
      <RNText style={{ color: t.fg, flex: 1, fontSize: 13.5, fontWeight: '600', lineHeight: 19 }}>{message}</RNText>
    </View>
  );
}

export function ErrorNote({ message }) { return <Note message={message} tone="danger" icon="alert" />; }
export function InfoNote({ message }) { return <Note message={message} tone="info" icon="note" />; }
export function SuccessNote({ message }) { return <Note message={message} tone="success" icon="tick" />; }
export function WarningNote({ message }) { return <Note message={message} tone="warning" icon="alert" />; }

// ── modal ───────────────────────────────────────────────────────────────────
// A centred panel on a desktop, a sheet rising from the bottom on a phone —
// the same component, because the content is identical and only the gesture
// people expect differs.
export function Sheet({ visible, onClose, title, children, footer, width = 560 }) {
  const layout = useLayout();
  if (!visible) return null;
  return (
    <RNModal transparent animationType={layout.isPhone ? 'slide' : 'fade'} visible onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View pointerEvents="box-none" style={[
        StyleSheet.absoluteFill,
        { justifyContent: layout.isPhone ? 'flex-end' : 'center', alignItems: 'center', padding: layout.isPhone ? 0 : spacing.xl },
      ]}>
        <View style={[
          styles.sheet, shadow.floating,
          layout.isPhone
            ? { width: '100%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, maxHeight: '88%' }
            : { width: '100%', maxWidth: width, maxHeight: '86%' },
        ]}>
          <View style={styles.sheetHead}>
            <Heading style={{ flex: 1 }}>{title}</Heading>
            <IconButton name="close" size={34} tone="plain" color={colors.muted} onPress={onClose} label="Close" />
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>{children}</ScrollView>
          {footer ? <View style={styles.sheetFoot}>{footer}</View> : null}
        </View>
      </View>
    </RNModal>
  );
}

// ── tabs ────────────────────────────────────────────────────────────────────
// SegmentedControl divides the width between its options, which is right for
// two or three and unreadable at seven: a child's record now has Overview,
// Academics, Reports, Attendance, Fees, Canteen, Homework and Timetable. This
// scrolls instead of squeezing, and on a wide window it simply sits still
// because everything already fits.
export function Tabs({ value, options, onChange, style }) {
  return (
    <ScrollView
      horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={[{ gap: 6, paddingVertical: 2 }, style]}
    >
      {options.map(o => {
        const active = String(o.value) === String(value);
        return (
          <TouchableOpacity
            key={String(o.value)}
            accessibilityRole="tab" accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)} activeOpacity={0.8}
            style={[styles.tab, active && styles.tabOn]}
          >
            {o.icon ? <Icon name={o.icon} size={15} color={active ? '#fff' : colors.muted} /> : null}
            <RNText numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '700', color: active ? '#fff' : colors.textSoft }}>
              {o.label}
            </RNText>
            {o.count != null && o.count !== 0 ? (
              <View style={[styles.tabCount, active && { backgroundColor: 'rgba(255,255,255,0.24)' }]}>
                <RNText style={{ fontSize: 10.5, fontWeight: '800', color: active ? '#fff' : colors.primary }}>{o.count}</RNText>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// ── selection ───────────────────────────────────────────────────────────────
// A tick box that is a real target on a phone: the whole row is pressable, not
// a 16px square a teacher has to aim at while forty children file past.
export function CheckRow({ checked, onToggle, title, subtitle, right, avatar, disabled, tone }) {
  return (
    <TouchableOpacity
      accessibilityRole="checkbox" accessibilityState={{ checked: !!checked, disabled: !!disabled }}
      onPress={disabled ? undefined : onToggle} activeOpacity={disabled ? 1 : 0.7}
      style={[styles.checkRow, checked && styles.checkRowOn, disabled && { opacity: 0.55 }]}
    >
      <View style={[styles.box, checked && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
        {checked ? <Icon name="tick" size={13} color="#fff" /> : null}
      </View>
      {avatar || null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText numberOfLines={1} style={{ ...type.body, fontWeight: '700', color: colors.text }}>{title}</RNText>
        {subtitle ? <Muted numberOfLines={1}>{subtitle}</Muted> : null}
      </View>
      {right || null}
    </TouchableOpacity>
  );
}

// ── the school, at the top of a screen ──────────────────────────────────────
// One hero, used by every landing screen, so the parent app and the teacher app
// are recognisably the same product and the school's crest is on both.
export function Hero({ crest, eyebrow, title, subtitle, right, tone = 'brand', children }) {
  const layout = useLayout();
  return (
    <Gradient colors={gradients[tone] || gradients.brand} angle={130} style={[styles.hero, shadow.raised]}>
      {/* A single soft highlight. It is what stops a flat two-stop gradient
          reading like a coloured rectangle on a big monitor. */}
      <View pointerEvents="none" style={styles.heroGlow} />
      <View style={{
        flexDirection: layout.isPhone ? 'column' : 'row',
        alignItems: layout.isPhone ? 'flex-start' : 'center', gap: spacing.lg,
      }}>
        {crest ? <View>{crest}</View> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          {eyebrow ? (
            <RNText numberOfLines={1} style={{ color: 'rgba(255,255,255,0.68)', fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>
              {String(eyebrow).toUpperCase()}
            </RNText>
          ) : null}
          <RNText numberOfLines={2} style={{
            color: '#fff', fontSize: layout.isPhone ? 23 : 29, fontWeight: '800',
            letterSpacing: -0.6, marginTop: 3,
          }}>{title}</RNText>
          {subtitle ? (
            <RNText style={{ color: 'rgba(255,255,255,0.74)', fontSize: 13.5, fontWeight: '600', marginTop: 5 }}>
              {subtitle}
            </RNText>
          ) : null}
        </View>
        {right || null}
      </View>
      {children ? <View style={{ marginTop: spacing.lg }}>{children}</View> : null}
    </Gradient>
  );
}

// A figure carved out of a hero — white on navy, so it belongs to the header
// rather than sitting on it.
export function HeroStat({ label, value, tone = 'light', note }) {
  return (
    <View style={styles.heroStat}>
      <RNText style={{ ...type.micro, color: 'rgba(255,255,255,0.62)' }}>{String(label).toUpperCase()}</RNText>
      <RNText style={{
        color: tone === 'danger' ? palette.gold200 : '#fff',
        fontSize: 19, fontWeight: '800', marginTop: 3, fontVariant: ['tabular-nums'],
      }}>{value}</RNText>
      {note ? <RNText style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11.5, fontWeight: '600', marginTop: 1 }}>{note}</RNText> : null}
    </View>
  );
}

// ── a row of actions above a list ───────────────────────────────────────────
export function Toolbar({ children, style }) {
  return <View style={[{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }, style]}>{children}</View>;
}

// ── key/value ───────────────────────────────────────────────────────────────
export function KeyValue({ items, columns }) {
  const layout = useLayout();
  const cols = columns || (layout.isPhone ? 2 : 3);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
      {(items || []).filter(i => i && i.value != null && i.value !== '').map((i, n) => (
        <View key={n} style={{ flexGrow: 1, flexBasis: `${Math.floor(100 / cols) - 2}%`, minWidth: 120 }}>
          <Micro>{i.label}</Micro>
          <RNText style={{ ...type.body, color: colors.text, marginTop: 2 }}>{i.value}</RNText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
  },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabCount: {
    minWidth: 18, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 999,
    backgroundColor: colors.primarySoft, alignItems: 'center',
  },

  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: 10, paddingHorizontal: 10, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: colors.card,
  },
  checkRowOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  box: {
    width: 22, height: 22, borderRadius: 7, borderWidth: 2,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card,
  },

  hero: { borderRadius: radius.lg, padding: spacing.xl, overflow: 'hidden' },
  heroGlow: {
    position: 'absolute', right: -60, top: -70, width: 220, height: 220,
    borderRadius: 110, backgroundColor: 'rgba(255,255,255,0.07)',
  },
  heroStat: {
    backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: radius.md,
    paddingVertical: 10, paddingHorizontal: 13, minWidth: 120,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  screenBody: { flexGrow: 1 },

  card: {
    backgroundColor: colors.card, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  cardPad: { padding: spacing.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },

  btn: {
    borderRadius: radius.sm + 2, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8,
  },
  fab: {
    position: 'absolute', right: spacing.lg, bottom: spacing.lg + 6,
    backgroundColor: colors.primary, borderRadius: radius.pill,
    paddingVertical: 14, paddingHorizontal: 18,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm + 2, paddingHorizontal: 12,
  },
  input: {
    flex: 1, paddingVertical: Platform.OS === 'web' ? 11 : 10,
    fontSize: 15, color: colors.text,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.pill, paddingHorizontal: 14,
  },
  selectPill: {
    paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
    alignItems: 'center',
  },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  listRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  divider: { height: 1, backgroundColor: colors.borderSoft, marginVertical: spacing.sm },
  stackRow: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  tableHead: {
    flexDirection: 'row', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  tableRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },

  stat: {
    backgroundColor: colors.card, borderRadius: radius.md + 2,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg,
  },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill,
  },
  segment: {
    flexDirection: 'row', backgroundColor: colors.borderSoft,
    borderRadius: radius.sm + 2, padding: 3, gap: 3,
  },
  segmentItem: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 8, borderRadius: radius.sm,
  },
  segmentItemActive: { backgroundColor: colors.card, ...shadow.rest },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, minHeight: 220 },
  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: radius.md, padding: spacing.md,
  },

  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(7,20,43,0.55)' },
  sheet: { backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden' },
  sheetHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  sheetFoot: {
    padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderSoft,
    flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end',
  },
});

export { Icon };
export default { Screen, Card, Section, Button, Field, Row };
