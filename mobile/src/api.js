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
