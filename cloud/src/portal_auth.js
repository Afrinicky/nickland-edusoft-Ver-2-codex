// Nickland Edusoft Cloud — parent portal auth
// Verifies the scrypt password hash projected from the desktop (same format as
// electron/server/parents.js), and issues/validates a signed portal session
// token (HMAC — no external JWT dependency).
const crypto = require('crypto');

const SECRET = process.env.PORTAL_SECRET || 'dev-portal-secret-change-me';

function verifyPassword(password, stored) {
  if (!stored || !String(stored).startsWith('scrypt$')) return false;
  const [, salt, expected] = String(stored).split('$');
  try {
    const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
    const a = Buffer.from(derived, 'hex'); const b = Buffer.from(expected, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) { return false; }
}

function normPhone(raw) {
  let s = String(raw || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('0')) s = '233' + s.slice(1);
  else if (s.length === 9) s = '233' + s;
  return s;
}

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }

function signToken(payload, ttlSeconds = 7 * 24 * 3600) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const data = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  try {
    const a = Buffer.from(sig); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch (_) { return null; }
  let body; try { body = JSON.parse(Buffer.from(data, 'base64url').toString()); } catch (_) { return null; }
  if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}

module.exports = { verifyPassword, normPhone, signToken, verifyToken };
