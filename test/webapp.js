// Nickland Edusoft — serving the web app from the desktop host.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/webapp.js
//
// Covers electron/server/webapp.js against a throwaway build directory, so it
// runs with no Expo toolchain and no native modules. The cases are the ones
// that would actually bite a school:
//   • the app must not shadow the API,
//   • client-side routes must reach the app rather than 404,
//   • a crafted URL must not read files off the school's hard disk,
//   • a hashed asset must be cacheable and the shell must not be.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const ck = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? '✓' : '✗') + ' ' + name); };

// A minimal stand-in for an `expo export` output.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-webapp-'));
fs.mkdirSync(path.join(root, '_expo', 'static', 'js', 'web'), { recursive: true });
fs.writeFileSync(path.join(root, 'index.html'), '<!DOCTYPE html><title>Nickland Edusoft</title><div id="root"></div>');
fs.writeFileSync(path.join(root, 'manifest.json'), '{"name":"Nickland Edusoft"}');
fs.writeFileSync(path.join(root, '_expo', 'static', 'js', 'web', 'entry-abc123.js'), 'console.log(1)');
// The file a traversal attempt would be reaching for.
const secret = path.join(root, '..', `nk-secret-${process.pid}.txt`);
fs.writeFileSync(secret, 'DATABASE_PASSWORD=hunter2');

// A minimal stand-in for a `vite build` of the office application. It is a
// separate build served at a separate address, and the cases below are about
// the two not treading on each other.
const deskRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-desk-'));
fs.mkdirSync(path.join(deskRoot, 'assets'), { recursive: true });
fs.writeFileSync(path.join(deskRoot, 'index.html'),
  '<!DOCTYPE html><title>Nickland Edusoft</title><div id="root"></div><!--office-->');
fs.writeFileSync(path.join(deskRoot, 'assets', 'desk-Xy12ab.js'), 'console.log(2)');

process.env.EDUSOFT_WEBAPP_DIR = root;
process.env.EDUSOFT_DESK_DIR = deskRoot;
const webapp = require(path.join(__dirname, '..', 'electron', 'server', 'webapp.js'));
webapp.forgetWebAppRoot();

// Stands in for the host's dispatcher: the web app gets first refusal on
// GET/HEAD, and anything it declines falls through to the "API".
const server = http.createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0];
  if (webapp.serveDeskApp(req, res, pathname)) return;
  if (webapp.serveWebApp(req, res, pathname)) return;
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Not found', from: 'api' }));
});

function get(base, p, method = 'GET') {
  return new Promise((resolve) => {
    const u = new URL(base + p);
    // `path` is passed through unnormalised on purpose: a traversal attempt
    // arrives on the wire exactly as written, and that is what must be refused.
    const r = http.request({ host: u.hostname, port: u.port, path: p, method }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
    });
    r.on('error', () => resolve({ status: 0, body: '', headers: {} }));
    r.end();
  });
}

