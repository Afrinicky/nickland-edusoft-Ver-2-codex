// Nickland Edusoft — the raw values, with nothing imported.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The palette, the token names and the font stack, in a file that imports
// NOTHING. That is the whole point of it: src/theme.js wraps these for React
// Native, which means importing `react-native`, which means the values cannot
// be read by anything that is not a running app — not the contrast checker,
// not the test suite, not src/skin.js, which has to derive a school's shades
// long before there is a renderer.
//
// So the numbers live here and the framework lives next door. See src/theme.js
// for what each one is FOR; this file is deliberately just the values.

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

export const TOKEN_DEFAULTS = {
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

export const FONT_STACK = [
  'Segoe UI Variable Text', 'Segoe UI', 'system-ui', '-apple-system',
  'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif',
].join(', ');

export default { palette, TOKEN_DEFAULTS, FONT_STACK };
