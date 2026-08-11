import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';
import { fmtDate } from '../../lib/format.js';
import Modal from '../../components/Modal.jsx';

export default function NotificationsIndex() {
  const [tab, setTab] = useState('send');
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Notifications</h1>
          <div className="page-subtitle">SMS, email, WhatsApp to parents and staff</div>
        </div>
      </div>
      <div className="tabs">
        <button className={'tab' + (tab === 'send' ? ' active' : '')} onClick={() => setTab('send')}>Send</button>
        <button className={'tab' + (tab === 'announce' ? ' active' : '')} onClick={() => setTab('announce')}>Announcements</button>
        <button className={'tab' + (tab === 'templates' ? ' active' : '')} onClick={() => setTab('templates')}>Templates</button>
        <button className={'tab' + (tab === 'history' ? ' active' : '')} onClick={() => setTab('history')}>History</button>
      </div>
      {tab === 'send' && <SendTab />}
      {tab === 'announce' && <AnnouncementsTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  );
}

function AnnouncementsTab() {
  const showToast = useStore(s => s.showToast);
  const classes = useStore(s => s.classes);
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [students, setStudents] = useState([]);

  async function refresh() { setItems(await window.api.announcements.list()); }
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (editing?.audience === 'student') window.api.students.list({}).then(setStudents);
  }, [editing?.audience]);

  async function save() {
    const res = await window.api.announcements.save(editing);
    if (!res.ok) return showToast(res.error || 'Failed', 'error');
    showToast('Announcement posted — visible on the student portal', 'success');
    setEditing(null); refresh();
  }
  async function remove(id) {
    if (!confirm('Delete this announcement?')) return;
    await window.api.announcements.delete(id); refresh();
  }

  return (
    <div>
      <div className="card">
        <div className="section-header">
          <div>
            <div className="section-title">Announcements &amp; notices</div>
            <div className="text-sm text-muted">Posted to the student web portal. School-wide or targeted to one student.</div>
          </div>
          <button className="btn btn-primary" onClick={() => setEditing({ title: '', body: '', audience: 'all', is_active: 1 })}>+ New notice</button>
        </div>
      </div>
      <div className="card" style={{ marginTop: 12, padding: 0 }}>
        {items.length === 0
          ? <div className="empty-state" style={{ padding: 24 }}>No announcements yet.</div>
          : <table className="reports-table" style={{ width: '100%' }}>
              <thead><tr><th>Title</th><th>Audience</th><th>Posted</th><th></th></tr></thead>
              <tbody>
                {items.map(a => (
                  <tr key={a.id}>
                    <td><strong>{a.title}</strong><div className="text-xs text-muted">{a.body}</div></td>
                    <td>{a.audience === 'student' ? `${a.surname || ''} ${a.first_name || ''}`.trim() || 'Student' : 'All parents'}</td>
                    <td className="text-sm">{fmtDate(a.created_at)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(a)}>Edit</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => remove(a.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>}
      </div>
      {editing && (
        <Modal title={editing.id ? 'Edit announcement' : 'New announcement'} onClose={() => setEditing(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Post</button>
          </>}>
          <div className="form-group"><label className="label">Title</label>
            <input className="input" value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} /></div>
          <div className="form-group"><label className="label">Message</label>
            <textarea className="input" rows={4} value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })} /></div>
          <div className="form-group"><label className="label">Audience</label>
            <select className="select" value={editing.audience} onChange={e => setEditing({ ...editing, audience: e.target.value })}>
              <option value="all">All parents (school-wide)</option>
              <option value="student">One student's parents</option>
            </select></div>
          {editing.audience === 'student' && (
            <div className="form-group"><label className="label">Student</label>
              <select className="select" value={editing.target_student_id || ''} onChange={e => setEditing({ ...editing, target_student_id: parseInt(e.target.value, 10) })}>
                <option value="">— Select —</option>
                {students.map(s => <option key={s.id} value={s.id}>{s.surname} {s.first_name} ({s.index_number})</option>)}
              </select></div>
          )}
        </Modal>
      )}
    </div>
  );
}

