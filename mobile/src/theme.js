// Nickland Edusoft — design tokens for the phone and the browser.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// One palette, one type scale, one set of elevations, used by every screen and
// mirrored by the desktop's CSS (src/renderer/src/styles/index.css) and the
// print stylesheet. Change a value here and change it in all three.
//
// ── Why it looks like this ──────────────────────────────────────────────────
//
// The phone is used OUTDOORS, in Ghanaian daylight, at arm's length, one-handed,
// while something else is happening: a queue of children at the canteen door, a
// parent at the gate. That single fact decides almost everything below.
//
//   Light, not dark. A dark screen in direct sun is a mirror. Dark appears only
//   where it means something — the splash, the app's chrome, a profile header.
//
//   Hard contrast, not elegant grey. Body text sits at 9.6:1 and the muted tone
//   at 5.6:1, so nothing a person reads is below the 4.5:1 floor even at noon.
//   `ink400` is the one token under it and it is barred from text.
//
//   One accent doing real work. Violet marks the primary action and the current
//   position and nothing else. A screen using six accents has told the reader
//   nothing.
//
// The palette is restrained: tinted neutrals plus that one accent. The neutrals
// carry ~0.012 chroma toward violet — not toward warm, which is how every
// interface ends up the same shade of beige.

// ── raw palette ─────────────────────────────────────────────────────────────
export const palette = {
  // Violet. The action colour. 600 reads at 7.1:1 on white, so the same hue
  // works as a button fill AND as a text colour — one value instead of two
  // that drift apart.
  violet50:  '#F4F2FE',
  violet100: '#E9E4FD',
  violet200: '#D5CBFB',
  violet300: '#B8A6F7',
  violet400: '#957CF1',
  violet500: '#7455E9',
  violet600: '#5B3FE0',   // primary
  violet700: '#4A2FC7',   // pressed
  violet800: '#3B259E',
  violet900: '#2A1A6E',

  // Ink. Near-black with a violet cast, so text sits in the same family as the
  // accent rather than looking like it was pasted in from another design.
  ink950: '#15132B',   // chrome: splash, sidebar, profile header
  ink900: '#14142B',   // headings, figures            15.8:1 on white
  ink800: '#26263F',
  ink700: '#3A3A55',   // body                          9.6:1
  ink600: '#4C4C69',
  ink500: '#61617E',   // muted — still passes as body  5.6:1
  ink400: '#8A8AA3',   // DECORATION AND ICONS ONLY     3.4:1
  ink300: '#B4B4C8',
  ink200: '#D6D5E4',

  line:      '#E7E5F2',
  lineSoft:  '#F0EEF8',
  surface:   '#FFFFFF',
  surfaceAlt:'#FAF9FE',
  canvas:    '#F5F4FB',

  // Judgement. Each of these means something; none is decorative.
  green700: '#0B6B3C', green600: '#12864A', green500: '#1CA85E', green100: '#DCF5E7',
  amber700: '#8A4B04', amber600: '#B26205', amber500: '#E08A0B', amber100: '#FDF0D8',
  red700:   '#9F262B', red600:   '#C7343A', red500:   '#E14B51', red100:   '#FDE4E5',
  teal700:  '#0A6E6E', teal600:  '#0E8E8E', teal500:  '#14A8A8', teal100:  '#D6F2F2',
  pink600:  '#C43B7A', pink500:  '#E1568F', pink100:  '#FCE3EE',
  gold700:  '#7A5810', gold600:  '#A0761A', gold500:  '#C99A25', gold400:  '#E3B845', gold100:  '#FBF0D5',
};

// ── semantic colours ────────────────────────────────────────────────────────
// Screens use these, never the raw palette, so the identity can change in one
// place. Names kept from the first version so no screen had to be rewritten.
export const colors = {
  primary:     palette.violet600,
  primaryDark: palette.violet700,
  primarySoft: palette.violet50,
  primaryLine: palette.violet200,
  accent:      palette.gold500,
  accentSoft:  palette.gold100,

  bg:         palette.canvas,
  card:       palette.surface,
  surfaceAlt: palette.surfaceAlt,

  text:     palette.ink900,
  textSoft: palette.ink700,
  muted:    palette.ink500,
  faint:    palette.ink400,   // never body text

  border:     palette.line,
  borderSoft: palette.lineSoft,

  success: palette.green600,
  warning: palette.amber600,
  danger:  palette.red600,
  info:    palette.violet600,
  data:    palette.teal600,

  // Chrome — the dark shell the app is framed in.
  chrome:        palette.ink950,
  chromeAlt:     '#221D45',
  chromeLine:    'rgba(255,255,255,0.09)',
  onChrome:      '#FFFFFF',
  onChromeMuted: 'rgba(255,255,255,0.64)',
  onChromeFaint: 'rgba(255,255,255,0.40)',
};

