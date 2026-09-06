// Nickland Edusoft — one application, two ways in.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/desk_surface.js
//
// The claim this suite defends: the office application in its own window and
// the office application in a browser are the same application. Not similar —
// the same, built from one list of channels, with one implementation behind
// each of them.
//
// It is worth a test because the failure mode is silent and slow. Somebody
// adds a channel to the preload script, forgets the browser, and for six weeks
// one screen works on the office PC and does nothing on the laptop next to it.
// Nobody reports that as a bug; they report it as "the web one is not finished".
//
// It needs neither Electron nor a database: the surface is a list, and a list
// can be read.

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const ck = (n, c) => { c ? pass++ : fail++; console.log((c ? '✓' : '✗') + ' ' + n); };

const { buildApi } = require(path.join(ROOT, 'electron/api-surface.js'));

// Build the surface with a transport that records rather than sends, and read
// off every method and the channel it names.
function surface() {
  const seen = [];
  const api = buildApi((channel) => { seen.push(channel); return Promise.resolve(null); });
  const map = {};
  for (const ns of Object.keys(api)) {
    for (const method of Object.keys(api[ns])) {
      seen.length = 0;
      api[ns][method]();
      map[`${ns}.${method}`] = seen[0];
    }
  }
  return map;
}

const map = surface();
const methods = Object.keys(map);
const channels = Object.values(map);

ck('the application has a surface at all', methods.length > 300);
ck('every method on it names a channel', channels.every(c => typeof c === 'string' && c.includes(':')));
ck('no two methods share a channel by accident', new Set(channels).size === channels.length);

