// Nickland Edusoft — Receipt Templates IPC
// User uploads .docx templates with merge tags like {{student_name}}, {{amount}}.
// The app substitutes the tags at print time, preserving all Word formatting.
// Copyright © 2026 Nickland Sales. All rights reserved.

const fs = require('fs');
const path = require('path');

// Standard merge tags available in all receipt types
const MERGE_TAGS = {
  fees: [
    'school_name', 'school_motto', 'school_address', 'school_phone',
    'school_email', 'school_logo',
    'receipt_number', 'date', 'date_long', 'time',
    'student_name', 'student_index', 'student_class', 'student_other_names',
    'amount', 'amount_words', 'payment_method', 'reference',
    'term', 'academic_year', 'received_by', 'notes',
    'gross_billed', 'discount_amount', 'net_billed',
    'total_paid_to_date', 'balance', 'payment_status',
  ],
  books: [
    'school_name', 'school_motto', 'school_address', 'school_phone',
    'school_email', 'school_logo',
    'receipt_number', 'date', 'date_long', 'time',
    'student_name', 'student_index', 'student_class',
    'amount', 'amount_words', 'payment_method', 'reference',
    'academic_year', 'received_by', 'notes',
    'books_total', 'books_paid_to_date', 'books_balance',
  ],
  canteen: [
    'school_name', 'school_motto', 'school_address', 'school_phone',
    'school_email', 'school_logo',
    'receipt_number', 'date', 'date_long', 'time',
    'student_name', 'student_index', 'student_class',
    'amount', 'amount_words', 'days_covered', 'start_date', 'end_date',
    'payment_method', 'received_by', 'notes',
  ],
  general: [
    'school_name', 'school_motto', 'school_address', 'school_phone',
    'school_email', 'school_logo',
    'receipt_number', 'date', 'date_long', 'time',
    'payer_name', 'amount', 'amount_words', 'payment_method',
    'reference', 'purpose', 'received_by', 'notes',
  ],
};

