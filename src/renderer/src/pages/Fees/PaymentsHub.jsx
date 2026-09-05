// Nickland Edusoft — Taking money in.
//
// The counter, in the three shapes a school actually collects money in:
//
//   Take a payment   one parent at the counter, any purpose, receipt on screen
//   Bulk sheet       a class at a time on collection day
//   Mobile payments  money sent in, waiting to be confirmed
//   Register         everything taken, to balance the drawer against
//
// This tab used to hold only the bulk sheet and the mobile queue — there was
// no way to take ONE payment from the desktop at all, which is the commonest
// thing that happens at a school counter.
import React, { useState } from 'react';
import TakePaymentTab from './TakePaymentTab.jsx';
import BulkPaySheet from './BulkPaySheet.jsx';
import MobilePaymentsTab from './MobilePaymentsTab.jsx';
import PaymentRegisterTab from './PaymentRegisterTab.jsx';

export default function PaymentsHub({ pending = 0, initialTab }) {
  const [sub, setSub] = useState(initialTab || 'single');

  const SUBS = [
    { id: 'single', label: 'Take a Payment' },
    { id: 'sheet', label: 'Bulk Payment Sheet' },
    { id: 'mobile', label: 'Mobile Payments', badge: pending },
    { id: 'register', label: 'Payment Register' },
  ];

  return (
    <div>
      <div className="sub-tabs">
        {SUBS.map(s => (
          <button key={s.id} className={'sub-tab' + (sub === s.id ? ' active' : '')}
            onClick={() => setSub(s.id)}>
            {s.label}
            {s.badge > 0 && <span className="topbar-badge" style={{ marginLeft: 6 }}>{s.badge}</span>}
          </button>
        ))}
      </div>

      {sub === 'single' && <TakePaymentTab />}
      {sub === 'sheet' && <BulkPaySheet />}
      {sub === 'mobile' && <MobilePaymentsTab />}
      {sub === 'register' && <PaymentRegisterTab />}
    </div>
  );
}
