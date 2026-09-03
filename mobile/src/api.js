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
//   • online — talks to the ONLINE SCHOOL: https://<service>/api/v1/school/*,
//             which holds the whole school in Postgres rather than a
//             projection of it. Everything the desktop does, with nothing
//             queued and nothing waiting for a sync, and access control a
//             level stricter than the desktop's. This is the mode the finance,
//             administration and system portals need, because a summary cannot
//             take a payment.
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
let MODE = 'host';          // 'host' | 'cloud' | 'online'
let SCHOOL_ID = null;       // required in cloud mode (chosen at connect time)
let ROLE = null;            // 'parent' | 'staff' — which surface this session is on
// Stamped on password requests so the Administrator approving one can see
// whether it came from a phone or a browser.
const SOURCE = (typeof navigator !== 'undefined' && navigator.product !== 'ReactNative') ? 'web' : 'mobile';

export function setConnection({ baseUrl, mode = 'host', schoolId = null, role = null } = {}) {
  BASE = baseUrl ? baseUrl.replace(/\/+$/, '') : null;
  MODE = ['cloud', 'online'].includes(mode) ? mode : 'host';
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

// A printable document, fetched as the HTML the desktop's own report generator
// produced. Not JSON: the caller hands the string straight to the printer.
async function requestHtml(path, { token } = {}) {
  if (!BASE) throw new Error('No host configured. Connect to your school first.');
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let res;
  try { res = await fetch(`${BASE}/api/v1${path}`, { headers }); }
  catch (e) { throw new Error("Cannot reach the school. Check the address and Wi-Fi."); }
  const text = await res.text();
  if (!res.ok) {
    let msg = `Could not fetch the document (${res.status}).`;
    try { const j = JSON.parse(text); if (j && j.error) msg = j.error; } catch (_) {}
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return text;
}

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

// Query strings, built once. Empty values are dropped rather than sent as
// `classId=undefined`, which a server has to defend against and a client
// should not produce.
function qs(params) {
  const pairs = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
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
  const err = new Error(`${name} needs the school's own system. Connect to your school — on its Wi-Fi, or at its internet address — to do this.`);
  // Tagged, so a screen can say "not from here" rather than showing a failure.
  // The same flag the online school sets on a 400 it answers `host_only`, so
  // one branch in the UI covers both.
  err.hostOnly = true;
  throw err;
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

  // ── Printable documents ──
  // The school's own report card and profile sheet, built by the desktop's
  // report generator and printed verbatim. The app deliberately has no
  // template of its own: a school that hands out two documents with the same
  // title and different layouts has a problem no feature makes up for.
  //
  // Host-only, and it says so. The projection the internet portal carries has
  // no crest, no signatures and no grading scale, so a report card built from
  // it would be a different document wearing the same name.
  reportCardDocument: (token, studentId, termId) =>
    MODE === 'cloud'
      ? hostOnly('Printing a report card')()
      : requestHtml(`/results/student/${studentId}/report.html${termId ? `?termId=${termId}` : ''}`, { token }),
  studentProfileDocument: (token, studentId) =>
    MODE === 'cloud'
      ? hostOnly('Printing a pupil profile')()
      : requestHtml(`/students/${studentId}/profile.html`, { token }),
  childReportDocument: (token, childId, termId) =>
    MODE === 'cloud'
      ? hostOnly('Printing a report card')()
      : requestHtml(`/parent/children/${childId}/report.html${termId ? `?termId=${termId}` : ''}`, { token }),
  childProfileDocument: (token, childId) =>
    MODE === 'cloud'
      ? hostOnly('Printing a profile')()
      : requestHtml(`/parent/children/${childId}/profile.html`, { token }),

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

  // ── The office, in whichever mode this session is in ──────────────────────
  //
  // Three surfaces answer these, and they are not equal, so the app does not
  // pretend they are:
  //
  //   host   the school's own system on the school Wi-Fi — everything, live.
  //   online the online school — everything, live, from anywhere.
  //   cloud  the thin projection — the figures, and the two approvals that
  //          move no money. Anything else answers `host_only`, which the
  //          screens turn into "the school's own system does this" rather
  //          than an error.
  //
  // One method per thing, dispatching once here, so a screen never asks which
  // mode it is in.
  financeOverview: (token) =>
    MODE === 'cloud' ? request('/staff/finance/overview', { token })
                     : request('/finance/overview', { token }),
  financeDebtors: (token, classId) =>
    MODE === 'cloud' ? request('/staff/finance/debtors', { token })
                     : request(`/finance/debtors${classId ? `?classId=${classId}` : ''}`, { token }),
  financeCollections: (token, q = {}) =>
    MODE === 'cloud' ? hostOnly('The day’s collections')()
                     : request(`/finance/collections${qs(q)}`, { token }),
  financeTakePayment: (token, body) =>
    MODE === 'cloud' ? hostOnly('Taking a payment')()
                     : request('/finance/collections', { method: 'POST', token, body }),
  financeReverse: (token, id, reason) =>
    MODE === 'cloud' ? hostOnly('Reversing a payment')()
                     : request(`/finance/collections/${id}/reverse`, { method: 'POST', token, body: { reason } }),
  financeStudents: (token, q = {}) =>
    MODE === 'cloud' ? hostOnly('Searching for a pupil’s account')()
                     : request(`/finance/students${qs(q)}`, { token }),
  financeStudentBill: (token, id, termId) =>
    MODE === 'cloud' ? hostOnly('A pupil’s account')()
                     : request(`/finance/students/${id}/bill${termId ? `?termId=${termId}` : ''}`, { token }),
  financeIncome: (token, q = {}) =>
    MODE === 'cloud' ? hostOnly('The income ledger')() : request(`/finance/income${qs(q)}`, { token }),
  financeExpenses: (token, q = {}) =>
    MODE === 'cloud' ? hostOnly('The expenditure ledger')() : request(`/finance/expenses${qs(q)}`, { token }),
  financeRecordExpense: (token, body) =>
    MODE === 'cloud' ? hostOnly('Recording an expense')()
                     : request('/finance/expenses', { method: 'POST', token, body }),
  financeStatement: (token, q = {}) =>
    MODE === 'cloud' ? hostOnly('The financial statement')() : request(`/finance/statement${qs(q)}`, { token }),
  financePayroll: (token, month, year) =>
    MODE === 'cloud' ? hostOnly('Payroll')()
                     : request(`/finance/payroll${qs({ month, year })}`, { token }),
  financeOnline: (token, status) =>
    MODE === 'cloud' ? hostOnly('Payments taken online')()
                     : request(`/finance/online${qs({ status })}`, { token }),
  financeAcknowledge: (token, id, method) =>
    MODE === 'cloud' ? hostOnly('Confirming a payment')()
                     : request(`/finance/online/${id}/acknowledge`, { method: 'POST', token, body: { method } }),
  financeReject: (token, id, reason) =>
    MODE === 'cloud' ? hostOnly('Rejecting a payment')()
                     : request(`/finance/online/${id}/reject`, { method: 'POST', token, body: { reason } }),

  adminOverview: (token) =>
    MODE === 'cloud' ? request('/staff/admin/overview', { token })
                     : request('/admin/overview', { token }),
  adminStudents: (token, q = {}) =>
    MODE === 'cloud' ? hostOnly('The whole roll')() : request(`/admin/students${qs(q)}`, { token }),
  adminAdmit: (token, body) =>
    MODE === 'cloud' ? hostOnly('Admitting a pupil')()
                     : request('/admin/students', { method: 'POST', token, body }),
  adminStudentStatus: (token, id, status, reason) =>
    MODE === 'cloud' ? hostOnly('Changing a pupil’s status')()
                     : request(`/admin/students/${id}/status`, { method: 'POST', token, body: { status, reason } }),
  adminStaff: (token, status) =>
    MODE === 'cloud' ? hostOnly('The staff register')()
                     : request(`/admin/staff${qs({ status })}`, { token }),
  adminStaffMember: (token, id) =>
    MODE === 'cloud' ? hostOnly('A staff record')() : request(`/admin/staff/${id}`, { token }),
  adminApprovals: (token) =>
    MODE === 'cloud' ? request('/staff/admin/approvals', { token })
                     : Promise.all([
                         request('/admin/leave?status=pending', { token }).catch(() => ({ requests: [] })),
                         request('/admin/lesson-notes?status=submitted', { token }).catch(() => ({ notes: [] })),
                       ]).then(([leave, notes]) => ({
                         ok: true, leave: leave.requests || [], lesson_notes: notes.notes || [],
                         may_decide: { leave: !!leave.may_decide, lesson_notes: !!notes.may_decide },
                       })),
  adminDecideLeave: (token, id, decision, notes) =>
    MODE === 'cloud'
      ? request('/staff/admin/leave/decision', { method: 'POST', token, body: { id, decision, notes } })
      : request(`/admin/leave/${id}/decision`, { method: 'POST', token, body: { decision, notes } }),
  adminDecideNote: (token, id, decision, comments) =>
    MODE === 'cloud'
      ? request('/staff/admin/lesson-note/decision', { method: 'POST', token, body: { id, decision, notes: comments } })
      : request(`/admin/lesson-notes/${id}/decision`, { method: 'POST', token, body: { decision, comments } }),
  adminAcademics: (token, termId) =>
    MODE === 'cloud' ? hostOnly('Academic oversight')()
                     : request(`/admin/academics${qs({ termId })}`, { token }),

  // The system portal is not served over the internet at all, by design:
  // accounts, access and the audit trail are administered where the system is.
  systemOverview: (token) =>
    MODE === 'cloud' ? hostOnly('The system')() : request('/system/overview', { token }),
  systemUsers: (token) =>
    MODE === 'cloud' ? hostOnly('User accounts')() : request('/system/users', { token }),
  systemCreateUser: (token, body) =>
    MODE === 'cloud' ? hostOnly('Creating an account')()
                     : request('/system/users', { method: 'POST', token, body }),
  systemUserStatus: (token, id, active) =>
    MODE === 'cloud' ? hostOnly('Changing an account')()
                     : request(`/system/users/${id}/status`, { method: 'POST', token, body: { active } }),
  systemUserRole: (token, id, designationId) =>
    MODE === 'cloud' ? hostOnly('Changing a role')()
                     : request(`/system/users/${id}/role`, { method: 'POST', token, body: { designationId } }),
  systemAccess: (token) =>
    MODE === 'cloud' ? hostOnly('Access levels')() : request('/system/access', { token }),
  systemSetAccess: (token, designationId, levels) =>
    MODE === 'cloud' ? hostOnly('Changing access')()
                     : request('/system/access', { method: 'POST', token, body: { designationId, levels } }),
  systemAudit: (token, q = {}) =>
    MODE === 'cloud' ? hostOnly('The audit trail')() : request(`/system/audit${qs(q)}`, { token }),
  systemSettings: (token) =>
    MODE === 'cloud' ? hostOnly('School settings')() : request('/system/settings', { token }),
  systemSaveSettings: (token, settings) =>
    MODE === 'cloud' ? hostOnly('Changing a setting')()
                     : request('/system/settings', { method: 'POST', token, body: { settings } }),

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

/**
 * The name a person is greeted by.
 *
 * "Good morning, Mr Kwabena Owusu" is a letter from a bank. Titles are dropped
 * first, because "Hi, Mrs" — which is what taking the first word gives you for
 * "Mrs Akua Mensah" — is worse than not greeting anybody at all.
 */
export function firstName(full, fallback = 'there') {
  const cleaned = String(full || '')
    .replace(/^((mr|mrs|miss|ms|dr|prof|rev|sr|fr|hon)\.?\s+)+/i, '')
    .trim();
  const first = cleaned.split(/\s+/).filter(Boolean)[0];
  return first || fallback;
}


// ── the online school ───────────────────────────────────────────────────────
//
// A separate surface, deliberately. `host` and `cloud` grew up around a teacher
// and a parent; the online school is the whole system, and mapping its finance
// and administration routes onto shapes invented for a projection would mean
// pretending a summary is a ledger.
//
// The token carries the school on the front of it — `<school_id>.<token>` — so
// one credential names both the tenant and the session, and there is no header
// a client can forget.

const SCHOOL = '/api/v1/school';

async function schoolRequest(path, { method = 'GET', token, body, query } = {}) {
  if (!BASE) throw new Error('No school configured. Connect first.');
  const qs = query
    ? '?' + Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : '';
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  let res;
  try {
    res = await fetch(`${BASE}${SCHOOL}${path}${qs}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('Cannot reach the school. Check your internet connection.');
  }
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status; err.data = data;
    // A route that exists but is not served from here says so, and the screen
    // can explain rather than showing a failure.
    err.hostOnly = !!(data && data.host_only);
    throw err;
  }
  return data;
}

export const school = {
  // ── the session ──
  signIn: (schoolId, username, password) =>
    schoolRequest('/signin', { method: 'POST', body: { school_id: schoolId, username, password } }),
  me: (token) => schoolRequest('/me', { token }),
  changePassword: (token, currentPassword, newPassword) =>
    schoolRequest('/password', { method: 'POST', token,
      body: { current_password: currentPassword, new_password: newPassword } }),
  signOut: (token) => schoolRequest('/signout', { method: 'POST', token }),

  // ── shared ──
  overview: (token) => schoolRequest('/overview', { token }),
  classes: (token) => schoolRequest('/classes', { token }),
  terms: (token) => schoolRequest('/terms', { token }),

  // ── finance ──
  feesOverview: (token) => schoolRequest('/fees/overview', { token }),
  collections: (token, query) => schoolRequest('/fees/collections', { token, query }),
  takePayment: (token, body) => schoolRequest('/fees/collections', { method: 'POST', token, body }),
  reversePayment: (token, id, reason) =>
    schoolRequest(`/fees/collections/${id}/reverse`, { method: 'POST', token, body: { reason } }),
  studentAccount: (token, id, termId) =>
    schoolRequest(`/fees/students/${id}`, { token, query: { termId } }),
  debtors: (token, query) => schoolRequest('/fees/debtors', { token, query }),
  feeTemplates: (token) => schoolRequest('/fees/templates', { token }),
  saveFeeTemplate: (token, body) => schoolRequest('/fees/templates', { method: 'POST', token, body }),
  raiseBills: (token, body) => schoolRequest('/fees/bills', { method: 'POST', token, body }),
  onlinePayments: (token, status) => schoolRequest('/fees/online', { token, query: { status } }),
  acknowledgeIntent: (token, id, method) =>
    schoolRequest(`/fees/online/${id}/acknowledge`, { method: 'POST', token, body: { method } }),
  rejectIntent: (token, id, reason) =>
    schoolRequest(`/fees/online/${id}/reject`, { method: 'POST', token, body: { reason } }),
  verifyIntent: (token, id) => schoolRequest(`/fees/online/${id}/verify`, { method: 'POST', token }),

  income: (token, query) => schoolRequest('/finance/income', { token, query }),
  recordIncome: (token, body) => schoolRequest('/finance/income', { method: 'POST', token, body }),
  expenses: (token, query) => schoolRequest('/finance/expenses', { token, query }),
  recordExpense: (token, body) => schoolRequest('/finance/expenses', { method: 'POST', token, body }),
  approveExpense: (token, id) =>
    schoolRequest(`/finance/expenses/${id}/approve`, { method: 'POST', token }),
  statement: (token, query) => schoolRequest('/finance/statement', { token, query }),
  financeAudit: (token, termId) => schoolRequest('/finance/audit', { token, query: { termId } }),

  payroll: (token, month, year) => schoolRequest('/payroll', { token, query: { month, year } }),
  runPayroll: (token, month, year) =>
    schoolRequest('/payroll/run', { method: 'POST', token, body: { month, year } }),
  markSalaryPaid: (token, id, body) =>
    schoolRequest(`/payroll/${id}/paid`, { method: 'POST', token, body }),
  payslip: (token, staffId, month, year) =>
    schoolRequest(`/payroll/${staffId}/payslip`, { token, query: { month, year } }),
  schedule: (token, kind, month, year) =>
    schoolRequest(`/payroll/schedule/${kind}`, { token, query: { month, year } }),

  inventory: (token, query) => schoolRequest('/inventory', { token, query }),
  saveItem: (token, body) => schoolRequest('/inventory', { method: 'POST', token, body }),
  moveStock: (token, body) => schoolRequest('/inventory/movement', { method: 'POST', token, body }),

  // ── administration ──
  students: (token, query) => schoolRequest('/students', { token, query }),
  student: (token, id) => schoolRequest(`/students/${id}`, { token }),
  admitStudent: (token, body) => schoolRequest('/students', { method: 'POST', token, body }),
  updateStudent: (token, id, body) => schoolRequest(`/students/${id}`, { method: 'POST', token, body }),
  studentStatus: (token, id, status, reason) =>
    schoolRequest(`/students/${id}/status`, { method: 'POST', token, body: { status, reason } }),

  staff: (token, status) => schoolRequest('/staff', { token, query: { status } }),
  staffMember: (token, id) => schoolRequest(`/staff/${id}`, { token }),
  saveStaff: (token, body) => schoolRequest('/staff', { method: 'POST', token, body }),
  setAssignments: (token, id, assignments) =>
    schoolRequest(`/staff/${id}/assignments`, { method: 'POST', token, body: { assignments } }),

  leave: (token, status) => schoolRequest('/leave', { token, query: { status } }),
  decideLeave: (token, id, decision, notes) =>
    schoolRequest(`/leave/${id}/decision`, { method: 'POST', token, body: { decision, notes } }),
  lessonNotes: (token, query) => schoolRequest('/lesson-notes', { token, query }),
  decideLessonNote: (token, id, decision, comments) =>
    schoolRequest(`/lesson-notes/${id}/decision`, { method: 'POST', token, body: { decision, comments } }),

  academicOverview: (token, termId) => schoolRequest('/admin/academics', { token, query: { termId } }),
  announcements: (token) => schoolRequest('/announcements', { token }),
  postAnnouncement: (token, body) => schoolRequest('/announcements', { method: 'POST', token, body }),

  // ── the system ──
  systemOverview: (token) => schoolRequest('/system/overview', { token }),
  users: (token) => schoolRequest('/system/users', { token }),
  createUser: (token, body) => schoolRequest('/system/users', { method: 'POST', token, body }),
  setUserStatus: (token, id, active) =>
    schoolRequest(`/system/users/${id}/status`, { method: 'POST', token, body: { active } }),
  setUserRole: (token, id, designationId) =>
    schoolRequest(`/system/users/${id}/role`, { method: 'POST', token, body: { designation_id: designationId } }),
  resetUserPassword: (token, id, password) =>
    schoolRequest(`/system/users/${id}/password`, { method: 'POST', token, body: { password } }),
  accessMatrix: (token) => schoolRequest('/system/access', { token }),
  setAccess: (token, designationId, levels) =>
    schoolRequest('/system/access', { method: 'POST', token, body: { designation_id: designationId, levels } }),
  auditTrail: (token, query) => schoolRequest('/system/audit', { token, query }),
  settings: (token) => schoolRequest('/system/settings', { token }),
  saveSettings: (token, settings) =>
    schoolRequest('/system/settings', { method: 'POST', token, body: { settings } }),

  // ── a person's own record, in every portal ──
  myEmployment: (token, year) => schoolRequest('/my/employment', { token, query: { year } }),
  clock: (token, direction) => schoolRequest('/my/clock', { method: 'POST', token, body: { direction } }),
  requestLeave: (token, body) => schoolRequest('/my/leave', { method: 'POST', token, body }),
};
