// Nickland Edusoft mobile — API client
//
// Two connection modes, one method surface:
//   • host  — talks to a school's DESKTOP over LAN (or a tunnel):
//             http://<ip>:4747/api/v1, routes under /auth/* /parent/* /staff-*.
//             Full parent + staff features, including payments.
//   • cloud — talks to the hosted multi-tenant PORTAL over the internet:
//             https://<portal>/api/v1, routes under /portal/*. Parent-only,
//             read + notices (the cloud is a thin read model). Cloud responses
//             are normalised here into the SAME shapes the screens already use,
//             so the parent screens work unchanged in either mode.

let BASE = null;
let MODE = 'host';          // 'host' | 'cloud'
let SCHOOL_ID = null;       // required in cloud mode (chosen at connect time)

export function setConnection({ baseUrl, mode = 'host', schoolId = null } = {}) {
  BASE = baseUrl ? baseUrl.replace(/\/+$/, '') : null;
  MODE = mode === 'cloud' ? 'cloud' : 'host';
  SCHOOL_ID = schoolId || null;
}
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

const hostOnly = (name) => () => { throw new Error(`${name} is not available over the internet. Connect on the school Wi-Fi to do this.`); };

export const api = {
  // Public
  info: () => request('/info'),
  health: () => request('/health'),
  schools: () => request('/portal/schools'),          // cloud: list tenants to pick from
  staffLogin: (username, password, device) => request('/auth/login', { method: 'POST', body: { username, password, device } }),
  parentRegister: (data) => request('/auth/parent/register', { method: 'POST', body: data }),

  parentLogin: (identifier, password, device) =>
    MODE === 'cloud'
      ? request('/portal/login', { method: 'POST', body: { school_id: SCHOOL_ID, identifier, password } })
      : request('/auth/parent/login', { method: 'POST', body: { identifier, password, device } }),

  // Authed
  me: (token) =>
    MODE === 'cloud'
      ? request('/portal/me', { token }).then(r => ({ ok: true, role: 'parent', parent: r.parent, school: r.school, mode: 'cloud' }))
      : request('/me', { token }),
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
  classHomework: (token, classId, all) => request(`/homework?classId=${classId}${all ? '&all=1' : ''}`, { token }), // staff
  saveHomework: (token, { classId, subjectId, title, description, dueDate, maxMarks }) =>
    request('/homework', { method: 'POST', token, body: { classId, subjectId, title, description, dueDate, maxMarks } }), // staff
  homeworkSheet: (token, homeworkId) => request(`/homework/${homeworkId}/sheet`, { token }),                        // staff
  saveHomeworkMarks: (token, homeworkId, entries) =>
    request(`/homework/${homeworkId}/marks`, { method: 'POST', token, body: { entries } }),                         // staff
  childHomework: (token, id) =>
    MODE === 'cloud'
      ? cloudChildren(token).then(cs => {
          const c = cs.find(x => String(x.id) === String(id));
          return { ok: true, homework: (c && c.homework) || [] };
        })
      : request(`/parent/children/${id}/homework`, { token }),

  // Timetable
  myTimetable: (token) => request('/timetable/mine', { token }),   // staff (host)
  childTimetable: (token, id) =>
    MODE === 'cloud'
      ? cloudChildren(token).then(cs => {
          const c = cs.find(x => String(x.id) === String(id));
          const tt = c && c.timetable;
          return tt ? { ok: true, ...tt } : { ok: true, class: null, days: [], periods: [], entries: {} };
        })
      : request(`/parent/children/${id}/timetable`, { token }),

  // Staff (host only)
  dashboard: (token) => request('/dashboard', { token }),
  students: (token, classId) => request(`/students${classId ? `?classId=${classId}` : ''}`, { token }),
  debtors: (token) => request('/fees/debtors', { token }),
  classes: (token) => request('/classes', { token }),

  // Staff — attendance register
  attendanceRoster: (token, classId, date) => request(`/attendance?classId=${classId}&date=${encodeURIComponent(date)}`, { token }),
  markAttendance: (token, date, marks) => request('/attendance', { method: 'POST', token, body: { date, marks } }),

  // Staff — score entry (raw exam marks 0–100 for a class + subject)
  scoreSubjects: (token, classId) => request(`/scores/subjects?classId=${classId}`, { token }),
  scoreSheet: (token, classId, subjectId) => request(`/scores?classId=${classId}&subjectId=${subjectId}`, { token }),
  saveScores: (token, subjectId, marks) => request('/scores', { method: 'POST', token, body: { subjectId, marks } }),

  // Staff — canteen collection
  canteenStudent: (token, studentId) => request(`/canteen/student/${studentId}`, { token }),
  canteenCollect: (token, { student_id, amount, payment_method, notes }) =>
    request('/canteen/collect', { method: 'POST', token, body: { student_id, amount, payment_method, notes } }),
};

export function money(n) {
  const v = Number(n) || 0;
  return 'GHS ' + v.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
