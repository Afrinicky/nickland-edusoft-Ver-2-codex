// Helpers for Student ID generation and admission-year backdating.
// The "AVE" prefix is configurable in Settings → School (school_abbreviation).
// Years-back per class level: how many years ago this student would have entered N1.
// Add/remove entries here if a school adds new class levels.

const CLASS_YEARS_BACK = {
  'PRE': 0, 'N1': 0, 'N2': 1,
  'KG1': 2, 'KG2': 3,
  'BS1': 4, 'BS2': 5, 'BS3': 6, 'BS4': 7, 'BS5': 8, 'BS6': 9,
  'JHS1': 10, 'JHS2': 11, 'JHS3': 12,
};

function getAdmissionYear(classShortCode, currentYear) {
  // Strip any " A/B/C" section suffix to look up the base class.
  const base = String(classShortCode || '').replace(/[A-Z]$/, '').replace(/\s+/g, '').toUpperCase();
  const back = CLASS_YEARS_BACK[base];
  if (back === undefined) return currentYear;
  return currentYear - back;
}

function formatIndexNumber(prefix, admissionYear, rollNumber) {
  const yy = String(admissionYear).slice(-2);
  const roll = String(rollNumber).padStart(5, '0');
  return `${prefix}/${yy}/${roll}`;
}

function parseIndexNumber(indexNumber) {
  const match = String(indexNumber).match(/^([A-Z]+)\/(\d{2})\/(\d+)$/);
  if (!match) return null;
  return {
    prefix: match[1],
    yy: parseInt(match[2], 10),
    year: 2000 + parseInt(match[2], 10),
    roll: parseInt(match[3], 10),
  };
}

function getSetting(db, key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function getSchoolAbbreviation(db) {
  return getSetting(db, 'school_abbreviation', 'AVE');
}

function getNextRollNumber(db) {
  return parseInt(getSetting(db, 'next_roll_number', '1'), 10);
}

function setNextRollNumber(db, next) {
  db.prepare("UPDATE settings SET value = ? WHERE key = 'next_roll_number'").run(String(next));
}

function getNextReceiptNumber(db) {
  const current = parseInt(getSetting(db, 'receipt_counter', '1'), 10);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'receipt_counter'").run(String(current + 1));
  return current;
}

module.exports = {
  CLASS_YEARS_BACK,
  getAdmissionYear,
  formatIndexNumber,
  parseIndexNumber,
  getSchoolAbbreviation,
  getNextRollNumber,
  setNextRollNumber,
  getNextReceiptNumber,
  getSetting,
};
