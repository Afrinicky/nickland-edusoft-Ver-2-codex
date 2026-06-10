// Nickland Edusoft — Toast Notification
import React from 'react';
import { useStore } from '../store/index.js';

export default function Toast() {
  const toast = useStore(s => s.toast);
  if (!toast) return null;
  return (
    <div className="toast-container">
      <div className={`toast toast-${toast.type}`}>
        {toast.type === 'success' && <SuccessIcon />}
        {toast.type === 'error' && <ErrorIcon />}
        {toast.type === 'warning' && <WarningIcon />}
        {toast.type === 'info' && <InfoIcon />}
        <span>{toast.message}</span>
      </div>
    </div>
  );
}

function SuccessIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function ErrorIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/><path d="M12 8v5M12 16v.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>;
}
function WarningIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3L2 21h20L12 3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M12 9v5M12 17v.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>;
}
function InfoIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/><path d="M12 8v.5M12 11v6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>;
}
