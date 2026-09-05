// Reports IPC handlers — HTML-to-PDF generation for printable documents.
// Uses Puppeteer (bundled with Electron's Chromium when packaged).
const fs = require('fs');
const path = require('path');
const { getSetting } = require('../utils/idgen');

function registerReportsHandlers(ipcMain, db, userDataPath, getResourcePath) {
  ipcMain.handle('reports:generate-report-cards', async (_e, params) => {
    return await generateReportCards(db, userDataPath, getResourcePath, params);
  });

  // Render a single student's report card as HTML for in-app preview (#14).
  // Same template as the PDF — just returned as a string instead of written to disk.
  ipcMain.handle('reports:render-card-html', (_e, { studentId, termId, colorMode = 'color' }) =>
    renderCardHtml(db, getResourcePath, { studentId, termId, colorMode }));
  ipcMain.handle('reports:generate-bills-pdf', async (_e, params) => {
    return await generateBillsPdf(db, userDataPath, getResourcePath, params);
  });
  ipcMain.handle('reports:generate-payslip', async (_e, { salaryId, options }) => {
    return await generatePayslip(db, userDataPath, getResourcePath, salaryId, options || {});
  });
  ipcMain.handle('reports:generate-receipt', async (_e, { paymentId, options }) => {
    return await generateReceipt(db, userDataPath, getResourcePath, paymentId, options || {});
  });
  // Canteen and books bills print on the SAME stationery as the fees bill —
  // same header, same part-sectioned layout, same amount-due box. A school that
  // hands a parent three bills that look like three different schools' bills
  // has a problem no feature makes up for.
  ipcMain.handle('reports:generate-canteen-bills', async (_e, params) => {
    return await generateCanteenBills(db, userDataPath, getResourcePath, params || {});
  });
  ipcMain.handle('reports:generate-books-bills', async (_e, params) => {
    return await generateBooksBills(db, userDataPath, getResourcePath, params || {});
  });
  ipcMain.handle('reports:debtors-list', async (_e, { termId, options }) => {
    return await generateDebtorsList(db, userDataPath, getResourcePath, termId, options || {});
  });
  ipcMain.handle('reports:class-list', async (_e, { classId, options }) => {
    return await generateClassList(db, userDataPath, getResourcePath, classId, options || {});
  });

  // === Student profile (formal printable record) ===
  ipcMain.handle('reports:generate-student-profile', async (_e, { studentId, options }) => {
    return await generateStudentProfile(db, userDataPath, getResourcePath, studentId, options || {});
  });

  // === Attestation / Testimonial document ===
  ipcMain.handle('reports:generate-attestation', async (_e, { studentId, kind, options }) => {
    return await generateAttestation(db, userDataPath, getResourcePath, studentId, kind, options || {});
  });

  // === Exam paper (Ghanaian-style printable A4 question paper) ===
  ipcMain.handle('reports:generate-exam-paper', async (_e, { paperId, options }) => {
    return await generateExamPaper(db, userDataPath, getResourcePath, paperId, options || {});
  });
}

// --- shared helpers ---

// ── Documents the apps print ────────────────────────────────────────────────
// A report card printed from a teacher's phone has to be the report card the
// office prints, down to the millimetre — a school that hands out two different
// documents with the same title has a problem no feature makes up for. So the
// phone and the browser do not have templates of their own: they ask the
// desktop for THIS html and print exactly what comes back.
//
// These are the same builders the PDF path uses (`generateReportCards`,
// `generateStudentProfile`); the only difference is where the string ends up.

function renderCardHtml(db, getResourcePath, { studentId, termId, colorMode = 'color' }) {
  const header = getSchoolHeader(db, getResourcePath, colorMode);
  const student = db.prepare(`
    SELECT s.*, c.name AS class_name, c.short_code AS class_short FROM students s
    LEFT JOIN class_groups c ON c.id = s.current_class_id WHERE s.id = ?
  `).get(studentId);
  if (!student) return { ok: false, error: 'Student not found' };
  const term = db.prepare(`
    SELECT t.*, ay.label AS year_label FROM terms t
    JOIN academic_years ay ON ay.id = t.academic_year_id WHERE t.id = ?
  `).get(termId);
  const scores = db.prepare(`
    SELECT sc.*, sub.name AS subject_name
    FROM scores sc JOIN subjects sub ON sub.id = sc.subject_id
    WHERE sc.student_id = ? AND sc.term_id = ? ORDER BY sub.name
  `).all(studentId, termId);
  const filteredScores = filterScoresByClassMapping(db, student.current_class_id, scores);
  const summary = db.prepare(
    'SELECT * FROM student_term_summary WHERE student_id = ? AND term_id = ?'
  ).get(studentId, termId);
  const enriched = enrichSummaryLive(db, studentId, termId, student.current_class_id, summary);
  const signatures = resolveReportSignatures(db);
  const examWeight = getExamWeight(db);

  const inner = reportCardHtml(header, student, filteredScores, enriched, term, signatures, examWeight);
  const styles = baseStyles() + reportCardStyles(header);
  return {
    ok: true,
    html: inner,
    styles,
    meta: {
      student_name: `${student.surname || ''} ${student.first_name || ''}`.trim(),
      index_number: student.index_number,
      class_name: student.class_name || student.class_short,
      scores_count: filteredScores.length,
    },
  };
}

// A complete, standalone page — what a browser needs in order to print it.
// `generateReportCards` wraps the same `inner` in the same `styles` before
// handing it to Chromium, so the two paths cannot drift.
function reportCardDocument(db, getResourcePath, { studentId, termId, colorMode = 'color' }) {
  const r = renderCardHtml(db, getResourcePath, { studentId, termId, colorMode });
  if (!r.ok) return r;
  return {
    ok: true,
    meta: r.meta,
    document: `<!doctype html><html><head><meta charset="utf-8"><title>Report card — ${
      String(r.meta.student_name || 'Pupil').replace(/[<>&"]/g, '')
    }</title><style>${r.styles}</style></head><body>${r.html}</body></html>`,
  };
}

function getSchoolHeader(db, getResourcePath, colorMode = 'color') {
  const name = getSetting(db, 'school_name', 'AVE MARIA PREPARATORY SCHOOL');
  const motto = getSetting(db, 'school_motto', '');
  const address = getSetting(db, 'school_address', '');
  const digital = getSetting(db, 'school_digital_address', '');
  const email = getSetting(db, 'school_email', '');
  const phone1 = getSetting(db, 'school_phone_1', '');
  const phone2 = getSetting(db, 'school_phone_2', '');
  const logoPath = getSetting(db, 'school_logo_path', '') || getResourcePath('logo.png');
  const primaryColor = colorMode === 'bw' ? '#000' : getSetting(db, 'school_color_primary', '#1B3A6B');
  const accentColor = colorMode === 'bw' ? '#444' : getSetting(db, 'school_color_accent', '#C9961A');
  let logoData = '';
  if (logoPath && fs.existsSync(logoPath)) {
    const buf = fs.readFileSync(logoPath);
    const ext = path.extname(logoPath).slice(1).toLowerCase() || 'png';
    logoData = `data:image/${ext};base64,${buf.toString('base64')}`;
  }
  return { name, motto, address, digital, email, phone1, phone2, logoData, primaryColor, accentColor, colorMode };
}

