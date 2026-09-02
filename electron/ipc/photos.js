// Nickland Edusoft — Profile Photo Upload IPC
// Generic photo handler used by students, staff, and users.
// Photos stored under %APPDATA%/NicklandEdusoft/uploads/photos/<entity_type>/<id>_<timestamp>.jpg
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Every photo that comes in is normalised before it is stored: cropped to
// passport proportions, scaled to a passport print size, and re-encoded until
// it fits the size ceiling. Schools upload whatever the phone produced — a 12
// megapixel, 6 MB portrait in landscape orientation — and the app has to put
// it on an ID card, a class list and a report cover at a predictable shape.
// Doing that once on the way in beats every screen trying to cope with it.
//
// A photo can also be chosen BEFORE the record it belongs to exists. In that
// case it is written to the same folder with a `staged_` name and no database
// row is touched; the form carries the path and the record's own insert
// stores it. `photos:discard` cleans one up if the form is abandoned.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { nativeImage } = require('electron');

const VALID_ENTITY_TYPES = ['students', 'staff', 'users'];
const TABLE = { students: 'students', staff: 'staff', users: 'users' };
const VALID_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

// A passport photograph is 35 × 45 mm. At 300 dpi that is 413 × 531 px, which
// prints crisply on an ID card and still shows as a clean thumbnail in a list.
const PASSPORT_W = 413;
const PASSPORT_H = 531;
const PASSPORT_RATIO = PASSPORT_W / PASSPORT_H;

// What a stored photo may weigh. Anything larger is re-encoded down to fit
// rather than rejected — telling a school secretary to "go and shrink it
// first" is how the field ends up empty.
const MAX_STORED_BYTES = 500 * 1024;

// What we are willing to READ. Beyond this the decode itself is the problem,
// not the file size, so it is refused with an explanation.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

const JPEG_QUALITIES = [90, 80, 70, 60, 50, 40, 30];

// Crop to the passport aspect ratio from the centre, then scale to the target.
// Cropping rather than squashing: a face stretched to fit is worse than a face
// with some background trimmed off it.
function toPassport(img) {
  const size = img.getSize();
  if (!size.width || !size.height) return null;

  const ratio = size.width / size.height;
  let crop;
  if (ratio > PASSPORT_RATIO) {
    // Too wide — take a full-height column from the middle.
    const w = Math.round(size.height * PASSPORT_RATIO);
    crop = { x: Math.round((size.width - w) / 2), y: 0, width: w, height: size.height };
  } else {
    // Too tall — take a full-width band. Biased towards the top, because in a
    // portrait the head is up there and the chest is not what matters.
    const h = Math.round(size.width / PASSPORT_RATIO);
    crop = { x: 0, y: Math.round((size.height - h) * 0.25), width: size.width, height: h };
  }

  let out = img;
  try { out = img.crop(crop); } catch (_) { out = img; }
  try {
    out = out.resize({ width: PASSPORT_W, height: PASSPORT_H, quality: 'best' });
  } catch (_) { /* keep the crop if the resize is refused */ }
  return out;
}

// Re-encode at descending quality until it fits. JPEG throughout: a passport
// crop has no transparency to preserve, and PNG at this size is several times
// larger for no visible gain.
function encodeWithinBudget(img) {
  let last = null;
  for (const q of JPEG_QUALITIES) {
    const buf = img.toJPEG(q);
    last = buf;
    if (buf.length <= MAX_STORED_BYTES) return { buffer: buf, quality: q };
  }
  return { buffer: last, quality: JPEG_QUALITIES[JPEG_QUALITIES.length - 1] };
}

// Read → passport → budget. Returns a JPEG buffer or an { error }.
function processImage(sourcePath) {
  let stat;
  try { stat = fs.statSync(sourcePath); }
  catch (_) { return { error: 'Source file not found.' }; }
  if (stat.size > MAX_SOURCE_BYTES) {
    return { error: 'That image is too large to read (over 25MB). Please choose a smaller one.' };
  }

  const img = nativeImage.createFromPath(sourcePath);
  if (!img || img.isEmpty()) {
    return { error: 'That file could not be read as an image.' };
  }
  const passport = toPassport(img);
  if (!passport || passport.isEmpty()) {
    return { error: 'That image could not be resized.' };
  }
  const { buffer, quality } = encodeWithinBudget(passport);
  if (!buffer || !buffer.length) return { error: 'That image could not be saved.' };
  return { buffer, quality, bytes: buffer.length };
}

