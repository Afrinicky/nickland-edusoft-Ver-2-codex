// Nickland Edusoft — serving the web app from the desktop host.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The same React app that ships as the phone APK, built for the browser and
// served by the desktop itself over the school Wi-Fi. A teacher opens
// http://192.168.1.20:4747 in Chrome and is in — nothing to install, and no
// internet required, which is the point: the desktop is the source of truth
// and the school's connection is not dependable.
//
// It is served over plain HTTP, on the same origin as /api/v1, deliberately:
//   • Same origin means no CORS and no mixed-content block. A browser on an
//     HTTPS page cannot call a plain-HTTP LAN address at all, so a portal copy
//     of the app could never reach a desktop on the Wi-Fi. This one can.
//   • Plain HTTP is not a secure context, so the service worker will not
//     register here. That is fine; on the LAN there is nothing to be offline
//     from. The HTTPS portal build is the installable one.
//
// Since the office application also has a browser build, this serves two:
//
//   /       the mobile app          `npm run build:web`
//   /desk   the office application  `npm run build:desk`
//
// They are different products for different people and they are kept at
// different addresses so that adding the second did not move the first.

const fs = require('fs');
const path = require('path');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
};

// Where the build lands, most specific first:
//   1. an explicit override, for development,
//   2. the packaged copy electron-builder places beside the app,
//   3. resources/webapp in the source tree,
//   4. mobile/dist-web, straight out of `npm run build:web`.
function candidateRoots() {
  const here = __dirname;                                   // electron/server
  const repo = path.resolve(here, '..', '..');
  const roots = [];
  if (process.env.EDUSOFT_WEBAPP_DIR) roots.push(process.env.EDUSOFT_WEBAPP_DIR);
  if (process.resourcesPath) roots.push(path.join(process.resourcesPath, 'resources', 'webapp'));
  roots.push(path.join(repo, 'resources', 'webapp'));
  roots.push(path.join(repo, 'mobile', 'dist-web'));
  return roots;
}

// Where the OFFICE application's browser build lands — the installed
// application's own screens, compiled for a browser. It is a different build
// from the one above and is served at a different address on purpose:
//
//   /       the mobile app, for parents and teachers on a phone
//   /desk   the office application, for staff at a desk
//
// Two audiences, two shapes, one host. Nothing about the mobile app changed
// when this was added — the address parents already have still answers, which
// is the whole reason the office application is not at the front door.
function candidateDeskRoots() {
  const here = __dirname;                                   // electron/server
  const repo = path.resolve(here, '..', '..');
  const roots = [];
  if (process.env.EDUSOFT_DESK_DIR) roots.push(process.env.EDUSOFT_DESK_DIR);
  if (process.resourcesPath) roots.push(path.join(process.resourcesPath, 'resources', 'desk'));
  roots.push(path.join(repo, 'resources', 'desk'));
  roots.push(path.join(repo, 'dist-desk'));
  return roots;
}

let cachedRoot;
let cachedDeskRoot;

function firstRootWithIndex(dirs) {
  for (const dir of dirs) {
    try {
      if (dir && fs.existsSync(path.join(dir, 'index.html'))) return dir;
    } catch (_) { /* unreadable candidate — try the next */ }
  }
  return null;
}

function webAppRoot() {
  if (cachedRoot !== undefined) return cachedRoot;
  cachedRoot = firstRootWithIndex(candidateRoots());
  return cachedRoot;
}

function deskAppRoot() {
  if (cachedDeskRoot !== undefined) return cachedDeskRoot;
  cachedDeskRoot = firstRootWithIndex(candidateDeskRoots());
  return cachedDeskRoot;
}

// The installed copy never changes underneath a running host, but a developer
// rebuilding into mobile/dist-web needs the next request to find it.
function forgetWebAppRoot() { cachedRoot = undefined; cachedDeskRoot = undefined; }

function isAvailable() { return !!webAppRoot(); }

function isDeskAvailable() { return !!deskAppRoot(); }

