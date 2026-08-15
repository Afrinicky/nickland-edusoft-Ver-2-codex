// Nickland Edusoft — Taking money in.
//
// The two ways a school receives fees sit side by side: the desk collecting
// cash down a class list, and mobile-money payments waiting to be confirmed.
// They were separate top-level tabs, which meant the pending-payment badge was
// easy to walk past.
import React, { useState } from 'react';
import BulkPaySheet from './BulkPaySheet.jsx';
import MobilePaymentsTab from './MobilePaymentsTab.jsx';

export default function PaymentsHub({ pending = 0 }) {
  const [sub, setSub] = useState('sheet');

  return (
    <div>
      <div className="sub-tabs">
        <button className={'sub-tab' + (sub === 'sheet' ? ' active' : '')}
          onClick={() => setSub('sheet')}>Bulk Payment Sheet</button>
        <button className={'sub-tab' + (sub === 'mobile' ? ' active' : '')}
          onClick={() => setSub('mobile')}>
          Mobile Payments
          {pending > 0 && <span className="topbar-badge" style={{ marginLeft: 6 }}>{pending}</span>}
        </button>
      </div>

      {sub === 'sheet' && <BulkPaySheet />}
      {sub === 'mobile' && <MobilePaymentsTab />}
    </div>
  );
}