module.exports = function registerPhotosHandlers(ipcMain, db, userDataPath) {

  function photoDir(entityType) {
    const dir = path.join(userDataPath, 'uploads', 'photos', entityType);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function currentPath(entityType, entityId) {
    try {
      const row = db.prepare(`SELECT photo_path FROM ${TABLE[entityType]} WHERE id = ?`).get(entityId);
      return (row && row.photo_path) || null;
    } catch (_) { return null; }
  }

  // Only ever unlink inside our own photo folder. photo_path comes back out of
  // the database, and a value put there by anything other than this file is
  // not something to hand to fs.unlink.
  function removeFileIfOurs(entityType, filePath) {
    if (!filePath) return;
    try {
      const dir = photoDir(entityType);
      const full = path.resolve(filePath);
      if (full !== dir && !full.startsWith(dir + path.sep)) return;
      if (fs.existsSync(full)) fs.unlinkSync(full);
    } catch (_) { /* a photo we cannot delete is not worth failing over */ }
  }

  ipcMain.handle('photos:upload', (_e, { entityType, entityId, sourcePath }) => {
    if (!VALID_ENTITY_TYPES.includes(entityType)) {
      return { ok: false, error: `Invalid entity type: ${entityType}` };
    }
    if (!sourcePath) return { ok: false, error: 'No file chosen.' };

    const ext = path.extname(sourcePath).toLowerCase();
    if (ext && !VALID_EXTENSIONS.includes(ext)) {
      return { ok: false, error: `Unsupported image format. Allowed: ${VALID_EXTENSIONS.join(', ')}` };
    }

    const processed = processImage(sourcePath);
    if (processed.error) return { ok: false, error: processed.error };

    const dir = photoDir(entityType);
    // No entityId means the record is still being filled in. Write the file and
    // hand the path back; the form saves it with everything else. Staged names
    // are random so two people adding staff at once cannot collide.
    const staged = !entityId;
    const filename = staged
      ? `staged_${crypto.randomBytes(8).toString('hex')}.jpg`
      : `${entityId}_${Date.now()}.jpg`;
    const destPath = path.join(dir, filename);

    try {
      fs.writeFileSync(destPath, processed.buffer);
    } catch (e) {
      return { ok: false, error: `Could not save photo: ${e.message}` };
    }

    if (staged) {
      return { ok: true, path: destPath, staged: true, bytes: processed.bytes };
    }

    const oldPath = currentPath(entityType, entityId);
    try {
      db.prepare(`UPDATE ${TABLE[entityType]} SET photo_path = ? WHERE id = ?`).run(destPath, entityId);
    } catch (e) {
      try { fs.unlinkSync(destPath); } catch (_) {}
      return { ok: false, error: `Could not update record: ${e.message}` };
    }
    if (oldPath && oldPath !== destPath) removeFileIfOurs(entityType, oldPath);

    return { ok: true, path: destPath, staged: false, bytes: processed.bytes };
  });

  // Bind a staged photo to the record once it has an id. Used by forms that
  // create the record and the photo in one go.
  ipcMain.handle('photos:attach', (_e, { entityType, entityId, stagedPath }) => {
    if (!VALID_ENTITY_TYPES.includes(entityType)) return { ok: false, error: 'Invalid entity type' };
    if (!entityId || !stagedPath) return { ok: false, error: 'entityId and stagedPath are required' };
    const dir = photoDir(entityType);
    const full = path.resolve(stagedPath);
    if (full !== dir && !full.startsWith(dir + path.sep)) {
      return { ok: false, error: 'That file is not a staged photo.' };
    }
    if (!fs.existsSync(full)) return { ok: false, error: 'That staged photo is no longer there.' };

    const destPath = path.join(dir, `${entityId}_${Date.now()}.jpg`);
    const oldPath = currentPath(entityType, entityId);
    try {
      fs.renameSync(full, destPath);
      db.prepare(`UPDATE ${TABLE[entityType]} SET photo_path = ? WHERE id = ?`).run(destPath, entityId);
    } catch (e) {
      return { ok: false, error: `Could not attach photo: ${e.message}` };
    }
    if (oldPath && oldPath !== destPath) removeFileIfOurs(entityType, oldPath);
    return { ok: true, path: destPath };
  });

  // Throw away a staged photo whose form was abandoned.
  ipcMain.handle('photos:discard', (_e, { entityType, stagedPath }) => {
    if (!VALID_ENTITY_TYPES.includes(entityType)) return { ok: false, error: 'Invalid entity type' };
    if (stagedPath && path.basename(String(stagedPath)).startsWith('staged_')) {
      removeFileIfOurs(entityType, stagedPath);
    }
    return { ok: true };
  });

  ipcMain.handle('photos:remove', (_e, { entityType, entityId, stagedPath }) => {
    if (!VALID_ENTITY_TYPES.includes(entityType)) return { ok: false, error: 'Invalid entity type' };
    // Removing a photo that was never attached to anything.
    if (!entityId) {
      if (stagedPath) removeFileIfOurs(entityType, stagedPath);
      return { ok: true };
    }
    removeFileIfOurs(entityType, currentPath(entityType, entityId));
    db.prepare(`UPDATE ${TABLE[entityType]} SET photo_path = NULL WHERE id = ?`).run(entityId);
    return { ok: true };
  });
};

module.exports.PASSPORT_W = PASSPORT_W;
module.exports.PASSPORT_H = PASSPORT_H;
module.exports.MAX_STORED_BYTES = MAX_STORED_BYTES;
