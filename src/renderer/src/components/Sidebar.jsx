// Nickland Edusoft — Sidebar (Dark Navy, exact Image 1 design)
import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useStore } from '../store/index.js';

const NAV_ITEMS = [
  { to: '/',              icon: 'home',      label: 'Home',                  module: null         },
  { to: '/dashboard',     icon: 'dashboard', label: 'Dashboard',             module: 'dashboard'  },
  { to: '/students',      icon: 'students',  label: 'Students',              module: 'students'   },
  { to: '/academics',     icon: 'academics', label: 'Academics',             module: 'academics'  },
  { to: '/fees',          icon: 'fees',      label: 'Fees Management',       module: 'fees'       },
  { to: '/canteen',       icon: 'canteen',   label: 'Canteen',               module: 'canteen'    },
  { to: '/staff',         icon: 'staff',     label: 'Staff Management',      module: 'staff'      },
  { to: '/payroll',       icon: 'payroll',   label: 'Payroll',               module: 'payroll'    },
  { to: '/finance',       icon: 'finance',   label: 'Finance',               module: 'finance'    },
  { to: '/inventory',     icon: 'inventory', label: 'Purchasing & Inventory',module: 'finance'    },
  { to: '/notifications', icon: 'bell',      label: 'Notifications',         module: 'notifications' },
  { to: '/settings',      icon: 'settings',  label: 'Settings',              module: 'settings'   },
];

const ICONS = {
  home:      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" strokeWidth="1.8" fill="none" stroke="currentColor"/>,
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" fill="currentColor" opacity="0.9"/><rect x="14" y="3" width="7" height="7" rx="1" fill="currentColor" opacity="0.6"/><rect x="3" y="14" width="7" height="7" rx="1" fill="currentColor" opacity="0.6"/><rect x="14" y="14" width="7" height="7" rx="1" fill="currentColor" opacity="0.9"/></>,
  students:  <><circle cx="9" cy="7" r="4" fill="currentColor" opacity="0.8"/><path d="M1 20c0-4 4-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.8" fill="none"/><circle cx="18" cy="7" r="3" fill="currentColor" opacity="0.5"/><path d="M20 14c2 1 4 3 4 6" stroke="currentColor" strokeWidth="1.8" fill="none" opacity="0.5"/></>,
  academics: <><path d="M12 3l10 5-10 5L2 8z" fill="currentColor" opacity="0.9"/><path d="M5 10v5c0 3 3 5 7 5s7-2 7-5v-5" stroke="currentColor" strokeWidth="1.8" fill="none" opacity="0.7"/></>,
  fees:      <><rect x="2" y="5" width="20" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" fill="none"/><path d="M2 10h20" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="15" r="2" fill="currentColor"/></>,
  canteen:   <><path d="M5 4v7M5 11c0 4 2 7 7 7s7-3 7-7V4" stroke="currentColor" strokeWidth="1.8" fill="none"/><path d="M19 4v7" stroke="currentColor" strokeWidth="1.8"/><path d="M7 20h10M12 18v4" stroke="currentColor" strokeWidth="1.8"/></>,
  staff:     <><circle cx="12" cy="8" r="4" fill="currentColor" opacity="0.8"/><path d="M3 21c0-5 4-8 9-8s9 3 9 8" stroke="currentColor" strokeWidth="1.8" fill="none"/></>,
  payroll:   <><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" fill="none"/><path d="M3 9h18M9 9v11" stroke="currentColor" strokeWidth="1.5"/><path d="M12 13h4M12 16h3" stroke="currentColor" strokeWidth="1.5" opacity="0.7"/></>,
  finance:   <><rect x="2" y="16" width="4" height="6" rx="1" fill="currentColor" opacity="0.5"/><rect x="9" y="11" width="4" height="11" rx="1" fill="currentColor" opacity="0.7"/><rect x="16" y="5" width="4" height="17" rx="1" fill="currentColor" opacity="0.9"/></>,
  inventory: <><rect x="3" y="7" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" fill="none"/><path d="M3 11h18M9 7V4h6v3" stroke="currentColor" strokeWidth="1.8" fill="none"/><circle cx="12" cy="16" r="1.5" fill="currentColor"/></>,
  bell:      <><path d="M4 9c0-4 4-6 8-6s8 2 8 6v7l3 3H1l3-3V9Z" fill="currentColor" opacity="0.7"/><path d="M9 20a3 3 0 006 0" stroke="currentColor" strokeWidth="1.8" fill="none"/></>,
  settings:  <><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" fill="none"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" stroke="currentColor" strokeWidth="1.8"/></>,
};

function NavIcon({ name }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[name] || null}
    </svg>
  );
}

export default function Sidebar() {
  const navigate = useNavigate();
  const { currentUser, logout, settings, can } = useStore();
  const school = settings.school || {};
  const features = settings.features || {};
  const branding = settings.branding || {};
  const logoPath = branding.school_logo_path;
  const logoSrc = logoPath ? `file://${logoPath}` : null;
  const schoolName = school.school_name || 'Your School Name';

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const handleLogout = () => {
    logout();
  };

  return (
    <aside className="sidebar">
      {/* School branding */}
      <div className="sidebar-brand">
        {logoSrc
          ? <img src={logoSrc} alt="Logo" className="sidebar-logo" />
          : <div className="sidebar-logo-placeholder">
              <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
                <rect width="44" height="44" rx="10" fill="rgba(255,255,255,0.15)"/>
                <path d="M10 32L22 14L34 32H10Z" fill="#C9961A" opacity="0.8"/>
              </svg>
            </div>
        }
        <div className="sidebar-school-text">
          <div className="sidebar-school-name">{schoolName}</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.filter(item => {
          // Feature toggles
          if (item.to === '/canteen' && features.feature_canteen_enabled === 'false') return false;
          if (item.to === '/notifications' && features.feature_notifications_enabled === 'false') return false;
          // Permission gate (Home is always visible)
          if (item.module && !can(item.module, 'view')) return false;
          return true;
        }).map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}
          >
            <span className="sidebar-nav-icon"><NavIcon name={item.icon} /></span>
            <span className="sidebar-nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* User profile at bottom */}
      <div className="sidebar-user">
        <div className="sidebar-user-avatar">
          {(currentUser?.fullName || 'A').charAt(0).toUpperCase()}
        </div>
        <div className="sidebar-user-info">
          <div className="sidebar-user-name">{currentUser?.fullName || 'Administrator'}</div>
          <div className="sidebar-user-role">{currentUser?.designation || 'Admin'}</div>
          <div className="sidebar-user-status">
            <span className="status-dot online" />Online
          </div>
        </div>
        <button className="sidebar-logout-btn" onClick={handleLogout} title="Sign out">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.8"/>
          </svg>
        </button>
      </div>

      {/* Clock */}
      <div className="sidebar-clock">
        <div className="sidebar-time">{timeStr}</div>
        <div className="sidebar-date">{dateStr}</div>
      </div>
    </aside>
  );
}
