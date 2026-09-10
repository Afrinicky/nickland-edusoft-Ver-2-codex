// Nickland Edusoft — the app's own frame: its colours, its scrolling, its calls.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/app_shell.mjs
//
// Three faults shipped together and between them made the phone and the browser
// app unusable in a school. None of them was caught by anything, because all
// three live in the frame around the screens rather than in a screen:
//
//   1. THE COLOURS. The desktop SEEDS its own navy and gold into every school's
//      settings when the database is created. The app started reading those
//      settings, could not tell a seed from a choice, and every phone in every
//      school turned navy — with a white page ground and slate ink in place of
//      its own tinted near-white and violet.
//
//   2. THE SCROLLING. A module page is a page of `Screen`s, and an embedded
//      `Screen` stands down so as not to nest two scrollers. On a desktop the
//      shell scrolls; on a phone nothing did, so every module page — the
//      register, the canteen, fees, finance — was a page taller than the
//      window with no way to move down it, no gutter, and a tab strip 16px
//      wider than the screen.
//
//   3. A CALL BY THE WRONG NAME. `api.onlinePayments` is not a thing the api
//      object exports. The TypeError unmounted the tree and Fees → Payments
//      was a blank white screen.
//
// So: the colours are asserted against the real seed values, and the other two
// are read out of the source, because there is no renderer here and the shape
// of the file is what the fault was.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveTokens, chosenOnly, SKINS } from '../mobile/src/skin.js';
import { TOKEN_DEFAULTS, palette } from '../mobile/src/tokens.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = path.join(ROOT, 'mobile');
const read = (p) => fs.readFileSync(path.join(MOBILE, p), 'utf8');

let pass = 0, fail = 0;
const ck = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? '✓' : '✗') + ' ' + name); };

// ── 1. the colours ──────────────────────────────────────────────────────────
//
// Exactly what electron/db/database.js writes into a new school. Read from it
// rather than copied, so a change to the desktop's defaults cannot leave this
// file quietly asserting against a colour nobody ships any more.
const schema = fs.readFileSync(path.join(ROOT, 'electron', 'db', 'database.js'), 'utf8');
const seeded = (key) => {
  const m = schema.match(new RegExp(`\\['${key}',\\s*'([^']+)'`));
  return m ? m[1] : null;
};
const SEED = {
  school_color_primary:    seeded('school_color_primary'),
  school_color_accent:     seeded('school_color_accent'),
  school_color_background: seeded('school_color_background'),
  school_color_foreground: seeded('school_color_foreground'),
};

ck('the desktop really does seed a colour into every school',
  SEED.school_color_primary === '#1B3A6B' && SEED.school_color_accent === '#C9961A');

const app = deriveTokens('app', SEED);
ck('a school that has chosen nothing keeps the app\'s violet',
  app.primary === palette.violet600 && app.primary === TOKEN_DEFAULTS.primary);
ck('...and the app\'s gold, not the installer\'s',
  app.accent === palette.gold500);
ck('...and its own tinted page ground, not a flat white',
  app.bg === undefined);
ck('...and its own ink',
  app.text === undefined);
ck('...and its own dark chrome',
  app.chrome === palette.ink950);

// The same settings on the browser at desktop width, which IS the installed
// application and wears its colours.
const desk = deriveTokens('desk', SEED);
ck('the desktop layout still wears the installer\'s navy and gold',
  desk.primary === '#1B3A6B' && desk.accent === '#C9961A');

// A school that HAS chosen is followed, everywhere, which is the whole point
// of the feature this sits inside.
const teal = deriveTokens('app', { ...SEED, school_color_primary: '#0E8E8E' });
ck('a colour the school actually picked is followed on the app',
  teal.primary === '#0E8E8E' && teal.info === '#0E8E8E');
ck('...and its shades are derived from it, not from the app default',
  teal['primary-dark'] !== TOKEN_DEFAULTS.primaryDark &&
  teal['primary-soft'] !== TOKEN_DEFAULTS.primarySoft &&
  teal['grad-brand-a'] !== undefined);
// The app's chrome — the splash, the drawer header, a profile banner — is a
// fixed near-black with a violet cast and does NOT follow the school's colour.
// That is the design as drawn, not an oversight: it is asserted here so that
// changing it is a decision somebody makes rather than a thing that happens.
ck('...while the app\'s dark chrome stays the app\'s',
  teal.chrome === palette.ink950);
const tealDesk = deriveTokens('desk', { ...SEED, school_color_primary: '#0E8E8E' });
ck('...and on the desktop layout too', tealDesk.primary === '#0E8E8E');

ck('a chosen background is still honoured',
  deriveTokens('app', { ...SEED, school_color_background: '#FFFDF5' }).bg === '#FFFDF5');
ck('a seeded background is not', chosenOnly(SEED).school_color_background === undefined);
ck('a seed written in the other case is still a seed',
  chosenOnly({ school_color_primary: '#1b3a6b' }).school_color_primary === undefined);
ck('anything else the school stores is passed through untouched',
  chosenOnly({ ui_font_family: 'Inter' }).ui_font_family === 'Inter');
ck('the two skins are still the two skins',
  SKINS.app.primary === palette.violet600 && SKINS.desk.primary === '#1B3A6B');

// ── 2. the scrolling ────────────────────────────────────────────────────────
const modulePage = read('src/module.jsx');