function SendTab() {
  const classes = useStore(s => s.classes);
  const showToast = useStore(s => s.showToast);
  const [classId, setClassId] = useState('');
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const list = await window.api.students.list({ classId: classId || undefined });
      setStudents(list);
      setSelected(new Set());
    })();
  }, [classId]);

  function toggle(id) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }
  function selectAll() {
    setSelected(new Set(students.map(s => s.id)));
  }

  async function send() {
    if (!message || selected.size === 0) return;
    setBusy(true);
    const recipients = students.filter(s => selected.has(s.id)).map(s => ({
      name: `${s.surname} ${s.first_name}`,
      contact: s.father_contact || s.mother_contact || s.guardian_contact,
      params: {
        parent_name: s.father_name || s.mother_name || s.guardian_name || 'Parent',
        student_name: `${s.surname} ${s.first_name}`,
        index_number: s.index_number,
        class: s.class_name,
      },
    })).filter(r => r.contact);
    const res = await window.api.notifications.sendBulkSms({ recipients, message });
    setBusy(false);
    if (res.ok) showToast(`Queued ${res.results.length} SMS messages`);
  }

  return (
    <div className="card">
      <div className="form-row">
        <div className="form-group">
          <label className="label">Filter by class</label>
          <select className="select" value={classId} onChange={e => setClassId(e.target.value)}>
            <option value="">All classes</option>
            {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="label">&nbsp;</label>
          <button className="btn btn-outline" onClick={selectAll}>Select all ({students.length})</button>
        </div>
      </div>

      <div className="form-group">
        <label className="label">Message</label>
        <textarea className="textarea" rows="4" value={message} onChange={e => setMessage(e.target.value)}
          placeholder="Use placeholders: {parent_name}, {student_name}, {index_number}, {class}"></textarea>
        <div className="helper">{message.length} characters · ~{Math.ceil(message.length / 160)} SMS units per recipient</div>
      </div>

      <div className="row gap-2 mb-3">
        <button className="btn btn-primary" onClick={send} disabled={busy || selected.size === 0 || !message}>
          {busy ? <><span className="spinner" /> Sending…</> : `📤 Send to ${selected.size} recipient(s)`}
        </button>
      </div>

      <table className="table">
        <thead><tr><th></th><th>Index</th><th>Name</th><th>Class</th><th>Contact</th></tr></thead>
        <tbody>
          {students.map(s => (
            <tr key={s.id}>
              <td><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} /></td>
              <td>{s.index_number}</td>
              <td>{s.surname} {s.first_name}</td>
              <td>{s.class_name}</td>
              <td>{s.father_contact || s.mother_contact || s.guardian_contact || <span className="text-muted">no contact</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TemplatesTab() {
  const showToast = useStore(s => s.showToast);
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null);

  async function refresh() {
    const list = await window.api.notifications.getTemplates();
    setTemplates(list);
  }
  useEffect(() => { refresh(); }, []);

  async function save() {
    await window.api.notifications.saveTemplate(editing);
    setEditing(null);
    refresh();
    showToast('Template saved');
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">Notification templates</div>
        <button className="btn btn-primary" onClick={() => setEditing({ name: '', channel: 'sms', body: '', category: 'general' })}>+ New</button>
      </div>
      <table className="table">
        <thead><tr><th>Name</th><th>Channel</th><th>Category</th><th>Body preview</th><th></th></tr></thead>
        <tbody>
          {templates.map(t => (
            <tr key={t.id}>
              <td className="bold">{t.name}</td>
              <td><span className="badge badge-primary">{t.channel}</span></td>
              <td>{t.category}</td>
              <td className="text-sm text-muted" style={{ maxWidth: 400 }}>{t.body.slice(0, 80)}…</td>
              <td><button className="btn btn-outline btn-sm" onClick={() => setEditing(t)}>Edit</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <Modal title={editing.id ? 'Edit template' : 'New template'} onClose={() => setEditing(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Save</button></>}>
          <div className="form-row">
            <div className="form-group">
              <label className="label">Name</label>
              <input className="input" value={editing.name ?? ''} onChange={e => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">Channel</label>
              <select className="select" value={editing.channel ?? ''} onChange={e => setEditing({ ...editing, channel: e.target.value })}>
                <option value="sms">SMS</option>
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="label">Category</label>
            <select className="select" value={editing.category ?? ''} onChange={e => setEditing({ ...editing, category: e.target.value })}>
              <option value="general">General</option>
              <option value="fees">Fees</option>
              <option value="canteen">Canteen</option>
              <option value="academic">Academic</option>
            </select>
          </div>
          <div className="form-group">
            <label className="label">Message body</label>
            <textarea className="textarea" rows="6" value={editing.body ?? ''}
              onChange={e => setEditing({ ...editing, body: e.target.value })}></textarea>
            <div className="helper">Placeholders: {'{parent_name}, {student_name}, {index_number}, {class}, {amount}, {balance}, {receipt}, {date}, {term}'}</div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function HistoryTab() {
  const [log, setLog] = useState([]);
  useEffect(() => {
    (async () => setLog(await window.api.notifications.listLog({})))();
  }, []);
  return (
    <div className="card">
      <table className="table">
        <thead><tr><th>Date</th><th>Channel</th><th>Recipient</th><th>Contact</th><th>Status</th><th>Message</th></tr></thead>
        <tbody>
          {log.map(l => (
            <tr key={l.id}>
              <td>{fmtDate(l.sent_at)}</td>
              <td>{l.channel}</td>
              <td>{l.recipient_name}</td>
              <td>{l.recipient_contact}</td>
              <td><span className={'badge ' + (l.delivery_status === 'simulated' ? 'badge-muted' : 'badge-success')}>{l.delivery_status}</span></td>
              <td className="text-sm text-muted" style={{ maxWidth: 400 }}>{l.message_body?.slice(0, 80)}</td>
            </tr>
          ))}
          {log.length === 0 && <tr><td colSpan="6"><div className="empty-state"><h3>No messages sent yet</h3></div></td></tr>}
        </tbody>
      </table>
    </div>
  );
}
