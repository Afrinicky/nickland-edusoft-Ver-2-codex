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
// Stamped on password requests so the Super Admin approving one can see
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
/**
 * Where a teaching route lives, in whichever mode this session is in.
 *
 *   host    /api/v1/<path>              the school's own system
 *   cloud   /api/v1/staff/<path>        the thin portal's staff surface
 *   online  /api/v1/school/<path>       the online school
 *
 * The online case was missing, and its absence was not visible from any one
 * screen: every teaching call — the register, the mark sheets, the results,
 * homework, messages — asked the online service for a path only the desktop
 * serves, and got a 404 that read as "no data". The paths themselves are the
 * same on both, deliberately; the handful that are not are dispatched
 * individually below and say so where they are.
 */
const staffPath = (path) =>
  (MODE === 'cloud' ? `/staff${path}` : MODE === 'online' ? `/school${path}` : path);

export const api = {
  // Public
  info: () => request('/info'),

  // ── One sign-in box, whichever surface this is ────────────────────────────
  // Nobody at a school gate answers "are you a parent or a member of staff?".
  // The credential decides: a staff username is tried first, then a parent's
  // phone or email, and the reply says which surface the account belongs to.
  // A match ends it, so an account is never authenticated twice against two
  // different passwords.
  //
  // In `online` mode those are two different services, so the app does the
  // ordering the other two modes do on the server.
  async onlineSignIn(schoolId, identifier, password) {
    try {
      const staff = await school.signIn(schoolId, identifier, password);
      if (staff && staff.ok) return { ...staff, role: 'staff' };
    } catch (e) {
      // 401 means "not a staff account with that password" — try the parents.
      // Anything else is a real failure and should not be masked by a second
      // attempt against a different table.
      if (e.status && e.status !== 401) throw e;
    }
    const parent = await schoolRequest('/parent/signin', {
      method: 'POST', body: { school_id: schoolId, identifier, password },
    });
    return { ...parent, role: 'parent' };
  },
  // The school's crest, name and contact details. Public: the sign-in screen
  // should show the parent their own school before they have typed anything.
  branding: () => {
    // Three modes, three places the same answer lives. `online` was reaching
    // for the desktop's route, which that service does not serve, so every
    // browser on the online school fell through to /info and drew a school
    // with no crest and no colours.
    if (MODE === 'cloud') return request(`/portal/branding?school_id=${encodeURIComponent(SCHOOL_ID || '')}`);
    if (MODE === 'online') return request(`/school/branding?school_id=${encodeURIComponent(SCHOOL_ID || '')}`);
    return request('/branding');
  },
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
    // The online school is two services behind one box; `onlineSignIn` does
    // the ordering the other two modes do on the server.
    if (MODE === 'online') return api.onlineSignIn(SCHOOL_ID, id, password);
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
  // Super Admin does that at the school, face to face, and hands over a
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
    if (MODE === 'online') {
      return ROLE === 'parent'
        ? schoolRequest('/parent/me', { token })
            .then(r => ({ ...r, role: 'parent', mode: 'online' }))
        : school.me(token).then(r => ({ ...r, mode: 'online' }));
    }
    if (MODE !== 'cloud') return request('/me', { token });
    if (ROLE === 'staff') return request('/staff/me', { token });
    return request('/portal/me', { token })
      .then(r => ({ ok: true, role: 'parent', parent: r.parent, school: r.school, mode: 'cloud' }));
  },
  logout: (token) => {
    if (MODE === 'online') {
      return schoolRequest(ROLE === 'parent' ? '/parent/signout' : '/signout',
        { method: 'POST', token }).catch(() => ({ ok: true }));
    }
    return MODE === 'cloud' ? Promise.resolve({ ok: true })
                            : request('/auth/logout', { method: 'POST', token });
  },

  // ── Parent ────────────────────────────────────────────────────────────────
  // Three surfaces again. `online` reads the school's own database, so a
  // parent sees the same figures the office does rather than a projection of
  // them — including a bill that changed five minutes ago.
  children: (token) =>
    MODE === 'online' ? schoolRequest('/parent/children', { token })
    : MODE === 'cloud' ? cloudChildren(token).then(children => ({ ok: true, children }))
    : request('/parent/children', { token }),
  child: (token, id) =>
    MODE === 'online' ? schoolRequest(`/parent/children/${id}`, { token }).then(r => ({
      ok: true, child: { ...r.child, fees: r.bill || { billed: 0, paid: 0, balance: 0 },
                         term: r.term },
      attendance: (r.attendance || []).reduce((acc, d) => ({
        present: acc.present + (d.status === 'present' ? 1 : 0),
        absent: acc.absent + (d.status === 'absent' ? 1 : 0),
        total: acc.total + 1,
      }), { present: 0, absent: 0, total: 0 }),
      payments: r.payments || [], items: r.items || [], results: r.results || [],
      conduct: r.conduct || [], homework: r.homework || [],
    }))
    : MODE === 'cloud' ? cloudChild(token, id)
    : request(`/parent/children/${id}`, { token }),

  // Settling a bill. The online school takes payment; the other two say who to
  // talk to, which is what a school with no gateway has always done.
  paymentOptions: (token, id) =>
    MODE === 'online' ? schoolRequest(`/parent/children/${id}/payment-options`, { token })
                      : request(`/parent/children/${id}/payment-options`, { token }),
  startPayment: (token, id, amount) =>
    MODE === 'online' ? schoolRequest(`/parent/children/${id}/pay`, { method: 'POST', token, body: { amount } })
    : MODE === 'cloud' ? request('/portal/pay', { method: 'POST', token, body: { student_id: id, amount } })
    : request(`/parent/children/${id}/pay`, { method: 'POST', token, body: { amount } }),
  paymentStatus: (token, reference) =>
    MODE === 'online' ? schoolRequest(`/parent/payments/${encodeURIComponent(reference)}`, { token })
    : MODE === 'cloud' ? request(`/portal/payments/${encodeURIComponent(reference)}`, { token })
    : request(`/parent/payments/${encodeURIComponent(reference)}`, { token }),
  declarePayment: (token, id, body) =>
    MODE === 'online' ? schoolRequest(`/parent/children/${id}/declare-payment`, { method: 'POST', token, body })
    : MODE === 'cloud' ? request('/portal/declare-payment', { method: 'POST', token, body: { student_id: id, ...body } })
    : request(`/parent/children/${id}/declare-payment`, { method: 'POST', token, body }),
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
  // The online school calls this /overview, and answers a fuller shape: the
  // whole school rather than one teacher's corner of it.
  dashboard: (token) =>
    MODE === 'online' ? school.overview(token) : request(staffPath('/dashboard'), { token }),
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
  // Online, the subjects a class sits and the subjects it is MARKED on are one
  // route; the desktop kept two.
  scoreSubjects: (token, classId) =>
    MODE === 'online' ? school.subjects(token, classId)
                      : request(staffPath(`/scores/subjects?classId=${classId}`), { token }),
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
  // A person's own employment record: /hr/* on the desktop, /my/* online.
  hrMe: (token) =>
    MODE === 'online' ? school.myEmployment(token) : request(staffPath('/hr/me'), { token }),
  clock: (token, direction) =>
    MODE === 'online' ? school.clock(token, direction)
                      : request(staffPath('/hr/clock'), { method: 'POST', token, body: { direction } }),
  hrAttendance: (token, month, year) => {
    const q = [month ? `month=${month}` : '', year ? `year=${year}` : ''].filter(Boolean).join('&');
    return request(staffPath(`/hr/attendance${q ? `?${q}` : ''}`), { token });
  },
  leaveRequests: (token) => request(staffPath('/hr/leave'), { token }),
  requestLeave: (token, body) =>
    MODE === 'online' ? school.requestLeave(token, body)
                      : request(staffPath('/hr/leave'), { method: 'POST', token, body }),
  payslips: (token, year) =>
    MODE === 'online' ? school.myEmployment(token, year)
                      : request(staffPath(`/hr/payslips${year ? `?year=${year}` : ''}`), { token }),

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

  // ── Canteen: the sheet and the daily collection ──
  // The class for one day: who has paid, who was absent, who is behind, and one
  // press to mark the rest. Not served by the thin projection by design — the
  // roster is a live read and the money is real, so it is not something to
  // queue from a phone with the school's computer switched off.
  canteenClass: (token, classId, date) =>
    MODE === 'online' ? school.canteenClass(token, classId, date)
      : MODE === 'cloud' ? hostOnly('The canteen sheet')()
                         : request(`/canteen/class${qs({ classId, date })}`, { token }),
  canteenQuickPay: (token, classId, date) =>
    MODE === 'online' ? school.canteenClass(token, classId, date)
      : MODE === 'cloud' ? hostOnly('The daily canteen collection')()
                         : request(`/canteen/quick-pay${qs({ classId, date })}`, { token }),
  canteenQuickPaySave: (token, { classId, date, studentIds, paymentMethod }) =>
    MODE === 'online'
      ? school.canteenQuickPay(token, { classId, date, studentIds, paymentMethod })
      : MODE === 'cloud' ? hostOnly('The daily canteen collection')()
                         : request('/canteen/quick-pay', { method: 'POST', token, body: { classId, date, studentIds, paymentMethod } }),
  canteenExempt: (token, { classId, date, studentIds, reason }) =>
    MODE === 'online' ? school.canteenExempt(token, { classId, date, studentIds, reason })
      : MODE === 'cloud' ? hostOnly('Excusing a pupil from the canteen')()
                         : request('/canteen/exempt', { method: 'POST', token, body: { classId, date, studentIds, reason } }),
  // ── Billing, and everything that sits on a bill ──────────────────────────
  //
  // Writing what a class is charged, raising it against them, and the discounts
  // and book charges that adjust it. None of this existed in the app at all,
  // which is why a school could take a payment from a phone and could not tell
  // the phone what the payment was against.
  feeTemplates: (token, billType = 'school_fees') =>
    MODE === 'online' ? school.feeTemplates(token, billType)
      : MODE === 'cloud' ? hostOnly('Fee templates')()
                         : request(`/fees/templates${qs({ billType })}`, { token }),

  // ── extra charges, and withdrawing a bill ──
  // Both elevated on every server: raising what every family in a class is
  // asked to pay, and taking a bill out of the school's totals, are not the
  // same question as "may this person take a payment".
  supplementary: (token, termId) =>
    MODE === 'online' ? school.supplementary(token, termId)
      : MODE === 'cloud' ? hostOnly('Extra charges')()
                         : request(`/fees/supplementary${qs({ termId })}`, { token }),
  applySupplementary: (token, body) =>
    MODE === 'online' ? school.applySupplementary(token, body)
      : MODE === 'cloud' ? hostOnly('Applying an extra charge')()
                         : request('/fees/supplementary', { method: 'POST', token, body }),
  removeSupplementary: (token, body) =>
    MODE === 'online' ? school.removeSupplementary(token, body)
      : MODE === 'cloud' ? hostOnly('Withdrawing an extra charge')()
                         : request('/fees/supplementary/remove', { method: 'POST', token, body }),
  voidedBills: (token, q = {}) =>
    MODE === 'online' ? school.voidedBills(token, q)
      : MODE === 'cloud' ? hostOnly('Withdrawn bills')()
                         : request(`/fees/bills/voided${qs(q)}`, { token }),
  voidBill: (token, id, reason) =>
    MODE === 'online' ? school.voidBill(token, id, reason)
      : MODE === 'cloud' ? hostOnly('Withdrawing a bill')()
                         : request(`/fees/bills/${id}/void`, { method: 'POST', token, body: { reason } }),
  restoreBill: (token, id) =>
    MODE === 'online' ? school.restoreBill(token, id)
      : MODE === 'cloud' ? hostOnly('Restoring a bill')()
                         : request(`/fees/bills/${id}/restore`, { method: 'POST', token }),
  feeTemplate: (token, id) =>
    MODE === 'online' ? school.feeTemplate(token, id)
      : MODE === 'cloud' ? hostOnly('A fee template')()
                         : request(`/fees/templates/${id}`, { token }),
  saveFeeTemplate: (token, body) =>
    MODE === 'online' ? school.saveFeeTemplate(token, body)
      : MODE === 'cloud' ? hostOnly('Writing a fee template')()
                         : request('/fees/templates', { method: 'POST', token, body }),
  raiseBills: (token, body) =>
    MODE === 'online' ? school.raiseBills(token, body)
      : MODE === 'cloud' ? hostOnly('Raising bills')()
                         : request('/fees/bills', { method: 'POST', token, body }),
  feeDiscounts: (token, q = {}) =>
    MODE === 'online' ? school.discounts(token, q)
      : MODE === 'cloud' ? hostOnly('Discounts')()
                         : request(`/discounts${qs(q)}`, { token }),
  saveFeeDiscount: (token, body) =>
    MODE === 'online' ? school.saveDiscount(token, body)
      : MODE === 'cloud' ? hostOnly('Granting a discount')()
                         : request('/discounts', { method: 'POST', token, body }),
  studentBooks: (token, studentId) =>
    MODE === 'online' ? school.books(token, studentId)
      : MODE === 'cloud' ? hostOnly('Book charges')()
                         : request(`/books/${studentId}`, { token }),
  saveStudentBooks: (token, studentId, body) =>
    MODE === 'online' ? school.saveBooks(token, studentId, body)
      : MODE === 'cloud' ? hostOnly('Charging for books')()
                         : request(`/books/${studentId}`, { method: 'POST', token, body }),
  bookPayment: (token, studentId, body) =>
    MODE === 'online' ? school.bookPayment(token, studentId, body)
      : MODE === 'cloud' ? hostOnly('A book payment')()
                         : request(`/books/${studentId}/payment`, { method: 'POST', token, body }),

  // ── The store room, the buses ────────────────────────────────────────────
  inventory: (token, q = {}) =>
    MODE === 'online' ? school.inventory(token, q)
      : MODE === 'cloud' ? hostOnly('The store room')()
                         : request(`/inventory${qs(q)}`, { token }),
  saveInventoryItem: (token, body) =>
    MODE === 'online' ? school.saveItem(token, body)
      : MODE === 'cloud' ? hostOnly('Changing an item')()
                         : request('/inventory', { method: 'POST', token, body }),
  moveStock: (token, body) =>
    MODE === 'online' ? school.moveStock(token, body)
      : MODE === 'cloud' ? hostOnly('Moving stock')()
                         : request('/inventory/movement', { method: 'POST', token, body }),
  stockMovements: (token, q = {}) =>
    MODE === 'online' ? school.inventoryMovements(token, q)
      : MODE === 'cloud' ? hostOnly('Stock movements')()
                         : request(`/inventory/movements${qs(q)}`, { token }),
  transportRoutes: (token) =>
    MODE === 'online' ? school.transport(token)
      : MODE === 'cloud' ? hostOnly('Transport')()
                         : request('/transport', { token }),
  transportRoute: (token, id) =>
    MODE === 'online' ? school.transportRoute(token, id)
      : MODE === 'cloud' ? hostOnly('A route')() : request(`/transport/${id}`, { token }),
  saveTransportRoute: (token, body) =>
    MODE === 'online' ? school.saveRoute(token, body)
      : MODE === 'cloud' ? hostOnly('Changing a route')()
                         : request('/transport', { method: 'POST', token, body }),
  setTransportRiders: (token, body) =>
    MODE === 'online' ? school.setRiders(token, body)
      : MODE === 'cloud' ? hostOnly('Assigning riders')()
                         : request('/transport/riders', { method: 'POST', token, body }),
  transportPayment: (token, body) =>
    MODE === 'online' ? school.transportPayment(token, body)
      : MODE === 'cloud' ? hostOnly('A transport payment')()
                         : request('/transport/payment', { method: 'POST', token, body }),

  // ── The canteen, beyond the daily collection ─────────────────────────────
  canteenDebtors: (token, classId) =>
    MODE === 'online' ? school.canteenDebtors(token, classId)
      : MODE === 'cloud' ? hostOnly('Canteen arrears')()
                         : request(`/canteen/debtors${qs({ classId })}`, { token }),

  // ── Payroll, past the run ────────────────────────────────────────────────
  payrollRun: (token, month, year) =>
    MODE === 'online' ? school.runPayroll(token, month, year)
      : MODE === 'cloud' ? hostOnly('Running payroll')()
                         : request('/payroll/run', { method: 'POST', token, body: { month, year } }),
  payrollSchedule: (token, kind, month, year) =>
    MODE === 'online' ? school.schedule(token, kind, month, year)
      : MODE === 'cloud' ? hostOnly('A statutory schedule')()
                         : request(`/payroll/schedule/${kind}${qs({ month, year })}`, { token }),
  payslip: (token, staffId, month, year) =>
    MODE === 'online' ? school.payslip(token, staffId, month, year)
      : MODE === 'cloud' ? hostOnly('A payslip')()
                         : request(`/payroll/${staffId}/payslip${qs({ month, year })}`, { token }),
  markSalaryPaid: (token, id, body) =>
    MODE === 'online' ? school.markSalaryPaid(token, id, body)
      : MODE === 'cloud' ? hostOnly('Marking a salary paid')()
                         : request(`/payroll/${id}/paid`, { method: 'POST', token, body }),

  // ── Notices and SMS ──────────────────────────────────────────────────────
  notificationLog: (token, q = {}) =>
    MODE === 'online' ? school.notifications(token, q)
      : MODE === 'cloud' ? hostOnly('What has been sent')()
                         : request(`/notifications${qs(q)}`, { token }),
  sendNotification: (token, body) =>
    MODE === 'online' ? school.sendNotification(token, body)
      : MODE === 'cloud' ? hostOnly('Sending a message')()
                         : request('/notifications', { method: 'POST', token, body }),
  withdrawAnnouncement: (token, id) =>
    MODE === 'online' ? school.withdrawAnnouncement(token, id)
      : MODE === 'cloud' ? hostOnly('Withdrawing a notice')()
                         : request(`/announcements/${id}/withdraw`, { method: 'POST', token }),

  // ── Staff activities, budgets and the cashbook ───────────────────────────
  staffActivities: (token, q = {}) =>
    MODE === 'online' ? school.activities(token, q)
      : MODE === 'cloud' ? hostOnly('Staff activities')()
                         : request(`/activities${qs(q)}`, { token }),
  saveStaffActivity: (token, body) =>
    MODE === 'online' ? school.saveActivity(token, body)
      : MODE === 'cloud' ? hostOnly('Filing an activity')()
                         : request('/activities', { method: 'POST', token, body }),
  acknowledgeActivity: (token, id) =>
    MODE === 'online' ? school.acknowledgeActivity(token, id)
      : MODE === 'cloud' ? hostOnly('Acknowledging an activity')()
                         : request(`/activities/${id}/acknowledge`, { method: 'POST', token }),
  budgets: (token, id) =>
    MODE === 'online' ? school.budgets(token, id)
      : MODE === 'cloud' ? hostOnly('Budgets')()
                         : request(`/budgets${qs({ id })}`, { token }),
  saveBudget: (token, body) =>
    MODE === 'online' ? school.saveBudget(token, body)
      : MODE === 'cloud' ? hostOnly('Writing a budget')()
                         : request('/budgets', { method: 'POST', token, body }),
  cashbook: (token, q = {}) =>
    MODE === 'online' ? school.cashbook(token, q)
      : MODE === 'cloud' ? hostOnly('The cashbook')()
                         : request(`/finance/cashbook${qs(q)}`, { token }),

  // ── Examinations ─────────────────────────────────────────────────────────
  //
  // Papers and the question bank, which the app could not reach at all: the
  // desktop kept them behind IPC handlers, so an end-of-term paper could only
  // be written at the one PC in the office. Both servers serve the same shape
  // now — see electron/ipc/_exams.js and cloud-python/app/school/exams.py.
  examPapers: (token, q = {}) =>
    MODE === 'online' ? school.examPapers(token, q)
      : MODE === 'cloud' ? hostOnly('Exam papers')()
                         : request(`/exams/papers${qs(q)}`, { token }),
  examPaper: (token, id) =>
    MODE === 'online' ? school.examPaper(token, id)
      : MODE === 'cloud' ? hostOnly('An exam paper')()
                         : request(`/exams/papers/${id}`, { token }),
  saveExamPaper: (token, body) =>
    MODE === 'online' ? school.saveExamPaper(token, body)
      : MODE === 'cloud' ? hostOnly('Writing an exam paper')()
                         : request('/exams/papers', { method: 'POST', token, body }),
  deleteExamPaper: (token, id) =>
    MODE === 'online' ? school.deleteExamPaper(token, id)
      : MODE === 'cloud' ? hostOnly('Deleting an exam paper')()
                         : request(`/exams/papers/${id}/delete`, { method: 'POST', token }),
  examQuestions: (token, q = {}) =>
    MODE === 'online' ? school.examQuestions(token, q)
      : MODE === 'cloud' ? hostOnly('The question bank')()
                         : request(`/exams/questions${qs(q)}`, { token }),
  saveExamQuestion: (token, body) =>
    MODE === 'online' ? school.saveExamQuestion(token, body)
      : MODE === 'cloud' ? hostOnly('Writing a question')()
                         : request('/exams/questions', { method: 'POST', token, body }),
  deleteExamQuestion: (token, id) =>
    MODE === 'online' ? school.deleteExamQuestion(token, id)
      : MODE === 'cloud' ? hostOnly('Deleting a question')()
                         : request(`/exams/questions/${id}/delete`, { method: 'POST', token }),
  examFromBank: (token, paperId, sectionId, questionIds) =>
    MODE === 'online' ? school.examFromBank(token, paperId, sectionId, questionIds)
      : MODE === 'cloud' ? hostOnly('Taking questions from the bank')()
                         : request(`/exams/papers/${paperId}/from-bank`,
                                   { method: 'POST', token, body: { sectionId, questionIds } }),

  // ── The timetable ────────────────────────────────────────────────────────
  //
  // The two servers key their entries differently — the desktop by
  // `"<day>:<period>"` in one flat map, the online school by day and then by
  // period in a nested one — and that difference had leaked into the screen.
  // Both are normalised HERE to the flat form, so a grid is drawn once.
  timetablePeriods: (token) =>
    MODE === 'online' ? school.periods(token)
      : MODE === 'cloud' ? hostOnly('The bell schedule')()
                         : request('/timetable/periods', { token }),
  saveTimetablePeriods: (token, periods) =>
    MODE === 'online' ? school.savePeriods(token, periods)
      : MODE === 'cloud' ? hostOnly('Changing the bell schedule')()
                         : request('/timetable/periods', { method: 'POST', token, body: { periods } }),
  classTimetable: (token, classId) => {
    if (MODE === 'cloud') return hostOnly('A class timetable')();
    const call = MODE === 'online'
      ? school.classTimetable(token, classId)
      : request(`/timetable/class/${classId}`, { token });
    return call.then(flattenTimetable);
  },
  saveClassTimetable: (token, classId, entries) =>
    MODE === 'online' ? school.saveClassTimetable(token, classId, entries)
      : MODE === 'cloud' ? hostOnly('Setting a timetable')()
                         : request('/timetable/class', { method: 'POST', token, body: { classId, entries } }),

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
  //   online the ONLINE SCHOOL — everything, live, from anywhere. Its routes
  //          live under /api/v1/school/* and are reached through `school.*`
  //          below.
  //   cloud  the thin projection — the figures, and the two approvals that
  //          move no money. Anything else answers `host_only`, which the
  //          screens turn into "the school's own system does this" rather
  //          than an error.
  //
  // One method per thing, dispatching once here, so a screen never asks which
  // mode it is in.
  //
  // ── The bug this shape existed to cause ─────────────────────────────────
  //
  // These used to be a two-way choice: `cloud ? host_only : <desktop route>`.
  // Which meant the ONLINE school — the mode a browser on a Vercel deployment
  // is always in, and the one the whole office is expected to work from — fell
  // into the "desktop route" branch and asked a FastAPI service for
  // `/api/v1/admin/students`, a path it has never served. Every screen in the
  // office answered 404 over the internet: the roll, the staff register, the
  // ledgers, payroll, the audit trail. Half of these screens had grown a
  // private `mode === 'online' ? api.school.x : api.y` in the component to
  // work around it, and the other half had not, which is exactly how a
  // dispatch decision leaks out of the client and into eleven screens.
  //
  // It is a three-way choice now, decided here, once.
  financeOverview: (token) =>
    MODE === 'online' ? school.feesOverview(token)
      : MODE === 'cloud' ? request('/staff/finance/overview', { token })
                         : request('/finance/overview', { token }),
  financeDebtors: (token, classId) =>
    MODE === 'online' ? school.debtors(token, { classId })
      : MODE === 'cloud' ? request('/staff/finance/debtors', { token })
                         : request(`/finance/debtors${qs({ classId })}`, { token }),
  financeCollections: (token, q = {}) =>
    MODE === 'online' ? school.collections(token, q)
      : MODE === 'cloud' ? hostOnly('The day’s collections')()
                         : request(`/finance/collections${qs(q)}`, { token }),
  financeTakePayment: (token, body) =>
    MODE === 'online' ? school.takePayment(token, body)
      : MODE === 'cloud' ? hostOnly('Taking a payment')()
                         : request('/finance/collections', { method: 'POST', token, body }),
  financeReverse: (token, id, reason) =>
    MODE === 'online' ? school.reversePayment(token, id, reason)
      : MODE === 'cloud' ? hostOnly('Reversing a payment')()
                         : request(`/finance/collections/${id}/reverse`, { method: 'POST', token, body: { reason } }),
  financeStudents: (token, q = {}) =>
    MODE === 'online' ? school.students(token, q)
      : MODE === 'cloud' ? hostOnly('Searching for a pupil’s account')()
                         : request(`/finance/students${qs(q)}`, { token }),
  financeStudentBill: (token, id, termId) =>
    MODE === 'online' ? school.studentAccount(token, id, termId)
      : MODE === 'cloud' ? hostOnly('A pupil’s account')()
                         : request(`/finance/students/${id}/bill${termId ? `?termId=${termId}` : ''}`, { token }),
  financeIncome: (token, q = {}) =>
    MODE === 'online' ? school.income(token, q)
      : MODE === 'cloud' ? hostOnly('The income ledger')()
                         : request(`/finance/income${qs(q)}`, { token }),
  financeRecordIncome: (token, body) =>
    MODE === 'online' ? school.recordIncome(token, body)
      : MODE === 'cloud' ? hostOnly('Recording income')()
                         : request('/finance/income', { method: 'POST', token, body }),
  financeExpenses: (token, q = {}) =>
    MODE === 'online' ? school.expenses(token, q)
      : MODE === 'cloud' ? hostOnly('The expenditure ledger')()
                         : request(`/finance/expenses${qs(q)}`, { token }),
  financeRecordExpense: (token, body) =>
    MODE === 'online' ? school.recordExpense(token, body)
      : MODE === 'cloud' ? hostOnly('Recording an expense')()
                         : request('/finance/expenses', { method: 'POST', token, body }),
  financeApproveExpense: (token, id) =>
    MODE === 'online' ? school.approveExpense(token, id)
      : MODE === 'cloud' ? hostOnly('Approving an expense')()
                         : request(`/finance/expenses/${id}/approve`, { method: 'POST', token }),
  financeStatement: (token, q = {}) =>
    MODE === 'online' ? school.statement(token, q)
      : MODE === 'cloud' ? hostOnly('The financial statement')()
                         : request(`/finance/statement${qs(q)}`, { token }),
  financeAudit: (token, termId) =>
    MODE === 'online' ? school.financeAudit(token, termId)
      : MODE === 'cloud' ? hostOnly('The finance audit')()
                         : request(`/finance/audit${qs({ termId })}`, { token }),
  financePayroll: (token, month, year) =>
    MODE === 'online' ? school.payroll(token, month, year)
      : MODE === 'cloud' ? hostOnly('Payroll')()
                         : request(`/finance/payroll${qs({ month, year })}`, { token }),
  financeOnline: (token, status) =>
    MODE === 'online' ? school.onlinePayments(token, status)
      : MODE === 'cloud' ? hostOnly('Payments taken online')()
                         : request(`/finance/online${qs({ status })}`, { token }),
  financeAcknowledge: (token, id, method) =>
    MODE === 'online' ? school.acknowledgeIntent(token, id, method)
      : MODE === 'cloud' ? hostOnly('Confirming a payment')()
                         : request(`/finance/online/${id}/acknowledge`, { method: 'POST', token, body: { method } }),
  financeReject: (token, id, reason) =>
    MODE === 'online' ? school.rejectIntent(token, id, reason)
      : MODE === 'cloud' ? hostOnly('Rejecting a payment')()
                         : request(`/finance/online/${id}/reject`, { method: 'POST', token, body: { reason } }),

  adminOverview: (token) =>
    MODE === 'online' ? school.overview(token)
      : MODE === 'cloud' ? request('/staff/admin/overview', { token })
                         : request('/admin/overview', { token }),
  adminStudents: (token, q = {}) =>
    MODE === 'online' ? school.students(token, q)
      : MODE === 'cloud' ? hostOnly('The whole roll')()
                         : request(`/admin/students${qs(q)}`, { token }),
  adminAdmit: (token, body) =>
    MODE === 'online' ? school.admitStudent(token, body)
      : MODE === 'cloud' ? hostOnly('Admitting a pupil')()
                         : request('/admin/students', { method: 'POST', token, body }),
  adminUpdateStudent: (token, id, body) =>
    MODE === 'online' ? school.updateStudent(token, id, body)
      : MODE === 'cloud' ? hostOnly('Changing a pupil’s record')()
                         : request(`/admin/students/${id}`, { method: 'POST', token, body }),
  adminStudentStatus: (token, id, status, reason) =>
    MODE === 'online' ? school.studentStatus(token, id, status, reason)
      : MODE === 'cloud' ? hostOnly('Changing a pupil’s status')()
                         : request(`/admin/students/${id}/status`, { method: 'POST', token, body: { status, reason } }),
  adminStaff: (token, status) =>
    MODE === 'online' ? school.staff(token, status)
      : MODE === 'cloud' ? hostOnly('The staff register')()
                         : request(`/admin/staff${qs({ status })}`, { token }),
  adminStaffMember: (token, id) =>
    MODE === 'online' ? school.staffMember(token, id)
      : MODE === 'cloud' ? hostOnly('A staff record')()
                         : request(`/admin/staff/${id}`, { token }),
  adminSaveStaff: (token, body) =>
    MODE === 'online' ? school.saveStaff(token, body)
      : MODE === 'cloud' ? hostOnly('Changing a staff record')()
                         : request('/admin/staff', { method: 'POST', token, body }),
  adminSetAssignments: (token, id, assignments) =>
    MODE === 'online' ? school.setAssignments(token, id, assignments)
      : MODE === 'cloud' ? hostOnly('Setting what somebody teaches')()
                         : request(`/admin/staff/${id}/assignments`,
                                   { method: 'POST', token, body: { assignments } }),
  adminStaffRegister: (token, date) =>
    MODE === 'online' ? school.staffRegister(token, date)
      : MODE === 'cloud' ? hostOnly('The staff attendance register')()
                         : request(`/admin/staff-register${qs({ date })}`, { token }),
  adminApprovals: (token) =>
    MODE === 'online'
      ? Promise.all([
          school.leave(token, 'pending').catch(() => ({ requests: [] })),
          school.lessonNotes(token, { status: 'submitted' }).catch(() => ({ notes: [] })),
        ]).then(([leave, notes]) => ({
          ok: true, leave: leave.requests || [], lesson_notes: notes.notes || [],
          may_decide: { leave: !!leave.may_decide, lesson_notes: !!notes.may_decide },
        }))
      : MODE === 'cloud' ? request('/staff/admin/approvals', { token })
      : Promise.all([
          request('/admin/leave?status=pending', { token }).catch(() => ({ requests: [] })),
          request('/admin/lesson-notes?status=submitted', { token }).catch(() => ({ notes: [] })),
        ]).then(([leave, notes]) => ({
          ok: true, leave: leave.requests || [], lesson_notes: notes.notes || [],
          may_decide: { leave: !!leave.may_decide, lesson_notes: !!notes.may_decide },
        })),
  adminDecideLeave: (token, id, decision, notes) =>
    MODE === 'online' ? school.decideLeave(token, id, decision, notes)
      : MODE === 'cloud'
        ? request('/staff/admin/leave/decision', { method: 'POST', token, body: { id, decision, notes } })
        : request(`/admin/leave/${id}/decision`, { method: 'POST', token, body: { decision, notes } }),
  adminDecideNote: (token, id, decision, comments) =>
    MODE === 'online' ? school.decideLessonNote(token, id, decision, comments)
      : MODE === 'cloud'
        ? request('/staff/admin/lesson-note/decision', { method: 'POST', token, body: { id, decision, notes: comments } })
        : request(`/admin/lesson-notes/${id}/decision`, { method: 'POST', token, body: { decision, comments } }),
  adminAcademics: (token, termId) =>
    MODE === 'online' ? school.academicOverview(token, termId)
      : MODE === 'cloud' ? hostOnly('Academic oversight')()
                         : request(`/admin/academics${qs({ termId })}`, { token }),

  // Accounts, access and the audit trail are administered where the system is.
  // That is the desktop, or the online school — never the thin projection,
  // which holds no accounts to administer.
  systemOverview: (token) =>
    MODE === 'online' ? school.systemOverview(token)
      : MODE === 'cloud' ? hostOnly('The system')() : request('/system/overview', { token }),
  systemUsers: (token) =>
    MODE === 'online' ? school.users(token)
      : MODE === 'cloud' ? hostOnly('User accounts')() : request('/system/users', { token }),
  systemCreateUser: (token, body) =>
    MODE === 'online' ? school.createUser(token, body)
      : MODE === 'cloud' ? hostOnly('Creating an account')()
                         : request('/system/users', { method: 'POST', token, body }),
  systemUserStatus: (token, id, active) =>
    MODE === 'online' ? school.setUserStatus(token, id, active)
      : MODE === 'cloud' ? hostOnly('Changing an account')()
                         : request(`/system/users/${id}/status`, { method: 'POST', token, body: { active } }),
  systemUserRole: (token, id, designationId) =>
    MODE === 'online' ? school.setUserRole(token, id, designationId)
      : MODE === 'cloud' ? hostOnly('Changing a role')()
                         : request(`/system/users/${id}/role`, { method: 'POST', token, body: { designationId } }),
  systemUserPassword: (token, id, password) =>
    MODE === 'online' ? school.resetUserPassword(token, id, password)
      : MODE === 'cloud' ? hostOnly('Resetting a password')()
                         : request(`/system/users/${id}/password`, { method: 'POST', token, body: { password } }),
  systemAccess: (token) =>
    MODE === 'online' ? school.accessMatrix(token)
      : MODE === 'cloud' ? hostOnly('Access levels')() : request('/system/access', { token }),
  systemSetAccess: (token, designationId, levels) =>
    MODE === 'online' ? school.setAccess(token, designationId, levels)
      : MODE === 'cloud' ? hostOnly('Changing access')()
                         : request('/system/access', { method: 'POST', token, body: { designationId, levels } }),
  systemAudit: (token, q = {}) =>
    MODE === 'online' ? school.auditTrail(token, q)
      : MODE === 'cloud' ? hostOnly('The audit trail')() : request(`/system/audit${qs(q)}`, { token }),
  systemSettings: (token) =>
    MODE === 'online' ? school.settings(token)
      : MODE === 'cloud' ? hostOnly('School settings')() : request('/system/settings', { token }),
  systemSaveSettings: (token, settings) =>
    MODE === 'online' ? school.saveSettings(token, settings)
      : MODE === 'cloud' ? hostOnly('Changing a setting')()
                         : request('/system/settings', { method: 'POST', token, body: { settings } }),

  // ── The dashboards ─────────────────────────────────────────────────
  //
  // The installed application's own summary screens, one route each, served by
  // the school's system (electron/server/dashboards_api.js). They are the
  // reason a browser dashboard and a desktop dashboard show the same five
  // cards and the same chart rather than two people's ideas of a summary.
  //
  // A connection that does not serve them answers `null` rather than throwing.
  // That is deliberate: the thin hosted portal holds a projection of the
  // school and cannot compute a collection donut, and a screen that reads
  // `null` draws the summary it CAN build from what the portal does serve.
  // A thrown error would put a red note above a page that is working.
  dashMain:      (token, termId) => dash('/dash/main', token, { termId }),
  dashStudents:  (token) => dash('/dash/students', token),
  dashAcademics: (token, termId) => dash('/dash/academics', token, { termId }),
  dashFees:      (token, termId) => dash('/dash/fees', token, { termId }),
  dashCanteen:   (token, termId) => dash('/dash/canteen', token, { termId }),
  dashStaff:     (token) => dash('/dash/staff', token),
  dashPayroll:   (token, month, year) => dash('/dash/payroll', token, { month, year }),
  dashFinance:   (token, termId) => dash('/dash/finance', token, { termId }),

  // Staff — how much of this teacher's work has not reached the school yet.
  // Only meaningful over the internet; on the desktop a write has landed by
  // the time the request returns.
  staffPending: (token) =>
    MODE === 'cloud' ? request('/staff/pending', { token }) : Promise.resolve({ ok: true, pending: 0 }),
};

