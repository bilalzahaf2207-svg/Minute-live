'use strict';
/** Mode de paiement actif : 'stripe' | 'demo' | 'none'. */
const config = require('./config');
const store = require('./store');
const stripe = require('./stripe');

function paymentMode() {
  if (stripe.enabled()) return 'stripe';
  const demo = store.get('settings').payments?.demoMode !== false;
  // En production, la démonstration exige un accord explicite (ALLOW_DEMO_PAYMENTS=1).
  if (demo && (!config.isProd || process.env.ALLOW_DEMO_PAYMENTS === '1')) return 'demo';
  return 'none';
}
module.exports = { paymentMode };
