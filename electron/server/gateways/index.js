// Nickland Edusoft — Payment gateway registry
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Returns the gateway adapter a school has configured. Paystack is the default;
// other providers (Flutterwave, Hubtel, …) can be added as adapters with the
// same interface and selected per school via the `payment_gateway` setting.

const { getSetting } = require('../../utils/idgen');
const paystack = require('./paystack');

const ADAPTERS = { paystack };

function getGateway(db) {
  const id = getSetting(db, 'payment_gateway', 'none');
  if (id === 'none' || !ADAPTERS[id]) return null;
  return ADAPTERS[id];
}

function gatewayEnabled(db) {
  const g = getGateway(db);
  return !!(g && g.isConfigured(db));
}

module.exports = { getGateway, gatewayEnabled, ADAPTERS };
