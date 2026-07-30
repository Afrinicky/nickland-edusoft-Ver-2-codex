// Notifications IPC handlers — SMS, email, WhatsApp, templates, and history.
const { getSetting } = require('../utils/idgen');
const transport = require('./_transport');

function registerNotificationsHandlers(ipcMain, db) {
  ipcMain.handle('notifications:get-templates', () => {
    return db.prepare('SELECT * FROM notification_templates ORDER BY category, name').all();
  });

  ipcMain.handle('notifications:save-template', (_e, data) => {
    if (data.id) {
      db.prepare(`
        UPDATE notification_templates SET name = ?, channel = ?, body = ?, category = ?, is_active = ?
        WHERE id = ?
      `).run(data.name, data.channel, data.body, data.category || 'general',
        data.is_active ?? 1, data.id);
      return { ok: true, id: data.id };
    } else {
      const r = db.prepare(`
        INSERT INTO notification_templates (name, channel, body, category) VALUES (?, ?, ?, ?)
      `).run(data.name, data.channel, data.body, data.category || 'general');
      return { ok: true, id: r.lastInsertRowid };
    }
  });

  ipcMain.handle('notifications:list-log', (_e, filters = {}) => {
    let sql = 'SELECT * FROM notification_log WHERE 1=1';
    const params = [];
    if (filters.channel) { sql += ' AND channel = ?'; params.push(filters.channel); }
    if (filters.from) { sql += ' AND sent_at >= ?'; params.push(filters.from); }
    if (filters.to) { sql += ' AND sent_at <= ?'; params.push(filters.to); }
    sql += ' ORDER BY sent_at DESC LIMIT 200';
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('notifications:send-sms', async (_e, data) => {
    return await sendSmsInternal(db, data);
  });

  // Generic single send routed by channel (matches preload notifications.send).
  ipcMain.handle('notifications:send', async (_e, data) => {
    if ((data.channel || 'sms') === 'email') return await sendEmailInternal(db, data);
    return await sendSmsInternal(db, data);
  });

  // Send an email directly.
  ipcMain.handle('notifications:send-email', async (_e, data) => {
    return await sendEmailInternal(db, data);
  });

  // Generic bulk send routed by channel (matches preload notifications.sendBulk).
  ipcMain.handle('notifications:send-bulk', async (_e, data) => {
    const results = [];
    for (const r of data.recipients || []) {
      let body = data.message;
      if (r.params) {
        for (const [k, v] of Object.entries(r.params)) {
          body = body.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? ''));
        }
      }
      const payload = { recipient_name: r.name, recipient_contact: r.contact, message: body, subject: data.subject, html: r.html, template_used: data.templateName || null };
      const res = (data.channel || 'sms') === 'email'
        ? await sendEmailInternal(db, payload)
        : await sendSmsInternal(db, payload);
      results.push({ contact: r.contact, ...res });
    }
    return { ok: true, results };
  });

  ipcMain.handle('notifications:send-bulk-sms', async (_e, data) => {
    // data: { recipients: [{ name, contact, params? }], message, templateName? }
    const results = [];
    for (const r of data.recipients || []) {
      let body = data.message;
      // Replace placeholders if params provided
      if (r.params) {
        for (const [k, v] of Object.entries(r.params)) {
          body = body.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? ''));
        }
      }
      const res = await sendSmsInternal(db, {
        recipient_name: r.name,
        recipient_contact: r.contact,
        message: body,
        template_used: data.templateName || null,
      });
      results.push({ contact: r.contact, ...res });
    }
    return { ok: true, results };
  });
}

async function sendSmsInternal(db, data) {
  const to = data.recipient_contact || '';
  const logResult = db.prepare(`
    INSERT INTO notification_log (channel, recipient_type, recipient_name, recipient_contact,
      message_body, template_used, delivery_status)
    VALUES ('sms', ?, ?, ?, ?, ?, 'pending')
  `).run(
    data.recipient_type || 'parent',
    data.recipient_name || '',
    to,
    data.message || '',
    data.template_used || null
  );
  const logId = logResult.lastInsertRowid;
  if (!to) {
    db.prepare("UPDATE notification_log SET delivery_status = 'no_contact' WHERE id = ?").run(logId);
    return { ok: false, id: logId, error: 'no_contact' };
  }
  // Real send (Arkesel). Falls back to a logged "simulated" state with no API key.
  const res = await transport.dispatch(db, logId, 'sms', to, data.message || '', {});
  return { ok: res.ok, id: logId, simulated: !!res.simulated, error: res.ok ? undefined : (res.error || 'send_failed') };
}

async function sendEmailInternal(db, data) {
  const to = data.recipient_contact || data.to || '';
  const logResult = db.prepare(`
    INSERT INTO notification_log (channel, recipient_type, recipient_name, recipient_contact,
      message_body, attachment_paths, template_used, delivery_status)
    VALUES ('email', ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    data.recipient_type || 'parent',
    data.recipient_name || '',
    to,
    data.message || '',
    data.attachment_paths || null,
    data.template_used || null
  );
  const logId = logResult.lastInsertRowid;
  if (!to) {
    db.prepare("UPDATE notification_log SET delivery_status = 'no_contact' WHERE id = ?").run(logId);
    return { ok: false, id: logId, error: 'no_contact' };
  }
  const res = await transport.dispatch(db, logId, 'email', to, data.message || '', { subject: data.subject, html: data.html });
  return { ok: res.ok, id: logId, simulated: !!res.simulated, error: res.ok ? undefined : (res.error || 'send_failed') };
}

module.exports = registerNotificationsHandlers;
