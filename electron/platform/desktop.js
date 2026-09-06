// Nickland Edusoft — the office PC.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// What the installed application has always done, gathered into one place
// rather than scattered across nine files as `require('electron')`. The code
// below is the code that was in those files; moving it changed nothing about
// what the office PC does.

const fs = require('fs');

// ── Printing ────────────────────────────────────────────────────────────────
//
// Chromium, the one already inside Electron — no second browser to ship.
//
// The HTML goes via a temporary FILE rather than a data: URL, and that is not
// an accident: a whole class of report cards exceeds Chromium's data-URL length
// limit and fails with ERR_INVALID_URL, which looks like a broken report rather
// than a limit being hit.
async function htmlToPdf(html, outPath, options = {}) {
  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  const tmpPath = outPath + '.tmp.html';
  try {
    fs.writeFileSync(tmpPath, html, 'utf8');
    await win.loadFile(tmpPath);
    const data = await win.webContents.printToPDF(options);
    fs.writeFileSync(outPath, data);
    return { ok: true, path: outPath };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* a leftover temp file is not a failure */ }
    try { win.destroy(); } catch (_) {}
  }
}

// ── Photographs ─────────────────────────────────────────────────────────────
//
// Crop to the passport ratio from the centre, then scale. Cropping rather than
// squashing: a face stretched to fit is worse than a face with some background
// trimmed off it. The crop is biased towards the top, because in a portrait the
// head is up there and the chest is not what matters.
function passportPhoto(sourcePath, spec) {
  const { nativeImage } = require('electron');
  const { width, height, qualities, maxBytes } = spec;
  const ratio = width / height;

  const img = nativeImage.createFromPath(sourcePath);
  if (!img || img.isEmpty()) return { error: 'That file could not be read as an image.' };

  const size = img.getSize();
  if (!size.width || !size.height) return { error: 'That image could not be resized.' };

  const r = size.width / size.height;
  const crop = r > ratio
    ? (() => { const w = Math.round(size.height * ratio);
               return { x: Math.round((size.width - w) / 2), y: 0, width: w, height: size.height }; })()
    : (() => { const h = Math.round(size.width / ratio);
               return { x: 0, y: Math.round((size.height - h) * 0.25), width: size.width, height: h }; })();

  let out = img;
  try { out = img.crop(crop); } catch (_) { out = img; }
  try { out = out.resize({ width, height, quality: 'best' }); } catch (_) { /* keep the crop */ }
  if (!out || out.isEmpty()) return { error: 'That image could not be resized.' };

  // Re-encode at descending quality until it fits. JPEG throughout: a passport
  // crop has no transparency to preserve, and PNG at this size is several
  // times larger for no visible gain.
  let last = null;
  for (const q of qualities) {
    const buf = out.toJPEG(q);
    last = buf;
    if (buf.length <= maxBytes) return { buffer: buf, quality: q, bytes: buf.length };
  }
  if (!last || !last.length) return { error: 'That image could not be saved.' };
  return { buffer: last, quality: qualities[qualities.length - 1], bytes: last.length };
}

// ── Secrets ─────────────────────────────────────────────────────────────────
// The operating system's own keystore, when it has one.
function secretStore() {
  try { return require('electron').safeStorage; } catch (_) { return null; }
}

// ── The machine somebody is sitting at ──────────────────────────────────────
const shell = {
  available: true,
  openPath: (p) => require('electron').shell.openPath(p),
  showItemInFolder: (p) => require('electron').shell.showItemInFolder(p),
  showOpenDialog: (opts) => require('electron').dialog.showOpenDialog(opts),
  showSaveDialog: (opts) => require('electron').dialog.showSaveDialog(opts),
  openPreview: (filePath, title) => {
    const { BrowserWindow } = require('electron');
    const win = new BrowserWindow({
      width: 720, height: 900, title: title || 'Preview',
      autoHideMenuBar: true,
      webPreferences: { plugins: true, contextIsolation: true, nodeIntegration: false },
    });
    win.loadURL('file://' + filePath);
    return { ok: true };
  },
};

module.exports = { htmlToPdf, passportPhoto, secretStore, shell };
