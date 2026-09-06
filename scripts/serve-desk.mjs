#!/usr/bin/env node
// Serve dist-desk locally, the way a school's computer would.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// For looking at a build before it ships. It serves the files and nothing
// else — no API — so the Connect screen is where you point it at a school.
//
//   node scripts/serve-desk.mjs [port]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.EDUSOFT_DESK_DIR || path.join(repo, 'dist-desk');
const port = parseInt(process.argv[2] || process.env.PORT || '4749', 10);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2',
};

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`✖ No build at ${root}. Run: npm run build:desk`);
  process.exit(1);
}

http.createServer((req, res) => {
  let pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  // Built with base /desk/, so that is where its own assets are asked for.
  if (pathname.startsWith('/desk')) pathname = pathname.slice('/desk'.length) || '/';
  let file = path.resolve(root, '.' + path.posix.normalize(pathname));
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}).listen(port, () => console.log(`Nickland Edusoft office application → http://localhost:${port}/desk/`));
