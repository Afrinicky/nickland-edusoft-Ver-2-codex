// Messaging IPC — two-way parent ↔ school threads.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The desktop SQLite is the source of truth. Staff reply on the desktop; their
// message is mirrored out to the parent's SMS/email so parents who aren't in
// the app still get it. Parents write from the mobile app (LAN/host) or reply
// by phone. Each thread is projected to the portal as a read snapshot so
// parents over the internet can read school messages too.
//
// The core functions are exported so the mobile API (electron/server/api.js)
// and the desktop IPC share one implementation.

const crypto = require('crypto');
const transport = require('./_transport');

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

// Project a thread (with its messages) to the cloud read model. No-op when
// cloud sync is off (enqueue guards that). Best-effort — never throws.
function enqueueThreadSnapshot(db, threadId) {
  try {
    const { postToOutbox } = require('../server/sync/outbox');
    const t = db.prepare('SELECT * FROM message_threads WHERE id = ?').get(threadId);
    if (!t) return;
    const student = t.student_id ? db.prepare('SELECT surname, first_name FROM students WHERE id = ?').get(t.student_id) : null;
    const messages = db.prepare('SELECT sender_type, sender_name, body, created_at FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT 50').all(threadId).reverse();
    postToOutbox(db, {
      entity_type: 'message_thread',
      entity_key: `thread:${t.uuid}`,
      payload: {
        uuid: t.uuid, parent_id: t.parent_id, student_id: t.student_id,
        student_name: student ? `${student.surname} ${student.first_name}`.trim() : null,
        subject: t.subject, last_message_at: t.last_message_at, last_sender: t.last_sender,
        parent_unread: t.parent_unread, messages,
      },
    });
  } catch (_) { /* projection is best-effort */ }
}

// Send the school's reply out to the parent's contact so they're notified even
// if they never open the app. SMS first (phones are universal here), else email.
function mirrorToParent(db, parentId, subject, body) {
  try {
    const p = db.prepare('SELECT full_name, phone, email FROM parents WHERE id = ?').get(parentId);
    if (!p) return;
    const text = `${subject ? subject + ': ' : ''}${body}`;
    if (p.phone) transport.sendSms(db, p.phone, text).catch(() => {});
    else if (p.email) transport.sendEmail(db, { to: p.email, subject: subject || 'Message from school', text }).catch(() => {});
  } catch (_) { /* mirror is best-effort */ }
}

