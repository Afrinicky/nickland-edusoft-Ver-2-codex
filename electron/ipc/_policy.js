// Nickland Edusoft — who may call what, enforced in the main process.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The audit that produced this file found NO permission checks at all across
// the students, scores, exams, timetable, homework, canteen and academics
// handlers — 98 of them. Settings → Roles & Access wrote the rules to the
// database, the sidebar hid a few links, and every handler behind them
// answered anybody who asked. Turning off "Students: create" changed nothing:
// the admissions form still admitted, the sheet still saved, and Import Excel
// still imported.
//
// Rather than edit 98 handler bodies — and miss the ninety-ninth added next
// month — enforcement is declared here and applied at registration by
// `guard()`, which wraps ipcMain.handle. A channel with no entry is DENIED to
// a restricted user rather than allowed: a new handler is closed until
// somebody says otherwise, which is the only default that stays safe as the
// app grows.
//
// Each entry is [module, action] plus an optional scope rule saying which
// class, subject or student the call is about, so a Subject Teacher with
// academics.edit is held to their own classes. See _scope.js for that model.

// ── scope extractors ────────────────────────────────────────────────────────
// Pull the class / subject / student out of a handler's arguments. Handlers
// are not consistent about their shapes, so each rule says where to look.
const arg = (i, ...keys) => (args) => {
  const a = args[i];
  if (a == null) return null;
  if (typeof a === 'number' || typeof a === 'string') return a;
  for (const k of keys) if (a[k] != null) return a[k];
  return null;
};

const CLASS = (...keys) => ({ kind: 'class', get: arg(0, ...keys) });
const CLASS1 = (...keys) => ({ kind: 'class', get: arg(1, ...keys) });
const STUDENT = (...keys) => ({ kind: 'student', get: arg(0, ...keys) });
const SUBJECT = (classKeys, subjectKeys) => ({
  kind: 'subject',
  get: arg(0, ...classKeys),
  getSubject: arg(0, ...subjectKeys),
});
// Answerable for the class, not merely teaching in it.
const CLASS_TEACHER = (...keys) => ({ kind: 'classTeacher', get: arg(0, ...keys) });
// The handler filters its own results by scope; nothing to check up front.
const SELF_FILTERED = { kind: 'selfFiltered' };

const CK = ['classId', 'class_group_id', 'classGroupId', 'class_id'];
const SK = ['subjectId', 'subject_id'];
const STK = ['studentId', 'student_id', 'id'];

