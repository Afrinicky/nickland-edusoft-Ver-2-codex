// Nickland Edusoft — Notification Transport (live SMS + Email)
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Actually delivers messages over the wire:
//   • SMS   — Arkesel v2 REST API (pure https, no dependency).
//   • Email — SMTP via nodemailer (loaded lazily; degrades to a logged
//             "simulated" state if the package or config is absent).
//
// Sends are fire-and-forget from the caller's perspective: dispatch() runs
// asynchronously and updates the notification_log row to sent / failed /
// simulated so a payment never blocks on the network.

const https = require('https');
const net = require('net');
const tls = require('tls');
const os = require('os');
const { getSetting } = require('../utils/idgen');

// Normalise a local Ghana number to MSISDN (233XXXXXXXXX) for the SMS API.
function normalizeMsisdn(raw) {
  let s = String(raw || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('0')) s = '233' + s.slice(1);
  else if (s.startsWith('233')) { /* already international */ }
  else if (s.length === 9) s = '233' + s; // 9-digit local without leading 0
  return s;
}

function isEmail(s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim()); }

function httpsRequest(options, body) {
  return new Promise((resolve) => {
    try {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, data }));
      });
      req.on('error', (e) => resolve({ status: 0, data: '', error: e.message }));
      req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, data: '', error: 'timeout' }); });
      if (body) req.write(body);
      req.end();
    } catch (e) { resolve({ status: 0, data: '', error: e.message }); }
  });
}

