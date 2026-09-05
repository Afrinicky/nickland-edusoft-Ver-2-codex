// Nickland Edusoft — the dashboard, drawn the way the installed app draws it.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Every piece the desktop's dashboards are built from, reproduced: the metric
// card with the tinted disc, the income-against-expenditure chart, the fee
// collection donut, the debtor row with its avatar, the payment row, the class
// bar, the ranking row, the schedule strip. Measurements come from
// src/renderer/src/styles/index.css — the same 44px disc, the same 22px
// figure, the same 200px chart, the same 160px ring.
//
// ── Why there is real SVG in here ──────────────────────────────────────────
//
// The installed application draws its two charts in SVG, and they are the
// reason its dashboard looks like a piece of software rather than a list of
// numbers. This app ships no charting dependency and no react-native-svg: on a
// phone that means a native module, a rebuild, and an APK a school has to
// re-download over a connection it is paying for by the megabyte.
//
// But in a browser the renderer underneath React Native Web IS react-dom, so a
// lowercase `svg` element is a real SVG element. That costs nothing, ships
// nothing, and gets the desktop's own chart — the filled areas, the hairline
// grid, the dots on each month — pixel for pixel.
//
// So: SVG on the web, and on a handset the same figures as bars and a dial
// built out of Views. `Platform.OS` decides, once, in `Svg` below. Nothing
// else in this file knows which it is, and the phone app is unchanged.

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Platform, Pressable } from 'react-native';
import { colors, palette, type, spacing, radius, shadow, motion } from './theme';
import { Icon } from './icons';
import { Avatar, Gradient, ProgressRing, figureSize } from './ui';
import { Press, Appear } from './motion';
import { useLayout } from './responsive';

const IS_WEB = Platform.OS === 'web';

