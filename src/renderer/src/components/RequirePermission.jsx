// Nickland Edusoft — Route Guard
// Wraps a route element. If the user lacks 'view' permission on the module,
// shows a friendly "Access Denied" screen instead of the page.
import React from 'react';
import { useStore } from '../store/index.js';
import { useNavigate } from 'react-router-dom';

export default function RequirePermission({ module, action = 'view', children }) {
  const can = useStore(s => s.can);
  const currentUser = useStore(s => s.currentUser);
  const navigate = useNavigate();

  if (!currentUser) return null;
  if (can(module, action)) return children;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '60vh', padding: 40, textAlign: 'center',
    }}>
      <div style={{ fontSize: 64, marginBottom: 18 }}>🔒</div>
      <h2 style={{ marginBottom: 8 }}>Access Restricted</h2>
      <p style={{ color: 'var(--muted)', maxWidth: 480, lineHeight: 1.6 }}>
        Your role does not have permission to view the <strong>{module}</strong> module.
        If you believe this is a mistake, ask an Administrator or the Proprietor to grant you access in
        Settings → Users & Logins.
      </p>
      <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => navigate('/')}>
        ← Return to Home
      </button>
    </div>
  );
}
