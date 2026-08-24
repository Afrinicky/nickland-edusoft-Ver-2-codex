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
// Build it with `npm run build:web` at the repo root.

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

let cachedRoot;
function webAppRoot() {
  if (cachedRoot !== undefined) return cachedRoot;
  cachedRoot = null;
  for (const dir of candidateRoots()) {
    try {
      if (dir && fs.existsSync(path.join(dir, 'index.html'))) { cachedRoot = dir; break; }
    } catch (_) { /* unreadable candidate — try the next */ }
  }
  return cachedRoot;
}

// The installed copy never changes underneath a running host, but a developer
// rebuilding into mobile/dist-web needs the next request to find it.
function forgetWebAppRoot() { cachedRoot = undefined; }

function isAvailable() { return !!webAppRoot(); }

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

function send(res, status, filePath, pathname) {
  const ext = path.extname(filePath).toLowerCase();
  const body = fs.readFileSync(filePath);
  res.writeHead(status, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': cacheHeaderFor(pathname),
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

module.exports = { serveWebApp, isAvailable, webAppRoot, forgetWebAppRoot };
