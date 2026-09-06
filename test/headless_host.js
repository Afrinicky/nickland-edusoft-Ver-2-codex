// Nickland Edusoft — the installer's own code, running without a desktop.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/headless_host.js
//
// The claim: everything the installed application can do, the online one can
// do — not because it was rewritten, but because it is the same code.
//
// That claim is cheap to make and easy to get wrong, so this boots the real
// headless host (host/server.js), against a real database, and asks it to do
// the school's actual work: read the roll, run a payroll schedule, print a
// PDF. Nothing is stubbed. If a handler reaches for Electron, this fails.
//
// It needs better-sqlite3 built for Node — the same native module the desktop
// uses. Where it is not built (a checkout installed with --ignore-scripts,
// which is what CI does for the fast suites) the whole file skips with a
// message rather than failing, exactly as the online tests skip without
// Postgres.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const ck = (n, c) => { c ? pass++ : fail++; console.log((c ? '✓' : '✗') + ' ' + n); };

try {
  require(path.join(ROOT, 'node_modules/better-sqlite3'));
} catch (_) {
  console.log('better-sqlite3 is not built for Node here — skipping the headless host.');
  console.log('  Build it with: npm rebuild better-sqlite3 --build-from-source');
  process.exit(0);
}

const Database = require(path.join(ROOT, 'node_modules/better-sqlite3'));
const bcrypt = require(path.join(ROOT, 'node_modules/bcryptjs'));