(async () => {
  ck('a build directory is found', webapp.isAvailable() && webapp.webAppRoot() === root);

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  let r = await get(base, '/');
  ck('root serves the shell', r.status === 200 && /Nickland Edusoft/.test(r.body));
  ck('the shell is never cached', r.headers['cache-control'] === 'no-cache');

  r = await get(base, '/_expo/static/js/web/entry-abc123.js');
  ck('hashed bundle is served', r.status === 200 && r.body === 'console.log(1)');
  ck('hashed bundle is cached hard', /immutable/.test(r.headers['cache-control'] || ''));
  ck('bundle is typed as JavaScript', /javascript/.test(r.headers['content-type'] || ''));

  r = await get(base, '/manifest.json');
  ck('web manifest is served', r.status === 200 && /Nickland Edusoft/.test(r.body));

  // Single-page output: these paths have no file, and must not 404.
  for (const route of ['/login', '/connect', '/parent/child/7', '/staff/attendance']) {
    r = await get(base, route);
    if (!(r.status === 200 && /id="root"/.test(r.body))) { ck(`client-side route ${route} reaches the app`, false); }
  }
  ck('client-side routes all reach the app', true);

  // …but a request that plainly wants a file must not get HTML pretending to
  // be one, or the browser executes the shell as a script and the app breaks
  // in a way nobody can read from a stack trace.
  r = await get(base, '/_expo/static/js/web/entry-doesnotexist.js');
  ck('a missing asset 404s rather than returning the shell', r.status === 404 && /"from":"api"/.test(r.body));

  // The API must keep priority over every one of these.
  r = await get(base, '/api/v1/info');
  ck('API paths fall through to the API', r.status === 404 && /"from":"api"/.test(r.body));

  // Writes are the API's, always — a POST must never be answered with a page.
  r = await get(base, '/api/v1/auth/login', 'POST');
  ck('POST falls through to the API', r.status === 404 && /"from":"api"/.test(r.body));

  for (const attack of [
    `/../nk-secret-${process.pid}.txt`,
    `/..%2fnk-secret-${process.pid}.txt`,
    `/%2e%2e/nk-secret-${process.pid}.txt`,
    `/_expo/../../nk-secret-${process.pid}.txt`,
    // Backslashes are a separator on Windows, where the desktop actually runs,
    // and posix normalisation leaves them alone — this is the case the
    // "resolved path is inside the root" check exists for.
    `/..%5cnk-secret-${process.pid}.txt`,
    `/%5c..%5cnk-secret-${process.pid}.txt`,
  ]) {
    r = await get(base, attack);
    if (/hunter2/.test(r.body)) { ck(`traversal refused: ${attack}`, false); }
  }
  ck('path traversal cannot read outside the build', true);

  r = await get(base, '/', 'HEAD');
  ck('HEAD returns headers with no body', r.status === 200 && r.body === '');

  // ══ The office application, at its own address ═══════════════════════════
  //
  // Two applications on one host, for two different people. The thing that
  // would go wrong is not that /desk 404s — it is that /desk quietly returns
  // the PARENTS' app, because the mobile build's single-page fallback answers
  // every path that has no file. A teacher would open the office address and
  // be shown a parent's screen.

  r = await get(base, '/desk');
  ck('the office application answers at /desk',
    r.status === 200 && /office/.test(r.body));

  r = await get(base, '/desk/');
  ck('...with or without the trailing slash', r.status === 200 && /office/.test(r.body));

  r = await get(base, '/desk/assets/desk-Xy12ab.js');
  ck('its bundle is served', r.status === 200 && r.body === 'console.log(2)');
  ck('...and cached hard, being hashed', /immutable/.test(r.headers['cache-control'] || ''));

  for (const route of ['/desk/students', '/desk/fees/bills', '/desk/settings/access']) {
    r = await get(base, route);
    if (!(r.status === 200 && /office/.test(r.body))) {
      ck(`office route ${route} reaches the office application`, false);
    }
  }
  ck('office routes all reach the office application, not the parents’ app', true);

  r = await get(base, '/');
  ck('and the mobile app is exactly where it was', r.status === 200 && !/office/.test(r.body));

  r = await get(base, '/api/v1/desk/call', 'POST');
  ck('the desk API is the API’s, not the page’s', r.status === 404 && /"from":"api"/.test(r.body));

  for (const attack of [
    `/desk/../../nk-secret-${process.pid}.txt`,
    `/desk/..%2f..%2fnk-secret-${process.pid}.txt`,
    `/desk/%2e%2e/%2e%2e/nk-secret-${process.pid}.txt`,
  ]) {
    r = await get(base, attack);
    if (/hunter2/.test(r.body)) { ck(`office traversal refused: ${attack}`, false); }
  }
  ck('path traversal cannot read outside the office build either', true);

  server.close();
  try {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(deskRoot, { recursive: true, force: true });
    fs.unlinkSync(secret);
  } catch (_) {}

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