function schoolHeaderHtml(header) {
  const greyFilter = header.colorMode === 'bw' ? 'filter: grayscale(100%);' : '';
  return `
    <div class="school-header" style="text-align:center; padding:6mm 6mm 4mm; border-bottom:2px solid ${header.primaryColor}; margin-bottom:4mm;">
      <div style="display:flex; align-items:center; justify-content:center; gap:10mm;">
        ${header.logoData ? `<img src="${header.logoData}" style="height:18mm; ${greyFilter}" />` : ''}
        <div style="text-align:center;">
          <div style="font-size:18pt; font-weight:700; color:${header.primaryColor}; letter-spacing:1px;">${header.name}</div>
          <div style="font-size:9pt; font-style:italic; color:${header.accentColor}; margin:1mm 0;">"${header.motto}"</div>
          <div style="font-size:8pt; color:#333;">${header.address}</div>
          <div style="font-size:8pt; color:#333;">
            ${header.digital ? `Digital Address: ${header.digital} &nbsp;|&nbsp; ` : ''}
            ${header.email ? `Email: ${header.email}` : ''}
            ${header.phone1 ? ` &nbsp;|&nbsp; ${header.phone1}` : ''}
            ${header.phone2 ? `, ${header.phone2}` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

function baseStyles() {
  return `
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', 'Arial', sans-serif; font-size: 10pt; color: #111; margin: 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 3px 6px; text-align: left; vertical-align: middle; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .small { font-size: 8.5pt; }
    .bold { font-weight: 700; }
    .page { padding: 0; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .bill-section { margin-bottom: 4mm; page-break-inside: avoid; }
    .bill-section-title {
      color: #fff; padding: 4px 8px; font-weight: 700;
      font-size: 10pt; letter-spacing: 0.5px;
      border-radius: 2px 2px 0 0;
    }
    .profile-section { margin-bottom: 5mm; page-break-inside: avoid; }
    .profile-section-title {
      font-size: 10pt; font-weight: 700; color: #fff;
      padding: 4px 10px; margin-bottom: 2mm;
    }
    .signature-line { border-top: 1px solid #333; margin-top: 18mm; padding-top: 2mm; text-align: center; }
  `;
}

// === Report cards ===
async function generateReportCards(db, userDataPath, getResourcePath, params) {
  const { termId, scope, classId, studentIds, colorMode = 'color', format = 'pdf' } = params;
  let students = [];
  if (scope === 'all') {
    students = db.prepare(
      "SELECT id FROM students WHERE status = 'Active' ORDER BY current_class_id, surname"
    ).all();
  } else if (scope === 'class') {
    students = db.prepare(
      "SELECT id FROM students WHERE status = 'Active' AND current_class_id = ? ORDER BY surname"
    ).all(classId);
  } else if (scope === 'selected') {
    students = (studentIds || []).map(id => ({ id }));
  } else if (scope === 'position-range') {
    const { startRank, endRank } = params;
    students = db.prepare(`
      SELECT student_id AS id FROM student_term_summary
      WHERE term_id = ? AND class_group_id = ? AND class_rank BETWEEN ? AND ?
      ORDER BY class_rank
    `).all(termId, classId, startRank, endRank);
  }

  const header = getSchoolHeader(db, getResourcePath, colorMode);
  const term = db.prepare(`
    SELECT t.*, ay.label AS year_label FROM terms t
    JOIN academic_years ay ON ay.id = t.academic_year_id WHERE t.id = ?
  `).get(termId);
  const signatures = resolveReportSignatures(db);
  const examWeight = getExamWeight(db);

  const pages = [];
  for (const s of students) {
    const report = db.prepare(`
      SELECT s.*, c.name AS class_name, c.short_code AS class_short FROM students s
      LEFT JOIN class_groups c ON c.id = s.current_class_id WHERE s.id = ?
    `).get(s.id);
    if (!report) continue;
    const scores = db.prepare(`
      SELECT sc.*, sub.name AS subject_name
      FROM scores sc JOIN subjects sub ON sub.id = sc.subject_id
      WHERE sc.student_id = ? AND sc.term_id = ? ORDER BY sub.name
    `).all(s.id, termId);
    const filteredScores = filterScoresByClassMapping(db, report.current_class_id, scores);
    const summary = db.prepare(
      'SELECT * FROM student_term_summary WHERE student_id = ? AND term_id = ?'
    ).get(s.id, termId);
    const enriched = enrichSummaryLive(db, s.id, termId, report.current_class_id, summary);
    // Always push a page — per #15 the architecture must show even without entries
    pages.push(reportCardHtml(header, report, filteredScores, enriched, term, signatures, examWeight));
  }

  if (pages.length === 0) {
    return { ok: false, error: 'No students matched the selected scope.' };
  }

  const html = `
    <!doctype html><html><head><style>${baseStyles()}${reportCardStyles(header)}</style></head>
    <body>${pages.join('')}</body></html>
  `;
  const filename = `report_cards_${Date.now()}.${format === 'docx' ? 'html' : 'pdf'}`;
  const outPath = path.join(userDataPath, 'reports', filename);
  if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });

  if (format === 'pdf') {
    await htmlToPdf(html, outPath);
  } else {
    fs.writeFileSync(outPath, html, 'utf8');
  }
  return { ok: true, path: outPath, count: pages.length };
}

// ═════════════════════════════════════════════════════════════════════════
// TERMINAL REPORT CARD — clean rebuild (Phase F7a v2)
//
// Design decisions, all driven by the user's feedback + the Ave Maria template:
//   • Header reuses schoolHeaderHtml() so the look matches the Bill exactly
//     (logo + centered school name + motto + address + email).
//   • Below the header: a single centered "END OF [TERM] EXAMINATION, [YEAR]"
//     line in plain bold text — no banner fill, ink-friendly.
//   • The "TERMINAL REPORT" title stays — big, serif, underlined.
//   • Student details rendered as inline label/value rows. NOT a table.
//   • The ONLY <table> on the page is the scores table.
//   • Conduct / Interests / Talents / Teacher's Remarks rendered as inline
//     rows, each value sitting on an underlined baseline.
//   • Attendance rendered inline with underlined number boxes.
//   • Bottom block: Vacation Date + Reopening Date stacked on the left.
//     When the Proprietor and/or Head Teacher signature toggle is ON AND a
//     signature file is present, the signature image appears on the right,
//     side-by-side with a thin caption rule. When OFF, that whole right
//     column simply disappears — no reserved blank space.
//   • The "Proprietor's Name: …" line is removed entirely.
//   • Per #19, the only fill is a very light grey #f5f5f5 on the table
//     header row. Everything else is thin black-on-white.
// ═════════════════════════════════════════════════════════════════════════

// Lenient boolean parse — handles every way a setting can be serialised
// (string 'true', '1', 'yes', 'on'; boolean true; numeric 1).
function isTrueLike(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const s = v.toLowerCase().trim();
    return s === 'true' || s === '1' || s === 'yes' || s === 'on';
  }
  return false;
}

// Map a 0–100 total onto the Ave Maria remark band.
function remarkForTotal(t) {
  if (t == null) return '';
  if (t >= 85) return 'Advanced';
  if (t >= 70) return 'Proficient';
  if (t >= 55) return 'Approaching Proficiency';
  if (t >= 40) return 'Developing';
  return 'Beginning';
}

// Format a report date for printing. An ISO date (YYYY-MM-DD, as saved by the
// term settings date pickers) becomes e.g. "Wednesday, 1st April 2026"; any
// other value (legacy free-text) is printed unchanged.
function formatReportDate(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s; // free text — print as entered
  const d = new Date(`${s}T00:00:00`);
  if (isNaN(d.getTime())) return s;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const day = d.getDate();
  const ord = (day % 100 >= 11 && day % 100 <= 13) ? 'th' : (['th', 'st', 'nd', 'rd'][day % 10] || 'th');
  return `${days[d.getDay()]}, ${day}${ord} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Read everything the report card needs from settings in a single call.
// No name fields — captions are fixed strings (PROPRIETOR / HEAD TEACHER)
// per the user's removal of the explicit name line.
// Exam weight (the "60%" portion) as configured in settings. Mirrors
// getWeights() in scores.js so the report card converts raw exam marks the
// exact same way recomputeTotal() did when the totals were stored.
function getExamWeight(db) {
  try {
    const r = db.prepare("SELECT value FROM settings WHERE key = 'exam_weight_pct'").get();
    const w = parseFloat(r?.value);
    return Number.isFinite(w) ? w : 60;
  } catch {
    return 60;
  }
}

function resolveReportSignatures(db) {
  const get = (k, d = '') => {
    const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(k);
    return (r && r.value != null) ? r.value : d;
  };
  return {
    propEnabled:       isTrueLike(get('embed_proprietor_signature')),
    propSignaturePath: get('proprietor_signature_path', ''),
    headEnabled:       isTrueLike(get('embed_headmaster_signature')),
    headSignaturePath: get('headmaster_signature_path', ''),
    vacationDate:      get('vacation_date', ''),
    reopeningDate:     get('reopening_date', ''),
    examTitle:         get('current_exam_title', ''),
    signatureSize:     get('signature_size_mm', '22'),
  };
}

// Load a signature image as a base64 data: URI for embedding in PDF.
// Returns '' (silently) if the file isn't present, but logs to the Electron
// main process console so the user can diagnose path mismatches from logs.
function signatureDataUri(filePath, role) {
  if (!filePath) return '';
  if (!fs.existsSync(filePath)) {
    console.warn(`[report-card] ${role} signature path not found on disk: ${filePath}`);
    return '';
  }
  try {
    const buf = fs.readFileSync(filePath);
    const ext = (path.extname(filePath).slice(1) || 'png').toLowerCase();
    return `data:image/${ext};base64,${buf.toString('base64')}`;
  } catch (e) {
    console.warn(`[report-card] ${role} signature read failed: ${e.message}`);
    return '';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Phase F8c — Class → subject mapping filter.
//
// Each class may optionally be mapped to a subset of subjects via the
// `class_subjects` table (managed in Settings → Classes). When such a
// mapping exists, the terminal report card should show ONLY the mapped
// subjects for that class.
//
// CRITICAL FALLBACK — this is the rule that prevents the kind of regression
// the project hit in earlier phase attempts:
//
//   • No classGroupId provided      → return scores unchanged
//   • No class_subjects rows exist  → return scores unchanged (= "show all")
//   • Any SQL error                 → return scores unchanged
//
// In other words: an unmapped class behaves exactly as it did before F8c.
// Only classes the user has explicitly mapped get filtered.
// ─────────────────────────────────────────────────────────────────────────
function filterScoresByClassMapping(db, classGroupId, scores) {
  if (!classGroupId)                    return scores;
  if (!Array.isArray(scores))           return scores;
  if (scores.length === 0)              return scores;
  try {
    const mapped = db.prepare(
      'SELECT subject_id FROM class_subjects WHERE class_group_id = ?'
    ).all(classGroupId);
    if (mapped.length === 0) return scores; // critical fallback
    const allowed = new Set(mapped.map(r => r.subject_id));
    return scores.filter(sc => allowed.has(sc.subject_id));
  } catch (err) {
    console.warn(`[reports/F8c] class-subject filter failed for class ${classGroupId}: ${err.message} — showing all subjects`);
    return scores;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Phase F8a — Live-compute numeric report fields.
//
// student_term_summary holds qualitative fields (conduct, interests, talents,
// remarks). The numeric fields (class_rank, number_on_roll, days_present,
// total_days) are best computed live from the source-of-truth tables at the
// moment the card renders — otherwise they stay stale until someone clicks
// "Rank Class" again.
//
// Strategy:
//   • Take whatever persisted student_term_summary row already exists
//     (possibly null) as the fallback baseline.
//   • For each numeric field, run a focused SQL query in its own try/catch.
//     On success the live value overrides the persisted one.
//     On ANY failure the persisted value survives unchanged — so we can
//     never regress to "worse than before F8a".
//
// Rank semantics mirror the existing `scores:rank-class` handler exactly:
// sort active students in the class by AVG(total_score) DESC and assign
// strict ordinal positions starting at 1. A student with zero score rows
// gets no rank (left blank) — ranking is meaningless for them.
// ─────────────────────────────────────────────────────────────────────────
function enrichSummaryLive(db, studentId, termId, classGroupId, base) {
  const out = { ...(base || {}) };

  // --- class_rank + number_on_roll (computed together from one roster pass) ---
  if (classGroupId) {
    try {
      const roster = db.prepare(`
        SELECT id FROM students
        WHERE current_class_id = ? AND status = 'Active'
      `).all(classGroupId);

      const totalsStmt = db.prepare(`
        SELECT AVG(total_score) AS avg, COUNT(*) AS n
        FROM scores WHERE student_id = ? AND term_id = ?
      `);
      const ranked = roster.map(r => {
        const t = totalsStmt.get(r.id, termId);
        return { id: r.id, avg: (t && t.avg) || 0, n: (t && t.n) || 0 };
      });
      ranked.sort((a, b) => b.avg - a.avg);

      // number_on_roll always overrides persisted (roster is the source of truth).
      out.number_on_roll = roster.length;

      const myIdx = ranked.findIndex(r => r.id === studentId);
      if (myIdx >= 0 && ranked[myIdx].n > 0) {
        out.class_rank = myIdx + 1;
      }
    } catch (err) {
      console.warn(`[reports/F8a] live class_rank/number_on_roll failed for student ${studentId}, term ${termId}: ${err.message}`);
    }
  }

  // --- days_present (per-student, doesn't need classGroupId) ---
  // If no daily attendance rows exist for this student+term, keep the
  // persisted term-summary value. This lets Assessment Compilation save a
  // term-level attendance figure without fabricating dated register rows.
  try {
    const dp = db.prepare(`
      SELECT
        COUNT(*) AS marked_days,
        SUM(CASE WHEN LOWER(status) = 'present' THEN 1 ELSE 0 END) AS present_days
      FROM student_attendance
      WHERE student_id = ? AND term_id = ?
    `).get(studentId, termId);
    if (dp && dp.marked_days > 0) out.days_present = dp.present_days || 0;
  } catch (err) {
    console.warn(`[reports/F8a] live days_present failed for student ${studentId}, term ${termId}: ${err.message}`);
  }

  // --- total_days = distinct attendance dates for any active student in the class+term ---
  if (classGroupId) {
    try {
      const td = db.prepare(`
        SELECT COUNT(DISTINCT sa.date) AS c FROM student_attendance sa
        JOIN students s ON s.id = sa.student_id
        WHERE sa.term_id = ? AND s.current_class_id = ? AND s.status = 'Active'
      `).get(termId, classGroupId);
      if (td && typeof td.c === 'number' && td.c > 0) out.total_days = td.c;
    } catch (err) {
      console.warn(`[reports/F8a] live total_days failed for class ${classGroupId}, term ${termId}: ${err.message}`);
    }
  }

  return out;
}

// Render one student's terminal report as a single .page block.
function reportCardHtml(header, student, scores, summary, term, signatures, examWeight = 60) {
  const sig = signatures || {};
  const fullName = `${student.surname || ''} ${student.first_name || ''} ${student.other_names || ''}`
    .replace(/\s+/g, ' ').trim().toUpperCase();
  const className = student.class_name || student.class_short || '';

  // Vacation/reopening dates: the printed term's own dates win; fall back to the
  // global Terminal Report Layout settings for older data.
  const vacationDate  = formatReportDate(term?.vacation_date)  || formatReportDate(sig.vacationDate) || '';
  const reopeningDate = formatReportDate(term?.reopening_date) || formatReportDate(sig.reopeningDate) || '';

  // Promotion (third term). A non-empty promoted_to means the student advanced;
  // we print "Promoted to <class>" beside the Index No. / Class row.
  const promotedTo = (summary?.promoted_to != null ? String(summary.promoted_to).trim() : '');
  const promotionText = promotedTo ? `Promoted to ${promotedTo}` : '';

  // Exam title — explicit setting wins, otherwise derive from term + year.
  const examTitle = (sig.examTitle ||
    (term ? `End of ${term.label || ''} Examination, ${term.year_label || ''}` : 'Terminal Report')
  ).toUpperCase().replace(/\s+/g, ' ').trim();

  // Score rows. The template prints whole marks, so we ROUND EACH CELL ONCE and
  // then derive every total from those same rounded integers. This is what makes
  // the whole card add up on paper:
  //
  //   • `class_score` is already the converted 40% mark; `exam_score` is stored
  //     RAW (out of 100), so the "EXAM (60%)" column shows the CONVERTED mark
  //     (raw × exam-weight ÷ 100), rounded — never the raw score.
  //   • Per row:      Class + Exam = Total   (exact, both are integers)
  //   • Footer:       ΣClass, ΣExam, ΣTotal are the column sums of the printed
  //                   integers, and ΣClass + ΣExam = ΣTotal by construction.
  //   • Average:      ΣTotal ÷ subjects, so it matches the printed Total Score.
  //
  // Summing rounded cells (rather than rounding a sum of unrounded values) is the
  // fix for the footer showing e.g. 172/427 when the columns visibly add to
  // 170/425.
  const rows = scores || [];
  const computed = rows.map(sc => {
    const cls = Math.round(Number(sc.class_score) || 0);
    const exm = Math.round(((Number(sc.exam_score) || 0) / 100) * examWeight);
    const tot = cls + exm;
    return { sc, cls, exm, tot };
  });
  const scoreRows = computed.map(({ sc, cls, exm, tot }) => {
    const remark = sc.grade_remark || remarkForTotal(tot);
    return `<tr>
      <td class="rc-subj">${escapeHtml(sc.subject_name || '')}</td>
      <td class="rc-num">${cls}</td>
      <td class="rc-num">${exm}</td>
      <td class="rc-num">${tot}</td>
      <td class="rc-remark">${escapeHtml(remark)}</td>
    </tr>`;
  }).join('');

  // Even with zero scores, the layout must still render (per #15).
  const placeholderRow = rows.length === 0
    ? `<tr><td colspan="5" class="rc-placeholder">No scores recorded yet — enter Class and Exam scores to populate this section.</td></tr>`
    : '';

  const totalClass = computed.reduce((s, r) => s + r.cls, 0);
  const totalExam  = computed.reduce((s, r) => s + r.exm, 0);
  const totalAll   = totalClass + totalExam;
  const avgScore   = computed.length ? totalAll / computed.length : 0;
  const avgRemark  = computed.length > 0 ? remarkForTotal(avgScore) : '';

  // Signature blocks. Each one only renders when its toggle is ON AND its
  // file exists on disk. When neither renders, the whole right column is
  // omitted so there's no reserved blank space.
  const propUri = sig.propEnabled ? signatureDataUri(sig.propSignaturePath, 'proprietor') : '';
  const headUri = sig.headEnabled ? signatureDataUri(sig.headSignaturePath, 'headmaster') : '';
  const sigSize = Math.max(12, Math.min(40, parseInt(sig.signatureSize || 22, 10)));

  function signatureBlock(uri, caption) {
    if (!uri) return '';
    return `
      <div class="rc-sig-block">
        <img class="rc-sig-img" src="${uri}" style="height:${sigSize}mm;" />
        <div class="rc-sig-caption">${escapeHtml(caption)}</div>
      </div>
    `;
  }
  const anySignature = !!(propUri || headUri);

  return `
    <div class="page rc-page">

      ${schoolHeaderHtml(header)}

      <div class="rc-exam-banner">${escapeHtml(examTitle)}</div>

      <div class="rc-title">TERMINAL REPORT</div>

      <div class="rc-info-block">
        <div class="rc-info-line">
          <span class="rc-info-cell"><b>Index No:</b> <span class="rc-info-v">${escapeHtml(student.index_number || '')}</span></span>
          <span class="rc-info-cell"><b>Class:</b> <span class="rc-info-v">${escapeHtml(className)}</span></span>
          ${promotionText ? `<span class="rc-info-cell rc-promo">${escapeHtml(promotionText)}</span>` : ''}
        </div>
        <div class="rc-info-line">
          <span class="rc-info-cell rc-info-full"><b>Student Name:</b> <span class="rc-info-v rc-info-name">${escapeHtml(fullName)}</span></span>
        </div>
        <div class="rc-info-line">
          <span class="rc-info-cell"><b>Position in Class:</b> <span class="rc-info-v rc-info-narrow">${summary?.class_rank ?? ''}</span></span>
          <span class="rc-info-cell"><b>Number on Roll:</b> <span class="rc-info-v rc-info-narrow">${summary?.number_on_roll ?? ''}</span></span>
        </div>
      </div>

      <table class="rc-scores">
        <thead>
          <tr>
            <th class="rc-h-subj">SUBJECT</th>
            <th class="rc-h-num">CLASS (40%)</th>
            <th class="rc-h-num">EXAM (60%)</th>
            <th class="rc-h-num">TOTAL</th>
            <th class="rc-h-remark">REMARKS</th>
          </tr>
        </thead>
        <tbody>
          ${scoreRows}${placeholderRow}
        </tbody>
        <tfoot>
          <tr class="rc-totals">
            <td class="rc-subj"><b>Total Score:</b></td>
            <td class="rc-num"><b>${Math.round(totalClass)}</b></td>
            <td class="rc-num"><b>${Math.round(totalExam)}</b></td>
            <td class="rc-num"><b>${Math.round(totalAll)}</b></td>
            <td class="rc-remark"></td>
          </tr>
          <tr class="rc-totals">
            <td class="rc-subj"><i><b>Average Score:</b></i></td>
            <td></td>
            <td></td>
            <td class="rc-num"><i><b>${(avgScore || 0).toFixed(1).replace(/\.0$/, '')}</b></i></td>
            <td class="rc-remark rc-avg-remark">${escapeHtml(avgRemark)}</td>
          </tr>
        </tfoot>
      </table>

      <div class="rc-qual-block">
        <div class="rc-qual-row">
          <span class="rc-qual-label">Conduct Traits:</span>
          <span class="rc-qual-value">${escapeHtml(summary?.conduct_traits || '')}</span>
        </div>
        <div class="rc-qual-row">
          <span class="rc-qual-label">Learner Interests:</span>
          <span class="rc-qual-value">${escapeHtml(summary?.learner_interests || '')}</span>
        </div>
        <div class="rc-qual-row">
          <span class="rc-qual-label">Learner Talents:</span>
          <span class="rc-qual-value">${escapeHtml(summary?.learner_talents || '')}</span>
        </div>
        <div class="rc-qual-row">
          <span class="rc-qual-label">Teacher's Remarks:</span>
          <span class="rc-qual-value">${escapeHtml(summary?.teacher_remarks || '')}</span>
        </div>
      </div>

      <div class="rc-attendance">
        <b>Attendance:</b>
        <span class="rc-att-num">${summary?.days_present ?? ''}</span>
        <span class="rc-att-word">Out of</span>
        <span class="rc-att-num">${summary?.total_days ?? ''}</span>
      </div>

      <div class="rc-bottom">
        <div class="rc-bottom-left">
          <div class="rc-date-line"><b>Vacation Date:</b> <span class="rc-date-v">${escapeHtml(vacationDate)}</span></div>
          <div class="rc-date-line"><b>Reopening Date:</b> <span class="rc-date-v">${escapeHtml(reopeningDate)}</span></div>
        </div>
        ${anySignature ? `
          <div class="rc-bottom-right">
            ${signatureBlock(propUri, 'PROPRIETOR')}
            ${signatureBlock(headUri, 'HEAD TEACHER')}
          </div>
        ` : ''}
      </div>

    </div>
  `;
}

// Report-card-specific styles. Note: schoolHeaderHtml() already injects its
// own inline styles, so we don't restyle it here — we only style the
// elements that are unique to the terminal report.
function reportCardStyles(header) {
  return `
    .rc-page {
      font-family: 'Cambria', 'Georgia', 'Times New Roman', serif;
      color: #111;
      font-size: 10.5pt;
      line-height: 1.45;
    }

    /* --- Exam banner: plain bold text, centered, NO fill --- */
    .rc-exam-banner {
      text-align: center;
      font-size: 11pt;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      margin: 2mm 0 3mm 0;
    }

    /* --- TERMINAL REPORT title --- */
    .rc-title {
      text-align: center;
      font-family: 'Cambria', 'Georgia', serif;
      font-size: 26pt;
      font-weight: 800;
      text-decoration: underline;
      letter-spacing: 2px;
      margin: 1mm 0 6mm 0;
    }

    /* --- Student info (inline label/value, no table) --- */
    .rc-info-block { margin-bottom: 5mm; font-size: 11pt; }
    .rc-info-line {
      display: flex;
      gap: 20mm;
      margin-bottom: 3mm;
      align-items: baseline;
    }
    .rc-info-cell { white-space: nowrap; }
    .rc-info-cell.rc-info-full { flex: 1; white-space: normal; }
    /* "Promoted to …" — sits on the same row as Index No./Class, spaced evenly
       with the other cells (not flushed to the far right edge). */
    .rc-info-cell.rc-promo {
      font-weight: 700;
      font-style: italic;
      text-decoration: underline;
    }
    .rc-info-v {
      display: inline-block;
      font-weight: 700;
      margin-left: 2mm;
      border-bottom: 1px solid #000;
      padding: 0 3mm 1px 3mm;
      min-width: 22mm;
    }
    .rc-info-v.rc-info-name {
      letter-spacing: 0.4px;
      min-width: 110mm;
      padding-left: 4mm;
    }
    .rc-info-v.rc-info-narrow { min-width: 14mm; text-align: center; }

    /* --- Scores table (the ONLY table on the page) --- */
    .rc-scores {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #000;
      margin-bottom: 4mm;
      page-break-inside: avoid;
    }
    .rc-scores th, .rc-scores td {
      border: 1px solid #000;
      padding: 1.8mm 3mm;
      font-size: 10.5pt;
    }
    .rc-scores thead th {
      background: #f5f5f5;
      font-weight: 700;
      text-align: center;
      letter-spacing: 0.3px;
      font-size: 10pt;
    }
    .rc-h-subj { width: 25%; text-align: left !important; }
    .rc-h-num { width: 15%; }
    .rc-h-remark { width: 30%; text-align: left !important; }
    .rc-subj { text-align: right; padding-right: 4mm; }
    .rc-num { text-align: center; }
    .rc-remark { text-align: left; }
    .rc-totals td { border-top: 1.5px solid #000; }
    .rc-avg-remark { font-style: italic; font-weight: 700; text-decoration: underline; }
    .rc-placeholder {
      text-align: center;
      padding: 10mm 0;
      font-style: italic;
      color: #666;
    }

    /* --- Qualitative block (inline rows, no table) --- */
    .rc-qual-block { margin: 3mm 0 3mm 0; font-size: 11pt; }
    .rc-qual-row {
      display: flex;
      align-items: baseline;
      margin-bottom: 1.8mm;
    }
    .rc-qual-label {
      width: 44mm;
      flex: 0 0 44mm;
      font-style: italic;
      font-weight: 700;
    }
    .rc-qual-value {
      flex: 1;
      font-style: italic;
      font-weight: 700;
      border-bottom: 1px solid #000;
      padding: 0 0 1px 3mm;
      min-height: 5mm;
    }

    /* --- Attendance (inline) --- */
    .rc-attendance {
      margin: 3mm 0 2mm 0;
      font-size: 11pt;
    }
    .rc-att-num {
      display: inline-block;
      min-width: 16mm;
      text-align: center;
      border-bottom: 1px solid #000;
      font-weight: 700;
      margin: 0 2mm;
      padding: 0 3mm 1px 3mm;
    }
    .rc-att-word { margin: 0 1mm; }

    /* --- Bottom block: dates left, signatures right --- */
    .rc-bottom {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 10mm;
      margin-top: 6mm;
      font-size: 10.5pt;
      page-break-inside: avoid;
    }
    .rc-bottom-left { flex: 1; }
    .rc-bottom-right {
      display: flex;
      gap: 14mm;
      align-items: flex-end;
    }
    .rc-date-line { margin-bottom: 3mm; }
    .rc-date-v {
      border-bottom: 1px solid #000;
      padding: 0 3mm 1px 3mm;
      margin-left: 2mm;
      display: inline-block;
      min-width: 70mm;
      font-weight: 600;
    }
    .rc-sig-block {
      text-align: center;
      min-width: 48mm;
    }
    .rc-sig-img {
      max-width: 60mm;
      object-fit: contain;
      display: block;
      margin: 0 auto;
    }
    .rc-sig-caption {
      border-top: 1px solid #000;
      padding-top: 1mm;
      margin-top: 1mm;
      font-size: 9pt;
      font-weight: 700;
      letter-spacing: 1.2px;
    }

    @media print {
      .rc-scores thead th { background: #f5f5f5 !important; -webkit-print-color-adjust: exact; }
    }
  `;
}


// === Bills ===
async function generateBillsPdf(db, userDataPath, getResourcePath, params) {
  const { billIds, colorMode = 'color' } = params;
  const header = getSchoolHeader(db, getResourcePath, colorMode);
  const pages = [];
  for (const id of billIds || []) {
    const bill = db.prepare(`
      SELECT b.*, s.index_number, s.surname, s.first_name, s.other_names,
             c.name AS class_name, t.label AS term_label, t.start_date AS term_start
      FROM student_bills b
      JOIN students s ON s.id = b.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      JOIN terms t ON t.id = b.term_id
      WHERE b.id = ?
    `).get(id);
    if (!bill) continue;
    const items = db.prepare(
      'SELECT * FROM bill_line_items WHERE student_bill_id = ? ORDER BY is_arrear, item_number'
    ).all(id);
    pages.push(billHtml(header, bill, items));
  }
  const html = `<!doctype html><html><head><style>${baseStyles()}${billStyles()}</style></head><body>${pages.join('')}</body></html>`;
  const outPath = path.join(userDataPath, 'reports', `bills_${Date.now()}.pdf`);
  if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await htmlToPdf(html, outPath);
  return { ok: true, path: outPath, count: pages.length };
}

// === Canteen bill ===
//
// The canteen is billed by the day: the daily rate times the feeding days on
// the term's calendar, less whatever has already been paid for. It prints on
// the fees bill's stationery, in the same part-sectioned layout, because to a
// parent it is the same school asking for money on the same morning.
async function generateCanteenBills(db, userDataPath, getResourcePath, params) {
  const { termId, studentIds = [], dailyRate, colorMode = 'color' } = params;
  const header = getSchoolHeader(db, getResourcePath, colorMode);

  const term = db.prepare(`
    SELECT t.*, y.label AS year_label FROM terms t
    LEFT JOIN academic_years y ON y.id = t.academic_year_id WHERE t.id = ?`).get(termId);
  if (!term) return { ok: false, error: 'Term not found' };

  const rate = Number(dailyRate) || parseFloat(getSetting(db, 'canteen_daily_rate', '0')) || 0;
  const days = db.prepare(`
    SELECT date FROM school_calendar
    WHERE term_id = ? AND day_type = 'school_day' ORDER BY date`).all(termId);
  if (days.length === 0) {
    return { ok: false, error: 'The term’s canteen calendar has not been laid out, so there is nothing to bill.' };
  }
  const first = days[0].date, last = days[days.length - 1].date;

  const pages = [];
  for (const id of studentIds) {
    const student = db.prepare(`
      SELECT s.*, c.name AS class_name FROM students s
      LEFT JOIN class_groups c ON c.id = s.current_class_id WHERE s.id = ?`).get(id);
    if (!student) continue;

    // What this pupil has already settled for the term's feeding period.
    const paid = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS t FROM canteen_payments
      WHERE student_id = ? AND payment_date BETWEEN ? AND ?`).get(id, first, last).t || 0;
    const daysPaid = db.prepare(`
      SELECT COUNT(*) AS n FROM canteen_day_status
      WHERE student_id = ? AND status = 'paid' AND date BETWEEN ? AND ?`).get(id, first, last).n || 0;

    pages.push(dayBillHtml(header, {
      title: `CANTEEN BILL — ${(term.label || '').toUpperCase()}`,
      sectionTitle: `PART A — Feeding, ${termFullLabel(term)}`,
      student,
      termLabel: termFullLabel(term),
      period: `${first} to ${last}`,
      rows: [
        ['Feeding days on the term calendar', String(days.length)],
        ['Daily rate', `GHS ${rate.toFixed(2)}`],
        ['Days already settled', String(daysPaid)],
      ],
      total: Math.round(days.length * rate * 100) / 100,
      paid: Math.round(paid * 100) / 100,
      footnote: 'The canteen is charged for the days the school actually opens. '
              + 'A day the school does not open is not billed.',
    }));
  }

  const html = `<!doctype html><html><head><style>${baseStyles()}${billStyles()}</style></head><body>${pages.join('')}</body></html>`;
  const outPath = path.join(userDataPath, 'reports', `canteen_bills_${Date.now()}.pdf`);
  if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await htmlToPdf(html, outPath);
  return { ok: true, path: outPath, count: pages.length };
}

// === Books bill ===
//
// Books are charged once for the academic year and carried into Terms 2 and 3
// as arrears, so the bill is a list of the titles issued and what is left to
// pay on them.
async function generateBooksBills(db, userDataPath, getResourcePath, params) {
  const { academicYearId, studentIds = [], colorMode = 'color' } = params;
  const header = getSchoolHeader(db, getResourcePath, colorMode);
  const yearId = academicYearId
    || (db.prepare('SELECT id FROM academic_years WHERE is_current = 1').get() || {}).id;
  const year = db.prepare('SELECT * FROM academic_years WHERE id = ?').get(yearId);
  if (!year) return { ok: false, error: 'No academic year is set.' };

  const pages = [];
  for (const id of studentIds) {
    const student = db.prepare(`
      SELECT s.*, c.name AS class_name FROM students s
      LEFT JOIN class_groups c ON c.id = s.current_class_id WHERE s.id = ?`).get(id);
    if (!student) continue;
    const record = db.prepare(
      'SELECT * FROM student_books WHERE student_id = ? AND academic_year_id = ?').get(id, yearId);
    const items = record
      ? db.prepare('SELECT * FROM student_books_items WHERE student_books_id = ? ORDER BY display_order, id').all(record.id)
      : [];

    pages.push(itemisedBillHtml(header, {
      title: `BOOKS BILL — ${year.label}`,
      sectionTitle: `PART A — Books issued, ${year.label}`,
      student,
      termLabel: year.label,
      items: items.map((it, n) => ({ item_number: n + 1, description: it.title, amount: it.amount })),
      total: Math.round((record ? record.total_amount : 0) * 100) / 100,
      paid: Math.round((record ? record.total_paid : 0) * 100) / 100,
      footnote: 'Books are charged once for the academic year. Anything unpaid is '
              + 'carried into the following terms as arrears on the school fees bill.',
    }));
  }

  const html = `<!doctype html><html><head><style>${baseStyles()}${billStyles()}</style></head><body>${pages.join('')}</body></html>`;
  const outPath = path.join(userDataPath, 'reports', `books_bills_${Date.now()}.pdf`);
  if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await htmlToPdf(html, outPath);
  return { ok: true, path: outPath, count: pages.length };
}

/** A term named with its academic year, so two "First Term"s can be told apart. */
function termFullLabel(term) {
  if (!term) return '';
  return term.year_label ? `${term.label} · ${term.year_label}` : term.label;
}

/** The identity block every bill in this system opens with. */
function billIdentityHtml(student, extra) {
  const fullName = `${student.surname || ''} ${student.first_name || ''} ${student.other_names || ''}`.trim();
  return `
    <table style="margin-bottom:2.5mm; border:0.5pt solid #bbb;">
      <tr>
        <td style="width:33%;"><b>Index No:</b> ${student.index_number || '—'}</td>
        <td style="width:33%;"><b>Class:</b> ${student.class_name || '—'}</td>
        <td><b>Issued:</b> ${new Date().toISOString().slice(0, 10)}</td>
      </tr>
      <tr><td colspan="3"><b>Student:</b> ${fullName.toUpperCase()}</td></tr>
      ${extra ? `<tr><td colspan="3">${extra}</td></tr>` : ''}
    </table>`;
}

/** The amount-due box the fees bill ends with, reused verbatim. */
function billDueHtml(header, total, paid) {
  const balance = Math.round((total - paid) * 100) / 100;
  const red = '#b91c1c';
  return `
    <div class="bill-section" style="margin-top:3.5mm;">
      <table style="border:1.2pt solid ${header.primaryColor};">
        <tr class="bill-due" style="background:${tint(header.primaryColor)}; color:${header.primaryColor}; border-bottom:0.8pt solid ${header.primaryColor};">
          <td class="bold">TOTAL AMOUNT DUE</td>
          <td class="text-right bold">GHS ${total.toFixed(2)}</td>
        </tr>
        <tr><td class="text-right">Paid to date</td><td class="text-right">${paid.toFixed(2)}</td></tr>
        <tr class="row-total" style="background:${balance > 0 ? tint(red) : tint('#15803D')}; color:${balance > 0 ? red : '#15803D'};">
          <td class="text-right">BALANCE OUTSTANDING</td>
          <td class="text-right" style="font-size:11pt;">GHS ${balance.toFixed(2)}</td>
        </tr>
      </table>
    </div>`;
}

/** A bill whose body is a handful of stated figures (the canteen's). */
function dayBillHtml(header, m) {
  return `
    <div class="page bill-page">
      ${schoolHeaderHtml(header)}
      <div class="bill-title-bar" style="background:${header.primaryColor}; color:#fff;">${m.title}</div>
      ${billIdentityHtml(m.student, m.period ? `<b>Period:</b> ${m.period}` : '')}
      <div class="bill-section">
        <div class="bill-section-title" style="--accent:${header.primaryColor}; --accent-tint:${tint(header.primaryColor)};">
          ${m.sectionTitle}
        </div>
        <table style="border:0.6pt solid #ccc;">
          <tbody>
            ${m.rows.map(([k, v]) => `<tr><td>${k}</td><td class="text-right">${v}</td></tr>`).join('')}
            <tr class="row-total" style="background:${tint(header.primaryColor)};">
              <td class="text-right">Charged for the term</td>
              <td class="text-right">${m.total.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      ${billDueHtml(header, m.total, m.paid)}
      <div style="margin-top:4mm; font-size:8.5pt; color:#444; border-top:0.5pt dashed #999; padding-top:2mm;">
        ${m.footnote} Payment may be made by Cash, Mobile Money, or Bank Transfer.
      </div>
    </div>`;
}

/** A bill whose body is a numbered list of particulars (the books bill's). */
function itemisedBillHtml(header, m) {
  return `
    <div class="page bill-page">
      ${schoolHeaderHtml(header)}
      <div class="bill-title-bar" style="background:${header.primaryColor}; color:#fff;">${m.title}</div>
      ${billIdentityHtml(m.student, '')}
      <div class="bill-section">
        <div class="bill-section-title" style="--accent:#0f766e; --accent-tint:${tint('#0f766e')};">
          ${m.sectionTitle}
        </div>
        <table style="border:0.6pt solid #bcdad7;">
          <thead>
            <tr>
              <th class="text-center" style="width:8%;">#</th>
              <th>Description</th>
              <th class="text-right" style="width:25%;">Amount (GHS)</th>
            </tr>
          </thead>
          <tbody>
            ${m.items.length === 0
              ? `<tr><td colspan="3" class="text-center" style="color:#888; padding:3mm 0;">Nothing has been issued to this pupil</td></tr>`
              : m.items.map(i => `
                  <tr>
                    <td class="text-center">${i.item_number}</td>
                    <td>${i.description}</td>
                    <td class="text-right">${(i.amount || 0).toFixed(2)}</td>
                  </tr>`).join('')}
            <tr class="row-total" style="background:${tint('#0f766e')};">
              <td colspan="2" class="text-right">Total charged</td>
              <td class="text-right">${m.total.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      ${billDueHtml(header, m.total, m.paid)}
      <div style="margin-top:4mm; font-size:8.5pt; color:#444; border-top:0.5pt dashed #999; padding-top:2mm;">
        ${m.footnote}
      </div>
    </div>`;
}

// Ink budget for the bill.
//
// The problem was never the layout — it was that a colour bill and a black-and-
// white bill of the same pupil came out looking like different documents. Every
// section header was a solid colour band with reversed-out white text, so a mono
// printer rendered them as heavy grey/black slabs while a colour printer laid
// down a wall of toner. On the school's own student-profile and terminal-report
// pages the section headers are a *light tint with a coloured left rule and
// coloured text* (e.g. "PERSONAL DETAILS"), which reads the same whether the
// colour survives or not. The bill now uses that exact treatment.
//
// Result (Chromium, like-for-like against the old solid-band layout): total ink
// coverage 16.6% → 7.0% and heavy/solid coloured pixels 166,979 → 70,257 — both
// down ~58% — and, more to the point, a grayscale render of the new bill is
// visually indistinguishable from the colour one, so a mono printout no longer
// looks like a different document. The per-part colours (navy fees / red arrears
// / teal books / violet extras) survive as the left rule, the heading text and
// the total-row tint. Only the one top title band stays solid — the same single
// strong band the student profile keeps for "STUDENT PROFILE". Body text is
// 9.5pt, headings 10pt, matching those pages.
function billStyles() {
  return `
    .bill-page td, .bill-page th { padding: 2pt 6pt; line-height: 1.3; font-size: 9.5pt; }
    .bill-page .bill-section { margin-bottom: 3mm; }
    /* Section header: light tint + coloured left rule + coloured text.
       The accent colour is passed per-part as --accent; the fill is a faint
       wash of it so it survives a mono print without a heavy slab. */
    .bill-page .bill-section-title {
      padding: 2.5pt 8pt; font-size: 10pt; font-weight: 700; line-height: 1.25;
      letter-spacing: 0.3px; color: var(--accent, #1B3A6B);
      background: var(--accent-tint, #f0f4fa);
      border-left: 3pt solid var(--accent, #1B3A6B);
    }
    /* Column headings: hairline rule + faint wash, like the report-card table */
    .bill-page thead th {
      background: #f5f5f5; border-bottom: 0.6pt solid #999;
      font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.2px; color: #333;
    }
    /* Body rows print on white; the row rule does the separating */
    .bill-page tbody tr { border-bottom: 0.3pt solid #e5e5e5; }
    /* Totals keep a faint accent tint + a top rule, no solid fill */
    .bill-page .row-total td { border-top: 0.6pt solid #999; font-weight: 700; }
    /* The one strong band, matching the profile's "STUDENT PROFILE" title */
    .bill-page .bill-title-bar {
      padding: 3pt 0; font-size: 11pt; font-weight: 700;
      letter-spacing: 0.8px; text-align: center; margin-bottom: 3mm;
    }
    .bill-page .bill-note {
      border: 0.5pt solid #bbb; padding: 1.5mm 3mm; font-size: 9pt;
    }
    /* Amount due: a bordered box in the school colour, dark text on a faint
       tint — prominent without a solid reversed-out band. */
    .bill-page .bill-due td { padding: 2.2mm 8pt; font-size: 11pt; }
  `;
}

// A faint wash of a hex colour, for section-header backgrounds that survive a
// black-and-white print. Mixes the colour with white at ~8% strength.
function tint(hex) {
  const h = String(hex || '#1B3A6B').replace('#', '');
  if (h.length !== 6) return '#f0f4fa';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const mix = (c) => Math.round(c * 0.08 + 255 * 0.92);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// Bill layout — clearly separated sections:
//   PART A: current-term fees (and discounts)
//   PART B: arrears from prior terms
//   PART C: books (academic-year-level)
//   PART D: supplementary charges raised during the term
function billHtml(header, bill, items) {
  const fullName = `${bill.surname || ''} ${bill.first_name || ''} ${bill.other_names || ''}`.trim();

  // Split bill_line_items by charge type. `charge_type` is authoritative;
  // is_arrear is still honoured for rows written before it existed.
  const typeOf = (i) => i.charge_type || (i.is_arrear ? 'arrear' : 'fees');
  const partAItems = items.filter(i => typeOf(i) === 'fees');
  const partBItems = items.filter(i => typeOf(i) === 'arrear');
  const partDItems = items.filter(i => typeOf(i) === 'extra');

  const partASubtotal = partAItems.reduce((s, i) => s + (i.amount || 0), 0);
  const partBSubtotal = partBItems.reduce((s, i) => s + (i.amount || 0), 0);
  const partDSubtotal = partDItems.reduce((s, i) => s + (i.amount || 0), 0);
  const discountAmt = bill.discount_amount || 0;
  const partANet = Math.max(0, partASubtotal - discountAmt);

  const booksTotal = bill.books_total || 0;
  const booksPaid = bill.books_paid || 0;
  const booksArrears = bill.books_arrears || 0;
  const booksBalance = Math.max(0, booksTotal - booksPaid + booksArrears);

  const totalPaid = bill.total_paid || 0;

  // The parts already add up to everything the pupil owes this term, books
  // arrears included. The footer used to print `balance + booksBalance`, where
  // `balance` was itself total_billed − paid and total_billed already carried
  // the books arrears — so any pupil with a books balance was shown, in bold,
  // an amount due that double-counted their books.
  const grandTotal = partANet + partBSubtotal + partDSubtotal + booksBalance;
  const balance = grandTotal - totalPaid;

  const accentA = header.primaryColor;
  const accentB = '#b91c1c';
  const accentC = '#0f766e';
  const accentD = '#6d28d9';

  // --- Part A: current bills (+ discount applied) ---
  const partAHtml = `
    <div class="bill-section">
      <div class="bill-section-title" style="--accent:${accentA}; --accent-tint:${tint(accentA)};">
        PART A — School Fees, ${bill.term_label || 'Current Term'}
      </div>
      <table style="border:0.6pt solid #ccc; margin-bottom:0;">
        <thead>
          <tr>
            <th class="text-center" style="width:8%;">#</th>
            <th>Description</th>
            <th class="text-right" style="width:25%;">Amount (GHS)</th>
          </tr>
        </thead>
        <tbody>
          ${partAItems.length === 0
            ? `<tr><td colspan="3" class="text-center" style="color:#888; padding:3mm 0;">No current-term fee items</td></tr>`
            : partAItems.map(i => `
                <tr>
                  <td class="text-center">${i.item_number}</td>
                  <td>${i.description}</td>
                  <td class="text-right">${(i.amount || 0).toFixed(2)}</td>
                </tr>
              `).join('')
          }
          <tr class="row-total">
            <td colspan="2" class="text-right">Subtotal Part A</td>
            <td class="text-right">${partASubtotal.toFixed(2)}</td>
          </tr>
          ${discountAmt > 0 ? `
            <tr style="color:#c2410c;">
              <td colspan="2" class="text-right">
                Less: Discount ${bill.discount_reason ? `(${bill.discount_reason})` : ''}
              </td>
              <td class="text-right">– ${discountAmt.toFixed(2)}</td>
            </tr>
            <tr class="row-total" style="background:${tint(accentA)};">
              <td colspan="2" class="text-right">Net Part A (after discount)</td>
              <td class="text-right">${partANet.toFixed(2)}</td>
            </tr>
          ` : ''}
        </tbody>
      </table>
    </div>`;

  // --- Part B: arrears ---
  const partBHtml = partBItems.length === 0 ? `
    <div class="bill-section">
      <div class="bill-section-title" style="--accent:#15803D; --accent-tint:${tint('#15803D')};">PART B — Arrears from Prior Terms</div>
      <div class="bill-note" style="text-align:center; color:#15803D; border-color:#15803D;">
        ✓ No outstanding arrears — account is current.
      </div>
    </div>` : `
    <div class="bill-section">
      <div class="bill-section-title" style="--accent:${accentB}; --accent-tint:${tint(accentB)};">PART B — Arrears from Prior Terms</div>
      <table style="border:0.6pt solid #e2b8b8;">
        <thead>
          <tr>
            <th class="text-center" style="width:8%;">#</th>
            <th>Description</th>
            <th class="text-right" style="width:25%;">Amount (GHS)</th>
          </tr>
        </thead>
        <tbody>
          ${partBItems.map(i => `
            <tr>
              <td class="text-center">${i.item_number}</td>
              <td>${i.description}</td>
              <td class="text-right">${(i.amount || 0).toFixed(2)}</td>
            </tr>
          `).join('')}
          <tr class="row-total" style="background:${tint(accentB)};">
            <td colspan="2" class="text-right">Total Arrears (Part B)</td>
            <td class="text-right">${partBSubtotal.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;

  // --- Part C: books ---
  const partCHtml = booksTotal === 0 && booksArrears === 0 ? '' : `
    <div class="bill-section">
      <div class="bill-section-title" style="--accent:${accentC}; --accent-tint:${tint(accentC)};">PART C — Books (Academic Year)</div>
      <table style="border:0.6pt solid #bcdad7;">
        <tbody>
          <tr><td>Books charged this academic year</td><td class="text-right">${booksTotal.toFixed(2)}</td></tr>
          <tr><td>Paid to date</td><td class="text-right">${booksPaid.toFixed(2)}</td></tr>
          ${booksArrears > 0 ? `<tr style="color:#b91c1c;"><td>Brought-forward books arrears</td><td class="text-right">${booksArrears.toFixed(2)}</td></tr>` : ''}
          <tr class="row-total" style="background:${tint(accentC)};">
            <td class="text-right">Books Balance (Part C)</td>
            <td class="text-right">${booksBalance.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;

  // --- Part D: supplementary charges raised during the term ---
  // Excursion, sports week, BECE registration and the like. Printed as its own
  // part so a parent can see at a glance what is termly fees and what is an
  // extra they were asked for mid-term.
  const partDHtml = partDItems.length === 0 ? '' : `
    <div class="bill-section">
      <div class="bill-section-title" style="--accent:${accentD}; --accent-tint:${tint(accentD)};">PART D — Additional Charges This Term</div>
      <table style="border:0.6pt solid #cdc0ea;">
        <thead>
          <tr>
            <th class="text-center" style="width:8%;">#</th>
            <th>Description</th>
            <th class="text-right" style="width:25%;">Amount (GHS)</th>
          </tr>
        </thead>
        <tbody>
          ${partDItems.map(i => `
            <tr>
              <td class="text-center">${i.item_number}</td>
              <td>${i.description}</td>
              <td class="text-right">${(i.amount || 0).toFixed(2)}</td>
            </tr>
          `).join('')}
          <tr class="row-total" style="background:${tint(accentD)};">
            <td colspan="2" class="text-right">Total Additional Charges (Part D)</td>
            <td class="text-right">${partDSubtotal.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;

  return `
    <div class="page bill-page">
      ${schoolHeaderHtml(header)}
      <div class="bill-title-bar" style="background:${header.primaryColor}; color:#fff;">
        SCHOOL FEES BILL — ${(bill.term_label || '').toUpperCase()}
      </div>

      <table style="margin-bottom:2.5mm; border:0.5pt solid #bbb;">
        <tr>
          <td style="width:33%;"><b>Index No:</b> ${bill.index_number || '—'}</td>
          <td style="width:33%;"><b>Class:</b> ${bill.class_name || '—'}</td>
          <td><b>Issued:</b> ${new Date().toISOString().slice(0,10)}</td>
        </tr>
        <tr><td colspan="3"><b>Student:</b> ${fullName.toUpperCase()}</td></tr>
      </table>

      ${partAHtml}
      ${partBHtml}
      ${partCHtml}
      ${partDHtml}

      <!-- Grand summary. A bordered box in the school colour with dark text on
           a faint tint — reads identically in colour and black-and-white. -->
      <div class="bill-section" style="margin-top:3.5mm;">
        <table style="border:1.2pt solid ${header.primaryColor};">
          <tr class="bill-due" style="background:${tint(header.primaryColor)}; color:${header.primaryColor}; border-bottom:0.8pt solid ${header.primaryColor};">
            <td class="bold">TOTAL AMOUNT DUE</td>
            <td class="text-right bold">GHS ${grandTotal.toFixed(2)}</td>
          </tr>
          <tr><td class="text-right">Paid to date</td><td class="text-right">${totalPaid.toFixed(2)}</td></tr>
          <tr class="row-total" style="background:${balance > 0 ? tint(accentB) : tint('#15803D')}; color:${balance > 0 ? accentB : '#15803D'};">
            <td class="text-right">BALANCE OUTSTANDING</td>
            <td class="text-right" style="font-size:11pt;">GHS ${balance.toFixed(2)}</td>
          </tr>
        </table>
      </div>

      <div style="margin-top:4mm; font-size:8.5pt; color:#444; border-top:0.5pt dashed #999; padding-top:2mm;">
        Payment may be made by Cash, Mobile Money, or Bank Transfer.
        Please present this bill at the time of payment so it can be marked accordingly.
        Refer to <b>Part A</b> for current-term fees, <b>Part B</b> for any arrears,
        <b>Part C</b> for books${partDItems.length ? ', and <b>Part D</b> for additional charges raised this term' : ''}.
      </div>
    </div>
  `;
}

// === Payslip ===
async function generatePayslip(db, userDataPath, getResourcePath, salaryId, options) {
  const colorMode = options.colorMode || 'color';
  const header = getSchoolHeader(db, getResourcePath, colorMode);
  const sal = db.prepare(`
    SELECT sal.*, s.staff_number, s.surname, s.first_name, s.role, s.bank_account, s.bank_name
    FROM staff_salaries sal JOIN staff s ON s.id = sal.staff_id WHERE sal.id = ?
  `).get(salaryId);
  if (!sal) return { ok: false, error: 'Salary record not found' };
  const html = `
    <!doctype html><html><head><style>${baseStyles()}</style></head><body>
    <div class="page">
      ${schoolHeaderHtml(header)}
      <div style="text-align:center; background:${header.primaryColor}; color:#fff; padding:4px 0; font-size:11pt; font-weight:700; letter-spacing:1px; margin-bottom:4mm;">
        PAYSLIP — ${monthName(sal.month)} ${sal.year}
      </div>
      <table style="margin-bottom:4mm;">
        <tr><td><b>Staff No:</b> ${sal.staff_number}</td><td><b>Name:</b> ${sal.surname} ${sal.first_name}</td></tr>
        <tr><td><b>Role:</b> ${sal.role}</td><td><b>Payment Date:</b> ${sal.payment_date || '—'}</td></tr>
      </table>
      <table style="border:1px solid #333;">
        <tr><td>Gross Salary</td><td class="text-right">${sal.gross_salary.toFixed(2)}</td></tr>
        <tr><td>Extra Pay ${sal.extra_pay_description ? `(${sal.extra_pay_description})` : ''}</td>
            <td class="text-right">${sal.extra_pay.toFixed(2)}</td></tr>
        <tr><td>Arrears B/F</td><td class="text-right">${sal.arrear_brought_forward.toFixed(2)}</td></tr>
        <tr style="background:#f5f5f5;"><td class="bold">Gross Total</td>
            <td class="text-right bold">${(sal.gross_salary + sal.extra_pay + sal.arrear_brought_forward).toFixed(2)}</td></tr>
        <tr><td>SSNIT Worker</td><td class="text-right">- ${sal.ssnit_worker.toFixed(2)}</td></tr>
        <tr><td>PAYE Tax</td><td class="text-right">- ${sal.paye_tax.toFixed(2)}</td></tr>
        <tr><td>Other Deductions</td><td class="text-right">- ${sal.other_deductions.toFixed(2)}</td></tr>
        <tr style="background:#f5f5f5;"><td class="bold">Net Salary</td>
            <td class="text-right bold">${sal.net_salary.toFixed(2)}</td></tr>
        <tr><td>Actual Amount Paid</td><td class="text-right bold">${sal.actual_amount_paid.toFixed(2)}</td></tr>
        <tr><td>Carry-over to Next Month</td><td class="text-right">${sal.carry_over_to_next.toFixed(2)}</td></tr>
      </table>
    </div></body></html>
  `;
  const outPath = path.join(userDataPath, 'reports', `payslip_${salaryId}_${Date.now()}.pdf`);
  if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await htmlToPdf(html, outPath);
  return { ok: true, path: outPath };
}

// === Receipt ===
async function generateReceipt(db, userDataPath, getResourcePath, paymentId, options) {
  const colorMode = options.colorMode || 'color';
  const header = getSchoolHeader(db, getResourcePath, colorMode);
  const p = db.prepare(`
    SELECT p.*, s.index_number, s.surname, s.first_name, c.name AS class_name, t.label AS term_label
    FROM payments p JOIN students s ON s.id = p.student_id
    LEFT JOIN class_groups c ON c.id = s.current_class_id
    JOIN terms t ON t.id = p.term_id
    WHERE p.id = ?
  `).get(paymentId);
  if (!p) return { ok: false, error: 'Payment not found' };

  const html = `
    <!doctype html><html><head><style>${baseStyles()}</style></head><body>
    <div class="page">
      ${schoolHeaderHtml(header)}
      <div style="text-align:center; background:${header.primaryColor}; color:#fff; padding:4px 0; font-size:12pt; font-weight:700;">
        PAYMENT RECEIPT
      </div>
      <div style="margin:6mm 0;">
        <div style="font-size:14pt; font-weight:700; color:${header.accentColor};">${p.receipt_number}</div>
        <div class="small">Date: ${p.payment_date}</div>
      </div>
      <table>
        <tr><td><b>Student:</b> ${p.surname} ${p.first_name}</td><td><b>Index No:</b> ${p.index_number}</td></tr>
        <tr><td><b>Class:</b> ${p.class_name}</td><td><b>Term:</b> ${p.term_label}</td></tr>
      </table>
      <table style="margin-top:4mm; border:1px solid #333;">
        <tr><td><b>Amount Paid</b></td><td class="text-right bold" style="font-size:14pt;">GHS ${p.amount.toFixed(2)}</td></tr>
        <tr><td>Payment Method</td><td class="text-right">${p.payment_method}</td></tr>
        <tr><td>Reference</td><td class="text-right">${p.reference || '—'}</td></tr>
        <tr><td>Received By</td><td class="text-right">${p.received_by || '—'}</td></tr>
      </table>
      <div style="margin-top:8mm; text-align:right;">_______________________<br/>Authorised Signature</div>
    </div></body></html>
  `;
  const outPath = path.join(userDataPath, 'reports', `receipt_${p.receipt_number}.pdf`);
  if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await htmlToPdf(html, outPath);
  return { ok: true, path: outPath };
}

// === Debtors list ===
async function generateDebtorsList(db, userDataPath, getResourcePath, termId, options) {
  const colorMode = options.colorMode || 'color';
  const header = getSchoolHeader(db, getResourcePath, colorMode);
  const term = db.prepare('SELECT label FROM terms WHERE id = ?').get(termId);
  const debtors = db.prepare(`
    SELECT s.index_number, s.surname, s.first_name, c.name AS class_name,
           b.total_billed AS total_amount, b.total_paid AS paid_amount, b.balance,
           b.generated_at AS generated_date
    FROM student_bills b
    JOIN students s ON s.id = b.student_id
    LEFT JOIN class_groups c ON c.id = s.current_class_id
    WHERE b.term_id = ? AND b.balance > 0 AND s.status = 'Active'
      AND COALESCE(b.status, 'active') = 'active'
    ORDER BY c.level_order, s.surname
  `).all(termId);
  const total = debtors.reduce((s, d) => s + d.balance, 0);
  const rows = debtors.map(d => `
    <tr>
      <td>${d.index_number}</td>
      <td>${d.surname} ${d.first_name}</td>
      <td>${d.class_name || ''}</td>
      <td class="text-right">${d.total_amount.toFixed(2)}</td>
      <td class="text-right">${d.paid_amount.toFixed(2)}</td>
      <td class="text-right bold">${d.balance.toFixed(2)}</td>
    </tr>
  `).join('');
  const html = `
    <!doctype html><html><head><style>${baseStyles()}</style></head><body>
    <div class="page">
      ${schoolHeaderHtml(header)}
      <div style="text-align:center; background:${header.primaryColor}; color:#fff; padding:4px 0; font-size:11pt; font-weight:700; margin-bottom:4mm;">
        DEBTORS LIST — ${term ? term.label.toUpperCase() : ''}
      </div>
      <table style="border:1px solid #333;">
        <thead><tr style="background:${header.primaryColor}; color:#fff;">
          <th>Index No</th><th>Name</th><th>Class</th>
          <th class="text-right">Total Bill</th><th class="text-right">Paid</th><th class="text-right">Balance</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="background:#f5f5f5;">
          <td colspan="5" class="text-right bold">TOTAL OUTSTANDING</td>
          <td class="text-right bold">GHS ${total.toFixed(2)}</td>
        </tr></tfoot>
      </table>
    </div></body></html>
  `;
  const outPath = path.join(userDataPath, 'reports', `debtors_${Date.now()}.pdf`);
  if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await htmlToPdf(html, outPath);
  return { ok: true, path: outPath, count: debtors.length };
}

// === Class list ===
async function generateClassList(db, userDataPath, getResourcePath, classId, options) {
  const colorMode = options.colorMode || 'color';
  const header = getSchoolHeader(db, getResourcePath, colorMode);
  const cls = db.prepare('SELECT name FROM class_groups WHERE id = ?').get(classId);
  const students = db.prepare(`
    SELECT index_number, surname, first_name, other_names, gender, date_of_birth, father_contact, mother_contact
    FROM students WHERE current_class_id = ? AND status = 'Active'
    ORDER BY surname, first_name
  `).all(classId);
  const rows = students.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${s.index_number || ''}</td>
      <td>${s.surname} ${s.first_name} ${s.other_names || ''}</td>
      <td>${s.gender}</td>
      <td>${s.date_of_birth || ''}</td>
      <td>${s.father_contact || s.mother_contact || ''}</td>
    </tr>
  `).join('');
  const html = `
    <!doctype html><html><head><style>${baseStyles()}</style></head><body>
    <div class="page">
      ${schoolHeaderHtml(header)}
      <div style="text-align:center; background:${header.primaryColor}; color:#fff; padding:4px 0; font-size:11pt; font-weight:700; margin-bottom:4mm;">
        CLASS LIST — ${cls ? cls.name.toUpperCase() : ''}
      </div>
      <table style="border:1px solid #333;">
        <thead><tr style="background:${header.primaryColor}; color:#fff;">
          <th>#</th><th>Index No</th><th>Name</th><th>Sex</th><th>DOB</th><th>Contact</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:4mm; font-size:9pt;">Total students: ${students.length}</div>
    </div></body></html>
  `;
  const outPath = path.join(userDataPath, 'reports', `class_list_${classId}_${Date.now()}.pdf`);
  if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await htmlToPdf(html, outPath);
  return { ok: true, path: outPath, count: students.length };
}

function monthName(m) {
  return ['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1] || '';
}

// === Student Profile (formal printable) ===
async function generateStudentProfile(db, userDataPath, getResourcePath, studentId, options) {
  const built = studentProfileDocument(db, getResourcePath, studentId, options || {});
  if (!built.ok) return built;
  const outPath = path.join(userDataPath, 'reports', `profile_${built.meta.slug}_${Date.now()}.pdf`);
  if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await htmlToPdf(built.document, outPath);
  return { ok: true, path: outPath };
}

// The profile sheet as a standalone page. The PDF above and the "Print
// profile" button in the teacher's and the parent's app both render THIS —
// one template, so the office and the gate hand out the same document.
function studentProfileDocument(db, getResourcePath, studentId, options = {}) {
  const colorMode = options.colorMode || 'color';
  const header = getSchoolHeader(db, getResourcePath, colorMode);
  const s = db.prepare(`
    SELECT s.*, c.name AS class_name, c.short_code AS class_code
    FROM students s
    LEFT JOIN class_groups c ON c.id = s.current_class_id
    WHERE s.id = ?
  `).get(studentId);
  if (!s) return { ok: false, error: 'Student not found' };

  // Helper to compute age from DOB
  function ageFromDob(dob) {
    if (!dob) return s.age || '—';
    const b = new Date(dob);
    const now = new Date();
    let a = now.getFullYear() - b.getFullYear();
    const m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
    return a;
  }

  // Photo (if any)
  // Inlined rather than linked. `file://` resolves on the office PC and
  // nowhere else, so a profile printed from a phone came out with a broken
  // image box where the child should be. The crest was already inlined; this
  // is the same treatment.
  let photoData = '';
  try {
    if (s.photo_path && fs.existsSync(s.photo_path)) {
      const buf = fs.readFileSync(s.photo_path);
      const ext = path.extname(s.photo_path).slice(1).toLowerCase() || 'png';
      photoData = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buf.toString('base64')}`;
    }
  } catch (_) { photoData = ''; }
  const photoBlock = photoData
    ? `<img src="${photoData}" style="width:35mm; height:42mm; object-fit:cover; border:1px solid #999;" />`
    : `<div style="width:35mm; height:42mm; border:1px dashed #999; display:flex; align-items:center; justify-content:center; color:#999; font-size:8pt;">No photo</div>`;

  const row = (label, value) => `<tr><td style="width:40%; color:#555; padding:2mm 4mm;">${label}</td><td style="padding:2mm 4mm; font-weight:600;">${value ?? '—'}</td></tr>`;

  const html = `<!doctype html><html><head><style>${baseStyles()}</style></head><body>
    <div class="page">
      ${schoolHeaderHtml(header)}
      <div style="text-align:center; background:${header.primaryColor}; color:#fff; padding:5px 0; font-size:11pt; font-weight:700; letter-spacing:1px; margin-bottom:4mm;">
        STUDENT PROFILE
      </div>

      <div style="display:flex; gap:5mm; margin-bottom:5mm;">
        <div>${photoBlock}</div>
        <div style="flex:1; border:1px solid #ddd;">
          <table>
            ${row('Index Number', s.index_number)}
            ${row('Full Name', `${s.surname || ''} ${s.first_name || ''} ${s.other_names || ''}`.trim().toUpperCase())}
            ${row('Gender', s.gender)}
            ${row('Date of Birth', s.date_of_birth)}
            ${row('Age', ageFromDob(s.date_of_birth))}
            ${row('Current Class', s.class_name)}
            ${row('Status', s.status)}
          </table>
        </div>
      </div>

      <div class="profile-section">
        <div class="profile-section-title" style="background:${header.primaryColor};">Personal Information</div>
        <table style="border:1px solid #ddd;">
          ${row('Denomination', s.denomination)}
          ${row('Place of Birth', s.place_of_birth)}
          ${row('Place of Residence', s.place_of_residence)}
          ${row('Street Address', s.street_address)}
          ${row('House Number', s.house_number)}
          ${row('Digital Address', s.digital_address)}
          ${row('NHIS Number', s.nhis_number)}
        </table>
      </div>

      <div class="profile-section">
        <div class="profile-section-title" style="background:${header.primaryColor};">Family Information</div>
        <table style="border:1px solid #ddd;">
          ${row("Father's Name", s.father_name)}
          ${row("Father's Contact", s.father_contact)}
          ${row("Mother's Name", s.mother_name)}
          ${row("Mother's Contact", s.mother_contact)}
          ${row("Guardian's Name", s.guardian_name)}
          ${row("Guardian's Contact", s.guardian_contact)}
        </table>
      </div>

      <div class="profile-section">
        <div class="profile-section-title" style="background:${header.primaryColor};">Admission</div>
        <table style="border:1px solid #ddd;">
          ${row('Admitted On', s.admission_date)}
          ${row('Admission Number', s.admission_number)}
          ${row('Previous School', s.previous_school)}
        </table>
      </div>

      <div style="margin-top:14mm; display:flex; justify-content:space-between;">
        <div style="width:45%;" class="signature-line">Headmaster's Signature & Date</div>
        <div style="width:45%;" class="signature-line">Official Stamp</div>
      </div>

      <div style="margin-top:8mm; font-size:8pt; color:#777; text-align:center;">
        Issued ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} —
        This is an official record from ${header.name}.
      </div>
    </div>
  </body></html>`;

  const safeName = `${(s.surname || 'student').replace(/[^a-z0-9]/gi, '_')}_${s.first_name || ''}`.toLowerCase();
  return {
    ok: true,
    document: html,
    meta: {
      slug: safeName,
      student_name: `${s.surname || ''} ${s.first_name || ''}`.trim(),
      index_number: s.index_number,
      class_name: s.class_name || s.class_code,
    },
  };
}

// === Attestation / Testimonial ===
// kind: 'attestation' | 'testimonial' | 'transfer'
async function generateAttestation(db, userDataPath, getResourcePath, studentId, kind, options) {
  const colorMode = options.colorMode || 'color';
  const header = getSchoolHeader(db, getResourcePath, colorMode);
  const s = db.prepare(`
    SELECT s.*, c.name AS class_name
    FROM students s LEFT JOIN class_groups c ON c.id = s.current_class_id
    WHERE s.id = ?
  `).get(studentId);
  if (!s) return { ok: false, error: 'Student not found' };

  const fullName = `${s.surname || ''} ${s.first_name || ''} ${s.other_names || ''}`.trim().toUpperCase();
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const admittedOn = s.admission_date
    ? new Date(s.admission_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '[admission date]';

  const titles = {
    attestation: 'CERTIFICATE OF ATTESTATION',
    testimonial: 'TESTIMONIAL',
    transfer:    'TRANSFER CERTIFICATE',
  };
  const title = titles[kind] || 'CERTIFICATE';

  const bodies = {
    attestation: `
      This is to attest that <b>${fullName}</b>, gender ${s.gender || '—'},
      is a bona-fide student of ${header.name}.
      ${s.class_name ? `The said student is currently in <b>${s.class_name}</b>.` : ''}
      ${admittedOn !== '[admission date]' ? `They were admitted to this institution on <b>${admittedOn}</b>.` : ''}
      This document is issued at the request of the parent / guardian for whatever purpose it may serve.
    `,
    testimonial: `
      This is to testify that <b>${fullName}</b>, born on ${s.date_of_birth || '[date of birth]'},
      was a student of ${header.name}.
      ${admittedOn !== '[admission date]' ? `They were admitted on <b>${admittedOn}</b>` : ''}
      ${s.class_name ? `and were last enrolled in <b>${s.class_name}</b>.` : '.'}
      During their stay at this institution, their conduct was found to be ${options.conduct || 'satisfactory'},
      and their academic performance was ${options.performance || 'commendable'}.
      We wish them well in their future endeavours.
    `,
    transfer: `
      This is to certify that <b>${fullName}</b>, gender ${s.gender || '—'},
      was a regular student of ${header.name}
      ${s.class_name ? `enrolled in <b>${s.class_name}</b>.` : '.'}
      They have officially been transferred from this institution.
      All school dues are reported as settled at the time of issue of this certificate.
    `,
  };
  const body = bodies[kind] || bodies.attestation;

  const html = `<!doctype html><html><head><style>${baseStyles()}
    .cert-body { font-size: 11.5pt; line-height: 1.9; margin: 6mm 6mm; text-align: justify; }
    .cert-title { text-align:center; font-size: 18pt; font-weight: 800; letter-spacing: 4px;
                  margin: 10mm 0 6mm 0; color: ${header.primaryColor}; }
    .cert-divider { width: 60mm; height: 2px; background: ${header.primaryColor}; margin: 0 auto 8mm auto; }
  </style></head><body>
    <div class="page">
      ${schoolHeaderHtml(header)}
      <div class="cert-title">${title}</div>
      <div class="cert-divider"></div>
      <div class="cert-body">${body}</div>
      <div style="margin-top:18mm; display:flex; justify-content:space-between;">
        <div style="width:45%;" class="signature-line">Headmaster's Signature</div>
        <div style="width:45%;" class="signature-line">Official Stamp & Date</div>
      </div>
      <div style="margin-top:10mm; font-size:8pt; color:#777; text-align:center;">
        Issued ${today} — ${header.name}
      </div>
    </div>
  </body></html>`;

  const safeName = `${(s.surname || 'student').replace(/[^a-z0-9]/gi, '_')}`.toLowerCase();
  const outPath = path.join(userDataPath, 'reports', `${kind}_${safeName}_${Date.now()}.pdf`);
  if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await htmlToPdf(html, outPath);
  return { ok: true, path: outPath };
}

// === Exam Paper (Ghanaian-style A4 question paper) ===
// Layout follows the conventions of Ghanaian school examination papers:
//   - School name + crest (top center)
//   - Subject, class, term, year, duration printed prominently
//   - Instructions to candidates block
//   - Sections (Section A / Section B / Section C) with section instructions
//   - Questions numbered consecutively WITHIN sections
//   - Marks shown in square brackets at end of each question (e.g. [4 marks])
//   - Multiple choice: A/B/C/D laid out cleanly with circles to shade
//   - Essays: leave numbered ruled answer space proportional to marks
async function generateExamPaper(db, userDataPath, getResourcePath, paperId, options) {
  const colorMode = options.colorMode || 'mono'; // exam papers print in mono by default
  const header = getSchoolHeader(db, getResourcePath, colorMode);

  const paper = db.prepare(`
    SELECT p.*, c.name AS class_name, s.name AS subject_name, s.code AS subject_code,
           t.label AS term_label, t.year_label
    FROM exam_papers p
    LEFT JOIN class_groups c ON c.id = p.class_group_id
    LEFT JOIN subjects s ON s.id = p.subject_id
    LEFT JOIN terms t ON t.id = p.term_id
    WHERE p.id = ?
  `).get(paperId);
  if (!paper) return { ok: false, error: 'Exam paper not found' };

  const sections = db.prepare(`
    SELECT * FROM exam_sections WHERE exam_paper_id = ? ORDER BY display_order, id
  `).all(paperId);

  const allQuestions = db.prepare(`
    SELECT * FROM exam_questions WHERE exam_paper_id = ?
    ORDER BY display_order, id
  `).all(paperId);

  // Group questions by section (or "unsectioned" group)
  const groupBySection = (sectionId) =>
    allQuestions.filter(q => (q.section_id || null) === sectionId);

  // Render one question
  function questionHtml(q, n) {
    const marksLabel = `[${q.marks} mark${q.marks === 1 ? '' : 's'}]`;
    let body = '';
    if (q.question_type === 'multiple_choice') {
      // Use A. B. C. D. format Ghanaian schools use
      const opts = [
        ['A', q.option_a], ['B', q.option_b],
        ['C', q.option_c], ['D', q.option_d],
      ].filter(([, v]) => v);
      body = `
        <div class="q-options">
          ${opts.map(([k, v]) => `
            <div class="q-option">
              <span class="q-circle">${k}</span>
              <span class="q-option-text">${escapeHtml(v)}</span>
            </div>`).join('')}
        </div>`;
    } else if (q.question_type === 'true_false') {
      body = `
        <div class="q-options">
          <div class="q-option"><span class="q-circle">A</span><span>True</span></div>
          <div class="q-option"><span class="q-circle">B</span><span>False</span></div>
        </div>`;
    } else if (q.question_type === 'fill_blank') {
      body = `<div class="q-fillblank">..........................................................................................................................</div>`;
    } else {
      // Essay / short-answer: blank ruled lines proportional to marks
      const lines = Math.max(3, Math.min(20, Math.round((q.marks || 1) * 2)));
      const blanks = '<div class="q-line"></div>'.repeat(lines);
      body = `<div class="q-essay-space">${blanks}</div>`;
    }
    const img = q.question_image_path && fs.existsSync(q.question_image_path)
      ? `<div class="q-image"><img src="file://${q.question_image_path}" /></div>`
      : '';
    return `
      <div class="q-block">
        <div class="q-head">
          <span class="q-num">${n}.</span>
          <span class="q-text">${escapeHtml(q.question_text)}</span>
          <span class="q-marks">${marksLabel}</span>
        </div>
        ${img}
        ${body}
      </div>`;
  }

  // Build sections markup
  let qCounter = 0;
  let sectionsHtml = '';

  // Unsectioned questions first (if any)
  const unsectioned = groupBySection(null);
  if (unsectioned.length > 0 && sections.length === 0) {
    sectionsHtml = unsectioned.map(q => { qCounter++; return questionHtml(q, qCounter); }).join('');
  } else {
    for (const sec of sections) {
      const qs = groupBySection(sec.id);
      const sectionMarks = qs.reduce((s, q) => s + (q.marks || 0), 0);
      sectionsHtml += `
        <div class="section-block">
          <div class="section-header">
            <span class="section-title">SECTION ${escapeHtml(sec.section_label || '')}</span>
            <span class="section-marks">[${sectionMarks} marks]</span>
          </div>
          ${sec.instructions ? `<div class="section-instructions"><em>${escapeHtml(sec.instructions)}</em></div>` : ''}
          ${qs.map(q => { qCounter++; return questionHtml(q, qCounter); }).join('')}
        </div>`;
    }
    // Append any unsectioned questions at the end
    if (unsectioned.length > 0 && sections.length > 0) {
      sectionsHtml += `<div class="section-block">
        <div class="section-header"><span class="section-title">SECTION (Other)</span></div>
        ${unsectioned.map(q => { qCounter++; return questionHtml(q, qCounter); }).join('')}
      </div>`;
    }
  }

  const totalQ = allQuestions.length;
  const totalMarks = paper.total_marks || allQuestions.reduce((s, q) => s + (q.marks || 0), 0);
  const duration = paper.duration_minutes
    ? `${Math.floor(paper.duration_minutes / 60)} hour${Math.floor(paper.duration_minutes/60) === 1 ? '' : 's'} ${paper.duration_minutes % 60 ? (paper.duration_minutes % 60) + ' minutes' : ''}`.trim()
    : 'No time limit';

  const examTypeLabel = {
    'end_of_term': 'END OF TERM EXAMINATION',
    'mid_term':    'MID-TERM EXAMINATION',
    'mock':        'MOCK EXAMINATION',
    'class_test':  'CLASS TEST',
    'quiz':        'QUIZ',
  }[paper.exam_type] || 'EXAMINATION';

  const html = `<!doctype html><html><head><style>
    ${baseStyles()}
    body { font-family: 'Times New Roman', 'Cambria', serif; font-size: 11.5pt; line-height: 1.5; }
    .gh-paper-header { text-align: center; margin-bottom: 4mm; }
    .gh-school-name {
      font-size: 14pt; font-weight: 800; letter-spacing: 2px;
      text-transform: uppercase; margin-bottom: 2mm;
    }
    .gh-school-motto { font-style: italic; font-size: 9.5pt; margin-bottom: 4mm; color: #444; }
    .gh-exam-title {
      font-size: 13pt; font-weight: 700; letter-spacing: 4px;
      text-transform: uppercase; margin: 4mm 0 2mm 0;
      padding: 3px 0; border-top: 2px solid #000; border-bottom: 2px solid #000;
    }
    .gh-meta {
      display: flex; justify-content: space-between;
      margin-bottom: 5mm; font-size: 11pt;
    }
    .gh-meta-block { line-height: 1.7; }
    .gh-meta-block b { display: inline-block; min-width: 70px; }
    .gh-paper-title {
      text-align: center; font-size: 13pt; font-weight: 700;
      margin: 4mm 0 6mm 0; text-transform: uppercase;
    }
    .gh-name-block {
      border: 1.5px solid #000; padding: 4mm 5mm; margin-bottom: 6mm;
      font-size: 10.5pt;
    }
    .gh-name-row { margin-bottom: 4mm; }
    .gh-name-row:last-child { margin-bottom: 0; }
    .gh-blank-line { display: inline-block; border-bottom: 1px solid #000;
                     min-width: 80mm; margin-left: 4mm; height: 5mm; vertical-align: bottom; }
    .gh-instructions {
      border: 1.5px solid #000; padding: 4mm 5mm; margin-bottom: 6mm;
      font-size: 10.5pt; background: #fafafa;
    }
    .gh-instructions-title { font-weight: 700; margin-bottom: 2mm; letter-spacing: 1px; }
    .gh-instructions ol { margin: 0; padding-left: 5mm; }
    .gh-instructions li { margin-bottom: 1.5mm; }
    .section-block { margin-top: 6mm; page-break-inside: avoid; }
    .section-header {
      background: #000; color: #fff; padding: 3px 6mm;
      font-weight: 700; letter-spacing: 1.5px; font-size: 11pt;
      display: flex; justify-content: space-between;
    }
    .section-instructions { font-style: italic; padding: 2mm 6mm; margin-bottom: 3mm; font-size: 10.5pt; }
    .q-block { margin-bottom: 5mm; page-break-inside: avoid; padding: 0 2mm; }
    .q-head { display: flex; align-items: baseline; gap: 3mm; }
    .q-num { font-weight: 700; min-width: 8mm; }
    .q-text { flex: 1; text-align: justify; }
    .q-marks { font-style: italic; color: #555; white-space: nowrap; margin-left: 3mm; }
    .q-image { margin: 2mm 0 2mm 11mm; }
    .q-image img { max-width: 70%; max-height: 70mm; }
    .q-options { margin: 2mm 0 2mm 11mm; }
    .q-option { display: flex; align-items: center; gap: 3mm; margin-bottom: 1.5mm; }
    .q-circle {
      display: inline-flex; align-items: center; justify-content: center;
      width: 6mm; height: 6mm; border: 1.5px solid #000; border-radius: 50%;
      font-weight: 700; font-size: 10pt;
    }
    .q-fillblank { margin: 2mm 0 2mm 11mm; font-family: monospace; letter-spacing: 1px; }
    .q-essay-space { margin: 2mm 0 4mm 11mm; }
    .q-line { border-bottom: 1px solid #444; height: 7mm; }
    .end-marker {
      text-align: center; margin-top: 10mm; padding: 3mm 0;
      border-top: 2px solid #000; border-bottom: 2px solid #000;
      font-weight: 700; letter-spacing: 3px;
    }
  </style></head><body>
    <div class="gh-paper-header">
      ${header.logoData ? `<img src="${header.logoData}" style="height:18mm; margin-bottom:2mm;" />` : ''}
      <div class="gh-school-name">${escapeHtml(header.name)}</div>
      ${header.motto ? `<div class="gh-school-motto">"${escapeHtml(header.motto)}"</div>` : ''}
      <div class="gh-exam-title">${examTypeLabel}</div>
    </div>

    <div class="gh-meta">
      <div class="gh-meta-block">
        <div><b>Subject:</b> ${escapeHtml(paper.subject_name || '—')}</div>
        <div><b>Class:</b> ${escapeHtml(paper.class_name || '—')}</div>
        <div><b>Term:</b> ${escapeHtml(paper.term_label || '—')}</div>
      </div>
      <div class="gh-meta-block">
        <div><b>Year:</b> ${escapeHtml(paper.year_label || new Date().getFullYear().toString())}</div>
        <div><b>Duration:</b> ${duration}</div>
        <div><b>Total marks:</b> ${totalMarks}</div>
      </div>
    </div>

    <div class="gh-paper-title">${escapeHtml(paper.title || 'Examination')}</div>

    <div class="gh-name-block">
      <div class="gh-name-row"><b>NAME:</b><span class="gh-blank-line"></span></div>
      <div class="gh-name-row"><b>INDEX No.:</b><span class="gh-blank-line"></span></div>
      <div class="gh-name-row"><b>CLASS:</b><span class="gh-blank-line"></span> <b style="margin-left:8mm;">DATE:</b><span class="gh-blank-line" style="min-width:30mm;"></span></div>
    </div>

    ${paper.instructions ? `
      <div class="gh-instructions">
        <div class="gh-instructions-title">INSTRUCTIONS TO CANDIDATES</div>
        <div>${formatInstructions(paper.instructions)}</div>
      </div>
    ` : `
      <div class="gh-instructions">
        <div class="gh-instructions-title">INSTRUCTIONS TO CANDIDATES</div>
        <ol>
          <li>Answer ALL questions unless otherwise stated.</li>
          <li>Write your answers in the spaces provided.</li>
          <li>Marks awarded for each question are shown in brackets.</li>
          <li>Write neatly and legibly. Show all working where applicable.</li>
        </ol>
      </div>
    `}

    ${sectionsHtml}

    <div class="end-marker">— END OF PAPER —</div>
  </body></html>`;

  const safeName = `${paper.subject_code || paper.subject_name || 'paper'}_${(paper.class_name || '').replace(/\s+/g, '')}_${Date.now()}`.replace(/[^a-z0-9_]/gi, '');
  const outPath = path.join(userDataPath, 'reports', `exam_${safeName}.pdf`);
  if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await htmlToPdf(html, outPath);
  return { ok: true, path: outPath, total_questions: totalQ, total_marks: totalMarks };
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatInstructions(text) {
  // If the instructions already start with "1." or "1)" treat as a list,
  // otherwise just paragraph it.
  if (/^\s*\d+[\.)]/.test(text)) {
    const items = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
    return '<ol>' + items.map(l => `<li>${escapeHtml(l.replace(/^\d+[\.)]\s*/, ''))}</li>`).join('') + '</ol>';
  }
  return '<div>' + escapeHtml(text).replace(/\n/g, '<br/>') + '</div>';
}

// HTML → PDF using Electron's BrowserWindow (no Puppeteer needed — uses bundled Chromium)
async function htmlToPdf(html, outPath) {
  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  // Load via a temp file rather than a data: URL — large batches (whole class
  // / multiple students) exceed Chromium's data-URL length limit and fail with
  // ERR_INVALID_URL (-300).
  const tmpPath = outPath + '.tmp.html';
  try {
    fs.writeFileSync(tmpPath, html, 'utf8');
    await win.loadFile(tmpPath);
    const data = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    fs.writeFileSync(outPath, data);
  } finally {
    win.close();
    try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }
  }
  return outPath;
}

module.exports = registerReportsHandlers;
// The documents the phone and the browser print. They hold no templates of
// their own: `electron/server/api.js` serves these strings and the app prints
// exactly what comes back, so a report card from the gate is the report card
// from the office.
module.exports.reportCardDocument = reportCardDocument;
module.exports.renderCardHtml = renderCardHtml;
module.exports.studentProfileDocument = studentProfileDocument;
// Exposed so the bill layout can be regression-tested without an Electron
// runtime (the PDF step needs a BrowserWindow; the HTML does not).

// ── The bills the browser prints ────────────────────────────────────────────
//
// The same builders the PDF path uses, stopping at the HTML. A bill printed
// from a browser is the bill the office prints — not similar, the same — so
// the browser holds no bill layout of its own.
module.exports.billsDocument = function billsDocument(db, getResourcePath, { billIds = [], colorMode = 'color' } = {}) {
  const header = getSchoolHeader(db, getResourcePath, colorMode);
  const pages = [];
  for (const id of billIds) {
    const bill = db.prepare(`
      SELECT b.*, s.index_number, s.surname, s.first_name, s.other_names,
             c.name AS class_name, t.label AS term_label, t.start_date AS term_start
      FROM student_bills b
      JOIN students s ON s.id = b.student_id
      LEFT JOIN class_groups c ON c.id = s.current_class_id
      JOIN terms t ON t.id = b.term_id
      WHERE b.id = ?
    `).get(id);
    if (!bill) continue;
    const items = db.prepare(
      'SELECT * FROM bill_line_items WHERE student_bill_id = ? ORDER BY is_arrear, item_number'
    ).all(id);
    pages.push(billHtml(header, bill, items));
  }
  if (!pages.length) return { ok: false, error: 'None of those bills exist.' };
  return {
    ok: true, count: pages.length,
    document: `<!doctype html><html><head><meta charset="utf-8"><style>${baseStyles()}${billStyles()}</style></head><body>${pages.join('')}</body></html>`,
  };
};

/** The bill ids for a set of pupils in a term — what the browser asks by. */
module.exports.billIdsFor = function billIdsFor(db, { studentIds = [], classId, termId }) {
  if (!termId) return [];
  if (studentIds.length) {
    const marks = studentIds.map(() => '?').join(',');
    return db.prepare(`
      SELECT id FROM student_bills
      WHERE term_id = ? AND student_id IN (${marks})
        AND COALESCE(status, 'active') = 'active'`).all(termId, ...studentIds).map(r => r.id);
  }
  if (classId) {
    return db.prepare(`
      SELECT b.id FROM student_bills b JOIN students s ON s.id = b.student_id
      WHERE b.term_id = ? AND s.current_class_id = ?
        AND COALESCE(b.status, 'active') = 'active'
      ORDER BY s.surname, s.first_name`).all(termId, classId).map(r => r.id);
  }
  return db.prepare(`
    SELECT b.id FROM student_bills b JOIN students s ON s.id = b.student_id
    WHERE b.term_id = ? AND COALESCE(b.status, 'active') = 'active'
    ORDER BY s.surname, s.first_name`).all(termId).map(r => r.id);
};

/** The canteen bill, as HTML. Same stationery as the fees bill. */
module.exports.canteenBillsDocument = function canteenBillsDocument(db, getResourcePath, params) {
  const { termId, studentIds = [], dailyRate, colorMode = 'color' } = params || {};
  const header = getSchoolHeader(db, getResourcePath, colorMode);
  const term = db.prepare(`
    SELECT t.*, y.label AS year_label FROM terms t
    LEFT JOIN academic_years y ON y.id = t.academic_year_id WHERE t.id = ?`).get(termId);
  if (!term) return { ok: false, error: 'Term not found' };
  const rate = Number(dailyRate) || parseFloat(getSetting(db, 'canteen_daily_rate', '0')) || 0;
  const days = db.prepare(`
    SELECT date FROM school_calendar
    WHERE term_id = ? AND day_type = 'school_day' ORDER BY date`).all(termId);
  if (!days.length) {
    return { ok: false, error: 'The term’s canteen calendar has not been laid out, so there is nothing to bill.' };
  }
  const first = days[0].date, last = days[days.length - 1].date;
  const pages = [];
  for (const id of studentIds) {
    const student = db.prepare(`
      SELECT s.*, c.name AS class_name FROM students s
      LEFT JOIN class_groups c ON c.id = s.current_class_id WHERE s.id = ?`).get(id);
    if (!student) continue;
    const paid = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS t FROM canteen_payments
      WHERE student_id = ? AND payment_date BETWEEN ? AND ?`).get(id, first, last).t || 0;
    const daysPaid = db.prepare(`
      SELECT COUNT(*) AS n FROM canteen_day_status
      WHERE student_id = ? AND status = 'paid' AND date BETWEEN ? AND ?`).get(id, first, last).n || 0;
    pages.push(dayBillHtml(header, {
      title: `CANTEEN BILL — ${(term.label || '').toUpperCase()}`,
      sectionTitle: `PART A — Feeding, ${termFullLabel(term)}`,
      student, termLabel: termFullLabel(term),
      period: `${first} to ${last}`,
      rows: [
        ['Feeding days on the term calendar', String(days.length)],
        ['Daily rate', `GHS ${rate.toFixed(2)}`],
        ['Days already settled', String(daysPaid)],
      ],
      total: Math.round(days.length * rate * 100) / 100,
      paid: Math.round(paid * 100) / 100,
      footnote: 'The canteen is charged for the days the school actually opens. '
              + 'A day the school does not open is not billed.',
    }));
  }
  if (!pages.length) return { ok: false, error: 'Nobody to bill.' };
  return {
    ok: true, count: pages.length,
    document: `<!doctype html><html><head><meta charset="utf-8"><style>${baseStyles()}${billStyles()}</style></head><body>${pages.join('')}</body></html>`,
  };
};

/** The books bill, as HTML. */
module.exports.booksBillsDocument = function booksBillsDocument(db, getResourcePath, params) {
  const { academicYearId, studentIds = [], colorMode = 'color' } = params || {};
  const header = getSchoolHeader(db, getResourcePath, colorMode);
  const yearId = academicYearId
    || (db.prepare('SELECT id FROM academic_years WHERE is_current = 1').get() || {}).id;
  const year = db.prepare('SELECT * FROM academic_years WHERE id = ?').get(yearId);
  if (!year) return { ok: false, error: 'No academic year is set.' };
  const pages = [];
  for (const id of studentIds) {
    const student = db.prepare(`
      SELECT s.*, c.name AS class_name FROM students s
      LEFT JOIN class_groups c ON c.id = s.current_class_id WHERE s.id = ?`).get(id);
    if (!student) continue;
    const record = db.prepare(
      'SELECT * FROM student_books WHERE student_id = ? AND academic_year_id = ?').get(id, yearId);
    const items = record
      ? db.prepare('SELECT * FROM student_books_items WHERE student_books_id = ? ORDER BY display_order, id').all(record.id)
      : [];
    pages.push(itemisedBillHtml(header, {
      title: `BOOKS BILL — ${year.label}`,
      sectionTitle: `PART A — Books issued, ${year.label}`,
      student, termLabel: year.label,
      items: items.map((it, n) => ({ item_number: n + 1, description: it.title, amount: it.amount })),
      total: Math.round((record ? record.total_amount : 0) * 100) / 100,
      paid: Math.round((record ? record.total_paid : 0) * 100) / 100,
      footnote: 'Books are charged once for the academic year. Anything unpaid is '
              + 'carried into the following terms as arrears on the school fees bill.',
    }));
  }
  if (!pages.length) return { ok: false, error: 'Nobody to bill.' };
  return {
    ok: true, count: pages.length,
    document: `<!doctype html><html><head><meta charset="utf-8"><style>${baseStyles()}${billStyles()}</style></head><body>${pages.join('')}</body></html>`,
  };
};

module.exports.__billHtmlForTest = billHtml;
module.exports.__billStylesForTest = billStyles;