/**
 * Ask the school's own system for one of its dashboards.
 *
 * Host mode only, and quietly so. `null` means "this connection does not serve
 * that", which every dashboard screen treats as "draw the summary you can
 * build from the ordinary endpoints". A 404 from an older desktop that
 * predates these routes lands in the same place, which is the point: a school
 * that has not updated its installation sees the app it had, not an error.
 */
function dash(path, token, query) {
  if (MODE !== 'host') return Promise.resolve(null);
  return request(`${path}${qs(query || {})}`, { token }).catch(() => null);
}

/**
 * One shape for a class's week.
 *
 * The desktop answers `entries: { "1:4": {...} }` and the online school answers
 * `entries: { "1": { "4": {...} } }`. Both become the flat form, and both gain
 * `days` and `periods` if whichever server was asked left them out.
 */
function flattenTimetable(r) {
  const raw = (r && r.entries) || {};
  const flat = {};
  for (const [day, value] of Object.entries(raw)) {
    if (value && typeof value === 'object' && !value.period_id && !value.day_of_week) {
      for (const [period, entry] of Object.entries(value)) flat[`${day}:${period}`] = entry;
    } else {
      flat[day] = value;             // already "<day>:<period>"
    }
  }
  return { ...r, entries: flat, periods: r.periods || [], days: r.days || DEFAULT_DAYS };
}