// ── The preload script must not have grown a list of its own ────────────────
//
// This is the whole point. The installed application's transport is allowed to
// be a transport and nothing else: the moment somebody adds a channel to
// preload.js directly, the browser stops having it, and this stops passing.
const preload = fs.readFileSync(path.join(ROOT, 'electron/preload.js'), 'utf8');
const invokesInPreload = (preload.match(/ipcRenderer\.invoke\(/g) || []).length;
ck('the preload script names exactly one channel — the one it is handed',
  invokesInPreload === 1);
ck('...and gets its surface from the shared list',
  preload.includes("require('./api-surface')") && preload.includes('buildApi'));

// ── The browser build gets the same list ────────────────────────────────────
//
// It imports the same file. That is checked here rather than assumed, because
// "it imports the same file" is exactly the kind of thing that stays true
// until somebody copies it "temporarily".
const desk = fs.readFileSync(path.join(ROOT, 'src/renderer/src/lib/desk.js'), 'utf8');
ck('the browser transport imports the same surface, and does not restate it',
  desk.includes('api-surface.js') && desk.includes('buildApi'));
// The only channel names the browser transport may spell out are the handful
// it answers itself (LOCAL, below). Anything else spelled out there is a
// second list starting to grow.
const namedInDesk = new Set(desk.match(/'[a-z]+:[a-z-]+'/g) || []);
// The two declared tables: what the browser answers itself, and the one thing
// it answers only while nobody is signed in. A channel named anywhere else in
// that file is a second list starting to grow — including one hidden in a
// condition, which is why both are tables rather than `if`s.
const declared = desk.slice(desk.indexOf('const LOCAL = {'), desk.indexOf('async function invoke'));
ck('...and names no channel of its own beyond the few it answers itself',
  [...namedInDesk].every(c => declared.includes(c)));
ck('...with those declared as tables, not buried in conditions',
  desk.includes('const LOCAL = {') && desk.includes('const BEFORE_SIGN_IN = {'));

// ── The build rewrites the export line it says it rewrites ──────────────────
//
// The browser build turns one CommonJS export line into an ES export. If that
// line is ever edited without the build being told, every call in the browser
// becomes undefined — so the build asserts, and so does this.
const surfaceSrc = fs.readFileSync(path.join(ROOT, 'electron/api-surface.js'), 'utf8');
const plugin = fs.readFileSync(path.join(ROOT, 'scripts/vite-api-surface.mjs'), 'utf8');
ck('the surface still ends with the line both builds rewrite',
  surfaceSrc.includes('module.exports = { buildApi };'));
ck('...and the rewrite is still looking for that exact line',
  plugin.includes("const EXPORT_LINE = 'module.exports = { buildApi };'"));

// One rewrite, used by both builds. Two copies of it would be two chances for
// the window's build and the browser's to disagree about the same file.
for (const cfg of ['vite.config.js', 'vite.desk.config.js']) {
  const src = fs.readFileSync(path.join(ROOT, cfg), 'utf8');
  ck(`${cfg} uses the shared rewrite rather than one of its own`,
    src.includes("from './scripts/vite-api-surface.mjs'") && src.includes('apiSurfaceAsModule()'));
}

// ── The preload script Electron actually loads ──────────────────────────────
//
// This is the case that broke the installed application and that nothing here
// caught, because the difference is not in the code — it is in who loads it.
//
// Electron runs a preload SANDBOXED, and a sandboxed preload's `require()`
// resolves "electron" and nothing else. Not a file beside it. So a preload
// that says `require('./api-surface')` is dropped whole: window.api never
// appears, and the application starts with no way to reach its own database.
//
// Node's own `require` resolves that file perfectly well, which is exactly why
// every test passed. So this loads the preload the way the sandbox does — with
// nothing available but "electron" — and fails if anything else is asked for.
const bundlePath = path.join(ROOT, 'electron/preload.bundle.js');
ck('the preload Electron loads has been built (npm run build:preload)',
  fs.existsSync(bundlePath));

if (fs.existsSync(bundlePath)) {
  const bundled = fs.readFileSync(bundlePath, 'utf8');
  const asked = [...bundled.matchAll(/require\(["']([^"']+)["']\)/g)].map(m => m[1]);
  ck('...and asks the sandbox for nothing but "electron"',
    asked.every(name => name === 'electron'));

  // Load it exactly as a sandboxed preload would: anything but "electron"
  // throws, the way Electron's own loader throws.
  const Module = require('module');
  const realLoad = Module._load;
  let exposed = null;
  const seen = [];
  Module._load = function (request, ...rest) {
    if (request === 'electron') {
      return {
        contextBridge: { exposeInMainWorld: (_k, v) => { exposed = v; } },
        ipcRenderer: { invoke: (channel) => { seen.push(channel); return Promise.resolve(null); } },
      };
    }
    if (request.startsWith('.')) throw new Error(`module not found: ${request}`);
    return realLoad.call(this, request, ...rest);
  };
  let loadError = null;
  try {
    delete require.cache[bundlePath];
    require(bundlePath);
  } catch (e) {
    loadError = e;
  } finally {
    Module._load = realLoad;
  }

  ck('...loads under the sandbox without asking for a file beside it', loadError === null);
  ck('...and puts the whole application on the window',
    !!exposed && Object.keys(exposed).length === Object.keys(
      (() => { const g = {}; for (const m of methods) g[m.split('.')[0]] = 1; return g; })()
    ).length);

  const bundledMethods = exposed
    ? Object.keys(exposed).reduce((n, ns) => n + Object.keys(exposed[ns]).length, 0)
    : 0;
  ck(`...with every one of the ${methods.length} channels, not a subset`,
    bundledMethods === methods.length);

  // The surface the window gets must be the surface everything else is
  // written against — same names, same channels, in the same places.
  if (exposed) {
    const fromBundle = {};
    for (const ns of Object.keys(exposed)) {
      for (const m of Object.keys(exposed[ns])) {
        seen.length = 0;
        exposed[ns][m]();
        fromBundle[`${ns}.${m}`] = seen[0];
      }
    }
    ck('...and channel for channel it is the same surface',
      JSON.stringify(fromBundle) === JSON.stringify(map));
  }
}

// ── Channels only the office PC can answer ──────────────────────────────────
const { HOST_ONLY } = require(path.join(ROOT, 'electron/server/desk_api.js'));

ck('the host-only list names real channels, not typos',
  [...HOST_ONLY.keys()].every(c => channels.includes(c)));
ck('...and every one of them says WHY, in words a school can act on',
  [...HOST_ONLY.values()].every(m => typeof m === 'string' && m.length > 25));

// Opening a folder or printing on the school's own machine is registered
// straight onto Electron's ipcMain, so it never enters the registry at all.
// That is a stronger guarantee than a list, and this states it.
const main = fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8');
const appChannels = channels.filter(c => c.startsWith('app:'));
ck('the app-level channels exist', appChannels.length >= 8);
ck('...and are registered where the network cannot reach them',
  appChannels.every(c => main.includes(`ipcMain.handle('${c}'`)));
// Both machines mount the school from ONE list, so a module cannot be added
// to the office PC and forgotten on the server.
const modules = fs.readFileSync(path.join(ROOT, 'electron/register_modules.js'), 'utf8');
ck('...while every module registers through the recorder and the guard',
  modules.includes('registry.recordingIpcMain(ipcMain)') &&
  modules.includes('guardedIpcMain(recording, db)'));
ck('the office PC mounts the school from the shared list, not one of its own',
  main.includes('registerModules({') && !/mount\('students'/.test(main));
ck('...and so does the headless host',
  fs.readFileSync(path.join(ROOT, 'host/server.js'), 'utf8').includes('registerModules('));

// ── The browser answers the ones it must answer itself ──────────────────────
//
// Signing in, choosing a file, opening a file: three things that cannot travel
// as a channel because they are about the machine the person is sitting at.
for (const local of ['auth:login', 'auth:logout', 'auth:bootstrap-status',
                     'app:show-open-dialog', 'app:open-file', 'app:print-to-pdf']) {
  ck(`the browser answers ${local} itself`, desk.includes(`'${local}'`));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
