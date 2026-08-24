// Nickland Edusoft Cloud — serving the web app.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The browser build of the mobile app (`mobile/dist-web`), served from the
// same origin as /api/v1 so one URL is the whole product: parents open the
// portal address and are in, with no CORS and nothing to install.
//
// It is optional. The usual production shape puts the static build on a CDN
// (Vercel) and this service behind it as the API, in which case no build is
// installed here and the legacy portal page still answers at `/`. Copy a build
// into `cloud/webapp/` — or point WEBAPP_DIR at one — and it takes over.

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
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
};

let cachedRoot;
function webAppRoot() {
  if (cachedRoot !== undefined) return cachedRoot;
  cachedRoot = null;
  const roots = [
    process.env.WEBAPP_DIR,
    path.resolve(__dirname, '..', 'webapp'),          // cloud/webapp — what the Dockerfile fills
    path.resolve(__dirname, '..', '..', 'mobile', 'dist-web'),  // straight from a local build
  ];
  for (const dir of roots) {
    try {
      if (dir && fs.existsSync(path.join(dir, 'index.html'))) { cachedRoot = dir; break; }
    } catch (_) { /* unreadable candidate — try the next */ }
  }
  return cachedRoot;
}

function isAvailable() { return !!webAppRoot(); }

// Resolve a URL path to a file inside the build, or null. Anything that climbs
// out of the root resolves to null rather than to a file on the server.
function resolveFile(root, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (_) { return null; }
  rel = rel.split('?')[0].split('#')[0];
  if (rel.endsWith('/')) rel += 'index.html';
  const full = path.resolve(root, '.' + path.posix.normalize(rel));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  try {
    const st = fs.statSync(full);
    if (st.isDirectory()) return resolveFile(root, rel.replace(/\/*$/, '/') + 'index.html');
    return st.isFile() ? full : null;
  } catch (_) { return null; }
}

// Hashed filenames can never be the wrong copy; the shell and the service
// worker decide what everything else loads, so those are always revalidated.
function cacheHeaderFor(pathname) {
  return (pathname.startsWith('/_expo/static/') || pathname.startsWith('/assets/'))
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}

function send(res, filePath, pathname, headOnly) {
  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': cacheHeaderFor(pathname),
    'X-Content-Type-Options': 'nosniff',
  };
  if (headOnly) { res.writeHead(200, headers); return res.end(); }
  const body = fs.readFileSync(filePath);
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(body);
}

// Returns true when it answered; false to let the caller carry on routing.
function serveWebApp(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (pathname.startsWith('/api/')) return false;

  const root = webAppRoot();
  if (!root) return false;

  try {
    const file = resolveFile(root, pathname);
    if (file) { send(res, file, pathname, req.method === 'HEAD'); return true; }

    // Single-page output: client-side routes have no file of their own, so
    // extension-less paths get the shell. A path that plainly wants a file
    // gets a 404 rather than HTML pretending to be a script.
    if (!path.extname(pathname)) {
      send(res, path.join(root, 'index.html'), '/index.html', req.method === 'HEAD');
      return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

module.exports = { serveWebApp, isAvailable, webAppRoot };
