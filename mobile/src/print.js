// Nickland Edusoft — printing, from the browser app.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Three documents a school is asked for constantly and that neither the parent
// portal nor the teacher portal could produce: a terminal report, a pupil's
// profile sheet, and a member of staff's own record. Each was a trip to the
// office and a photocopier.
//
// How it works: the document is built as a small, self-contained HTML page —
// the school's crest and any photograph are already data URIs by the time they
// reach here, so nothing has to be fetched while the print dialog is opening —
// dropped into a hidden iframe on the same page, and printed from there.
//
// An iframe rather than window.open() on purpose. A pop-up is blocked by
// default on most phone browsers, and the parent tapping "Print report" would
// get nothing at all with no explanation. The iframe is same-document and
// cannot be blocked.
//
// On the phone app there is no print pipeline at all, so `canPrint` is false
// and every caller offers the browser instead of a dead button.

import { Platform } from 'react-native';

export const canPrint = Platform.OS === 'web';

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

/**
 * A terminal report card. Takes the shape either the parent's
 * `/parent/children/:id/report` or the teacher's `/results/student/:id`
 * returns — they were made to match precisely so one printer serves both.
 */
export function terminalReportHtml(r) {
  const s = r.student || {};
  const sum = r.summary || {};
  const att = r.attendance || {};
  const subjects = r.subjects || [];
  const bandFor = (score) => {
    if (score == null) return '';
    const hit = (r.grading_bands || []).find(b => score >= b.min_score && score <= b.max_score);
    return hit ? hit.remark : '';
  };

  const rows = subjects.map(sub => `
    <tr>
      <td>${esc(sub.subject)}</td>
      <td class="num">${sub.class_score == null ? '—' : esc(sub.class_score)}</td>
      <td class="num">${sub.exam_score == null ? '—' : esc(sub.exam_score)}</td>
      <td class="num"><strong>${sub.total_score == null ? '—' : esc(sub.total_score)}</strong></td>
      <td>${esc(sub.grade_remark || bandFor(sub.total_score))}</td>
    </tr>`).join('');

  const body = `
    ${masthead(r.school, `Terminal report — ${r.term?.label || 'This term'}`)}
    <div class="who-row">
      ${s.photo ? `<img class="face" src="${esc(s.photo)}" alt="">` : '<div class="facebox">No photograph on file</div>'}
      <div style="flex:1">
        ${kv([
          { label: 'Name', value: s.name },
          { label: 'Index number', value: s.index_number },
          { label: 'Class', value: s.class_name },
          { label: 'Class teacher', value: s.class_teacher },
          { label: 'Term', value: r.term?.label },
          { label: 'Examination', value: r.dates?.exam_title },
          { label: 'Position', value: sum.class_rank ? `${sum.class_rank} of ${sum.number_on_roll || '—'}` : null },
          { label: 'Average', value: sum.average_score != null ? Number(sum.average_score).toFixed(1) : null },
          { label: 'Attendance', value: att.total ? `${att.present || 0} of ${att.total} days` : null },
          { label: 'Subjects offered', value: subjects.length || null },
        ])}
      </div>
    </div>

    <table>
      <thead><tr>
        <th>Subject</th><th class="num">Class work</th><th class="num">Exam</th>
        <th class="num">Total</th><th>Grade / remark</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="5">No marks have been published for this term.</td></tr>'}</tbody>
    </table>

    ${sum.conduct_traits ? `<div class="band"><div class="lbl">Conduct</div><div>${esc(sum.conduct_traits)}</div></div>` : ''}
    ${sum.learner_interests ? `<div class="band"><div class="lbl">Interests</div><div>${esc(sum.learner_interests)}</div></div>` : ''}
    ${sum.learner_talents ? `<div class="band"><div class="lbl">Talents</div><div>${esc(sum.learner_talents)}</div></div>` : ''}
    <div class="band remark"><div class="lbl">Class teacher's remark</div><div>${esc(sum.teacher_remarks || '')}</div></div>

    ${(r.dates?.vacation || r.dates?.reopening) ? kv([
      { label: 'Vacation', value: r.dates.vacation },
      { label: 'School reopens', value: r.dates.reopening },
    ]) : ''}

    <div class="sig"><div>Class teacher</div><div>Head teacher</div><div>Parent / guardian</div></div>
    ${footer(r.school?.name)}`;

  return page(`Report — ${s.name || 'Pupil'}`, body);
}

