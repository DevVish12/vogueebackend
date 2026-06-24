const db = require('../../config/db');
const UserAuthModel = require('../userAuth/userAuth.model');
const PartnerAuthModel = require('../partnerAuth/partnerAuth.model');
const PartnerKycModel = require('../partnerKyc/partnerKyc.model');
const PaymentModel = require('../payment/payment.model');
const CouponModel = require('../coupon/coupon.model');
const ServiceModel = require('../service/service.model');
const CategoryModel = require('../category/category.model');
const ReviewModel = require('../reviews/review.model');
const { onlinePartners } = require('../../../socket/socket');

const completedBookingFilter = `(
  LOWER(COALESCE(p.booking_status, '')) = 'completed'
  OR (
    (
      LOWER(TRIM(COALESCE(p.booking_type, ''))) = 'visit_salon'
      OR LOWER(TRIM(COALESCE(p.service_mode, ''))) = 'visit_salon'
    )
    AND LOWER(COALESCE(p.booking_status, '')) IN ('confirmed', 'completed')
  )
)`;

const toNumber = (value) => Number(value || 0) || 0;

const ensureAllTables = async () => {
  await Promise.all([
    UserAuthModel.ensureTable(),
    PartnerAuthModel.ensureTable(),
    PartnerKycModel.ensureTable(),
    PaymentModel.ensureTable(),
    CouponModel.ensureTables(),
    ServiceModel.ensureTable(),
    CategoryModel.ensureTable(),
    ReviewModel.ensureTable(),
  ]);
};

const querySingleRow = async (sql, params = []) => {
  const [rows] = await db.query(sql, params);
  return (rows && rows[0]) || {};
};

const queryRows = async (sql, params = []) => {
  const [rows] = await db.query(sql, params);
  return Array.isArray(rows) ? rows : [];
};

