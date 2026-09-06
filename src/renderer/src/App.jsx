// Nickland Edusoft — App Root Router
// Copyright © 2026 Nickland Sales. All rights reserved.
import React, { useEffect, useRef, useState } from 'react';
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
import TransportIndex from './pages/Transport/Index.jsx';
import NotificationsIndex from './pages/Notifications/Index.jsx';
import MessagesIndex from './pages/Messages/Index.jsx';
import SettingsIndex from './pages/Settings/Index.jsx';
import RequirePermission from './components/RequirePermission.jsx';
import { mediaUrl } from './lib/media.js';

// ── App state phases ──────────────────────────────────────
// 'loading'    → checking bootstrap + settings
// 'bootstrap'  → first run: no admin yet
// 'login'      → has admin, not signed in
// 'app'        → signed in

export default function App() {
  const { loadSettings, loadClassesAndTerms, login, isAuthenticated } = useStore();
  const [phase, setPhase] = useState('loading');
  // Read by the watchdog below, which fires from a timer and would otherwise
  // close over whatever the step was when the effect ran.
  const bootStepRef = useRef('Starting');

  // What the application is doing before it can show anything, and what went
  // wrong if it never got there.
  //
  // This sequence used to have no error handling at all, and the two ways it
  // can fail produced the same screen: the splash, forever. A channel that
  // answered a refusal instead of a list threw inside `terms.find`; a channel
  // with no handler rejected; either way the promise died unobserved, `phase`
  // stayed 'loading', and the school was left looking at a spinner with
  // nothing to read and nothing to try. That is the worst failure a program
  // can have, because it is indistinguishable from being slow.
  //
  // So: every step says what it is, a failure says which one and why, and a
  // step that simply never finishes is caught too — a promise that never
  // settles is not caught by try/catch, and hanging is exactly what a database
  // on a network drive or a half-registered module does.
  const [bootError, setBootError] = useState(null);
  const [bootStep, setBootStep] = useState('Starting');
  const [bootAttempt, setBootAttempt] = useState(0);

  useEffect(() => {
    let done = false;

    // Long enough that a slow machine opening a large school is never
    // interrupted, short enough that nobody sits watching a spinner wondering
    // whether to restart.
    const watchdog = setTimeout(() => {
      if (!done) {
        setBootError({
          step: bootStepRef.current,
          message: 'It is taking much longer than it should.',
          slow: true,
        });
      }
    }, 20000);

    (async () => {
      try {
        bootStepRef.current = 'Reading the school’s settings';
        setBootStep(bootStepRef.current);
        await loadSettings();

        bootStepRef.current = 'Reading the classes, terms and subjects';
        setBootStep(bootStepRef.current);
        await loadClassesAndTerms();

        bootStepRef.current = 'Checking whether the school has been set up';
        setBootStep(bootStepRef.current);
        const status = await window.api.auth.bootstrapStatus();

        done = true;
        if (!status || !status.done) {
          setPhase('bootstrap');
        } else if (!isAuthenticated) {
          setPhase('login');
        } else {
          setPhase('app');
        }
      } catch (e) {
        done = true;
        setBootError({
          step: bootStepRef.current,
          message: (e && e.message) || String(e),
        });
      }
    })();

    return () => { done = true; clearTimeout(watchdog); };
  }, [bootAttempt]);

  // Auth state drives the phase in BOTH directions. Advancing on sign-in was
  // always here; the way back was not, so signing out cleared the session but
  // left `phase` on 'app'. Every route then rendered null behind a sidebar
  // still showing the signed-out user — a blank window with no way back to the
  // login screen short of restarting the app.
  useEffect(() => {
    if (phase === 'loading' || phase === 'bootstrap') return;
    if (isAuthenticated && phase === 'login') setPhase('app');
    else if (!isAuthenticated && phase === 'app') setPhase('login');
  }, [isAuthenticated, phase]);

  if (phase === 'loading') {
    return bootError
      ? <BootFailure
          error={bootError}
          step={bootStep}
          onRetry={() => { setBootError(null); setBootAttempt(n => n + 1); }}
        />
      : <Splash step={bootStep} />;
  }

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
          {/* Timetable and Homework now live inside Academics; keep the old paths working. */}
          <Route path="timetable" element={<Navigate to="/academics?tab=timetable" replace />} />
          <Route path="homework" element={<Navigate to="/academics?tab=homework" replace />} />
          <Route path="staff" element={<RequirePermission module="staff"><StaffIndex /></RequirePermission>} />
          <Route path="staff/:id" element={<RequirePermission module="staff"><StaffDetail /></RequirePermission>} />
          <Route path="payroll" element={<RequirePermission module="payroll"><Payroll /></RequirePermission>} />
          <Route path="fees" element={<RequirePermission module="fees"><FeesIndex /></RequirePermission>} />
          <Route path="canteen" element={<RequirePermission module="canteen"><CanteenIndex /></RequirePermission>} />
          <Route path="finance" element={<RequirePermission module="finance"><FinanceIndex /></RequirePermission>} />
          <Route path="inventory" element={<RequirePermission module="finance"><InventoryIndex /></RequirePermission>} />
          <Route path="transport" element={<RequirePermission module="finance"><TransportIndex /></RequirePermission>} />
          <Route path="notifications" element={<RequirePermission module="notifications"><NotificationsIndex /></RequirePermission>} />
          <Route path="messages" element={<RequirePermission module="notifications"><MessagesIndex /></RequirePermission>} />
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
  const logoSrc = logoPath ? mediaUrl(logoPath) : null;
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

const Crest = () => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
    <rect width="64" height="64" rx="16" fill="#1B3A6B"/>
    <path d="M14 46L32 20L50 46H14Z" fill="#C9961A"/>
  </svg>
);

function Splash({ step }) {
  return (
    <div className="splash">
      <div className="splash-logo"><Crest /></div>
      <div className="splash-name">Nickland Edusoft</div>
      <div className="splash-sub">by Nickland Sales</div>
      <div className="splash-spinner" />
      {/* Which of the three steps it is on. A spinner alone cannot be told
          apart from a spinner that will never stop. */}
      {step && <div className="splash-step">{step}…</div>}
    </div>
  );
}

// The application could not start, and this says so instead of spinning.
//
// Written for the person in the school office, not for a developer: what it
// was doing, what happened, and the two things that are actually worth trying
// before telephoning anybody. The technical detail is there as well, because
// it is what a support call needs and reading it out beats describing a
// spinner.
function BootFailure({ error, step, onRetry }) {
  const slow = error.slow;
  return (
    <div className="splash">
      <div className="splash-logo"><Crest /></div>
      <div className="splash-name">Nickland Edusoft</div>
      <div className="splash-sub">by Nickland Sales</div>

      <div className="splash-error">
        <h2>{slow ? 'This is taking too long' : 'The application could not start'}</h2>
        <p>
          It was {(error.step || step || 'starting up').toLowerCase()} and{' '}
          {slow ? 'has not finished.' : 'something went wrong.'}
        </p>

        <ul>
          <li>Try again — most of the time that is enough.</li>
          <li>If it keeps happening, restart the computer.</li>
          <li>
            If it still will not start, restore your most recent backup, or send
            Nickland Sales the message below.
          </li>
        </ul>

        <pre>{error.message}</pre>

        <button className="btn btn-primary" onClick={onRetry}>Try again</button>
      </div>
    </div>
  );
}
