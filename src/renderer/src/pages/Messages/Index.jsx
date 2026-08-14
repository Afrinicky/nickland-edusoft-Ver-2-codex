// Messages — parent ↔ school conversations (desktop staff side).
// Copyright © 2026 Nickland Sales. All rights reserved.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

const NAVY = '#1B3A6B';
const GOLD = '#C9961A';

export default function MessagesIndex() {
  const { currentUser, showToast, can } = useStore();
  const canReply = can('notifications', 'edit') || can('notifications', 'create');
  const [threads, setThreads] = useState([]);
  const [selId, setSelId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  async function loadThreads() {
    const t = await window.api.messages.listThreads();
    setThreads(t || []);
  }
  useEffect(() => { loadThreads(); }, []);

  async function open(id) {
    setSelId(id); setReply('');
    const d = await window.api.messages.getThread(id);
    setDetail(d);
    if (d?.thread?.staff_unread) { await window.api.messages.markRead({ threadId: id, side: 'staff' }); loadThreads(); }
  }

  async function send() {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      const r = await window.api.messages.reply({ threadId: selId, body: reply, senderId: currentUser?.id, senderName: currentUser?.fullName });
      if (r.ok) { setReply(''); await open(selId); await loadThreads(); }
      else showToast(r.error || 'Could not send.', 'error');
    } finally { setBusy(false); }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ color: NAVY, margin: 0 }}>Messages</h1>
        {canReply && <button style={primaryBtn} onClick={() => setNewOpen(true)}>New message</button>}
      </div>
      <p style={{ color: '#64748B', marginTop: 4 }}>Conversations with parents. Your replies are also sent to the parent by SMS/email.</p>

      <div style={{ display: 'flex', gap: 16, marginTop: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 320, flexShrink: 0 }}>
          {threads.length === 0 && <div style={{ ...card, color: '#94A3B8' }}>No conversations yet.</div>}
          {threads.map(t => (
            <div key={t.id} onClick={() => open(t.id)}
              style={{ ...card, cursor: 'pointer', marginBottom: 8, borderLeft: t.id === selId ? `4px solid ${NAVY}` : '4px solid transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{t.parent_name}</strong>
                {t.staff_unread > 0 && <span style={badge}>{t.staff_unread}</span>}
              </div>
              <div style={{ fontSize: 12, color: '#64748B' }}>{t.subject || (t.student_name ? `Re: ${t.student_name}` : 'Conversation')}</div>
              <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.preview}</div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1 }}>
          {!detail ? <div style={{ ...card, color: '#94A3B8' }}>Select a conversation.</div> : (
            <div style={card}>
              <div style={{ borderBottom: '1px solid #E7EBF1', paddingBottom: 8, marginBottom: 8 }}>
                <strong>{detail.thread.parent_name}</strong>
                <div style={{ fontSize: 12, color: '#64748B' }}>{detail.thread.subject || ''}{detail.thread.student_name ? ` · ${detail.thread.student_name}` : ''}</div>
              </div>
              <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {detail.messages.map(m => (
                  <div key={m.id} style={{ alignSelf: m.sender_type === 'staff' ? 'flex-end' : 'flex-start', maxWidth: '75%' }}>
                    <div style={{ background: m.sender_type === 'staff' ? NAVY : '#F1F5F9', color: m.sender_type === 'staff' ? '#fff' : '#0F172A', padding: '8px 12px', borderRadius: 12 }}>
                      {m.body}
                    </div>
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2, textAlign: m.sender_type === 'staff' ? 'right' : 'left' }}>
                      {m.sender_name || (m.sender_type === 'staff' ? 'School' : 'Parent')} · {String(m.created_at).slice(0, 16).replace('T', ' ')}
                    </div>
                  </div>
                ))}
              </div>
              {canReply && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <input value={reply} onChange={e => setReply(e.target.value)} placeholder="Type a reply…"
                    onKeyDown={e => { if (e.key === 'Enter') send(); }}
                    style={{ flex: 1, padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: 8 }} />
                  <button style={primaryBtn} onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {newOpen && <NewMessage onClose={() => setNewOpen(false)} currentUser={currentUser} showToast={showToast}
        onSent={async () => { setNewOpen(false); await loadThreads(); }} />}
    </div>
  );
}

function NewMessage({ onClose, currentUser, showToast, onSent }) {
  const [parents, setParents] = useState([]);
  const [parentId, setParentId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { window.api.mobile.listParents().then(r => setParents(r.parents || [])).catch(() => setParents([])); }, []);

  async function send() {
    if (!parentId || !body.trim()) { showToast('Choose a parent and type a message.', 'error'); return; }
    setBusy(true);
    try {
      const r = await window.api.messages.start({ parentId: Number(parentId), subject, body, senderId: currentUser?.id, senderName: currentUser?.fullName });
      if (r.ok) { showToast('Message sent.', 'success'); onSent(); }
      else showToast(r.error || 'Could not send.', 'error');
    } finally { setBusy(false); }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...card, width: 460 }} onClick={e => e.stopPropagation()}>
        <h3 style={{ marginTop: 0, color: NAVY }}>New message</h3>
        <label style={lbl}>Parent</label>
        <select value={parentId} onChange={e => setParentId(e.target.value)} style={inp}>
          <option value="">— choose —</option>
          {parents.map(p => <option key={p.id} value={p.id}>{p.full_name}{p.phone ? ` (${p.phone})` : ''}</option>)}
        </select>
        <label style={lbl}>Subject (optional)</label>
        <input value={subject} onChange={e => setSubject(e.target.value)} style={inp} />
        <label style={lbl}>Message</label>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} style={{ ...inp, resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={ghostBtn} onClick={onClose}>Cancel</button>
          <button style={primaryBtn} onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
        </div>
      </div>
    </div>
  );
}

const card = { background: '#fff', border: '1px solid #E7EBF1', borderRadius: 12, padding: 16 };
const primaryBtn = { background: NAVY, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' };
const ghostBtn = { background: '#fff', color: NAVY, border: '1px solid #E2E8F0', borderRadius: 8, padding: '8px 14px', fontWeight: 600, cursor: 'pointer' };
const badge = { background: GOLD, color: '#fff', borderRadius: 999, padding: '0 8px', fontSize: 12, fontWeight: 800 };
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 };
const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: '#64748B', margin: '10px 0 4px' };
const inp = { width: '100%', padding: '9px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14 };
