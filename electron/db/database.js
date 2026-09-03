// Nickland Edusoft — Database Layer
// Copyright © 2026 Nickland Sales. All rights reserved.
// better-sqlite3 is a native module, loaded lazily so that SCHEMA and
// runMigrations can be imported (by the sync test suites, for instance)
// without needing a compiled binary for the current runtime.
const path = require('path');
const fs = require('fs');

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ─────────────────────────────────────────────────────────
-- AUTHENTICATION & RBAC
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS designations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS designation_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  designation_id INTEGER NOT NULL,
  module TEXT NOT NULL,
  can_view INTEGER DEFAULT 0,
  can_create INTEGER DEFAULT 0,
  can_edit INTEGER DEFAULT 0,
  can_delete INTEGER DEFAULT 0,
  UNIQUE (designation_id, module),
  FOREIGN KEY (designation_id) REFERENCES designations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  full_name TEXT NOT NULL,
  designation_id INTEGER,
  staff_id INTEGER,
  is_active INTEGER DEFAULT 1,
  must_change_password INTEGER DEFAULT 0,
  last_login TEXT,
  photo_path TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (designation_id) REFERENCES designations(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);

CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  module TEXT NOT NULL,
  can_view INTEGER DEFAULT 0,
  can_create INTEGER DEFAULT 0,
  can_edit INTEGER DEFAULT 0,
  can_delete INTEGER DEFAULT 0,
  granted_by INTEGER,
  granted_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, module),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS login_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  logged_in_at TEXT DEFAULT CURRENT_TIMESTAMP,
  logged_out_at TEXT,
  ip_address TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- A member of staff who has forgotten their password cannot be handed a new one
-- over email — a school desktop has no mail server, and the phone app talks to
-- a read model. So the request is recorded here and an Administrator or
-- Proprietor approves it in person. Approval mints a single-use claim that the
-- account itself redeems by choosing a new password; the approver never sees
-- and never sets it, so a reset cannot become a quiet account takeover.
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | denied | used | cancelled
  reason TEXT,
  requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
  requested_from TEXT,                      -- 'desktop' | 'mobile' | 'web'
  decided_by INTEGER,
  decided_at TEXT,
  decision_note TEXT,
  claim_hash TEXT,                          -- sha256 of the single-use claim code
  claim_expires_at TEXT,
  used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (decided_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_pwreset_user   ON password_reset_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_pwreset_status ON password_reset_requests(status);

-- ─────────────────────────────────────────────────────────
-- ACADEMIC STRUCTURE
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academic_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL UNIQUE,
  start_date TEXT,
  end_date TEXT,
  is_current INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academic_year_id INTEGER NOT NULL,
  term_number INTEGER NOT NULL,
  label TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  is_current INTEGER DEFAULT 0,
  FOREIGN KEY (academic_year_id) REFERENCES academic_years(id)
);

CREATE TABLE IF NOT EXISTS class_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  short_code TEXT,
  level_category TEXT NOT NULL,
  level_order INTEGER NOT NULL,
  section TEXT,
  parent_class_id INTEGER,
  capacity INTEGER,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (parent_class_id) REFERENCES class_groups(id)
);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  class_weight_pct REAL DEFAULT 40,
  exam_weight_pct REAL DEFAULT 60,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS class_subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_group_id INTEGER NOT NULL,
  subject_id INTEGER NOT NULL,
  UNIQUE (class_group_id, subject_id),
  FOREIGN KEY (class_group_id) REFERENCES class_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────
-- STUDENTS
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  index_number TEXT UNIQUE,
  admission_year INTEGER,
  roll_number INTEGER UNIQUE,
  surname TEXT,
  first_name TEXT,
  other_names TEXT,
  gender TEXT,
  denomination TEXT,
  age INTEGER,
  date_of_birth TEXT,
  place_of_birth TEXT,
  place_of_residence TEXT,
  street_address TEXT,
  house_number TEXT,
  digital_address TEXT,
  nhis_number TEXT,
  father_name TEXT,
  father_contact TEXT,
  mother_name TEXT,
  mother_contact TEXT,
  guardian_name TEXT,
  guardian_contact TEXT,
  current_class_id INTEGER,
  status TEXT DEFAULT 'Active',
  inactive_reason TEXT,
  photo_path TEXT,
  admission_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (current_class_id) REFERENCES class_groups(id)
);

CREATE TABLE IF NOT EXISTS student_class_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  class_group_id INTEGER NOT NULL,
  academic_year_id INTEGER NOT NULL,
  enrolled_date TEXT,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (class_group_id) REFERENCES class_groups(id),
  FOREIGN KEY (academic_year_id) REFERENCES academic_years(id)
);

CREATE TABLE IF NOT EXISTS student_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'present',
  marked_by INTEGER,
  term_id INTEGER,
  notes TEXT,
  UNIQUE (student_id, date),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (marked_by) REFERENCES users(id),
  FOREIGN KEY (term_id) REFERENCES terms(id)
);

CREATE TABLE IF NOT EXISTS student_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  date TEXT,
  recorded_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (recorded_by) REFERENCES users(id)
);

-- ─────────────────────────────────────────────────────────
-- STAFF
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_number TEXT UNIQUE,
  surname TEXT,
  first_name TEXT,
  other_names TEXT,
  gender TEXT,
  date_of_birth TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  role TEXT NOT NULL,
  designation_id INTEGER,
  status TEXT DEFAULT 'Active',
  qualification TEXT,
  specialization TEXT,
  bank_account TEXT,
  bank_name TEXT,
  ssnit_number TEXT,
  ssnit_enrolled INTEGER DEFAULT 0,
  hire_date TEXT,
  stop_date TEXT,
  photo_path TEXT,
  base_salary REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (designation_id) REFERENCES designations(id)
);

CREATE TABLE IF NOT EXISTS staff_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  class_group_id INTEGER,
  subject_id INTEGER,
  term_id INTEGER,
  is_class_teacher INTEGER DEFAULT 0,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  FOREIGN KEY (class_group_id) REFERENCES class_groups(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (term_id) REFERENCES terms(id)
);

