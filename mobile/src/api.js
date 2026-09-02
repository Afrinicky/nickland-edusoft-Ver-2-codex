// Nickland Edusoft mobile — API client
//
// Two connection modes, one method surface:
//   • host  — talks to a school's DESKTOP, over the school Wi-Fi or a tunnel:
//             http(s)://<address>/api/v1, routes under /auth/*, /parent/* and
//             the staff routes. Everything, including taking payments, and it
//             works with the internet down.
//   • cloud — talks to the hosted multi-tenant service over the internet:
//             https://<portal>/api/v1, routes under /portal/* for parents and
//             /staff/* for teachers. Works with the school's DESKTOP switched
//             off: reads come from the projections the desktop pushes up, and
//             writes are queued for it to apply when it next syncs.
//
// Cloud responses are normalised here into the SAME shapes the screens already
// use, so no screen knows or cares which mode it is running in. Where the
// cloud genuinely cannot do something — taking a fee payment, which needs the
// desktop's own receipt numbering — the method says so rather than pretending.

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
  childReport: (token, id) =>
    MODE === 'cloud' ? cloudChildReport(token, id) : request(`/parent/children/${id}/report`, { token }),
  childIntents: (token, id) =>
    MODE === 'cloud' ? Promise.resolve({ ok: true, intents: [] }) : request(`/parent/children/${id}/intents`, { token }),
  // Payments are a host/tunnel capability (the cloud is read-only). The child
  // screen hides these controls in cloud mode; guard here as a backstop.
  pay: (token, id, opts) =>
    MODE === 'cloud' ? hostOnly('Making a payment')() : request(`/parent/children/${id}/pay`, { method: 'POST', token, body: opts }),
  payOnline: (token, id, { amount, email }) =>
    MODE === 'cloud' ? hostOnly('Online payment')() : request(`/parent/children/${id}/pay/online`, { method: 'POST', token, body: { amount, email } }),
  verifyPayment: (token, reference) =>
    MODE === 'cloud' ? hostOnly('Payment verification')() : request(`/parent/pay/verify/${encodeURIComponent(reference)}`, { token }),
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
  students: (token, classId) => request(staffPath(`/students${classId ? `?classId=${classId}` : ''}`), { token }),
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