const DEFAULT_DAYS = [
  { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' }, { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
];

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
  feeTemplates: (token, billType) => schoolRequest('/fees/templates', { token, query: { billType } }),
  supplementary: (token, termId) => schoolRequest('/fees/supplementary', { token, query: { termId } }),
  applySupplementary: (token, body) =>
    schoolRequest('/fees/supplementary', { method: 'POST', token, body }),
  removeSupplementary: (token, body) =>
    schoolRequest('/fees/supplementary/remove', { method: 'POST', token, body }),
  voidedBills: (token, query) => schoolRequest('/fees/bills/voided', { token, query }),
  voidBill: (token, id, reason) =>
    schoolRequest(`/fees/bills/${id}/void`, { method: 'POST', token, body: { reason } }),
  restoreBill: (token, id) => schoolRequest(`/fees/bills/${id}/restore`, { method: 'POST', token }),
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

  staffRegister: (token, date) => schoolRequest('/staff-register', { token, query: { date } }),
  saveLessonNote: (token, body) => schoolRequest('/my/lesson-notes', { method: 'POST', token, body }),

  // ── teaching ──
  // The register, the marks and the report card, online. The desktop and the
  // thin portal answer these under different paths; `staffPath` handles those
  // two, and this handles the third.
  attendance: (token, classId, date) =>
    schoolRequest('/attendance', { token, query: { classId, date } }),
  markAttendance: (token, body) => schoolRequest('/attendance', { method: 'POST', token, body }),
  attendanceHistory: (token, classId, days) =>
    schoolRequest('/attendance/history', { token, query: { classId, days } }),
  subjects: (token, classId) => schoolRequest('/subjects', { token, query: { classId } }),
  scores: (token, classId, subjectId, termId) =>
    schoolRequest('/scores', { token, query: { classId, subjectId, termId } }),
  saveScores: (token, body) => schoolRequest('/scores', { method: 'POST', token, body }),
  assessments: (token, classId, subjectId, termId) =>
    schoolRequest('/assessments', { token, query: { classId, subjectId, termId } }),
  saveAssessments: (token, body) => schoolRequest('/assessments', { method: 'POST', token, body }),
  addAssessmentColumn: (token, body) =>
    schoolRequest('/assessments/column', { method: 'POST', token, body }),
  results: (token, classId, termId) =>
    schoolRequest('/results', { token, query: { classId, termId } }),
  studentResult: (token, id, termId) =>
    schoolRequest(`/results/student/${id}`, { token, query: { termId } }),
  saveRemarks: (token, body) => schoolRequest('/results/remarks', { method: 'POST', token, body }),

  // ── the timetable ──
  periods: (token) => schoolRequest('/timetable/periods', { token }),
  savePeriods: (token, periods) =>
    schoolRequest('/timetable/periods', { method: 'POST', token, body: { periods } }),
  classTimetable: (token, classId) =>
    schoolRequest('/timetable/class', { token, query: { classId } }),
  saveClassTimetable: (token, classId, slots) =>
    schoolRequest('/timetable/class', { method: 'POST', token, body: { classId, slots } }),
  myTimetable: (token) => schoolRequest('/timetable/mine', { token }),

  // ── homework ──
  homework: (token, classId, all) =>
    schoolRequest('/homework', { token, query: { classId, all: all ? 1 : undefined } }),
  saveHomework: (token, body) => schoolRequest('/homework', { method: 'POST', token, body }),
  homeworkSheet: (token, id) => schoolRequest(`/homework/${id}`, { token }),
  saveHomeworkMarks: (token, id, entries) =>
    schoolRequest(`/homework/${id}/marks`, { method: 'POST', token, body: { entries } }),

  // ── the canteen ──
  canteenStudent: (token, id) => schoolRequest(`/canteen/student/${id}`, { token }),
  canteenCollect: (token, body) => schoolRequest('/canteen/collect', { method: 'POST', token, body }),
  canteenClass: (token, classId, date) =>
    schoolRequest('/canteen/class', { token, query: { classId, date } }),
  canteenQuickPay: (token, body) => schoolRequest('/canteen/quick-pay', { method: 'POST', token, body }),
  canteenExempt: (token, body) => schoolRequest('/canteen/exempt', { method: 'POST', token, body }),
  canteenDebtors: (token, classId) =>
    schoolRequest('/canteen/debtors', { token, query: { classId } }),

  // ── talking ──
  messages: (token) => schoolRequest('/messages', { token }),
  thread: (token, id) => schoolRequest(`/messages/${id}`, { token }),
  sendMessage: (token, body) => schoolRequest('/messages', { method: 'POST', token, body }),
  withdrawAnnouncement: (token, id) =>
    schoolRequest(`/announcements/${id}/withdraw`, { method: 'POST', token }),
  notifications: (token, query) => schoolRequest('/notifications', { token, query }),
  sendNotification: (token, body) => schoolRequest('/notifications', { method: 'POST', token, body }),

  // ── the store room, the buses, the extras ──
  inventoryMovements: (token, query) => schoolRequest('/inventory/movements', { token, query }),
  transport: (token) => schoolRequest('/transport', { token }),
  transportRoute: (token, id) => schoolRequest(`/transport/${id}`, { token }),
  saveRoute: (token, body) => schoolRequest('/transport', { method: 'POST', token, body }),
  setRiders: (token, body) => schoolRequest('/transport/riders', { method: 'POST', token, body }),
  transportPayment: (token, body) =>
    schoolRequest('/transport/payment', { method: 'POST', token, body }),
  books: (token, studentId) => schoolRequest(`/books/${studentId}`, { token }),
  saveBooks: (token, studentId, body) =>
    schoolRequest(`/books/${studentId}`, { method: 'POST', token, body }),
  bookPayment: (token, studentId, body) =>
    schoolRequest(`/books/${studentId}/payment`, { method: 'POST', token, body }),
  discounts: (token, query) => schoolRequest('/discounts', { token, query }),
  saveDiscount: (token, body) => schoolRequest('/discounts', { method: 'POST', token, body }),
  feeTemplate: (token, id) => schoolRequest(`/fees/templates/${id}`, { token }),

  // ── activities, budgets, the cashbook ──
  activities: (token, query) => schoolRequest('/activities', { token, query }),
  saveActivity: (token, body) => schoolRequest('/activities', { method: 'POST', token, body }),
  acknowledgeActivity: (token, id) =>
    schoolRequest(`/activities/${id}/acknowledge`, { method: 'POST', token }),
  budgets: (token, id) => schoolRequest('/budgets', { token, query: { id } }),
  saveBudget: (token, body) => schoolRequest('/budgets', { method: 'POST', token, body }),
  cashbook: (token, query) => schoolRequest('/finance/cashbook', { token, query }),

  // ── examinations ──
  examPapers: (token, query) => schoolRequest('/exams/papers', { token, query }),
  examPaper: (token, id) => schoolRequest(`/exams/papers/${id}`, { token }),
  saveExamPaper: (token, body) => schoolRequest('/exams/papers', { method: 'POST', token, body }),
  deleteExamPaper: (token, id) =>
    schoolRequest(`/exams/papers/${id}/delete`, { method: 'POST', token }),
  examQuestions: (token, query) => schoolRequest('/exams/questions', { token, query }),
  saveExamQuestion: (token, body) =>
    schoolRequest('/exams/questions', { method: 'POST', token, body }),
  deleteExamQuestion: (token, id) =>
    schoolRequest(`/exams/questions/${id}/delete`, { method: 'POST', token }),
  examFromBank: (token, paperId, sectionId, questionIds) =>
    schoolRequest(`/exams/papers/${paperId}/from-bank`,
                  { method: 'POST', token, body: { sectionId, questionIds } }),

  // ── a person's own record, in every portal ──
  myEmployment: (token, year) => schoolRequest('/my/employment', { token, query: { year } }),
  clock: (token, direction) => schoolRequest('/my/clock', { method: 'POST', token, body: { direction } }),
  requestLeave: (token, body) => schoolRequest('/my/leave', { method: 'POST', token, body }),
};