// Create-or-append a message. Returns { ok, thread_id, message_id }.
// senderType: 'parent' | 'staff'. On a staff message, `mirror` (default true)
// pushes an SMS/email to the parent.
function postMessage(db, opts) {
  const { threadId, parentId, studentId, subject, senderType, senderId, senderName, body } = opts;
  if (!body || !String(body).trim()) return { ok: false, error: 'Message body is required.' };
  if (senderType !== 'parent' && senderType !== 'staff') return { ok: false, error: 'Invalid sender.' };

  let tid = threadId;
  const result = db.transaction(() => {
    let thread = tid ? db.prepare('SELECT * FROM message_threads WHERE id = ?').get(tid) : null;
    if (!thread) {
      if (!parentId) throw new Error('A parent is required to start a thread.');
      const r = db.prepare(`
        INSERT INTO message_threads (uuid, parent_id, student_id, subject, last_message_at, last_sender)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      `).run(uuid(), parentId, studentId || null, subject || null, senderType);
      tid = r.lastInsertRowid;
      thread = db.prepare('SELECT * FROM message_threads WHERE id = ?').get(tid);
    }
    const mr = db.prepare(`
      INSERT INTO messages (uuid, thread_id, sender_type, sender_id, sender_name, body)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuid(), tid, senderType, senderId || null, senderName || null, String(body).trim());
    // Bump the thread and increment the *other* side's unread count.
    db.prepare(`
      UPDATE message_threads
         SET last_message_at = CURRENT_TIMESTAMP, last_sender = ?,
             parent_unread = parent_unread + ?, staff_unread = staff_unread + ?
       WHERE id = ?
    `).run(senderType, senderType === 'staff' ? 1 : 0, senderType === 'parent' ? 1 : 0, tid);
    return { thread_id: tid, message_id: mr.lastInsertRowid, parent_id: thread.parent_id, subject: thread.subject };
  })();

  if (senderType === 'staff' && opts.mirror !== false) mirrorToParent(db, result.parent_id, result.subject, body);
  enqueueThreadSnapshot(db, result.thread_id);
  return { ok: true, thread_id: result.thread_id, message_id: result.message_id };
}

function threadRow(db, t) {
  const student = t.student_id ? db.prepare('SELECT surname, first_name FROM students WHERE id = ?').get(t.student_id) : null;
  const parent = db.prepare('SELECT full_name FROM parents WHERE id = ?').get(t.parent_id);
  const last = db.prepare('SELECT body, sender_type FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1').get(t.id);
  return {
    id: t.id, uuid: t.uuid, parent_id: t.parent_id, parent_name: parent?.full_name || 'Parent',
    student_id: t.student_id, student_name: student ? `${student.surname} ${student.first_name}`.trim() : null,
    subject: t.subject, last_message_at: t.last_message_at, last_sender: t.last_sender,
    parent_unread: t.parent_unread, staff_unread: t.staff_unread,
    preview: last ? last.body.slice(0, 120) : '',
  };
}

function listThreadsForStaff(db) {
  return db.prepare('SELECT * FROM message_threads ORDER BY last_message_at DESC, id DESC').all().map(t => threadRow(db, t));
}
function listThreadsForParent(db, parentId) {
  return db.prepare('SELECT * FROM message_threads WHERE parent_id = ? ORDER BY last_message_at DESC, id DESC').all(parentId).map(t => threadRow(db, t));
}
function getThread(db, threadId) {
  const t = db.prepare('SELECT * FROM message_threads WHERE id = ?').get(threadId);
  if (!t) return null;
  const messages = db.prepare('SELECT id, sender_type, sender_name, body, created_at FROM messages WHERE thread_id = ? ORDER BY id').all(threadId);
  return { thread: threadRow(db, t), messages };
}
// side: 'staff' | 'parent' — clear that side's unread badge.
function markThreadRead(db, threadId, side) {
  const col = side === 'parent' ? 'parent_unread' : 'staff_unread';
  db.prepare(`UPDATE message_threads SET ${col} = 0 WHERE id = ?`).run(threadId);
  return { ok: true };
}
function staffUnreadTotal(db) {
  try { return db.prepare('SELECT COALESCE(SUM(staff_unread),0) c FROM message_threads').get().c; }
  catch (_) { return 0; }
}

function registerMessagingHandlers(ipcMain, db) {
  ipcMain.handle('messages:list-threads', () => listThreadsForStaff(db));
  ipcMain.handle('messages:get-thread', (_e, threadId) => getThread(db, threadId));
  ipcMain.handle('messages:reply', (_e, { threadId, body, senderId, senderName }) =>
    postMessage(db, { threadId, senderType: 'staff', senderId, senderName, body }));
  ipcMain.handle('messages:start', (_e, { parentId, studentId, subject, body, senderId, senderName }) =>
    postMessage(db, { parentId, studentId, subject, senderType: 'staff', senderId, senderName, body }));
  ipcMain.handle('messages:mark-read', (_e, { threadId, side }) => markThreadRead(db, threadId, side || 'staff'));
  ipcMain.handle('messages:staff-unread', () => ({ ok: true, count: staffUnreadTotal(db) }));
}

module.exports = registerMessagingHandlers;
module.exports.postMessage = postMessage;
module.exports.listThreadsForStaff = listThreadsForStaff;
module.exports.listThreadsForParent = listThreadsForParent;
module.exports.getThread = getThread;
module.exports.markThreadRead = markThreadRead;
module.exports.staffUnreadTotal = staffUnreadTotal;