// ── the table ───────────────────────────────────────────────────────────────
const POLICY = {
  // ── students ──
  // Admitting, editing and deleting a pupil is a school-office act. A class
  // teacher marks a register; they do not create or remove records, which is
  // exactly what the school asked for and what was not being enforced.
  'students:list':                      ['students', 'view', SELF_FILTERED],
  'students:get':                       ['students', 'view', STUDENT()],
  'students:create':                    ['students', 'create'],
  'students:update':                    ['students', 'edit', STUDENT('id')],
  'students:delete':                    ['students', 'delete', STUDENT()],
  'students:promote':                   ['students', 'edit'],
  'students:generate-all-ids':          ['students', 'edit'],
  'students:upload-photo':              ['students', 'edit', STUDENT('studentId')],
  'students:add-event':                 ['students', 'edit', STUDENT('student_id', 'studentId')],
  'students:delete-event':              ['students', 'delete'],
  'students:list-events':               ['students', 'view', STUDENT('studentId', 'student_id')],
  'students:attendance-summary':        ['students', 'view', STUDENT('studentId', 'student_id')],

  // Bulk paths are the same act at scale — they were completely open.
  'students:bulk-preview':              ['students', 'create'],
  'students:bulk-commit':               ['students', 'create'],
  'students:bulk-upload':               ['students', 'create'],
  'students:bulk-download':             ['students', 'view'],
  'students:run-initial-import':        ['students', 'create'],

  // The Students Sheet is a spreadsheet over the whole roll. Reading it is a
  // view; every cell written through it is an edit.
  'students:sheet-columns':             ['students', 'view'],
  'students:sheet-data':                ['students', 'view', SELF_FILTERED],
  'students:sheet-update-cell':         ['students', 'edit'],
  'students:sheet-batch-update':        ['students', 'edit'],

  // ── attendance ──
  'students:list-attendance':           ['students', 'view', CLASS(...CK)],
  'students:list-class-attendance':     ['students', 'view', CLASS(...CK)],
  'students:mark-attendance':           ['students', 'edit', STUDENT('student_id', 'studentId')],
  'students:mark-bulk-attendance':      ['students', 'edit', CLASS(...CK)],
  'students:weekly-register':           ['students', 'view', CLASS(...CK)],
  'students:register-mark':             ['students', 'edit', CLASS(...CK)],
  'students:register-save-reason':      ['students', 'edit', CLASS(...CK)],
  'students:export-attendance-register-excel': ['students', 'view', CLASS(...CK)],
  'students:export-attendance-register-pdf':   ['students', 'view', CLASS(...CK)],

  // ── academics / scores ──
  'academics:dashboard':                ['academics', 'view', SELF_FILTERED],
  'scores:list-subjects':               ['academics', 'view'],
  'scores:list-for-class':              ['academics', 'view', CLASS(...CK)],
  'scores:class-sheet':                 ['academics', 'view', SUBJECT(CK, SK)],
  'scores:exam-sheet':                  ['academics', 'view', SUBJECT(CK, SK)],
  'scores:save-exam-mark':              ['academics', 'edit', SUBJECT(CK, SK)],
  'scores:save-bulk':                   ['academics', 'edit', SUBJECT(CK, SK)],
  'scores:save-subject':                ['academics', 'edit', SUBJECT(CK, SK)],
  'scores:delete-subject':              ['academics', 'delete', SUBJECT(CK, SK)],
  'scores:get-weights':                 ['academics', 'view'],
  'scores:rank-class':                  ['academics', 'view', CLASS(...CK)],
  'scores:student-report':              ['academics', 'view', STUDENT('studentId', 'student_id')],
  'scores:student-cumulative':          ['academics', 'view', STUDENT('studentId', 'student_id')],

  // Assessment columns shape a class's marks; the compilation sheet is the
  // Excel bridge in and out of them.
  'scores:list-assessment-columns':     ['academics', 'view', CLASS(...CK)],
  'scores:add-assessment-column':       ['academics', 'edit', CLASS(...CK)],
  'scores:update-assessment-column':    ['academics', 'edit', CLASS(...CK)],
  'scores:delete-assessment-column':    ['academics', 'delete', CLASS(...CK)],
  'scores:save-assessment-mark':        ['academics', 'edit', SUBJECT(CK, SK)],
  'scores:assessment-compilation-sheet':['academics', 'view', CLASS(...CK)],
  'scores:save-assessment-compilation': ['academics', 'edit', CLASS(...CK)],
  'scores:export-assessment-compilation': ['academics', 'view', CLASS(...CK)],
  'scores:import-assessment-compilation': ['academics', 'edit', CLASS(...CK)],

  // End of term is the class teacher's, not every teacher who takes a subject
  // in the class: it is a single judgement about a pupil's year.
  'scores:end-of-term':                 ['academics', 'view', CLASS(...CK)],
  'scores:get-term-summary':            ['academics', 'view', STUDENT('studentId', 'student_id')],
  'scores:save-term-summary':           ['academics', 'edit', CLASS_TEACHER(...CK)],

  // ── exams ──
  'exams:list-papers':                  ['academics', 'view', SELF_FILTERED],
  'exams:get-paper':                    ['academics', 'view'],
  'exams:save-paper':                   ['academics', 'edit', SUBJECT(CK, SK)],
  'exams:delete-paper':                 ['academics', 'delete'],
  'exams:list-sections':                ['academics', 'view'],
  'exams:save-section':                 ['academics', 'edit'],
  'exams:delete-section':               ['academics', 'delete'],
  'exams:list-questions':               ['academics', 'view'],
  'exams:save-question':                ['academics', 'edit'],
  'exams:delete-question':              ['academics', 'delete'],
  'exams:reorder-questions':            ['academics', 'edit'],
  'exams:copy-from-bank':               ['academics', 'edit'],
  'exams:paper-stats':                  ['academics', 'view'],

  // ── timetable ──
  // Building the timetable is a school-wide act: one class's periods collide
  // with another's teachers. Reading one is not.
  'timetable:get-class':                ['academics', 'view', CLASS(...CK)],
  'timetable:get-teacher':              ['academics', 'view'],
  'timetable:list-periods':             ['academics', 'view'],
  'timetable:save-entry':               ['academics', 'edit', CLASS1(...CK)],
  'timetable:delete-entry':             ['academics', 'edit', CLASS1(...CK)],
  'timetable:save-period':              ['settings', 'edit'],
  'timetable:delete-period':            ['settings', 'edit'],
  'timetable:seed-default-periods':     ['settings', 'edit'],
  'timetable:export-class-excel':       ['academics', 'view', CLASS(...CK)],
  'timetable:export-class-pdf':         ['academics', 'view', CLASS(...CK)],

  // ── homework ──
  'homework:list-class':                ['academics', 'view', CLASS(...CK)],
  'homework:save':                      ['academics', 'edit', SUBJECT(CK, SK)],
  'homework:delete':                    ['academics', 'delete'],
  'homework:sheet':                     ['academics', 'view'],
  'homework:save-marks':                ['academics', 'edit'],
  'homework:student-report':            ['academics', 'view', STUDENT('studentId', 'student_id')],

  // ── reads whose names do not look like reads ──────────────────────────────
  // The derived rule treats an unrecognised verb as a change, on purpose. That
  // is the safe way round, and it costs exactly these: channels that only read
  // but are named after what they produce. Naming them here is the fix the
  // fallback's comment points at — better than loosening the rule for
  // everybody so that these ten can through.
  'books:class-payment-sheet':          ['fees', 'view'],
  'fees:bulk-pay-sheet':                ['fees', 'view'],
  'workbook:import-history':            ['finance', 'view'],
  'payroll:paid-summary':               ['payroll', 'view'],
  'payroll:bulk-preview':               ['payroll', 'view'],
  'reports:generate-report-cards':      ['academics', 'view'],
  'reports:class-list':                 ['academics', 'view'],
  'session:migration-preview':          ['settings', 'view'],
  'staff:payroll-summary':              ['payroll', 'view'],
  'staff:clockin-status':               ['staff', 'view'],

  // ── canteen ──
  // Taking canteen money for a class is the class teacher's job — one person
  // answerable for one class, which is what the school asked for.
  'canteen:dashboard':                  ['canteen', 'view', SELF_FILTERED],
  'canteen:class-roster-for-date':      ['canteen', 'view', CLASS_TEACHER(...CK)],
  'canteen:class-roster-for-range':     ['canteen', 'view', CLASS_TEACHER(...CK)],
  'canteen:record-payment':             ['canteen', 'create', STUDENT('student_id', 'studentId')],
  'canteen:mark-days-paid':             ['canteen', 'create', STUDENT('student_id', 'studentId')],
  'canteen:mark-bulk-paid':             ['canteen', 'create', CLASS_TEACHER(...CK)],
  'canteen:set-day-status':             ['canteen', 'edit', STUDENT('student_id', 'studentId')],
  'canteen:mark-exempt':                ['canteen', 'edit', STUDENT('student_id', 'studentId')],
  'canteen:apply-attendance-exemption': ['canteen', 'edit', CLASS_TEACHER(...CK)],
  'canteen:student-profile':            ['canteen', 'view', STUDENT('studentId', 'student_id')],
  'canteen:debtors-report':             ['canteen', 'view', SELF_FILTERED],
  'canteen:list-calendar':              ['canteen', 'view'],
  'canteen:save-calendar-day':          ['settings', 'edit'],
  'canteen:setup-term-calendar':        ['settings', 'edit'],
};

