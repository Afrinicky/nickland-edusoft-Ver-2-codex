// Nickland Edusoft — putting a picture and a document into the school.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The installed application attaches a pupil's photograph, a teacher's
// photograph, a staff document and the school's crest by opening a file dialog
// and copying the file off the machine's disk. That is the one thing a browser
// cannot do the same way — there is no disk to copy from — and it is why none
// of it was reachable from the web app at all.
//
// So the browser sends the bytes instead, as a data URI, and this writes them
// into the same `uploads/` folder under the same names the desktop uses. The
// result is one photograph, in one place, whichever machine put it there: the
// desktop's own file dialog and the browser's file input write the same row.
//
// ── Why a phone matters here ───────────────────────────────────────────────
//
// A pupil's photograph is taken on a phone at admission, and before this it had
// to be moved onto the office PC before anybody could attach it. The register,
// the report card and the receipt all carry that face; every one of them was
// waiting on a cable.
//
// ── What is refused ────────────────────────────────────────────────────────
//
//   • Anything that is not an image, for a photograph. The extension is taken
//     from the declared MIME type and never from a filename the client sent,
//     because a filename is a place to hide `../../` and `.js`.
//   • Anything over the size cap. A school's connection is not free and a
//     20MB photograph of a seven-year-old helps nobody.
//   • Everything, unless the caller holds the module the record belongs to and
//     may edit it. Attaching a face to a child's record is editing it.

const fs = require('fs');
const path = require('path');

// The image types a school actually has, and their real extensions. The
// extension comes from THIS map, so a client cannot name a file `.php` and
// have it written under that name.
const IMAGE_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

// What a staff document may be, on top of the images: a certificate is
// usually a scan, and a scan is usually a PDF.
const DOC_EXT = { ...IMAGE_EXT, 'application/pdf': '.pdf' };

// 6MB. Enough for a photograph from any phone a Ghanaian school uses, and
// small enough that a class of forty is not a morning's upload.
const MAX_BYTES = 6 * 1024 * 1024;

/**
 * Decode `data:image/png;base64,...` into bytes and a safe extension.
 *
 * Returns `{ error }` rather than throwing, so a route can say what was wrong
 * with the file instead of answering 500.
 */
function decodeDataUri(value, allowed) {
  const s = String(value || '');
  const m = /^data:([a-z0-9.+/-]+);base64,(.*)$/i.exec(s);
  if (!m) return { error: 'Send the file as a data URI (data:<type>;base64,…).' };
  const mime = m[1].toLowerCase();
  const ext = allowed[mime];
  if (!ext) {
    return { error: `A ${mime} is not something this can store. Use ${
      [...new Set(Object.values(allowed))].join(', ')}.` };
  }
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch (_) { return { error: 'That file could not be read.' }; }
  if (!buf.length) return { error: 'That file is empty.' };
  if (buf.length > MAX_BYTES) {
    return { error: `That file is ${(buf.length / 1048576).toFixed(1)}MB. The limit is ${
      MAX_BYTES / 1048576}MB — take the photograph again at a lower size.` };
  }
  return { buf, ext, mime };
}

