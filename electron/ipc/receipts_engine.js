// Nickland Edusoft — Standard Receipt Engine
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// A built-in, template-free receipt system. Every payment (fees, books,
// canteen) can produce a professional receipt WITHOUT the user first
// uploading a .docx template. Receipts support:
//   • Paper printing — configurable size (A4 / A5 / Letter / 80mm & 58mm
//     thermal roll) rendered straight to PDF and opened in a print preview.
//   • Electronic delivery — email and SMS via the notifications channel.
// An optional uploaded .docx template still overrides the built-in layout
// when the school wants fully bespoke stationery.

const fs = require('fs');
const path = require('path');
const { getSetting } = require('../utils/idgen');

// ── Paper geometry (microns for Electron printToPDF; mm for CSS) ──
const PAPER = {
  A4:     { css: 'A4',     width_mm: 210, label: 'A4' },
  A5:     { css: 'A5',     width_mm: 148, label: 'A5' },
  Letter: { css: 'Letter', width_mm: 216, label: 'Letter' },
  roll80: { css: '80mm auto', width_mm: 80, roll: true, label: '80mm roll' },
  roll58: { css: '58mm auto', width_mm: 58, roll: true, label: '58mm roll' },
};

function resolvePaper(size) {
  return PAPER[size] || PAPER.A4;
}

// ── Amount in words (Ghana cedis) ──
function amountInWords(amount) {
  if (!amount && amount !== 0) return '';
  const num = Math.round(amount * 100) / 100;
  const [int, dec] = num.toFixed(2).split('.');
  const intWords = intToWords(parseInt(int, 10));
  const pesewas = parseInt(dec, 10);
  let out = intWords + ' Ghana Cedis';
  if (pesewas > 0) out += ' and ' + intToWords(pesewas) + ' Pesewas';
  return out + ' Only';
}
function intToWords(n) {
  if (n === 0) return 'Zero';
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const u = (x) => x === 0 ? '' : x < 20 ? ones[x] : x < 100 ? tens[Math.floor(x/10)] + (x%10?' '+ones[x%10]:'') : ones[Math.floor(x/100)]+' Hundred'+(x%100?' and '+u(x%100):'');
  if (n < 1000) return u(n);
  if (n < 1e6) return u(Math.floor(n/1000))+' Thousand'+(n%1000?' '+u(n%1000):'');
  if (n < 1e9) return u(Math.floor(n/1e6))+' Million'+(n%1e6?' '+intToWords(n%1e6):'');
  return u(Math.floor(n/1e9))+' Billion'+(n%1e9?' '+intToWords(n%1e9):'');
}

// ── School identity + branding ──
function schoolInfo(db, getResourcePath) {
  const g = (k, d = '') => getSetting(db, k, d);
  let logoPath = g('school_logo_path', '');
  if (!logoPath && typeof getResourcePath === 'function') {
    try { logoPath = getResourcePath('logo.png'); } catch (_) {}
  }
  let logoData = '';
  if (logoPath && fs.existsSync(logoPath)) {
    try {
      const buf = fs.readFileSync(logoPath);
      const ext = (path.extname(logoPath).slice(1) || 'png').toLowerCase();
      logoData = `data:image/${ext};base64,${buf.toString('base64')}`;
    } catch (_) {}
  }
  return {
    name: g('school_name', 'School'),
    motto: g('school_motto', ''),
    address: g('school_address', ''),
    digital: g('school_digital_address', ''),
    phone: [g('school_phone_1', ''), g('school_phone_2', '')].filter(Boolean).join(' / '),
    email: g('school_email', ''),
    primary: g('school_color_primary', '#1B3A6B'),
    accent: g('school_color_accent', '#C9961A'),
    logoData,
    footer: g('receipt_footer_note', 'Thank you for your payment.'),
  };
}

