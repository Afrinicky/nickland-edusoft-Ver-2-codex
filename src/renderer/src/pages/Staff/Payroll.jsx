// Nickland Edusoft — Payroll Module (tabbed, GRA + SSNIT aligned)
import React, { useState } from 'react';
import { useStore } from '../../store/index.js';
import PayrollRunTab from './PayrollRunTab.jsx';
import PayrollLegacy from './PayrollLegacy.jsx';
import SSNITScheduleTab from './SSNITScheduleTab.jsx';
import PAYEScheduleTab from './PAYEScheduleTab.jsx';

export default function Payroll() {
  const { settings } = useStore();
  const features = settings.features || {};
  const ssnitOn = features.feature_ssnit_enabled !== 'false';
  const payeOn = features.feature_paye_enabled !== 'false';

  const ALL_TABS = [
    { id: 'run',      label: 'Monthly Payroll', show: true },
    { id: 'entries',  label: 'Individual Entries', show: true },
    { id: 'ssnit',    label: 'SSNIT Schedule', show: ssnitOn },
    { id: 'paye',     label: 'PAYE Remittance', show: payeOn },
  ];
  const TABS = ALL_TABS.filter(t => t.show);

  const [tab, setTab] = useState('run');

  return (
    <div className="payroll-module">
      <div className="page-header">
        <div>
          <div className="page-title">Payroll</div>
          <div className="page-subtitle">Salaries, SSNIT contributions, PAYE remittance, payslips</div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={'tab' + (tab === t.id ? ' active' : '')}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {tab === 'run'     && <PayrollRunTab />}
        {tab === 'entries' && <PayrollLegacy />}
        {tab === 'ssnit' && ssnitOn && <SSNITScheduleTab />}
        {tab === 'paye'  && payeOn && <PAYEScheduleTab />}
      </div>
    </div>
  );
}
