// Nickland Edusoft — remote backup destinations (S3, WebDAV, Google Drive)
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Getting a copy of every backup OFF this computer, to somewhere the building
// is not. Dependency-free — Node's http/https + crypto only, so there is no new
// package to trust, audit or keep updated.
//
// Every provider is the same shape:
//   verify(config)                 → { ok } | { ok:false, error }
//   upload(config, filePath, name) → { ok, id? } | { ok:false, error }
//
// verify() does a REAL round trip — it uploads a tiny probe and removes it —
// because a destination that only turns out to be wrong at two in the morning
// is worse than none. Nothing is saved until verify passes on the operator's
// own machine.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const PROBE_NAME = '.nickland-verify.txt';
const PROBE_BODY = Buffer.from('nickland-edusoft backup destination check');

// ── low-level HTTP ──────────────────────────────────────────────────────────
// One request. `body` may be a Buffer or a readable stream (for streaming a
// large backup without loading it into memory). Resolves { status, headers,
// text } and never throws — a network error becomes { status: 0, error }.
function requestOnce(urlStr, { method = 'GET', headers = {}, body = null, timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return resolve({ status: 0, error: 'Bad URL: ' + urlStr }); }
    const mod = u.protocol === 'http:' ? http : https;
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      headers,
    };
    const req = mod.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (e) => resolve({ status: 0, error: (e && e.message) || String(e) }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ status: 0, error: 'Timed out reaching the destination.' }); });
    if (body && typeof body.pipe === 'function') body.pipe(req);
    else { if (body) req.write(body); req.end(); }
  });
}

// ── AWS Signature V4 (S3 and every S3-compatible service) ───────────────────
function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest(); }

// Encode a path for S3: each segment percent-encoded, '/' preserved.
function encodeS3Path(p) {
  return p.split('/').map(seg => encodeURIComponent(seg)).join('/');
}