// ── gradients ───────────────────────────────────────────────────────────────
// Used sparingly and only on chrome: a hero, a profile header, the splash.
// Never behind text that has to be read at a glance in sunlight.
export const gradients = {
  chrome:  [palette.ink950, '#2A2160'],
  brand:   [palette.violet700, palette.violet500],
  violet:  [palette.violet600, palette.violet400],
  gold:    [palette.gold600, palette.gold400],
  data:    [palette.teal600, palette.violet500],
  success: [palette.green700, palette.green500],
  danger:  [palette.red700, palette.red500],
};

// ── type ────────────────────────────────────────────────────────────────────
// A system stack, deliberately. The school's PC has no internet at seven in the
// morning, and a web font that fails to load falls back to whatever is next in
// the list — which on the desktop was Cambria, a SERIF. Every screen in the
// office was rendering in the wrong kind of typeface. Weight and tracking carry
// the hierarchy instead of a downloaded family.
export const fontFamily = [
  'Segoe UI Variable Text', 'Segoe UI', 'system-ui', '-apple-system',
  'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif',
].join(', ');

const face = { fontFamily };

// Six sizes and nothing between them.
export const type = {
  display: { ...face, fontSize: 30, fontWeight: '800', letterSpacing: -0.7, lineHeight: 36 },
  title:   { ...face, fontSize: 22, fontWeight: '800', letterSpacing: -0.45, lineHeight: 28 },
  heading: { ...face, fontSize: 17, fontWeight: '700', letterSpacing: -0.2, lineHeight: 23 },
  body:    { ...face, fontSize: 15, fontWeight: '500', lineHeight: 21.5 },
  small:   { ...face, fontSize: 13, fontWeight: '500', lineHeight: 18.5 },
  micro:   { ...face, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, lineHeight: 14 },
  // Figures — a balance, a mark, a count. Tabular so columns line up.
  numeric: { ...face, fontSize: 24, fontWeight: '800', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

// Soft, not round. A card is 20, a row inside it is 12, a button is 14.
export const radius = { xs: 8, sm: 12, md: 16, lg: 20, xl: 28, pill: 999 };

// ── elevation ───────────────────────────────────────────────────────────────
// Three levels: resting, raised, floating. Borders do the structural work;
// shadow is only for things that genuinely sit above the page. A screen where
// everything floats has no hierarchy at all.
export const shadow = {
  rest: {
    shadowColor: '#1B1740', shadowOpacity: 0.04, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  raised: {
    shadowColor: '#1B1740', shadowOpacity: 0.08, shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  floating: {
    shadowColor: '#100C2A', shadowOpacity: 0.22, shadowRadius: 36,
    shadowOffset: { width: 0, height: 16 }, elevation: 14,
  },
};

// ── motion ──────────────────────────────────────────────────────────────────
// Ease-out only. No bounce, no elastic: this is a school's records, not a game.
// See src/motion.jsx for the components that consume these.
export const motion = {
  fast:   120,
  base:   180,
  medium: 260,
  slow:   400,
  // cubic-bezier(0.16, 1, 0.3, 1) — the same curve the desktop CSS uses.
  easeOut: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 },
  // How far apart the items of one list enter, and where staggering stops
  // being charming and starts being a wait.
  stagger: 45,
  staggerMax: 8,
};

// ── z-index ─────────────────────────────────────────────────────────────────
// Named, so nothing is ever 9999.
export const z = {
  base: 0, sticky: 10, drawerScrim: 40, drawer: 50,
  sheetScrim: 60, sheet: 70, toast: 80, tooltip: 90,
};

// ── breakpoints ─────────────────────────────────────────────────────────────
// The browser build has to fit a 320px Android phone and a 27-inch monitor from
// the same source. These are the three shapes it takes; see src/responsive.js.
export const breakpoints = { phone: 0, tablet: 768, desktop: 1180, wide: 1600 };

export default { palette, colors, gradients, type, fontFamily, spacing, radius, shadow, motion, z, breakpoints };
