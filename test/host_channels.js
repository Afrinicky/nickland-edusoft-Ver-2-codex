// Nickland Edusoft — every screen's first question, asked of Postgres.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   DATABASE_URL=… DATABASE_SCHEMA=school node test/host_channels.js
//
// A school opened the canteen screen on the web and got a WHITE PAGE. The
// handler had asked Postgres a question SQLite answers and Postgres refuses —
// a bare column beside an aggregate — and the screen, handed an error where it
// expected figures, took the whole office down with it.
//
// Nothing in the suite would have caught it. test/host_postgres.js proves the
// ADAPTER works; the dialect tests prove statements TRANSLATE. Neither runs the
// 22,000 lines of handlers against a real Postgres, which is where the
// difference between the two databases actually lives.
//
// So this calls every channel a screen opens with — the lists, the dashboards,
// the summaries — and fails on the ones the DATABASE refuses. A handler asking
// for an argument this test does not know is not a failure: that is this
// test's blind spot, and it is named rather than hidden.
//
// It skips without DATABASE_URL, as the other online tests do.

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

if (!process.env.DATABASE_URL) {
  console.log('DATABASE_URL is not set — skipping the channel sweep.');
  console.log('  Provision a throwaway database, then:');
  console.log('  DATABASE_URL=… DATABASE_SCHEMA=school node test/host_channels.js');
  process.exit(0);
}

const platform = require(path.join(ROOT, 'electron/platform'));
platform.install(require(path.join(ROOT, 'electron/platform/server')));

const { openNeonDatabase } = require(path.join(ROOT, 'host/db/neon'));
const { registerModules } = require(path.join(ROOT, 'electron/register_modules'));
const registry = require(path.join(ROOT, 'electron/ipc/_registry'));
const security = require(path.join(ROOT, 'electron/ipc/_security'));

const DATA = process.env.EDUSOFT_DATA_DIR || path.join(ROOT, '.host-data');
const db = openNeonDatabase(process.env.DATABASE_URL, {
  schema: process.env.DATABASE_SCHEMA || null,
  cache: false,
});
db._userDataPath = DATA;
db._getResourcePath = (rel) => path.join(ROOT, 'resources', rel);

const taken = new Set();
const ipcMain = {
  handle: (c) => { if (taken.has(c)) throw new Error(`second handler for ${c}`); taken.add(c); },
  removeHandler: (c) => taken.delete(c), on() {}, once() {}, removeAllListeners() {},
};
registerModules({
  ipcMain, db, userDataPath: DATA, getResourcePath: db._getResourcePath,
  app: { getVersion: () => require(path.join(ROOT, 'package.json')).version, getPath: () => DATA },
  logger: { error() {}, warn() {}, info() {} },
});

// What Postgres says when it refuses a question. A handler that wanted an
// argument says something else entirely, and is not this test's business.
const REFUSED = /GROUP BY|does not exist|syntax error|operator does not exist|invalid input syntax|cannot be matched|column .* must|argument of .* must be|failed to find conversion/i;

// The channels a screen opens with. Nothing that writes, deletes or resets.
const OPENING = /:(list|get|dashboard|summary|stats|status|overview|all|report|info|options|counts|current|active|recent|search|coverage|tree|config|settings)/i;
const NEVER = /(delete|remove|reset|factory|wipe|purge)/i;

const channels = registry.channels().filter((c) => OPENING.test(c) && !NEVER.test(c));

(async () => {
  let asked = 0, refused = 0, unknown = 0;
  const broken = [];

  for (const channel of channels) {
    let settled = false;
    // Three shapes, because a handler's arguments are its own business: no
    // arguments, one empty one, and an options object.
    for (const args of [[], [null], [{}]]) {
      try {
        await security.runAs({ userId: 1, designation: 'Super Admin' },
          () => registry.callChannel(channel, args));
        asked++; settled = true; break;
      } catch (e) {
        const message = (e && e.message) || String(e);
        if (REFUSED.test(message)) {
          refused++; settled = true;
          broken.push([channel, message.split('\n')[0].slice(0, 140)]);
          break;
        }
      }
    }
    if (!settled) unknown++;
  }

  for (const [channel, message] of broken) console.log(`✗ ${channel}\n     ${message}`);
  if (!broken.length) console.log(`✓ ${asked} channels answered; the database refused none of them`);
  if (unknown) {
    console.log(`\n  (${unknown} wanted arguments this test does not know, and were not asked.` +
                ' That is this sweep\'s blind spot.)');
  }

  console.log(`\n${asked} passed, ${refused} failed`);
  db.close();
  process.exit(refused ? 1 : 0);
})();
