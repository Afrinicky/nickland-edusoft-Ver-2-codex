// Nickland Edusoft — Backup scheduling, destinations & status helpers
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Pure, testable helpers behind the Backup & Restore screen. No Electron, no
// database driver of its own — everything takes a db handle (anything with
// `.prepare`) or plain data, so the whole scheduling brain runs under the test
// suite on node:sqlite.
//
// The model, in the operator's words:
//   • WHEN backups happen — Manual only, Every night, or Twice a day.
//   • WHERE the first copy is kept — the default folder on this PC.
//   • WHERE copies go after that — a list of destinations (a shared folder on
//     the network, a second disk, a USB drive, or any folder a cloud client
//     syncs). Each can be tested, paused, edited or removed, and a copy that
//     could not be delivered is remembered and retried, not lost.

const fs = require('fs');
const path = require('path');

const AUTO_LABEL = 'auto';
const FILE_GLOB = /^nickland-edusoft-backup-.*\.zip$/i;
const AUTO_GLOB = /^nickland-edusoft-backup-auto-.*\.zip$/i;

// Schedule modes offered to the operator. 'daily' is kept as an alias of
// 'nightly' so a config written by an older build still means the same thing.
const MODES = ['manual', 'hourly', 'nightly', 'twice', 'weekly', 'monthly', 'custom'];
const DEFAULT_TIME = '02:00';
const DEFAULT_TIME2 = '14:00';

function getSetting(db, key, fallback) {
  try { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return r ? r.value : fallback; }
  catch (_) { return fallback; }
}

function parseTime(t, dh, dm) {
  const [hh, mm] = String(t || '').split(':').map(n => parseInt(n, 10));
  return { h: Number.isFinite(hh) ? hh : dh, m: Number.isFinite(mm) ? mm : dm };
}

// ── Destinations ────────────────────────────────────────────────────────────
// Stored as one JSON array in `backup_destinations`. Shape per entry:
//   { id, label, kind: 'network'|'local', path, paused, lastCopiedAt, lastError }
function newId() {
  return 'dest_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadDestinations(db) {
  let list = [];
  try {
    const raw = getSetting(db, 'backup_destinations', '');
    if (raw) list = JSON.parse(raw);
  } catch (_) { list = []; }
  if (!Array.isArray(list)) list = [];

  // Migrate the two legacy fixed slots the first time we run without a list.
  if (!list.length) {
    const legacyFolder = (getSetting(db, 'backup_folder_path', '') || '').trim();
    const legacyCloud = (getSetting(db, 'backup_cloud_path', '') || '').trim();
    if (legacyFolder) list.push({ id: newId(), label: 'Network or shared folder', kind: 'network', path: legacyFolder, paused: false });
    if (legacyCloud) list.push({ id: newId(), label: 'Cloud-sync folder', kind: 'local', path: legacyCloud, paused: false });
  }
  return list.map(normalizeDest).filter(d => d.type ? true : !!d.path);
}

// A destination is either a folder (type local|network, with a path) or a
// remote service (type s3|webdav|gdrive, with a config object whose secrets are
// stored encrypted). `kind` is the old field; map it to `type` for old configs.
function normalizeDest(d) {
  let type = d.type;
  if (!type) type = d.kind === 'network' ? 'network' : 'local';
  const REMOTE = ['s3', 'webdav', 'gdrive'];
  return {
    id: d.id || newId(),
    label: d.label || 'Backup destination',
    type,
    kind: type === 'network' ? 'network' : 'local',   // back-compat
    path: String(d.path || ''),
    config: d.config && typeof d.config === 'object' ? d.config : {},
    remote: REMOTE.includes(type),
    paused: !!d.paused,
    lastCopiedAt: d.lastCopiedAt || null,
    lastError: d.lastError || null,
  };
}

function saveDestinations(db, list, setSetting) {
  const clean = (list || []).map(d => {
    const n = normalizeDest(d);
    // Persist only what belongs on disk (drop the derived `remote` flag).
    return { id: n.id, label: n.label, type: n.type, path: n.path, config: n.config,
      paused: n.paused, lastCopiedAt: n.lastCopiedAt, lastError: n.lastError };
  }).filter(d => (['s3', 'webdav', 'gdrive'].includes(d.type)) ? true : !!d.path);
  setSetting(db, 'backup_destinations', JSON.stringify(clean), 'backup');
  return clean;
}

