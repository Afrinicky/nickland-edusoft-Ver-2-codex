// Nickland Edusoft — Advanced Feature Toggles
// Schools can disable features they don't use. Toggling OFF hides the
// corresponding tabs/sections across the application.
import React from 'react';
import { useStore } from '../../store/index.js';

export default function Features() {
  const { settings, loadSettings } = useStore();
  const showToast = useStore(s => s.showToast);
  const features = settings.features || {};
  const security = settings.security || {};

  async function toggle(key, currentValue) {
    const next = currentValue === 'true' ? 'false' : 'true';
    await window.api.settings.set(key, next);
    showToast(`${labelize(key)} ${next === 'true' ? 'enabled' : 'disabled'}`, 'success');
    loadSettings();
  }

  return (
    <div className="features-settings">
      <div className="card" style={{ background: 'var(--info-bg)', borderLeft: '3px solid var(--info)' }}>
        <strong>Why toggle features?</strong>
        <div className="text-sm" style={{ marginTop: 6, lineHeight: 1.6 }}>
          Some Ghanaian schools — especially smaller private schools — don't process PAYE tax,
          SSNIT contributions, or formal leave requests. Turning features OFF hides them entirely
          from the interface, giving you a simpler app. You can turn them back on any time.
        </div>
      </div>

      {/* Compliance / Payroll Features */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title">Compliance & Payroll</div>
        <div className="text-sm text-muted" style={{ marginBottom: 14 }}>
          Statutory deductions and remittances aligned with Ghana Revenue Authority (GRA) and SSNIT requirements
        </div>

        <FeatureRow
          label="PAYE Tax Calculation"
          description="Calculate Pay-As-You-Earn income tax on staff salaries using Income Tax Act 896 bands. When OFF, the PAYE tab in Payroll is hidden and salaries are computed without tax deductions."
          enabled={features.feature_paye_enabled === 'true'}
          onToggle={() => toggle('feature_paye_enabled', features.feature_paye_enabled)}
        />

        <FeatureRow
          label="SSNIT Remittance"
          description="Compute SSNIT Tier 1 contributions (5.5% worker + 13% employer). When OFF, the SSNIT schedule tab is hidden and salaries skip SSNIT deductions."
          enabled={features.feature_ssnit_enabled === 'true'}
          onToggle={() => toggle('feature_ssnit_enabled', features.feature_ssnit_enabled)}
        />
      </div>

      {/* HR Features */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title">Human Resources</div>
        <div className="text-sm text-muted" style={{ marginBottom: 14 }}>
          Optional staff management features
        </div>

        <FeatureRow
          label="Leave Management"
          description="Track staff leave requests with mandatory justification and an approval workflow. When OFF, the Leave Management tab is hidden in Staff Management."
          enabled={features.feature_leave_management_enabled === 'true'}
          onToggle={() => toggle('feature_leave_management_enabled', features.feature_leave_management_enabled)}
        />

        <FeatureRow
          label="Staff Software Clock-In"
          description="Allow staff to clock in and out through the application to record daily attendance. When OFF, the Attendance tab shows a disabled state. Hardware clock-in (biometric/RFID) is not yet implemented."
          enabled={security.staff_clockin_enabled === 'true'}
          onToggle={() => toggle('staff_clockin_enabled', security.staff_clockin_enabled)}
        />
      </div>

      {/* Operational Features */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title">Operational Modules</div>
        <div className="text-sm text-muted" style={{ marginBottom: 14 }}>
          Major modules — turn off if your school doesn't use them
        </div>

        <FeatureRow
          label="Canteen Management"
          description="Daily-rate canteen payment tracking, calendar of school days, debtors view. When OFF, the Canteen module is hidden from the sidebar."
          enabled={features.feature_canteen_enabled === 'true'}
          onToggle={() => toggle('feature_canteen_enabled', features.feature_canteen_enabled)}
        />

        <FeatureRow
          label="Notifications & Messaging"
          description="Send SMS, Email, or WhatsApp messages to parents and staff. When OFF, the Notifications module is hidden from the sidebar."
          enabled={features.feature_notifications_enabled === 'true'}
          onToggle={() => toggle('feature_notifications_enabled', features.feature_notifications_enabled)}
        />
      </div>
    </div>
  );
}

function FeatureRow({ label, description, enabled, onToggle }) {
  return (
    <div className="feature-toggle-row">
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
        <div className="text-sm text-muted" style={{ marginTop: 4, lineHeight: 1.5 }}>
          {description}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="text-sm" style={{ color: enabled ? 'var(--success)' : 'var(--muted)', minWidth: 30 }}>
          {enabled ? 'ON' : 'OFF'}
        </span>
        <label className="toggle-switch">
          <input type="checkbox" checked={enabled} onChange={onToggle} />
          <span className="toggle-slider"></span>
        </label>
      </div>
    </div>
  );
}

function labelize(s) {
  return s.replace(/^feature_/, '').replace(/_enabled$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
