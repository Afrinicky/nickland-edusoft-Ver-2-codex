// Nickland Edusoft — Backup scheduling & destination helpers
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Pure, testable helpers for automated backups:
//   • isBackupDue()  — decide whether a scheduled backup should run now
//   • copyToFolders()— fan a backup file out to local / LAN / cloud folders
//   • pruneRetention()— keep only the newest N automatic backups per folder
//
// "Cloud" backup is any folder your machine syncs to a drive of choice
// (Google Drive Desktop, OneDrive, Dropbox, …). Pointing a destination at that
// folder gives real cloud backups with no credentials to manage — and it works
// for ANY provider. A direct Drive-API adapter can be added later without
// changing this contract.

const fs = require('fs');
const path = require('path');

const AUTO_LABEL = 'auto';
const FILE_GLOB = /^nickland-edusoft-backup-.*\.zip$/i;
const AUTO_GLOB = /^nickland-edusoft-backup-auto-.*\.zip$/i;

function getSetting(db, key, fallback) {
  try { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return r ? r.value : fallback; }
  catch (_) { return fallback; }
}

// Read the automated-backup configuration from settings.
function getConfig(db) {
  return {
    enabled: getSetting(db, 'backup_auto_enabled', 'false') === 'true',
    frequency: getSetting(db, 'backup_frequency', 'daily'),   // hourly | daily | weekly
    time: getSetting(db, 'backup_time', '20:00'),             // HH:MM (daily/weekly)
    dayOfWeek: parseInt(getSetting(db, 'backup_day_of_week', '0'), 10) || 0, // 0=Sun
    retention: Math.max(1, parseInt(getSetting(db, 'backup_retention', '10'), 10) || 10),
    folderPath: (getSetting(db, 'backup_folder_path', '') || '').trim(),   // custom local / LAN / network
    cloudPath: (getSetting(db, 'backup_cloud_path', '') || '').trim(),     // cloud-sync folder
    lastAutoAt: getSetting(db, 'backup_last_auto_at', '') || null,
  };
}

// Decide whether a scheduled backup is due. `now` and `last` are Date | null.
function isBackupDue(cfg, now = new Date(), last = null) {
  if (!cfg.enabled) return false;
  const lastMs = last ? last.getTime() : 0;

  if (cfg.frequency === 'hourly') {
    // Due if it's been ~an hour (55-min tolerance so a 60s tick never skips).
    return (now.getTime() - lastMs) >= 55 * 60 * 1000;
  }

  const [hh, mm] = String(cfg.time || '20:00').split(':').map(n => parseInt(n, 10));
  const scheduled = new Date(now);
  scheduled.setHours(isNaN(hh) ? 20 : hh, isNaN(mm) ? 0 : mm, 0, 0);

  if (cfg.frequency === 'weekly') {
    if (now.getDay() !== cfg.dayOfWeek) return false;
  }
  // Daily & weekly: the scheduled time today has passed, and we haven't backed
  // up since that moment.
  return now.getTime() >= scheduled.getTime() && lastMs < scheduled.getTime();
}

// The set of destination folders for a backup (excluding the default folder,
// which the backup routine writes to directly).
function destinationFolders(cfg) {
  return [cfg.folderPath, cfg.cloudPath].filter(Boolean);
}

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

// Copy one backup file into each destination folder. Never throws; returns a
// per-folder result so the UI can show which destinations succeeded.
function copyToFolders(srcPath, folders) {
  const results = [];
  const name = path.basename(srcPath);
  for (const folder of folders) {
    try {
      ensureDir(folder);
      const dest = path.join(folder, name);
      fs.copyFileSync(srcPath, dest);
      results.push({ folder, ok: true, path: dest });
    } catch (e) {
      results.push({ folder, ok: false, error: e.message });
    }
  }
  return results;
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

module.exports = {
  AUTO_LABEL, FILE_GLOB, AUTO_GLOB,
  getConfig, isBackupDue, destinationFolders, copyToFolders, pruneRetention, ensureDir,
};
