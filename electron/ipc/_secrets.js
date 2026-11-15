// Nickland Edusoft — which settings are secrets, said once.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The school's `settings` table holds its own letterhead beside its own
// credentials: the crest and the motto in the same rows as the key that moves
// money through Paystack and the key that sends a text message to every parent
// in the school. One table, two completely different kinds of value.
//
// `electron/server/admin_api.js` already knew this and kept a write-only list
// of its own, which is why the LAN system settings route has never handed a
// gateway secret to a browser. The IPC channel `settings:get-all` did not
// know, and it is in ALWAYS_ALLOWED — so every signed-in account, a class
// teacher included, could read every credential the school owns, at the office
// PC and through /desk/call on the school Wi-Fi.
//
// Two lists in two files is how that happens: one of them gets a new key added
// to it and the other does not. So the list lives here now, on its own, and
// everything that reads settings out to anybody reads it from here.
//
// ── What belongs on this list ───────────────────────────────────────────────
//
// Anything that lets the holder act AS the school: take its money, spend its
// SMS credits, send mail from its address, or speak to its cloud. Half of a
// credential pair counts — Hubtel's client id is on the list for the same
// reason its secret is, because an id that is one of two things you need is
// one of two things you need.
//
// `school_api_key` is on it for a reason worth naming: it authenticates
// /api/v1/sync/push and /sync/pull, so it is not merely a secret, it is
// read-and-write access to everything the school has in the cloud.

// Written, never read back. A secret a screen can display is a secret a
// screenshot can carry out of the building.
const WRITE_ONLY = new Set([
  // Payment gateways — the school's own money.
  'paystack_secret_key',
  'flutterwave_secret_key', 'flutterwave_secret_hash',
  'hubtel_client_id', 'hubtel_client_secret',
  'expresspay_api_key',
  // Talking to parents — the school's own voice, and its own credits.
  'sms_api_key',
  'resend_api_key',
  'email_smtp_pass',
  // Talking to the cloud — read and write access to the school's cloud data.
  'school_api_key',
]);

// Not here, and deliberately: the backup destinations' credentials — an S3
// secret, a WebDAV password, a Google service-account key — are not settings
// rows at all. They are nested fields inside a destination record, sealed by
// the OS keystore and decrypted only in the main process at the moment of an
// upload. `electron/ipc/backup_secrets.js` owns that, and it already never
// sends them to a screen. Listing invented key names here would have implied a
// protection this file does not provide.

function isSecret(key) {
  return WRITE_ONLY.has(String(key || ''));
}

// Replace every secret value with the empty string, and say separately which
// of them are actually set.
//
// Emptied rather than removed, and emptied rather than starred: a screen that
// prefills a password box reads this, and `''` is the value it already handles
// — it means "the one already saved", which is what Payments.jsx has always
// documented and what Cloud.jsx has always done. A row of bullet characters
// would be read back as a literal password by the next Save.
//
// `_secrets_configured` travels beside it so a screen can still say "a key is
// saved" without being told the key. The leading underscore keeps it from
// colliding with a real settings category.
function redactGrouped(grouped) {
  const out = {};
  const configured = {};
  for (const [category, entries] of Object.entries(grouped || {})) {
    if (!entries || typeof entries !== 'object') { out[category] = entries; continue; }
    const copy = {};
    for (const [key, value] of Object.entries(entries)) {
      if (isSecret(key)) {
        configured[key] = !!(value && String(value).length);
        copy[key] = '';
      } else {
        copy[key] = value;
      }
    }
    out[category] = copy;
  }
  out._secrets_configured = configured;
  return out;
}

module.exports = { WRITE_ONLY, isSecret, redactGrouped };
