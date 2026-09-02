// Nickland Edusoft — who may call what, and about whom.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The audit behind these tests found no permission checks at all across the
// students, scores, exams, timetable, homework and canteen handlers. Settings
// → Roles & Access wrote the rules; nothing read them. Turning off "Students:
// create" left the admissions form admitting.
//
// These run the REAL guard over the REAL policy against a real database, with
// a fake ipcMain, so what is asserted here is what the app enforces.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`These tests need Node >= 22.5 for node:sqlite (running ${process.versions.node}).`);
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { SCHEMA, runMigrations, seedDefaults } = require(path.join(ROOT, 'electron/db/database.js'));
const security = require(path.join(ROOT, 'electron/ipc/_security.js'));
const scopes = require(path.join(ROOT, 'electron/ipc/_scope.js'));
const { guardedIpcMain } = require(path.join(ROOT, 'electron/ipc/_guard.js'));

let pass = 0, fail = 0;
const ck = (n, c) => { c ? pass++ : fail++; console.log((c ? '✓' : '✗') + ' ' + n); };

// A stand-in for ipcMain that records handlers so the tests can call them.
function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, fn) {
      if (handlers.has(channel)) throw new Error('duplicate ' + channel);
      handlers.set(channel, fn);
    },
    on() {}, once() {}, removeHandler() {}, removeAllListeners() {},
  };
}

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...a) => {
    db.exec('BEGIN');
    try { const r = fn(...a); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  db.exec(SCHEMA);
  runMigrations(db);
  // Designations and their permission defaults. Without them every account
  // has a null designation, which is not a state the app ever ships.
  seedDefaults(db);
  return db;
}

const db = makeDb();

// ── a school: three classes, two subjects, four kinds of staff ──
// Ids well clear of the ones seedDefaults ships.
const B4 = 901, B5 = 902, B6 = 903;
const MATHS = 901, FRENCH = 902;
db.exec(`
  INSERT INTO class_groups (id, name, short_code, level_category, level_order) VALUES
    (901, 'Test B4', 'TB4', 'Primary', 4),
    (902, 'Test B5', 'TB5', 'Primary', 5),
    (903, 'Test B6', 'TB6', 'Primary', 6);
  INSERT INTO subjects (id, name, code, is_active) VALUES
    (901, 'Test Mathematics', 'TMTH', 1),
    (902, 'Test French', 'TFRE', 1);
`);
for (const [id, sur, cls] of [[901, 'ANSU', B4], [902, 'BOATENG', B5], [903, 'MENSAH', B6]]) {
  db.prepare(`INSERT INTO students (id, index_number, surname, first_name, current_class_id, status)
              VALUES (?, ?, ?, 'Test', ?, 'Active')`).run(id, `AVE/00${id}`, sur, cls);
}

function makeUser({ username, designation, staffName }) {
  const d = db.prepare('SELECT id FROM designations WHERE name = ?').get(designation);
  db.prepare(`INSERT INTO staff (surname, first_name, role, status, staff_number)
              VALUES (?, 'T', 'Teaching', 'Active', ?)`).run(staffName, 'S/' + username);
  const staffId = db.prepare('SELECT id FROM staff WHERE staff_number = ?').get('S/' + username).id;
  db.prepare(`INSERT INTO users (username, password_hash, full_name, designation_id, staff_id, is_active)
              VALUES (?, 'x', ?, ?, ?, 1)`).run(username, staffName, d ? d.id : null, staffId);
  return {
    userId: db.prepare('SELECT id FROM users WHERE username = ?').get(username).id,
    staffId,
    designation,
  };
}

function assign(staffId, { classId = null, subjectId = null, classTeacher = 0 }) {
  db.prepare(`INSERT INTO staff_assignments (staff_id, class_group_id, subject_id, is_class_teacher)
              VALUES (?, ?, ?, ?)`).run(staffId, classId, subjectId, classTeacher);
}

function grant(userId, module, { view = 0, create = 0, edit = 0, del = 0 }) {
  db.prepare(`INSERT INTO user_permission_overrides (user_id, module, can_view, can_create, can_edit, can_delete)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (user_id, module) DO UPDATE SET
                can_view = excluded.can_view, can_create = excluded.can_create,
                can_edit = excluded.can_edit, can_delete = excluded.can_delete`)
    .run(userId, module, view, create, edit, del);
}

const admin = makeUser({ username: 'admin', designation: 'Administrator', staffName: 'ADMIN' });

// Justice: class teacher of Basic 5, and takes French in Basic 6.
// This is the case the school described — a class of one's own, plus a subject
// somewhere else — so it is the case the model has to get right.
const justice = makeUser({ username: 'justice', designation: 'Class Teacher', staffName: 'JUSTICE' });
assign(justice.staffId, { classId: B5, classTeacher: 1 });
assign(justice.staffId, { classId: B6, subjectId: FRENCH });
for (const m of ['students', 'academics', 'canteen']) {
  grant(justice.userId, m, { view: 1, edit: 1, create: 1 });
}

// Ama takes Mathematics wherever it is taught, and holds no class.
const ama = makeUser({ username: 'ama', designation: 'Subject Teacher', staffName: 'AMA' });
assign(ama.staffId, { subjectId: MATHS });
grant(ama.userId, 'academics', { view: 1, edit: 1 });

// ── the guard, over the real policy ──
const ipc = fakeIpcMain();
const guarded = guardedIpcMain(ipc, db);
const CHANNELS = [
  'students:list', 'students:create', 'students:update', 'students:delete',
  'students:bulk-commit', 'students:sheet-update-cell', 'students:sheet-batch-update',
  'scores:class-sheet', 'scores:save-exam-mark', 'scores:import-assessment-compilation',
  'scores:export-assessment-compilation', 'scores:save-term-summary',
  'timetable:save-entry', 'timetable:save-period',
  'canteen:class-roster-for-date', 'canteen:mark-bulk-paid',
  'exams:save-paper', 'homework:save',
];
for (const c of CHANNELS) guarded.handle(c, () => ({ ok: true, ran: true }));

const call = (channel, ...args) => ipc.handlers.get(channel)({}, ...args);
const ran = (r) => !!(r && r.ran);
const denied = (r) => !!(r && r.denied);

const as = (u) => security.setCurrentUser(u.userId, u.designation);

// ══ 1. signed out ══
security.clearCurrentUser();
ck('signed out, nothing answers', denied(call('students:list')));

// ══ 2. the fault the school reported ══
// Permissions say a Class Teacher may not create, edit or delete a pupil.
// Before the guard, every one of these ran.
as(justice);
grant(justice.userId, 'students', { view: 1 });  // narrowed: view only

ck('a class teacher cannot admit a pupil', denied(call('students:create', { surname: 'X' })));
ck('...cannot edit one', denied(call('students:update', { id: 902 })));
ck('...cannot delete one', denied(call('students:delete', 902)));
ck('...cannot bulk-import a roll', denied(call('students:bulk-commit', {})));
ck('...cannot write a cell in the Students Sheet', denied(call('students:sheet-update-cell', { id: 902, field: 'surname' })));
ck('...cannot batch-write the sheet', denied(call('students:sheet-batch-update', {})));
ck('but can still read the roll', ran(call('students:list', {})));

// ══ 3. Excel is not a way round the permission ══
// Import writes marks; export reads them. They are the same acts as the screen.
as(ama);
ck('a teacher without academics.edit cannot import a compilation sheet',
  (() => {
    db.prepare(`UPDATE user_permission_overrides SET can_edit = 0
                WHERE user_id = ? AND module = 'academics'`).run(ama.userId);
    return denied(call('scores:import-assessment-compilation', { classId: B4 }));
  })());
db.prepare(`UPDATE user_permission_overrides SET can_edit = 1
            WHERE user_id = ? AND module = 'academics'`).run(ama.userId);

// ══ 4. scope: a class of one's own, plus a subject elsewhere ══
as(justice);
ck('the class teacher reaches their own class', ran(call('scores:class-sheet', { classId: B5, subjectId: MATHS })));
ck('...and their subject in the other class', ran(call('scores:class-sheet', { classId: B6, subjectId: FRENCH })));
ck('...but NOT another subject in that class', denied(call('scores:class-sheet', { classId: B6, subjectId: MATHS })));
ck('...and not a class they have nothing to do with', denied(call('scores:class-sheet', { classId: B4, subjectId: MATHS })));
ck('...cannot save a mark outside their subject', denied(call('scores:save-exam-mark', { classId: B6, subjectId: MATHS, score: 90 })));
ck('...can save one inside it', ran(call('scores:save-exam-mark', { classId: B6, subjectId: FRENCH, score: 90 })));

// ══ 5. scope by student, not just by class ══
ck('a pupil in their own class is reachable', ran(call('students:list', {})) && scopes.canAccessStudent(db, scopes.scopeFor(db, justice.userId), 902));
ck('a pupil in an unrelated class is not',
  !scopes.canAccessStudent(db, scopes.scopeFor(db, justice.userId), 901));

// ══ 6. the specialist: one subject, every class ══
as(ama);
ck('the subject teacher reaches their subject in Basic 4', ran(call('scores:class-sheet', { classId: B4, subjectId: MATHS })));
ck('...and in Basic 6', ran(call('scores:class-sheet', { classId: B6, subjectId: MATHS })));
ck('...but not French anywhere', denied(call('scores:class-sheet', { classId: B4, subjectId: FRENCH })));

// ══ 7. the class teacher is the one who takes the canteen ══
as(justice);
ck('the class teacher takes their own class’s canteen', ran(call('canteen:class-roster-for-date', { classId: B5 })));
ck('...but not the canteen of a class they only teach a subject in',
  denied(call('canteen:class-roster-for-date', { classId: B6 })));
ck('...and cannot bulk-mark another class as paid', denied(call('canteen:mark-bulk-paid', { classId: B4 })));

// End of term is one judgement about a pupil's year — the class teacher's.
ck('end-of-term summary is the class teacher’s to save', ran(call('scores:save-term-summary', { classId: B5 })));
ck('...not a subject teacher’s in a class they visit', denied(call('scores:save-term-summary', { classId: B6 })));

// ══ 8. timetable ══
ck('a teacher cannot rebuild the period structure', denied(call('timetable:save-period', {})));
ck('...nor put an entry in another class’s timetable', denied(call('timetable:save-entry', B4, { classId: B4 })));

// ══ 9. a channel nobody listed is still governed ══
// The policy table does not name all 380 channels, and refusing everything it
// misses locked every non-admin account out of screens nobody had got round
// to listing. An unlisted channel now takes the module and action derived
// from its own name, so it is checked like any other rather than refused for
// not being written down.
guarded.handle('payroll:list-something', () => ({ ok: true, ran: true }));
guarded.handle('students:invent-a-pupil', () => ({ ok: true, ran: true }));
as(justice);
ck('an unlisted payroll channel is refused to a teacher with no payroll access',
  denied(call('payroll:list-something')));
ck('an unlisted students channel with an unrecognised verb is treated as a change',
  denied(call('students:invent-a-pupil')));
as(admin);
ck('...and both answer the administrator',
  ran(call('payroll:list-something')) && ran(call('students:invent-a-pupil')));

// ══ 10. the people who run the school are not scoped ══
ck('the administrator reaches every class', ran(call('scores:class-sheet', { classId: B4, subjectId: FRENCH })));
ck('...and may admit a pupil', ran(call('students:create', { surname: 'NEW' })));
ck('...and may import a roll', ran(call('students:bulk-commit', {})));

// A Head Teacher has to be able to check anybody's marks; a head who could see
// only their own class could not do most of the job.
const head = makeUser({ username: 'head', designation: 'Head Teacher', staffName: 'HEAD' });
as(head);
ck('a head teacher is not confined to one class',
  scopes.scopeFor(db, head.userId).unrestricted);

// ══ 11. assignment rules ══
// The IPC is registered on the real ipcMain in the app (auth channels are how
// a person signs in), so the rules are exercised through the module directly.
{
  const ipc2 = fakeIpcMain();
  require(path.join(ROOT, 'electron/ipc/auth.js'))(ipc2, db);
  const authCall = (ch, ...a) => ipc2.handlers.get(ch)({}, ...a);

  as(justice);   // a Class Teacher, not an assigner
  ck('a class teacher cannot hand themselves another class',
    !authCall('auth:add-user-assignment', { userId: justice.userId, classGroupId: B4 }).ok);

  as(head);      // Head Teacher — settings.view only, but this is their job
  const r1 = authCall('auth:add-user-assignment', { userId: ama.userId, classGroupId: B4, subjectId: MATHS });
  ck('a head teacher can set assignments despite having no settings.edit', r1.ok);

  // Three shapes, and the third could not be expressed at all before.
  const r2 = authCall('auth:add-user-assignment', { userId: ama.userId, subjectId: FRENCH });
  ck('a subject can be assigned across every class', r2.ok);
  ck('...and neither a class nor a subject is refused',
    !authCall('auth:add-user-assignment', { userId: ama.userId }).ok);
  ck('...and a class teacher of no class in particular is refused',
    !authCall('auth:add-user-assignment', { userId: ama.userId, subjectId: MATHS, isClassTeacher: true }).ok);

  // One class, one class teacher: "who is answerable for Basic 5" cannot have
  // two answers, because the register and the canteen hang off it.
  const clash = authCall('auth:add-user-assignment',
    { userId: ama.userId, classGroupId: B5, isClassTeacher: true });
  ck('a second class teacher for the same class is refused', !clash.ok);
  ck('...and the refusal names who already holds it', /JUSTICE/i.test(clash.error || ''));

  // Adding the same row twice should not double it.
  const again = authCall('auth:add-user-assignment', { userId: ama.userId, classGroupId: B4, subjectId: MATHS });
  ck('adding the same assignment twice is a no-op', again.ok && again.existing);

  const listed = authCall('auth:class-teachers');
  ck('every class is listed with whoever is answerable for it',
    Array.isArray(listed) && listed.some(c => c.class_id === B5 && /JUSTICE/i.test(c.surname || '')));
  ck('...and a class with nobody shows as unstaffed',
    listed.some(c => c.class_id === B4 && !c.staff_id));
}

// ══ 12. the administrator is not restricted anywhere ══
// The rule the school stated outright. Nothing below — a missing table entry,
// an unknown channel, an account whose designation row went missing in an old
// restore — may hold an administrator back.
{
  as(admin);
  guarded.handle('anything:at-all', () => ({ ok: true, ran: true }));
  ck('an administrator passes a channel with no rule and no known module',
    ran(call('anything:at-all')));
  ck('...reaches every class', ran(call('scores:class-sheet', { classId: B4, subjectId: FRENCH })));
  ck('...takes any class’s canteen', ran(call('canteen:class-roster-for-date', { classId: B6 })));
  ck('...and rebuilds the period structure', ran(call('timetable:save-period', {})));

  // An administrator whose designation_id never got set — an old restore, or a
  // bootstrap that ran before the designations existed — still has to be able
  // to run the school. The session they signed in with says who they are.
  const orphan = makeUser({ username: 'orphan', designation: 'Administrator', staffName: 'ORPHAN' });
  db.prepare('UPDATE users SET designation_id = NULL WHERE id = ?').run(orphan.userId);
  as(orphan);
  ck('an administrator with no designation row on file is still not locked out',
    ran(call('students:create', { surname: 'X' })));
}

// ══ 13. every channel the app registers resolves to something sensible ══
// The regression this exists to stop: the first version of the policy refused
// any channel it did not name, and the table named 98 of 381. Every non-admin
// account broke on the other 283. A rule derived from the channel's own name
// now covers them, and this checks the derivation over the REAL channel list
// rather than a sample, so a future rename cannot quietly reopen the hole.
{
  const { execSync } = require('child_process');
  const { POLICY, ALWAYS_ALLOWED, fallbackRule } = require(path.join(ROOT, 'electron/ipc/_policy.js'));
  const channels = execSync(
    `grep -rhno "ipcMain.handle('[^']*'" ${path.join(ROOT, 'electron/ipc')}/*.js | sed "s/.*handle('//; s/'$//"`,
    { shell: '/bin/bash' }
  ).toString().trim().split('\n').filter(Boolean);

  ck('the channel list was actually found', channels.length > 300);

  const unresolved = channels.filter(c =>
    !POLICY[c] && !ALWAYS_ALLOWED.has(c) && !fallbackRule(c) && !c.startsWith('auth:'));
  ck('every channel resolves to a module, or is auth (which guards itself)',
    unresolved.length === 0);

  // A channel that only reads but is named after what it produces would ask
  // for edit and lock out a legitimate viewer. These are named in POLICY; the
  // check is that none has been missed.
  const readShaped = /(^|-)(list|get|export|print|preview|summary|report|sheet|stats|status|dashboard|history|detail|search|find)(-|$)/;
  const misread = channels.filter(c => {
    if (POLICY[c] || ALWAYS_ALLOWED.has(c)) return false;
    const r = fallbackRule(c);
    return r && r[1] !== 'view' && readShaped.test(c.split(':')[1] || '');
  });
  ck('no read-only channel is derived as a change', misread.length === 0);

  // And the reverse, which is the one that matters for safety: nothing that
  // plainly writes may come out as a view. Applied to DERIVED rules only —
  // a POLICY entry is a reviewed decision, and some of them read despite the
  // name (workbook:import-history lists past imports, it does not run one).
  const writeShaped = /^(create|add|save|update|delete|remove|import|mark|record|void|reverse|reset|revoke)/;
  const misWritten = channels.filter(c => {
    if (POLICY[c] || ALWAYS_ALLOWED.has(c) || c.startsWith('auth:')) return false;
    const r = fallbackRule(c);
    return r && r[1] === 'view' && writeShaped.test(c.split(':')[1] || '');
  });
  ck('nothing that plainly writes is derived as a read', misWritten.length === 0);
}

// ══ 14. the class list survives the app's own start-up order ══
// The regression the school hit: the app reads the class list ONCE at
// start-up, before the login screen, and caches it for the session. Filtering
// it by the signed-in user meant returning nothing to a caller who had not
// signed in yet — so every class dropdown in the product came up empty, for
// everybody, administrators included.
{
  const ipc3 = fakeIpcMain();
  const guarded3 = guardedIpcMain(ipc3, db);
  require(path.join(ROOT, 'electron/ipc/settings.js'))(guarded3, db, () => '');
  const listClasses = () => ipc3.handlers.get('settings:list-classes')({});

  security.clearCurrentUser();
  const atStartup = listClasses();
  ck('the class list is served before anybody signs in',
    Array.isArray(atStartup) && atStartup.length > 0);

  as(admin);
  const forAdmin = listClasses();
  ck('an administrator sees every class', forAdmin.length === atStartup.length);

  as(head);
  ck('a head teacher sees every class', listClasses().length === atStartup.length);

  as(justice);
  const forTeacher = listClasses();
  ck('a class teacher sees only their own classes',
    forTeacher.length > 0 && forTeacher.length < atStartup.length);
  ck('...and their own class is among them',
    forTeacher.some(c => Number(c.id) === B5));
  ck('...and a class they have nothing to do with is not',
    !forTeacher.some(c => Number(c.id) === B4));
}

// ══ 15. denials are recorded ══
const denials = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'permission_denied'").get().c;
ck('every refusal is written to the audit log', denials > 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
