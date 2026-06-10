// Nickland Edusoft — Print helpers
// Wraps PDF generation + opening the PDF in a Chromium preview window.
// Replaces window.print() (which only prints the live screen) for
// documents that should be formal printables.

// Generic: generate any PDF via a backend reports:* handler, then open it.
export async function generateAndPreview(generator, ...args) {
  const res = await generator(...args);
  if (!res.ok) {
    return { ok: false, error: res.error || 'Could not generate document' };
  }
  await window.api.app.openPdfPreview(res.path);
  return { ok: true, path: res.path };
}

// Convenience wrappers
export async function previewStudentProfile(studentId, options = {}) {
  return generateAndPreview(window.api.reports.generateStudentProfile, studentId, options);
}

export async function previewAttestation(studentId, kind, options = {}) {
  return generateAndPreview(window.api.reports.generateAttestation, studentId, kind, options);
}

export async function previewBills(billIds, options = {}) {
  return generateAndPreview(window.api.reports.generateBillsPdf, { billIds, ...options });
}

export async function previewReportCards(params) {
  return generateAndPreview(window.api.reports.generateReportCards, params);
}

export async function previewReceipt(paymentId, options = {}) {
  return generateAndPreview(window.api.reports.generateReceipt, paymentId, options);
}

export async function previewPayslip(salaryId, options = {}) {
  return generateAndPreview(window.api.reports.generatePayslip, salaryId, options);
}