// ── Gather receipt data from a payment ──
// type: 'fees' | 'books' | 'canteen'
function buildReceiptModel(db, type, paymentId) {
  const now = new Date();
  const base = {
    type,
    date: now.toISOString().slice(0, 10),
    date_long: now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
    time: now.toTimeString().slice(0, 5),
  };

  if (type === 'fees') {
    const row = db.prepare(`
      SELECT p.*, s.surname, s.first_name, s.other_names, s.index_number,
             s.father_contact, s.mother_contact, s.guardian_contact,
             c.name AS class_name, t.label AS term_label, y.label AS year_label,
             u.full_name AS received_by_name,
             sb.total_billed, sb.total_paid, sb.balance
      FROM payments p
      JOIN students s ON s.id = p.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      LEFT JOIN terms t ON t.id = p.term_id
      LEFT JOIN academic_years y ON y.id = t.academic_year_id
      LEFT JOIN users u ON u.id = p.received_by
      LEFT JOIN student_bills sb ON sb.student_id = p.student_id AND sb.term_id = p.term_id
      WHERE p.id = ?
    `).get(paymentId);
    if (!row) return null;
    return {
      ...base,
      title: 'FEES PAYMENT RECEIPT',
      receipt_number: row.receipt_number,
      student_id: row.student_id,
      student_name: `${row.surname} ${row.first_name} ${row.other_names || ''}`.trim(),
      student_index: row.index_number,
      student_class: row.class_name || '',
      amount: Number(row.amount) || 0,
      payment_method: row.payment_method || 'Cash',
      reference: row.reference || '',
      term: row.term_label || '',
      academic_year: row.year_label || '',
      received_by: row.received_by_name || '',
      notes: row.notes || '',
      contact: row.father_contact || row.mother_contact || row.guardian_contact || '',
      lines: [
        ['Total Billed', row.total_billed],
        ['Total Paid to Date', row.total_paid],
        ['Balance', row.balance],
      ],
      status: (row.balance || 0) <= 0 ? 'PAID IN FULL' : 'PART PAYMENT',
    };
  }

  if (type === 'books') {
    const row = db.prepare(`
      SELECT bp.*, s.surname, s.first_name, s.other_names, s.index_number,
             s.father_contact, s.mother_contact, s.guardian_contact,
             c.name AS class_name, y.label AS year_label, u.full_name AS received_by_name,
             sb.total_amount AS books_total, sb.total_paid AS books_paid, sb.balance AS books_balance
      FROM books_payments bp
      JOIN students s ON s.id = bp.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      LEFT JOIN student_books sb ON sb.id = bp.student_books_id
      LEFT JOIN academic_years y ON y.id = sb.academic_year_id
      LEFT JOIN users u ON u.id = bp.received_by
      WHERE bp.id = ?
    `).get(paymentId);
    if (!row) return null;
    return {
      ...base,
      title: 'BOOKS PAYMENT RECEIPT',
      receipt_number: row.receipt_number,
      student_id: row.student_id,
      student_name: `${row.surname} ${row.first_name} ${row.other_names || ''}`.trim(),
      student_index: row.index_number,
      student_class: row.class_name || '',
      amount: Number(row.amount) || 0,
      payment_method: row.payment_method || 'Cash',
      reference: row.reference || '',
      academic_year: row.year_label || '',
      received_by: row.received_by_name || '',
      notes: row.notes || '',
      contact: row.father_contact || row.mother_contact || row.guardian_contact || '',
      lines: [
        ['Books Total', row.books_total],
        ['Paid to Date', row.books_paid],
        ['Balance', row.books_balance],
      ],
      status: (row.books_balance || 0) <= 0 ? 'PAID IN FULL' : 'PART PAYMENT',
    };
  }

  if (type === 'canteen') {
    const row = db.prepare(`
      SELECT cp.*, s.surname, s.first_name, s.other_names, s.index_number,
             s.father_contact, s.mother_contact, s.guardian_contact,
             c.name AS class_name, u.full_name AS received_by_name,
             t.label AS term_label, y.label AS year_label
      FROM canteen_payments cp
      JOIN students s ON s.id = cp.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      LEFT JOIN terms t ON t.id = cp.term_id
      LEFT JOIN academic_years y ON y.id = t.academic_year_id
      LEFT JOIN users u ON u.id = cp.received_by
      WHERE cp.id = ?
    `).get(paymentId);
    if (!row) return null;
    return {
      ...base,
      title: 'CANTEEN PAYMENT RECEIPT',
      receipt_number: row.receipt_number || '',
      student_id: row.student_id,
      student_name: `${row.surname} ${row.first_name} ${row.other_names || ''}`.trim(),
      student_index: row.index_number,
      student_class: row.class_name || '',
      amount: Number(row.amount) || 0,
      payment_method: row.payment_method || 'Cash',
      reference: row.reference || '',
      term: row.term_label || '',
      academic_year: row.year_label || '',
      received_by: row.received_by_name || '',
      notes: row.notes || '',
      contact: row.father_contact || row.mother_contact || row.guardian_contact || '',
      lines: [
        ['Days Covered', row.days_covered],
        ['Daily Rate', Number(row.daily_rate) || 0],
        ['Period', `${row.start_date || ''} → ${row.end_date || ''}`],
      ],
      status: 'RECORDED',
    };
  }

  if (type === 'transport') {
    const row = db.prepare(`
      SELECT tp.*, s.surname, s.first_name, s.other_names, s.index_number,
             s.father_contact, s.mother_contact, s.guardian_contact,
             c.name AS class_name, r.name AS route_name,
             t.label AS term_label, y.label AS year_label,
             u.full_name AS received_by_name,
             COALESCE(st.fee_override, r.fee_per_term) AS fare
      FROM transport_payments tp
      JOIN students s ON s.id = tp.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      LEFT JOIN transport_routes r ON r.id = tp.route_id
      LEFT JOIN student_transport st ON st.student_id = tp.student_id
      LEFT JOIN terms t ON t.id = tp.term_id
      LEFT JOIN academic_years y ON y.id = t.academic_year_id
      LEFT JOIN users u ON u.id = tp.received_by
      WHERE tp.id = ?
    `).get(paymentId);
    if (!row) return null;
    const fare = Number(row.fare) || 0;
    const paidToDate = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS t FROM transport_payments
      WHERE student_id = ? AND term_id IS ?`).get(row.student_id, row.term_id).t || 0;
    return {
      ...base,
      title: 'TRANSPORT PAYMENT RECEIPT',
      receipt_number: row.receipt_number || '',
      student_id: row.student_id,
      student_name: `${row.surname} ${row.first_name} ${row.other_names || ''}`.trim(),
      student_index: row.index_number,
      student_class: row.class_name || '',
      amount: Number(row.amount) || 0,
      payment_method: row.payment_method || 'Cash',
      reference: row.reference || '',
      term: row.term_label || '',
      academic_year: row.year_label || '',
      received_by: row.received_by_name || '',
      notes: row.notes || '',
      contact: row.father_contact || row.mother_contact || row.guardian_contact || '',
      lines: [
        ['Route', row.route_name || ''],
        ['Fare for the term', fare],
        ['Paid to Date', paidToDate],
        ['Balance', Math.max(0, fare - paidToDate)],
      ],
      status: (fare - paidToDate) <= 0 ? 'PAID IN FULL' : 'PART PAYMENT',
    };
  }

  return null;
}

function money(n) {
  const v = Number(n) || 0;
  return 'GHS ' + v.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ── Render receipt HTML for a given paper size ──
function renderReceiptHtml(school, m, paperSize) {
  const paper = resolvePaper(paperSize);
  const roll = !!paper.roll;
  const pageCss = roll
    ? `@page { size: ${paper.css}; margin: 3mm; } body { width: ${paper.width_mm - 6}mm; }`
    : `@page { size: ${paper.css}; margin: 12mm; }`;
  const baseFont = roll ? '10px' : '12px';
  const titleSize = roll ? '12px' : '15px';
  const detailLines = (m.lines || [])
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      const val = typeof v === 'number' ? money(v) : esc(v);
      return `<tr><td>${esc(k)}</td><td class="r">${val}</td></tr>`;
    }).join('');

  const header = roll
    ? `<div class="ctr">
         ${school.logoData ? `<img src="${school.logoData}" style="height:12mm"/>` : ''}
         <div class="sname">${esc(school.name)}</div>
         ${school.phone ? `<div class="tiny">${esc(school.phone)}</div>` : ''}
       </div>`
    : `<div class="hdr">
         ${school.logoData ? `<img src="${school.logoData}" class="logo"/>` : ''}
         <div>
           <div class="sname">${esc(school.name)}</div>
           ${school.motto ? `<div class="motto">"${esc(school.motto)}"</div>` : ''}
           <div class="tiny">${esc(school.address)}</div>
           <div class="tiny">${[school.phone, school.email].filter(Boolean).map(esc).join(' | ')}</div>
         </div>
       </div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${pageCss}
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color:#111; font-size:${baseFont}; margin:0; }
    .hdr { display:flex; align-items:center; gap:6mm; border-bottom:2px solid ${school.primary}; padding-bottom:3mm; }
    .logo { height:16mm; }
    .ctr { text-align:center; border-bottom:1px dashed #999; padding-bottom:2mm; }
    .sname { font-weight:800; color:${school.primary}; font-size:${roll ? '12px' : '17px'}; letter-spacing:.3px; }
    .motto { font-style:italic; color:${school.accent}; font-size:10px; }
    .tiny { font-size:${roll ? '9px' : '10px'}; color:#444; }
    .title { text-align:center; background:${school.primary}; color:#fff; font-weight:700;
             padding:4px; margin:3mm 0; font-size:${titleSize}; ${roll ? 'background:#000;' : ''} }
    .rno { font-weight:800; color:${school.accent}; font-size:${roll ? '11px' : '14px'}; }
    table { width:100%; border-collapse:collapse; }
    td { padding:2px 3px; vertical-align:top; }
    .r { text-align:right; }
    .kv td:first-child { color:#555; width:42%; }
    .amt { border:1.5px solid ${school.primary}; margin-top:3mm; }
    .amt td { padding:4px 6px; }
    .amt .big { font-size:${roll ? '14px' : '18px'}; font-weight:800; color:${school.primary}; }
    .words { font-style:italic; font-size:${roll ? '9px' : '10px'}; margin-top:2mm; color:#333; }
    .status { display:inline-block; margin-top:2mm; padding:1px 8px; border-radius:10px; font-weight:700; font-size:10px;
              background:${school.accent}22; color:${school.accent}; }
    .foot { margin-top:5mm; text-align:center; font-size:${roll ? '9px' : '10px'}; color:#555; }
    .sig { margin-top:8mm; text-align:right; }
  </style></head><body>
    ${header}
    <div class="title">${esc(m.title)}</div>
    <table class="kv">
      <tr><td>Receipt No.</td><td class="r"><span class="rno">${esc(m.receipt_number || '—')}</span></td></tr>
      <tr><td>Date</td><td class="r">${esc(m.date_long)} ${esc(m.time)}</td></tr>
      <tr><td>Student</td><td class="r">${esc(m.student_name)}</td></tr>
      <tr><td>Index No.</td><td class="r">${esc(m.student_index || '')}</td></tr>
      ${m.student_class ? `<tr><td>Class</td><td class="r">${esc(m.student_class)}</td></tr>` : ''}
      ${m.term ? `<tr><td>Term</td><td class="r">${esc(m.term)} ${esc(m.academic_year || '')}</td></tr>` : ''}
      <tr><td>Paid For</td><td class="r"><b>${esc(m.purpose_label || m.title.replace(/ PAYMENT RECEIPT$/i, ''))}</b></td></tr>
    </table>
    <table class="amt">
      <tr><td>Amount Paid</td><td class="r big">${money(m.amount)}</td></tr>
      <tr><td>Payment Method</td><td class="r">${esc(m.payment_method || 'Cash')}</td></tr>
      ${m.reference ? `<tr><td>Reference</td><td class="r">${esc(m.reference)}</td></tr>` : ''}
    </table>
    <div class="words">${esc(amountInWords(m.amount))}</div>
    ${detailLines ? `<table class="kv" style="margin-top:3mm">${detailLines}</table>` : ''}
    ${m.status ? `<div class="status">${esc(m.status)}</div>` : ''}
    <div class="tiny" style="margin-top:3mm">Received by: ${esc(m.received_by || '—')}</div>
    ${roll ? '' : `<div class="sig">_______________________<br/>Authorised Signature</div>`}
    <div class="foot">${esc(school.footer)}</div>
  </body></html>`;
}

// ── HTML → PDF honoring paper size (incl. thermal roll) ──
async function htmlToPdf(html, outPath, paperSize) {
  const { BrowserWindow } = require('electron');
  const paper = resolvePaper(paperSize);
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  const tmpPath = outPath + '.tmp.html';
  try {
    fs.writeFileSync(tmpPath, html, 'utf8');
    await win.loadFile(tmpPath);
    const opts = { printBackground: true, margins: { marginType: 'default' } };
    if (paper.roll) {
      // Let the CSS @page (e.g. 80mm auto) drive a continuous receipt page.
      opts.preferCSSPageSize = true;
      opts.pageSize = { width: paper.width_mm * 1000, height: 297 * 1000 };
    } else {
      opts.pageSize = paper.css;
    }
    const data = await win.webContents.printToPDF(opts);
    fs.writeFileSync(outPath, data);
  } finally {
    win.close();
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
  return outPath;
}

// ── Persist a durable receipt row for a payment (idempotent per source) ──
function autoReceiptForPayment(db, type, paymentId) {
  try {
    const autoOn = getSetting(db, 'receipt_auto_generate', 'true') !== 'false';
    // Even when auto-print is off we still log the receipt so it can be
    // reprinted/re-sent later; only skip for canteen if fully disabled.
    const model = buildReceiptModel(db, type, paymentId);
    if (!model) return null;
    const existing = db.prepare(
      'SELECT id FROM receipts WHERE source = ? AND source_id = ?'
    ).get(type, paymentId);
    if (existing) return existing;
    const term = db.prepare('SELECT id, academic_year_id FROM terms WHERE is_current = 1').get();
    const r = db.prepare(`
      INSERT INTO receipts
        (receipt_number, receipt_type, source, source_id, student_id, amount,
         payment_method, term_id, academic_year_id, payer_name, recipient_contact,
         delivery_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued')
    `).run(
      model.receipt_number || null, type, type, paymentId,
      model.student_id || null, model.amount || 0,
      model.payment_method || null, term?.id || null, term?.academic_year_id || null,
      model.student_name || null, model.contact || null
    );
    return { id: r.lastInsertRowid };
  } catch (e) {
    return null;
  }
}

// Pick the recipient (phone or email) for a payment based on config + the
// student's parent/guardian records. `field` is 'contact' or 'email'.
function pickRecipient(db, studentId, field, source) {
  const cols = field === 'email'
    ? { father: 'father_email', mother: 'mother_email', guardian: 'guardian_email' }
    : { father: 'father_contact', mother: 'mother_contact', guardian: 'guardian_contact' };
  const s = db.prepare(`SELECT ${cols.father} AS f, ${cols.mother} AS m, ${cols.guardian} AS g FROM students WHERE id = ?`).get(studentId);
  if (!s) return '';
  if (source === 'father')   return s.f || '';
  if (source === 'mother')   return s.m || '';
  if (source === 'guardian') return s.g || '';
  return s.f || s.m || s.g || ''; // auto: first available
}

// Automatically deliver a receipt for a payment via the configured channels.
// Logs each message to notification_log, then hands it to the transport layer
// (Arkesel SMS / SMTP email) asynchronously so the payment never blocks on the
// network. Stamps the receipts row. Never throws.
function autoDeliverReceipt(db, type, paymentId, getResourcePath) {
  try {
    if (getSetting(db, 'receipt_delivery_enabled', 'false') !== 'true') return null;
    const channels = getSetting(db, 'receipt_delivery_channels', 'sms')
      .split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
    if (!channels.length) return null;

    const model = buildReceiptModel(db, type, paymentId);
    if (!model || !model.student_id) return null;

    const school = schoolInfo(db, getResourcePath);
    const smsSource = getSetting(db, 'receipt_delivery_contact', 'auto');
    const emailSource = getSetting(db, 'receipt_delivery_email_source', 'auto');
    const smsBody = `Dear Parent, we received GHS ${Number(model.amount).toFixed(2)} for ${model.student_name} (${model.student_index || ''}). Receipt ${model.receipt_number || ''}. -${school.name}`;
    const emailSubject = `Payment Receipt ${model.receipt_number || ''} — ${school.name}`;
    let emailHtml = null;

    let transport = null;
    try { transport = require('./_transport'); } catch (_) {}

    const delivered = [];
    for (const ch of channels) {
      if (ch !== 'sms' && ch !== 'email') continue;
      const to = ch === 'email'
        ? pickRecipient(db, model.student_id, 'email', emailSource)
        : pickRecipient(db, model.student_id, 'contact', smsSource);
      const r = db.prepare(`
        INSERT INTO notification_log (channel, recipient_type, recipient_name, recipient_contact,
          message_body, template_used, delivery_status)
        VALUES (?, 'parent', ?, ?, ?, 'receipt_auto', ?)
      `).run(ch, model.student_name || '', to || '', smsBody, to ? 'pending' : 'no_contact');
      if (to) {
        delivered.push(ch);
        if (transport) {
          if (ch === 'email' && !emailHtml) emailHtml = renderReceiptHtml(school, model, 'A4');
          transport.dispatchAsync(db, r.lastInsertRowid, ch, to, smsBody, { subject: emailSubject, html: ch === 'email' ? emailHtml : undefined });
        }
      }
    }
    try {
      db.prepare("UPDATE receipts SET delivery_status = ?, delivered_channels = ? WHERE source = ? AND source_id = ?")
        .run(delivered.length ? 'sending' : 'no_contact', delivered.join(','), type, paymentId);
    } catch (_) {}
    return { channels: delivered };
  } catch (e) {
    return null;
  }
}

module.exports = {
  PAPER, resolvePaper, buildReceiptModel, renderReceiptHtml,
  htmlToPdf, autoReceiptForPayment, autoDeliverReceipt, pickRecipient,
  schoolInfo, amountInWords,
};