// ── Config ──────────────────────────────────────────────────────────────────
function getConfig(db) {
  const rawMode = getSetting(db, 'backup_schedule_mode', '');
  const legacyEnabled = getSetting(db, 'backup_auto_enabled', 'false') === 'true';
  const legacyFreq = getSetting(db, 'backup_frequency', 'daily');

  let mode = rawMode;
  if (!mode) {
    // Derive a mode from an older config so nothing changes under the operator.
    if (!legacyEnabled) mode = 'manual';
    else if (legacyFreq === 'daily') mode = 'nightly';
    else if (MODES.includes(legacyFreq)) mode = legacyFreq;
    else mode = 'nightly';
  }
  if (mode === 'daily') mode = 'nightly';
  if (!MODES.includes(mode)) mode = 'manual';

  return {
    mode,
    scheduled: mode !== 'manual',
    time: getSetting(db, 'backup_time', DEFAULT_TIME) || DEFAULT_TIME,
    time2: getSetting(db, 'backup_time2', DEFAULT_TIME2) || DEFAULT_TIME2,
    dayOfWeek: parseInt(getSetting(db, 'backup_day_of_week', '0'), 10) || 0, // 0=Sun (weekly)
    dayOfMonth: Math.min(28, Math.max(1, parseInt(getSetting(db, 'backup_day_of_month', '1'), 10) || 1)), // 1-28 (monthly)
    everyN: Math.max(1, parseInt(getSetting(db, 'backup_every_n', '3'), 10) || 3),          // custom: every N…
    everyUnit: (getSetting(db, 'backup_every_unit', 'days') === 'hours') ? 'hours' : 'days', // …days | hours
    retention: Math.max(1, parseInt(getSetting(db, 'backup_retention', '10'), 10) || 10),
    destinations: loadDestinations(db),
    lastAutoAt: getSetting(db, 'backup_last_auto_at', '') || null,
  };
}

// The daily clock times a schedule fires at (sorted, unique). Empty for manual.
function scheduleTimes(cfg) {
  if (cfg.mode === 'nightly' || cfg.mode === 'weekly' || cfg.mode === 'monthly' || cfg.mode === 'custom') return [cfg.time];
  if (cfg.mode === 'twice') {
    const set = [cfg.time, cfg.time2].filter(Boolean);
    return [...new Set(set)].sort();
  }
  return [];
}

// How many days back a mode's most recent slot could sit — so a machine that
// was switched off still catches the slot it missed once it returns.
function lookbackDays(cfg) {
  if (cfg.mode === 'weekly') return 8;
  if (cfg.mode === 'monthly') return 32;
  return 1;
}

// The most recent scheduled slot at or before `now` (a Date), or null. Looks
// back over today's and yesterday's times so an overnight slot is caught the
// next morning.
function lastSlotBefore(cfg, now) {
  const times = scheduleTimes(cfg);
  if (!times.length) return null;
  const back = lookbackDays(cfg);
  let best = null;
  for (let dayOffset = 0; dayOffset >= -back; dayOffset--) {
    for (const t of times) {
      const { h, m } = parseTime(t, 2, 0);
      const slot = new Date(now);
      slot.setDate(slot.getDate() + dayOffset);
      slot.setHours(h, m, 0, 0);
      if (cfg.mode === 'weekly' && slot.getDay() !== cfg.dayOfWeek) continue;
      if (cfg.mode === 'monthly' && slot.getDate() !== cfg.dayOfMonth) continue;
      if (slot.getTime() <= now.getTime() && (!best || slot.getTime() > best.getTime())) best = slot;
    }
  }
  return best;
}

// The next scheduled slot strictly after `now`, or null (for the status card).
function nextRunAt(cfg, now = new Date()) {
  if (cfg.mode === 'manual') return null;
  if (cfg.mode === 'hourly') {
    const last = cfg.lastAutoAt ? new Date(cfg.lastAutoAt) : now;
    return new Date(Math.max(now.getTime(), last.getTime() + 60 * 60 * 1000));
  }
  if (cfg.mode === 'custom') {
    const last = cfg.lastAutoAt ? new Date(cfg.lastAutoAt) : null;
    if (cfg.everyUnit === 'hours') {
      const base = last ? last.getTime() : now.getTime();
      return new Date(Math.max(now.getTime(), base + cfg.everyN * 3600e3));
    }
    // every N days at the chosen time
    const { h, m } = parseTime(cfg.time, 2, 0);
    let slot;
    if (last) { slot = new Date(last.getTime() + cfg.everyN * 86400e3); slot.setHours(h, m, 0, 0); }
    else { slot = new Date(now); slot.setHours(h, m, 0, 0); if (slot.getTime() <= now.getTime()) slot.setDate(slot.getDate() + 1); }
    return slot;
  }
  const times = scheduleTimes(cfg);
  let best = null;
  const horizon = cfg.mode === 'monthly' ? 62 : 8;
  for (let dayOffset = 0; dayOffset <= horizon; dayOffset++) {
    for (const t of times) {
      const { h, m } = parseTime(t, 2, 0);
      const slot = new Date(now);
      slot.setDate(slot.getDate() + dayOffset);
      slot.setHours(h, m, 0, 0);
      if (cfg.mode === 'weekly' && slot.getDay() !== cfg.dayOfWeek) continue;
      if (cfg.mode === 'monthly' && slot.getDate() !== cfg.dayOfMonth) continue;
      if (slot.getTime() > now.getTime() && (!best || slot.getTime() < best.getTime())) best = slot;
    }
    if (best) break;
  }
  return best;
}