module.exports = function registerReceiptTemplatesHandlers(ipcMain, db, userDataPath) {

  ipcMain.handle('receipts:list-templates', (_e, filters = {}) => {
    let sql = `
      SELECT rt.*, u.full_name AS uploaded_by_name
      FROM receipt_templates rt
      LEFT JOIN users u ON u.id = rt.uploaded_by
      WHERE rt.is_active = 1
    `;
    const params = [];
    if (filters.templateType) { sql += ' AND rt.template_type = ?'; params.push(filters.templateType); }
    sql += ' ORDER BY rt.template_type, rt.created_at DESC';
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('receipts:upload-template', (_e, data) => {
    if (!data.template_type || !data.name || !data.sourcePath) {
      return { ok: false, error: 'template_type, name and file required' };
    }
    if (!fs.existsSync(data.sourcePath)) {
      return { ok: false, error: 'source file not found' };
    }
    const ext = path.extname(data.sourcePath).toLowerCase();
    if (ext !== '.docx') {
      return { ok: false, error: 'Only .docx templates supported. Edit your receipt in Microsoft Word and save as .docx.' };
    }
    const destDir = path.join(userDataPath, 'uploads', 'receipt_templates');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const filename = `${data.template_type}_${Date.now()}.docx`;
    const destPath = path.join(destDir, filename);
    fs.copyFileSync(data.sourcePath, destPath);

    const isDefault = data.is_default ? 1 : 0;
    if (isDefault) {
      db.prepare(`
        UPDATE receipt_templates SET is_default = 0 WHERE template_type = ?
      `).run(data.template_type);
    }

    const r = db.prepare(`
      INSERT INTO receipt_templates
        (template_type, name, description, file_path, is_default, is_active, uploaded_by)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(
      data.template_type, data.name, data.description || null,
      destPath, isDefault, data.uploaded_by || null
    );
    return { ok: true, id: r.lastInsertRowid, path: destPath };
  });

  ipcMain.handle('receipts:set-default', (_e, { id, templateType }) => {
    db.prepare('UPDATE receipt_templates SET is_default = 0 WHERE template_type = ?').run(templateType);
    db.prepare('UPDATE receipt_templates SET is_default = 1 WHERE id = ?').run(id);
    return { ok: true };
  });

  ipcMain.handle('receipts:delete-template', (_e, id) => {
    const t = db.prepare('SELECT file_path FROM receipt_templates WHERE id = ?').get(id);
    if (t?.file_path && fs.existsSync(t.file_path)) {
      try { fs.unlinkSync(t.file_path); } catch (e) {}
    }
    db.prepare('UPDATE receipt_templates SET is_active = 0 WHERE id = ?').run(id);
    return { ok: true };
  });

  ipcMain.handle('receipts:available-tags', (_e, templateType) => {
    return MERGE_TAGS[templateType] || MERGE_TAGS.fees;
  });

  // Generate a receipt: substitutes merge tags in the docx template
  ipcMain.handle('receipts:generate', (_e, { templateType, paymentId, paymentSource }) => {
    // paymentSource: 'fees' | 'books' | 'canteen'

    const tpl = db.prepare(`
      SELECT * FROM receipt_templates
      WHERE template_type = ? AND is_default = 1 AND is_active = 1
      LIMIT 1
    `).get(templateType);

    if (!tpl) {
      return { ok: false, error: `No default ${templateType} receipt template uploaded. Go to Settings → Receipt Templates to upload one.` };
    }
    if (!fs.existsSync(tpl.file_path)) {
      return { ok: false, error: `Template file is missing on disk: ${tpl.file_path}` };
    }

    // Build the data map
    const data = buildReceiptData(db, paymentSource, paymentId);
    if (!data) return { ok: false, error: 'payment not found' };

    // Try docx substitution; if the package isn't installed, fall back gracefully
    try {
      const PizZip = require('pizzip');
      const Docxtemplater = require('docxtemplater');

      const content = fs.readFileSync(tpl.file_path, 'binary');
      const zip = new PizZip(content);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: '{{', end: '}}' },
        nullGetter: () => '',
      });
      doc.render(data);

      // Save output
      const outDir = path.join(userDataPath, 'receipts');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const safeName = (data.receipt_number || `receipt_${paymentId}`).replace(/[/\\:*?"<>|]/g, '_');
      const outPath = path.join(outDir, `${safeName}_${Date.now()}.docx`);
      const buf = doc.getZip().generate({ type: 'nodebuffer' });
      fs.writeFileSync(outPath, buf);

      return {
        ok: true,
        template_path: tpl.file_path,
        template_name: tpl.name,
        output_path: outPath,
        data,
      };
    } catch (e) {
      const isModuleMissing = /Cannot find module/.test(e.message || '');
      return {
        ok: false,
        error: isModuleMissing
          ? 'Receipt rendering requires docxtemplater. Run: npm install docxtemplater pizzip'
          : `Receipt generation failed: ${e.message || e}`,
        data,  // Return the merge map anyway so the UI can still preview
      };
    }
  });
};

// Build a merge-tag data map from a payment record
function buildReceiptData(db, paymentSource, paymentId) {
  const data = {};
  const settings = db.prepare("SELECT key, value FROM settings WHERE category IN ('school','branding')").all();
  const sch = Object.fromEntries(settings.map(s => [s.key, s.value]));
  data.school_name = sch.school_name || '';
  data.school_motto = sch.school_motto || '';
  data.school_address = sch.school_address || '';
  data.school_phone = sch.school_phone_1 || '';
  data.school_email = sch.school_email || '';
  data.school_logo = sch.school_logo_path || '';

  const now = new Date();
  data.date = now.toISOString().slice(0, 10);
  data.date_long = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  data.time = now.toTimeString().slice(0, 5);

  if (paymentSource === 'fees') {
    const row = db.prepare(`
      SELECT p.*, s.surname, s.first_name, s.other_names, s.index_number,
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

    Object.assign(data, {
      receipt_number: row.receipt_number,
      student_name: `${row.surname} ${row.first_name}`.trim(),
      student_other_names: row.other_names || '',
      student_index: row.index_number,
      student_class: row.class_name,
      amount: Number(row.amount).toFixed(2),
      amount_words: amountInWords(row.amount),
      payment_method: row.payment_method,
      reference: row.reference || '',
      term: row.term_label || '',
      academic_year: row.year_label || '',
      received_by: row.received_by_name || '',
      notes: row.notes || '',
      gross_billed: Number(row.total_billed || 0).toFixed(2),
      total_paid_to_date: Number(row.total_paid || 0).toFixed(2),
      balance: Number(row.balance || 0).toFixed(2),
      payment_status: (row.balance || 0) <= 0 ? 'PAID IN FULL' : 'PART PAYMENT',
    });
  } else if (paymentSource === 'books') {
    const row = db.prepare(`
      SELECT bp.*, s.surname, s.first_name, s.other_names, s.index_number,
             c.name AS class_name, y.label AS year_label,
             u.full_name AS received_by_name,
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
    Object.assign(data, {
      receipt_number: row.receipt_number,
      student_name: `${row.surname} ${row.first_name}`.trim(),
      student_index: row.index_number,
      student_class: row.class_name,
      amount: Number(row.amount).toFixed(2),
      amount_words: amountInWords(row.amount),
      payment_method: row.payment_method,
      reference: row.reference || '',
      academic_year: row.year_label || '',
      received_by: row.received_by_name || '',
      notes: row.notes || '',
      books_total: Number(row.books_total || 0).toFixed(2),
      books_paid_to_date: Number(row.books_paid || 0).toFixed(2),
      books_balance: Number(row.books_balance || 0).toFixed(2),
    });
  } else if (paymentSource === 'canteen') {
    const row = db.prepare(`
      SELECT cp.*, s.surname, s.first_name, s.index_number,
             c.name AS class_name, u.full_name AS received_by_name
      FROM canteen_payments cp
      JOIN students s ON s.id = cp.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      LEFT JOIN users u ON u.id = cp.received_by
      WHERE cp.id = ?
    `).get(paymentId);
    if (!row) return null;
    Object.assign(data, {
      receipt_number: row.receipt_number || '',
      student_name: `${row.surname} ${row.first_name}`.trim(),
      student_index: row.index_number,
      student_class: row.class_name,
      amount: Number(row.amount).toFixed(2),
      amount_words: amountInWords(row.amount),
      days_covered: row.days_covered,
      start_date: row.start_date,
      end_date: row.end_date,
      payment_method: row.payment_method,
      received_by: row.received_by_name || '',
      notes: row.notes || '',
    });
  }
  return data;
}

// Simple amount-in-words for Ghanaian cedis (handles up to billions)
function amountInWords(amount) {
  if (!amount && amount !== 0) return '';
  const num = Math.round(amount * 100) / 100;
  const [int, dec] = num.toFixed(2).split('.');
  const intWords = intToWords(parseInt(int, 10));
  const pesewasNum = parseInt(dec, 10);
  let result = intWords + ' Ghana Cedis';
  if (pesewasNum > 0) {
    result += ' and ' + intToWords(pesewasNum) + ' Pesewas';
  }
  return result + ' Only';
}

function intToWords(n) {
  if (n === 0) return 'Zero';
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function under1000(x) {
    if (x === 0) return '';
    if (x < 20) return ones[x];
    if (x < 100) return tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : '');
    return ones[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' and ' + under1000(x % 100) : '');
  }
  if (n < 1000) return under1000(n);
  if (n < 1000000) return under1000(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + under1000(n % 1000) : '');
  if (n < 1000000000) return under1000(Math.floor(n / 1000000)) + ' Million' + (n % 1000000 ? ' ' + intToWords(n % 1000000) : '');
  return under1000(Math.floor(n / 1000000000)) + ' Billion' + (n % 1000000000 ? ' ' + intToWords(n % 1000000000) : '');
}
