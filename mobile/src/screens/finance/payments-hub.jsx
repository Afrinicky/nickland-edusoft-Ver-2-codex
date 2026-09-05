// Nickland Edusoft — Taking money in.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The counter, in the shapes a school actually collects money in — the same
// four sections, in the same order, as the installed application:
//
//   Take a payment   one parent at the counter, any purpose, receipt on screen
//   Bulk sheet       a class at a time on collection day
//   Mobile payments  money sent in, waiting to be confirmed
//   Register         everything taken, to balance the drawer against

import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '../../auth';
import { api } from '../../api';
import { useSubTab } from '../../appshell';
import { SubTabStrip } from '../../desk';
import TakePayment from './take-payment';
import BulkPaySheet from './bulk-sheet';
import OnlinePayments from './online';
import PaymentRegister from './register';

export default function PaymentsHub() {
  const { token, profile } = useAuth();
  const [pending, setPending] = useState(0);

  // The count on the Mobile Payments pill. Money a parent has sent that nobody
  // has confirmed is the one thing on this screen with a clock running on it.
  useEffect(() => {
    let live = true;
    const read = () => api.onlinePayments(token, 'pending')
      .then(r => { if (live) setPending((r.intents || r.payments || []).length); })
      .catch(() => {});
    read();
    const id = setInterval(read, 30000);
    return () => { live = false; clearInterval(id); };
  }, [token]);

  // Which sections this account may open is decided in src/modules.js, with
  // the rest of the app's shape — not here.
  const { subs, sub, setSub } = useSubTab('fees', 'payments', 'single');
  const strip = subs.map(s => (s.id === 'mobile' ? { ...s, badge: pending } : s));

  return (
    <View style={{ width: '100%' }}>
      <SubTabStrip tabs={strip} value={sub} onChange={setSub} />
      {sub === 'single' && <TakePayment />}
      {sub === 'sheet' && <BulkPaySheet />}
      {sub === 'mobile' && <OnlinePayments />}
      {sub === 'register' && <PaymentRegister />}
    </View>
  );
}