// Sign one S3 request. Pure and deterministic given `now`, so it is checked in
// the test suite against AWS's published example vector.
function signS3({ method, host, canonicalUri, query = '', region, accessKeyId, secretAccessKey, headers = {}, payloadHash, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');   // 20130524T000000Z
  const dateStamp = amzDate.slice(0, 8);
  const service = 's3';

  const allHeaders = { ...headers, host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signedKeys = Object.keys(allHeaders).map(k => k.toLowerCase()).sort();
  const canonicalHeaders = signedKeys.map(k => {
    const realKey = Object.keys(allHeaders).find(h => h.toLowerCase() === k);
    return `${k}:${String(allHeaders[realKey]).trim()}\n`;
  }).join('');
  const signedHeaders = signedKeys.join(';');

  const canonicalRequest = [method, canonicalUri, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(Buffer.from(canonicalRequest))].join('\n');

  const kDate = hmac('AWS4' + secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, amzDate, signature, signedHeaders, canonicalRequest, stringToSign };
}

// Build the object URL + signed headers for one S3 operation.
function s3Request(config, { method, key, payloadHash, extraHeaders = {}, now }) {
  const endpoint = String(config.endpoint || '').replace(/\/+$/, '');
  let u;
  try { u = new URL(endpoint); } catch (e) { return { error: 'Bad S3 endpoint URL.' }; }
  const region = config.region || 'us-east-1';
  const prefix = (config.prefix || '').replace(/^\/+|\/+$/g, '');
  const objectKey = [prefix, key].filter(Boolean).join('/');
  // Path-style addressing ({endpoint}/{bucket}/{key}) — works with MinIO,
  // Backblaze, Wasabi, R2 and AWS alike, and needs no DNS per bucket.
  const canonicalUri = '/' + encodeS3Path(`${config.bucket}/${objectKey}`);
  const host = u.host;
  const signed = signS3({ method, host, canonicalUri, region, accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey, headers: extraHeaders, payloadHash, now });
  const url = `${u.protocol}//${host}${canonicalUri}`;
  const headers = { ...extraHeaders, Host: host, 'x-amz-date': signed.amzDate,
    'x-amz-content-sha256': payloadHash, Authorization: signed.authorization };
  return { url, headers, objectKey };
}

const s3 = {
  async upload(config, filePath, name) {
    const size = fs.statSync(filePath).size;
    // UNSIGNED-PAYLOAD so a 200 MB backup streams straight through without being
    // hashed into memory first. Fine over TLS, and MinIO accepts it over http.
    const built = s3Request(config, { method: 'PUT', key: name, payloadHash: 'UNSIGNED-PAYLOAD',
      extraHeaders: { 'Content-Length': String(size) } });
    if (built.error) return { ok: false, error: built.error };
    const res = await requestOnce(built.url, { method: 'PUT', headers: built.headers, body: fs.createReadStream(filePath), timeoutMs: 15 * 60000 });
    if (res.status >= 200 && res.status < 300) return { ok: true, id: built.objectKey };
    return { ok: false, error: s3Error(res) };
  },
  async verify(config) {
    if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
      return { ok: false, error: 'Endpoint, bucket, access key and secret key are all required.' };
    }
    const put = s3Request(config, { method: 'PUT', key: PROBE_NAME, payloadHash: sha256Hex(PROBE_BODY),
      extraHeaders: { 'Content-Length': String(PROBE_BODY.length) } });
    if (put.error) return { ok: false, error: put.error };
    const res = await requestOnce(put.url, { method: 'PUT', headers: put.headers, body: PROBE_BODY });
    if (!(res.status >= 200 && res.status < 300)) return { ok: false, error: s3Error(res) };
    // Clean the probe up; a failure to delete is not fatal to the verify.
    const del = s3Request(config, { method: 'DELETE', key: PROBE_NAME, payloadHash: sha256Hex(Buffer.alloc(0)) });
    if (!del.error) await requestOnce(del.url, { method: 'DELETE', headers: del.headers });
    return { ok: true };
  },
};

function s3Error(res) {
  if (res.status === 0) return res.error || 'Could not reach the S3 endpoint.';
  if (res.status === 403) return 'Access denied (403) — check the access key, secret key and bucket permissions.';
  if (res.status === 404) return 'Not found (404) — check the bucket name and endpoint.';
  const m = res.text && res.text.match(/<Message>([^<]+)<\/Message>/);
  return m ? `S3 error (${res.status}): ${m[1]}` : `S3 returned HTTP ${res.status}.`;
}

// ── WebDAV (Nextcloud, ownCloud, Synology, QNAP, Koofr, any NAS) ─────────────
function webdavUrl(config, name) {
  const base = String(config.url || '').replace(/\/+$/, '');
  return `${base}/${encodeURIComponent(name)}`;
}
function basicAuth(config) {
  return 'Basic ' + Buffer.from(`${config.username || ''}:${config.password || ''}`).toString('base64');
}

const webdav = {
  async upload(config, filePath, name) {
    const size = fs.statSync(filePath).size;
    const res = await requestOnce(webdavUrl(config, name), {
      method: 'PUT',
      headers: { Authorization: basicAuth(config), 'Content-Type': 'application/zip', 'Content-Length': String(size) },
      body: fs.createReadStream(filePath), timeoutMs: 15 * 60000,
    });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    return { ok: false, error: webdavError(res) };
  },
  async verify(config) {
    if (!config.url) return { ok: false, error: 'A WebDAV address is required.' };
    if (!/^https?:\/\//i.test(config.url)) return { ok: false, error: 'The address must start with http:// or https://' };
    const res = await requestOnce(webdavUrl(config, PROBE_NAME), {
      method: 'PUT', headers: { Authorization: basicAuth(config), 'Content-Type': 'text/plain', 'Content-Length': String(PROBE_BODY.length) },
      body: PROBE_BODY,
    });
    if (!(res.status >= 200 && res.status < 300)) return { ok: false, error: webdavError(res) };
    await requestOnce(webdavUrl(config, PROBE_NAME), { method: 'DELETE', headers: { Authorization: basicAuth(config) } });
    return { ok: true };
  },
};

function webdavError(res) {
  if (res.status === 0) return res.error || 'Could not reach the WebDAV server.';
  if (res.status === 401) return 'Sign-in was refused (401) — check the username and password (use an app password where the server offers one).';
  if (res.status === 403) return 'Access denied (403) — the account cannot write to that folder.';
  if (res.status === 404) return 'Not found (404) — check the WebDAV address and that the folder exists.';
  if (res.status === 409) return 'Conflict (409) — a parent folder in that address does not exist.';
  return `The WebDAV server returned HTTP ${res.status}.`;
}

// ── Google Drive (service account) ──────────────────────────────────────────
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

// Build + RS256-sign the service-account assertion. Pure — tested by signing
// with a generated key and verifying with its public half.
function gdriveAssertion(sa, now = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const signature = b64url(crypto.createSign('RSA-SHA256').update(signingInput).sign(sa.private_key));
  return `${signingInput}.${signature}`;
}

function parseServiceAccount(config) {
  let sa = config.serviceAccount;
  if (!sa && config.serviceAccountJson) { try { sa = JSON.parse(config.serviceAccountJson); } catch (_) { return null; } }
  if (!sa || !sa.client_email || !sa.private_key) return null;
  return sa;
}

async function gdriveToken(sa) {
  const res = await requestOnce(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(gdriveAssertion(sa))}`,
  });
  if (res.status < 200 || res.status >= 300) {
    let msg = `token request failed (HTTP ${res.status})`;
    try { const j = JSON.parse(res.text); if (j.error_description || j.error) msg = j.error_description || j.error; } catch (_) {}
    return { ok: false, error: msg };
  }
  try { return { ok: true, token: JSON.parse(res.text).access_token }; }
  catch (_) { return { ok: false, error: 'Could not read the access token from Google.' }; }
}

const gdrive = {
  async upload(config, filePath, name) {
    const sa = parseServiceAccount(config);
    if (!sa) return { ok: false, error: 'The service-account key is missing or not valid JSON.' };
    const tok = await gdriveToken(sa);
    if (!tok.ok) return { ok: false, error: 'Google sign-in failed: ' + tok.error };

    const meta = { name };
    if (config.folderId) meta.parents = [config.folderId];

    // Resumable upload: start a session, then stream the file to the returned
    // URL. Keeps a large backup out of memory.
    const size = fs.statSync(filePath).size;
    const start = await requestOnce('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok.token, 'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/zip', 'X-Upload-Content-Length': String(size) },
      body: Buffer.from(JSON.stringify(meta)),
    });
    if (start.status < 200 || start.status >= 300) return { ok: false, error: `Google refused the upload (HTTP ${start.status}).` };
    const sessionUrl = start.headers && start.headers.location;
    if (!sessionUrl) return { ok: false, error: 'Google did not return an upload URL.' };

    const put = await requestOnce(sessionUrl, {
      method: 'PUT', headers: { 'Content-Length': String(size), 'Content-Type': 'application/zip' },
      body: fs.createReadStream(filePath), timeoutMs: 15 * 60000,
    });
    if (put.status >= 200 && put.status < 300) { try { return { ok: true, id: JSON.parse(put.text).id }; } catch (_) { return { ok: true }; } }
    return { ok: false, error: `The upload to Google Drive failed (HTTP ${put.status}).` };
  },
  async verify(config) {
    const sa = parseServiceAccount(config);
    if (!sa) return { ok: false, error: 'Paste the whole service-account JSON key — it needs client_email and private_key.' };
    const tok = await gdriveToken(sa);
    if (!tok.ok) return { ok: false, error: 'Google sign-in failed: ' + tok.error };
    // Prove we can actually create (and then remove) a file — a valid token is
    // not proof the folder is shared with the service account.
    const up = await gdrive.upload({ ...config, serviceAccount: sa }, probeFile(), PROBE_NAME);
    if (!up.ok) return { ok: false, error: up.error };
    if (up.id) {
      await requestOnce(`https://www.googleapis.com/drive/v3/files/${up.id}?supportsAllDrives=true`, {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + tok.token },
      });
    }
    return { ok: true };
  },
};

