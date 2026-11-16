// Nickland Edusoft — which tables cross between machines, named once.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A school now exists in up to three places at once: its own Postgres schema in
// the cloud, the SQLite file on the office PC, and whatever the LAN host is
// serving. A row written in one of them has to be recognisable in the others,
// and an integer `id` from `AUTOINCREMENT` cannot do that — two databases
// independently hand out `id = 41` to different pupils on the same morning.
//
// So every table listed here gets `record_uid`: a UUIDv7, allocated once by
// whichever machine first created the row, and never changed afterwards. The
// integer primary key stays exactly where it is, every foreign key keeps
// pointing at it, and not one handler is rewritten — see the migration in
// database.js.
//
// ── The rule for being on this list ─────────────────────────────────────────
//
// A table is here if its rows are created or edited in MORE THAN ONE PLACE.
// That is the whole test, and it is deliberately not "is it important": the
// audit log is important and is on the list; `api_tokens` holds credentials and
// is not, because a device token issued by the office PC means nothing on
// another machine and must never travel.
//
// The exclusions are listed below with reasons, because a table silently left
// off is a table that silently fails to sync.
//
// NOTE ON THE COUNT. An earlier estimate put this at "about thirty". That was
// wrong, and the wrong number was reached by thinking of the modules a user
// sees rather than the tables behind them: Fees alone is six. The rule is what
// matters, and by the rule it is the number below.

// Per-install infrastructure and local-only logs. NOT synced, each for a reason
// that would be a bug if it were.
const NOT_SYNCED = {
  api_tokens: 'A device credential issued by one machine. Meaningless elsewhere, and travelling would be a leak.',
  login_sessions: 'Who is sitting at THIS machine right now.',
  sync_journal: 'The journal itself. Journalling the journal does not terminate.',
  sync_cursor: 'How far this machine has got. Per machine by definition.',
  sync_device: 'This installation\'s own identity.',
  sync_context: 'Scratch space the triggers read. One row, overwritten constantly.',
  sync_outbox: 'The old projection queue, per machine.',
  sync_versions: 'Counters for that queue.',
  sync_conflicts: 'A record of what THIS database decided. Deliberately local — see ARCHITECTURE-OFFLINE.md.',
  id_leases: 'Which number blocks this machine was granted. Per machine.',
  system_log: 'This machine\'s diagnostics.',
  workbook_import_log: 'A local record of what was imported here.',
  settings: 'Synced, but keyed by `key`, which is already a stable identifier across every database. A record_uid would be a second name for the same row.',
};

// Everything else. Grouped the way a school thinks about them, so somebody
// checking whether a table is covered can find it.
const SYNCED = [
  // ── Who the school is ──
  'academic_years', 'terms', 'school_calendar',
  'class_groups', 'subjects', 'class_subjects', 'grading_bands',
  'class_score_components',

  // ── Who works here, and what they may do ──
  'users', 'designations', 'designation_permissions', 'user_permission_overrides',
  'staff', 'staff_assignments',
  'password_reset_requests',

  // ── Staff records and payroll ──
  'staff_attendance', 'staff_activities', 'staff_documents', 'staff_medical',
  'staff_performance', 'staff_salaries', 'staff_training', 'leave_requests',

  // ── Pupils ──
  'students', 'student_class_history', 'student_events', 'student_term_summary',
  'parents', 'parent_students',

  // ── Academic work ──
  'scores', 'assessment_columns', 'assessment_scores',
  'student_attendance',
  'homework', 'homework_submissions', 'lesson_notes',
  'exam_papers', 'exam_sections', 'exam_questions',
  'timetable_periods', 'timetable_entries',

  // ── Money. Every one of these is a record a duplicate or a loss is
  //    unrecoverable in, which is why the journal carries idempotency keys.
  'fee_templates', 'fee_template_items', 'fee_line_items',
  'student_bills', 'bill_line_items', 'student_discounts',
  'payments', 'receipts', 'receipt_templates', 'payment_intents',
  'income_records', 'expense_records',
  'budgets', 'budget_items',
  'canteen_payments', 'canteen_day_status',
  'books_payments', 'student_books', 'student_books_items',
  'transport_routes', 'transport_stops', 'student_transport', 'transport_payments',
  'inventory_items', 'inventory_movements',

  // ── Talking to people ──
  'announcements', 'message_threads', 'messages',
  'notification_templates', 'notification_log',

  // ── Everything else the school keeps ──
  'projects', 'welfare_records',

  // ── The trail ──
  // On the list on purpose. An action taken offline has to be answerable for
  // afterwards, and "who did this, on which machine" is the question the brief
  // asks the audit trail to answer.
  'audit_log',
];

// The money tables. A write here needs an idempotency key on the journal entry
// and is replayed through a ledger-aware applier rather than written straight
// in, because applying a payment twice is not a cosmetic bug.
const FINANCIAL = new Set([
  'payments', 'receipts', 'payment_intents',
  'student_bills', 'bill_line_items', 'fee_line_items', 'student_discounts',
  'income_records', 'expense_records',
  'canteen_payments', 'books_payments', 'transport_payments',
  'staff_salaries',
  'budgets', 'budget_items',
]);

function isSynced(table) { return SYNCED.includes(String(table)); }
function isFinancial(table) { return FINANCIAL.has(String(table)); }

module.exports = { SYNCED, NOT_SYNCED, FINANCIAL, isSynced, isFinancial };
