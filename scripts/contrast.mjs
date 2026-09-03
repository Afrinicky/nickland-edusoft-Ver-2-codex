#!/usr/bin/env node
// Nickland Edusoft — the contrast floor, checked rather than assumed.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node scripts/contrast.mjs
//
// Every text pairing the design system actually uses, measured against WCAG.
// The floor is 4.5:1 for anything a person reads: this app is used outdoors in
// Ghanaian daylight, where an elegant light grey is simply invisible.
//
// `faint` is the one token deliberately under the floor — it draws icons and
// rules, never text. The last case asserts that it is still under it, so
// nobody can quietly promote it to a body colour.
//
// The values below mirror mobile/src/theme.js and
// src/renderer/src/styles/index.css. Change a colour there and change it here.

const hex = h => { const m = h.replace('#','').match(/.{2}/g).map(x => parseInt(x,16)); return m; };
const lin = c => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
const lum = h => { const [r,g,b] = hex(h); return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b); };
const ratio = (a,b) => { const [x,y] = [lum(a), lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };

const T = {
  violet600:'#5B3FE0', violet700:'#4A2FC7',
  ink900:'#14142B', ink700:'#3A3A55', ink500:'#61617E', ink400:'#8A8AA3',
  surface:'#FFFFFF', surfaceAlt:'#FAF9FE', canvas:'#F5F4FB', violet50:'#F4F2FE',
  green700:'#0B6B3C', green600:'#12864A', green100:'#DCF5E7',
  amber700:'#8A4B04', amber600:'#B26205', amber100:'#FDF0D8',
  red700:'#9F262B', red600:'#C7343A', red100:'#FDE4E5',
  teal700:'#0A6E6E', teal100:'#D6F2F2', gold700:'#7A5810', gold100:'#FBF0D5',
  chrome:'#15132B', chrome2:'#221D45', violet300:'#B8A6F7',
};

const cases = [
  ['body on canvas',            T.ink700, T.canvas,     4.5],
  ['body on surface',           T.ink700, T.surface,    4.5],
  ['heading on surface',        T.ink900, T.surface,    4.5],
  ['muted on surface',          T.ink500, T.surface,    4.5],
  ['muted on canvas',           T.ink500, T.canvas,     4.5],
  ['muted on surfaceAlt',       T.ink500, T.surfaceAlt, 4.5],
  ['placeholder on surfaceAlt', T.ink500, T.surfaceAlt, 4.5],
  ['primary text on surface',   T.violet600, T.surface, 4.5],
  ['primary text on violet50',  T.violet600, T.violet50, 4.5],
  ['white on primary btn',      T.surface, T.violet600, 4.5],
  ['white on primary pressed',  T.surface, T.violet700, 4.5],
  ['success badge',             T.green700, T.green100, 4.5],
  ['warning badge',             T.amber700, T.amber100, 4.5],
  ['danger badge',              T.red700,   T.red100,   4.5],
  ['data badge',                T.teal700,  T.teal100,  4.5],
  ['gold badge',                T.gold700,  T.gold100,  4.5],
  ['success figure on surface', T.green600, T.surface,  4.5],
  ['danger figure on surface',  T.red600,   T.surface,  4.5],
  ['warning figure on surface', T.amber600, T.surface,  4.5],
  ['white on chrome (drawer)',  T.surface,  T.chrome,   4.5],
  ['white on chrome-2',         T.surface,  T.chrome2,  4.5],
  ['active marker on chrome',   T.violet300, T.chrome,  3.0],
  ['FAINT as text (must fail)', T.ink400,   T.surface,  4.5],
];

let bad = 0;
for (const [name, fg, bg, need] of cases) {
  const r = ratio(fg, bg);
  const pass = r >= need;
  const expectFail = name.includes('must fail');
  const flag = expectFail ? (pass ? '!! ' : 'ok ') : (pass ? '✓  ' : '✗  ');
  if (!expectFail && !pass) bad++;
  if (expectFail && pass) bad++;
  console.log(`${flag}${r.toFixed(2).padStart(6)}:1  need ${need}  ${name}`);
}
if (bad) {
  console.error(`\n${bad} pairing(s) below the floor. Fix the token, not the test.`);
  process.exit(1);
}
console.log('\nAll pairings pass. `faint` is correctly below the floor and barred from text.');
