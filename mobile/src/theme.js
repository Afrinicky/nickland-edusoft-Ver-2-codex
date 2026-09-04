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

// ── raw palette, token names and font stack ─────────────────────────────────
// Declared in src/tokens.js, which imports nothing, so the values can be read
// by the contrast checker and by src/skin.js without dragging a renderer in.
// Re-exported here because every screen has always imported them from `theme`.
import { Platform } from 'react-native';
import { palette, TOKEN_DEFAULTS, FONT_STACK } from './tokens.js';

export { palette, TOKEN_DEFAULTS, FONT_STACK };

// ── semantic colours ────────────────────────────────────────────────────────
// Screens use these, never the raw palette, so the identity can change in one
// place. Names kept from the first version so no screen had to be rewritten.
//
// ── Why they are CSS variables in a browser ─────────────────────────────────
//
// The desktop lets a school set its own colours (Settings → Appearance), and
// they take effect the moment they are picked, because the desktop writes them
// into CSS custom properties on the document root and every rule reads them
// through `var()`. The app had no equivalent: its palette was compiled into the
// bundle, so a school that had spent an afternoon matching its crest saw the
// result on one of its three screens.
//
// So on the web each token is `var(--nk-<name>, <default>)`. react-native-web
// passes colour strings through to CSS untouched, which means a `StyleSheet`
// created once at import time — and there are hundreds of them across this app
// — re-resolves the moment the variable underneath it changes. No provider
// threading, no re-render, no screen rewritten. See src/skin.js, which computes
// the values and writes them.
//
// The fallback in each `var()` is the app's own default, so a page rendered
// before the school's settings arrive is the app as it has always looked rather
// than a flash of black on black.
//
// On the phone the values are the plain hexes they always were: a native
// StyleSheet resolves once, `var()` means nothing to it, and the APK ships with
// the school's colours already baked in by `--brand` at build time.
const IS_WEB = Platform.OS === 'web';
const v = (name, fallback) => (IS_WEB ? `var(--nk-${name}, ${fallback})` : fallback);

export const colors = Object.fromEntries(
  Object.entries(TOKEN_DEFAULTS).map(([k, hex]) => [k, v(kebab(k), hex)])
);

// `primaryDark` → `primary-dark`, so the variables read like CSS rather than
// like JavaScript that leaked into a stylesheet.
function kebab(k) { return k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()); }

// ── gradients ───────────────────────────────────────────────────────────────
// Used sparingly and only on chrome: a hero, a profile header, the splash.
// Never behind text that has to be read at a glance in sunlight.
// The three that carry the school's identity follow it; the rest mean a thing
// (success is green because it is green) and are fixed.
export const gradients = {
  chrome:  [v('grad-chrome-a', palette.ink950), v('grad-chrome-b', '#2A2160')],
  brand:   [v('grad-brand-a', palette.violet700), v('grad-brand-b', palette.violet500)],
  violet:  [v('grad-brand-a', palette.violet600), v('grad-brand-b', palette.violet400)],
  gold:    [v('grad-gold-a', palette.gold600), v('grad-gold-b', palette.gold400)],
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
// A school that has chosen a face in Settings → Appearance gets it here too;
// what it chose is prepended to the stack rather than replacing it, so a font
// the machine does not have degrades to the system one instead of to Times.
export const fontFamily = IS_WEB ? `var(--nk-font, ${FONT_STACK})` : FONT_STACK;

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
// `control` is the shape of anything you press that is not a card: a tab, a
// segment, a chip in a filter strip. It matches the medium Button's 14 closely
// enough to read as one family and is deliberately NOT a lozenge — a fully
// rounded choice button reads as a toy next to a school's own paperwork.
// `pill` survives for the things that genuinely are round: a progress track,
// an avatar, the dot on a notification.
export const radius = { xs: 8, control: 10, sm: 12, md: 16, lg: 20, xl: 28, pill: 999 };

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