// Resolve a URL path to a file inside the build, or null. Anything that climbs
// out of the root (`..`, an absolute path, an encoded separator) resolves to
// null rather than to a file on the school's hard disk.
function resolveFile(root, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (_) { return null; }
  rel = rel.split('?')[0].split('#')[0];
  if (rel.endsWith('/')) rel += 'index.html';
  const full = path.resolve(root, '.' + path.posix.normalize(rel));
  const within = full === root || full.startsWith(root + path.sep);
  if (!within) return null;
  try {
    const st = fs.statSync(full);
    if (st.isDirectory()) return resolveFile(root, rel.replace(/\/*$/, '/') + 'index.html');
    return st.isFile() ? full : null;
  } catch (_) { return null; }
}

function cacheHeaderFor(pathname) {
  // Filenames under _expo/static and assets carry a content hash, so a cached
  // copy can never be the wrong copy — cache them hard.
  if (pathname.startsWith('/_expo/static/') || pathname.startsWith('/assets/')) {
    return 'public, max-age=31536000, immutable';
  }
  // The shell and the service worker decide what everything else loads. A
  // stale one pins users to an old build, so they are always revalidated.
  return 'no-cache';
}

function send(res, status, filePath, pathname, cacheHeader) {
  const ext = path.extname(filePath).toLowerCase();
  const body = fs.readFileSync(filePath);
  res.writeHead(status, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': cacheHeader || cacheHeaderFor(pathname),
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

// Handle a request for the web app. Returns true when it answered, false when
// the caller should carry on with its own routing (the API, a 404).
//
// Only GET and HEAD: everything that writes belongs to the API.
function serveWebApp(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (pathname.startsWith('/api/')) return false;

  const root = webAppRoot();
  if (!root) return false;

  try {
    const file = resolveFile(root, pathname);
    if (file) {
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': cacheHeaderFor(pathname),
        });
        return res.end(), true;
      }
      send(res, 200, file, pathname);
      return true;
    }

    // Single-page output: /parent/child/7 and every other client-side route
    // has no file of its own, so unmatched paths get the shell and the router
    // takes it from there. A request that plainly wants a file (it has an
    // extension) gets a 404 instead of an HTML page pretending to be a script.
    if (!path.extname(pathname)) {
      send(res, 200, path.join(root, 'index.html'), '/index.html');
      return true;
    }
  } catch (_) {
    // A half-written build directory should not take the API down with it.
    return false;
  }
  return false;
}

// The office application, at /desk. Same rules as above — GET and HEAD only,
// never in front of the API, no path that climbs out of the build — with one
// difference: everything under /desk that is not a file is the office
// application's shell, because /desk/students/7 is a screen and not a file.
//
// A request for /desk when no build is installed is answered rather than
// dropped. A school that has not built it should be told so, not left looking
// at a 404 wondering whether the address is wrong.
function serveDeskApp(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (pathname !== '/desk' && !pathname.startsWith('/desk/')) return false;

  const root = deskAppRoot();
  if (!root) {
    const body = '<!DOCTYPE html><meta charset="utf-8"><title>Nickland Edusoft</title>' +
      '<div style="font:16px/1.6 system-ui;margin:14vh auto;max-width:34rem;padding:0 1.5rem">' +
      '<h1 style="font-size:1.4rem">The office application is not installed here</h1>' +
      '<p>This school\u2019s computer is answering, but the browser build of the office ' +
      'application has not been put on it. Build it with <code>npm run build:desk</code> ' +
      'and start the host again.</p>' +
      '<p style="color:#666">The mobile app, for parents and teachers, is at ' +
      '<a href="/">this address without /desk</a>.</p></div>';
    res.writeHead(503, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? '' : body);
    return true;
  }

  // /desk and /desk/ both mean the shell.
  const rel = pathname === '/desk' ? '/' : pathname.slice('/desk'.length) || '/';

  try {
    const file = resolveFile(root, rel);
    if (file) {
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': deskCacheHeaderFor(rel),
        });
        return res.end(), true;
      }
      send(res, 200, file, rel, deskCacheHeaderFor(rel));
      return true;
    }
    if (!path.extname(rel)) {
      send(res, 200, path.join(root, 'index.html'), '/index.html', 'no-cache');
      return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

// Vite writes hashed filenames into assets/, so a cached copy can never be the
// wrong copy. Everything else is revalidated, for the same reason as above: a
// stale shell pins a school to an old build with nothing to say why.
function deskCacheHeaderFor(rel) {
  if (rel.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  return 'no-cache';
}

module.exports = {
  serveWebApp, isAvailable, webAppRoot, forgetWebAppRoot,
  serveDeskApp, isDeskAvailable, deskAppRoot,
};