// ── SMS via Arkesel ──
async function sendSms(db, to, message) {
  const provider = getSetting(db, 'sms_provider', 'arkesel');
  const apiKey = getSetting(db, 'sms_api_key', '');
  // Arkesel rejects a sender ID over 11 characters outright, and the school
  // sees a failed send rather than "your school name is too long". Trim it
  // here so a name typed in before the field grew a maxLength still delivers.
  const sender = String(getSetting(db, 'sms_sender_id', 'EduSoft') || 'EduSoft').trim().slice(0, 11);
  if (!apiKey) return { ok: false, simulated: true, error: 'no_api_key' };
  const msisdn = normalizeMsisdn(to);
  if (!msisdn) return { ok: false, error: 'invalid_recipient' };

  if (provider === 'arkesel') {
    const payload = JSON.stringify({ sender, message, recipients: [msisdn] });
    const res = await httpsRequest({
      method: 'POST', host: 'sms.arkesel.com', path: '/api/v2/sms/send',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, payload);
    let ok = res.status >= 200 && res.status < 300;
    try { const j = JSON.parse(res.data); if (j && j.status && String(j.status).toLowerCase() !== 'success') ok = false; } catch (_) {}
    return { ok, status: res.status, response: (res.data || res.error || '').slice(0, 500) };
  }
  return { ok: false, error: `unsupported_sms_provider:${provider}` };
}

// ── Email (provider-selectable: Resend HTTP API or self-contained SMTP) ──
async function sendEmail(db, opts) {
  if (!isEmail(opts.to)) return { ok: false, error: 'invalid_recipient' };
  const provider = getSetting(db, 'email_provider', 'smtp'); // 'smtp' | 'resend'
  if (provider === 'resend') return await sendEmailResend(db, opts);
  return await sendEmailSmtp(db, opts);
}

// Resend (https://resend.com) — cloud-friendly HTTP API, no SMTP handshake.
async function sendEmailResend(db, opts) {
  const apiKey = getSetting(db, 'resend_api_key', '');
  const from = getSetting(db, 'email_from', '');
  if (!apiKey || !from) return { ok: false, simulated: true, error: 'resend_not_configured' };
  const payload = JSON.stringify({
    from, to: [opts.to],
    subject: opts.subject || 'Payment Receipt',
    html: opts.html || undefined,
    text: opts.text || undefined,
  });
  const res = await httpsRequest({
    method: 'POST', host: 'api.resend.com', path: '/emails',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  }, payload);
  const ok = res.status >= 200 && res.status < 300;
  return { ok, status: res.status, response: (res.data || res.error || '').slice(0, 500) };
}

async function sendEmailSmtp(db, opts) {
  const host = getSetting(db, 'email_smtp_host', '');
  const port = parseInt(getSetting(db, 'email_smtp_port', '587'), 10) || 587;
  const user = getSetting(db, 'email_smtp_user', '');
  const pass = getSetting(db, 'email_smtp_pass', '');
  const from = getSetting(db, 'email_from', '') || user;
  if (!host || !user || !pass) return { ok: false, simulated: true, error: 'smtp_not_configured' };
  const mime = buildMime({ from, to: opts.to, subject: opts.subject || 'Payment Receipt', text: opts.text || '', html: opts.html || '' });
  try {
    const resp = await smtpSend({ host, port, user, pass, from, to: opts.to, data: mime });
    return { ok: true, response: String(resp).slice(0, 200) };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}

// Build a MIME message. Uses base64 bodies so no dot-stuffing / line-length
// handling is needed. multipart/alternative when both text and html present.
function buildMime({ from, to, subject, text, html }) {
  const CRLF = '\r\n';
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1' + CRLF);
  const encHeader = (s) => /[^\x20-\x7E]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=` : s;
  const headersBase = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@nickland-edusoft>`,
    'MIME-Version: 1.0',
  ];
  if (html && text) {
    const boundary = '=_nickland_' + Math.random().toString(36).slice(2);
    return headersBase.concat([
      `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(text), '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(html), '',
      `--${boundary}--`, '',
    ]).join(CRLF);
  }
  const isHtml = !!html;
  return headersBase.concat([
    `Content-Type: text/${isHtml ? 'html' : 'plain'}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64', '', b64(isHtml ? html : text), '',
  ]).join(CRLF);
}

// Minimal SMTP conversation: greeting → EHLO → (STARTTLS) → AUTH LOGIN →
// MAIL FROM → RCPT TO → DATA → QUIT. Resolves on a 250 after the message body.
function smtpSend({ host, port, user, pass, from, to, data }) {
  return new Promise((resolve, reject) => {
    const secure = port === 465;
    let socket = secure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: false })
      : net.connect({ host, port });
    let buf = '';
    let step = 'greet';
    let done = false;
    let replyLines = [];
    const hostname = (os.hostname && os.hostname()) || 'localhost';

    const finish = (err, resp) => {
      if (done) return; done = true;
      try { socket.end(); } catch (_) {}
      try { socket.destroy(); } catch (_) {}
      err ? reject(err) : resolve(resp);
    };
    const timer = setTimeout(() => finish(new Error('smtp_timeout')), 20000);
    const send = (line) => { try { socket.write(line + '\r\n'); } catch (e) { finish(e); } };

    function attach(sock) {
      sock.setEncoding('utf8');
      sock.on('data', onData);
      sock.on('error', (e) => finish(e));
      sock.on('close', () => { if (!done) finish(new Error('smtp_closed')); });
    }
    function upgradeTls() {
      const plain = socket;
      plain.removeListener('data', onData);
      socket = tls.connect({ socket: plain, servername: host, rejectUnauthorized: false }, () => {
        step = 'ehlo2'; send('EHLO ' + hostname);
      });
      socket.setEncoding('utf8');
      socket.on('data', onData);
      socket.on('error', (e) => finish(e));
    }
    function onData(chunk) {
      buf += chunk;
      let idx;
      // Process complete lines; SMTP replies end when a line is "NNN <text>".
      while ((idx = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const m = /^(\d{3})([ -])(.*)$/.exec(line);
        if (!m) continue;
        const code = parseInt(m[1], 10);
        replyLines.push(m[3] || '');
        const last = m[2] === ' ';
        if (!last) continue; // wait for the final line of a multiline reply
        const caps = replyLines.join('\n').toUpperCase();
        replyLines = [];
        handle(code, caps);
      }
    }
    function handle(code, caps) {
      switch (step) {
        case 'greet':
          if (code !== 220) return finish(new Error('smtp_greet_' + code));
          step = 'ehlo'; send('EHLO ' + hostname); break;
        case 'ehlo':
          if (code !== 250) return finish(new Error('smtp_ehlo_' + code));
          // Upgrade to TLS only when the server offers it and we're not already secure.
          if (!secure && /STARTTLS/.test(caps)) { step = 'starttls'; send('STARTTLS'); }
          else { step = 'auth'; send('AUTH LOGIN'); }
          break;
        case 'starttls':
          if (code !== 220) return finish(new Error('smtp_starttls_' + code));
          clearTimeout(timer); upgradeTls(); break;
        case 'ehlo2':
          if (code !== 250) return finish(new Error('smtp_ehlo2_' + code));
          step = 'auth'; send('AUTH LOGIN'); break;
        case 'auth':
          if (code !== 334) return finish(new Error('smtp_auth_' + code));
          step = 'authuser'; send(Buffer.from(user, 'utf8').toString('base64')); break;
        case 'authuser':
          if (code !== 334) return finish(new Error('smtp_authuser_' + code));
          step = 'authpass'; send(Buffer.from(pass, 'utf8').toString('base64')); break;
        case 'authpass':
          if (code !== 235) return finish(new Error('smtp_auth_failed_' + code));
          step = 'mail'; send(`MAIL FROM:<${from}>`); break;
        case 'mail':
          if (code !== 250) return finish(new Error('smtp_mailfrom_' + code));
          step = 'rcpt'; send(`RCPT TO:<${to}>`); break;
        case 'rcpt':
          if (code !== 250 && code !== 251) return finish(new Error('smtp_rcpt_' + code));
          step = 'data'; send('DATA'); break;
        case 'data':
          if (code !== 354) return finish(new Error('smtp_data_' + code));
          step = 'body';
          socket.write(data + '\r\n.\r\n');
          break;
        case 'body':
          if (code !== 250) return finish(new Error('smtp_body_' + code));
          step = 'quit'; clearTimeout(timer); send('QUIT'); finish(null, code); break;
        default: break;
      }
    }
    socket.on('connect', () => {});
    socket.on('secureConnect', () => {});
    attach(socket);
  });
}

// Send one message on one channel and record the outcome on its log row.
// Never throws. Returns the transport result.
async function dispatch(db, logId, channel, to, message, opts = {}) {
  let res;
  try {
    if (channel === 'sms')        res = await sendSms(db, to, message);
    else if (channel === 'email') res = await sendEmail(db, { to, subject: opts.subject, text: message, html: opts.html });
    else                          res = { ok: false, error: `unknown_channel:${channel}` };
  } catch (e) { res = { ok: false, error: (e && e.message) || String(e) }; }

  const status = res.ok ? 'sent' : (res.simulated ? 'simulated' : 'failed');
  try {
    db.prepare('UPDATE notification_log SET delivery_status = ?, api_response = ? WHERE id = ?')
      .run(status, JSON.stringify(res).slice(0, 1000), logId);
  } catch (_) {}
  return res;
}

// Fire-and-forget wrapper — schedule the send without blocking the caller.
function dispatchAsync(db, logId, channel, to, message, opts = {}) {
  Promise.resolve().then(() => dispatch(db, logId, channel, to, message, opts)).catch(() => {});
}

module.exports = { sendSms, sendEmail, dispatch, dispatchAsync, normalizeMsisdn, isEmail };
