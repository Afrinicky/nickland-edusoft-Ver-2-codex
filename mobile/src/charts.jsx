// Nickland Edusoft — small charts, no chart library.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A parent asking "is my child improving?" is asking a question a table of
// numbers answers badly and a shape answers instantly. These are the three
// shapes worth drawing in a school app, and they are drawn out of plain Views
// so the same code renders on an Android phone and in a browser without
// pulling in a charting dependency — which on the phone would mean a native
// module, a rebuild, and an APK a school has to re-download.
//
//   Trend    a term-by-term line: where a child's average has gone.
//   Bars     one row per subject: where the marks sit against each other.
//   Meter    a single proportion, on a ring-less bar, with the figure in words.
//
// Colour follows theme.js: cyan is data, and a value judgement (good, poor)
// gets the judgement colours. Nothing is coloured decoratively.

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, palette, spacing, radius, type } from './theme';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export function toneForScore(score) {
  if (score == null) return 'neutral';
  if (score >= 75) return 'success';
  if (score >= 60) return 'info';
  if (score >= 50) return 'primary';
  if (score >= 40) return 'warning';
  return 'danger';
}

const TONE_COLOR = {
  neutral: colors.faint,
  primary: colors.primary,
  info: palette.blue600,
  success: palette.green600,
  warning: palette.amber500,
  danger: palette.red500,
  data: palette.cyan600,
};

export function colorForScore(score) { return TONE_COLOR[toneForScore(score)]; }

