#!/usr/bin/env node
// Nickland Edusoft — the school's first administrator, on a server.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   DATABASE_URL=postgresql://… DATABASE_SCHEMA=school npm run host:create-admin -- --username nicholas
//
// A school that lives on the web has no office PC, and that is the one thing
// the sign-in screen assumes it has.
//
// `auth:bootstrap` — the channel that creates the very first account on a
// brand-new database — is refused over the browser on purpose
// (electron/server/desk_api.js): it asks for no credentials, because on a
// desktop the person running it is already sitting at the machine. Over the
// internet that reasoning does not hold, and the right answer is not to relax
// the rule but to give the person who owns the server a way in that a stranger
// with the address does not have. Running a command on the host IS that proof.
//
// So this is not a second implementation of anything. It opens the same
// database the host opens, registers the SAME auth module the application
// registers, and calls the SAME handler the installer's first screen calls —
// with its refusals intact:
//
//   · it will not run twice, and will not run at all once any user exists
//   · the password is bcrypt-hashed by the same code that checks it at sign-in
//   · the account gets the Super Admin designation, by the same lookup
//
// Every account after this one is made in the office: Settings → Users &
// Access. This exists for the chicken and egg at the very beginning.

const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');

const ROOT = path.resolve(__dirname, '..');

// Before anything that might ask the machine for something. The same install
// host/server.js does, so the modules below load the same way they do there.
const platform = require(path.join(ROOT, 'electron/platform'));
platform.install(require(path.join(ROOT, 'electron/platform/server')));

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const value = (flag, fallback = null) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

if (has('--help') || has('-h')) {
  console.log(`
Create the school's first administrator.

  DATABASE_URL=… DATABASE_SCHEMA=school npm run host:create-admin -- --username NAME

  --username NAME     what they sign in with            (asked for if absent)
  --name "Full Name"  how the school sees them          (default: the username)
  --password PASS     avoid this — it stays in your shell history
  --password-stdin    read the password from stdin instead
  --generate          make a strong password and print it once
  --help

With none of the password options, it asks for one and does not echo it.
Without DATABASE_URL it works on the local SQLite file, as the host does.
`);
  process.exit(0);
}

const DATA_DIR = process.env.EDUSOFT_DATA_DIR || path.join(ROOT, '.host-data');

function fail(message) {
  console.error('\n' + message + '\n');
  process.exit(1);
}

// Typed rather than echoed. A password on a shared terminal that anybody
// behind you can read is not a password.
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let shown = false;
    rl._writeToOutput = (s) => {
      if (!shown) { rl.output.write(question); shown = true; }
      else if (s.includes('\n')) rl.output.write('\n');
    };
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

function askPlain(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(String(answer).trim()); });
  });
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { buf += d; });
    process.stdin.on('end', () => resolve(buf.replace(/\r?\n$/, '')));
  });
}

// Not the alphabet a person would choose, which is the point. No characters
// that a phone keyboard hides or that a school's own paperwork mangles.
function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(20)).map((b) => alphabet[b % alphabet.length]).join('');
}

function openDatabase() {
  if (process.env.DATABASE_URL) {
    const { openNeonDatabase } = require(path.join(ROOT, 'host/db/neon'));
    const db = openNeonDatabase(process.env.DATABASE_URL, {
      schema: process.env.DATABASE_SCHEMA || null,
      poolSize: 2,
      // One command, one look at the database. A remembered read here could
      // only ever be wrong about whether the account already exists.
      cache: false,
      onNotice: (m) => console.log('· ' + m),
    });
    db._userDataPath = DATA_DIR;
    console.log('· Database: Postgres' +
      (process.env.DATABASE_SCHEMA ? ` (schema ${process.env.DATABASE_SCHEMA})` : ''));
    return db;
  }
  const { initDatabase } = require(path.join(ROOT, 'electron/db/database'));
  console.log(`· Database: local SQLite in ${DATA_DIR}`);
  return initDatabase(DATA_DIR, (rel) => path.join(ROOT, 'resources', rel));
}

async function main() {
  const db = openDatabase();

  // The application's own auth module, registered against a stand-in for
  // Electron's ipcMain that keeps the handlers instead of wiring them to a
  // window. Nothing here re-implements a rule; it calls the rules.
  const handlers = new Map();
  const ipcMain = {
    handle: (channel, fn) => handlers.set(channel, fn),
    removeHandler: (channel) => handlers.delete(channel),
    on() {}, once() {}, removeAllListeners() {},
  };
  require(path.join(ROOT, 'electron/ipc/auth'))(ipcMain, db);

  const status = await handlers.get('auth:bootstrap-status')();
  if (status && status.done) {
    fail('This school already has its first administrator.\n' +
         'Sign in at /desk, then add people under Settings → Users & Access.');
  }

  let username = value('--username') || '';
  if (!username) username = await askPlain('Username: ');
  if (!username) fail('A username is required.');

  const fullName = value('--name') || (await askPlain(`Full name [${username}]: `)) || username;

  let password = value('--password');
  if (password) {
    console.log('· --password was given on the command line; it is in your shell history now. ' +
                'Change it after signing in, or use --generate next time.');
  } else if (has('--generate')) {
    password = generatePassword();
  } else if (has('--password-stdin') || !process.stdin.isTTY) {
    password = await readStdin();
  } else {
    password = await askHidden('Password (at least 6 characters): ');
    const again = await askHidden('Again: ');
    if (password !== again) fail('Those two passwords are not the same. Nothing was created.');
  }
  if (!password) fail('A password is required.');

  // The installer's own first screen, called from a terminal.
  const result = await handlers.get('auth:bootstrap')(null, { fullName, username, password });
  if (!result || !result.ok) {
    fail('Could not create the administrator: ' + ((result && result.error) || 'unknown error'));
  }

  console.log(`\n✓ ${fullName} can now sign in as "${username}".`);
  if (has('--generate')) {
    console.log(`\n  Password: ${password}`);
    console.log('  This is the only time it is shown. Give it to them by a route you trust.');
  }
  console.log('\nNext: open /desk, sign in, and set the school\'s name, colours and crest');
  console.log('under Settings. Everybody else is added there too — Users & Access.');

  try { db.close(); } catch (_) {}
}

main().catch((e) => fail('Could not create the administrator: ' + ((e && e.message) || e)));
