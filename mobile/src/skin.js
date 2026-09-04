// Nickland Edusoft — the school's own colours, in the app.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The desktop has had this since the first release: Settings → Appearance, two
// colour wells and a font, written into CSS custom properties on the document
// root so every rule in the stylesheet picks them up at once. A school in
// Acherensua whose crest is dark teal and gold runs a dark teal and gold system.
//
// The app never had it. Its palette was compiled into the bundle, so the same
// school that had spent an afternoon matching its crest saw the result on one
// of its three screens and a stock violet on the other two.
//
// This is the missing half. It reads the SAME settings keys the desktop writes
// — `school_color_primary`, `school_color_accent`, `ui_font_family`,
// `ui_font_size_base` — derives the shades around them with the same arithmetic
// the desktop's store uses, and writes them as `--nk-*` variables that
// src/theme.js already reads through.
//
// ── The two defaults ────────────────────────────────────────────────────────
//
// A school that has never touched the colour wells keeps exactly what it has
// today, and that differs by surface, deliberately:
//
//   desk  the browser at desktop width, which is the desktop installer's own
//         layout and therefore wears its navy and gold
//   app   a phone, a tablet, and a browser window narrower than a tablet —
//         the app's violet, unchanged
//
// The moment a colour IS set, both follow it, because at that point the school
// has said what it wants to look like and there is no argument left to have.
//
// ── The phone ───────────────────────────────────────────────────────────────
//
// Native has no CSS variables and a native StyleSheet resolves once, at import.
// So `applyTheme` is a no-op there and the APK ships with its defaults. That is
// not a gap being papered over: the phone app is one school's app, built for
// them, and `scripts/build-web.mjs --brand` bakes the colours in at build time.

import { palette, TOKEN_DEFAULTS, FONT_STACK } from './tokens.js';

// Not `Platform.OS === 'web'`: this file has to be importable by the test suite
// and by scripts/contrast.mjs, neither of which has a React Native to ask. What
// it actually needs to know is whether there is a document to write custom
// properties onto, and that question answers itself.
const CAN_WRITE = typeof document !== 'undefined' && !!document.documentElement;

// ── colour arithmetic ───────────────────────────────────────────────────────
// The same three functions src/renderer/src/store/index.js uses, so a colour
// picked on the desktop and the same colour picked in the browser produce the
// same shades rather than two families that nearly match.

const hexToRgb = (hex) => {
  const h = String(hex || '').replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const m = full.match(/.{2}/g);
  return m && m.length >= 3 ? m.slice(0, 3).map(x => parseInt(x, 16)) : null;
};
const rgbToHex = ([r, g, b]) =>
  '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');

export const lighten = (hex, a) => {
  const c = hexToRgb(hex); if (!c) return hex;
  return rgbToHex(c.map(x => x + (255 - x) * a));
};
export const darken = (hex, a) => {
  const c = hexToRgb(hex); if (!c) return hex;
  return rgbToHex(c.map(x => x * (1 - a)));
};

/** Is this a colour we can do arithmetic on? Anything else is left alone. */
export const isHex = (s) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(s || '').trim());

/**
 * Relative luminance, for deciding whether text on a fill should be white.
 * The sRGB formula, so the answer matches what scripts/contrast.mjs checks.
 */
