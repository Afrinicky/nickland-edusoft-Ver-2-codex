// Nickland Edusoft — what the machine underneath can do.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The handlers in electron/ipc are the school: admitting a pupil, raising a
// term's bills, running the payroll. Almost all of it is plain Node and SQL and
// would run anywhere. Fifteen lines were not: they reached for Electron
// directly, and those fifteen lines were the whole reason this application
// could only ever run on the office PC.
//
// They are four things, and only four:
//
//   printing a PDF     report cards, receipts, payslips, the register
//   reading an image   a photograph, cropped and sized for a record
//   keeping a secret   a backup destination's password
//   the machine itself file dialogs, opening a folder, previewing a document
//
// So the handlers ask for a CAPABILITY now, and something else decides how it
// is provided. On the office PC that is Electron, exactly as before — the code
// beneath is the same code, moved. On a server it is headless Chromium and the
// filesystem, and the fourth group is refused, because "open a folder" has no
// meaning on a machine nobody is sitting at.
//
// Nothing here changes what the school DOES. It changes only what has to be
// underneath it for the school to do it.
//
// Deliberately, the default is the office PC. Install nothing and every
// existing path behaves exactly as it always has; the headless host is the one
// that has to say it is different.

let override = null;
let desktopImpl = null;

// Called by the headless host before any module is registered.
function install(implementation) { override = implementation; }

// Testing seam.
function reset() { override = null; }

function desktop() {
  if (!desktopImpl) desktopImpl = require('./platform/desktop');
  return desktopImpl;
}

function platform() { return override || desktop(); }

// The four capabilities, as plain functions, so a handler reads as what it is
// doing rather than as which framework it is doing it with.

// HTML in, a PDF file out. `options` is Electron's printToPDF shape, which the
// server implementation translates — one vocabulary, so the five places that
// print do not each learn two.
function htmlToPdf(html, outPath, options) {
  return platform().htmlToPdf(html, outPath, options || {});
}

// A photograph, cropped to the passport ratio and encoded within a budget.
// Answers { buffer, quality, bytes } or { error } — the same shape either way,
// so a host that cannot do it says so rather than failing oddly.
function passportPhoto(sourcePath, spec) {
  return platform().passportPhoto(sourcePath, spec);
}

// Somewhere to keep a backup destination's password. May answer null, and
// both implementations may: the caller already falls back to storing it in the
// clear and saying so.
function secretStore() {
  return platform().secretStore();
}

// The machine somebody is sitting at. On a server there is nobody, and these
// answer accordingly rather than pretending.
function shell() { return platform().shell; }

function isDesktop() { return !override; }

module.exports = {
  install, reset, platform, isDesktop,
  htmlToPdf, passportPhoto, secretStore, shell,
};
