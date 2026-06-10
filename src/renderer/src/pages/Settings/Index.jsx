// Nickland Edusoft — Settings module with grouped navigation
import React from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import SchoolIdentity from './SchoolIdentity.jsx';
import Branding from './Branding.jsx';
import Classes from './Classes.jsx';
import Terms from './Terms.jsx';
import Subjects from './Subjects.jsx';
import Grading from './Grading.jsx';
import Canteen from './Canteen.jsx';
import NotificationsConfig from './NotificationsConfig.jsx';
import Payroll from './Payroll.jsx';
import Signatures from './Signatures.jsx';
import Features from './Features.jsx';
import MobileApp from './MobileApp.jsx';
import ReceiptTemplates from './ReceiptTemplates.jsx';
import Users from './Users.jsx';
import Backup from './Backup.jsx';

// Settings grouped into logical sections
const SECTIONS = [
  {
    title: 'School',
    items: [
      { to: 'school',     label: 'School Identity',   icon: '🏫' },
      { to: 'branding',   label: 'Appearance',        icon: '🎨' },
      { to: 'signatures', label: 'Signatures',        icon: '✍️' },
    ],
  },
  {
    title: 'Academic',
    items: [
      { to: 'classes',    label: 'Classes',           icon: '🎓' },
      { to: 'terms',      label: 'Terms',             icon: '📆' },
      { to: 'subjects',   label: 'Subjects',          icon: '📚' },
      { to: 'grading',    label: 'Grading',           icon: '📊' },
    ],
  },
  {
    title: 'Finance & Operations',
    items: [
      { to: 'canteen',    label: 'Canteen',           icon: '🍱' },
      { to: 'payroll',    label: 'Payroll',           icon: '💼' },
      { to: 'receipts',   label: 'Receipt Templates', icon: '🧾' },
    ],
  },
  {
    title: 'Communications',
    items: [
      { to: 'notifications', label: 'Notifications',  icon: '📨' },
    ],
  },
  {
    title: 'Users & Access',
    items: [
      { to: 'users',      label: 'Users & Logins',    icon: '👥' },
      { to: 'features',   label: 'Advanced Features', icon: '⚙️' },
    ],
  },
  {
    title: 'System',
    items: [
      { to: 'mobile',     label: 'Mobile App',        icon: '📱' },
      { to: 'backup',     label: 'Backup',            icon: '💾' },
    ],
  },
];

export default function SettingsIndex() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-subtitle">Configure the system for your school</div>
        </div>
      </div>
      <div className="settings-layout">
        <aside className="settings-sidebar">
          {SECTIONS.map((section, si) => (
            <div key={si} className="settings-section">
              <div className="settings-section-title">{section.title}</div>
              {section.items.map(t => (
                <NavLink key={t.to} to={t.to}
                  className={({ isActive }) => 'settings-nav-item' + (isActive ? ' active' : '')}>
                  <span className="settings-nav-icon">{t.icon}</span>
                  <span className="settings-nav-label">{t.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </aside>
        <div className="settings-content">
          <Routes>
            <Route index element={<Navigate to="school" replace />} />
            <Route path="school" element={<SchoolIdentity />} />
            <Route path="branding" element={<Branding />} />
            <Route path="signatures" element={<Signatures />} />
            <Route path="receipts" element={<ReceiptTemplates />} />
            <Route path="features" element={<Features />} />
            <Route path="mobile" element={<MobileApp />} />
            <Route path="classes" element={<Classes />} />
            <Route path="terms" element={<Terms />} />
            <Route path="subjects" element={<Subjects />} />
            <Route path="grading" element={<Grading />} />
            <Route path="canteen" element={<Canteen />} />
            <Route path="notifications" element={<NotificationsConfig />} />
            <Route path="payroll" element={<Payroll />} />
            <Route path="users" element={<Users />} />
            <Route path="backup" element={<Backup />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
