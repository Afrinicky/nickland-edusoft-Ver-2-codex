// Nickland Edusoft — Payment gateway registry
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Returns the gateway adapter a school has configured, chosen by the
// `payment_gateway` setting. Four are built in, matching the four the cloud
// offers (`cloud-python/app/gateways/`) so that a school picks the same
// provider whether it set up online payments on its own desktop or in the
// cloud portal — and so that a school which moves from one to the other does
// not have to change provider to do it.
//
// Adding a fifth is one file implementing the same seven methods.

const { getSetting } = require('../../utils/idgen');
const paystack = require('./paystack');
const flutterwave = require('./flutterwave');
const hubtel = require('./hubtel');
const expresspay = require('./expresspay');

const ADAPTERS = { paystack, flutterwave, hubtel, expresspay };

function getGateway(db) {
  const id = getSetting(db, 'payment_gateway', 'none');
  if (id === 'none' || !ADAPTERS[id]) return null;
  return ADAPTERS[id];
}

function gatewayEnabled(db) {
  const g = getGateway(db);
  return !!(g && g.isConfigured(db));
}

// Whether this gateway's callbacks carry anything worth checking. Paystack and
// Flutterwave sign; Hubtel and ExpressPay do not, and a delivery from one of
// those is a hint to go and ask, never a verdict (see payments_api).
function signsCallbacks(gateway) {
  return gateway ? gateway.signedCallbacks !== false : false;
}

module.exports = { getGateway, gatewayEnabled, signsCallbacks, ADAPTERS };
