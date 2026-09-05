// Misc helpers
export function fmtCedi(n) {
  if (n === null || n === undefined || isNaN(n)) return 'GHS 0.00';
  return 'GHS ' + Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return d; }
}

export function fullName(s) {
  if (!s) return '';
  return [s.surname, s.first_name, s.other_names].filter(Boolean).join(' ');
}

export function initials(s) {
  if (!s) return '?';
  const a = (s.surname || '').charAt(0);
  const b = (s.first_name || '').charAt(0);
  return (a + b).toUpperCase() || '?';
}

// Live age computed from date_of_birth against today's date.
// Always returns a real integer if DOB is present, otherwise null.
export function computeAge(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

// Display age: live-compute from DOB if present, else stored age, else '—'
export function displayAge(student) {
  if (!student) return '—';
  const live = computeAge(student.date_of_birth);
  if (live !== null) return live;
  if (student.age) return student.age;
  return '—';
}

// A term named so two of them can be told apart.
//
// Every academic year has a "First Term". A bare term dropdown therefore shows
// "First Term" twice, and a fee schedule saved against next year's First Term
// while the school is running this year's Third Term looks identical to the
// right one — until bill generation fails with "no template applies" and
// nobody can see why. Every term shown to a user carries its academic year.
export function termLabel(term, fallback = '') {
  if (!term) return fallback;
  const label = term.label || term.term_label || '';
  if (!label) return fallback;
  const year = term.year_label || term.academic_year_label || '';
  return year ? `${label} · ${year}` : label;
}
