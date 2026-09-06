// Nickland Edusoft — the installed application as a client of another PC.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A school has more than one office. The bursar's desk, the head teacher's
// room, the admissions counter — and one of those machines holds the records.
// This is the same installer on the other machines: it opens no database,
// starts no server and owns nothing. It shows the school that IS held on the
// host, over the school's own network.
//
// Set one variable and this install becomes a client:
//
//   EDUSOFT_HOST_URL=http://192.168.1.20:4747
//
// Leave it unset — which is what every existing install does — and none of
// this runs. The application opens its own database and behaves in every
// respect as it did before, which is the point: the office PC is untouched by
// the existence of the machines that talk to it.
//
// It loads the office application's browser build FROM the host, so a client
// is never a version behind: upgrade the host and every desk in the school is
// upgraded with it. There is no second thing to install and nothing to keep
// in step.

const path = require('path');

function hostUrl() {
  const raw = String(process.env.EDUSOFT_HOST_URL || '').trim();
  if (!raw) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(withScheme);
    // The host listens on 4747 unless somebody moved it, and typing an IP
    // address without a port is what a person will do.
    if (!url.port && url.protocol === 'http:') url.port = '4747';
    return url.origin;
  } catch (_) {
    return withScheme.replace(/\/+$/, '');
  }
}

function isClient() { return !!hostUrl(); }

// ── The two screens a client can show before the application ─────────────────
// A client that cannot reach its host must say so in words a school can act
// on. "ERR_CONNECTION_REFUSED" is not one of those.

function shellHtml(body) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Nickland Edusoft</title><style>
    html,body{height:100%;margin:0}
    body{font-family:Inter,"Segoe UI",system-ui,Arial,sans-serif;color:#F4F7FC;
      background:linear-gradient(160deg,#1B3A6B 0%,#12264A 100%);
      display:flex;align-items:center;justify-content:center;padding:24px}
    .wrap{display:flex;flex-direction:column;align-items:center;text-align:center;gap:14px;max-width:520px}
    .title{font-size:24px;font-weight:700}
    .sub{font-size:13px;color:#9FB4D6;margin-top:-6px}
    h2{margin:10px 0 0;font-size:17px;font-weight:600}
    p{margin:0;color:#B9C8E2;font-size:14px;line-height:1.6}
    code{background:rgba(255,255,255,0.10);padding:2px 7px;border-radius:6px;font-size:13px}
    ul{text-align:left;color:#B9C8E2;font-size:13.5px;line-height:1.8;margin:4px 0 0;padding-left:20px}
    .spinner{width:32px;height:32px;border-radius:50%;border:3px solid rgba(255,255,255,0.16);
      border-top-color:#7FA8F0;animation:spin .8s linear infinite;margin-top:6px}
    @keyframes spin{to{transform:rotate(360deg)}}
    button{font-family:inherit;font-size:14px;font-weight:600;color:#12264A;border:0;cursor:pointer;
      padding:11px 24px;border-radius:9px;background:#F0C64B;margin-top:10px}
  </style></head><body><div class="wrap">${body}</div></body></html>`;
}

const BRAND = '<div><div class="title">Nickland Edusoft</div><div class="sub">Nickland Sales</div></div>';

function connectingPage(host) {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(shellHtml(
    `${BRAND}<div class="spinner"></div><p>Connecting to the school’s computer at <code>${host}</code>…</p>`
  ));
}

function unreachablePage(host, detail) {
  const safe = String(detail || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(shellHtml(
    `${BRAND}<h2>The school’s computer did not answer</h2>` +
    `<p>This computer is set up to work from <code>${host}</code>, and nothing answered there.</p>` +
    '<ul>' +
    '<li>Is that computer switched on, with Nickland Edusoft open?</li>' +
    '<li>On it, does <strong>Settings → Mobile App</strong> show the server running?</li>' +
    '<li>Are both computers on the same network?</li>' +
    '<li>Is the address above the one that screen shows?</li>' +
    '</ul>' +
    (safe ? `<p style="color:#7E90AE;font-size:12px">${safe}</p>` : '') +
    '<button onclick="location.reload()">Try again</button>'
  ));
}

// Is anybody home? Asked before the window is pointed at the host, so that a
// school gets the screen above rather than Chromium's.
async function reachable(host) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${host}/api/v1/desk/info`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, error: `The host answered ${res.status}.` };
    const info = await res.json();
    if (!info || !info.desk) return { ok: false, error: 'That address is not a Nickland Edusoft school.' };
    return { ok: true, info };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

module.exports = { hostUrl, isClient, connectingPage, unreachablePage, reachable };
