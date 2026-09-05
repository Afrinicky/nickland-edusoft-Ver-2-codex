// Nickland Edusoft — Bills.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Everything the school charges for, arranged as the installed application
// arranges it:
//
//   Home           what has been billed, and who has not paid
//   School fees    the term's fee — built, raised, amended, printed
//   Canteen        the term's feeding days, and the bill they imply
//   Books          the year's textbooks
//   Extra charges  what came up mid-term
//   Withdrawn      what was taken off the books, and why
//
// Debtors is gone as a tab of its own: "who owes" is the second half of "what
// have we billed", and it belongs under the totals that raise the question.

import React from 'react';
import { View } from 'react-native';
import { useSubTab } from '../../appshell';
import { SubTabStrip } from '../../desk';
import BillsHome from './bills-home';
import SchoolFees from './school-fees';
import CanteenBills from './canteen-bills';
import BooksBills from './books-bills';
import { Supplementary, VoidedBills } from '../mod/fees';

export default function BillsHub() {
  // Which sections this account may open — and which the school has switched
  // on — is decided in src/modules.js, with the rest of the app's shape.
  const { subs, sub, setSub } = useSubTab('fees', 'bills', 'home');

  return (
    <View style={{ width: '100%' }}>
      <SubTabStrip tabs={subs} value={sub} onChange={setSub} />
      {sub === 'home' && <BillsHome onOpen={setSub} />}
      {sub === 'schoolfees' && <SchoolFees />}
      {sub === 'canteen' && <CanteenBills />}
      {sub === 'books' && <BooksBills />}
      {sub === 'extras' && <Supplementary />}
      {sub === 'voided' && <VoidedBills />}
    </View>
  );
}
