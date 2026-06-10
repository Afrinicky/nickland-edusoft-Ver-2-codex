// Nickland Edusoft — Homepage (Feature Card Grid)
// Exact replica of Image 2 design
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/index.js';

const MODULES = [
  {
    id: 'dashboard', label: 'Dashboard', sub: 'View summary & key statistics', route: '/dashboard',
    icon: (
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
        <rect x="4" y="4" width="12" height="12" rx="3" fill="currentColor" opacity="0.9"/>
        <rect x="20" y="4" width="12" height="12" rx="3" fill="currentColor" opacity="0.6"/>
        <rect x="4" y="20" width="12" height="12" rx="3" fill="currentColor" opacity="0.6"/>
        <rect x="20" y="20" width="12" height="12" rx="3" fill="currentColor" opacity="0.9"/>
      </svg>
    ),
  },
  {
    id: 'students', label: 'Students', sub: 'Manage student records', route: '/students',
    icon: (
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
        <circle cx="13" cy="11" r="5" fill="currentColor" opacity="0.7"/>
        <circle cx="23" cy="11" r="5" fill="currentColor" opacity="0.5"/>
        <path d="M2 28c0-6 5-10 11-10s11 4 11 10" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.9"/>
        <path d="M25 18c4 1 7 4 7 8" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.5"/>
      </svg>
    ),
  },
  {
    id: 'academics', label: 'Academics', sub: 'Examinations, Scores and Reports', route: '/academics',
    icon: (
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
        <path d="M18 4L32 11L18 18L4 11L18 4Z" fill="currentColor" opacity="0.9"/>
        <path d="M8 14v8c0 3 4 6 10 6s10-3 10-6v-8" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.7"/>
        <path d="M32 11v8" stroke="currentColor" strokeWidth="2.5" opacity="0.5"/>
      </svg>
    ),
  },
  {
    id: 'fees', label: 'Fees Management', sub: 'Fees, payments & arrears', route: '/fees',
    icon: (
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
        <rect x="4" y="8" width="28" height="20" rx="4" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.7"/>
        <path d="M4 14h28" stroke="currentColor" strokeWidth="2.5" opacity="0.5"/>
        <circle cx="18" cy="22" r="3" fill="currentColor" opacity="0.9"/>
      </svg>
    ),
  },
  {
    id: 'canteen', label: 'Canteen', sub: 'Canteen fees & payments', route: '/canteen',
    icon: (
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
        <path d="M8 6v10M8 16c0 5 3 9 10 10 7-1 10-5 10-10V6" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.8"/>
        <path d="M28 6v10" stroke="currentColor" strokeWidth="2.5" opacity="0.5"/>
        <path d="M10 28h16" stroke="currentColor" strokeWidth="2.5" opacity="0.7"/>
        <path d="M18 26v4" stroke="currentColor" strokeWidth="2.5" opacity="0.7"/>
      </svg>
    ),
  },
  {
    id: 'staff', label: 'Staff Management', sub: 'Manage staff information', route: '/staff',
    icon: (
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
        <circle cx="18" cy="12" r="6" fill="currentColor" opacity="0.8"/>
        <path d="M4 30c0-7 6-12 14-12s14 5 14 12" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.7"/>
      </svg>
    ),
  },
  {
    id: 'payroll', label: 'Payroll', sub: 'Manage staff salaries and payroll', route: '/payroll',
    icon: (
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
        <rect x="4" y="6" width="28" height="24" rx="3" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.7"/>
        <path d="M4 12h28M12 12v18M12 18h12M12 23h8" stroke="currentColor" strokeWidth="2" opacity="0.6"/>
        <circle cx="22" cy="22" r="3" fill="currentColor" opacity="0.9"/>
        <path d="M22 20v4M20 22h4" stroke="white" strokeWidth="1.5"/>
      </svg>
    ),
  },
  {
    id: 'finance', label: 'Finance', sub: 'Income, expenses & finance reports', route: '/finance',
    icon: (
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
        <rect x="4" y="24" width="6" height="8" rx="2" fill="currentColor" opacity="0.5"/>
        <rect x="13" y="16" width="6" height="16" rx="2" fill="currentColor" opacity="0.7"/>
        <rect x="22" y="8" width="6" height="24" rx="2" fill="currentColor" opacity="0.9"/>
        <path d="M6 18L14 12L22 8L30 4" stroke="currentColor" strokeWidth="2" opacity="0.6"/>
      </svg>
    ),
  },
  {
    id: 'inventory', label: 'Purchasing & Inventory', sub: 'Items, stock, purchase tracking', route: '/inventory',
    icon: (
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
        <rect x="4" y="10" width="28" height="20" rx="3" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.7"/>
        <path d="M4 16h28M14 10V6h8v4" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.6"/>
        <circle cx="18" cy="23" r="2.5" fill="currentColor" opacity="0.9"/>
      </svg>
    ),
  },
  {
    id: 'notifications', label: 'Notifications', sub: 'Send SMS & notifications', route: '/notifications',
    icon: (
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
        <path d="M6 12c0-6 5-8 12-8s12 2 12 8v10l4 4H2l4-4V12Z" fill="currentColor" opacity="0.7"/>
        <path d="M14 30a4 4 0 008 0" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.5"/>
        <circle cx="26" cy="8" r="5" fill="#C9961A"/>
        <text x="26" y="12" textAnchor="middle" fontSize="7" fill="white" fontWeight="bold">8</text>
      </svg>
    ),
  },
  {
    id: 'settings', label: 'Settings', sub: 'Configure school preferences', route: '/settings',
    icon: (
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
        <circle cx="18" cy="18" r="5" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.9"/>
        <path d="M18 4v4M18 28v4M4 18h4M28 18h4M7.5 7.5l2.8 2.8M25.7 25.7l2.8 2.8M7.5 28.5l2.8-2.8M25.7 10.3l2.8-2.8"
          stroke="currentColor" strokeWidth="2.5" opacity="0.6"/>
      </svg>
    ),
  },
];