CREATE TABLE IF NOT EXISTS staff_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  doc_type TEXT NOT NULL,
  title TEXT NOT NULL,
  file_path TEXT,
  issue_date TEXT,
  expiry_date TEXT,
  notes TEXT,
  uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS staff_medical (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  blood_group TEXT,
  known_conditions TEXT,
  allergies TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  emergency_contact_relation TEXT,
  nhis_number TEXT,
  notes TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS staff_training (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  provider TEXT,
  start_date TEXT,
  end_date TEXT,
  certificate_path TEXT,
  notes TEXT,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS staff_performance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  review_period TEXT NOT NULL,
  reviewer_id INTEGER,
  overall_rating INTEGER,
  teaching_quality INTEGER,
  punctuality INTEGER,
  professionalism INTEGER,
  comments TEXT,
  reviewed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES users(id)
);

-- Lesson notes: structured Ghanaian-style lesson plans
CREATE TABLE IF NOT EXISTS lesson_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  class_group_id INTEGER,
  subject_id INTEGER,
  term_id INTEGER,
  week_number INTEGER,
  lesson_date TEXT,
  duration_minutes INTEGER,
  topic TEXT NOT NULL,
  sub_topic TEXT,
  references_text TEXT,
  tlms TEXT,
  objectives TEXT,
  rpk TEXT,
  introduction TEXT,
  presentation TEXT,
  activity TEXT,
  evaluation TEXT,
  closure TEXT,
  assignment TEXT,
  remarks TEXT,
  status TEXT DEFAULT 'draft',
  reviewed_by INTEGER,
  reviewed_at TEXT,
  review_comments TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  FOREIGN KEY (class_group_id) REFERENCES class_groups(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (term_id) REFERENCES terms(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

-- Staff activities log: non-teaching duties, meetings, supervision, professional development
CREATE TABLE IF NOT EXISTS staff_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  activity_date TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER,
  location TEXT,
  related_class_id INTEGER,
  hours_contributed REAL,
  acknowledged_by INTEGER,
  acknowledged_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  FOREIGN KEY (related_class_id) REFERENCES class_groups(id),
  FOREIGN KEY (acknowledged_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS staff_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  clock_in TEXT,
  clock_out TEXT,
  status TEXT DEFAULT 'present',
  notes TEXT,
  UNIQUE (staff_id, date),
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  leave_type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days_requested INTEGER NOT NULL,
  justification TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  reviewed_by INTEGER,
  reviewed_at TEXT,
  reviewer_notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

-- ─────────────────────────────────────────────────────────
-- PAYROLL
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_salaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  gross_salary REAL DEFAULT 0,
  extra_pay REAL DEFAULT 0,
  extra_pay_description TEXT,
  arrear_brought_forward REAL DEFAULT 0,
  ssnit_worker REAL DEFAULT 0,
  ssnit_employer REAL DEFAULT 0,
  paye_tax REAL DEFAULT 0,
  other_deductions REAL DEFAULT 0,
  other_deductions_description TEXT,
  net_salary REAL DEFAULT 0,
  actual_amount_paid REAL DEFAULT 0,
  carry_over_to_next REAL DEFAULT 0,
  payment_date TEXT,
  payment_method TEXT,
  payment_reference TEXT,
  is_paid INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (staff_id, month, year),
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────
-- ACADEMICS — SCORES & REPORTS
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  term_id INTEGER NOT NULL,
  subject_id INTEGER NOT NULL,
  class_score REAL DEFAULT 0,
  exam_score REAL DEFAULT 0,
  total_score REAL DEFAULT 0,
  grade_remark TEXT,
  UNIQUE (student_id, term_id, subject_id),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (term_id) REFERENCES terms(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id)
);

CREATE TABLE IF NOT EXISTS class_score_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_group_id INTEGER NOT NULL,
  term_id INTEGER NOT NULL,
  component_name TEXT NOT NULL,
  max_marks REAL NOT NULL,
  display_order INTEGER DEFAULT 0,
  FOREIGN KEY (class_group_id) REFERENCES class_groups(id),
  FOREIGN KEY (term_id) REFERENCES terms(id)
);

-- WHONET-style assessment columns: per class+subject+term, configurable
-- assessment types (Assignment, Quiz, Class Test, Mid-Sem Exams) each with
-- its own max-marks. Teacher can add/remove columns.
CREATE TABLE IF NOT EXISTS assessment_columns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_group_id INTEGER NOT NULL,
  subject_id INTEGER NOT NULL,
  term_id INTEGER NOT NULL,
  assessment_type TEXT NOT NULL DEFAULT 'Assignment',
  max_marks REAL NOT NULL DEFAULT 10,
  display_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (class_group_id) REFERENCES class_groups(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (term_id) REFERENCES terms(id)
);

-- Individual marks a student got in each assessment column
CREATE TABLE IF NOT EXISTS assessment_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_column_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  marks REAL DEFAULT 0,
  UNIQUE (assessment_column_id, student_id),
  FOREIGN KEY (assessment_column_id) REFERENCES assessment_columns(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS student_term_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  term_id INTEGER NOT NULL,
  class_group_id INTEGER,
  total_score_all REAL DEFAULT 0,
  average_score REAL DEFAULT 0,
  class_rank INTEGER,
  number_on_roll INTEGER,
  conduct_traits TEXT,
  learner_interests TEXT,
  learner_talents TEXT,
  teacher_remarks TEXT,
  days_present INTEGER,
  total_days INTEGER,
  UNIQUE (student_id, term_id),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (term_id) REFERENCES terms(id),
  FOREIGN KEY (class_group_id) REFERENCES class_groups(id)
);

CREATE TABLE IF NOT EXISTS grading_bands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  min_score REAL NOT NULL,
  max_score REAL NOT NULL,
  remark TEXT NOT NULL,
  display_order INTEGER DEFAULT 0
);

-- ─────────────────────────────────────────────────────────
-- ACADEMICS — EXAMINATION / QUESTION BANK
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exam_papers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  class_group_id INTEGER,
  subject_id INTEGER,
  term_id INTEGER,
  exam_type TEXT DEFAULT 'end_of_term',
  total_marks REAL,
  duration_minutes INTEGER,
  instructions TEXT,
  status TEXT DEFAULT 'draft',
  created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (class_group_id) REFERENCES class_groups(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (term_id) REFERENCES terms(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS exam_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_paper_id INTEGER NOT NULL,
  section_label TEXT NOT NULL,
  instructions TEXT,
  marks_allocation REAL,
  display_order INTEGER DEFAULT 0,
  FOREIGN KEY (exam_paper_id) REFERENCES exam_papers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS exam_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_paper_id INTEGER,
  section_id INTEGER,
  class_group_id INTEGER,
  subject_id INTEGER,
  question_type TEXT NOT NULL DEFAULT 'essay',
  question_text TEXT NOT NULL,
  question_image_path TEXT,
  marks REAL DEFAULT 1,
  difficulty TEXT DEFAULT 'medium',
  option_a TEXT,
  option_b TEXT,
  option_c TEXT,
  option_d TEXT,
  correct_option TEXT,
  model_answer TEXT,
  display_order INTEGER DEFAULT 0,
  in_question_bank INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (exam_paper_id) REFERENCES exam_papers(id) ON DELETE SET NULL,
  FOREIGN KEY (section_id) REFERENCES exam_sections(id) ON DELETE SET NULL,
  FOREIGN KEY (class_group_id) REFERENCES class_groups(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ─────────────────────────────────────────────────────────
-- FEES / BILLS
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fee_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  class_group_id INTEGER,
  term_id INTEGER,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (class_group_id) REFERENCES class_groups(id),
  FOREIGN KEY (term_id) REFERENCES terms(id)
);

CREATE TABLE IF NOT EXISTS fee_template_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  part TEXT DEFAULT 'A',
  item_name TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  is_optional INTEGER DEFAULT 0,
  display_order INTEGER DEFAULT 0,
  FOREIGN KEY (template_id) REFERENCES fee_templates(id) ON DELETE CASCADE
);

-- Legacy table name alias for backward compatibility with existing IPC handlers
CREATE TABLE IF NOT EXISTS fee_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fee_template_id INTEGER NOT NULL,
  item_number INTEGER,
  description TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  is_optional INTEGER DEFAULT 0,
  category TEXT,
  FOREIGN KEY (fee_template_id) REFERENCES fee_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS student_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  term_id INTEGER NOT NULL,
  template_id INTEGER,
  total_billed REAL DEFAULT 0,
  total_paid REAL DEFAULT 0,
  balance REAL DEFAULT 0,
  arrears_from_prev REAL DEFAULT 0,
  books_total REAL DEFAULT 0,
  books_paid REAL DEFAULT 0,
  books_arrears REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  discount_reason TEXT,
  generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (student_id, term_id),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (term_id) REFERENCES terms(id),
  FOREIGN KEY (template_id) REFERENCES fee_templates(id)
);

-- Per-bill line items (snapshot taken at bill-generation time)
CREATE TABLE IF NOT EXISTS bill_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_bill_id INTEGER NOT NULL,
  item_number INTEGER DEFAULT 0,
  description TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  is_arrear INTEGER DEFAULT 0,
  arrear_from_term_id INTEGER,
  FOREIGN KEY (student_bill_id) REFERENCES student_bills(id) ON DELETE CASCADE,
  FOREIGN KEY (arrear_from_term_id) REFERENCES terms(id)
);

-- Books bills (academic-year-level, billed in Term 1, carried forward as arrears)
CREATE TABLE IF NOT EXISTS student_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  academic_year_id INTEGER NOT NULL,
  class_group_id INTEGER,
  total_amount REAL DEFAULT 0,
  total_paid REAL DEFAULT 0,
  balance REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (student_id, academic_year_id),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  FOREIGN KEY (class_group_id) REFERENCES class_groups(id)
);

-- Individual book items per student (e.g., "English Textbook BS4 = 35.00")
CREATE TABLE IF NOT EXISTS student_books_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_books_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  display_order INTEGER DEFAULT 0,
  FOREIGN KEY (student_books_id) REFERENCES student_books(id) ON DELETE CASCADE
);

-- Books payments (separate from fee payments)
CREATE TABLE IF NOT EXISTS books_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  student_books_id INTEGER,
  amount REAL NOT NULL,
  payment_date TEXT NOT NULL,
  payment_method TEXT DEFAULT 'Cash',
  reference TEXT,
  receipt_number TEXT UNIQUE,
  received_by INTEGER,
  notes TEXT,
  is_reversed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (student_books_id) REFERENCES student_books(id),
  FOREIGN KEY (received_by) REFERENCES users(id)
);

-- Student fee discounts (percent OR fixed amount)
CREATE TABLE IF NOT EXISTS student_discounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  discount_type TEXT NOT NULL DEFAULT 'percent',  -- 'percent' or 'fixed'
  discount_value REAL NOT NULL DEFAULT 0,         -- percent: 0-100, fixed: GHS
  reason TEXT NOT NULL,
  applies_to TEXT DEFAULT 'fees',                  -- 'fees', 'books', 'both'
  is_active INTEGER DEFAULT 1,
  effective_from TEXT,
  effective_to TEXT,
  granted_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES users(id)
);

-- Audit log for sensitive financial actions (delete, reversal, backdating, large edits)
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  user_id INTEGER,
  justification TEXT,
  before_data TEXT,
  after_data TEXT,
  severity TEXT DEFAULT 'normal',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Inventory items (auto-recorded from purchase expenses)
CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT DEFAULT 'piece',
  unit_cost REAL DEFAULT 0,
  quantity_on_hand REAL DEFAULT 0,
  reorder_level REAL DEFAULT 0,
  location TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_item_id INTEGER NOT NULL,
  movement_type TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_cost REAL DEFAULT 0,
  total_cost REAL DEFAULT 0,
  movement_date TEXT NOT NULL,
  reference TEXT,
  linked_expense_id INTEGER,
  recorded_by INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE,
  FOREIGN KEY (linked_expense_id) REFERENCES expense_records(id),
  FOREIGN KEY (recorded_by) REFERENCES users(id)
);