// A throwaway probe file on disk (Drive's upload streams from a path).
let _probePath = null;
function probeFile() {
  if (_probePath && fs.existsSync(_probePath)) return _probePath;
  _probePath = path.join(require('os').tmpdir(), `nickland-probe-${process.pid}.txt`);
  fs.writeFileSync(_probePath, PROBE_BODY);
  return _probePath;
}

// ── registry ────────────────────────────────────────────────────────────────
const PROVIDERS = { s3, webdav, gdrive };
const REMOTE_TYPES = ['s3', 'webdav', 'gdrive'];

function isRemote(type) { return REMOTE_TYPES.includes(type); }

async function verifyRemote(type, config) {
  const p = PROVIDERS[type];
  if (!p) return { ok: false, error: `Unknown destination type: ${type}` };
  try { return await p.verify(config || {}); }
  catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}
async function uploadRemote(type, config, filePath, name) {
  const p = PROVIDERS[type];
  if (!p) return { ok: false, error: `Unknown destination type: ${type}` };
  try { return await p.upload(config || {}, filePath, name); }
  catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}

module.exports = {
  REMOTE_TYPES, isRemote, verifyRemote, uploadRemote,
  // exposed for tests:
  signS3, s3Request, webdavUrl, gdriveAssertion, encodeS3Path,
};
