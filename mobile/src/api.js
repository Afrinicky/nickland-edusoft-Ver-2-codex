// Nickland Edusoft mobile — API client
// Talks to a school's desktop host over LAN (http://<ip>:4747) today, or the
// cloud portal later. The base URL is set once the user connects to a host.

let BASE = null;

export function setBaseUrl(url) { BASE = url ? url.replace(/\/+$/, '') : null; }
export function getBaseUrl() { return BASE; }

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
    throw new Error('Cannot reach the school. Check the address and Wi-Fi.');
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

export const api = {
  // Public
  info: () => request('/info'),
  health: () => request('/health'),
  staffLogin: (username, password, device) => request('/auth/login', { method: 'POST', body: { username, password, device } }),
  parentLogin: (identifier, password, device) => request('/auth/parent/login', { method: 'POST', body: { identifier, password, device } }),
  parentRegister: (data) => request('/auth/parent/register', { method: 'POST', body: data }),

  // Authed
  me: (token) => request('/me', { token }),
  logout: (token) => request('/auth/logout', { method: 'POST', token }),

  // Parent
  children: (token) => request('/parent/children', { token }),
  child: (token, id) => request(`/parent/children/${id}`, { token }),
  childReport: (token, id) => request(`/parent/children/${id}/report`, { token }),
  childIntents: (token, id) => request(`/parent/children/${id}/intents`, { token }),
  pay: (token, id, { amount, channel, reference }) => request(`/parent/children/${id}/pay`, { method: 'POST', token, body: { amount, channel, reference } }),
  payOnline: (token, id, { amount, email }) => request(`/parent/children/${id}/pay/online`, { method: 'POST', token, body: { amount, email } }),
  verifyPayment: (token, reference) => request(`/parent/pay/verify/${encodeURIComponent(reference)}`, { token }),
  parentNotifications: (token) => request('/parent/notifications', { token }),

  // Staff
  dashboard: (token) => request('/dashboard', { token }),
  students: (token, classId) => request(`/students${classId ? `?classId=${classId}` : ''}`, { token }),
  debtors: (token) => request('/fees/debtors', { token }),
  markAttendance: (token, date, marks) => request('/attendance', { method: 'POST', token, body: { date, marks } }),
};

export function money(n) {
  const v = Number(n) || 0;
  return 'GHS ' + v.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
