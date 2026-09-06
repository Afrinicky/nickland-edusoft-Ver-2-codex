// Nickland Edusoft — the school's host, on a server.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The same four capabilities as the office PC, provided without one. This is
// what lets the installed application's own code — all 22,000 lines of it —
// run online without being rewritten in another language.
//
// Three are provided properly. The fourth is refused, and refusing it is the
// correct answer: "open a folder" and "choose a file" are about a machine
// somebody is sitting at, and nobody is sitting at this one.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── Printing ────────────────────────────────────────────────────────────────
//
// The same Chromium, headless. The office PC has one inside Electron; a server
// gets it from Puppeteer or Playwright, whichever is installed — both drive the
// same browser, and a host should not care which one an operator chose.
//
// One browser is started and kept, because launching Chromium per report card
// would make a class of forty unusable.
let browserPromise = null;

async function launchBrowser() {
  // Puppeteer first: it is the smaller install and the more common one on a
  // server. Playwright second, because a machine that already has it for other
  // reasons should not need a second copy of Chromium.
  try {
    const puppeteer = require('puppeteer');
    return {
      kind: 'puppeteer',
      browser: await puppeteer.launch({
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      }),
    };
  } catch (_) { /* try the next one */ }

  // Playwright, in either of the two shapes it is packaged in. playwright-core
  // is the one a server usually wants: the driver without a bundled browser,
  // pointed at whichever Chromium the machine already has.
  for (const name of ['playwright', 'playwright-core']) {
    try {
      const { chromium } = require(name);
      return {
        kind: 'playwright',
        browser: await chromium.launch({
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
          ...(process.env.EDUSOFT_CHROMIUM ? { executablePath: process.env.EDUSOFT_CHROMIUM } : {}),
        }),
      };
    } catch (_) { /* try the next one */ }
  }

  throw new Error(
    'This host cannot produce PDFs: no headless browser is installed. ' +
    'Install one on the server — `npm install puppeteer` is the simplest — and restart it. ' +
    'With playwright-core, set EDUSOFT_CHROMIUM to the browser\'s path.'
  );
}

function browser() {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((e) => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

// Electron's printToPDF vocabulary, which the five printing sites speak,
// translated to the one headless Chromium speaks. Kept here so those five do
// not each have to learn a second dialect.
function toChromiumOptions(options = {}) {
  const out = {
    printBackground: options.printBackground !== false,
    landscape: !!options.landscape,
    preferCSSPageSize: !!options.preferCSSPageSize,
  };

  const m = options.margins;
  if (m && typeof m === 'object' && m.marginType !== 'default') {
    const mm = (v) => `${Math.round((v || 0) * 25.4 / 96)}mm`;   // Electron counts pixels
    out.margin = { top: mm(m.top), bottom: mm(m.bottom), left: mm(m.left), right: mm(m.right) };
  }

  const size = options.pageSize;
  if (typeof size === 'string') {
    out.format = size;                       // 'A4', 'Letter' — same names
  } else if (size && typeof size === 'object') {
    // Electron measures a custom page in MICRONS; Chromium takes a CSS length.
    const toMm = (micron) => `${(micron / 1000).toFixed(2)}mm`;
    out.width = toMm(size.width);
    out.height = toMm(size.height);
  } else if (!out.preferCSSPageSize) {
    out.format = 'A4';
  }
  return out;
}

async function htmlToPdf(html, outPath, options = {}) {
  const { kind, browser: b } = await browser();
  const page = await (kind === 'puppeteer' ? b.newPage() : b.newPage());
  try {
    // Same reason as the office PC: a whole class of report cards exceeds a
    // data URL's length limit, so the HTML goes through a file.
    const tmpPath = outPath + '.tmp.html';
    fs.writeFileSync(tmpPath, html, 'utf8');
    try {
      await page.goto('file://' + tmpPath, { waitUntil: 'networkidle0' }).catch(
        () => page.goto('file://' + tmpPath, { waitUntil: 'load' })
      );
      const data = await page.pdf(toChromiumOptions(options));
      fs.writeFileSync(outPath, data);
      return { ok: true, path: outPath };
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  } finally {
    try { await page.close(); } catch (_) {}
  }
}

// ── Photographs ─────────────────────────────────────────────────────────────
//
// sharp does what nativeImage did: crop to the passport ratio, scale, and
// re-encode at descending quality until it fits. Same rules, same numbers,
// because they are passed in rather than restated.
//
// It is loaded lazily and only here, so the office PC never needs it — adding
// a native dependency to the installer to serve the server would be the tail
// wagging the dog.
async function passportPhoto(sourcePath, spec) {
  let sharp;
  try { sharp = require('sharp'); } catch (_) {
    return { error: 'This host cannot resize photographs: sharp is not installed on the server.' };
  }

  const { width, height, qualities, maxBytes } = spec;
  try {
    const image = sharp(sourcePath, { failOn: 'none' });
    const meta = await image.metadata();
    if (!meta.width || !meta.height) return { error: 'That file could not be read as an image.' };

    // `cover` with a north-biased crop is the same decision the office PC
    // makes: in a portrait the head is at the top and the chest is not what
    // matters.
    const base = sharp(sourcePath, { failOn: 'none' })
      .rotate()                                  // honour the phone's orientation
      .resize(width, height, { fit: 'cover', position: 'north' });

    let last = null;
    for (const q of qualities) {
      const buf = await base.clone().jpeg({ quality: q }).toBuffer();
      last = buf;
      if (buf.length <= maxBytes) return { buffer: buf, quality: q, bytes: buf.length };
    }
    if (!last || !last.length) return { error: 'That image could not be saved.' };
    return { buffer: last, quality: qualities[qualities.length - 1], bytes: last.length };
  } catch (e) {
    return { error: 'That file could not be read as an image.' };
  }
}

// ── Secrets ─────────────────────────────────────────────────────────────────
//
// There is no operating-system keystore on a server, so the key comes from the
// environment — which is where a server's secrets belong anyway. Without one
// this answers null and the caller stores the value in the clear and says so,
// exactly as it already does on a desktop with no keystore.
function secretStore() {
  const key = process.env.EDUSOFT_SECRET_KEY;
  if (!key || key.length < 32) return null;
  const derived = crypto.createHash('sha256').update(key).digest();
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', derived, iv);
      const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString: (buf) => {
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', derived, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

// ── The machine nobody is sitting at ────────────────────────────────────────
//
// Refused, in words, and the same words the LAN gives — so a member of staff
// working online is told the same thing as one working from the next room.
const AT_THE_OFFICE = (what) => ({
  ok: false, host_only: true,
  error: `${what} happens at the school's own computer.`,
});

const shell = {
  available: false,
  openPath: () => AT_THE_OFFICE('Opening a folder'),
  showItemInFolder: () => AT_THE_OFFICE('Opening a folder'),
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showSaveDialog: async () => ({ canceled: true, filePath: null }),
  openPreview: () => AT_THE_OFFICE('Previewing a document'),
};

async function shutdown() {
  if (!browserPromise) return;
  try { const { browser: b } = await browserPromise; await b.close(); } catch (_) {}
  browserPromise = null;
}

module.exports = { htmlToPdf, passportPhoto, secretStore, shell, shutdown, toChromiumOptions };
