// Nickland Edusoft — App Root Router
// Copyright © 2026 Nickland Sales. All rights reserved.
import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useStore } from './store/index.js';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import Toast from './components/Toast.jsx';
import Bootstrap from './pages/Bootstrap.jsx';
import Login from './pages/Login.jsx';
import Homepage from './pages/Homepage.jsx';
import Dashboard from './pages/Dashboard.jsx';
import StudentsIndex from './pages/Students/Index.jsx';
import StudentDetail from './pages/Students/Detail.jsx';
import PrintableProfile from './pages/Students/PrintableProfile.jsx';
import StaffIndex from './pages/Staff/Index.jsx';
import StaffDetail from './pages/Staff/Detail.jsx';
import Payroll from './pages/Staff/Payroll.jsx';
import FeesIndex from './pages/Fees/Index.jsx';
import AcademicsIndex from './pages/Academics/Index.jsx';
import ScoresEntry from './pages/Scores/Entry.jsx';
import ScoresReport from './pages/Scores/Report.jsx';
import CanteenIndex from './pages/Canteen/Index.jsx';
import FinanceIndex from './pages/Finance/Index.jsx';
import InventoryIndex from './pages/Inventory/Index.jsx';
import NotificationsIndex from './pages/Notifications/Index.jsx';
import SettingsIndex from './pages/Settings/Index.jsx';
import RequirePermission from './components/RequirePermission.jsx';

// ── App state phases ──────────────────────────────────────
// 'loading'    → checking bootstrap + settings
// 'bootstrap'  → first run: no admin yet
// 'login'      → has admin, not signed in
// 'app'        → signed in

export default function App() {
  const { loadSettings, loadClassesAndTerms, login, isAuthenticated } = useStore();
  const [phase, setPhase] = useState('loading');

  useEffect(() => {
    (async () => {
      await loadSettings();
      await loadClassesAndTerms();
      const { done } = await window.api.auth.bootstrapStatus();
      if (!done) {
        setPhase('bootstrap');
      } else if (!isAuthenticated) {
        setPhase('login');
      } else {
        setPhase('app');
      }
    })();
  }, []);

  // When auth state changes, advance to app
  useEffect(() => {
    if (isAuthenticated && phase === 'login') setPhase('app');
  }, [isAuthenticated]);

  if (phase === 'loading') return <Splash />;

  if (phase === 'bootstrap') {
    return <Bootstrap onDone={() => setPhase('login')} />;
  }

  if (phase === 'login') {
    return <Login onLogin={async (user) => { await login(user); setPhase('app'); }} />;
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<HomepageShell />} />
        <Route path="/*" element={<AppShell />}>
          <Route path="dashboard" element={<RequirePermission module="dashboard"><Dashboard /></RequirePermission>} />
          <Route path="students" element={<RequirePermission module="students"><StudentsIndex /></RequirePermission>} />
          <Route path="students/:id" element={<RequirePermission module="students"><StudentDetail /></RequirePermission>} />
          <Route path="students/:id/print" element={<RequirePermission module="students"><PrintableProfile /></RequirePermission>} />
          <Route path="academics" element={<RequirePermission module="academics"><AcademicsIndex /></RequirePermission>} />
          <Route path="academics/report/:studentId" element={<RequirePermission module="academics"><ScoresReport /></RequirePermission>} />
          <Route path="staff" element={<RequirePermission module="staff"><StaffIndex /></RequirePermission>} />
          <Route path="staff/:id" element={<RequirePermission module="staff"><StaffDetail /></RequirePermission>} />
          <Route path="payroll" element={<RequirePermission module="payroll"><Payroll /></RequirePermission>} />
          <Route path="fees" element={<RequirePermission module="fees"><FeesIndex /></RequirePermission>} />
          <Route path="canteen" element={<RequirePermission module="canteen"><CanteenIndex /></RequirePermission>} />
          <Route path="finance" element={<RequirePermission module="finance"><FinanceIndex /></RequirePermission>} />
          <Route path="inventory" element={<RequirePermission module="finance"><InventoryIndex /></RequirePermission>} />
          <Route path="notifications" element={<RequirePermission module="notifications"><NotificationsIndex /></RequirePermission>} />
          <Route path="settings/*" element={<RequirePermission module="settings"><SettingsIndex /></RequirePermission>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toast />
    </>
  );
}