-- Receipt templates (user-uploaded docx files for printing)
CREATE TABLE IF NOT EXISTS receipt_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_type TEXT NOT NULL,           -- 'fees', 'books', 'canteen', 'other'
  name TEXT NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  uploaded_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  student_bill_id INTEGER,
  term_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  payment_date TEXT NOT NULL,
  payment_method TEXT DEFAULT 'Cash',
  reference TEXT,
  receipt_number TEXT UNIQUE,
  received_by INTEGER,
  notes TEXT,
  is_reversed INTEGER DEFAULT 0,
  reversed_by INTEGER,
  reversal_reason TEXT,
  reversed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (student_bill_id) REFERENCES student_bills(id),
  FOREIGN KEY (term_id) REFERENCES terms(id),
  FOREIGN KEY (received_by) REFERENCES users(id)
);

-- ─────────────────────────────────────────────────────────
-- CANTEEN
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS school_calendar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT UNIQUE NOT NULL,
  day_type TEXT NOT NULL DEFAULT 'school_day',
  label TEXT,
  term_id INTEGER,
  FOREIGN KEY (term_id) REFERENCES terms(id)
);

CREATE TABLE IF NOT EXISTS canteen_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  payment_date TEXT NOT NULL,
  amount REAL NOT NULL,
  days_covered INTEGER NOT NULL,
  start_date TEXT,
  end_date TEXT,
  received_by INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (received_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS canteen_day_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid',
  payment_id INTEGER,
  UNIQUE (student_id, date),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (payment_id) REFERENCES canteen_payments(id)
);

-- ─────────────────────────────────────────────────────────
-- FINANCE
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS income_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_number TEXT UNIQUE,
  category TEXT NOT NULL,
  subcategory TEXT,
  amount REAL NOT NULL,
  payer_name TEXT,
  description TEXT,
  payment_method TEXT DEFAULT 'Cash',
  reference TEXT,
  transaction_date TEXT NOT NULL,
  date TEXT,
  source TEXT,
  linked_payment_id INTEGER,
  linked_canteen_payment_id INTEGER,
  academic_year_id INTEGER,
  term_id INTEGER,
  recorded_by INTEGER,
  student_id INTEGER,
  staff_id INTEGER,
  is_auto INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  FOREIGN KEY (term_id) REFERENCES terms(id),
  FOREIGN KEY (recorded_by) REFERENCES users(id),
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);

