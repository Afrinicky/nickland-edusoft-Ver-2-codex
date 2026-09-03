// Nickland Edusoft — printing.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The rule: a document printed from a phone or a browser is the document the
// office prints. Not similar — the same. A school that hands out two report
// cards with the same title and different layouts has a problem no feature
// makes up for.
//
// So the report card and the pupil profile are NOT built here. They are built
// by the desktop's own report generator (`electron/ipc/reports.js`, the same
// function behind the office's PDF), served as HTML at
// `/results/student/:id/report.html` and `/students/:id/profile.html`, and
// printed verbatim. `printDocument()` below takes that string and nothing else.
//
// Two documents have no desktop equivalent and are built here: the statement of
// account a parent asks for, and a member of staff's own profile sheet. Both
// follow the same A4 house style so they sit in the same folder without looking
// like they came from somewhere else.
//
// How it prints: the string goes into a hidden iframe on the same page and that
// iframe is printed. A pop-up window is blocked by default on most phone
// browsers, and the parent tapping "Print report" would get nothing at all with
// no explanation.
//
// Three pipelines, one function:
//
//   The desktop browser gets a hidden iframe and `print()`.
//
//   A phone browser gets the same iframe, and a new tab if that fails — Chrome
//   on Android will print from an iframe, Safari on iOS often will not, and a
//   parent tapping "Print report" must not get silence either way. The tab
//   still carries the school's own document, and every mobile browser can print
//   or "Save as PDF" from one.
//
//   The Android app gets `expo-print`, which opens the system print sheet —
//   the same one with the printers on it and "Save as PDF" at the top.
//
// `canPrint` used to be `Platform.OS === 'web'`, so the phone app showed a
// button that explained why it could not print. It can.

import { Platform } from 'react-native';