function registerUploadRoutes({ add, db, json, can, API, media, audit, userDataPath }) {
  // A 6MB file is about 8MB once it is base64. The default request limit is
  // one megabyte, which would drop every photograph silently — the body comes
  // back empty and the route says "send it as a data URI", which is exactly
  // the wrong thing to tell somebody who did.
  const FILE = { maxBody: 9 * 1024 * 1024 };
  const deny = (res, msg) => json(res, 403, { ok: false, error: msg || 'Access denied.' });
  const bad = (res, msg) => json(res, 400, { ok: false, error: msg });
  const missing = (res, msg) => json(res, 404, { ok: false, error: msg || 'Not found.' });
  const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };

  /**
   * Where the school's files live.
   *
   * The desktop puts them under its userData directory and stores the absolute
   * path in the row. This writes to the same place so both machines read one
   * another's uploads; when the server is running outside Electron (the test
   * suite) it falls back to a directory beside the database, which is the only
   * other place that is certainly writable.
   */
  const uploadRoot = () => {
    const base = userDataPath || db._userDataPath
      || path.join(path.dirname(String(db.name || '') || '.'), 'edusoft-data');
    return path.join(base, 'uploads');
  };

  const writeFile = (folder, name, buf, ext) => {
    const dir = path.join(uploadRoot(), folder);
    fs.mkdirSync(dir, { recursive: true });
    // The name is built here from an id and a mapped extension — never from
    // anything the client sent — so there is nothing in it to traverse with.
    const full = path.join(dir, `${name}${ext}`);
    fs.writeFileSync(full, buf);
    // A replaced photograph keeps the same path, so anything caching by path
    // has to be told. Otherwise the office uploads a new face and the app
    // shows the old one until it restarts.
    try { media.forget(); } catch (_) {}
    return full;
  };

  const staffOnly = (ctx, res) => {
    if (!ctx || ctx.role !== 'staff') { deny(res, 'Staff only.'); return false; }
    return true;
  };

  // ── A pupil's photograph ──────────────────────────────────────────────────
  add('POST', `${API}/students/:id/photo`, async (ctx, req, res, params, body) => {
    if (!staffOnly(ctx, res)) return undefined;
    if (!can(ctx, 'students', 'edit')) return deny(res);
    const id = int(params.id);
    const student = db.prepare('SELECT id FROM students WHERE id = ?').get(id);
    if (!student) return missing(res, 'No such pupil.');

    const f = decodeDataUri(body.file || body.photo, IMAGE_EXT);
    if (f.error) return bad(res, f.error);

    const full = writeFile('students', String(id), f.buf, f.ext);
    db.prepare('UPDATE students SET photo_path = ? WHERE id = ?').run(full, id);
    audit(db, ctx, 'student', id, 'upload_photo', `${(f.buf.length / 1024).toFixed(0)}KB`, 'normal');
    // The photograph comes straight back as a data URI so the screen can show
    // the face that was just attached without a second request.
    return json(res, 200, { ok: true, photo: media.dataUri(full) });
  }, FILE);

  // ── A member of staff's photograph ────────────────────────────────────────
  add('POST', `${API}/staff/:id/photo`, async (ctx, req, res, params, body) => {
    if (!staffOnly(ctx, res)) return undefined;
    // Your own face is yours to set. Anybody else's is a staff record.
    const id = int(params.id);
    const own = ctx.user && ctx.user.staff_id && Number(ctx.user.staff_id) === id;
    if (!own && !can(ctx, 'staff', 'edit')) return deny(res);
    const row = db.prepare('SELECT id FROM staff WHERE id = ?').get(id);
    if (!row) return missing(res, 'No such member of staff.');

    const f = decodeDataUri(body.file || body.photo, IMAGE_EXT);
    if (f.error) return bad(res, f.error);

    const full = writeFile('staff', String(id), f.buf, f.ext);
    db.prepare('UPDATE staff SET photo_path = ? WHERE id = ?').run(full, id);
    audit(db, ctx, 'staff', id, 'upload_photo', own ? 'own photograph' : '', 'normal');
    return json(res, 200, { ok: true, photo: media.dataUri(full) });
  }, FILE);

  // ── A staff document ──────────────────────────────────────────────────────
  //
  // A certificate, a contract, a police clearance — the things the Staff
  // module's "Documents expiring soon" panel counts. Reading that panel in the
  // browser while being unable to add to it was the shape of the gap.
  add('POST', `${API}/staff/:id/documents`, async (ctx, req, res, params, body) => {
    if (!staffOnly(ctx, res)) return undefined;
    if (!can(ctx, 'staff', 'edit')) return deny(res);
    const id = int(params.id);
    const row = db.prepare('SELECT id FROM staff WHERE id = ?').get(id);
    if (!row) return missing(res, 'No such member of staff.');

    const title = String(body.title || '').trim();
    if (!title) return bad(res, 'What is this document called?');
    const f = decodeDataUri(body.file, DOC_EXT);
    if (f.error) return bad(res, f.error);

    const expiry = body.expiryDate ? String(body.expiryDate).slice(0, 10) : null;
    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return bad(res, 'Use YYYY-MM-DD for the expiry.');

    const stamp = `${id}-${Date.now()}`;
    const full = writeFile(path.join('staff', 'documents'), stamp, f.buf, f.ext);
    const r = db.prepare(`
      INSERT INTO staff_documents (staff_id, title, doc_type, file_path, expiry_date, uploaded_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(id, title, String(body.docType || 'Other').slice(0, 60), full, expiry);
    audit(db, ctx, 'staff_document', r.lastInsertRowid, 'upload_document', title, 'normal');
    return json(res, 200, { ok: true, id: r.lastInsertRowid, title, expiry_date: expiry });
  }, FILE);

  add('GET', `${API}/staff/:id/documents`, async (ctx, req, res, params) => {
    if (!staffOnly(ctx, res)) return undefined;
    const id = int(params.id);
    const own = ctx.user && ctx.user.staff_id && Number(ctx.user.staff_id) === id;
    if (!own && !can(ctx, 'staff', 'view')) return deny(res);
    // The stored path is a place on the school's disk and is no use to a
    // browser, so it is dropped; what comes back is what the screen shows.
    return json(res, 200, {
      ok: true,
      documents: db.prepare(`
        SELECT id, title, doc_type, expiry_date, uploaded_at
        FROM staff_documents WHERE staff_id = ? ORDER BY COALESCE(expiry_date, uploaded_at) DESC
      `).all(id),
      may_edit: can(ctx, 'staff', 'edit'),
    });
  });

  add('DELETE', `${API}/staff/documents/:docId`, async (ctx, req, res, params) => {
    if (!staffOnly(ctx, res)) return undefined;
    if (!can(ctx, 'staff', 'delete') && !can(ctx, 'staff', 'edit')) return deny(res);
    const docId = int(params.docId);
    const row = db.prepare('SELECT * FROM staff_documents WHERE id = ?').get(docId);
    if (!row) return missing(res, 'No such document.');
    // The row goes; the file is left where it is. A record deleted by mistake
    // is recoverable from the folder, and a file deleted by mistake is not.
    db.prepare('DELETE FROM staff_documents WHERE id = ?').run(docId);
    audit(db, ctx, 'staff_document', docId, 'delete_document', row.title || '', 'high');
    return json(res, 200, { ok: true });
  });

  // ── The school's crest ────────────────────────────────────────────────────
  //
  // It heads every screen, every receipt and every report card. Setting it
  // needed the office PC, which meant a school could rebrand everything except
  // from the machine most of them actually sit at.
  add('POST', `${API}/settings/logo`, async (ctx, req, res, params, body) => {
    if (!staffOnly(ctx, res)) return undefined;
    if (!can(ctx, 'settings', 'edit')) return deny(res);
    const f = decodeDataUri(body.file || body.logo, IMAGE_EXT);
    if (f.error) return bad(res, f.error);
    const full = writeFile('.', 'school-logo', f.buf, f.ext);
    db.prepare(`INSERT INTO settings (key, value, category) VALUES ('school_logo_path', ?, 'branding')
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(full);
    audit(db, ctx, 'settings', null, 'upload_logo', '', 'normal');
    return json(res, 200, { ok: true, logo: media.dataUri(full) });
  }, FILE);

  // ── A signature for the printed reports ───────────────────────────────────
  add('POST', `${API}/settings/signature`, async (ctx, req, res, params, body) => {
    if (!staffOnly(ctx, res)) return undefined;
    if (!can(ctx, 'settings', 'edit')) return deny(res);
    const role = String(body.role || '');
    if (!['proprietor', 'headmaster'].includes(role)) {
      return bad(res, 'A signature belongs to the proprietor or the headmaster.');
    }
    const f = decodeDataUri(body.file || body.signature, IMAGE_EXT);
    if (f.error) return bad(res, f.error);
    const full = writeFile('signatures', role, f.buf, f.ext);
    const put = (key, value) => db.prepare(
      `INSERT INTO settings (key, value, category) VALUES (?, ?, 'branding')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
    put(`${role}_signature_path`, full);
    if (body.name) put(`${role}_name`, String(body.name).slice(0, 120));
    audit(db, ctx, 'settings', null, 'upload_signature', role, 'high');
    return json(res, 200, { ok: true, role, signature: media.dataUri(full) });
  }, FILE);
}

module.exports = { registerUploadRoutes, decodeDataUri, MAX_BYTES };