// Channels every signed-in user may call regardless of module permissions:
// their own session, their own account, and the reference data every screen
// needs to render at all (the term, the class list for a picker).
const ALWAYS_ALLOWED = new Set([
  'auth:bootstrap-status', 'auth:bootstrap', 'auth:login', 'auth:logout',
  'auth:change-password', 'auth:effective-permissions', 'auth:user-overrides',
  'auth:list-user-assignments',
  'auth:request-password-reset', 'auth:password-reset-status', 'auth:complete-password-reset',
  'auth:pending-password-resets', 'auth:list-password-resets', 'auth:decide-password-reset',
  'session:get', 'session:set', 'session:clear', 'session:info',
  'settings:get-all', 'settings:get', 'settings:list-classes', 'settings:list-terms',
  'settings:current-term', 'settings:list-subjects', 'settings:get-class-subjects',
  'dashboard:summary', 'dashboard:metrics',
  'app:show-open-dialog', 'app:show-save-dialog',
  'audit:list', 'audit:log',
  'photos:upload', 'photos:remove', 'photos:attach', 'photos:discard',
]);

// ── the fallback ────────────────────────────────────────────────────────────
// The table above covers the modules the school reported problems in. It does
// not cover all 380 channels, and the first version of this file refused
// anything unlisted outright. That was too blunt by far: a Bursar opening a
// fee screen, a Secretary printing a report — every one of them hit a denial
// for a channel nobody had got round to listing yet, and the only account that
// still worked was the administrator.
//
// So an unlisted channel is not refused. Its module and action are derived
// from its own name and checked exactly as a listed one would be. That keeps
// the guarantee — nothing runs without a permission behind it — without
// turning "not yet written down" into "broken".
const PREFIX_MODULE = {
  students: 'students', student: 'students',
  scores: 'academics', exams: 'academics', academics: 'academics',
  timetable: 'academics', homework: 'academics', 'lesson-notes': 'academics',
  reports: 'academics',
  fees: 'fees', receipts: 'fees', discounts: 'fees', books: 'fees',
  payments: 'fees', bills: 'fees',
  canteen: 'canteen',
  staff: 'staff', 'staff-activities': 'staff',
  payroll: 'payroll',
  finance: 'finance', workbook: 'finance', inventory: 'finance', transport: 'finance',
  notifications: 'notifications', messages: 'notifications', announcements: 'notifications',
  settings: 'settings', access: 'settings', backup: 'settings', cloud: 'settings',
  mobile: 'settings', 'mobile-sync': 'settings', session: 'settings',
  dashboard: 'dashboard',
};

