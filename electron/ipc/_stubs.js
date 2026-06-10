// Nickland Edusoft — Stub IPC Handlers
// Safe no-op responses for endpoints declared in preload.js but not yet implemented.
// Phase D1+D2 has fully implemented: attendance, events, cumulative profile,
// term summary, components, exam papers/sections/questions, academics dashboard.

module.exports = function registerStubHandlers(ipcMain, db) {
  const stubs = [
    // exams:export-paper is now bypassed in preload — points directly at reports:generate-exam-paper
    ['exams:import-template', () => ({ ok: false, error: 'Import template feature not yet implemented' })],

    // Notifications (Phase D8 — multi-channel)
    ['notifications:send', () => ({ ok: true })],
    ['notifications:send-bulk', () => ({ ok: true })],

    // Reports
    ['reports:print-to-pdf', async () => ({ ok: true, path: '' })],
  ];

  for (const [channel, handler] of stubs) {
    try {
      ipcMain.handle(channel, handler);
    } catch (e) {
      // already registered — skip
    }
  }
};
