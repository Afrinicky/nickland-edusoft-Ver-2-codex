// Nickland Edusoft — Database Layer
// Copyright © 2026 Nickland Sales. All rights reserved.
const Database = require('better-sqlite3');
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
  // Additive migrations for users upgrading from an older database.
  // Each is wrapped so a failure (e.g. column already exists) doesn't abort the rest.
  const safe = (fn) => { try { fn(); } catch (e) { /* already applied */ } };

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
}

function initDatabase(userDataPath, getResourcePath) {
  const dbPath = path.join(userDataPath, 'nickland-edusoft.db');
  const isFirstRun = !fs.existsSync(dbPath);
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  runMigrations(db);
  seedDefaults(db);
  db._getResourcePath = getResourcePath;
  db._userDataPath = userDataPath;
  db._isFirstRun = isFirstRun;
  return db;
}

module.exports = { initDatabase };