export const canPrint = true;

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const money = (n) => `GHS ${(Number(n) || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

// ── the shared stylesheet ───────────────────────────────────────────────────
// Deliberately plain and ink-cheap: a Ghanaian school office prints on a laser
// with one toner cartridge that has to last the term. No large blocks of
// colour, hairline rules, and the navy reserved for headings.
const CSS = `
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #0B1220; margin: 0; font-size: 11.5pt; line-height: 1.42;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet { max-width: 190mm; margin: 0 auto; }
  header.masthead {
    display: flex; align-items: center; gap: 14px;
    border-bottom: 2px solid #1B3A6B; padding-bottom: 10px; margin-bottom: 14px;
  }
  header.masthead img.crest { width: 66px; height: 66px; object-fit: contain; }
  header.masthead .who { flex: 1; min-width: 0; }
  header.masthead h1 { margin: 0; font-size: 17pt; letter-spacing: -0.3px; color: #12294F; }
  header.masthead .motto { font-style: italic; color: #475569; font-size: 10pt; margin-top: 2px; }
  header.masthead .lines { color: #475569; font-size: 9.5pt; margin-top: 3px; }
  h2.doc { text-align: center; font-size: 12.5pt; letter-spacing: 1.4px;
           text-transform: uppercase; margin: 0 0 14px; color: #1B3A6B; }
  .who-row { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 14px; }
  .who-row img.face {
    width: 30mm; height: 36mm; object-fit: cover; border: 1px solid #C9CFDA; border-radius: 3px;
  }
  .facebox {
    width: 30mm; height: 36mm; border: 1px dashed #C9CFDA; border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
    color: #94A3B8; font-size: 8pt; text-align: center; padding: 4px;
  }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { border: 1px solid #C9CFDA; padding: 5px 7px; text-align: left; font-size: 10.5pt; }
  th { background: #EEF2F8; font-weight: 700; color: #12294F; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.mid, th.mid { text-align: center; }
  .kv { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 18px; margin-bottom: 12px; }
  .kv .k { color: #64748B; font-size: 9pt; text-transform: uppercase; letter-spacing: .5px; }
  .kv .v { font-weight: 600; }
  .kv > div { border-bottom: 1px dotted #DDE3EC; padding: 3px 0; }
  .band { background: #F4F7FC; border: 1px solid #DDE3EC; border-radius: 4px; padding: 8px 10px; margin-bottom: 12px; }
  .band .lbl { color: #64748B; font-size: 9pt; text-transform: uppercase; letter-spacing: .5px; }
  .remark { min-height: 13mm; }
  .sig { display: flex; gap: 24px; margin-top: 18px; }
  .sig > div { flex: 1; border-top: 1px solid #0B1220; padding-top: 4px; font-size: 9.5pt; color: #475569; }
  footer.note { margin-top: 16px; border-top: 1px solid #DDE3EC; padding-top: 6px;
                color: #64748B; font-size: 8.5pt; display: flex; justify-content: space-between; }
  .pill { display: inline-block; padding: 1px 7px; border: 1px solid #C9CFDA; border-radius: 999px; font-size: 9pt; }
  @media print { .noprint { display: none !important; } }
`;

function masthead(school, docTitle) {
  const lines = [school?.address, school?.phone, school?.email].filter(Boolean).join('  ·  ');
  return `
    <header class="masthead">
      ${school?.logo ? `<img class="crest" src="${esc(school.logo)}" alt="">` : ''}
      <div class="who">
        <h1>${esc(school?.name || 'School')}</h1>
        ${school?.motto ? `<div class="motto">${esc(school.motto)}</div>` : ''}
        ${lines ? `<div class="lines">${esc(lines)}</div>` : ''}
      </div>
    </header>
    <h2 class="doc">${esc(docTitle)}</h2>`;
}

function footer(extra) {
  return `<footer class="note"><span>${esc(extra || 'Nickland Edusoft')}</span><span>Printed ${esc(today())}</span></footer>`;
}

function page(title, bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head>
    <body><div class="sheet">${bodyHtml}</div></body></html>`;
}

const kv = (items) => `<div class="kv">${items
  .filter(i => i && i.value != null && i.value !== '')
  .map(i => `<div><div class="k">${esc(i.label)}</div><div class="v">${esc(i.value)}</div></div>`)
  .join('')}</div>`;

// ── the documents ───────────────────────────────────────────────────────────

// The report card and the pupil profile used to be built here, in a house
// style of this app's own. They are not any more: `api.reportCardDocument` and
// `api.studentProfileDocument` fetch the office's own document and
// `printFromSchool` prints it. Two templates for one document is two documents.

/** A member of staff's own record. Employment facts only: no salary figure,
 *  no bank details, nothing a person would not hand to a landlord. */
export function staffProfileHtml({ staff, school, designation, teaching, account }) {
  const s = staff || {};
  const body = `
    ${masthead(school, 'Staff profile')}
    <div class="who-row">
      ${s.photo ? `<img class="face" src="${esc(s.photo)}" alt="">` : '<div class="facebox">No photograph on file</div>'}
      <div style="flex:1">
        ${kv([
          { label: 'Full name', value: s.name || account?.full_name },
          { label: 'Staff number', value: s.staff_number },
          { label: 'Designation', value: s.designation || designation },
          { label: 'Role', value: s.role },
          { label: 'Status', value: s.status },
          { label: 'Date engaged', value: s.hire_date },
          { label: 'Gender', value: s.gender },
          { label: 'Date of birth', value: s.date_of_birth },
        ])}
      </div>
    </div>

    ${kv([
      { label: 'Phone', value: s.phone },
      { label: 'Email', value: s.email },
      { label: 'Address', value: s.address },
      { label: 'Qualification', value: s.qualification },
      { label: 'Specialisation', value: s.specialization },
      { label: 'SSNIT number', value: s.ssnit_number },
    ])}

    ${(teaching && (teaching.classes?.length || teaching.subjects?.length)) ? `
      <div class="band">
        <div class="lbl">Teaching</div>
        ${teaching.class_teacher_of?.length ? `<div>Class teacher of: ${esc(teaching.class_teacher_of.join(', '))}</div>` : ''}
        ${teaching.classes?.length ? `<div>Classes: ${esc(teaching.classes.join(', '))}</div>` : ''}
        ${teaching.subjects?.length ? `<div>Subjects: ${esc(teaching.subjects.join(', '))}</div>` : ''}
      </div>` : ''}

    <div class="sig"><div>Staff member</div><div>Head teacher</div></div>
    ${footer(school?.name)}`;
  return page(`Staff profile — ${s.name || 'Staff'}`, body);
}

/** A statement of account: bills, what has been paid, and what is left. */
export function statementHtml({ school, child, term, bill, items, payments, canteen, history }) {
  const rows = (items || []).map(i => `
    <tr><td>${esc(i.description)}${i.is_arrear ? ' <span class="pill">brought forward</span>' : ''}</td>
        <td class="num">${esc(money(i.amount))}</td></tr>`).join('');
  const pays = (payments || []).map(p => `
    <tr><td>${esc(p.payment_date)}</td><td>${esc(p.receipt_number || '—')}</td>
        <td>${esc(p.term_label || '')}</td><td>${esc(p.payment_method || '')}</td>
        <td class="num">${esc(money(p.amount))}</td></tr>`).join('');
  const hist = (history || []).map(h => `
    <tr><td>${esc(h.term_label)}</td><td class="num">${esc(money(h.total_billed))}</td>
        <td class="num">${esc(money(h.total_paid))}</td><td class="num">${esc(money(h.balance))}</td></tr>`).join('');

  const body = `
    ${masthead(school, `Statement of account — ${term?.label || 'This term'}`)}
    ${kv([
      { label: 'Pupil', value: child?.name },
      { label: 'Index number', value: child?.index_number },
      { label: 'Class', value: child?.class_name },
      { label: 'Term', value: term?.label },
    ])}

    ${rows ? `<table><thead><tr><th>Item billed</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th>Total billed</th><th class="num">${esc(money(bill?.total_billed))}</th></tr>
        <tr><th>Paid to date</th><th class="num">${esc(money(bill?.total_paid))}</th></tr>
        <tr><th>Balance</th><th class="num">${esc(money(bill?.balance))}</th></tr></tfoot></table>` : ''}

    ${canteen ? `<div class="band"><div class="lbl">Canteen</div>
      <div>${esc(canteen.unpaid_days || 0)} unpaid day(s) at ${esc(money(canteen.daily_rate))} — ${esc(money(canteen.amount_owed))} outstanding.</div></div>` : ''}

    ${pays ? `<h3 style="font-size:11pt;color:#12294F;margin:14px 0 6px">Payments received</h3>
      <table><thead><tr><th>Date</th><th>Receipt</th><th>Term</th><th>Method</th><th class="num">Amount</th></tr></thead>
      <tbody>${pays}</tbody></table>` : ''}

    ${hist ? `<h3 style="font-size:11pt;color:#12294F;margin:14px 0 6px">Term by term</h3>
      <table><thead><tr><th>Term</th><th class="num">Billed</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead>
      <tbody>${hist}</tbody></table>` : ''}

    <div class="band"><div class="lbl">How to pay</div>
      <div>No payment is taken through the app. Contact the school office${school?.phone ? ` on ${esc(school.phone)}` : ''} and the bursar will confirm the amount and the method.</div></div>
    ${footer(school?.name)}`;
  return page(`Statement — ${child?.name || 'Pupil'}`, body);
}

// ── the printer ─────────────────────────────────────────────────────────────
// One hidden iframe, reused. Creating a fresh one per print leaks a node per
// tap, which on a teacher printing thirty report cards is thirty documents
// still held in memory.
let frame = null;

function ensureFrame() {
  if (frame && frame.isConnected) return frame;
  frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('title', 'Print');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(frame);
  return frame;
}

/**
 * Print one of the documents above.
 * Returns true when the print dialog was opened, false when this build cannot
 * print — the caller then says so rather than leaving a button that does
 * nothing.
 */
export async function printHtml(html) {
  if (!html) return { ok: false, error: 'There is nothing to print.' };
  if (Platform.OS !== 'web') return printNative(html);
  if (typeof document === 'undefined') return { ok: false, error: 'Printing is not available here.' };
  const viaFrame = await printInFrame(html);
  if (viaFrame) return { ok: true };
  // Chrome on Android prints happily from the iframe; Safari on iOS blocks it.
  // The document itself is fine either way, so hand it to the browser whole and
  // let the reader use the print or share button it already has.
  return openInTab(html);
}

/**
 * The phone app. `expo-print` hands the HTML to Android's own print service,
 * which is where the school's printer and "Save as PDF" both live.
 */
async function printNative(html) {
  try {
    // Required lazily: the browser build must not pull a native module in, and
    // `canPrint` is now true on both.
    const Print = require('expo-print');
    await Print.printAsync({ html });
    return { ok: true };
  } catch (e) {
    const msg = String((e && e.message) || e || '');
    // Dismissing the print sheet rejects on some Android builds. Somebody who
    // changed their mind has not hit an error.
    if (/cancel|dismiss|user did not/i.test(msg)) return { ok: true };
    return { ok: false, error: 'This phone has no print service set up. Add one in Android settings, or open the school’s web address in a browser.' };
  }
}

function openInTab(html) {
  try {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) { URL.revokeObjectURL(url); return { ok: false, error: 'Your browser blocked the document. Allow pop-ups for this site and try again.' }; }
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 60000);
    return { ok: true };
  } catch (_) {
    return { ok: false, error: 'The browser would not open the document.' };
  }
}

/**
 * Resolves true when the print dialog actually opened, false when it did not —
 * which is the whole point. The old version swallowed the failure inside the
 * image callback and reported success regardless, so a phone browser that
 * refuses to print from an iframe produced a button that did nothing at all.
 */
function printInFrame(html) {
  return new Promise((resolve) => {
    let f, doc;
    try {
      f = ensureFrame();
      doc = f.contentWindow.document;
      doc.open();
      doc.write(html);
      doc.close();
    } catch (_) { resolve(false); return; }

    const go = () => {
      try {
        f.contentWindow.focus();
        if (typeof f.contentWindow.print !== 'function') { resolve(false); return; }
        f.contentWindow.print();
        resolve(true);
      } catch (_) { resolve(false); }
    };

    // Let the crest and the photograph decode before the dialog opens,
    // otherwise the first print of a session comes out with empty boxes.
    const imgs = Array.from(doc.images || []);
    if (!imgs.length) { setTimeout(go, 60); return; }
    let left = imgs.length;
    let fired = false;
    const done = () => { if (--left <= 0 && !fired) { fired = true; setTimeout(go, 40); } };
    imgs.forEach(img => {
      if (img.complete) done();
      else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); }
    });
    // A photograph that never resolves must not mean a button that never works.
    setTimeout(() => { if (!fired) { fired = true; go(); } }, 2500);
  });
}

/**
 * Fetch a document the school's own system built, and print it.
 *
 * `fetcher` returns the HTML string (see `api.reportCardDocument` and friends).
 * Errors come back as a message rather than a throw, because every caller here
 * shows it to a person rather than logging it.
 */
export async function printFromSchool(fetcher) {
  let doc;
  try { doc = await fetcher(); }
  catch (e) { return { ok: false, error: e.message || 'Could not fetch the document.' }; }
  if (!doc || typeof doc !== 'string') return { ok: false, error: 'The school returned an empty document.' };
  return printHtml(doc);
}

// Kept because callers still import it, but nothing reaches for it now that
// every build can print.
export const NOT_ON_PHONE =
  'Printing needs the school’s web address open in a browser.';

export default {
  canPrint, printHtml, printFromSchool, staffProfileHtml, statementHtml, NOT_ON_PHONE,
};