export default function Homepage() {
  const navigate = useNavigate();
  const { currentUser, can } = useStore();
  const { settings } = useStore();
  const school = settings.school || {};
  const branding = settings.branding || {};
  const features = settings.features || {};
  const logoPath = branding.school_logo_path;
  const logoSrc = logoPath ? `file://${logoPath}` : null;
  const schoolName = school.school_name || 'Your School Name';
  const schoolMotto = school.school_motto || '';

  const firstName = currentUser?.fullName?.split(' ')[0] || 'Admin';

  // Map homepage card id → permission module name
  const MODULE_PERMS = {
    dashboard: 'dashboard', students: 'students', academics: 'academics',
    fees: 'fees', canteen: 'canteen', staff: 'staff', payroll: 'payroll',
    finance: 'finance', inventory: 'finance',
    notifications: 'notifications', settings: 'settings',
  };

  const visibleModules = MODULES.filter(m => {
    if (m.id === 'canteen' && features.feature_canteen_enabled === 'false') return false;
    if (m.id === 'notifications' && features.feature_notifications_enabled === 'false') return false;
    const permKey = MODULE_PERMS[m.id];
    if (permKey && !can(permKey, 'view')) return false;
    return true;
  });

  return (
    <div className="homepage">
      <div className="hp-welcome">
        <h1>Welcome, {firstName}!</h1>
        <p>What would you like to do today?</p>
      </div>

      <div className="hp-grid">
        {visibleModules.map(mod => (
          <button key={mod.id} className="hp-card" onClick={() => navigate(mod.route)}>
            <div className="hp-card-icon">
              {mod.icon}
            </div>
            <div className="hp-card-label">{mod.label}</div>
            <div className="hp-card-sub">{mod.sub}</div>
          </button>
        ))}
      </div>

      <div className="hp-footer">
        © {new Date().getFullYear()} Nickland Edusoft by Nickland Sales. All rights reserved.
      </div>
    </div>
  );
}
