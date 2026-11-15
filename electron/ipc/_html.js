// Nickland Edusoft — turning the school's data into markup, safely.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The report card, the receipt, the register, the bill and the timetable are
// built as HTML strings. Three different things then render them:
//
//   the office PC    src/renderer/.../Report.jsx hands the string to
//                    dangerouslySetInnerHTML, inside the renderer that holds
//                    `window.api` — the whole IPC surface, as whoever is
//                    signed in.
//   a phone/browser  mobile/src/print.js does doc.write() into a same-origin
//                    iframe, on a page whose localStorage holds a bearer
//                    token good for up to thirty days.
//   the cloud        sync/outbox.js projects the finished report-card HTML and
//                    the portal serves it to parents, over the internet.
//
// So "the school typed it, so it is fine" is not true of these strings. A
// pupil admitted as `<img src=x onerror=…>` by anybody holding Students:create
// is script in all three places, and `reports.js` escaped its table cells
// while taking names, the school's own header and term labels straight into
// markup — 124 interpolations in that one file.
//
// ── Why this module exists rather than 124 edits ─────────────────────────────
//
// Escaping at each interpolation is the thing that was already being done, and
// being got wrong, because it has to be remembered 124 times. What is here
// instead is escaping at the places the data ENTERS the document: one call in
// `getSchoolHeader` covers every document that draws a letterhead, and
// `escapeFields` covers a row the moment it is read out of the database.
//
// Failure then shows up as a pupil's name rendered with a visible `&lt;` —
// wrong, obvious, and harmless — rather than as script nobody sees until it
// has run.

// Text going into element content or a double-quoted attribute.
//
// `'` is escaped as well as `"`, because a single-quoted attribute is just as
// common in these documents and leaving it out is the usual way an attribute
// break-out survives an escaper that looked complete.
function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A colour that is about to be interpolated into a `style` attribute.
//
// HTML-escaping is the WRONG tool here and would have left the hole open: a
// value like `red;}</style><script>…` contains no character that
// `escapeHtml` touches once it is inside a stylesheet, and `}` closes the rule
// early. A colour is a tiny, closed grammar, so it is validated against that
// grammar and anything else is replaced by the default rather than cleaned.
//
// Accepts: #rgb, #rrggbb, #rrggbbaa, rgb()/rgba()/hsl()/hsla() with numeric
// arguments, and the CSS named colours (letters only). Nothing else.
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^(?:rgb|rgba|hsl|hsla)\(\s*-?[0-9.]+%?\s*(?:[, ]\s*-?[0-9.]+%?\s*){2,3}(?:\/\s*[0-9.]+%?\s*)?\)$/i;
const NAMED = /^[a-z]{3,24}$/i;

function cssColor(value, fallback = '#1B3A6B') {
  const v = String(value == null ? '' : value).trim();
  if (!v) return fallback;
  if (HEX.test(v) || FUNC.test(v) || NAMED.test(v)) return v;
  return fallback;
}

// A `data:` URI that is about to be interpolated into src="…".
//
// Only an image data URI is allowed through. Anything else — a `javascript:`
// URL, a path, a break-out containing a quote — becomes the empty string, and
// the document falls back to having no crest, exactly as it does on a school
// that has not uploaded one.
function imageDataUri(value) {
  const v = String(value == null ? '' : value).trim();
  if (!/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i.test(v)) return '';
  // An SVG crest can carry script. A school's own letterhead is not worth that
  // risk when the document is also served to parents over the internet.
  if (/^data:image\/svg/i.test(v)) return '';
  return v;
}

// Escape the named text fields of a row, in place of remembering to escape
// each one at every interpolation. Returns a NEW object; the original row is
// left alone so code that needs the real value (a comparison, a filename, a
// projection) still has it.
//
// Fields that are not present are not invented, so `row.other_names || ''`
// downstream keeps behaving as it did.
function escapeFields(row, fields) {
  if (!row) return row;
  const out = { ...row };
  for (const f of fields) {
    if (out[f] != null) out[f] = escapeHtml(out[f]);
  }
  return out;
}

// The common case: a person's name as these documents spell it.
const NAME_FIELDS = [
  'surname', 'first_name', 'other_names', 'full_name', 'name',
  'student_name', 'staff_full_name', 'teacher_name', 'class_name', 'class_short',
  'subject', 'subject_name', 'label', 'year_label', 'term_label',
  'father_name', 'mother_name', 'guardian_name',
  'notes', 'remark', 'remarks', 'grade_remark', 'teacher_remarks', 'conduct_traits',
  'route_name', 'stop_name', 'driver_name', 'title', 'description',
];

function escapeNames(row) {
  return escapeFields(row, NAME_FIELDS);
}

// ── The documents themselves refuse to run script ───────────────────────────
//
// Escaping is the fix for the bug. This is the defence for the next one.
//
// A report card, a receipt, a register and a bill are *documents*: there is no
// version of any of them that legitimately needs script. Saying so in the
// document means it is inert wherever it ends up — the print iframe, the blob
// tab a phone browser falls back to, the sandboxed window printToPDF uses, and
// the copy the cloud serves to parents over the internet. A missed escape in
// any one generator then produces visible mojibake instead of running code.
//
// Carried as a meta tag rather than a header because these strings travel as
// strings: they are written into an iframe with document.write, handed to
// expo-print, and stored in the cloud. None of those paths has a header.
const DOCUMENT_CSP =
  '<meta http-equiv="Content-Security-Policy" ' +
  'content="script-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">';

module.exports = {
  escapeHtml, cssColor, imageDataUri, escapeFields, escapeNames, NAME_FIELDS, DOCUMENT_CSP,
};