export function luminance(hex) {
  const c = hexToRgb(hex); if (!c) return 1;
  const [r, g, b] = c.map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White or near-black — whichever can actually be read on this fill. */
export const readableOn = (hex) => (luminance(hex) > 0.45 ? palette.ink900 : '#FFFFFF');

// ── the two base skins ──────────────────────────────────────────────────────

// The app's own: violet and gold, the palette every existing screen was drawn
// against. Its values ARE the defaults in theme.js, so this skin adds nothing.
const APP = {
  primary: palette.violet600,
  accent:  palette.gold500,
  chrome:  palette.ink950,
};

// The desktop installer's: the navy and gold in src/renderer/src/styles/index.css.
// The browser at desktop width IS that application, so it wears its colours.
const DESK = {
  primary: '#1B3A6B',
  accent:  '#C9961A',
  // The desktop's status bar is `--primary-900`, a deep shade of the primary,
  // and its sidebar is the primary itself. Derived rather than fixed, so a
  // school that sets teal gets a teal sidebar and a deeper teal beneath it,
  // exactly as the desktop does.
  chrome:  null,
};

export const SKINS = { app: APP, desk: DESK };

/**
 * The full token set for a skin plus whatever the school has configured.
 *
 * `settings` is the desktop's own settings map — the keys as stored, so this
 * can be handed the reply from /system/settings or /branding without either
 * having to invent a shape for it.
 *
 * Only the tokens that MOVE are returned. Everything else keeps the default
 * baked into theme.js, which is why a school that sets one colour does not
 * silently acquire a whole new design.
 */
export function deriveTokens(skinName = 'app', settings = {}) {
  const base = SKINS[skinName] || APP;
  const get = (k, fallback) => {
    const raw = settings[k];
    return raw === undefined || raw === null || raw === '' ? fallback : String(raw).trim();
  };

  const primary = isHex(get('school_color_primary', base.primary)) ? get('school_color_primary', base.primary) : base.primary;
  const accent  = isHex(get('school_color_accent',  base.accent))  ? get('school_color_accent',  base.accent)  : base.accent;
  const chrome  = base.chrome || darken(primary, 0.34);

  const out = {
    primary,
    'primary-dark': darken(primary, 0.15),
    'primary-soft': lighten(primary, 0.92),
    'primary-line': lighten(primary, 0.78),
    accent,
    'accent-soft': lighten(accent, 0.86),
    info: primary,

    chrome,
    'chrome-alt': lighten(chrome, 0.10),
    'grad-chrome-a': chrome,
    'grad-chrome-b': lighten(primary, 0.06),
    'grad-brand-a': darken(primary, 0.12),
    'grad-brand-b': lighten(primary, 0.18),
    'grad-gold-a': darken(accent, 0.12),
    'grad-gold-b': lighten(accent, 0.22),
  };

  // The page ground and the ink on it, if the school has set them. These are
  // the two the desktop exposes as "background" and "foreground"; a school that
  // has not touched them keeps the app's tinted near-white.
  const bg = get('school_color_background', '');
  if (isHex(bg)) { out.bg = bg; out.card = lighten(bg, 0.55); out['surface-alt'] = lighten(bg, 0.3); }
  const fg = get('school_color_foreground', '');
  if (isHex(fg)) { out.text = fg; out['text-soft'] = lighten(fg, 0.18); }

  return out;
}

/** The font declaration, from the same two keys the desktop writes. */
export function deriveFont(settings = {}) {
  const family = String(settings.ui_font_family || '').trim();
  const size = parseInt(settings.ui_font_size_base || '', 10);
  return {
    font: family ? `'${family}', ${FONT_STACK}` : FONT_STACK,
    fontScale: Number.isFinite(size) && size >= 10 && size <= 22 ? size / 14 : 1,
  };
}

// ── writing it out ──────────────────────────────────────────────────────────

let applied = null;

/**
 * Push a token set onto the document.
 *
 * Idempotent, and cheap enough to call on every render of the provider: it
 * compares against what it last wrote and does nothing when nothing moved,
 * which matters because writing a custom property invalidates style on the
 * whole document.
 *
 * Returns true when it changed something.
 */
export function applyTheme(tokens, { font, fontScale } = {}) {
  if (!CAN_WRITE) return false;
  const next = JSON.stringify([tokens, font, fontScale]);
  if (next === applied) return false;
  applied = next;

  const root = document.documentElement.style;
  for (const [k, val] of Object.entries(tokens || {})) {
    if (val === undefined || val === null || val === '') root.removeProperty(`--nk-${k}`);
    else root.setProperty(`--nk-${k}`, String(val));
  }
  if (font) root.setProperty('--nk-font', font);
  if (fontScale && fontScale !== 1) root.setProperty('--nk-font-scale', String(fontScale));
  else root.removeProperty('--nk-font-scale');
  return true;
}

/** Drop everything this module wrote. Used when a session ends. */
export function resetTheme() {
  if (!CAN_WRITE) return;
  const root = document.documentElement.style;
  const names = new Set([
    ...Object.keys(TOKEN_DEFAULTS).map(k => k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())),
    'grad-chrome-a', 'grad-chrome-b', 'grad-brand-a', 'grad-brand-b',
    'grad-gold-a', 'grad-gold-b', 'font', 'font-scale',
  ]);
  for (const n of names) root.removeProperty(`--nk-${n}`);
  applied = null;
}

export default { SKINS, deriveTokens, deriveFont, applyTheme, resetTheme, lighten, darken, isHex, readableOn, luminance };
