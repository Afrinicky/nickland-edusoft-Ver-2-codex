// Nickland Edusoft — backup destination secrets at rest
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Cloud destinations carry credentials — an S3 secret key, a WebDAV password, a
// Google service-account key. They are encrypted before they touch the database
// using the OS keystore (Electron safeStorage → DPAPI on Windows, Keychain on
// macOS, libsecret on Linux), so a stolen .db file does not hand over the
// school's cloud storage. They are decrypted only in the main process, only at
// the moment of an upload, and never sent to the screen.
//
// If the OS keystore is unavailable (a stripped Linux box, a test runner) the
// value is stored in the clear and TAGGED as such, so the UI can warn rather
// than silently pretending it is protected.

const ENC = '__enc';       // { __enc: base64 }  — OS-encrypted
const PLAIN = '__plain';   // { __plain: str }   — stored in the clear (no keystore)

// Which fields of each destination type are secret.
const SECRET_FIELDS = {
  s3: ['secretAccessKey'],
  webdav: ['password'],
  gdrive: ['serviceAccountJson'],
};

function safeStorage() {
  try { return require('electron').safeStorage; } catch (_) { return null; }
}
function canEncrypt() {
  const s = safeStorage();
  try { return !!(s && s.isEncryptionAvailable && s.isEncryptionAvailable()); } catch (_) { return false; }
}

function sealValue(plain) {
  if (plain == null || plain === '') return null;
  const s = safeStorage();
  if (canEncrypt()) {
    try { return { [ENC]: s.encryptString(String(plain)).toString('base64') }; } catch (_) { /* fall through */ }
  }
  return { [PLAIN]: String(plain) };
}

function openValue(sealed) {
  if (sealed == null) return '';
  if (typeof sealed === 'string') return sealed;   // legacy plaintext
  if (sealed[PLAIN] != null) return sealed[PLAIN];
  if (sealed[ENC] != null) {
    const s = safeStorage();
    try { return s.decryptString(Buffer.from(sealed[ENC], 'base64')); } catch (_) { return ''; }
  }
  return '';
}

function isSealed(v) { return v && typeof v === 'object' && (v[ENC] != null || v[PLAIN] != null); }
function hasSecret(v) { return isSealed(v) || (typeof v === 'string' && v !== ''); }

// Encrypt an incoming (plaintext) config for storage. Non-secret fields pass
// through untouched.
function sealConfig(type, config) {
  const secrets = SECRET_FIELDS[type] || [];
  const out = { ...(config || {}) };
  for (const f of secrets) {
    if (out[f] !== undefined) out[f] = sealValue(out[f]);
  }
  return out;
}

// Decrypt a stored config back to plaintext — main process only, upload time.
function openConfig(type, config) {
  const secrets = SECRET_FIELDS[type] || [];
  const out = { ...(config || {}) };
  for (const f of secrets) {
    if (out[f] !== undefined) out[f] = openValue(out[f]);
  }
  // Google's service account arrives as a JSON string; parse it for the provider.
  if (type === 'gdrive' && typeof out.serviceAccountJson === 'string' && out.serviceAccountJson) {
    try { out.serviceAccount = JSON.parse(out.serviceAccountJson); } catch (_) {}
  }
  return out;
}

// Strip secrets for the renderer, leaving a flag so the form can show
// "•••• saved" and whether encryption is actually in force.
function redactConfig(type, config) {
  const secrets = SECRET_FIELDS[type] || [];
  const out = { ...(config || {}) };
  for (const f of secrets) {
    const present = hasSecret(out[f]);
    delete out[f];
    out[`${f}__set`] = present;
    out[`${f}__encrypted`] = isSealed(config && config[f]) && config[f][ENC] != null;
  }
  return out;
}

// Merge an edit: a blank secret field means "keep what is already stored".
function mergeConfig(type, existing, incoming) {
  const secrets = SECRET_FIELDS[type] || [];
  const merged = { ...(existing || {}), ...(incoming || {}) };
  for (const f of secrets) {
    const provided = incoming && incoming[f] !== undefined && incoming[f] !== '' && incoming[f] !== null;
    if (provided) merged[f] = sealValue(incoming[f]);          // new secret → encrypt
    else if (existing && existing[f] !== undefined) merged[f] = existing[f];  // keep old sealed value
    else delete merged[f];
  }
  // Drop any redaction flags the renderer echoed back.
  for (const k of Object.keys(merged)) if (/__set$|__encrypted$/.test(k)) delete merged[k];
  return merged;
}

module.exports = { SECRET_FIELDS, canEncrypt, sealConfig, openConfig, redactConfig, mergeConfig, sealValue, openValue };
