// Central Socket.IO event names (server-side)
// Keep these stable to avoid breaking existing realtime flows.

module.exports = Object.freeze({
  // Commission
  COMMISSION_UPDATED: 'COMMISSION_UPDATED',

  // Payouts
  PAYOUT_UPDATED: 'PAYOUT_UPDATED',
  PAYOUT_HISTORY_UPDATED: 'PAYOUT_HISTORY_UPDATED',

  // Partner dashboard/earnings
  PARTNER_EARNINGS_UPDATED: 'PARTNER_EARNINGS_UPDATED',
  PARTNER_PAYMENT_STATUS_UPDATED: 'PARTNER_PAYMENT_STATUS_UPDATED',

  // Admin analytics/cards
  ADMIN_ANALYTICS_UPDATED: 'ADMIN_ANALYTICS_UPDATED',
});