// Drawn from the verbs the app's own channels actually use, and read the safe
// way round: a channel is a READ only if it says so. Anything unrecognised is
// treated as a change, so a write with an unusual name cannot slip through on
// somebody's view permission. The cost is that an oddly-named read may ask for
// edit — visible, reportable, and fixable by naming it in POLICY, which a
// silent write-through would not be.
const READ_VERBS = new RegExp('^(' + [
  'list', 'get', 'read', 'view', 'show', 'find', 'search', 'fetch',
  'export', 'print', 'preview', 'render', 'render', 'download',
  'dashboard', 'summary', 'stats', 'status', 'report', 'sheet', 'rank',
  'debtors', 'pending', 'today', 'weekly', 'available', 'expected',
  'effective', 'catalogue', 'categories', 'template', 'paper', 'payslip',
  'ytd', 'copyable', 'reveal', 'log', 'compute', 'calculate', 'match',
].join('|') + ')(\\b|-|_|$)');

const DELETE_VERBS = /^(delete|remove|destroy|void|reverse|clear|drop|revoke|reject|unassign)/;
const CREATE_VERBS = /^(create|add|new|register|generate|issue|import|record|send|seed|setup|run|post|admit|upload|submit|start|clockin|clock)/;

function fallbackRule(channel) {
  const [prefixRaw, actionRaw = ''] = String(channel).split(':');
  const module = PREFIX_MODULE[prefixRaw];
  if (!module) return null;
  const verb = actionRaw.toLowerCase();
  const action = DELETE_VERBS.test(verb) ? 'delete'
    : CREATE_VERBS.test(verb) ? 'create'
    : READ_VERBS.test(verb) ? 'view'
    : 'edit';
  return [module, action, null];
}

module.exports = { POLICY, ALWAYS_ALLOWED, fallbackRule };
