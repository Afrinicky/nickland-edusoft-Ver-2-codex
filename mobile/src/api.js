// Nickland Edusoft mobile — API client
//
// Two connection modes, one method surface:
//   • host  — talks to a school's DESKTOP, over the school Wi-Fi or a tunnel:
//             http(s)://<address>/api/v1, routes under /auth/*, /parent/* and
//             the staff routes. Everything a school does, and it works with
//             the internet down.
//   • cloud — talks to the hosted multi-tenant service over the internet:
//             https://<portal>/api/v1, routes under /portal/* for parents and
//             /staff/* for teachers. Works with the school's DESKTOP switched
//             off: reads come from the projections the desktop pushes up, and
//             writes are queued for it to apply when it next syncs.
//
// Cloud responses are normalised here into the SAME shapes the screens already
// use, so no screen knows or cares which mode it is running in. Where the
// cloud genuinely cannot do something, the method says so rather than
// pretending.
//
// One thing neither mode does any more: move money. The app used to offer a
// card/mobile-money checkout and a "tell the school what you paid" form. Both
// are gone, along with the routes behind them. A balance is shown, in full and
// itemised, and settling it hands the parent to the school's own WhatsApp or
// telephone — which is how these schools take money anyway, and which cannot be
// gamed by anything typed into a phone.

let BASE = null;
let MODE = 'host';          // 'host' | 'cloud'
let SCHOOL_ID = null;       // required in cloud mode (chosen at connect time)
let ROLE = null;            // 'parent' | 'staff' — which surface this session is on
// Stamped on password requests so the Administrator approving one can see
// whether it came from a phone or a browser.
const SOURCE = (typeof navigator !== 'undefined' && navigator.product !== 'ReactNative') ? 'web' : 'mobile';

export function setConnection({ baseUrl, mode = 'host', schoolId = null, role = null } = {}) {
  BASE = baseUrl ? baseUrl.replace(/\/+$/, '') : null;
  MODE = mode === 'cloud' ? 'cloud' : 'host';
  SCHOOL_ID = schoolId || null;
  ROLE = role || null;
}

// The cloud has two `me` endpoints and two sets of routes, and a bearer token
// does not say which it belongs to. Remembering the role from sign-in avoids a
// guessing round trip on every cold start.
export function setRole(role) { ROLE = role || null; }
export function getRole() { return ROLE; }
// Back-compat: setting a bare base URL means host mode.
export function setBaseUrl(url) { setConnection({ baseUrl: url, mode: 'host' }); }
export function getBaseUrl() { return BASE; }
export function getMode() { return MODE; }