// ── a line across terms ─────────────────────────────────────────────────────
// Each segment is a thin View rotated into place. It is the one trick that buys
// a real line chart with no SVG and no dependency, and it degrades honestly:
// with a single point there is no line, just the point, which is the truth.
export function Trend({ points = [], height = 130, label, suffix = '', min, max, tone = 'data' }) {
  const [width, setWidth] = useState(0);
  const data = points.map(p => ({ label: p.label, value: num(p.value) })).filter(p => p.value != null);

  const bounds = useMemo(() => {
    if (!data.length) return { lo: 0, hi: 100 };
    const vals = data.map(d => d.value);
    let lo = min != null ? min : Math.min(...vals);
    let hi = max != null ? max : Math.max(...vals);
    // A flat line at 62 should read as flat, not as noise magnified to fill the
    // box. Pad the band instead of scaling to the data's own tiny range.
    if (hi - lo < 10) { const mid = (hi + lo) / 2; lo = Math.max(0, mid - 8); hi = mid + 8; }
    else { const pad = (hi - lo) * 0.12; lo = Math.max(0, lo - pad); hi = hi + pad; }
    return { lo, hi };
  }, [data, min, max]);

  const plotH = height - 30;
  const stroke = TONE_COLOR[tone] || TONE_COLOR.data;

  if (!data.length) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ ...type.small, color: colors.faint }}>Nothing to chart yet.</Text>
      </View>
    );
  }

  const xy = data.map((d, i) => ({
    ...d,
    x: data.length === 1 ? width / 2 : (i / (data.length - 1)) * Math.max(0, width - 12) + 6,
    y: plotH - ((d.value - bounds.lo) / Math.max(0.0001, bounds.hi - bounds.lo)) * plotH,
  }));

  return (
    <View onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      {label ? <Text style={{ ...type.micro, color: colors.faint, marginBottom: 6 }}>{label.toUpperCase()}</Text> : null}
      <View style={{ height: plotH, position: 'relative' }}>
        {/* three hairlines, so a reader can judge a slope rather than guess it */}
        {[0, 0.5, 1].map(f => (
          <View key={f} style={{
            position: 'absolute', left: 0, right: 0, top: plotH * f,
            height: 1, backgroundColor: colors.borderSoft,
          }} />
        ))}
        {width > 0 && xy.slice(1).map((p, i) => {
          const a = xy[i];
          const dx = p.x - a.x, dy = p.y - a.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 0;
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          // Rotated about its own centre, which is the default in both React
          // Native and react-native-web. `transformOrigin` would read better
          // but is not supported on the React Native version this app ships,
          // and a segment silently rotating about the wrong point draws a
          // chart that is wrong rather than one that looks wrong.
          return (
            <View key={i} style={{
              position: 'absolute',
              left: (a.x + p.x) / 2 - len / 2,
              top: (a.y + p.y) / 2 - 1.25,
              width: len, height: 2.5, backgroundColor: stroke, borderRadius: 2,
              transform: [{ rotateZ: `${angle}deg` }],
            }} />
          );
        })}
        {width > 0 && xy.map((p, i) => (
          <View key={`d${i}`} style={{
            position: 'absolute', left: p.x - 5, top: p.y - 5,
            width: 10, height: 10, borderRadius: 5,
            backgroundColor: colors.card, borderWidth: 2.5, borderColor: stroke,
          }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', marginTop: 8 }}>
        {data.map((d, i) => (
          <View key={i} style={{ flex: 1, alignItems: data.length === 1 ? 'center' : i === 0 ? 'flex-start' : i === data.length - 1 ? 'flex-end' : 'center' }}>
            <Text style={{ ...type.small, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] }}>
              {Math.round(d.value * 10) / 10}{suffix}
            </Text>
            <Text numberOfLines={1} style={{ ...type.small, fontSize: 11, color: colors.faint }}>{d.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── one bar per subject ─────────────────────────────────────────────────────
export function Bars({ items = [], max = 100, showValue = true, emptyLabel = 'No marks yet.' }) {
  if (!items.length) {
    return <Text style={{ ...type.small, color: colors.faint, paddingVertical: spacing.md }}>{emptyLabel}</Text>;
  }
  return (
    <View style={{ gap: 10 }}>
      {items.map((it, i) => {
        const v = num(it.value);
        const pct = v == null ? 0 : Math.max(0, Math.min(100, (v / max) * 100));
        const fill = it.color || colorForScore(v);
        return (
          <View key={i}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: 4 }}>
              <Text numberOfLines={1} style={{ ...type.small, fontWeight: '700', color: colors.text, flex: 1 }}>{it.label}</Text>
              {it.note ? <Text style={{ ...type.small, color: colors.muted }}>{it.note}</Text> : null}
              {showValue ? (
                <Text style={{ ...type.small, fontWeight: '800', color: v == null ? colors.faint : fill, fontVariant: ['tabular-nums'] }}>
                  {v == null ? '—' : Math.round(v * 10) / 10}
                </Text>
              ) : null}
            </View>
            <View style={styles.track}>
              <View style={{ width: `${pct}%`, height: '100%', borderRadius: 999, backgroundColor: fill }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ── a single proportion ─────────────────────────────────────────────────────
export function Meter({ value = 0, total = 0, label, goodAbove = 90, suffix = '%', caption }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : null;
  const fill = pct == null ? colors.faint
    : pct >= goodAbove ? palette.green600
      : pct >= goodAbove - 15 ? palette.amber500
        : palette.red500;
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ ...type.micro, color: colors.faint }}>{String(label || '').toUpperCase()}</Text>
        <Text style={{ ...type.title, fontSize: 20, color: fill, fontVariant: ['tabular-nums'] }}>
          {pct == null ? '—' : `${pct}${suffix}`}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={{ width: `${pct || 0}%`, height: '100%', borderRadius: 999, backgroundColor: fill }} />
      </View>
      {caption ? <Text style={{ ...type.small, color: colors.muted, marginTop: 5 }}>{caption}</Text> : null}
    </View>
  );
}

// ── a strip of days ─────────────────────────────────────────────────────────
// The register at a glance. Three Mondays missed in a row is a pattern a
// running total hides and a strip of squares makes obvious.
export function DayStrip({ days = [], limit = 60 }) {
  const shown = days.slice(0, limit);
  if (!shown.length) return <Text style={{ ...type.small, color: colors.faint }}>Nothing recorded yet.</Text>;
  const bg = { present: palette.green100, absent: palette.red100, late: palette.amber100, exempt: colors.borderSoft, paid: palette.green100, unpaid: palette.red100 };
  const fg = { present: palette.green600, absent: palette.red600, late: palette.amber600, exempt: colors.muted, paid: palette.green600, unpaid: palette.red600 };
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
      {shown.map((d, i) => (
        <View key={i} style={{
          paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.xs,
          backgroundColor: bg[d.status] || colors.borderSoft,
        }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: fg[d.status] || colors.muted, fontVariant: ['tabular-nums'] }}>
            {String(d.date || '').slice(5)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 9, borderRadius: 999, backgroundColor: colors.borderSoft, overflow: 'hidden' },
});

export default { Trend, Bars, Meter, DayStrip, toneForScore, colorForScore };