CREATE TABLE IF NOT EXISTS expense_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_number TEXT UNIQUE,
  category TEXT NOT NULL,
  subcategory TEXT,
  amount REAL NOT NULL,
  payee_name TEXT,
  paid_to TEXT,
  description TEXT NOT NULL,
  payment_method TEXT DEFAULT 'Cash',
  reference TEXT,
  transaction_date TEXT NOT NULL,
  date TEXT,
  linked_salary_id INTEGER,
  academic_year_id INTEGER,
  term_id INTEGER,
  approved_by INTEGER,
  recorded_by INTEGER,
  is_auto INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  FOREIGN KEY (term_id) REFERENCES terms(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  FOREIGN KEY (recorded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  budget_type TEXT NOT NULL DEFAULT 'term',
  academic_year_id INTEGER,
  term_id INTEGER,
  period_label TEXT,
  start_date TEXT,
  end_date TEXT,
  notes TEXT,
  status TEXT DEFAULT 'draft',
  created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  FOREIGN KEY (term_id) REFERENCES terms(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS budget_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  budget_id INTEGER NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'expense',
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  projected_amount REAL DEFAULT 0,
  actual_amount REAL DEFAULT 0,
  notes TEXT,
  display_order INTEGER DEFAULT 0,
  FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS welfare_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  beneficiary_type TEXT NOT NULL,
  beneficiary_name TEXT,
  student_id INTEGER,
  staff_id INTEGER,
  welfare_type TEXT NOT NULL,
  amount REAL DEFAULT 0,
  description TEXT,
  approved_by INTEGER,
  approved_date TEXT,
  term_id INTEGER,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  FOREIGN KEY (term_id) REFERENCES terms(id)
);

-- ─────────────────────────────────────────────────────────
-- NOTIFICATIONS
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  recipient_type TEXT,
  recipient_role TEXT,
  recipient_id INTEGER,
  recipient_name TEXT,
  recipient_contact TEXT,
  message_body TEXT,
  attachment_paths TEXT,
  sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
  delivery_status TEXT DEFAULT 'pending',
  api_response TEXT,
  template_used TEXT,
  cost REAL,
  units_used INTEGER,
  sent_by INTEGER,
  FOREIGN KEY (sent_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS notification_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT,
  is_active INTEGER DEFAULT 1
);

-- ─────────────────────────────────────────────────────────
-- SYSTEM
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  category TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT,
  record_id INTEGER,
  action TEXT,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT,
  changed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  start_date TEXT,
  target_end_date TEXT,
  actual_end_date TEXT,
  budget REAL DEFAULT 0,
  spent REAL DEFAULT 0,
  status TEXT DEFAULT 'Planning',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_students_class ON students(current_class_id);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_scores_student_term ON scores(student_id, term_id);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_canteen_day_status ON canteen_day_status(student_id, date);
CREATE INDEX IF NOT EXISTS idx_school_calendar_date ON school_calendar(date);
CREATE INDEX IF NOT EXISTS idx_bills_student_term ON student_bills(student_id, term_id);
CREATE INDEX IF NOT EXISTS idx_income_term ON income_records(term_id);
CREATE INDEX IF NOT EXISTS idx_expense_term ON expense_records(term_id);
CREATE INDEX IF NOT EXISTS idx_student_attendance ON student_attendance(student_id, date);
CREATE INDEX IF NOT EXISTS idx_staff_attendance ON staff_attendance(staff_id, date);
CREATE INDEX IF NOT EXISTS idx_leave_staff ON leave_requests(staff_id, status);
`;

function seedDefaults(db) {
  // ── Designations ──────────────────────────────────────
  const desigCount = db.prepare('SELECT COUNT(*) AS c FROM designations').get().c;
  if (desigCount === 0) {
    const ins = db.prepare('INSERT INTO designations (name, description, is_system) VALUES (?, ?, ?)');
    const desigs = [
      ['Proprietor', 'Overall owner/director of the school. Full access to all modules.', 1],
      ['Administrator', 'System administrator. Manages users, settings, and all modules.', 1],
      ['Head Teacher', 'Academic and administrative head. Full access except user management.', 1],
      ['Class Teacher', 'Assigned to a specific class. Access to Academics and Canteen.', 1],
      ['Subject Teacher', 'Teaches specific subjects. Access to Academics and Canteen.', 1],
      ['Accountant', 'Manages financial records. Access to Finance, Fees, and Payroll.', 1],
      ['Secretary', 'Administrative support. Access to Students, Notifications, and Reports.', 1],
      ['Cook', 'Canteen staff. Access to Canteen only.', 1],
      ['Security', 'Security staff. Access to Staff attendance clock-in only.', 1],
      ['Cleaner', 'Support staff. Minimal access.', 1],
    ];
    const modules = [
      'dashboard','students','academics','fees','canteen',
      'staff','payroll','finance','notifications','settings'
    ];
    const permMap = {
      'Proprietor':    { dashboard:3, students:3, academics:3, fees:3, canteen:3, staff:3, payroll:3, finance:3, notifications:3, settings:3 },
      'Administrator': { dashboard:3, students:3, academics:3, fees:3, canteen:3, staff:3, payroll:3, finance:3, notifications:3, settings:3 },
      'Head Teacher':  { dashboard:3, students:3, academics:3, fees:3, canteen:3, staff:3, payroll:1, finance:1, notifications:3, settings:1 },
      'Class Teacher': { dashboard:1, students:1, academics:3, fees:0, canteen:3, staff:0, payroll:0, finance:0, notifications:1, settings:0 },
      'Subject Teacher':{ dashboard:1, students:1, academics:3, fees:0, canteen:3, staff:0, payroll:0, finance:0, notifications:1, settings:0 },
      'Accountant':    { dashboard:1, students:1, academics:0, fees:3, canteen:1, staff:1, payroll:3, finance:3, notifications:1, settings:0 },
      'Secretary':     { dashboard:1, students:3, academics:1, fees:1, canteen:0, staff:1, payroll:0, finance:0, notifications:3, settings:0 },
      'Cook':          { dashboard:0, students:0, academics:0, fees:0, canteen:3, staff:0, payroll:0, finance:0, notifications:0, settings:0 },
      'Security':      { dashboard:0, students:0, academics:0, fees:0, canteen:0, staff:0, payroll:0, finance:0, notifications:0, settings:0 },
      'Cleaner':       { dashboard:0, students:0, academics:0, fees:0, canteen:0, staff:0, payroll:0, finance:0, notifications:0, settings:0 },
    };
    const insPerm = db.prepare('INSERT OR IGNORE INTO designation_permissions (designation_id, module, can_view, can_create, can_edit, can_delete) VALUES (?, ?, ?, ?, ?, ?)');
    for (const [name, desc, sys] of desigs) {
      ins.run(name, desc, sys);
      const did = db.prepare('SELECT id FROM designations WHERE name = ?').get(name).id;
      const lvls = permMap[name] || {};
      for (const mod of modules) {
        const lvl = lvls[mod] || 0;
        insPerm.run(did, mod, lvl >= 1 ? 1 : 0, lvl >= 2 ? 1 : 0, lvl >= 3 ? 1 : 0, lvl >= 3 ? 1 : 0);
      }
    }
  }

  // ── Classes ───────────────────────────────────────────
  const classCount = db.prepare('SELECT COUNT(*) AS c FROM class_groups').get().c;
  if (classCount === 0) {
    const insertClass = db.prepare('INSERT INTO class_groups (name, short_code, level_category, level_order) VALUES (?, ?, ?, ?)');
    const classes = [
      ['Pre-Nursery','PRE','nursery',1],['Nursery 1','N1','nursery',2],['Nursery 2','N2','nursery',3],
      ['KG 1','KG1','kindergarten',4],['KG 2','KG2','kindergarten',5],
      ['Basic 1','BS1','basic',6],['Basic 2','BS2','basic',7],['Basic 3','BS3','basic',8],
      ['Basic 4','BS4','basic',9],['Basic 5','BS5','basic',10],['Basic 6','BS6','basic',11],
      ['JHS 1','JHS1','jhs',12],['JHS 2','JHS2','jhs',13],['JHS 3','JHS3','jhs',14],
    ];
    for (const c of classes) insertClass.run(...c);
  }

  // ── Subjects ──────────────────────────────────────────
  const subjectCount = db.prepare('SELECT COUNT(*) AS c FROM subjects').get().c;
  if (subjectCount === 0) {
    const ins = db.prepare('INSERT INTO subjects (name, code, class_weight_pct, exam_weight_pct) VALUES (?, ?, 40, 60)');
    const subjects = [
      ['English','ENG'],['Mathematics','MATH'],['Science','SCI'],['History','HIS'],
      ['Religious & Moral Education','RME'],['Creative Arts','CA'],['Ghanaian Language','GHL'],
      ['Computing','COMP'],['Numeracy','NUM'],['Literacy Skills','LIT'],['Writing','WRT'],
      ['Coloring','COL'],['Reading & Identification','READ'],['Social Studies','SOC'],
      ['Career Technology','CT'],['Physical Education','PE'],['Music','MUS'],
    ];
    for (const s of subjects) ins.run(...s);
    const classMap = {
      basic: ['English','Mathematics','Science','History','Religious & Moral Education','Creative Arts','Ghanaian Language','Computing'],
      jhs:   ['English','Mathematics','Science','Social Studies','Religious & Moral Education','Ghanaian Language','Computing','Career Technology','Creative Arts'],
      kindergarten: ['Numeracy','Literacy Skills','Writing','Coloring','Creative Arts'],
      nursery: ['Numeracy','Literacy Skills','Writing','Reading & Identification'],
    };
    const classes = db.prepare('SELECT id, level_category FROM class_groups').all();
    const subs = db.prepare('SELECT id, name FROM subjects').all();
    const sMap = Object.fromEntries(subs.map(s => [s.name, s.id]));
    const insCs = db.prepare('INSERT OR IGNORE INTO class_subjects (class_group_id, subject_id) VALUES (?, ?)');
    for (const cls of classes) {
      for (const name of (classMap[cls.level_category] || [])) {
        if (sMap[name]) insCs.run(cls.id, sMap[name]);
      }
    }
  }

  // ── Academic Year & Terms ─────────────────────────────
  const yearCount = db.prepare('SELECT COUNT(*) AS c FROM academic_years').get().c;
  if (yearCount === 0) {
    db.prepare('INSERT INTO academic_years (label, start_date, end_date, is_current) VALUES (?, ?, ?, 1)').run('2025/2026', '2025-09-01', '2026-07-31');
    const yearId = db.prepare('SELECT id FROM academic_years WHERE label = ?').get('2025/2026').id;
    const insTerm = db.prepare('INSERT INTO terms (academic_year_id, term_number, label, start_date, end_date, is_current) VALUES (?, ?, ?, ?, ?, ?)');
    insTerm.run(yearId, 1, 'First Term',  '2025-09-02', '2025-12-19', 0);
    insTerm.run(yearId, 2, 'Second Term', '2026-01-08', '2026-04-01', 1);
    insTerm.run(yearId, 3, 'Third Term',  '2026-04-22', '2026-07-31', 0);
  }

  // ── Grading Bands ─────────────────────────────────────
  const bandCount = db.prepare('SELECT COUNT(*) AS c FROM grading_bands').get().c;
  if (bandCount === 0) {
    const ins = db.prepare('INSERT INTO grading_bands (min_score, max_score, remark, display_order) VALUES (?, ?, ?, ?)');
    ins.run(80, 100, 'Advanced', 1);
    ins.run(75, 79.99, 'Proficient', 2);
    ins.run(70, 74.99, 'Approaching Proficiency', 3);
    ins.run(65, 69.99, 'Developing', 4);
    ins.run(0, 64.99, 'Beginning', 5);
  }

  // ── Default Settings ──────────────────────────────────
  const insSet = db.prepare('INSERT OR IGNORE INTO settings (key, value, category) VALUES (?, ?, ?)');
  const defaults = [
    // School identity — generic placeholder for any school
    ['school_name', 'Your School Name', 'school'],
    ['school_short_name', 'School', 'school'],
    ['school_abbreviation', 'SCH', 'school'],
    ['school_motto', '', 'school'],
    ['school_vision', '', 'school'],
    ['school_mission', '', 'school'],
    ['school_type', 'Basic School', 'school'],
    ['school_location', '', 'school'],
    ['school_address', '', 'school'],
    ['school_post_office_address', '', 'school'],
    ['school_digital_address', '', 'school'],
    ['school_email', '', 'school'],
    ['school_phone_1', '', 'school'],
    ['school_phone_2', '', 'school'],
    ['school_website', '', 'school'],
    // The number parents and staff are sent to when they tap "Message the
    // school". Blank falls back to school_phone_1 — a school that has only
    // ever filled in one number still gets a working chat button.
    ['school_whatsapp', '', 'school'],
    ['school_organisation', '', 'registration'],
    ['school_company_reg_no', '', 'registration'],
    ['school_ges_reg_no', '', 'registration'],
    ['school_tin_number', '', 'registration'],
    ['school_ssnit_employer_no', '', 'registration'],
    // Branding — maintain navy+gold
    ['school_logo_path', '', 'branding'],
    ['proprietor_signature_path', '', 'signatures'],
    ['proprietor_name', '', 'signatures'],
    ['proprietor_user_id', '', 'signatures'],
    ['headmaster_signature_path', '', 'signatures'],
    ['headmaster_name', '', 'signatures'],
    ['headmaster_user_id', '', 'signatures'],
    ['embed_proprietor_signature', 'false', 'signatures'],
    ['embed_headmaster_signature', 'false', 'signatures'],
    // Terminal report layout (used by report card generator)
    ['vacation_date', '', 'signatures'],
    ['reopening_date', '', 'signatures'],
    ['current_exam_title', '', 'signatures'],
    ['signature_size_mm', '22', 'signatures'],
    // Advanced feature toggles — schools can disable features they don't need
    ['class_weight_pct', '40', 'grading'],
    ['exam_weight_pct', '60', 'grading'],
    ['feature_paye_enabled', 'true', 'features'],
    ['feature_ssnit_enabled', 'true', 'features'],
    ['feature_leave_management_enabled', 'true', 'features'],
    ['feature_canteen_enabled', 'true', 'features'],
    ['feature_notifications_enabled', 'true', 'features'],
    // Mobile companion app sync (scaffolding only — desktop is the host)
    ['mobile_sync_enabled', 'false', 'mobile'],
    ['mobile_sync_port', '4747', 'mobile'],
    ['mobile_device_pairing_token', '', 'mobile'],
    ['mobile_paired_devices', '[]', 'mobile'],
    ['mobile_last_sync_at', '', 'mobile'],
    ['school_color_primary', '#1B3A6B', 'branding'],
    ['school_color_accent', '#C9961A', 'branding'],
    ['school_color_background', '#FFFFFF', 'branding'],
    ['school_color_foreground', '#0F172A', 'branding'],
    ['ui_foreground_mode', 'dark', 'branding'],
    ['ui_font_family', 'Inter', 'branding'],
    ['ui_font_size_base', '14', 'branding'],
    ['ui_theme_mode', 'light', 'branding'],
    ['ui_density', 'comfortable', 'branding'],
    // Print
    ['print_default_color_mode', 'color', 'print'],
    ['print_paper_size', 'A4', 'print'],
    ['print_watermark_enabled', 'false', 'print'],
    // Canteen
    ['canteen_daily_rate', '5.00', 'canteen'],
    ['canteen_attendance_frequency', 'weekly', 'canteen'],
    ['canteen_attendance_exempt_enabled', 'true', 'canteen'],
    ['canteen_clockin_enabled', 'false', 'canteen'],
    // Notifications
    ['sms_provider', 'arkesel', 'notifications'],
    ['sms_api_key', '', 'notifications'],
    ['sms_sender_id', 'EduSoft', 'notifications'],
    ['email_smtp_host', '', 'notifications'],
    ['email_smtp_port', '587', 'notifications'],
    ['email_smtp_user', '', 'notifications'],
    ['email_smtp_pass', '', 'notifications'],
    ['email_from', '', 'notifications'],
    ['whatsapp_api_token', '', 'notifications'],
    ['whatsapp_phone_id', '', 'notifications'],
    // Payroll
    ['ssnit_worker_pct', '5.5', 'payroll'],
    ['ssnit_employer_pct', '13.0', 'payroll'],
    // Security / Clock-in
    ['staff_clockin_enabled', 'false', 'security'],
    // System
    ['receipt_counter', '1', 'system'],
    ['transaction_counter', '1', 'system'],
    ['next_roll_number', '1', 'system'],
    ['initial_import_done', 'false', 'system'],
    ['bootstrap_done', 'false', 'system'],
    ['software_version', '2.0.0', 'system'],
    ['software_name', 'Nickland Edusoft', 'system'],
    ['software_vendor', 'Nickland Sales', 'system'],
  ];
  for (const s of defaults) insSet.run(...s);

  // ── Notification Templates ────────────────────────────
  const tplCount = db.prepare('SELECT COUNT(*) AS c FROM notification_templates').get().c;
  if (tplCount === 0) {
    const ins = db.prepare('INSERT INTO notification_templates (name, channel, body, category) VALUES (?, ?, ?, ?)');
    ins.run('Fee Receipt', 'sms', 'Dear {parent_name}, payment of GHS {amount} received for {student_name} ({index_number}) on {date}. Balance: GHS {balance}. Receipt #{receipt}. -{school_name}', 'fees');
    ins.run('Arrears Reminder', 'sms', 'Dear parent of {student_name} ({class}), {student_name} owes GHS {amount} from {term}. Please settle. -{school_name}', 'fees');
    ins.run('Canteen Balance', 'sms', 'Dear parent, {student_name} has {days} unpaid canteen days (GHS {amount}). Please pay. -{school_name}', 'canteen');
    ins.run('General Notice', 'sms', '{message} -{school_name}', 'general');
    ins.run('Report Card Ready', 'sms', 'Dear parent, the End of Term Report for {student_name} is ready. Please collect from the school. -{school_name}', 'academic');
  }

  // NOTE: No default user created here.
  // First-run bootstrap screen creates the Admin account.
}

function runMigrations(db) {
  // The diagnostics table has to exist before anything else so migration
  // failures below have somewhere to land.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS system_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level   TEXT NOT NULL DEFAULT 'info',
        source  TEXT,
        message TEXT NOT NULL,
        detail  TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_system_log_created ON system_log(created_at);
    `);
  } catch (e) { /* logging is best-effort and must never block startup */ }

  // Additive migrations for users upgrading from an older database.
  // Each is wrapped so a failure (e.g. column already exists) doesn't abort the
  // rest. Failures used to vanish entirely; they are now recorded so a broken
  // upgrade is diagnosable after the fact instead of showing up as missing data.
  let step = 0;
  const safe = (fn) => {
    step++;
    const at = step;
    try { fn(); } catch (e) {
      try {
        db.prepare("INSERT INTO system_log (level, source, message, detail) VALUES ('warn', 'migration', ?, ?)")
          .run(`Migration step ${at} did not apply`, String((e && e.message) || e).slice(0, 500));
      } catch (_) { /* nothing more we can do */ }
    }
  };

  // 0. password_reset_requests — added in F9. Created here as well as in SCHEMA
  // so a school upgrading from an older database gets it without a reinstall.
  safe(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS password_reset_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reason TEXT,
        requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
        requested_from TEXT,
        decided_by INTEGER,
        decided_at TEXT,
        decision_note TEXT,
        claim_hash TEXT,
        claim_expires_at TEXT,
        used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pwreset_user   ON password_reset_requests(user_id);
      CREATE INDEX IF NOT EXISTS idx_pwreset_status ON password_reset_requests(status);
    `);
  });

  // 1. users.photo_path (added in E1)
  safe(() => {
    const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!cols.includes('photo_path')) {
      db.exec("ALTER TABLE users ADD COLUMN photo_path TEXT");
    }
  });

  // 2. Normalize legacy income category 'school_fees' → 'fees' so finance/audit reconcile
  safe(() => {
    db.prepare("UPDATE income_records SET category = 'fees' WHERE category = 'school_fees'").run();
  });

  // 3. Backfill transaction_date from date where it was left null by old code
  safe(() => {
    db.prepare("UPDATE income_records SET transaction_date = date WHERE transaction_date IS NULL AND date IS NOT NULL").run();
  });

  // 4. student_bills: ensure newer columns exist on old DBs
  safe(() => {
    const cols = db.prepare("PRAGMA table_info(student_bills)").all().map(c => c.name);
    const add = (name, type) => { if (!cols.includes(name)) db.exec(`ALTER TABLE student_bills ADD COLUMN ${name} ${type}`); };
    add('total_billed', 'REAL DEFAULT 0');
    add('total_paid', 'REAL DEFAULT 0');
    add('books_total', 'REAL DEFAULT 0');
    add('books_paid', 'REAL DEFAULT 0');
    add('books_arrears', 'REAL DEFAULT 0');
    add('discount_amount', 'REAL DEFAULT 0');
    add('discount_reason', 'TEXT');
  });

  // 5. Terminal-report settings (Phase F7a). Seed into 'signatures' category so
  //    Settings → Signatures → Terminal Report Layout panel reads them.
  safe(() => {
    const ins = db.prepare(
      "INSERT OR IGNORE INTO settings (key, value, category) VALUES (?, ?, 'signatures')"
    );
    ins.run('vacation_date', '');
    ins.run('reopening_date', '');
    ins.run('current_exam_title', '');
    ins.run('signature_size_mm', '22');
  });

  // 6. Per-term vacation/reopening dates so each term's report card carries its
  //    own dates (vacation = end of the printed term, reopening = start of the
  //    upcoming term).
  safe(() => {
    const cols = db.prepare("PRAGMA table_info(terms)").all().map(c => c.name);
    if (!cols.includes('vacation_date'))  db.exec("ALTER TABLE terms ADD COLUMN vacation_date TEXT");
    if (!cols.includes('reopening_date')) db.exec("ALTER TABLE terms ADD COLUMN reopening_date TEXT");
  });

  // 7. Promotion outcome per student/term (third term is the promotion term).
  //    A non-empty promoted_to means the student was promoted and the report
  //    prints "Promoted to <value>".
  safe(() => {
    const cols = db.prepare("PRAGMA table_info(student_term_summary)").all().map(c => c.name);
    if (!cols.includes('promoted_to')) db.exec("ALTER TABLE student_term_summary ADD COLUMN promoted_to TEXT");
  });

  // 8. canteen_payments.term_id — the canteen record-payment flow inserted and
  //    queried a term_id column that never existed in the schema, which crashed
  //    both "Record Payment" and the student canteen profile. Add it so canteen
  //    income is properly attributed to a term.
  safe(() => {
    const cols = db.prepare("PRAGMA table_info(canteen_payments)").all().map(c => c.name);
    if (!cols.includes('term_id')) db.exec("ALTER TABLE canteen_payments ADD COLUMN term_id INTEGER");
    // Backfill term_id from the school calendar / date so old rows report correctly.
    db.prepare(`
      UPDATE canteen_payments SET term_id = (
        SELECT t.id FROM terms t
        WHERE date(t.start_date) <= date(canteen_payments.payment_date)
          AND date(t.end_date) >= date(canteen_payments.payment_date)
        ORDER BY date(t.start_date) DESC LIMIT 1
      ) WHERE term_id IS NULL
    `).run();
  });

  // 9. Receipts ledger — every payment gets a durable receipt record so a
  //    receipt can always be re-printed, re-sent (email/SMS) and audited.
  safe(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_number TEXT,
        receipt_type TEXT NOT NULL DEFAULT 'fees',
        source TEXT,
        source_id INTEGER,
        student_id INTEGER,
        amount REAL NOT NULL DEFAULT 0,
        payment_method TEXT,
        term_id INTEGER,
        academic_year_id INTEGER,
        payer_name TEXT,
        recipient_contact TEXT,
        issued_at TEXT DEFAULT CURRENT_TIMESTAMP,
        issued_by INTEGER,
        pdf_path TEXT,
        delivery_status TEXT DEFAULT 'issued',
        delivered_channels TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_receipts_source ON receipts(source, source_id);
      CREATE INDEX IF NOT EXISTS idx_receipts_number ON receipts(receipt_number);
    `);
  });

  // 10. Finance ledger indexes for the date-range + term reports.
  safe(() => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_income_txn_date ON income_records(transaction_date);
      CREATE INDEX IF NOT EXISTS idx_expense_txn_date ON expense_records(transaction_date);
      CREATE INDEX IF NOT EXISTS idx_income_linked_pay ON income_records(linked_payment_id);
      CREATE INDEX IF NOT EXISTS idx_income_linked_canteen ON income_records(linked_canteen_payment_id);
      CREATE INDEX IF NOT EXISTS idx_expense_linked_salary ON expense_records(linked_salary_id);
    `);
  });

  // 11. Session / term-automation settings (school-in-session vs vacation).
  safe(() => {
    const ins = db.prepare("INSERT OR IGNORE INTO settings (key, value, category) VALUES (?, ?, 'session')");
    ins.run('session_status_mode', 'auto');      // auto | in_session | vacation
    ins.run('session_status_manual', '');        // used when mode != auto
    ins.run('term_auto_migrate', 'prompt');      // prompt | auto | off
    ins.run('term_last_migrated_to', '');        // id of the last term we migrated into
    ins.run('use_network_time', 'true');         // fall back to system clock if false/offline
  });

  // 12. Receipt / print settings.
  safe(() => {
    const ins = db.prepare("INSERT OR IGNORE INTO settings (key, value, category) VALUES (?, ?, 'print')");
    ins.run('receipt_paper_size', 'A4');         // A4 | A5 | Letter | roll80 | roll58
    ins.run('receipt_auto_generate', 'true');    // auto-make a receipt on every fee payment
    ins.run('receipt_footer_note', 'Thank you for your payment.');
  });

  // 13. Automatic receipt delivery settings + parent email columns.
  safe(() => {
    const cols = db.prepare("PRAGMA table_info(students)").all().map(c => c.name);
    if (!cols.includes('father_email'))   db.exec("ALTER TABLE students ADD COLUMN father_email TEXT");
    if (!cols.includes('mother_email'))   db.exec("ALTER TABLE students ADD COLUMN mother_email TEXT");
    if (!cols.includes('guardian_email')) db.exec("ALTER TABLE students ADD COLUMN guardian_email TEXT");
  });
  safe(() => {
    const ins = db.prepare("INSERT OR IGNORE INTO settings (key, value, category) VALUES (?, ?, 'notifications')");
    ins.run('receipt_delivery_enabled', 'false');       // auto-send receipt on payment
    ins.run('receipt_delivery_channels', 'sms');        // comma list: sms,email
    ins.run('receipt_delivery_contact', 'auto');        // auto | father | mother | guardian
    ins.run('receipt_delivery_email_source', 'auto');   // auto | father | mother | guardian
    ins.run('email_from', '');                          // From: address for email
    ins.run('email_provider', 'smtp');                  // 'smtp' | 'resend'
    ins.run('resend_api_key', '');                      // Resend HTTP API key
  });

  // 14. Mobile API host: parent accounts, parent↔student links, device tokens.
  safe(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS parents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        password_hash TEXT,
        is_active INTEGER DEFAULT 1,
        must_change_password INTEGER DEFAULT 0,
        last_login TEXT,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_parents_phone ON parents(phone) WHERE phone IS NOT NULL AND phone != '';
      CREATE TABLE IF NOT EXISTS parent_students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        relationship TEXT,
        UNIQUE (parent_id, student_id),
        FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS api_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT UNIQUE NOT NULL,
        subject_type TEXT NOT NULL,      -- 'user' (staff) | 'parent'
        subject_id INTEGER NOT NULL,
        device_name TEXT,
        platform TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_used_at TEXT,
        expires_at TEXT,
        revoked INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_api_tokens_subject ON api_tokens(subject_type, subject_id);
    `);
  });
  safe(() => {
    const ins = db.prepare("INSERT OR IGNORE INTO settings (key, value, category) VALUES (?, ?, 'mobile')");
    ins.run('mobile_server_enabled', 'false');   // start the embedded API server
    ins.run('mobile_server_port', '4747');        // TCP port for the API
    ins.run('mobile_server_bind', 'lan');         // 'lan' (0.0.0.0) | 'localhost'
    ins.run('mobile_parent_self_register', 'true'); // parents may self-register if their phone matches a student
    ins.run('mobile_token_ttl_days', '30');
  });

  // 15. Payment intents — parents submit a payment (mobile money / bank / cash
  //     at office) that the accountant (or a future gateway webhook) acknowledges.
  //     On acknowledgment the payment is recorded via the ledger and a receipt is
  //     auto-generated + delivered, so every channel behaves identically.
  safe(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS payment_intents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT,
        student_id INTEGER NOT NULL,
        parent_id INTEGER,
        term_id INTEGER,
        amount REAL NOT NULL,
        channel TEXT DEFAULT 'mobile',       -- mobile_money | bank | cash | other
        reference TEXT,
        notes TEXT,
        status TEXT DEFAULT 'pending',        -- pending | acknowledged | rejected
        payment_id INTEGER,
        acknowledged_by INTEGER,
        acknowledged_at TEXT,
        reject_reason TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES parents(id)
      );
      CREATE INDEX IF NOT EXISTS idx_intents_status ON payment_intents(status);
      CREATE INDEX IF NOT EXISTS idx_intents_student ON payment_intents(student_id);
    `);
  });

  // 16. Online payment gateway (Paystack by default; pluggable per school).
  safe(() => {
    const cols = db.prepare("PRAGMA table_info(payment_intents)").all().map(c => c.name);
    const add = (n, t) => { if (!cols.includes(n)) db.exec(`ALTER TABLE payment_intents ADD COLUMN ${n} ${t}`); };
    add('gateway', 'TEXT');
    add('gateway_reference', 'TEXT');
    add('authorization_url', 'TEXT');
    add('gateway_status', 'TEXT');
    add('currency', 'TEXT');
    add('email', 'TEXT');
  });
  safe(() => {
    const ins = db.prepare("INSERT OR IGNORE INTO settings (key, value, category) VALUES (?, ?, 'payments')");
    ins.run('payment_gateway', 'none');          // none | paystack | (future: flutterwave, hubtel…)
    ins.run('payment_currency', 'GHS');
    ins.run('paystack_secret_key', '');
    ins.run('paystack_public_key', '');
    ins.run('paystack_base_url', 'https://api.paystack.co');
    ins.run('paystack_callback_url', '');        // optional; app uses a deep link by default
  });

  // 19. Announcements — school → parents notices surfaced on the web portal.
  safe(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        audience TEXT DEFAULT 'all',      -- all | student
        target_student_id INTEGER,
        is_active INTEGER DEFAULT 1,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (target_student_id) REFERENCES students(id)
      );
    `);
  });

  // 18. Cloud sync outbox (thin-cloud). Local SQLite stays the source of truth;
  //     the outbox projects a small view (balances, receipts, notices) up to the
  //     cloud portal. Nothing here is required for the app to run offline.
  safe(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT,
        entity_type TEXT NOT NULL,   -- student_snapshot | receipt | notification | …
        entity_key TEXT,             -- stable key within the school (e.g. student id)
        op TEXT DEFAULT 'upsert',    -- upsert | delete
        payload_json TEXT,
        version INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced_at TEXT,
        attempts INTEGER DEFAULT 0,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_outbox_unsynced ON sync_outbox(synced_at);
    `);
  });
  safe(() => {
    const ins = db.prepare("INSERT OR IGNORE INTO settings (key, value, category) VALUES (?, ?, 'cloud')");
    ins.run('cloud_sync_enabled', 'false');
    ins.run('cloud_base_url', '');          // e.g. https://api.nicklandedusoft.app
    ins.run('school_api_key', '');          // per-school key issued by the portal
    ins.run('cloud_school_id', '');
    ins.run('cloud_cursor', '0');           // pull cursor
    ins.run('cloud_push_batch', '100');
    ins.run('cloud_last_push_at', '');
    ins.run('cloud_last_pull_at', '');
  });

  // 20. Sync record versions must increase monotonically per entity, forever.
  //     The cloud stores reject an incoming snapshot whose version is not
  //     greater than the one they hold (so out-of-order retries can't regress
  //     the read model). A per-row `version` that restarts at 1 on every new
  //     outbox row therefore made the cloud silently ignore every later update
  //     once two changes had ever been collapsed into one un-synced row — the
  //     parent portal froze on a stale balance while the desktop reported the
  //     push as accepted. This counter survives outbox pruning.
  safe(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_versions (
        entity_key TEXT PRIMARY KEY,
        version    INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Seed from any history already in the outbox so upgrading installs keep
    // counting up from where the cloud left off instead of restarting at 1.
    db.exec(`
      INSERT OR IGNORE INTO sync_versions (entity_key, version)
      SELECT entity_key, MAX(version) FROM sync_outbox
      WHERE entity_key IS NOT NULL GROUP BY entity_key;
    `);
  });

  // 21. Outbox retry scheduling. Without a next-attempt time a permanently
  //     failing record was retried on every 5-minute tick forever, and an
  //     un-acceptable ("poison") record at the head of the queue was pushed
  //     again on every cycle.
  safe(() => {
    const cols = db.prepare("PRAGMA table_info(sync_outbox)").all().map(c => c.name);
    if (!cols.includes('next_attempt_at')) {
      db.exec("ALTER TABLE sync_outbox ADD COLUMN next_attempt_at TEXT");
    }
    if (!cols.includes('dead')) {
      db.exec("ALTER TABLE sync_outbox ADD COLUMN dead INTEGER DEFAULT 0");
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_outbox_pending ON sync_outbox(synced_at, dead, next_attempt_at)");
  });

  // 17. Automated backup settings.
  safe(() => {
    const ins = db.prepare("INSERT OR IGNORE INTO settings (key, value, category) VALUES (?, ?, 'backup')");
    ins.run('backup_auto_enabled', 'false');
    ins.run('backup_frequency', 'daily');   // hourly | daily | weekly
    ins.run('backup_time', '20:00');        // HH:MM for daily/weekly
    ins.run('backup_day_of_week', '0');     // 0=Sunday … 6=Saturday (weekly)
    ins.run('backup_retention', '10');      // keep newest N automatic backups per folder
    ins.run('backup_folder_path', '');      // custom local / LAN / network folder
    ins.run('backup_cloud_path', '');       // cloud-sync folder (Google Drive Desktop, etc.)
    ins.run('backup_last_auto_at', '');
  });

  // 22. Timetable — a school-wide bell schedule (periods) plus per-class,
  //     per-day entries mapping a period to a subject + teacher. Kept simple:
  //     one grid per class, Mon–Fri, reusing the shared period rows so break /
  //     lunch line up across classes. teacher_id references staff.id so a
  //     teacher's own timetable is a straight lookup by their staff record.
  safe(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS timetable_periods (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        label         TEXT NOT NULL,
        start_time    TEXT NOT NULL,          -- 'HH:MM' (24h)
        end_time      TEXT NOT NULL,
        display_order INTEGER NOT NULL DEFAULT 0,
        is_break      INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS timetable_entries (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        class_group_id INTEGER NOT NULL,
        day_of_week    INTEGER NOT NULL,       -- 1=Mon … 5=Fri
        period_id      INTEGER NOT NULL,
        subject_id     INTEGER,
        teacher_id     INTEGER,                -- staff.id
        notes          TEXT,
        UNIQUE (class_group_id, day_of_week, period_id)
      );
      CREATE INDEX IF NOT EXISTS idx_tt_entries_class   ON timetable_entries(class_group_id);
      CREATE INDEX IF NOT EXISTS idx_tt_entries_teacher ON timetable_entries(teacher_id);
    `);
  });

  // 23. Two-way messaging — parent ↔ school threads. The desktop is the source
  //     of truth; staff replies mirror out to the parent's SMS/email so parents
  //     not using the app still get the message. Each thread carries a uuid so
  //     it can be projected to the portal as a read snapshot.
  safe(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS message_threads (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid            TEXT UNIQUE,
        parent_id       INTEGER NOT NULL,
        student_id      INTEGER,
        subject         TEXT,
        created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
        last_message_at TEXT,
        last_sender     TEXT,               -- 'parent' | 'staff'
        parent_unread   INTEGER NOT NULL DEFAULT 0,
        staff_unread    INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS messages (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid         TEXT UNIQUE,
        thread_id    INTEGER NOT NULL,
        sender_type  TEXT NOT NULL,          -- 'parent' | 'staff'
        sender_id    INTEGER,
        sender_name  TEXT,
        body         TEXT NOT NULL,
        created_at   TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_messages_thread  ON messages(thread_id);
      CREATE INDEX IF NOT EXISTS idx_threads_parent   ON message_threads(parent_id);
    `);
  });

  // 24. Homework / assignments — a teacher sets work for a class + subject with
  //     a due date; parents see their child's class homework (in-app and, via
  //     the snapshot, on the portal).
  safe(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS homework (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        class_group_id INTEGER NOT NULL,
        subject_id     INTEGER,
        teacher_id     INTEGER,             -- staff.id
        title          TEXT NOT NULL,
        description    TEXT,
        due_date       TEXT,                -- 'YYYY-MM-DD'
        created_at     TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_homework_class ON homework(class_group_id, due_date);
    `);
  });

  // 25. canteen_payments.daily_rate — the canteen record-payment flow has always
  //     INSERTed a `daily_rate` column (the rate charged at the time of payment),
  //     but the base schema never created it. On any database built from the
  //     current schema the INSERT failed with "no column named daily_rate" and
  //     the whole payment rolled back, so canteen collection was broken on fresh
  //     installs. Add the column (additive, idempotent) and backfill existing
  //     rows from the configured rate. Mirrors migration 8 (term_id).
  safe(() => {
    const cols = db.prepare("PRAGMA table_info(canteen_payments)").all().map(c => c.name);
    if (!cols.includes('daily_rate')) {
      db.exec("ALTER TABLE canteen_payments ADD COLUMN daily_rate REAL");
      db.exec(`
        UPDATE canteen_payments
           SET daily_rate = COALESCE(
             (SELECT CAST(value AS REAL) FROM settings WHERE key = 'canteen_daily_rate'),
             CASE WHEN days_covered > 0 THEN amount / days_covered ELSE 0 END
           )
         WHERE daily_rate IS NULL
      `);
    }
  });

  // 26. Attribute every canteen payment to a term.
  //
  //     Migration 8 only matched payments whose payment_date fell inside a term
  //     window. Collections taken during vacation (arrears settled after the
  //     term closed) stayed NULL, and the canteen module — which scoped its
  //     totals by that same date window — reported GHS 0 while the income
  //     ledger counted the money under the current term. That is the
  //     "canteen income does not match canteen payments" audit finding.
  //
  //     Attribute by the DAYS the payment covers first (the semantically
  //     correct term), then the date window, then the current term. Running
  //     before reconcileLedger() also means any collection that never posted
  //     income (the whole-class daily collection did not) is back-posted under
  //     the right term at startup.
  safe(() => {
    const cols = db.prepare("PRAGMA table_info(canteen_payments)").all().map(c => c.name);
    if (!cols.includes('term_id')) return; // migration 8 adds it; nothing to do yet

    // (a) From the school calendar, via the days this payment marked paid.
    db.exec(`
      UPDATE canteen_payments
         SET term_id = (
           SELECT sc.term_id FROM canteen_day_status cds
           JOIN school_calendar sc ON sc.date = cds.date
           WHERE cds.payment_id = canteen_payments.id AND sc.term_id IS NOT NULL
           LIMIT 1
         )
       WHERE term_id IS NULL
    `);
    // (b) From the covered date range against the term windows.
    db.exec(`
      UPDATE canteen_payments
         SET term_id = (
           SELECT t.id FROM terms t
           WHERE date(t.start_date) <= date(COALESCE(canteen_payments.start_date, canteen_payments.payment_date))
             AND date(t.end_date)   >= date(COALESCE(canteen_payments.start_date, canteen_payments.payment_date))
           ORDER BY date(t.start_date) DESC LIMIT 1
         )
       WHERE term_id IS NULL
    `);
    // (c) Anything still unattributed goes to the current term.
    db.exec(`
      UPDATE canteen_payments
         SET term_id = (SELECT id FROM terms WHERE is_current = 1)
       WHERE term_id IS NULL
    `);

    // Re-point any canteen income already posted so the ledger agrees with the
    // payment rows it was created from.
    db.exec(`
      UPDATE income_records
         SET term_id = (
           SELECT cp.term_id FROM canteen_payments cp
           WHERE cp.id = income_records.linked_canteen_payment_id
         )
       WHERE linked_canteen_payment_id IS NOT NULL
         AND (SELECT cp.term_id FROM canteen_payments cp WHERE cp.id = income_records.linked_canteen_payment_id) IS NOT NULL
    `);
  });

  // 27. Homework becomes a real assignment record: scoped to a term, optionally
  //     graded out of `max_marks`, and — when graded — wired to an
  //     `assessment_columns` row so the marks a teacher enters flow into the
  //     continuous-assessment class score, the end-of-term total and the report
  //     card, instead of sitting in an island table.
  //     `homework_submissions` tracks each pupil's status and mark.
  safe(() => {
    const cols = db.prepare("PRAGMA table_info(homework)").all().map(c => c.name);
    const add = (name, type) => { if (!cols.includes(name)) db.exec(`ALTER TABLE homework ADD COLUMN ${name} ${type}`); };
    add('term_id', 'INTEGER');
    add('max_marks', 'REAL');                       // NULL → not graded
    add('assessment_column_id', 'INTEGER');         // set once marks are recorded
    add('assigned_date', 'TEXT');
    add('status', "TEXT DEFAULT 'published'");      // draft | published

    // Existing rows predate terms — attribute them to the term whose window
    // contains the due date, else the current term.
    db.exec(`
      UPDATE homework SET term_id = COALESCE(
        (SELECT t.id FROM terms t
          WHERE date(t.start_date) <= date(COALESCE(homework.due_date, homework.created_at))
            AND date(t.end_date)   >= date(COALESCE(homework.due_date, homework.created_at))
          ORDER BY date(t.start_date) DESC LIMIT 1),
        (SELECT id FROM terms WHERE is_current = 1)
      ) WHERE term_id IS NULL
    `);
    db.exec("UPDATE homework SET assigned_date = date(created_at) WHERE assigned_date IS NULL");
    db.exec("UPDATE homework SET status = 'published' WHERE status IS NULL");

    db.exec(`
      CREATE TABLE IF NOT EXISTS homework_submissions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        homework_id  INTEGER NOT NULL,
        student_id   INTEGER NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending',  -- pending|submitted|late|missing|exempt
        marks        REAL,
        remarks      TEXT,
        submitted_at TEXT,
        marked_at    TEXT,
        UNIQUE (homework_id, student_id),
        FOREIGN KEY (homework_id) REFERENCES homework(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_hw_sub_homework ON homework_submissions(homework_id);
      CREATE INDEX IF NOT EXISTS idx_hw_sub_student  ON homework_submissions(student_id);
      CREATE INDEX IF NOT EXISTS idx_homework_term   ON homework(term_id, class_group_id);
    `);
  });

  // 28. Transport — bus routes, the stops on each route, which route/stop a
  //     pupil rides, and termly transport-fee collection. Fee collection posts
  //     to the finance ledger under category 'transport', attributed by term_id
  //     and idempotent on the receipt number, exactly like fees/canteen — so it
  //     can never fall out of the term-scoped Finance reports or double-post.
  safe(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS transport_routes (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT NOT NULL,
        description    TEXT,
        vehicle_number TEXT,
        driver_name    TEXT,
        driver_phone   TEXT,
        capacity       INTEGER,
        fee_per_term   REAL NOT NULL DEFAULT 0,
        is_active      INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS transport_stops (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        route_id      INTEGER NOT NULL,
        name          TEXT NOT NULL,
        pickup_time   TEXT,
        dropoff_time  TEXT,
        display_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (route_id) REFERENCES transport_routes(id) ON DELETE CASCADE
      );
      -- One active assignment per pupil. fee_override lets a pupil pay a rate
      -- other than the route default (siblings, staff children, part-week).
      CREATE TABLE IF NOT EXISTS student_transport (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id   INTEGER NOT NULL UNIQUE,
        route_id     INTEGER NOT NULL,
        stop_id      INTEGER,
        direction    TEXT NOT NULL DEFAULT 'both',   -- both | morning | afternoon
        fee_override REAL,
        start_date   TEXT,
        is_active    INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
        FOREIGN KEY (route_id) REFERENCES transport_routes(id),
        FOREIGN KEY (stop_id) REFERENCES transport_stops(id)
      );
      CREATE TABLE IF NOT EXISTS transport_payments (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id     INTEGER NOT NULL,
        route_id       INTEGER,
        term_id        INTEGER,
        amount         REAL NOT NULL,
        payment_date   TEXT NOT NULL,
        payment_method TEXT DEFAULT 'Cash',
        received_by    INTEGER,
        notes          TEXT,
        receipt_number TEXT UNIQUE,
        created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_transport_stops_route ON transport_stops(route_id);
      CREATE INDEX IF NOT EXISTS idx_transport_pay_term    ON transport_payments(term_id, student_id);
    `);
  });

  // 29. Billing structure — bill types, supplementary charges, and voiding.
  //
  //     Ghanaian private schools issue exactly ONE school-fees bill per pupil
  //     per term (tuition + the standing levies). Anything else that comes up
  //     during the term — excursion, sports week, mock/BECE registration,
  //     speech day — is a *supplementary* charge raised on top of the pupil's
  //     existing term bill, not a second school-fees bill. Modelling extras as
  //     line items on the one term bill keeps a single balance per pupil per
  //     term, so payment allocation and the finance ledger stay unambiguous.
  //
  //     Bills are also never hard-deleted once money has been received against
  //     them; they are VOIDED with a reason and an audit trail, and voided
  //     bills drop out of every default listing and every total.
  safe(() => {
    const cols = db.prepare("PRAGMA table_info(fee_templates)").all().map(c => c.name);
    const add = (name, type) => { if (!cols.includes(name)) db.exec(`ALTER TABLE fee_templates ADD COLUMN ${name} ${type}`); };
    // school_fees = the once-per-term bill; supplementary = an in-term extra
    add('bill_type', "TEXT NOT NULL DEFAULT 'school_fees'");
    add('academic_year_id', 'INTEGER');
    add('notes', 'TEXT');
    add('copied_from_template_id', 'INTEGER');
  });

  safe(() => {
    const cols = db.prepare("PRAGMA table_info(student_bills)").all().map(c => c.name);
    const add = (name, type) => { if (!cols.includes(name)) db.exec(`ALTER TABLE student_bills ADD COLUMN ${name} ${type}`); };
    add('status', "TEXT NOT NULL DEFAULT 'active'");   // active | voided
    add('supplementary_total', 'REAL DEFAULT 0');
    add('voided_at', 'TEXT');
    add('voided_by', 'INTEGER');
    add('void_reason', 'TEXT');
    db.exec("UPDATE student_bills SET status = 'active' WHERE status IS NULL OR status = ''");
    db.exec('CREATE INDEX IF NOT EXISTS idx_bills_status ON student_bills(status, term_id)');
  });

  safe(() => {
    const cols = db.prepare("PRAGMA table_info(bill_line_items)").all().map(c => c.name);
    const add = (name, type) => { if (!cols.includes(name)) db.exec(`ALTER TABLE bill_line_items ADD COLUMN ${name} ${type}`); };
    // fees   — comes from the term's school-fees template, rebuilt on regeneration
    // arrear — carried-forward balance, rebuilt on regeneration
    // extra  — a supplementary charge, PRESERVED across regeneration
    add('charge_type', "TEXT NOT NULL DEFAULT 'fees'");
    add('source_template_id', 'INTEGER');
    add('added_at', 'TEXT');
    add('added_by', 'INTEGER');
    db.exec(`
      UPDATE bill_line_items
         SET charge_type = CASE WHEN COALESCE(is_arrear, 0) = 1 THEN 'arrear' ELSE 'fees' END
       WHERE charge_type IS NULL OR charge_type = ''
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_bill_items_type ON bill_line_items(student_bill_id, charge_type)');
  });

  // 30. Offline finance workbook — the import log.
  //
  //     The workbook is the school's fallback when the computer is down: they
  //     keep collecting on paper/Excel, then import it back. The one thing that
  //     must never happen is a double-post — importing the same workbook twice
  //     (or importing a file that overlaps a previous one) charging the school
  //     twice. Every row that comes in from a workbook carries a stable
  //     entry_key derived from its content, and that key is recorded here with
  //     a UNIQUE constraint. The importer checks this table first, so a repeat
  //     import is a no-op rather than a duplicate payment.
  safe(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workbook_import_log (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_key    TEXT NOT NULL UNIQUE,
        sheet        TEXT NOT NULL,
        target_table TEXT,
        target_id    INTEGER,
        amount       REAL,
        summary      TEXT,
        source_file  TEXT,
        imported_by  INTEGER,
        imported_at  TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_wb_import_sheet ON workbook_import_log(sheet, imported_at);
    `);
  });
}

function initDatabase(userDataPath, getResourcePath) {
  const Database = require('better-sqlite3');
  const dbPath = path.join(userDataPath, 'nickland-edusoft.db');
  const isFirstRun = !fs.existsSync(dbPath);
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  runMigrations(db);
  seedDefaults(db);
  // Repair the finance ledger against the source-of-truth payment tables so
  // historically-collected money (before the posting fixes) shows up correctly.
  try {
    const { reconcileLedger } = require('../ipc/_ledger');
    reconcileLedger(db);
  } catch (e) { /* never block startup */ }
  db._getResourcePath = getResourcePath;
  db._userDataPath = userDataPath;
  db._isFirstRun = isFirstRun;
  return db;
}

// SCHEMA and runMigrations are exported so tests can build a database the same
// way the app does. Hand-rolled test schemas drift from the real one — that is
// how the sync outbox shipped without its version counter.
// seedDefaults is exported alongside the schema so a test can build a database
// that looks like a real one — designations and their permission defaults
// included. Without it every account came out with a null designation, which
// is not a state the app ever ships.
module.exports = { initDatabase, runMigrations, SCHEMA, seedDefaults };