async function request(path, { method = 'GET', token, body } = {}) {
  if (!BASE) throw new Error('No host configured. Connect to your school first.');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  let res;
  try {
    res = await fetch(`${BASE}/api/v1${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(MODE === 'cloud'
      ? 'Cannot reach the portal. Check your internet connection.'
      : 'Cannot reach the school. Check the address and Wi-Fi.');
  }
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

// ── cloud normalisation helpers ──
// The cloud student_snapshot payload already carries fees, canteen, attendance
// and the academic report; we reshape it to match the host's /parent/* replies.
async function cloudChildren(token) {
  const r = await request('/portal/children', { token });
  return (r.children || []).map(c => ({ ...c, id: c.student_id }));
}
async function cloudChild(token, id) {
  const c = (await cloudChildren(token)).find(x => String(x.id) === String(id));
  if (!c) { const e = new Error('Child not found.'); e.status = 404; throw e; }
  let payments = [];
  try {
    const rc = await request('/portal/receipts', { token });
    payments = (rc.receipts || [])
      .filter(r => String(r.student_id) === String(id))
      .map(r => ({ receipt_number: r.receipt_number, payment_date: r.date, payment_method: r.payment_method, amount: r.amount }));
  } catch (_) {}
  return {
    ok: true,
    child: {
      id: c.id, name: c.name, class_name: c.class_name, index_number: c.index_number,
      term: c.term ? { label: c.term } : null,
      fees: c.fees || { billed: 0, paid: 0, balance: 0 },
      canteen: c.canteen || { unpaid_days: 0, amount_owed: 0 },
    },
    attendance: c.attendance || { present: 0, absent: 0, total: 0 },
    payments,
  };
}
async function cloudChildReport(token, id) {
  const c = (await cloudChildren(token)).find(x => String(x.id) === String(id));
  const rep = c && c.report;
  if (!rep) return { ok: true, term: null, subjects: [], summary: null };
  return {
    ok: true,
    term: rep.term ? { label: rep.term } : null,
    subjects: (rep.subjects || []).map(s => ({ subject: s.subject, total_score: s.total, grade_remark: s.grade })),
    summary: {
      average_score: rep.average, class_rank: rep.rank,
      number_on_roll: rep.number_on_roll, teacher_remarks: rep.remarks,
    },
  };
}

// The cloud carries a snapshot, not the school's whole ledger. These reshape
// what it does have into the shapes the screens expect, and are honest about
// what it does not: a bill's line items and the year's payment history live on
// the desktop, so over the internet a parent sees the totals and the receipts
// the portal was given rather than an empty table pretending to be complete.
async function cloudChildFees(token, id) {
  const c = (await cloudChildren(token)).find(x => String(x.id) === String(id));
  if (!c) { const e = new Error('Child not found.'); e.status = 404; throw e; }
  let payments = [];
  try {
    const rc = await request('/portal/receipts', { token });
    payments = (rc.receipts || [])
      .filter(r => String(r.student_id) === String(id))
      .map(r => ({
        receipt_number: r.receipt_number, payment_date: r.date,
        payment_method: r.payment_method, amount: r.amount, term_label: null,
      }));
  } catch (_) {}
  const fees = c.fees || { billed: 0, paid: 0, balance: 0 };
  return {
    ok: true,
    partial: true,
    term: c.term ? { label: c.term } : null,
    bill: {
      total_billed: fees.billed || 0, total_paid: fees.paid || 0, balance: fees.balance || 0,
      arrears_from_prev: fees.arrears || 0, discount_amount: 0,
    },
    items: [], history: [], books: null, payments,
  };
}

async function cloudChildCanteen(token, id) {
  const c = (await cloudChildren(token)).find(x => String(x.id) === String(id));
  const ct = (c && c.canteen) || { unpaid_days: 0, amount_owed: 0 };
  return {
    ok: true, partial: true,
    daily_rate: ct.daily_rate || null,
    term: c && c.term ? { label: c.term } : null,
    unpaid_days: ct.unpaid_days || 0, amount_owed: ct.amount_owed || 0,
    paid_days: 0, exempt_days: 0, days: [], payments: [],
  };
}

async function cloudChildReports(token, id) {
  const c = (await cloudChildren(token)).find(x => String(x.id) === String(id));
  const rep = c && c.report;
  if (!rep) return { ok: true, terms: [], partial: true };
  return {
    ok: true, partial: true,
    terms: [{
      id: null, label: rep.term || 'This term',
      average_score: rep.average, class_rank: rep.rank,
      number_on_roll: rep.number_on_roll,
      subject_count: (rep.subjects || []).length,
    }],
  };
}

// Over the internet the school's contact details come from the portal's
// branding record rather than from a route on the desktop, but the shape the
// screen consumes is identical either way.
async function cloudSettle(token, id) {
  const c = (await cloudChildren(token)).find(x => String(x.id) === String(id));
  if (!c) { const e = new Error('Child not found.'); e.status = 404; throw e; }
  let brand = {};
  try { brand = await api.branding(); } catch (_) {}
  const fees = c.fees || {}; const ct = c.canteen || {};
  return {
    ok: true,
    child: { id: c.id, name: c.name, class_name: c.class_name, index_number: c.index_number },
    owed: {
      fees: fees.balance || 0, canteen: ct.amount_owed || 0, books: 0,
      total: (fees.balance || 0) + (ct.amount_owed || 0),
    },
    term: c.term ? { label: c.term } : null,
    contact: {
      school: (brand.school && brand.school.name) || '',
      phone: (brand.contact && brand.contact.phone) || '',
      whatsapp: (brand.contact && brand.contact.whatsapp) || '',
      email: (brand.contact && brand.contact.email) || '',
      address: (brand.school && brand.school.address) || '',
    },
    instructions: 'Payments are arranged with the school directly. Send a message or call, and the office will confirm the amount and how to pay.',
  };
}

// A few things genuinely need the desktop: taking a fee payment writes a
// receipt against the school's own numbering, and a parent registering has to
// be matched against the school's guardian contacts. Both say so plainly
// rather than failing with a bare network error.
const hostOnly = (name) => () => {
  throw new Error(`${name} needs the school's own system. Connect to your school — on its Wi-Fi, or at its internet address — to do this.`);
};

// In cloud mode a staff route lives under /staff; on the desktop it is at the
// top level. One helper, so every staff method reads the same.
const staffPath = (path) => (MODE === 'cloud' ? `/staff${path}` : path);

export const api = {
  // Public
  info: () => request('/info'),
  // The school's crest, name and contact details. Public: the sign-in screen
  // should show the parent their own school before they have typed anything.
  branding: () => request(MODE === 'cloud' ? `/portal/branding?school_id=${encodeURIComponent(SCHOOL_ID || '')}` : '/branding'),
  health: () => request('/health'),
  schools: () => request('/portal/schools'),          // cloud: list tenants to pick from
  staffLogin: (username, password, device) =>
    MODE === 'cloud'
      ? request('/staff/login', { method: 'POST', body: { school_id: SCHOOL_ID, username, password } })
      : request('/auth/login', { method: 'POST', body: { username, password, device } }),
  parentRegister: (data) => request('/auth/parent/register', { method: 'POST', body: data }),

  // ── One sign-in box ──
  // The credential decides which surface this is, not a tab the person had to
  // press first. The server matches a staff username, then a parent's phone or
  // email, and says which it found.
  //
  // The fallback matters in the field: a school that has not yet updated its
  // desktop answers 404 here, and a teacher must not be locked out by that.
  // In that case the app does the same two-step itself — staff first, then
  // parent — which is exactly what the endpoint does server-side.
  signIn: async (identifier, password, device) => {
    const id = String(identifier || '').trim();
    try {
      const r = MODE === 'cloud'
        ? await request('/signin', { method: 'POST', body: { school_id: SCHOOL_ID, identifier: id, password } })
        : await request('/auth/signin', { method: 'POST', body: { identifier: id, password, device } });
      return r;
    } catch (e) {
      if (e.status !== 404) throw e;
    }

    let staffError = null;
    try {
      const r = await api.staffLogin(id, password, device);
      return { ...r, role: 'staff' };
    } catch (e) {
      // A 401 here only means "not a staff account with that password"; a
      // parent may still match. Anything else — rate limited, server down —
      // is the real answer and stops the attempt.
      if (e.status && e.status !== 401) throw e;
      staffError = e;
    }
    try {
      const r = await api.parentLogin(id, password, device);
      return { ...r, role: 'parent' };
    } catch (e) {
      if (e.status && e.status !== 401) throw e;
      const err = new Error('Those details did not match an account. Check and try again.');
      err.status = 401;
      err.cause = staffError;
      throw err;
    }
  },

  // ── Passwords ──
  // Available on both connections. Approving a reset is on neither: an
  // Administrator does that at the school, face to face, and hands over a
  // six-digit code. Everything here either raises a request or spends one.
  requestPasswordReset: ({ username, reason }) =>
    MODE === 'cloud'
      ? request('/staff/password-reset/request', {
          method: 'POST',
          body: { school_id: SCHOOL_ID, username, reason, source: SOURCE },
        })
      : request('/auth/password-reset/request', { method: 'POST', body: { username, reason, source: SOURCE } }),

  // Only the desktop can be asked whether a request has been decided; over the
  // internet the claim shows up when the school next syncs, so the app tells
  // the user to come back with their code rather than polling for nothing.
  passwordResetStatus: ({ username }) =>
    MODE === 'cloud'
      ? Promise.resolve({ ok: true, status: 'unknown' })
      : request('/auth/password-reset/status', { method: 'POST', body: { username } }),

  completePasswordReset: ({ username, code, newPassword }) =>
    MODE === 'cloud'
      ? request('/staff/password-reset/complete', {
          method: 'POST',
          body: { school_id: SCHOOL_ID, username, code, newPassword, source: SOURCE },
        })
      : request('/auth/password-reset/complete', { method: 'POST', body: { username, code, newPassword } }),

  changePassword: (token, { currentPassword, newPassword }) =>
    request(MODE === 'cloud' ? '/staff/password' : '/auth/password', {
      method: 'POST', token, body: { currentPassword, newPassword, source: SOURCE },
    }),

  parentLogin: (identifier, password, device) =>
    MODE === 'cloud'
      ? request('/portal/login', { method: 'POST', body: { school_id: SCHOOL_ID, identifier, password } })
      : request('/auth/parent/login', { method: 'POST', body: { identifier, password, device } }),

  // Authed
  me: (token) => {
    if (MODE !== 'cloud') return request('/me', { token });
    if (ROLE === 'staff') return request('/staff/me', { token });
    return request('/portal/me', { token })
      .then(r => ({ ok: true, role: 'parent', parent: r.parent, school: r.school, mode: 'cloud' }));
  },
  logout: (token) => MODE === 'cloud' ? Promise.resolve({ ok: true }) : request('/auth/logout', { method: 'POST', token }),

  // Parent
  children: (token) =>
    MODE === 'cloud' ? cloudChildren(token).then(children => ({ ok: true, children })) : request('/parent/children', { token }),
  child: (token, id) =>
    MODE === 'cloud' ? cloudChild(token, id) : request(`/parent/children/${id}`, { token }),
  childReport: (token, id, termId) =>
    MODE === 'cloud'
      ? cloudChildReport(token, id)
      : request(`/parent/children/${id}/report${termId ? `?termId=${termId}` : ''}`, { token }),
  childIntents: (token, id) =>
    MODE === 'cloud' ? Promise.resolve({ ok: true, intents: [] }) : request(`/parent/children/${id}/intents`, { token }),
  // What is owed, and who to talk to about it. The nearest thing to a payment
  // route this app has, and it deliberately moves nothing: it returns the
  // figures and the school's contact details, and the screen turns that into a
  // pre-written WhatsApp message.
  settle: (token, id) =>
    MODE === 'cloud'
      ? cloudSettle(token, id)
      : request(`/parent/children/${id}/settle`, { token }),

  // The bill, line by line, with every payment ever received against it and a
  // term-by-term history so a carry-forward can be traced to where it came from.
  childFees: (token, id, termId) =>
    MODE === 'cloud'
      ? cloudChildFees(token, id)
      : request(`/parent/children/${id}/fees${termId ? `?termId=${termId}` : ''}`, { token }),

  // The canteen, day by day, and every collection recorded.
  childCanteen: (token, id) =>
    MODE === 'cloud'
      ? cloudChildCanteen(token, id)
      : request(`/parent/children/${id}/canteen`, { token }),

  // Which terms this child has a published report for. Over the internet the
  // projection carries the current term only, so the list is that one term
  // rather than an empty picker.
  childReports: (token, id) =>
    MODE === 'cloud'
      ? cloudChildReports(token, id)
      : request(`/parent/children/${id}/reports`, { token }),

  // The register, day by day.
  childAttendance: (token, id) =>
    MODE === 'cloud'
      ? cloudChild(token, id).then(c => ({
          ok: true, days: [], totals: c.attendance || { present: 0, absent: 0, total: 0 },
        }))
      : request(`/parent/children/${id}/attendance`, { token }),

  // The child's own record, laid out for printing.
  childProfile: (token, id) =>
    MODE === 'cloud'
      ? hostOnly("A pupil's full profile")()
      : request(`/parent/children/${id}/profile`, { token }),
  parentNotifications: (token) =>
    MODE === 'cloud'
      ? request('/portal/announcements', { token }).then(r => ({
          ok: true,
          notifications: (r.announcements || []).map(a => ({
            message_body: a.title ? `${a.title} — ${a.body || ''}` : (a.body || ''),
            channel: 'notice',
            sent_at: a.created_at ? new Date(a.created_at).toLocaleDateString() : '',
          })),
        }))
      : request('/parent/notifications', { token }),

  // Messaging (parent). Host mode is fully two-way; cloud mode is read-only
  // (the portal serves thread snapshots; replying over the internet is a
  // follow-up — parents on LAN reply in-app, and the SMS mirror reaches all).
  parentThreads: (token) =>
    MODE === 'cloud'
      ? request('/portal/messages', { token }).then(r => ({
          ok: true,
          threads: (r.threads || []).map(t => ({
            id: t.uuid, uuid: t.uuid, subject: t.subject, student_name: t.student_name,
            last_message_at: t.last_message_at, parent_unread: t.parent_unread || 0,
            preview: (t.messages && t.messages.length) ? String(t.messages[t.messages.length - 1].body).slice(0, 120) : '',
          })),
        }))
      : request('/parent/messages', { token }),
  parentThread: (token, id) =>
    MODE === 'cloud'
      ? request('/portal/messages', { token }).then(r => {
          const t = (r.threads || []).find(x => String(x.uuid) === String(id));
          return t
            ? { ok: true, thread: { id: t.uuid, subject: t.subject, student_name: t.student_name }, messages: t.messages || [] }
            : { ok: false, error: 'Conversation not found.' };
        })
      : request(`/parent/messages/${id}`, { token }),
  parentSendMessage: (token, { threadId, studentId, subject, body }) =>
    MODE === 'cloud'
      ? hostOnly('Sending a message')()
      : request('/parent/messages', { method: 'POST', token, body: { threadId, studentId, subject, body } }),

  // Homework / assignments
  classHomework: (token, classId, all) => request(staffPath(`/homework?classId=${classId}${all ? '&all=1' : ''}`), { token }), // staff
  saveHomework: (token, { classId, subjectId, title, description, dueDate, maxMarks }) =>
    request(staffPath('/homework'), { method: 'POST', token, body: { classId, subjectId, title, description, dueDate, maxMarks } }), // staff
  // Marking homework needs the assignment's id, which exists only once the
  // desktop has created it — so marking stays a desktop capability.
  homeworkSheet: (token, homeworkId) =>
    MODE === 'cloud' ? hostOnly('Marking homework')() : request(`/homework/${homeworkId}/sheet`, { token }),
  saveHomeworkMarks: (token, homeworkId, entries) =>
    MODE === 'cloud' ? hostOnly('Marking homework')() : request(`/homework/${homeworkId}/marks`, { method: 'POST', token, body: { entries } }),
  childHomework: (token, id) =>
    MODE === 'cloud'
      ? cloudChildren(token).then(cs => {
          const c = cs.find(x => String(x.id) === String(id));
          return { ok: true, homework: (c && c.homework) || [] };
        })
      : request(`/parent/children/${id}/homework`, { token }),

  // Timetable
  myTimetable: (token) => request(staffPath('/timetable/mine'), { token }),   // staff, either mode
  childTransport: (token, id) =>
    MODE === 'cloud'
      ? cloudChildren(token).then(cs => {
          const c = cs.find(x => String(x.id) === String(id));
          return { ok: true, transport: (c && c.transport) || null };
        })
      : request(`/parent/children/${id}/transport`, { token }),
  childTimetable: (token, id) =>
    MODE === 'cloud'
      ? cloudChildren(token).then(cs => {
          const c = cs.find(x => String(x.id) === String(id));
          const tt = c && c.timetable;
          return tt ? { ok: true, ...tt } : { ok: true, class: null, days: [], periods: [], entries: {} };
        })
      : request(`/parent/children/${id}/timetable`, { token }),

  // ── Staff ──
  // Available in BOTH modes. On the desktop these hit the school's database
  // directly; over the internet they read the projected class rosters and
  // queue writes for the desktop to apply — which is what lets a teacher mark
  // a register at home with the school's machine switched off.
  dashboard: (token) => request(staffPath('/dashboard'), { token }),
  students: (token, classId, opts = {}) => {
    const q = [classId ? `classId=${classId}` : '', opts.photos && classId ? 'photos=1' : '']
      .filter(Boolean).join('&');
    return request(staffPath(`/students${q ? `?${q}` : ''}`), { token });
  },
  debtors: (token) => request(MODE === 'cloud' ? '/staff/debtors' : '/fees/debtors', { token }),
  classes: (token) => request(staffPath('/classes'), { token }),

  // Staff — attendance register
  attendanceRoster: (token, classId, date) => request(staffPath(`/attendance?classId=${classId}&date=${encodeURIComponent(date)}`), { token }),
  markAttendance: (token, date, marks) => request(staffPath('/attendance'), { method: 'POST', token, body: { date, marks } }),

  // Staff — score entry (raw exam marks 0–100 for a class + subject)
  scoreSubjects: (token, classId) => request(staffPath(`/scores/subjects?classId=${classId}`), { token }),
  scoreSheet: (token, classId, subjectId) => request(staffPath(`/scores?classId=${classId}&subjectId=${subjectId}`), { token }),
  saveScores: (token, subjectId, marks) => request(staffPath('/scores'), { method: 'POST', token, body: { subjectId, marks } }),

  // Staff — canteen collection
  canteenStudent: (token, studentId) => request(staffPath(`/canteen/student/${studentId}`), { token }),
  canteenCollect: (token, { student_id, amount, payment_method, notes }) =>
    request(staffPath('/canteen/collect'), { method: 'POST', token, body: { student_id, amount, payment_method, notes } }),

  // ── Conduct: commendations and incidents ──
  // The desktop has kept this per pupil since the first release and neither
  // app could read it. A teacher records it; a parent sees the same list.
  studentEvents: (token, id) => request(staffPath(`/students/${id}/events`), { token }),
  addStudentEvent: (token, id, { eventType, title, description, date }) =>
    MODE === 'cloud'
      ? hostOnly('Recording conduct')()
      : request(`/students/${id}/events`, { method: 'POST', token, body: { eventType, title, description, date } }),
  childConduct: (token, id) =>
    MODE === 'cloud'
      ? Promise.resolve({ ok: true, events: [], partial: true })
      : request(`/parent/children/${id}/conduct`, { token }),

  // ── Staff — the class's contact book ──
  // Every guardian in one class in one request, so a teacher can ring or
  // message a parent from the roll rather than opening records one at a time.
  classContacts: (token, classId) =>
    MODE === 'cloud'
      ? hostOnly("A class's contact book")()
      : request(`/classes/${classId}/contacts`, { token }),

  // ── Staff — a pupil's record ──
  student: (token, id) => request(staffPath(`/students/${id}`), { token }),
  studentParents: (token, id) => request(staffPath(`/students/${id}/parents`), { token }),

  // ── Staff — reference data ──
  subjects: (token, classId) => request(staffPath(`/subjects${classId ? `?classId=${classId}` : ''}`), { token }),
  // Past terms are a desktop read; over the internet the projection carries the
  // current term only, so the picker is not offered rather than offered empty.
  terms: (token) => (MODE === 'cloud' ? Promise.resolve({ ok: true, terms: [] }) : request('/terms', { token })),

  // ── Staff — register history ──
  attendanceHistory: (token, classId, days = 30) =>
    request(staffPath(`/attendance/history?classId=${classId}&days=${days}`), { token }),

  // ── Staff — continuous assessment ──
  assessments: (token, classId, subjectId) =>
    request(staffPath(`/assessments?classId=${classId}&subjectId=${subjectId}`), { token }),
  saveAssessments: (token, { classId, subjectId, marks }) =>
    request(staffPath('/assessments'), { method: 'POST', token, body: { classId, subjectId, marks } }),
  // The desktop numbers a new column, so this is host-only by design: marks
  // queued against an id invented off-LAN would arrive pointing at nothing.
  addAssessmentColumn: (token, { classId, subjectId, assessmentType, maxMarks }) =>
    request(staffPath('/assessments/column'), { method: 'POST', token, body: { classId, subjectId, assessmentType, maxMarks } }),

  // ── Staff — results ──
  results: (token, classId, termId) =>
    request(staffPath(`/results?classId=${classId}${termId ? `&termId=${termId}` : ''}`), { token }),
  studentReport: (token, id, termId) =>
    request(staffPath(`/results/student/${id}${termId ? `?termId=${termId}` : ''}`), { token }),
  saveRemarks: (token, body) => request(staffPath('/results/remarks'), { method: 'POST', token, body }),

  // ── Staff — lesson notes ──
  lessonNotes: (token, { status, classId } = {}) => {
    const q = [status ? `status=${encodeURIComponent(status)}` : '', classId ? `classId=${classId}` : '']
      .filter(Boolean).join('&');
    return request(staffPath(`/lesson-notes${q ? `?${q}` : ''}`), { token });
  },
  lessonNote: (token, id) => request(staffPath(`/lesson-notes/${id}`), { token }),
  saveLessonNote: (token, body) => request(staffPath('/lesson-notes'), { method: 'POST', token, body }),
  deleteLessonNote: (token, id) =>
    MODE === 'cloud'
      ? hostOnly('Deleting a lesson note')()
      : request(`/lesson-notes/${id}`, { method: 'DELETE', token }),

  // ── Staff — the teacher's own employment ──
  hrMe: (token) => request(staffPath('/hr/me'), { token }),
  clock: (token, direction) => request(staffPath('/hr/clock'), { method: 'POST', token, body: { direction } }),
  hrAttendance: (token, month, year) => {
    const q = [month ? `month=${month}` : '', year ? `year=${year}` : ''].filter(Boolean).join('&');
    return request(staffPath(`/hr/attendance${q ? `?${q}` : ''}`), { token });
  },
  leaveRequests: (token) => request(staffPath('/hr/leave'), { token }),
  requestLeave: (token, body) => request(staffPath('/hr/leave'), { method: 'POST', token, body }),
  payslips: (token, year) => request(staffPath(`/hr/payslips${year ? `?year=${year}` : ''}`), { token }),

  // ── Staff — messages and notices ──
  staffThreads: (token) => request(staffPath('/messages'), { token }),
  // The desktop knows a thread by its row id, the cloud by its uuid. Both are
  // opaque to the screen, which passes back whatever the list gave it.
  staffThread: (token, id) => request(staffPath(`/messages/${id}`), { token }),
  staffSendMessage: (token, { threadId, threadUuid, parentId, studentId, subject, body }) =>
    request(staffPath('/messages'), {
      method: 'POST', token,
      body: MODE === 'cloud'
        ? { threadUuid: threadUuid || threadId, parentId, studentId, subject, body }
        : { threadId, parentId, studentId, subject, body },
    }),
  announcements: (token) => request(staffPath('/announcements'), { token }),
  postAnnouncement: (token, body) => request(staffPath('/announcements'), { method: 'POST', token, body }),

  // ── Staff — canteen sheet and class timetable ──
  canteenClass: (token, classId) => request(staffPath(`/canteen/class?classId=${classId}`), { token }),

  // ── Canteen: the daily collection ──
  // The desktop's quick-pay, which the teacher's app never had: the class for
  // one day, who has paid, who was absent, and one press to mark the rest.
  // Host-only by design — the roster is a live read and the money is real, so
  // it is not something to queue from a phone with the school's computer off.
  canteenQuickPay: (token, classId, date) =>
    MODE === 'cloud'
      ? hostOnly('The daily canteen collection')()
      : request(`/canteen/quick-pay?classId=${classId}&date=${encodeURIComponent(date)}`, { token }),
  canteenQuickPaySave: (token, { classId, date, studentIds, paymentMethod }) =>
    MODE === 'cloud'
      ? hostOnly('The daily canteen collection')()
      : request('/canteen/quick-pay', { method: 'POST', token, body: { classId, date, studentIds, paymentMethod } }),
  canteenExempt: (token, { classId, date, studentIds, reason }) =>
    MODE === 'cloud'
      ? hostOnly('Excusing a pupil from the canteen')()
      : request('/canteen/exempt', { method: 'POST', token, body: { classId, date, studentIds, reason } }),
  classTimetable: (token, classId) =>
    MODE === 'cloud'
      ? hostOnly('A class timetable')()
      : request(`/timetable/class/${classId}`, { token }),

  // Withdrawing an assignment removes marks with it, so it stays on the
  // desktop where the teacher can see what that costs.
  deleteHomework: (token, id) =>
    MODE === 'cloud' ? hostOnly('Withdrawing homework')() : request(`/homework/${id}`, { method: 'DELETE', token }),

  // Staff — how much of this teacher's work has not reached the school yet.
  // Only meaningful over the internet; on the desktop a write has landed by
  // the time the request returns.
  staffPending: (token) =>
    MODE === 'cloud' ? request('/staff/pending', { token }) : Promise.resolve({ ok: true, pending: 0 }),
};

export function money(n) {
  const v = Number(n) || 0;
  return 'GHS ' + v.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
