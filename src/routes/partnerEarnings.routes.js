const express = require('express');
const router = express.Router();

const db = require('../config/db');
const { partnerProtect } = require('../middlewares/auth.middleware');
const { successResponse } = require('../utils/response');
const PaymentModel = require('../modules/payment/payment.model');

const toAmount = (value) => {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
};

const getFinalPaidAmount = (row) => toAmount(row?.final_amount_after_discount ?? row?.original_amount ?? row?.gross_amount ?? row?.amount);
const getOriginalAmount = (row) => toAmount(row?.original_amount ?? row?.gross_amount ?? row?.final_amount_after_discount ?? row?.amount);

router.get('/salon-earnings', partnerProtect, async (req, res, next) => {
  try {
    await PaymentModel.ensureTable();
    const partnerId = Number(req.partner?.id);
    if (!Number.isFinite(partnerId)) {
      return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
    }

    const [rows] = await db.query(
      `
      SELECT
        p.id AS payment_id,
        p.booking_id,
        p.service_name,
        COALESCE(p.partner_final_amount, p.amount) AS amount,
        COALESCE(p.gross_amount, p.amount) AS gross_amount,
        p.original_amount,
        p.coupon_discount,
        p.final_amount_after_discount,
        COALESCE(p.admin_commission_amount, 0) AS admin_commission_amount,
        p.commission_breakdown,
        u.name AS customer_name,
        u.mobile AS customer_phone,
        COALESCE(NULLIF(TRIM(p.booking_type), ''), NULLIF(TRIM(p.service_mode), ''), 'home') AS booking_type,
        CASE
          WHEN COALESCE(NULLIF(TRIM(p.booking_type), ''), NULLIF(TRIM(p.service_mode), '')) IN ('salon', 'visit_salon') THEN 'salon'
          ELSE 'home'
        END AS normalized_booking_type,
        p.slot_date,
        p.slot_time,
        p.payout_id,
        p.payout_status,
        COALESCE(p.partner_payment_status, 'pending') AS partner_payment_status,
        p.utr_number,
        p.paid_at,
        p.salon_name,
        p.salon_address,
        p.booking_status,
        p.created_at
      FROM payments p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.partner_id = ?
        AND COALESCE(p.payment_status, 'PAID') = 'PAID'
        AND (
          COALESCE(NULLIF(TRIM(p.booking_type), ''), NULLIF(TRIM(p.service_mode), '')) IN ('salon', 'visit_salon')
        )
      ORDER BY p.created_at DESC, p.id DESC
      `,
      [partnerId]
    );

    const services = (rows || []).map((row) => ({
      payment_id: row?.payment_id || null,
      booking_id: row?.booking_id || null,
      service_name: row?.service_name || 'Service',
      customer_name: row?.customer_name || null,
      customer_phone: row?.customer_phone || null,
      amount: toAmount(row?.amount),
      partner_final_amount: toAmount(row?.amount),
      gross_amount: toAmount(row?.gross_amount),
      original_amount: getOriginalAmount(row),
      coupon_discount: toAmount(row?.coupon_discount),
      final_amount_after_discount: getFinalPaidAmount(row),
      admin_commission_amount: toAmount(row?.admin_commission_amount),
      commission_breakdown: row?.commission_breakdown || null,
      booking_type: row?.booking_type || null,
      normalized_booking_type: row?.normalized_booking_type || 'home',
      slot_date: row?.slot_date || null,
      slot_time: row?.slot_time || null,
      payout_status: row?.payout_status || null,
      payout_id: row?.payout_id || null,
      partner_payment_status: row?.partner_payment_status || 'pending',
      utr_number: row?.utr_number || null,
      paid_at: row?.paid_at || null,
      salon_name: row?.salon_name || null,
      salon_address: row?.salon_address || null,
      booking_status: row?.booking_status || null,
      created_at: row?.created_at || null,
    }));

    const summary = services.reduce(
      (acc, row) => {
        const amount = toAmount(row?.amount);
        const gross = getFinalPaidAmount(row);
        const commission = toAmount(row?.admin_commission_amount);
        const completed = String(row?.booking_status || '').toLowerCase() === 'completed';
        const paid = String(row?.partner_payment_status || '').toLowerCase() === 'paid';

        acc.total_services += 1;
        if (completed) acc.completed_services += 1;

        // Earnings truth: rely on partner_payment_status (paid vs unpaid)
        acc.total_customer_paid += gross;
        acc.total_admin_commission += commission;
        acc.total_partner_earned += amount;

        // Backward-compatible keys
        acc.total_earned += amount;
        if (paid) acc.total_paid += amount;
        else acc.remaining_amount += amount;

        return acc;
      },
      {
        total_services: 0,
        completed_services: 0,
        total_customer_paid: 0,
        total_admin_commission: 0,
        total_partner_earned: 0,
        total_earned: 0,
        total_paid: 0,
        remaining_amount: 0,
      }
    );

    return successResponse(res, 200, 'Salon earnings fetched', {
      summary,
      services,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/home-earnings', partnerProtect, async (req, res, next) => {
  try {
    await PaymentModel.ensureTable();
    const partnerId = Number(req.partner?.id);
    if (!Number.isFinite(partnerId)) {
      return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
    }

    const [rows] = await db.query(
      `
      SELECT
        p.id AS payment_id,
        p.booking_id,
        p.service_name,
        COALESCE(p.partner_final_amount, p.amount) AS amount,
        COALESCE(p.gross_amount, p.amount) AS gross_amount,
        p.original_amount,
        p.coupon_discount,
        p.final_amount_after_discount,
        COALESCE(p.admin_commission_amount, 0) AS admin_commission_amount,
        p.commission_breakdown,
        u.name AS customer_name,
        u.mobile AS customer_phone,
        COALESCE(p.payment_status, 'PAID') AS payment_status,
        p.booking_status,
        COALESCE(p.partner_payment_status, 'pending') AS partner_payment_status,
        p.slot_date,
        p.slot_time,
        p.address,
        COALESCE(NULLIF(TRIM(p.booking_type), ''), NULLIF(TRIM(p.service_mode), ''), 'home') AS booking_type,
        CASE
          WHEN COALESCE(NULLIF(TRIM(p.booking_type), ''), NULLIF(TRIM(p.service_mode), '')) IN ('salon', 'visit_salon') THEN 'salon'
          ELSE 'home'
        END AS normalized_booking_type,
        p.payout_id,
        p.payout_status,
        p.utr_number,
        p.paid_at
      FROM payments p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.partner_id = ?
        AND COALESCE(p.payment_status, 'PAID') = 'PAID'
        AND COALESCE(NULLIF(TRIM(p.booking_type), ''), NULLIF(TRIM(p.service_mode), ''), 'home') IN ('home','at_home','instant')
      ORDER BY p.id DESC
      `,
      [partnerId]
    );

    const services = (rows || []).map((row) => ({
      payment_id: row?.payment_id || null,
      booking_id: row?.booking_id || null,
      service_name: row?.service_name || 'Service',
      customer_name: row?.customer_name || null,
      customer_phone: row?.customer_phone || null,
      amount: toAmount(row?.amount),
      partner_final_amount: toAmount(row?.amount),
      gross_amount: toAmount(row?.gross_amount),
      original_amount: getOriginalAmount(row),
      coupon_discount: toAmount(row?.coupon_discount),
      final_amount_after_discount: getFinalPaidAmount(row),
      admin_commission_amount: toAmount(row?.admin_commission_amount),
      commission_breakdown: row?.commission_breakdown || null,
      booking_status: row?.booking_status || null,
      payment_status: row?.payment_status || null,
      partner_payment_status: row?.partner_payment_status || 'pending',
      slot_date: row?.slot_date || null,
      slot_time: row?.slot_time || null,
      address: row?.address || null,
      booking_type: row?.booking_type || null,
      normalized_booking_type: row?.normalized_booking_type || 'home',
      payout_id: row?.payout_id || null,
      payout_status: row?.payout_status || null,
      utr_number: row?.utr_number || null,
      paid_at: row?.paid_at || null,
    }));

    const summary = services.reduce(
      (acc, row) => {
        const amount = toAmount(row?.amount);
        const gross = getFinalPaidAmount(row);
        const commission = toAmount(row?.admin_commission_amount);
        const completed = String(row?.booking_status || '').toLowerCase() === 'completed';
        const paid = String(row?.partner_payment_status || '').toLowerCase() === 'paid';

        acc.total_services += 1;

        if (completed) acc.completed_services += 1;

        // Earnings truth: rely on partner_payment_status (paid vs unpaid)
        acc.total_customer_paid += gross;
        acc.total_admin_commission += commission;
        acc.total_partner_earned += amount;

        // Backward-compatible keys
        acc.total_earned += amount;
        if (paid) acc.total_paid += amount;
        else acc.remaining_amount += amount;

        return acc;
      },
      {
        total_services: 0,
        completed_services: 0,
        total_customer_paid: 0,
        total_admin_commission: 0,
        total_partner_earned: 0,
        total_earned: 0,
        total_paid: 0,
        remaining_amount: 0,
      }
    );

    return successResponse(res, 200, 'Home earnings fetched', {
      summary,
      services,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