function req(port, method, p, { token, body } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      let d = ''; res.on('data', c => { d += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, text: d }); }
      });
    });
    r.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-host-'));
  const port = 4900 + (process.pid % 400);

  // This suite is about the host on its LOCAL SQLite file. A DATABASE_URL left
  // in the environment — from a Postgres test in the same shell — would send it
  // somewhere else entirely and report failures that belong to a different
  // database. test/host_postgres.js is the one that talks to Postgres.
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_SCHEMA;

  process.env.EDUSOFT_DATA_DIR = dataDir;
  process.env.EDUSOFT_PORT = String(port);
  process.env.EDUSOFT_BIND = '127.0.0.1';

  // A headless browser, if this machine has one. Without it the PDF check
  // below reports that rather than failing — the school's work is not held
  // hostage to whether a test runner has Chromium.
  if (!process.env.EDUSOFT_CHROMIUM) {
    for (const guess of ['/opt/pw-browsers']) {
      try {
        const dir = fs.readdirSync(guess).find(d => d.startsWith('chromium-'));
        const exe = dir && path.join(guess, dir, 'chrome-linux', 'chrome');
        if (exe && fs.existsSync(exe)) { process.env.EDUSOFT_CHROMIUM = exe; break; }
      } catch (_) { /* no browser here */ }
    }
  }

  // ── It starts at all ──────────────────────────────────────────────────────
  //
  // This is the whole point. Every module of the school, mounted on plain
  // Node. Before the platform work, `photos.js` alone made this impossible:
  // it required Electron at the top of the file.
  let host;
  try {
    host = require(path.join(ROOT, 'host/server')).start();
  } catch (e) {
    ck('the school\'s host starts without a desktop — ' + e.message, false);
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(1);
  }
  ck('the school\'s host starts without a desktop', !!host && !!host.db);

  await new Promise(r => setTimeout(r, 500));

  const registry = require(path.join(ROOT, 'electron/ipc/_registry'));
  ck('...with every module mounted, not a subset', registry.channels().length > 340);

  // ── A school, and somebody to run it ──────────────────────────────────────
  const db = host.db;
  const designation = db.prepare("SELECT id FROM designations WHERE name = 'Super Admin'").get();
  db.prepare(`INSERT INTO users (username, password_hash, full_name, designation_id, is_active)
              VALUES (?, ?, ?, ?, 1)`)
    .run('nick', bcrypt.hashSync('admin123', 8), 'NICHOLAS', designation ? designation.id : null);
  db.prepare(`INSERT INTO settings (key, value, category) VALUES ('bootstrap_done','true','system')
              ON CONFLICT (key) DO UPDATE SET value = 'true'`).run();

  const cls = db.prepare('SELECT id FROM class_groups ORDER BY level_order LIMIT 1').get();
  if (cls) {
    db.prepare(`INSERT INTO students (index_number, surname, first_name, current_class_id, status, admission_date)
                VALUES ('AVE/001','ANSU','Monalisa', ?, 'Active', date('now'))`).run(cls.id);
  }

  let r = await req(port, 'GET', '/api/v1/desk/info');
  ck('it answers as a Nickland Edusoft school', r.status === 200 && r.json.desk === true);

  r = await req(port, 'POST', '/api/v1/desk/login', { body: { username: 'nick', password: 'admin123' } });
  ck('somebody can sign in to it', r.status === 200 && !!r.json.token);
  const token = r.json.token;

  const call = (channel, ...args) =>
    req(port, 'POST', '/api/v1/desk/call', { token, body: { channel, args } });

  // ── The school's actual work ──────────────────────────────────────────────
  //
  // One from each part of the application, chosen because each exercises real
  // logic rather than an empty read: money, marks, people, the timetable.
  const work = [
    ['the roll', 'students:list', {}],
    ['the classes', 'settings:list-classes'],
    ['the terms', 'settings:list-terms'],
    ['the staff roll', 'staff:list', {}],
    ['the dashboard', 'dashboard:summary', null],
    ['fee templates', 'fees:list-templates', {}],
    ['the books', 'finance:list-income', {}],
    ['the SSNIT schedule', 'payroll:ssnit-schedule', { month: 1, year: 2026 }],
    ['the canteen', 'canteen:dashboard', null],
    ['the audit trail', 'audit:list', {}],
    ['the bell schedule', 'timetable:list-periods'],
    ['inventory', 'inventory:list-items', {}],
    ['transport routes', 'transport:list-routes'],
    ['messages', 'messages:list-threads', {}],
    ['the grading weights', 'scores:get-weights'],
    ['examination papers', 'exams:list-papers', {}],
    ['notices', 'announcements:list', {}],
  ];

  for (const [what, channel, ...args] of work) {
    const res = await call(channel, ...args);
    const answered = res.status === 200 && res.json && res.json.ok === true;
    if (!answered) {
      ck(`${what} (${channel}) — ${JSON.stringify(res.json || res.error).slice(0, 120)}`, false);
    }
  }
  ck(`the school's work is answered by the server — ${work.length} of ${work.length}`,
    fail === 0);

  // ── The rules travel with it ──────────────────────────────────────────────
  r = await call('students:list', {});
  ck('a signed-in administrator reads the roll',
    r.status === 200 && Array.isArray(r.json.result));

  r = await req(port, 'POST', '/api/v1/desk/call', { body: { channel: 'students:list', args: [{}] } });
  ck('...and nobody reads it without signing in', r.status === 401);

  r = await call('backup:restore', '/anything');
  ck('what belongs to the office PC is refused here too', r.json.host_only === true);

  // ── Printing, which is the one thing a server genuinely lacks ─────────────
  // A browser BINARY is not enough — the host drives it through puppeteer or
  // playwright, and without one of those modules there is nothing to drive it
  // with. Checking EDUSOFT_CHROMIUM alone made this attempt the PDF on a
  // machine that could not produce one, and report a failure that was really
  // a missing dependency.
  const driver = (() => {
    for (const name of ['puppeteer', 'playwright', 'playwright-core']) {
      try { require(name); return name; } catch (_) { /* try the next */ }
    }
    return null;
  })();

  if (driver) {
    const out = await call('reports:class-list', cls ? cls.id : 1, {});
    const result = out.json && out.json.result;
    ck('a class list prints — the same HTML, through headless Chromium',
      out.status === 200 && result && result.ok === true);
    if (result && result.ok && result.path && fs.existsSync(result.path)) {
      const bytes = fs.readFileSync(result.path);
      ck('...and what comes out is a real PDF',
        bytes.length > 1000 && bytes.subarray(0, 5).toString() === '%PDF-');
    }
  } else {
    console.log('· no headless browser driver on this machine — the PDF check was skipped.');
    console.log('  The host needs puppeteer or playwright to produce PDFs: npm install puppeteer');
  }

  try { host.server.close(); } catch (_) {}
  try { await require(path.join(ROOT, 'electron/platform/server')).shutdown(); } catch (_) {}
  try { db.close(); } catch (_) {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
