// Nickland Edusoft — Mobile Companion Sync (SCAFFOLDING ONLY)
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// ─────────────────────────────────────────────────────────────────────────
// PURPOSE
// This module is a PLACEHOLDER for the future mobile companion app.
// The desktop app remains the HOST (source of truth). A future mobile app
// will pair to a desktop instance over the local network and sync data.
//
// CURRENT STATE: The endpoints exist and respond, but no actual HTTP server
// or socket is opened. Enabling mobile_sync_enabled in Settings does NOT
// expose anything over the network. This is intentional — we want the
// scaffolding without the security implications until the mobile app exists.
//
// ARCHITECTURE (planned, NOT IMPLEMENTED YET)
//
//   ┌──────────────────────────┐         ┌──────────────────────────┐
//   │  Desktop (HOST)          │         │  Mobile companion        │
//   │  Nickland Edusoft        │ ←HTTPS→ │  iOS / Android app       │
//   │  SQLite DB (canonical)   │  +mDNS  │  Read-only / scoped CRUD │
//   └──────────────────────────┘         └──────────────────────────┘
//
//   1. Desktop opens local HTTP(S) server on mobile_sync_port.
//   2. Mobile scans LAN, finds desktop via mDNS broadcast.
//   3. User generates a pairing token on desktop (mobile-sync:generate-token).
//   4. User enters the token on mobile to pair the device.
//   5. Desktop stores device fingerprint in mobile_paired_devices.
//   6. Mobile uses bearer token (per-device) for all subsequent API calls.
//   7. Endpoints exposed (read-only for v1):
//        GET  /api/v1/students      → list students
//        GET  /api/v1/staff         → list staff
//        GET  /api/v1/dashboard     → metrics snapshot
//        GET  /api/v1/fees/owed     → fee debtors
//        POST /api/v1/attendance    → mark attendance from mobile
//   8. All requests are LAN-only (no public exposure). The mobile app
//      cannot reach the desktop unless they share a network.
//
// SECURITY MODEL (planned)
//   - Pairing requires user action on the desktop (token visible on screen)
//   - Each paired device has a unique long-lived bearer token
//   - Tokens are revocable from Settings → Mobile Sync
//   - All data is encrypted in transit (HTTPS with self-signed cert)
//   - No remote (off-LAN) access by default
//
// To implement in the future:
//   1. Replace the stub handlers below with a real Express/Fastify server.
//   2. Add mDNS broadcast via the 'bonjour-service' npm package.
//   3. Add per-device token generation with crypto.randomBytes(32).
//   4. Build the mobile client (React Native or Expo).
//
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

module.exports = function registerMobileSyncHandlers(ipcMain, db) {

  function isEnabled() {
    const r = db.prepare("SELECT value FROM settings WHERE key = 'mobile_sync_enabled'").get();
    return r ? r.value === 'true' : false;
  }

  // Generate a 6-digit pairing token shown on screen during pairing flow.
  // Token is valid for 10 minutes — after that it must be regenerated.
  ipcMain.handle('mobile-sync:generate-token', () => {
    const token = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.prepare("UPDATE settings SET value = ? WHERE key = 'mobile_device_pairing_token'")
      .run(JSON.stringify({ token, expires_at: expiresAt }));
    return { ok: true, token, expires_at: expiresAt };
  });

  // Return current sync status (enabled, port, paired device count)
  ipcMain.handle('mobile-sync:status', () => {
    const enabled = isEnabled();
    const port = db.prepare("SELECT value FROM settings WHERE key = 'mobile_sync_port'").get()?.value || '4747';
    const devicesRaw = db.prepare("SELECT value FROM settings WHERE key = 'mobile_paired_devices'").get()?.value || '[]';
    let devices = [];
    try { devices = JSON.parse(devicesRaw); } catch (e) { devices = []; }
    const lastSync = db.prepare("SELECT value FROM settings WHERE key = 'mobile_last_sync_at'").get()?.value || '';
    return {
      ok: true,
      enabled,
      port,
      devices,
      device_count: devices.length,
      last_sync_at: lastSync || null,
      server_running: false, // future flag — set true when the HTTP server starts
      message: enabled
        ? 'Mobile sync is enabled. The companion app is not yet released; this connection is reserved for a future update.'
        : 'Mobile sync is disabled. The companion app will be available in a future release.',
    };
  });

  // Revoke a paired device
  ipcMain.handle('mobile-sync:revoke-device', (_e, deviceId) => {
    const raw = db.prepare("SELECT value FROM settings WHERE key = 'mobile_paired_devices'").get()?.value || '[]';
    let devices = [];
    try { devices = JSON.parse(raw); } catch (e) {}
    devices = devices.filter(d => d.id !== deviceId);
    db.prepare("UPDATE settings SET value = ? WHERE key = 'mobile_paired_devices'")
      .run(JSON.stringify(devices));
    return { ok: true, remaining: devices.length };
  });

  // NOTE — this is a placeholder. In v1 of mobile sync, the desktop app
  // will open an HTTPS server on mobile_sync_port and respond to LAN
  // requests from paired mobile devices. For now, this is a no-op.
  ipcMain.handle('mobile-sync:test-server', () => {
    if (!isEnabled()) {
      return { ok: false, error: 'Mobile sync is disabled. Enable it in Settings → Mobile App first.' };
    }
    return {
      ok: true,
      message: 'Mobile sync server is reserved for a future release. No connection is active.',
      placeholder: true,
    };
  });
};
