// Nickland Edusoft — Topbar (exact Image 1 header design)
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/index.js';

export default function Topbar() {
  const navigate = useNavigate();
  const { settings, currentTerm, classes } = useStore();
  const school = settings.school || {};
  const branding = settings.branding || {};
  const logoPath = branding.school_logo_path;
  const logoSrc = logoPath ? `file://${logoPath}` : null;
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
