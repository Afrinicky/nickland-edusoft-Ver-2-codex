// Nickland Edusoft — Topbar (exact Image 1 header design)
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/index.js';
import { mediaUrl } from '../lib/media.js';

export default function Topbar() {
  const navigate = useNavigate();
  const { settings, currentTerm, classes } = useStore();
  const showToast = useStore(s => s.showToast);
  const school = settings.school || {};
  const branding = settings.branding || {};
  const logoPath = branding.school_logo_path;
  const logoSrc = logoPath ? mediaUrl(logoPath) : null;
  const schoolName = school.school_name || 'Your School Name';
  const schoolMotto = school.school_motto || '';
  const [search, setSearch] = useState('');
  const [notifCount] = useState(0);

  const handleSearch = (e) => {
    if (e.key === 'Enter' && search.trim()) {
      navigate(`/search?q=${encodeURIComponent(search)}`);
    }
  };

  return (
    <header className="topbar">
      {/* Left: Logo + School Name */}
      <div className="topbar-brand">
        {logoSrc
          ? <img src={logoSrc} alt="Logo" className="topbar-logo" />
          : <div className="topbar-logo-placeholder" />
        }
        <div className="topbar-school-text">
          <div className="topbar-school-name">{schoolName}</div>
          {schoolMotto && <div className="topbar-school-motto">{schoolMotto}</div>}
        </div>
      </div>

      {/* Center: Search */}
      <div className="topbar-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="topbar-search-icon">
          <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
          <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2"/>
        </svg>
        <input
          type="text"
          className="topbar-search-input"
          placeholder="Search students, staff, receipts…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={handleSearch}
        />
        <span className="topbar-search-hint">Ctrl + K</span>
      </div>

      {/* Right: Notifications, clipboard, term selector */}
      <div className="topbar-actions">
        {/* Notification bell */}
        <button className="topbar-icon-btn" title="Notifications" onClick={() => navigate('/notifications')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M4 9c0-4 4-6 8-6s8 2 8 6v7l3 3H1l3-3V9Z" stroke="currentColor" strokeWidth="1.8"/>
            <path d="M9 20a3 3 0 006 0" stroke="currentColor" strokeWidth="1.8" fill="none"/>
          </svg>
          {notifCount > 0 && <span className="topbar-badge">{notifCount}</span>}
        </button>

        {/* Reports shortcut */}
        <button className="topbar-icon-btn" title="Reports" onClick={() => navigate('/academics')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.8"/>
            <path d="M8 9h8M8 13h5" stroke="currentColor" strokeWidth="1.8"/>
          </svg>
        </button>

        {/* School-in-session / vacation indicator */}
        <SessionBadge showToast={showToast} />

        {/* Term selector */}
        {currentTerm && (
          <div className="topbar-term">
            <div className="topbar-term-year">{currentTerm.year_label || '2025/2026'}</div>
            <div className="topbar-term-label">{currentTerm.label || 'Second Term'}</div>
          </div>
        )}
      </div>
    </header>
  );
}

// Live academic-session indicator. Shows whether school is in session or on
// vacation (based on the term calendar + real/network time) and, when the
// calendar has rolled into a new term, offers or auto-runs the migration.
function SessionBadge({ showToast }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const s = await window.api.session.status();
      if (s && s.ok) setInfo(s);
    } catch (_) {}
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5 * 60 * 1000); // re-check every 5 min
    return () => clearInterval(id);
  }, []);

  // Auto-migrate when configured to do so and a transition is pending.
  useEffect(() => {
    if (!info?.transition_pending || info.auto_migrate !== 'auto' || busy) return;
    (async () => {
      setBusy(true);
      try {
        const res = await window.api.session.migrateTerm({ targetTermId: info.transition_target });
        if (res?.ok) {
          await useStore.getState().loadClassesAndTerms();
          showToast?.(res.was_promotional
            ? `New academic term started — ${res.promoted} students promoted`
            : 'System migrated to the new term', 'success');
        }
      } catch (_) {}
      setBusy(false);
      refresh();
    })();
  }, [info?.transition_pending, info?.auto_migrate]);

  async function promptMigrate() {
    if (!info?.transition_target || busy) return;
    let plan = null;
    try { plan = await window.api.session.migrationPreview(info.transition_target); } catch (_) {}
    const msg = plan?.is_promotional
      ? `Start "${info.term?.label}" and PROMOTE ${plan.promote_count} students to the next class? Unpaid balances carry forward as arrears.`
      : `Move the system into "${info.term?.label}"? Unpaid balances carry forward as arrears.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const res = await window.api.session.migrateTerm({ targetTermId: info.transition_target });
      if (res?.ok) {
        await useStore.getState().loadClassesAndTerms();
        showToast?.(res.was_promotional ? `Term started — ${res.promoted} students promoted` : 'Migrated to new term', 'success');
      } else {
        showToast?.(res?.error || 'Migration failed', 'error');
      }
    } catch (e) { showToast?.('Migration failed', 'error'); }
    setBusy(false);
    refresh();
  }

  if (!info) return null;
  const inSession = info.status === 'in_session';
  const dot = inSession ? '#16a34a' : '#d97706';
  const bg = inSession ? 'rgba(22,163,74,0.12)' : 'rgba(217,119,6,0.14)';
  const label = inSession ? 'School in Session' : 'On Vacation';
  const sub = inSession
    ? (info.days_to_vacation != null && info.days_to_vacation >= 0 ? `${info.days_to_vacation}d to vacation` : '')
    : (info.days_to_reopen != null && info.days_to_reopen >= 0 ? `Reopens in ${info.days_to_reopen}d` : '');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div title={`${label}${info.source === 'manual' ? ' (manual override)' : ''} · time: ${info.time_source}`}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: bg, whiteSpace: 'nowrap' }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: dot, boxShadow: `0 0 0 3px ${bg}` }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: dot }}>{label}</span>
        {sub && <span style={{ fontSize: 11, opacity: 0.7 }}>· {sub}</span>}
      </div>
      {info.transition_pending && info.auto_migrate !== 'auto' && (
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={promptMigrate} title="A new term has started on the calendar">
          {busy ? '…' : `Start ${info.term?.label || 'new term'} →`}
        </button>
      )}
    </div>
  );
}