// Decide whether a scheduled backup is due. `now` and `last` are Date | null.
function isBackupDue(cfg, now = new Date(), last = null) {
  if (!cfg.scheduled) return false;
  const lastMs = last ? last.getTime() : 0;

  if (cfg.mode === 'hourly') {
    // Due if it's been ~an hour (55-min tolerance so a 60s tick never skips).
    return (now.getTime() - lastMs) >= 55 * 60 * 1000;
  }

  if (cfg.mode === 'custom') {
    if (cfg.everyUnit === 'hours') {
      const tol = Math.min(5 * 60 * 1000, cfg.everyN * 3600e3 * 0.05);
      return (now.getTime() - lastMs) >= cfg.everyN * 3600e3 - tol;
    }
    // Every N days, fired at the chosen time. Computed straight from `last`
    // (the argument), never from cfg.lastAutoAt — the caller owns "last".
    if (!last) return isBackupDue({ ...cfg, mode: 'nightly' }, now, last); // first run: today's time
    const { h, m } = parseTime(cfg.time, 2, 0);
    const next = new Date(lastMs + cfg.everyN * 86400e3);
    next.setHours(h, m, 0, 0);
    return now.getTime() >= next.getTime();
  }

  const slot = lastSlotBefore(cfg, now);
  if (!slot) return false;
  return lastMs < slot.getTime();
}

// ── Copy fan-out & retry ────────────────────────────────────────────────────
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

// Back-compat: the plain list of non-paused destination folder paths.
function destinationFolders(cfg) {
  return (cfg.destinations || []).filter(d => !d.paused && !d.remote && d.path).map(d => d.path);
}

// Split destinations into the folder ones (copied with fs) and the remote ones
// (uploaded over the network), so the fan-out can handle each in its own way.
function splitDestinations(destinations) {
  const local = [], remote = [];
  for (const d of destinations || []) (d.remote ? remote : local).push(d);
  return { local, remote };
}

// Copy one backup file into a set of folders (legacy helper; kept for tests and
// any caller that only has paths). Never throws.
function copyToFolders(srcPath, folders) {
  const results = [];
  const name = path.basename(srcPath);
  for (const folder of folders) {
    try {
      ensureDir(folder);
      fs.copyFileSync(srcPath, path.join(folder, name));
      results.push({ folder, ok: true, path: path.join(folder, name) });
    } catch (e) {
      results.push({ folder, ok: false, error: e.message });
    }
  }
  return results;
}

// Copy one backup file to every non-paused destination, by id. Returns a
// per-destination result AND the failures, so the caller can update each
// destination's status and queue the failures for retry.
function copyToDestinations(srcPath, destinations, fsMod) {
  const fsm = fsMod || fs;
  const name = path.basename(srcPath);
  const results = [];
  for (const d of destinations || []) {
    if (d.paused) { results.push({ id: d.id, skipped: true }); continue; }
    try {
      if (!fsm.existsSync(d.path)) fsm.mkdirSync(d.path, { recursive: true });
      fsm.copyFileSync(srcPath, path.join(d.path, name));
      results.push({ id: d.id, ok: true, path: path.join(d.path, name) });
    } catch (e) {
      results.push({ id: d.id, ok: false, error: (e && e.message) || String(e) });
    }
  }
  return results;
}

// The retry queue — copies that could not be delivered, kept so a destination
// coming back online later is filled in rather than silently missing a backup.
function loadPending(db) {
  try { const raw = getSetting(db, 'backup_pending_copies', ''); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; }
  catch (_) { return []; }
}
function savePending(db, list, setSetting) {
  setSetting(db, 'backup_pending_copies', JSON.stringify(list || []), 'backup');
}