ck('a module page brings its own scroller when the shell has none',
  /if \(layout\.isDesktop\) return <View/.test(modulePage) && /<ScrollView\s*\n\s*style=\{styles\.pageScroll\}/.test(modulePage));
ck('...that fills the frame rather than growing past it',
  /pageScroll: \{ flex: 1, width: '100%' \}/.test(modulePage));
ck('...and pads the page to the layout\'s own gutter',
  /paddingHorizontal: layout\.gutter/.test(modulePage));

// The tab strip pulls itself out to the gutter so the chips can run to the
// edge of the screen. Out by a different number than the page pads in by is a
// page that scrolls sideways, which is what it was.
ck('the tab strip is pulled out by exactly what the page pads in by',
  /marginHorizontal: -gutter/.test(modulePage) && /paddingHorizontal: gutter/.test(modulePage));
ck('...and no longer assumes a gutter of its own',
  !/marginHorizontal: -spacing\.lg/.test(modulePage));

// The desktop half of the same rule: the shell scrolls, so the page must not
// put a second scroller inside it.
const deskShell = read('src/desk.jsx');
ck('the desktop shell still owns the scrolling and the gutter',
  /<ScrollView\s*\n\s*style=\{styles\.content\}/.test(deskShell) && /padding: DESK\.gutter/.test(deskShell));

// A stat card is laid out by the row, and the row lays out the CELL.
ck('a stat card sizes the cell the row lays out, not the card inside it',
  /statCell:\s*\{[^}]*flexGrow: 1/.test(deskShell) && !/padding: spacing\.lg, minWidth: 210/.test(deskShell));
ck('...and on a phone it fills the row instead of leaving a third of it empty',
  /statCellPhone:\s*\{[^}]*flexBasis: '100%'/.test(deskShell));

// Nothing a phone lays out may refuse to shrink below the width of a phone.
// 320px less two 16px gutters is 288px of content, and a `min-width` over that
// is a flex item that cannot fit the screen it is on — the row goes wider than
// the window and the whole page scrolls sideways.
//
// Only the SHARED stylesheet is read. A floor written inline under
// `layout.isDesktop` is a desktop rule and is none of a phone's business; a
// floor in `StyleSheet.create` applies at every width, which is what makes it
// the dangerous place to put one.
const dash = read('src/dash.jsx');
const PHONE_CONTENT = 320 - 16 * 2;
const sharedStyles = (src) => {
  const i = src.indexOf('StyleSheet.create({');
  return i < 0 ? '' : src.slice(i);
};
for (const [name, src] of [['dash.jsx', dash], ['desk.jsx', deskShell], ['ui.jsx', read('src/ui.jsx')],
                           ['module.jsx', modulePage], ['shell.jsx', read('src/shell.jsx')]]) {
  const floors = [...sharedStyles(src).matchAll(/minWidth: (\d+)/g)].map(m => Number(m[1]));
  const over = floors.filter(n => n > PHONE_CONTENT);
  ck(`${name} has no shared style that refuses to fit a 320px handset` +
     (over.length ? ` — found ${over.join(', ')}` : ''), over.length === 0);
}

// ── 3. the calls ────────────────────────────────────────────────────────────
//
// Every `api.<name>()` in the app has to be a name the api object exports. The
// one that was not took a school's payment screen down with it.
const apiSrc = read('src/api.js');
const objStart = apiSrc.indexOf('export const api = {');
const objBody = apiSrc.slice(objStart, objStart + apiSrc.slice(objStart).indexOf('\n};'));
const exported = new Set([...objBody.matchAll(/^ {2}([A-Za-z_$][\w$]*)\s*:/gm)].map(m => m[1]));
ck('the api object was read', exported.size > 100);

const sources = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.jsx?$/.test(e.name) && p !== path.join(MOBILE, 'src', 'api.js')) sources.push(p);
  }
}
walk(path.join(MOBILE, 'src'));
walk(path.join(MOBILE, 'app'));

const unknown = [];
for (const f of sources) {
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(/\bapi\.([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (!exported.has(m[1])) {
      unknown.push(`api.${m[1]} in ${path.relative(MOBILE, f)}:${t.slice(0, m.index).split('\n').length}`);
    }
  }
}
ck('every api call in the app is a name the api actually exports' +
   (unknown.length ? ` — ${unknown.join('; ')}` : ''), unknown.length === 0);

// ── and the net that catches the next one ───────────────────────────────────
ck('a screen that throws is caught rather than blanking the app',
  fs.existsSync(path.join(MOBILE, 'src', 'boundary.jsx')) &&
  /<ScreenBoundary/.test(read('src/shell.jsx')) &&
  /<ScreenBoundary/.test(deskShell));

// ── the browser shell ───────────────────────────────────────────────────────
const html = read('public/index.html');
ck('the document itself never scrolls — the ScrollViews do',
  /body \{[^}]*overflow: hidden/.test(html));
ck('...and a swipe that runs out of list does not drag the browser with it',
  /overscroll-behavior: none/.test(html));
ck('...and nothing makes the page scroll sideways',
  /overflow-x: hidden/.test(html));
ck('the app is sized to the window a phone actually shows',
  /height: 100dvh/.test(html));
ck('the viewport is the device\'s, at its own scale',
  /width=device-width, initial-scale=1/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
