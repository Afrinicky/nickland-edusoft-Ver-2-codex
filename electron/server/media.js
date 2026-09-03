// Nickland Edusoft — turning the school's images into something a phone can draw.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The desktop stores a logo and every photograph as a FILE PATH on the school's
// own hard disk. That path is meaningless to a browser on the staffroom Wi-Fi
// and to an Android phone at a parent's house, which is precisely why neither
// the crest nor a single face has ever appeared in the app: the API was handing
// out `C:\Users\...\photos\1042.jpg` and the client was quietly rendering
// initials instead.
//
// The fix is to send the bytes. Every image leaves here as a `data:` URI, which
// both React Native's <Image> and a browser draw without a second request and
// without a token in a query string — a photograph of a child must never be
// reachable by pasting a URL into a browser.
//
// Two rules keep that affordable:
//   • a hard size ceiling. Nothing above it is sent at all, because a 6MB
//     phone photograph on a class roster of forty is 240MB of JSON, and the
//     school's Wi-Fi is not that.
//   • a small cache keyed by path + mtime, so the same crest is read from disk
//     once rather than once per request per teacher.

const fs = require('fs');
const path = require('path');

// A school crest is a few tens of KB; a passport photograph taken on a phone
// and dropped in unresized can be several MB. Anything past this is skipped
// rather than sent — the client falls back to initials, which is a good deal
// better than a stalled screen.
const MAX_BYTES = 900 * 1024;

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

// path -> { mtimeMs, size, uri }
const cache = new Map();
const CACHE_MAX = 400;

function remember(key, entry) {
  if (cache.size >= CACHE_MAX) {
    // Cheap eviction: drop the oldest insertion. A school has hundreds of
    // photographs, not millions, so an LRU would be ceremony for nothing.
    const first = cache.keys().next();
    if (!first.done) cache.delete(first.value);
  }
  cache.set(key, entry);
}

// Read one image into a data URI, or null when there is nothing usable there.
// Never throws: a missing photograph must not take a pupil's record down with
// it, and on a school machine files go missing all the time — a folder moved,
// a drive unplugged, a backup restored without its images.
function dataUri(filePath) {
  const p = String(filePath || '').trim();
  if (!p) return null;
  const ext = path.extname(p).toLowerCase();
  const mime = MIME[ext];
  if (!mime) return null;

  let st;
  try { st = fs.statSync(p); } catch (_) { return null; }
  if (!st.isFile() || st.size === 0 || st.size > MAX_BYTES) return null;

  const hit = cache.get(p);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.uri;

  let buf;
  try { buf = fs.readFileSync(p); } catch (_) { return null; }
  const uri = `data:${mime};base64,${buf.toString('base64')}`;
  remember(p, { mtimeMs: st.mtimeMs, size: st.size, uri });
  return uri;
}

// The school's crest, as held in settings. Separate from `dataUri` only so the
// callers read plainly.
function logoUri(db, getSetting) {
  try { return dataUri(getSetting(db, 'school_logo_path', '')); } catch (_) { return null; }
}

// Attach `photo` to a row that carries `photo_path`, and drop the path itself:
// the client has no use for it and it names a directory on the school's disk.
function withPhoto(row) {
  if (!row) return row;
  const { photo_path, ...rest } = row;
  return { ...rest, photo: dataUri(photo_path) };
}

function forget() { cache.clear(); }

module.exports = { dataUri, logoUri, withPhoto, forget, MAX_BYTES };