const fetchDashboardSummary = async () => {
  await ensureAllTables();

  const [
    userStats,
    partnerStats,
    bookingStats,
    paymentStats,
    serviceStats,
    categoryStats,
    couponStats,
    couponUsageStats,
    reviewStats,
    latestBookings,
    latestPartners,
    latestPayouts,
    latestReviews,
  ] = await Promise.all([
    querySingleRow(`
      SELECT
        COUNT(*) AS total_users,
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(status, '')) = 'active' THEN 1 ELSE 0 END), 0) AS active_users,
        COALESCE(SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END), 0) AS new_users_today
      FROM users
    `),
    querySingleRow(`
      SELECT
        COUNT(*) AS total_partners,
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(kyc_status, '')) = 'verified' THEN 1 ELSE 0 END), 0) AS verified_partners,
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(kyc_status, '')) = 'pending' THEN 1 ELSE 0 END), 0) AS pending_kyc
      FROM partners
    `),
    querySingleRow(`
      SELECT
        COUNT(*) AS total_bookings,
        COALESCE(SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END), 0) AS today_bookings,
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(booking_status, '')) = 'completed' THEN 1 ELSE 0 END), 0) AS completed_bookings,
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(booking_status, '')) IN ('cancelled', 'canceled') THEN 1 ELSE 0 END), 0) AS cancelled_bookings,
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(booking_status, '')) = 'searching' THEN 1 ELSE 0 END), 0) AS searching_bookings,
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(booking_status, '')) IN ('pending', 'confirmed', 'accepted', 'searching', 'no_partner', 'arrived', 'reached', 'in_service', 'service_started') THEN 1 ELSE 0 END), 0) AS live_bookings
      FROM payments
    `),
    querySingleRow(`
      SELECT
        COALESCE(SUM(COALESCE(final_amount_after_discount, amount, 0)), 0) AS gross_revenue,
        COALESCE(SUM(CASE WHEN DATE(created_at) = CURDATE() THEN COALESCE(final_amount_after_discount, amount, 0) ELSE 0 END), 0) AS today_revenue,
        COALESCE(SUM(COALESCE(coupon_discount, 0)), 0) AS coupon_discount_total,
        COALESCE(SUM(COALESCE(admin_commission_amount, 0)), 0) AS platform_commission_total,
        COALESCE(SUM(CASE WHEN ${completedBookingFilter} THEN COALESCE(partner_final_amount, amount, 0) ELSE 0 END), 0) AS partner_payout_total,
        COALESCE(SUM(CASE WHEN COALESCE(partner_payment_status, 'pending') = 'pending' AND ${completedBookingFilter} THEN COALESCE(partner_final_amount, amount, 0) ELSE 0 END), 0) AS pending_payout_total
      FROM payments p
      WHERE COALESCE(payment_status, 'PAID') = 'PAID'
    `),
    querySingleRow(`
      SELECT
        COUNT(*) AS total_services,
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(status, '')) = 'active' THEN 1 ELSE 0 END), 0) AS active_services
      FROM services
    `),
    querySingleRow('SELECT COUNT(*) AS total_categories FROM categories'),
    querySingleRow(`
      SELECT
        COUNT(*) AS total_coupons,
        COALESCE(SUM(CASE WHEN is_active = 1 AND (expiry_date IS NULL OR expiry_date >= NOW()) THEN 1 ELSE 0 END), 0) AS active_coupons
      FROM coupons
    `),
    querySingleRow('SELECT COUNT(*) AS coupon_usage_count, COALESCE(SUM(COALESCE(discount_amount, 0)), 0) AS coupon_discount_given FROM coupon_usages'),
    querySingleRow(`
      SELECT
        COUNT(*) AS total_reviews,
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(status, '')) = 'approved' THEN 1 ELSE 0 END), 0) AS approved_reviews,
        COALESCE(ROUND(AVG(CASE WHEN LOWER(COALESCE(status, '')) = 'approved' THEN rating END), 1), 0) AS average_rating
      FROM reviews
    `),
    queryRows(`
      SELECT
        p.id,
        p.booking_id,
        p.service_name,
        p.booking_status,
        p.amount,
        p.final_amount_after_discount,
        p.partner_id,
        COALESCE(u.name, CONCAT('User #', p.user_id)) AS user_name,
        COALESCE(pk.full_name, pr.name, CONCAT('Partner #', p.partner_id)) AS partner_name,
        p.created_at
      FROM payments p
      LEFT JOIN users u ON u.id = p.user_id
      LEFT JOIN partners pr ON pr.id = p.partner_id
      LEFT JOIN partner_kyc pk ON pk.partner_id = p.partner_id
      ORDER BY p.created_at DESC
      LIMIT 5
    `),
    queryRows(`
      SELECT
        p.id,
        COALESCE(NULLIF(p.name, ''), NULLIF(pk.full_name, ''), NULLIF(pk.salon_name, ''), CONCAT('Partner #', p.id)) AS name,
        p.mobile,
        p.kyc_status,
        p.status,
        p.created_at
      FROM partners p
      LEFT JOIN partner_kyc pk ON pk.partner_id = p.id
      ORDER BY p.created_at DESC
      LIMIT 5
    `),
    queryRows(`
      SELECT
        p.id AS payment_id,
        p.booking_id,
        p.partner_id,
        COALESCE(pk.full_name, pr.name, CONCAT('Partner #', p.partner_id)) AS partner_name,
        COALESCE(p.partner_final_amount, p.amount, 0) AS amount,
        p.partner_payment_status,
        p.paid_at,
        p.created_at
      FROM payments p
      LEFT JOIN partners pr ON pr.id = p.partner_id
      LEFT JOIN partner_kyc pk ON pk.partner_id = p.partner_id
      WHERE p.partner_id IS NOT NULL
        AND COALESCE(p.partner_payment_status, 'pending') = 'paid'
      ORDER BY COALESCE(p.paid_at, p.created_at) DESC
      LIMIT 5
    `),
    queryRows(`
      SELECT
        r.id,
        r.booking_id,
        COALESCE(NULLIF(r.user_name, ''), u.name, CONCAT('User #', r.user_id)) AS user_name,
        COALESCE(NULLIF(r.partner_name, ''), pk.full_name, pr.name, CONCAT('Partner #', r.partner_id)) AS partner_name,
        r.service_name,
        r.rating,
        r.status,
        r.created_at
      FROM reviews r
      LEFT JOIN users u ON u.id = r.user_id
      LEFT JOIN partners pr ON pr.id = r.partner_id
      LEFT JOIN partner_kyc pk ON pk.partner_id = r.partner_id
      ORDER BY r.created_at DESC
      LIMIT 5
    `),
  ]);

  console.log('[ADMIN DASHBOARD SUMMARY]', {
    latestBookings: latestBookings?.length || 0,
    latestPartners: latestPartners?.length || 0,
    latestPayouts: latestPayouts?.length || 0,
    latestReviews: latestReviews?.length || 0,
  });

  return {
    users: {
      total_users: toNumber(userStats.total_users),
      active_users: toNumber(userStats.active_users),
      new_users_today: toNumber(userStats.new_users_today),
    },
    partners: {
      total_partners: toNumber(partnerStats.total_partners),
      verified_partners: toNumber(partnerStats.verified_partners),
      pending_kyc: toNumber(partnerStats.pending_kyc),
      online_partners: onlinePartners.size,
    },
    bookings: {
      total_bookings: toNumber(bookingStats.total_bookings),
      today_bookings: toNumber(bookingStats.today_bookings),
      completed_bookings: toNumber(bookingStats.completed_bookings),
      cancelled_bookings: toNumber(bookingStats.cancelled_bookings),
      searching_bookings: toNumber(bookingStats.searching_bookings),
      live_bookings: toNumber(bookingStats.live_bookings),
    },
    payments: {
      gross_revenue: toNumber(paymentStats.gross_revenue),
      today_revenue: toNumber(paymentStats.today_revenue),
      coupon_discount_total: toNumber(paymentStats.coupon_discount_total),
      platform_commission_total: toNumber(paymentStats.platform_commission_total),
      partner_payout_total: toNumber(paymentStats.partner_payout_total),
      pending_payout_total: toNumber(paymentStats.pending_payout_total),
    },
    services: {
      total_services: toNumber(serviceStats.total_services),
      active_services: toNumber(serviceStats.active_services),
      total_categories: toNumber(categoryStats.total_categories),
    },
    coupons: {
      total_coupons: toNumber(couponStats.total_coupons),
      active_coupons: toNumber(couponStats.active_coupons),
      coupon_usage_count: toNumber(couponUsageStats.coupon_usage_count),
      coupon_discount_given: toNumber(couponUsageStats.coupon_discount_given),
    },
    reviews: {
      total_reviews: toNumber(reviewStats.total_reviews),
      approved_reviews: toNumber(reviewStats.approved_reviews),
      average_rating: Number(reviewStats.average_rating || 0),
    },
    latest_bookings: latestBookings || [],
    latest_partners: latestPartners || [],
    latest_payouts: latestPayouts || [],
    latest_reviews: latestReviews || [],
    recent_activity: {
      latest_bookings: latestBookings || [],
      latest_partners: latestPartners || [],
      latest_payouts: latestPayouts || [],
      latest_reviews: latestReviews || [],
    },
    generated_at: new Date().toISOString(),
  };
};

module.exports = {
  fetchDashboardSummary,
};