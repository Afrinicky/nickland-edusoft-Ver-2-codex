#!/usr/bin/env node
// Nickland Edusoft — the school's host, without a desktop.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The same application the office PC runs, on a server. Not a port of it and
// not a subset: the same 22,000 lines of handlers, mounted from the same list
// (electron/register_modules.js), answering the same channels through the same
// permission policy.
//
// That is the whole idea. The alternative — writing the school a second time in
// another language — was measured before this was built: about 12,000 more
// lines to write, and then two implementations of "take a payment" to keep in
// step with each other forever. This has one implementation, so it cannot
// drift, and it reached parity in days rather than months.
//
// What it needs that a desktop supplies for free is four things, and they are
// provided by electron/platform/server.js: headless Chromium for the PDFs,
// sharp for the photographs, a key from the environment for stored secrets,
// and a plain refusal for the file dialogs — because nobody is sitting at this
// machine.
//
//   EDUSOFT_DATA_DIR    where the school's database and uploads live.
//                       On a server this MUST be a persistent disk.
//   EDUSOFT_PORT        default 4747
//   EDUSOFT_BIND        default 0.0.0.0
//   EDUSOFT_SECRET_KEY  32+ characters; without it backup destination
//                       passwords are stored in the clear and say so.
//
//   node host/server.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Before anything else. Every module that needs a machine underneath asks the
// platform for it, and this is where the server's answer is installed — after
// this line, `require('electron')` is never reached.
const platform = require(path.join(ROOT, 'electron/platform'));
platform.install(require(path.join(ROOT, 'electron/platform/server')));

const { initDatabase } = require(path.join(ROOT, 'electron/db/database'));
const { registerModules } = require(path.join(ROOT, 'electron/register_modules'));
const { createApiServer } = require(path.join(ROOT, 'electron/server/api'));

const DATA_DIR = process.env.EDUSOFT_DATA_DIR || path.join(ROOT, '.host-data');
const PORT = parseInt(process.env.EDUSOFT_PORT || '4747', 10);
const BIND = process.env.EDUSOFT_BIND || '0.0.0.0';

function log(level, area, message) {
  // A server's log is stdout, which is what every host platform collects. No
  // file, no rotation, nothing to fill a disk nobody is watching.
  console.log(`${new Date().toISOString()} ${level.padEnd(5)} ${area} — ${message}`);
}

// The two things `app` is ever asked for, both of which belong to a machine
// somebody is sitting at: relaunching after a factory reset, and the folder a
// save dialog opens in. Neither happens here, and both are inside handlers the
// network cannot reach — but a stub beats a crash if that ever changes.
const appStub = {
  getVersion: () => require(path.join(ROOT, 'package.json')).version,
  getPath: (what) => (what === 'userData' ? DATA_DIR : path.join(DATA_DIR, what)),
  relaunch: () => log('warn', 'host', 'A relaunch was requested; a server does not relaunch itself.'),
  exit: () => log('warn', 'host', 'An exit was requested and ignored.'),
};

function getResourcePath(rel) {
  return path.join(ROOT, 'resources', rel);
}

function start() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

  log('info', 'host', `Nickland Edusoft ${appStub.getVersion()} starting as a server`);
  log('info', 'host', `School data: ${DATA_DIR}`);

  // Which database this host is the host OF.
  //
  // Without DATABASE_URL it opens the same local SQLite file the office PC
  // does — that is the LAN host, unchanged. With it, the school lives in
  // Postgres and the handlers reach it through an adapter wearing
  // better-sqlite3's shape (host/db/neon.js). Not one handler knows which.
  //
  // electron/db/database.js is untouched either way: the installed
  // application has no idea this branch exists.
  let db;
  try {
    if (process.env.DATABASE_URL) {
      const { openNeonDatabase } = require(path.join(ROOT, 'host/db/neon'));
      db = openNeonDatabase(process.env.DATABASE_URL, {
        schema: process.env.DATABASE_SCHEMA || null,
        poolSize: parseInt(process.env.DATABASE_POOL || '3', 10),
        latencyMs: parseInt(process.env.SPIKE_LATENCY_MS || '0', 10),
      });
      db._userDataPath = DATA_DIR;
      db._getResourcePath = getResourcePath;
      log('info', 'host', 'School database: Postgres');
    } else {
      db = initDatabase(DATA_DIR, getResourcePath);
      log('info', 'host', 'School database: local SQLite');
    }
  } catch (e) {
    log('error', 'host', `Could not open the school's database: ${(e && e.message) || e}`);
    process.exit(1);
  }

  // A stand-in for Electron's ipcMain. It refuses a duplicate channel exactly
  // as Electron does, because _stubs.js depends on that refusal to skip the
  // channels a real module already took.
  const taken = new Set();
  const ipcMain = {
    handle(channel) {
      if (taken.has(channel)) {
        throw new Error(`Attempted to register a second handler for '${channel}'`);
      }
      taken.add(channel);
    },
    removeHandler: (c) => taken.delete(c),
    on() {}, once() {}, removeAllListeners() {},
  };

  const { failed } = registerModules({
    ipcMain, db, userDataPath: DATA_DIR, getResourcePath,
    app: appStub,
    logger: { error: (a, m, d) => log('error', a, `${m} ${d || ''}`),
              warn: (a, m) => log('warn', a, m),
              info: (a, m) => log('info', a, m) },
  });

  if (failed.length) {
    log('warn', 'host', `Started with ${failed.length} module(s) unavailable: ${failed.join(', ')}`);
  } else {
    log('info', 'host', 'All modules registered');
  }

  if (!process.env.EDUSOFT_SECRET_KEY) {
    log('warn', 'host',
      'EDUSOFT_SECRET_KEY is not set — backup destination passwords will be stored in the clear.');
  }

  const server = createApiServer(db, { userDataPath: DATA_DIR });
  server.listen(PORT, BIND, () => {
    log('info', 'host', `Listening on ${BIND}:${PORT}`);
    log('info', 'host', `The office application is at /desk`);
  });

  const stop = async (signal) => {
    log('info', 'host', `${signal} — shutting down`);
    try { server.close(); } catch (_) {}
    try { await require(path.join(ROOT, 'electron/platform/server')).shutdown(); } catch (_) {}
    try { db.close(); } catch (_) {}
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  return { db, server };
}

if (require.main === module) start();

module.exports = { start };
