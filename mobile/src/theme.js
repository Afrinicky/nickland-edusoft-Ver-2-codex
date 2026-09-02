// Nickland Edusoft — design tokens for the phone and the browser.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// One palette, one type scale, one set of elevations, used by every screen.
// The identity is the desktop's — deep navy and gold — carried forward and
// given the depth a 2026 app is expected to have: layered navies for chrome,
// hairline borders instead of heavy strokes, and a single cyan reserved for
// live data so it means something when it appears.
//
// The rule for colour here: a hue is either structural (navy), an action
// (primary), a value judgement (success / warning / danger) or data (cyan).
// Nothing is coloured because it looked nice; a screen that uses six accents
// has told the reader nothing.

// ── raw palette ─────────────────────────────────────────────────────────────
export const palette = {
  // Navy, dark to light. The chrome — sidebar, headers, the signed-out shell.
  navy900: '#07142B',
  navy800: '#0B1E3D',
  navy700: '#12294F',
  navy600: '#1B3A6B',   // the brand navy, unchanged from the desktop
  navy500: '#27508C',
  navy400: '#3E6BAE',
  navy300: '#7C9BCB',

  // Gold. The school's mark: used sparingly, for emphasis and never for text
  // on white, where it does not carry enough contrast.
  gold600: '#A97C12',
  gold500: '#C9961A',
  gold400: '#E0AE2E',
  gold200: '#F5DFA6',

  // Cyan. Reserved for live and computed values — a sync badge, a chart line,
  // a "pending" pill. It is the only cool accent, so it always reads as data.
  cyan600: '#0E9AA7',
  cyan500: '#17B8C4',
  cyan300: '#7BE0E8',

  // Neutrals.
  ink900: '#0B1220',
  ink700: '#1E293B',
  ink500: '#475569',
  ink400: '#64748B',
  ink300: '#94A3B8',
  line: '#E4EAF2',
  lineSoft: '#EFF3F9',
  surface: '#FFFFFF',
  surfaceAlt: '#F8FAFD',
  canvas: '#F2F5FA',

  green600: '#0E8F5B',
  green500: '#10B981',
  green100: '#DCFCE7',
  amber600: '#B45309',
  amber500: '#F59E0B',
  amber100: '#FEF3C7',
  red600: '#B91C1C',
  red500: '#DC2626',
  red100: '#FEE2E2',
  blue600: '#1D4ED8',
  blue500: '#3B82F6',
  blue100: '#DBEAFE',
  violet500: '#7C3AED',
  violet100: '#EDE9FE',
};

// ── semantic colours ────────────────────────────────────────────────────────
// Screens use these, never the raw palette, so the identity can change in one
// place. The first block keeps the names the original screens were written
// against, so nothing had to be rewritten to adopt the rest.
export const colors = {
  primary: palette.navy600,
  primaryDark: palette.navy700,
  accent: palette.gold500,
  bg: palette.canvas,
  card: palette.surface,
  text: palette.ink900,
  muted: palette.ink400,
  success: palette.green600,
  danger: palette.red600,
  border: palette.line,

  // Added
  primarySoft: '#EAF0FA',
  accentSoft: '#FBF3DF',
  textSoft: palette.ink700,
  faint: palette.ink300,
  borderSoft: palette.lineSoft,
  surfaceAlt: palette.surfaceAlt,
  warning: palette.amber600,
  info: palette.blue600,
  data: palette.cyan600,

  // Chrome — the dark shell the app is framed in.
  chrome: palette.navy900,
  chromeAlt: palette.navy800,
  chromeLine: 'rgba(255,255,255,0.10)',
  onChrome: '#FFFFFF',
  onChromeMuted: 'rgba(255,255,255,0.62)',
};

// ── gradients ───────────────────────────────────────────────────────────────
// react-native-web renders these as CSS; on the phone they are approximated by
// a two-tone stack, so each one is defined as an ordered pair rather than a
// string, and the `Gradient` component in ui.jsx decides how to draw it.
export const gradients = {
  chrome: [palette.navy900, palette.navy700],
  brand: [palette.navy700, palette.navy500],
  gold: [palette.gold600, palette.gold400],
  data: [palette.cyan600, palette.navy500],
  success: ['#0E8F5B', '#34D399'],
  danger: ['#B91C1C', '#F87171'],
};

// ── type scale ──────────────────────────────────────────────────────────────
// Five sizes and nothing between them. Tight letter-spacing on the large
// weights is what stops a system font at 28px looking like a word processor.
export const type = {
  display: { fontSize: 30, fontWeight: '800', letterSpacing: -0.6, lineHeight: 36 },
  title:   { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, lineHeight: 28 },
  heading: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2, lineHeight: 23 },
  body:    { fontSize: 15, fontWeight: '500', lineHeight: 21 },
  small:   { fontSize: 13, fontWeight: '500', lineHeight: 18 },
  micro:   { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, lineHeight: 14 },
  // For figures — a balance, a mark, a count. Tabular so columns line up.
  numeric: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, pill: 999 };

// ── elevation ───────────────────────────────────────────────────────────────
// Three levels, no more. Shadows carry meaning — resting, raised, floating —
// and a screen where everything floats has no hierarchy at all.
export const shadow = {
  rest: {
    shadowColor: '#0B1220', shadowOpacity: 0.05, shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  raised: {
    shadowColor: '#0B1220', shadowOpacity: 0.09, shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  floating: {
    shadowColor: '#07142B', shadowOpacity: 0.20, shadowRadius: 34,
    shadowOffset: { width: 0, height: 14 }, elevation: 12,
  },
};

// ── breakpoints ─────────────────────────────────────────────────────────────
// The browser build has to fit a 320px Android phone and a 27-inch monitor from
// the same source. These are the three shapes it takes; see src/responsive.js.
export const breakpoints = { phone: 0, tablet: 768, desktop: 1180, wide: 1600 };

export default { palette, colors, gradients, type, spacing, radius, shadow, breakpoints };