/** A pupil's profile sheet — the page a school is asked for by hospitals,
 *  scholarship boards and the district office. */
export function studentProfileHtml({ student, school, term, fees, canteen, attendance }) {
  const s = student || {};
  const guardians = (s.guardians || []).filter(g => g.name || g.contact);
  const body = `
    ${masthead(school, 'Pupil profile')}
    <div class="who-row">
      ${s.photo ? `<img class="face" src="${esc(s.photo)}" alt="">` : '<div class="facebox">No photograph on file</div>'}
      <div style="flex:1">
        ${kv([
          { label: 'Full name', value: s.name },
          { label: 'Index number', value: s.index_number },
          { label: 'Class', value: s.class_name },
          { label: 'Status', value: s.status },
          { label: 'Gender', value: s.gender },
          { label: 'Date of birth', value: s.date_of_birth },
          { label: 'Age', value: s.age },
          { label: 'Place of birth', value: s.place_of_birth },
          { label: 'Denomination', value: s.denomination },
          { label: 'NHIS number', value: s.nhis_number },
        ])}
      </div>
    </div>

    ${kv([
      { label: 'Residence', value: s.place_of_residence },
      { label: 'Street address', value: s.street_address },
      { label: 'House number', value: s.house_number },
      { label: 'Digital (GPS) address', value: s.digital_address },
      { label: 'Admitted', value: s.admission_date || s.admission_year },
      { label: 'Roll number', value: s.roll_number },
    ])}

    ${guardians.length ? `
      <table>
        <thead><tr><th>Relation</th><th>Name</th><th>Contact</th></tr></thead>
        <tbody>${guardians.map(g => `<tr><td>${esc(g.relation)}</td><td>${esc(g.name || '')}</td><td>${esc(g.contact || '')}</td></tr>`).join('')}</tbody>
      </table>` : ''}

    ${attendance && attendance.total ? `<div class="band"><div class="lbl">Attendance${term ? ` — ${esc(term)}` : ''}</div>
      <div>${esc(attendance.present || 0)} present · ${esc(attendance.absent || 0)} absent of ${esc(attendance.total)} days recorded</div></div>` : ''}

    ${(fees || canteen) ? `<div class="band"><div class="lbl">Account${term ? ` — ${esc(term)}` : ''}</div>
      <div>${fees ? `School fees: ${esc(money(fees.balance))} outstanding of ${esc(money(fees.billed))} billed.` : ''}
           ${canteen ? ` Canteen: ${esc(money(canteen.amount_owed))} outstanding (${esc(canteen.unpaid_days || 0)} days).` : ''}</div>
      <div style="margin-top:4px;color:#64748B;font-size:9pt">Payment is arranged with the school office. No payment is taken through the app.</div></div>` : ''}

    <div class="sig"><div>Class teacher</div><div>Head teacher</div></div>
    ${footer(school?.name)}`;
  return page(`Profile — ${s.name || 'Pupil'}`, body);
}

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
export function printHtml(html) {
  if (!canPrint || typeof document === 'undefined') return false;
  try {
    const f = ensureFrame();
    const doc = f.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    // Let the crest and the photograph decode before the dialog opens,
    // otherwise the first print of a session comes out with empty boxes.
    const go = () => {
      try { f.contentWindow.focus(); f.contentWindow.print(); } catch (_) {}
    };
    const imgs = Array.from(doc.images || []);
    if (!imgs.length) { setTimeout(go, 60); return true; }
    let left = imgs.length;
    let fired = false;
    const done = () => { if (--left <= 0 && !fired) { fired = true; setTimeout(go, 40); } };
    imgs.forEach(img => {
      if (img.complete) done();
      else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); }
    });
    // A photograph that never resolves must not mean a button that never works.
    setTimeout(() => { if (!fired) { fired = true; go(); } }, 2500);
    return true;
  } catch (_) {
    return false;
  }
}

export const NOT_ON_PHONE =
  'Printing happens in the browser. Open the school’s web address on a computer or phone browser, sign in, and the print button there will produce this document.';

export default {
  canPrint, printHtml, terminalReportHtml, studentProfileHtml, staffProfileHtml, statementHtml, NOT_ON_PHONE,
};