// Attempt every queued copy whose source file still exists. A copy whose source
// is gone (pruned away) is dropped — it can no longer be delivered, and the
// newer backup that replaced it will be. Returns { delivered, remaining }.
function retryPending(db, destinations, setSetting, fsMod) {
  const fsm = fsMod || fs;
  const pending = loadPending(db);
  if (!pending.length) return { delivered: 0, remaining: 0 };
  const byId = new Map((destinations || []).map(d => [d.id, d]));
  const stillPending = [];
  let delivered = 0;
  for (const item of pending) {
    const d = byId.get(item.destId);
    if (!d || d.paused) { stillPending.push(item); continue; }
    if (!fsm.existsSync(item.srcPath)) continue;   // source pruned — drop it
    try {
      if (!fsm.existsSync(d.path)) fsm.mkdirSync(d.path, { recursive: true });
      fsm.copyFileSync(item.srcPath, path.join(d.path, path.basename(item.srcPath)));
      delivered++;
    } catch (_) {
      stillPending.push(item);
    }
  }
  savePending(db, stillPending, setSetting);
  return { delivered, remaining: stillPending.length };
}

// How many copies are waiting for each destination id.
function waitingByDest(db) {
  const counts = {};
  for (const item of loadPending(db)) counts[item.destId] = (counts[item.destId] || 0) + 1;
  return counts;
}

// Is a destination folder reachable and writable? Writes a probe file and
// removes it — the only honest test of "will a backup land here".
function testDestination(folder, fsMod) {
  const fsm = fsMod || fs;
  if (!folder || !String(folder).trim()) return { ok: false, error: 'No folder given.' };
  try {
    if (!fsm.existsSync(folder)) fsm.mkdirSync(folder, { recursive: true });
    const probe = path.join(folder, `.nickland-write-test-${Date.now()}`);
    fsm.writeFileSync(probe, 'ok');
    fsm.unlinkSync(probe);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

// Keep only the newest `keep` automatic backups in a folder; delete older ones.
// Only touches auto-labelled files, so manual/safety backups are never removed.
function pruneRetention(folder, keep) {
  const removed = [];
  try {
    if (!fs.existsSync(folder)) return removed;
    const files = fs.readdirSync(folder)
      .filter(f => AUTO_GLOB.test(f))
      .map(f => ({ f, full: path.join(folder, f), t: fs.statSync(path.join(folder, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const old of files.slice(keep)) {
      try { fs.unlinkSync(old.full); removed.push(old.full); } catch (_) {}
    }
  } catch (_) {}
  return removed;
}

// ── Status ──────────────────────────────────────────────────────────────────
// The three indicators on the hero card, plus an overall verdict.
//   recent   — has a backup been taken recently?
//   scheduled— is one set to run on its own, and when next?
//   offsite  — are copies reaching at least one destination?
function computeStatus(cfg, facts, now = new Date()) {
  const f = facts || {};
  const lastAt = f.lastBackupAt ? new Date(f.lastBackupAt) : null;
  const ageMs = lastAt ? (now.getTime() - lastAt.getTime()) : Infinity;
  // "Recent" tolerance follows the schedule: a nightly school is fine a day
  // later; a manual one is judged against a week.
  const window = cfg.mode === 'twice' ? 18 * 3600e3
    : cfg.mode === 'hourly' ? 3 * 3600e3
    : cfg.mode === 'manual' ? 8 * 24 * 3600e3
    : 30 * 3600e3;
  const recent = { ok: lastAt != null && ageMs <= window, at: f.lastBackupAt || null };

  const scheduled = { ok: cfg.mode !== 'manual', mode: cfg.mode, nextAt: cfg.mode !== 'manual' ? (nextRunAt(cfg, now) || null) : null };

  const active = (cfg.destinations || []).filter(d => !d.paused);
  const failing = active.filter(d => d.lastError).length;
  const offsite = {
    ok: active.length > 0 && failing === 0,
    configured: (cfg.destinations || []).length,
    active: active.length,
    failing,
    waiting: (f.waitingTotal || 0),
  };

  let verdict = 'good';
  if (!recent.ok || (!scheduled.ok && !recent.ok)) verdict = 'at-risk';
  else if (!scheduled.ok || !offsite.ok) verdict = 'gap';
  return { verdict, recent, scheduled, offsite };
}

module.exports = {
  AUTO_LABEL, FILE_GLOB, AUTO_GLOB, MODES, DEFAULT_TIME, DEFAULT_TIME2,
  getConfig, isBackupDue, nextRunAt, scheduleTimes, lastSlotBefore, lookbackDays,
  loadDestinations, saveDestinations, normalizeDest, splitDestinations, newId,
  destinationFolders, copyToFolders, copyToDestinations,
  loadPending, savePending, retryPending, waitingByDest,
  testDestination, pruneRetention, ensureDir, computeStatus,
};