// ── Homepage shell (no sidebar, has topbar header) ────────
function HomepageShell() {
  const { settings, currentTerm } = useStore();
  const school = settings.school || {};
  const branding = settings.branding || {};
  const logoPath = branding.school_logo_path;
  const logoSrc = logoPath ? `file://${logoPath}` : null;
  const schoolName = school.school_name || 'Your School Name';
  const schoolMotto = school.school_motto || '';

  return (
    <div className="homepage-shell">
      {/* Homepage topbar — wider, no sidebar */}
      <header className="hp-topbar">
        <div className="hp-topbar-brand">
          {logoSrc
            ? <img src={logoSrc} alt="Logo" className="hp-topbar-logo" />
            : <div className="hp-topbar-logo-placeholder" />
          }
          <div>
            <div className="hp-topbar-school-name">{schoolName}</div>
            {schoolMotto && <div className="hp-topbar-school-motto">{schoolMotto}</div>}
          </div>
        </div>

        <div className="hp-topbar-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
            <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2"/>
          </svg>
          <input type="text" placeholder="Search students, staff, receipts…" />
          <span>Ctrl + K</span>
        </div>

        <div className="hp-topbar-right">
          <button className="topbar-icon-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M4 9c0-4 4-6 8-6s8 2 8 6v7l3 3H1l3-3V9Z" stroke="currentColor" strokeWidth="1.8"/>
              <path d="M9 20a3 3 0 006 0" stroke="currentColor" strokeWidth="1.8" fill="none"/>
            </svg>
          </button>
          <button className="topbar-icon-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.8"/>
              <path d="M8 9h8M8 13h5" stroke="currentColor" strokeWidth="1.8"/>
            </svg>
          </button>
          {currentTerm && (
            <div className="topbar-term">
              <div className="topbar-term-year">{currentTerm.year_label || '2025/2026'}</div>
              <div className="topbar-term-label">{currentTerm.label || 'Second Term'}</div>
            </div>
          )}
        </div>
      </header>

      <main className="hp-main">
        <Homepage />
      </main>
    </div>
  );
}

// ── App shell (with sidebar) ──────────────────────────────
function AppShell() {
  return (
    <div className="app-shell">
      <Topbar />
      <Sidebar />
      <main className="content">
        <Outlet />
      </main>
      <StatusBar />
    </div>
  );
}

// ── Status bar (bottom of Image 1) ───────────────────────
function StatusBar() {
  const { currentUser, settings } = useStore();
  const sys = settings.system || {};
  return (
    <footer className="status-bar">
      <span className="status-item">
        <span className="status-dot online" />
        Database: nickland-edusoft.db
      </span>
      <span className="status-item">
        <span className="status-dot online" />
        Backup: {sys.last_backup || 'Not yet backed up'}
      </span>
      <span className="status-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{marginRight:4}}>
          <circle cx="12" cy="8" r="4" fill="currentColor" opacity="0.7"/>
          <path d="M4 20c0-4 3-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.8" fill="none"/>
        </svg>
        User: {currentUser?.username || 'admin'}
      </span>
      <span className="status-item status-right">
        Version {sys.software_version || '2.0.0'}
      </span>
    </footer>
  );
}

function Splash() {
  return (
    <div className="splash">
      <div className="splash-logo">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          <rect width="64" height="64" rx="16" fill="#1B3A6B"/>
          <path d="M14 46L32 20L50 46H14Z" fill="#C9961A"/>
        </svg>
      </div>
      <div className="splash-name">Nickland Edusoft</div>
      <div className="splash-sub">by Nickland Sales</div>
      <div className="splash-spinner" />
    </div>
  );
}