export const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Ghana's cedi, formatted as the desktop's `fmtCedi` formats it. */
export function ghs(n) {
  if (n === null || n === undefined || n === '') return 'GHS 0.00';
  return 'GHS ' + num(n).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * "Today, 14:32" — the desktop's own `fmtTime`.
 *
 * A receipt written this morning says so. A date on its own makes a person
 * work out whether 04/09 was today, and at a counter with a queue they do not.
 */
export function whenLabel(ts) {
  if (!ts) return '';
  const d = new Date(String(ts).length <= 10 ? `${ts}T00:00:00` : ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}, ${time}`;
}

export function dateLabel(v) {
  if (!v) return '—';
  const d = new Date(String(v).length <= 10 ? `${v}T00:00:00` : v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-GB');
}

export const fullName = (r) => `${(r && r.surname) || ''} ${(r && r.first_name) || ''}`.trim();

/** `student_fees` → `Student Fees`, as the desktop's `labelize` does it. */
export function labelize(s) {
  if (!s) return '';
  return String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ══ SVG, where there is one ═════════════════════════════════════════════════
//
// A thin shim: on the web these are real DOM elements, and on a handset they
// render nothing at all, so a caller must offer a fallback. Every caller in
// this file does.

export const canDrawSvg = IS_WEB;
const svg = (tag) => (props) => React.createElement(tag, props);
const Svg = svg('svg');
const SPolyline = svg('polyline');
const SPolygon = svg('polygon');
const SLine = svg('line');
const SCircle = svg('circle');
const SText = svg('text');

// ══ Metric card ═════════════════════════════════════════════════════════════
//
// The desktop's `.metric-card`: a 44px tinted disc on the left, and on the
// right the label, the figure, one line of context, and — where there is
// somewhere to go — a link.
//
// The context line is the part that matters. "GHS 0.00" is not a fact anybody
// can act on; "GHS 0.00 — 0 students" says the school has no arrears, which is
// a different statement and the one a head teacher is reading for.

export const METRIC_TONES = {
  blue:   { fill: '#EFF6FF', ink: '#1D4ED8' },
  green:  { fill: '#F0FDF4', ink: '#15803D' },
  red:    { fill: '#FEF2F2', ink: '#B91C1C' },
  orange: { fill: '#FFF7ED', ink: '#C2410C' },
  purple: { fill: '#FAF5FF', ink: '#7C3AED' },
};

const VALUE_INK = {
  success: '#15803D',
  danger:  colors.danger,
  accent:  colors.accent,
  default: colors.text,
};

export function MetricCard({
  label, value, sub, link, onPress, icon, tone = 'blue', valueTone = 'default',
  index = 0, extra,
}) {
  const t = METRIC_TONES[tone] || METRIC_TONES.blue;
  return (
    <Appear delay={Math.min(index, 6) * motion.stagger} distance={10}>
      <View style={styles.metric}>
        <View style={[styles.metricIcon, { backgroundColor: t.fill }]}>
          <Icon name={icon} size={22} color={t.ink} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={2} style={styles.metricLabel}>{label}</Text>
          {/* "GHS 15,600.00" is thirteen characters, and a fifth of a
              1400-pixel window is not thirteen characters at 22px. The desktop
              lets it overflow its card; here it steps down a size instead,
              because a figure cut to "GHS 15,6…" is a dashboard that looks
              fine and says nothing. Money is never abbreviated to "15.6k" —
              a head teacher reading the term's income wants the pesewas. */}
          <Text numberOfLines={1} style={[styles.metricValue,
            { fontSize: figureSize(value, 22), color: VALUE_INK[valueTone] || VALUE_INK.default }]}>
            {value}
          </Text>
          {sub ? <Text numberOfLines={2} style={styles.metricSub}>{sub}</Text> : null}
          {extra}
          {link ? <MetricLink label={link} onPress={onPress} /> : null}
        </View>
      </View>
    </Appear>
  );
}

export function MetricLink({ label, onPress, tone }) {
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      onPress={onPress} disabled={!onPress} accessibilityRole="link"
      onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
    >
      <Text numberOfLines={2} style={[
        styles.metricLinkText,
        tone === 'danger' && { color: colors.danger },
        hover && { textDecorationLine: 'underline' },
      ]}>{label}</Text>
    </Pressable>
  );
}

/**
 * The row of metric cards. Five across on the main dashboard, four in a
 * module, and however many fit on a narrower window.
 *
 * The gutters are cell PADDING inside a negatively-margined row, not `gap`.
 * That is not a stylistic preference: a percentage `flexBasis` is a share of
 * the container, and `gap` adds pixels on top of it, so five cells at 20% plus
 * four 14px gaps overflow by 56px and the fifth card drops to a row of its
 * own. The desktop shows five; five is what this shows.
 */
export function MetricRow({ children, columns = 5 }) {
  const layout = useLayout();
  const cells = React.Children.toArray(children).filter(Boolean);
  const across = layout.isDesktop ? columns : layout.isTablet ? Math.min(3, columns) : 1;
  return (
    <View style={styles.metricRow}>
      {cells.map((child, i) => (
        <View key={i} style={[styles.metricCell, { flexBasis: `${100 / across}%` }]}>
          {child}
        </View>
      ))}
    </View>
  );
}

// ══ Section card ════════════════════════════════════════════════════════════
//
// The desktop's `.card` with a `.section-header`: a title on the left and,
// where there is more of the thing behind it, "View all →" on the right.

export function SectionCard({ title, icon, right, viewAll, onViewAll, children, footer, style, padded = true }) {
  return (
    <View style={[styles.card, style]}>
      {(title || right || viewAll) ? (
        <View style={styles.sectionHead}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
            {icon ? <Icon name={icon} size={16} color={colors.text} /> : null}
            <Text numberOfLines={1} style={styles.sectionTitle}>{title}</Text>
          </View>
          {viewAll ? <ViewAll label={viewAll} onPress={onViewAll} /> : right}
        </View>
      ) : null}
      <View style={padded ? null : { marginHorizontal: -spacing.lg, marginBottom: -spacing.lg }}>
        {children}
      </View>
      {footer ? <View style={styles.sectionFooter}>{footer}</View> : null}
    </View>
  );
}

export function ViewAll({ label = 'View all →', onPress }) {
  const [hover, setHover] = useState(false);
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="link"
               onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}>
      <Text style={[styles.viewAll, hover && { textDecorationLine: 'underline' }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * The desktop's rows of cards: `dash-row` with explicit column weights —
 * 1.4 / 1 / 1.2 on the main dashboard, so the chart gets the width it needs
 * and the schedule does not sit in a column of its own.
 *
 * Same gutter rule as MetricRow: padding, not gap, so the weights add up to
 * exactly the row and the third panel stays on it.
 */
export function DashRow({ children, weights }) {
  const layout = useLayout();
  const kids = React.Children.toArray(children).filter(Boolean);
  const w = weights && weights.length === kids.length ? weights : kids.map(() => 1);
  const total = w.reduce((a, b) => a + b, 0) || 1;
  return (
    <View style={styles.dashRow}>
      {kids.map((child, i) => (
        <View key={i} style={[styles.dashCell,
          layout.isDesktop ? { flexBasis: `${((w[i] || 1) / total) * 100}%` } : { flexBasis: '100%' }]}>
          {child}
        </View>
      ))}
    </View>
  );
}

export function EmptyLine({ children, height }) {
  return (
    <View style={[styles.empty, height ? { height, justifyContent: 'center' } : null]}>
      <Text style={styles.emptyText}>{children}</Text>
    </View>
  );
}

/** The desktop's `.info-banner`: a tinted strip with a coloured rule down its
 *  left-hand edge, for a setting somebody should know is on or off. */
export function Banner({ children, tone = 'info' }) {
  const t = tone === 'warning'
    ? { bg: palette.amber100, rule: colors.warning }
    : tone === 'danger' ? { bg: palette.red100, rule: colors.danger }
      : { bg: colors.primarySoft, rule: colors.primary };
  return (
    <View style={[styles.banner, { backgroundColor: t.bg, borderLeftColor: t.rule }]}>
      <Text style={styles.bannerText}>{children}</Text>
    </View>
  );
}

// ══ Income against expenditure ══════════════════════════════════════════════
//
// The desktop's chart: two filled areas, two lines, a dot per month, a dashed
// grid at the quarters, the months along the bottom and the scale up the left
// in thousands. Drawn to the same 100×60 viewBox it uses, so the line weights
// and the dot radii come out identical.

const INCOME_INK = '#3B82F6';
const EXPENSE_INK = '#F59E0B';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (ym) => MONTHS[parseInt(String(ym).split('-')[1], 10) - 1] || String(ym);

export function IncomeExpenseChart({ income = [], expense = [], height = 200 }) {
  const months = useMemo(() => {
    const set = new Set();
    (income || []).forEach(d => set.add(d.ym));
    (expense || []).forEach(d => set.add(d.ym));
    return Array.from(set).filter(Boolean).sort();
  }, [income, expense]);

  if (!months.length) return <EmptyLine height={height}>No data this term yet</EmptyLine>;

  const incomeMap = Object.fromEntries((income || []).map(d => [d.ym, num(d.total)]));
  const expenseMap = Object.fromEntries((expense || []).map(d => [d.ym, num(d.total)]));
  const incomeData = months.map(m => incomeMap[m] || 0);
  const expenseData = months.map(m => expenseMap[m] || 0);
  const maxVal = Math.max(...incomeData, ...expenseData, 1);

  const legend = (
    <View style={styles.chartLegend}>
      <LegendChip color={INCOME_INK} label="Income (GHS)" />
      <LegendChip color={EXPENSE_INK} label="Expenses (GHS)" />
    </View>
  );

  if (!canDrawSvg) {
    // A handset gets the same two series as paired bars per month. It is the
    // honest reduction: the shape of the comparison survives, and nothing
    // native has to be installed to draw it.
    return (
      <View>
        {legend}
        <View style={{ gap: 10 }}>
          {months.map((m, i) => (
            <View key={m}>
              <Text style={styles.chartRowLabel}>{monthName(m)}</Text>
              <MiniBar value={incomeData[i]} max={maxVal} color={INCOME_INK} />
              <View style={{ height: 4 }} />
              <MiniBar value={expenseData[i]} max={maxVal} color={EXPENSE_INK} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  const W = 100, H = 60;
  const xAt = (i) => (months.length === 1 ? W / 2 : (i / (months.length - 1)) * W);
  const yAt = (v) => H - (v / maxVal) * H;
  const points = (arr) => arr.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ');

  return (
    <View style={styles.chartWrap}>
      {legend}
      <View style={{ flexDirection: 'row' }}>
        <View style={[styles.chartYAxis, { height }]}>
          {[1, 0.75, 0.5, 0.25, 0].map(f => (
            <Text key={f} style={styles.axisText}>
              {f === 0 ? '0' : `${Math.round((maxVal * f) / 1000)}K`}
            </Text>
          ))}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
               width="100%" height={height} style={{ display: 'block', overflow: 'visible' }}>
            {[0.25, 0.5, 0.75].map(f => (
              <SLine key={f} x1="0" y1={H * f} x2={W} y2={H * f}
                     stroke="#E5E7EB" strokeWidth="0.2" strokeDasharray="0.5,0.5" />
            ))}
            <SPolygon points={`0,${H} ${points(expenseData)} ${W},${H}`} fill={EXPENSE_INK} fillOpacity="0.15" />
            <SPolygon points={`0,${H} ${points(incomeData)} ${W},${H}`} fill={INCOME_INK} fillOpacity="0.15" />
            <SPolyline points={points(expenseData)} fill="none" stroke={EXPENSE_INK} strokeWidth="0.5" />
            <SPolyline points={points(incomeData)} fill="none" stroke={INCOME_INK} strokeWidth="0.5" />
            {incomeData.map((v, i) => (
              <SCircle key={`i${i}`} cx={xAt(i)} cy={yAt(v)} r="0.7" fill={INCOME_INK} />
            ))}
            {expenseData.map((v, i) => (
              <SCircle key={`e${i}`} cx={xAt(i)} cy={yAt(v)} r="0.7" fill={EXPENSE_INK} />
            ))}
          </Svg>
          <View style={styles.chartXAxis}>
            {months.map(m => <Text key={m} style={styles.axisText}>{monthName(m)}</Text>)}
          </View>
        </View>
      </View>
    </View>
  );
}

function MiniBar({ value, max, color }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <View style={styles.miniTrack}>
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} />
    </View>
  );
}

export function LegendChip({ color, label }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendItemText}>{label}</Text>
    </View>
  );
}

// ══ The fee collection donut ════════════════════════════════════════════════
//
// A ring in two colours with the percentage in the middle and the two figures
// beside it. The desktop draws a 160px SVG ring of stroke 18; this is that,
// and on a handset it is the app's own dial, which is the same reading in a
// smaller frame.

const COLLECTED_INK = '#22C55E';
const OUTSTANDING_INK = '#EF4444';

export function CollectionDonut({ collected, outstanding, total, pct = 0, size = 160 }) {
  const p = Math.max(0, Math.min(100, Math.round(num(pct))));
  return (
    <View style={styles.donutRow}>
      <View style={{ flexShrink: 0 }}>
        {canDrawSvg ? <DonutSvg pct={p} size={size} /> : <ProgressRing value={p} size={124} thickness={16} tone="success" label="Collected" />}
      </View>
      <View style={styles.donutLegend}>
        <LegendRow color={COLLECTED_INK} label="Collected" value={`${ghs(collected)} (${p}%)`} />
        <LegendRow color={OUTSTANDING_INK} label="Outstanding" value={`${ghs(outstanding)} (${100 - p}%)`} />
        <View style={styles.legendTotal}>
          <Text style={styles.legendTotalLabel}>Total Fees</Text>
          <Text style={styles.legendTotalValue}>{ghs(total)}</Text>
        </View>
      </View>
    </View>
  );
}

function DonutSvg({ pct, size }) {
  const stroke = Math.round(size * 0.1125);       // 18 at 160, as the desktop
  const r = size / 2 - stroke / 2;
  const circumference = 2 * Math.PI * r;
  const lit = (pct / 100) * circumference;
  const c = size / 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <SCircle cx={c} cy={c} r={r} stroke={OUTSTANDING_INK} strokeWidth={stroke} fill="none"
               transform={`rotate(-90 ${c} ${c})`} />
      <SCircle cx={c} cy={c} r={r} stroke={COLLECTED_INK} strokeWidth={stroke} fill="none"
               strokeDasharray={`${lit} ${circumference}`} strokeLinecap="butt"
               transform={`rotate(-90 ${c} ${c})`} />
      <SText x={c} y={c - 2} textAnchor="middle" fontSize={size * 0.175} fontWeight="700"
             fill={colors.text} style={{ fontFamily: 'inherit' }}>{`${pct}%`}</SText>
      <SText x={c} y={c + 18} textAnchor="middle" fontSize={size * 0.069}
             fill={colors.muted} style={{ fontFamily: 'inherit' }}>Collected</SText>
    </Svg>
  );
}

function LegendRow({ color, label, value }) {
  return (
    <View style={styles.legendRow}>
      <View style={[styles.legendDot, { backgroundColor: color, marginTop: 4 }]} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.legendLabel}>{label}</Text>
        <Text style={styles.legendValue}>{value}</Text>
      </View>
    </View>
  );
}

// ══ Lists ═══════════════════════════════════════════════════════════════════

/**
 * One debtor: the avatar, the admission number above the name, the class
 * beneath it, and on the right what is owed and for how long.
 *
 * "How long" is not decoration. A family three days behind on the canteen and a
 * family ninety days behind on the fees are two different conversations, and
 * the amount alone does not tell them apart.
 */
export function DebtorRow({ person, amount, days, daysSuffix = 'days', onPress, last }) {
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      onPress={onPress} disabled={!onPress}
      onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
      style={[styles.listRow, last && styles.listRowLast, hover && onPress && styles.listRowHover]}
    >
      <Avatar name={fullName(person)} photo={person.photo || person.photo_path} size={34} />
      <View style={{ flex: 1, minWidth: 0 }}>
        {person.index_number ? <Text numberOfLines={1} style={styles.rowCode}>{person.index_number}</Text> : null}
        <Text numberOfLines={1} style={styles.rowName}>{fullName(person)}</Text>
        {person.class_code || person.class_name
          ? <Text numberOfLines={1} style={styles.rowMeta}>{person.class_code || person.class_name}</Text>
          : null}
      </View>
      <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
        <Text style={styles.rowAmountDanger}>{ghs(amount)}</Text>
        {days != null ? <Text style={styles.rowMetaTight}>{`${Math.max(0, Math.round(num(days)))} ${daysSuffix}`}</Text> : null}
      </View>
    </Pressable>
  );
}

/** One receipt: what it was for on the left, what it came to on the right. */
export function PaymentRow({ code, name, note, amount, when, tone = 'success', last }) {
  return (
    <View style={[styles.listRow, last && styles.listRowLast]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {code ? <Text numberOfLines={1} style={styles.rowCode}>{code}</Text> : null}
        <Text numberOfLines={1} style={styles.rowName}>{name}</Text>
        {note ? <Text numberOfLines={1} style={styles.rowMeta}>{note}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
        <Text style={[styles.rowAmount, tone === 'danger' && { color: colors.danger }]}>{amount}</Text>
        {when ? <Text style={styles.rowMetaTight}>{when}</Text> : null}
      </View>
    </View>
  );
}

/** A ranked pupil: the position in a disc, gold for the first three. */
export function RankRow({ rank, name, meta, score, onPress }) {
  const [hover, setHover] = useState(false);
  return (
    <Pressable onPress={onPress} disabled={!onPress}
               onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
               style={[styles.rankRow, hover && onPress && styles.listRowHover]}>
      <View style={[styles.rankBadge, rank <= 3 && styles.rankBadgeTop]}>
        <Text style={[styles.rankBadgeText, rank <= 3 && { color: '#fff' }]}>{rank}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={styles.rowName}>{name}</Text>
        {meta ? <Text numberOfLines={1} style={styles.rowMeta}>{meta}</Text> : null}
      </View>
      <Text style={styles.rankScore}>{score}</Text>
    </Pressable>
  );
}

/**
 * The school day, as a strip with the gold rule down the left.
 *
 * Fixed hours until the timetable module owns them, and the desktop says so in
 * the same words, so nobody reading the two side by side has to wonder which
 * of them is out of date.
 */
export function ScheduleList({ items = [] }) {
  if (!items.length) return <EmptyLine>Nothing scheduled</EmptyLine>;
  return (
    <View>
      {items.map(item => (
        <View key={item.id} style={styles.scheduleItem}>
          <Text style={styles.scheduleTime}>{`${item.start} — ${item.end}`}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={styles.scheduleTitle}>{item.title}</Text>
            <Text numberOfLines={1} style={styles.scheduleSub}>{item.sub}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ══ Bars ════════════════════════════════════════════════════════════════════

/**
 * The desktop's `.class-bar-row`: a label, a track, a count. Used for pupils
 * per class, staff per role, and money per category.
 */
export function BarList({ items = [], color, empty = 'Nothing to show', valueWidth = 44, format }) {
  if (!items.length) return <EmptyLine>{empty}</EmptyLine>;
  const max = Math.max(...items.map(i => num(i.value)), 1);
  return (
    <View style={{ gap: 8 }}>
      {items.map((it, i) => (
        <View key={`${it.label}-${i}`} style={styles.barRow}>
          <Text numberOfLines={1} style={styles.barLabel}>{it.label}</Text>
          <View style={styles.barTrack}>
            <View style={{
              width: `${(num(it.value) / max) * 100}%`, height: '100%',
              borderRadius: 4, backgroundColor: it.color || color || colors.primary,
            }} />
          </View>
          <Text numberOfLines={1} style={[styles.barCount, { minWidth: valueWidth }]}>
            {format ? format(it.value) : String(it.value)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The thin bar under a percentage in a table cell. */
export function AvgBar({ value, max = 100, color, width = 80 }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (num(value) / max) * 100 : 0));
  return (
    <View style={[styles.avgTrack, { width }]}>
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color || colors.primary }} />
    </View>
  );
}

/** The colour a mark or a collection rate is worth — the desktop's thresholds. */
export function rateInk(v) {
  if (v == null) return colors.muted;
  if (v >= 80) return '#15803D';
  if (v >= 70) return '#0369A1';
  if (v >= 60) return '#B45309';
  return '#B91C1C';
}

export function collectionInk(pct) {
  return pct >= 70 ? '#15803D' : pct >= 40 ? '#B45309' : '#B91C1C';
}

/** Two segments of one bar: the desktop's gender split. */
export function SplitBar({ segments = [] }) {
  const total = segments.reduce((n, s) => n + num(s.value), 0) || 1;
  return (
    <View style={styles.splitTrack}>
      {segments.map((s, i) => (
        <View key={i} style={{ width: `${(num(s.value) / total) * 100}%`, height: '100%', backgroundColor: s.color }} />
      ))}
    </View>
  );
}

export function SplitRow({ color, label, count, pct }) {
  return (
    <View style={styles.splitRow}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={[styles.legendDot, { backgroundColor: color }]} />
        <Text style={styles.splitLabel}>{label}</Text>
      </View>
      <Text style={styles.splitValue}>
        <Text style={{ fontWeight: '800', color: colors.text }}>{count}</Text>
        <Text style={{ color: colors.muted }}>{`  (${pct}%)`}</Text>
      </Text>
    </View>
  );
}

// ══ Buttons ═════════════════════════════════════════════════════════════════

/** The desktop's `.quick-action-btn`: an icon and a label, in a tinted box. */
export function QuickAction({ icon, label, onPress }) {
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
      style={[styles.quickAction, hover && styles.quickActionHover]}
    >
      <Icon name={icon} size={20} color={hover ? colors.primary : colors.textSoft} />
      <Text numberOfLines={2} style={[styles.quickActionText, hover && { color: colors.primary }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Finance's four coloured cards. The one place in the product where a control
 * is a block of colour rather than a bordered box, and it earns it: recording
 * money and recording a bill are the two things that screen exists for, and
 * they should not look like the report links beside them.
 */
// The same four gradients the desktop uses, at the same 135°.
export const ACTION_INKS = {
  income:  ['#15803D', '#22C55E'],
  expense: ['#B91C1C', '#EF4444'],
  reports: ['#1B3A6B', '#3B82F6'],
  budget:  ['#C9961A', '#F59E0B'],
};

export function ActionCard({ icon, title, sub, tone = 'income', onPress }) {
  const stops = ACTION_INKS[tone] || ACTION_INKS.income;
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      <Gradient colors={stops} angle={135} style={styles.actionCard}>
        <View style={styles.actionIcon}>
          <Icon name={icon} size={20} color="#fff" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={styles.actionTitle}>{title}</Text>
          <Text numberOfLines={2} style={styles.actionSub}>{sub}</Text>
        </View>
      </Gradient>
    </Press>
  );
}

/** A row of things that wrap: quick actions, action cards, hire cards. */
export function CardGrid({ children, min = 220 }) {
  return (
    <View style={styles.cardGrid}>
      {React.Children.map(children, (child, i) => (child ? (
        <View key={i} style={{ flexGrow: 1, flexBasis: min, minWidth: min }}>{child}</View>
      ) : null))}
    </View>
  );
}

// ══ styles ══════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  // ── metric card ──
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -7, marginBottom: 4 },
  metricCell: { flexGrow: 1, flexShrink: 1, minWidth: 188, paddingHorizontal: 7, paddingBottom: 14 },
  metric: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingVertical: 18, paddingHorizontal: 20,
    flexDirection: 'row', alignItems: 'flex-start', gap: 14, minHeight: 118,
    ...shadow.rest,
  },
  metricIcon: {
    width: 44, height: 44, borderRadius: 22, flexShrink: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  metricLabel: { ...type.small, fontSize: 12, color: colors.muted, marginBottom: 4 },
  metricValue: { ...type.numeric, fontSize: 22, lineHeight: 26 },
  metricSub: { ...type.small, fontSize: 11, color: colors.muted, marginTop: 2, lineHeight: 15 },
  metricLinkText: { ...type.small, fontSize: 12, fontWeight: '600', color: colors.primary, marginTop: 8 },

  // ── card and section ──
  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.lg, ...shadow.rest,
  },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.md, marginBottom: 14,
  },
  sectionTitle: { ...type.small, fontSize: 14, fontWeight: '700', color: colors.text },
  viewAll: { ...type.small, fontSize: 12, fontWeight: '600', color: colors.primary },
  sectionFooter: {
    alignItems: 'center', marginTop: 14, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  dashRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -8, marginBottom: 2 },
  dashCell: { flexGrow: 1, flexShrink: 1, minWidth: 300, paddingHorizontal: 8, paddingBottom: 16 },

  empty: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: spacing.lg },
  emptyText: { ...type.small, fontSize: 12, color: colors.muted, textAlign: 'center' },

  banner: {
    borderLeftWidth: 3, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 14,
    marginBottom: 14,
  },
  bannerText: { ...type.small, fontSize: 13, color: colors.text, lineHeight: 19 },

  // ── charts ──
  chartWrap: { width: '100%' },
  chartLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendItemText: { ...type.small, fontSize: 12, color: colors.muted },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  chartYAxis: {
    width: 32, justifyContent: 'space-between', alignItems: 'flex-start', paddingRight: 4,
  },
  chartXAxis: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingTop: 6, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border,
  },
  axisText: { ...type.small, fontSize: 10.5, color: colors.muted },
  chartRowLabel: { ...type.small, fontSize: 11, color: colors.muted, marginBottom: 3 },
  miniTrack: { height: 8, borderRadius: 4, backgroundColor: colors.borderSoft, overflow: 'hidden' },

  // ── donut ──
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  donutLegend: { flex: 1, minWidth: 150, gap: 10 },
  legendRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  legendLabel: { ...type.small, fontSize: 12, color: colors.muted, marginBottom: 1 },
  legendValue: { ...type.small, fontSize: 12, fontWeight: '600', color: colors.text },
  legendTotal: {
    paddingTop: 10, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border,
    borderStyle: 'dashed',
  },
  legendTotalLabel: { ...type.small, fontSize: 11, color: colors.muted },
  legendTotalValue: { ...type.small, fontSize: 14, fontWeight: '700', color: colors.text },

  // ── list rows ──
  listRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, paddingHorizontal: 4, borderRadius: 4,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  listRowLast: { borderBottomWidth: 0 },
  listRowHover: { backgroundColor: colors.surfaceAlt },
  rowCode: {
    ...type.small, fontSize: 10.5, color: colors.muted,
    ...(IS_WEB ? { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } : null),
  },
  rowName: { ...type.small, fontSize: 12.5, fontWeight: '600', color: colors.text },
  rowMeta: { ...type.small, fontSize: 11, color: colors.muted },
  rowMetaTight: { ...type.small, fontSize: 10.5, color: colors.muted, marginTop: 2 },
  rowAmount: { ...type.small, fontSize: 12.5, fontWeight: '700', color: '#15803D', fontVariant: ['tabular-nums'] },
  rowAmountDanger: { ...type.small, fontSize: 12.5, fontWeight: '700', color: colors.danger, fontVariant: ['tabular-nums'] },

  rankRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 9, paddingHorizontal: 6, borderRadius: 6,
  },
  rankBadge: {
    width: 28, height: 28, borderRadius: 14, flexShrink: 0,
    backgroundColor: colors.borderSoft, alignItems: 'center', justifyContent: 'center',
  },
  rankBadgeTop: { backgroundColor: colors.accent },
  rankBadgeText: { ...type.small, fontSize: 12, fontWeight: '800', color: colors.muted },
  rankScore: { ...type.small, fontSize: 14, fontWeight: '800', color: '#15803D', fontVariant: ['tabular-nums'] },

  scheduleItem: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingVertical: 8, paddingLeft: 12, marginBottom: 10,
    borderLeftWidth: 3, borderLeftColor: colors.accent,
  },
  scheduleTime: { ...type.small, fontSize: 11, color: colors.muted, minWidth: 88 },
  scheduleTitle: { ...type.small, fontSize: 13, fontWeight: '600', color: colors.text },
  scheduleSub: { ...type.small, fontSize: 11, color: colors.muted },

  // ── bars ──
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { ...type.small, fontSize: 12, color: colors.text, width: 110, flexShrink: 0 },
  barTrack: { flex: 1, height: 16, borderRadius: 4, backgroundColor: colors.borderSoft, overflow: 'hidden' },
  barCount: { ...type.small, fontSize: 12, fontWeight: '700', color: colors.text, textAlign: 'right', fontVariant: ['tabular-nums'] },
  avgTrack: { height: 6, borderRadius: 3, backgroundColor: colors.borderSoft, overflow: 'hidden' },

  splitTrack: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.borderSoft },
  splitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  splitLabel: { ...type.small, fontSize: 13, color: colors.text },
  splitValue: { ...type.small, fontSize: 13 },

  // ── buttons ──
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  quickAction: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.control, paddingVertical: 14, paddingHorizontal: 16, minHeight: 54,
  },
  quickActionHover: { backgroundColor: colors.primarySoft, borderColor: colors.primaryLine },
  quickActionText: { ...type.small, fontSize: 13, fontWeight: '600', color: colors.text, flex: 1 },

  actionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: radius.md, paddingVertical: 16, paddingHorizontal: 18, minHeight: 76,
    ...shadow.rest,
  },
  actionIcon: {
    width: 38, height: 38, borderRadius: 19, flexShrink: 0,
    backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center',
  },
  actionTitle: { ...type.small, fontSize: 14, fontWeight: '800', color: '#fff', marginBottom: 2 },
  actionSub: { ...type.small, fontSize: 11, color: 'rgba(255,255,255,0.9)', lineHeight: 15 },
});

export default {
  MetricCard, MetricRow, SectionCard, DashRow, IncomeExpenseChart, CollectionDonut,
  DebtorRow, PaymentRow, RankRow, ScheduleList, BarList, AvgBar, SplitBar, SplitRow,
  QuickAction, ActionCard, CardGrid, EmptyLine, Banner, ghs, whenLabel,
};
