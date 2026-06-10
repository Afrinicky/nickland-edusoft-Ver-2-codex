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
