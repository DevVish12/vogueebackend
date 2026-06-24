const express = require('express');
const router = express.Router();

const db = require('../config/db');
const { adminProtect } = require('../middlewares/auth.middleware');
const sendPayout = require('../utils/sendPayout');
const PaymentModel = require('../modules/payment/payment.model');
const { getIO } = require('../../socket/socket');
const SOCKET_EVENTS = require('../../server/constants/socketEvents');

const toInt = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
};

const normalizeIdList = (value) => {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => toInt(item))
    .filter((item) => item !== null);
};

const normalizeBookingType = (row) => {
  const raw = String(
    row?.booking_type ||
    row?.service_mode ||
    ''
  ).toLowerCase();

  if (
    raw === 'visit_salon' ||
    raw === 'salon'
  ) {
    return 'salon';
  }

  return 'home';
};

const getFinalPaidAmount = (row) => Number(row?.final_amount_after_discount ?? row?.amount ?? row?.gross_amount ?? 0);
const getOriginalAmount = (row) => Number(row?.original_amount ?? row?.gross_amount ?? row?.amount ?? 0);
const getCouponDiscount = (row) => Number(row?.coupon_discount ?? 0);

router.get('/payouts', adminProtect, async (req, res, next) => {
  try {
    await PaymentModel.ensureTable();
    // Group pending partner payouts by partner.
    // Only include completed services; never pay booking-by-booking.
    const [rows] = await db.query(
      `
      SELECT
        p.partner_id,
        COALESCE(pk.full_name, pr.name, CONCAT('Partner #', p.partner_id)) AS partner_name,
        pr.upi_id,
        SUM(COALESCE(p.partner_final_amount, p.amount)) AS total_amount,
        COUNT(*) AS total_bookings
      FROM payments p
      LEFT JOIN partners pr ON pr.id = p.partner_id
      LEFT JOIN partner_kyc pk ON pk.partner_id = p.partner_id
      WHERE p.booking_status = 'completed'
        AND COALESCE(p.payment_status, 'PAID') = 'PAID'
        AND p.partner_id IS NOT NULL
        AND COALESCE(p.partner_payment_status, 'pending') = 'pending'
      GROUP BY p.partner_id, partner_name, pr.upi_id
      ORDER BY total_amount DESC
      `
    );

    return res.json({ payouts: rows || [] });
  } catch (error) {
    return next(error);
  }
});

router.get('/completed-services', adminProtect, async (req, res, next) => {
  try {
    await PaymentModel.ensureTable();
    const [rows] = await db.query(
      `
      SELECT
        p.id AS payment_id,
        p.booking_id,
        p.partner_id,
        COALESCE(pk.full_name, pr.name, CONCAT('Partner #', p.partner_id)) AS partner_name,
        pk.full_name AS salon_owner_name,
        pr.mobile AS partner_phone,
        pr.upi_id AS partner_upi,
        COALESCE(NULLIF(TRIM(p.booking_type), ''), NULLIF(TRIM(p.service_mode), ''), 'home') AS booking_type,
        p.service_mode,
        p.salon_id,
        p.salon_name,
        p.salon_address,
        p.service_name,
        COALESCE(p.partner_final_amount, p.amount) AS amount,
        COALESCE(p.gross_amount, p.amount) AS gross_amount,
        p.original_amount,
        p.coupon_discount,
        p.final_amount_after_discount,
        COALESCE(p.admin_commission_amount, 0) AS admin_commission_amount,
        p.partner_final_amount,
        p.commission_breakdown,
        p.slot_date,
        p.slot_time,
        p.address,
        u.name AS customer_name,
        u.mobile AS customer_phone,
        p.booking_status,
        COALESCE(p.payment_status, 'PAID') AS payment_status,
        COALESCE(p.partner_payment_status, 'pending') AS partner_payment_status,
        p.transaction_id,
        p.created_at
      FROM payments p
      LEFT JOIN partners pr ON pr.id = p.partner_id
      LEFT JOIN partner_kyc pk ON pk.partner_id = p.partner_id
      LEFT JOIN users u ON u.id = p.user_id
      WHERE COALESCE(p.payment_status, 'PAID') = 'PAID'
        AND p.partner_id IS NOT NULL
        AND COALESCE(p.partner_payment_status, 'pending') = 'pending'
        AND (
          p.booking_status = 'completed'
          OR (
            (
              TRIM(COALESCE(p.booking_type, '')) = 'visit_salon'
              OR TRIM(COALESCE(p.service_mode, '')) = 'visit_salon'
            )
            AND p.booking_status IN ('confirmed','completed')
          )
        )
      ORDER BY p.created_at DESC
      `
    );

    const grouped = new Map();

    for (const row of rows || []) {
      const partnerId = row?.partner_id;
      if (!partnerId) continue;

      if (!grouped.has(partnerId)) {
        grouped.set(partnerId, {
          partner_id: partnerId,
          partner_name: row?.partner_name || `Partner #${partnerId}`,
          partner_phone: row?.partner_phone || null,
          partner_upi: row?.partner_upi || null,
          total_pending_amount: 0,
          total_bookings: 0,
          services: [],
        });
      }

      const partner = grouped.get(partnerId);
      const amount = Number(row?.amount || 0);
      const safeAmount = Number.isFinite(amount) ? amount : 0;
      const finalPaid = getFinalPaidAmount(row);

      const normalizedType = normalizeBookingType(row);

      partner.total_pending_amount += safeAmount;
      partner.total_bookings += 1;
      partner.services.push({
        payment_id: row?.payment_id,
        booking_id: row?.booking_id || null,
        service_name: row?.service_name || 'Service',
        amount: safeAmount,
        original_amount: Number.isFinite(getOriginalAmount(row)) ? getOriginalAmount(row) : null,
        coupon_discount: Number.isFinite(getCouponDiscount(row)) ? getCouponDiscount(row) : null,
        final_amount_after_discount: Number.isFinite(finalPaid) ? finalPaid : null,
        gross_amount: Number(row?.gross_amount || 0),
        admin_commission_amount: Number(row?.admin_commission_amount || 0),
        partner_final_amount: row?.partner_final_amount ?? null,
        commission_breakdown: row?.commission_breakdown ?? null,

        customer_name: row?.customer_name || null,
        customer_phone: row?.customer_phone || null,

        booking_type: row?.booking_type || null,
        normalized_booking_type: normalizedType,

        booking_status: row?.booking_status || null,
        payment_status: row?.payment_status || null,

        partner_id: row?.partner_id || null,
        partner_name: row?.partner_name || null,

        salon_id: row?.salon_id || null,
        salon_name: row?.salon_name || null,
        salon_address: row?.salon_address || null,

        slot_date: row?.slot_date || null,
        slot_time: row?.slot_time || null,

        address: normalizedType === 'salon' ? (row?.salon_address || null) : (row?.address || null),

        created_at: row?.created_at || null,

        transaction_id: row?.transaction_id || null,

        // Keep legacy/extra fields for backward compatibility
        salon_owner_name: row?.salon_owner_name || null,
        partner_phone: row?.partner_phone || null,
        customer_address: row?.address || null,
        payment_transaction_id: row?.transaction_id || null,
      });
    }

    return res.json({ partners: Array.from(grouped.values()) });
  } catch (error) {
    return next(error);
  }
});

router.post('/mark-paid', adminProtect, async (req, res, next) => {
  let targetPaymentIds = [];
  let payoutBatchId = null;
  let hasSelectedPayload = false;
  try {
    await PaymentModel.ensureTable();
    console.log('MARK PAID BODY:', req.body);

    const partnerId = toInt(req.body?.partner_id ?? req.body?.partnerId);
    hasSelectedPayload = Object.prototype.hasOwnProperty.call(req.body || {}, 'selected_payment_ids')
      || Object.prototype.hasOwnProperty.call(req.body || {}, 'selectedPaymentIds');
    const selected_payment_ids = normalizeIdList(req.body?.selected_payment_ids ?? req.body?.selectedPaymentIds);

    if (!partnerId) {
      return res.status(400).json({ message: 'partner_id is required' });
    }

    if (hasSelectedPayload && selected_payment_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid selected services found',
      });
    }

    console.log('SELECTED IDS:', selected_payment_ids);

    let payoutRows = [];
    let payoutScope = 'partner-wide';
    payoutBatchId = `payout_${partnerId}_${Date.now()}`;

    if (selected_payment_ids.length > 0) {
      payoutScope = 'selected-only';
      [payoutRows] = await db.query(
        `
        SELECT
          id,
          COALESCE(partner_final_amount, amount) AS amount
        FROM payments
        WHERE partner_id = ?
          AND COALESCE(payment_status, 'PAID') = 'PAID'
          AND (
            booking_status = 'completed'
            OR (
              (
                TRIM(COALESCE(booking_type, '')) = 'visit_salon'
                OR TRIM(COALESCE(service_mode, '')) = 'visit_salon'
              )
              AND booking_status IN ('confirmed','completed')
            )
          )
          AND COALESCE(partner_payment_status, 'pending') = 'pending'
          AND id IN (?)
        ORDER BY created_at ASC
        `,
        [partnerId, selected_payment_ids]
      );
    } else {
      [payoutRows] = await db.query(
        `
        SELECT
          id,
          COALESCE(partner_final_amount, amount) AS amount
        FROM payments
        WHERE partner_id = ?
          AND COALESCE(payment_status, 'PAID') = 'PAID'
          AND (
            booking_status = 'completed'
            OR (
              (
                TRIM(COALESCE(booking_type, '')) = 'visit_salon'
                OR TRIM(COALESCE(service_mode, '')) = 'visit_salon'
              )
              AND booking_status IN ('confirmed','completed')
            )
          )
          AND COALESCE(partner_payment_status, 'pending') = 'pending'
        ORDER BY created_at ASC
        `,
        [partnerId]
      );
    }

    console.log('FETCHED PAYMENTS:', Array.isArray(payoutRows) ? payoutRows.length : 0);

    const totalAmount = (payoutRows || []).reduce((sum, row) => {
      const amount = Number(row?.amount || 0);
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0);

    console.log('TOTAL PAYOUT:', totalAmount);

    const totalBookings = payoutRows?.length || 0;

    if (!Number.isFinite(totalAmount) || totalAmount <= 0 || totalBookings <= 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid selected services found',
      });
    }

    // Fetch partner UPI + name for payout.
    const [partnerRows] = await db.query(
      `
      SELECT
        pr.id AS partner_id,
        pr.upi_id,
        pr.mobile AS partner_phone,
        COALESCE(pk.full_name, pr.name, CONCAT('Partner #', pr.id)) AS partner_name
      FROM partners pr
      LEFT JOIN partner_kyc pk ON pk.partner_id = pr.id
      WHERE pr.id = ?
      LIMIT 1
      `,
      [partnerId]
    );

    const partner = partnerRows?.[0];
    if (!partner) {
      return res.status(404).json({ message: 'Partner not found' });
    }

    const upiId = String(partner?.upi_id || '').trim();
    if (!upiId) {
      return res.status(400).json({ message: 'Partner UPI not available' });
    }

    const payout = await sendPayout({
      amount: totalAmount,
      upi: upiId,
      name: partner?.partner_name,
      partnerId: partner?.partner_id,
      mobile: partner?.partner_phone,
      referenceId: payoutBatchId,
    });

    const payoutId = payout?.id || null;
    const payoutStatusRaw = payout?.status || null;
    const payoutStatus = String(payoutStatusRaw || '').toLowerCase();
    const shouldMarkPaid = payoutStatus === 'processed' || payoutStatus === 'queued' || payoutStatus === 'processing';

    const utrNumberRaw = payout?.utr || payout?.utr_number || payout?.utrNumber || null;
    const utrNumber = String(utrNumberRaw || '').trim() || null;

    targetPaymentIds = payoutRows.map((row) => toInt(row?.id)).filter((id) => id !== null);
    if (targetPaymentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid selected services found',
      });
    }

    // Always update rows by explicit IDs to avoid partner-wide updates.
    const updateIds = hasSelectedPayload ? selected_payment_ids : targetPaymentIds;
    console.log('[MARK PAID FILTER]', {
      partner_id: partnerId,
      selected_payment_ids: updateIds,
    });

    const adminId = toInt(req.admin?.id);

    const [result] = await db.query(
      `
      UPDATE payments
      SET
        payout_id = ?,
        payout_status = ?,
        processed_by_admin_id = IF(? IS NOT NULL, ?, processed_by_admin_id),
        partner_payment_status = IF(?, 'paid', partner_payment_status),
        paid_at = IF(?, NOW(), paid_at),
        utr_number = IF(? IS NOT NULL AND ? <> '', ?, utr_number)
      WHERE partner_id = ?
        AND COALESCE(payment_status, 'PAID') = 'PAID'
        AND COALESCE(partner_payment_status, 'pending') = 'pending'
        AND (
          booking_status = 'completed'
          OR (
            (
              TRIM(COALESCE(booking_type, '')) = 'visit_salon'
              OR TRIM(COALESCE(service_mode, '')) = 'visit_salon'
            )
            AND booking_status IN ('confirmed','completed')
          )
        )
        AND id IN (?)
      `,
      [
        payoutId || payoutBatchId,
        payoutStatusRaw,
        adminId,
        adminId,
        shouldMarkPaid,
        shouldMarkPaid,
        utrNumber,
        utrNumber,
        utrNumber,
        partnerId,
        updateIds,
      ]
    );

    const updatedRows = result?.affectedRows || 0;

    console.log('[MARK PAID UPDATE RESULT]', { affectedRows: updatedRows });

    if (updatedRows === 0 && shouldMarkPaid) {
      console.warn('[PAYOUT UPDATE WARNING]', {
        partner_id: partnerId,
        payout_id: payoutId || payoutBatchId,
        payout_status: payoutStatusRaw,
        selected_payment_ids: updateIds,
      });

      return res.json({
        success: true,
        warning: 'Payout created, but no DB rows were updated (already-paid or filter mismatch). Please verify payment rows.',
        updated_rows: 0,
        payout_id: payoutId || payoutBatchId,
        payout_status: payoutStatusRaw,
        payout_scope: payoutScope,
        total_amount: totalAmount,
        selected_count: totalBookings,
      });
    }

    if (!shouldMarkPaid) {
      // Do NOT mark paid if payout failed / unknown.
      return res.status(400).json({
        message: `Payment failed (status: ${payoutStatusRaw || 'unknown'})`,
        payout_id: payoutId,
        payout_status: payoutStatusRaw,
      });
    }

    // Realtime emits (best-effort, room-targeted)
    try {
      const io = getIO();
      const nowIso = new Date().toISOString();
      const payoutKey = payoutId || payoutBatchId;
      const paymentIds = Array.isArray(updateIds) ? updateIds : [];

      // Compute current remaining pending amount for this partner (used by cards)
      let remainingAmount = null;
      try {
        const [remRows] = await db.query(
          `
          SELECT
            SUM(COALESCE(partner_final_amount, amount)) AS remaining_amount
          FROM payments
          WHERE partner_id = ?
            AND COALESCE(payment_status, 'PAID') = 'PAID'
            AND (
              booking_status = 'completed'
              OR (
                (
                  TRIM(COALESCE(booking_type, '')) = 'visit_salon'
                  OR TRIM(COALESCE(service_mode, '')) = 'visit_salon'
                )
                AND booking_status IN ('confirmed','completed')
              )
            )
            AND COALESCE(partner_payment_status, 'pending') = 'pending'
          `,
          [partnerId]
        );
        const r = Number(remRows?.[0]?.remaining_amount || 0);
        remainingAmount = Number.isFinite(r) ? r : 0;
      } catch {
        remainingAmount = null;
      }

      const payoutPayload = {
        partnerId,
        payoutId: payoutKey,
        paymentIds,
        totalPaid: totalAmount,
        remainingAmount,
        paidAt: nowIso,
        status: 'paid',
        utrNumber: utrNumber || null,
      };

      // Emit payout update once (compact + rich fields) and include updatedAt for clients
      try {
        console.log('[socket emit]', SOCKET_EVENTS.PAYOUT_UPDATED, {
          partnerId,
          paymentIds: paymentIds,
        });
        // attach updatedAt for simple client-side reconciliation
        payoutPayload.updatedAt = Date.now();
        io.to('admin-dashboard').emit(SOCKET_EVENTS.PAYOUT_UPDATED, payoutPayload);
      } catch (e) {
        // keep best-effort semantics
      }
      io.to('admin-dashboard').emit(SOCKET_EVENTS.ADMIN_ANALYTICS_UPDATED, { reason: 'payout_paid', updatedAt: nowIso });

      // Partner room
      io.to(`partner:${partnerId}`).emit(SOCKET_EVENTS.PAYOUT_UPDATED, payoutPayload);
      io.to(`partner:${partnerId}`).emit(SOCKET_EVENTS.PARTNER_EARNINGS_UPDATED, { partnerId, reason: 'payout_paid', updatedAt: nowIso });
      io.to(`partner:${partnerId}`).emit(SOCKET_EVENTS.PARTNER_PAYMENT_STATUS_UPDATED, { partnerId, reason: 'payout_paid', updatedAt: nowIso });

      // Payout history upsert payload (admin + partner)
      try {
        const [payRows] = await db.query(
          `
          SELECT
            id,
            service_name,
            original_amount,
            coupon_discount,
            final_amount_after_discount,
            COALESCE(gross_amount, amount) AS gross_amount,
            COALESCE(admin_commission_amount, 0) AS admin_commission_amount,
            COALESCE(partner_final_amount, amount) AS partner_final_amount,
            payout_id,
            payout_status,
            paid_at,
            utr_number
          FROM payments
          WHERE id IN (?)
          `,
          [paymentIds]
        );

        const serviceNames = (payRows || []).map((r) => r?.service_name).filter(Boolean);
        const totals = (payRows || []).reduce(
          (acc, r) => {
            const gross = Number(r?.final_amount_after_discount ?? r?.amount ?? r?.gross_amount ?? 0);
            const comm = Number(r?.admin_commission_amount || 0);
            const net = Number(r?.partner_final_amount || 0);
            acc.customerPaid += Number.isFinite(gross) ? gross : 0;
            acc.adminCommission += Number.isFinite(comm) ? comm : 0;
            acc.partnerPaid += Number.isFinite(net) ? net : 0;
            return acc;
          },
          { customerPaid: 0, adminCommission: 0, partnerPaid: 0 }
        );

        const historyItem = {
          partner_id: partnerId,
          partner_name: partner?.partner_name || `Partner #${partnerId}`,
          partner_phone: partner?.partner_phone || null,
          upi_id: upiId,
          service_count: (payRows || []).length,
          total_amount: totals.partnerPaid,
          total_customer_paid: totals.customerPaid,
          total_admin_commission: totals.adminCommission,
          total_partner_paid: totals.partnerPaid,
          payout_id: payoutKey,
          payout_status: payoutStatusRaw,
          paid_at: (payRows || []).find((r) => r?.paid_at)?.paid_at || nowIso,
          utr_number: utrNumber || null,
          service_names: serviceNames.join(', '),
        };

        const historyPayload = {
          payoutKey,
          partnerId,
          paidAt: historyItem.paid_at,
          item: historyItem,
        };

        io.to('admin-dashboard').emit(SOCKET_EVENTS.PAYOUT_HISTORY_UPDATED, historyPayload);
        io.to(`partner:${partnerId}`).emit(SOCKET_EVENTS.PAYOUT_HISTORY_UPDATED, historyPayload);
      } catch {
        // ignore
      }
    } catch {
      // ignore socket errors
    }

    return res.json({
      success: true,
      updated_rows: updatedRows,
      payout_id: payoutId || payoutBatchId,
      payout_status: payoutStatusRaw,
      payout_scope: payoutScope,
      total_amount: totalAmount,
      selected_count: totalBookings,
    });
 } catch (error) {

  console.log("========== PAYOUT ERROR ==========");
  console.log("MESSAGE:", error.message);

  if (error.response) {
    console.log("STATUS:", error.response.status);
    console.log("DATA:", error.response.data);
  }

  console.log("FULL ERROR:", error);
  console.log("=================================");

  const partnerId = toInt(req.body?.partner_id);

  if (partnerId) {
    try {
      const failWhere = [
        'partner_id = ?',
        "COALESCE(payment_status, 'PAID') = 'PAID'",
          "COALESCE(partner_payment_status, 'pending') = 'pending'",
          "(booking_status = 'completed' OR (((TRIM(COALESCE(booking_type, '')) = 'visit_salon' OR TRIM(COALESCE(service_mode, '')) = 'visit_salon')) AND booking_status IN ('confirmed','completed')))",
      ];
      const failParams = [partnerId];

      if (hasSelectedPayload && targetPaymentIds.length > 0) {
        failWhere.push('id IN (?)');
        failParams.push(targetPaymentIds);
      }

      await db.query(
        `
        UPDATE payments
        SET payout_id = ?,
            payout_status = 'failed'
        WHERE ${failWhere.join(' AND ')}
        `,
        [payoutBatchId || `payout_${partnerId}_${Date.now()}`, ...failParams]
      );
    } catch (_) {}
  }

  return res.status(error?.response?.status || error?.statusCode || 500).json({
    success: false,
    message:
      error?.response?.data?.error?.description ||
      error.message ||
      "Payout failed",
  });
}
});

router.get('/payout-history', adminProtect, async (req, res, next) => {
  try {
    await PaymentModel.ensureTable();

    const limit = Math.min(Math.max(Number(req.query?.limit || 500), 1), 2000);
    const from = req.query?.from ? new Date(String(req.query.from)) : null;
    const to = req.query?.to ? new Date(String(req.query.to)) : null;
    const hasFrom = from && !Number.isNaN(from.getTime());
    const hasTo = to && !Number.isNaN(to.getTime());

    const where = [
      `(
          p.booking_status = 'completed'
          OR (
            (
              TRIM(COALESCE(p.booking_type, '')) = 'visit_salon'
              OR TRIM(COALESCE(p.service_mode, '')) = 'visit_salon'
            )
            AND p.booking_status IN ('confirmed','completed')
          )
        )`,
      'p.partner_id IS NOT NULL',
      `(
          COALESCE(p.partner_payment_status, 'pending') = 'paid'
          OR p.payout_status IS NOT NULL
          OR p.utr_number IS NOT NULL
        )`,
    ];
    const params = [];

    if (hasFrom) {
      where.push('COALESCE(p.paid_at, p.created_at) >= ?');
      params.push(from);
    }
    if (hasTo) {
      where.push('COALESCE(p.paid_at, p.created_at) <= ?');
      params.push(to);
    }

    const [rows] = await db.query(
      `
      SELECT
        p.partner_id,
        COALESCE(pk.full_name, pr.name, CONCAT('Partner #', p.partner_id)) AS partner_name,
        pr.upi_id,
        pr.mobile AS partner_phone,
        p.service_name,
        COALESCE(p.partner_final_amount, p.amount) AS amount,
        COALESCE(p.gross_amount, p.amount) AS gross_amount,
        p.original_amount,
        p.coupon_discount,
        p.final_amount_after_discount,
        COALESCE(p.admin_commission_amount, 0) AS admin_commission_amount,
        p.payout_id,
        COALESCE(p.payout_status, IF(p.utr_number IS NOT NULL AND p.utr_number <> '', 'manual', NULL)) AS payout_status,
        p.paid_at,
        p.created_at,
        p.utr_number
      FROM payments p
      LEFT JOIN partners pr ON pr.id = p.partner_id
      LEFT JOIN partner_kyc pk ON pk.partner_id = p.partner_id
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(p.paid_at, p.created_at) DESC, p.id DESC
      LIMIT ${Number(limit)}
      `
      ,
      params
    );

    const grouped = new Map();

    const rankStatus = (value) => {
      const status = String(value || '').toLowerCase();
      if (status === 'failed' || status === 'rejected' || status === 'cancelled') return 0;
      if (status === 'processing' || status === 'queued' || status === 'initiated') return 1;
      if (status === 'paid' || status === 'processed' || status === 'success') return 2;
      return 3;
    };

    for (const row of rows || []) {
      const payoutKey = row?.payout_id || `legacy-${row?.partner_id}-${row?.paid_at || row?.created_at}`;
      if (!grouped.has(payoutKey)) {
        grouped.set(payoutKey, {
          partner_id: row?.partner_id,
          partner_name: row?.partner_name || `Partner #${row?.partner_id}`,
          upi_id: row?.upi_id || null,
          partner_phone: row?.partner_phone || null,
          service_count: 0,
          total_amount: 0,
          total_customer_paid: 0,
          total_admin_commission: 0,
          total_partner_paid: 0,
          service_names: [],
          payout_status: null,
          paid_at: row?.paid_at || row?.created_at || null,
          payout_id: row?.payout_id || payoutKey,
          payout_batch_id: payoutKey,
          utr_number: row?.utr_number || null,
        });
      }

      const item = grouped.get(payoutKey);
      item.service_count += 1;
      const amount = Number(row?.amount || 0);
      const gross = Number(row?.final_amount_after_discount ?? row?.amount ?? row?.gross_amount ?? 0);
      const commission = Number(row?.admin_commission_amount || 0);

      const safeAmount = Number.isFinite(amount) ? amount : 0;
      const safeGross = Number.isFinite(gross) ? gross : 0;
      const safeCommission = Number.isFinite(commission) ? commission : 0;

      item.total_partner_paid += safeAmount;
      item.total_customer_paid += safeGross;
      item.total_admin_commission += safeCommission;
      item.total_amount += safeAmount; // backward-compat (net)

      if (row?.service_name) {
        item.service_names.push(row.service_name);
      }

      if (!item.utr_number && row?.utr_number) {
        item.utr_number = row.utr_number;
      }

      const candidateStatus = row?.payout_status || (row?.paid_at ? 'success' : null) || (row?.utr_number ? 'manual' : null);
      if (!item.payout_status || rankStatus(candidateStatus) < rankStatus(item.payout_status)) {
        item.payout_status = candidateStatus;
      }

      const currentTime = new Date(item.paid_at || 0).getTime();
      const rowTime = new Date(row?.paid_at || row?.created_at || 0).getTime();
      if (Number.isFinite(rowTime) && rowTime > currentTime) {
        item.paid_at = row?.paid_at || row?.created_at || item.paid_at;
      }
    }

    const history = Array.from(grouped.values())
      .map((item) => ({
        ...item,
        total_amount: Number(item.total_amount || 0),
        total_customer_paid: Number(item.total_customer_paid || 0),
        total_admin_commission: Number(item.total_admin_commission || 0),
        total_partner_paid: Number(item.total_partner_paid || 0),
        service_names: item.service_names.join(', '),
      }))
      .sort((a, b) => new Date(b.paid_at || 0).getTime() - new Date(a.paid_at || 0).getTime());

    return res.json({ history });
  } catch (error) {
    return next(error);
  }
});

router.get('/payout-history/:payoutKey/details', adminProtect, async (req, res, next) => {
  try {
    await PaymentModel.ensureTable();

    const payoutKey = String(req.params?.payoutKey || '').trim();
    if (!payoutKey) {
      return res.status(400).json({ success: false, message: 'payoutKey is required' });
    }

    const partnerId = toInt(req.query?.partner_id);
    const paidAtRaw = req.query?.paid_at ? new Date(String(req.query.paid_at)) : null;
    const hasPaidAt = paidAtRaw && !Number.isNaN(paidAtRaw.getTime());

    const isLegacy = payoutKey.startsWith('legacy-');

    const where = [
      `(
          p.booking_status = 'completed'
          OR (
            (
              TRIM(COALESCE(p.booking_type, '')) = 'visit_salon'
              OR TRIM(COALESCE(p.service_mode, '')) = 'visit_salon'
            )
            AND p.booking_status IN ('confirmed','completed')
          )
        )`,
      'p.partner_id IS NOT NULL',
    ];
    const params = [];

    if (!isLegacy) {
      where.push('p.payout_id = ?');
      params.push(payoutKey);
    } else {
      // Best-effort legacy grouping: partner_id + paid_at timestamp when provided.
      if (partnerId) {
        where.push('p.partner_id = ?');
        params.push(partnerId);
      }
      if (hasPaidAt) {
        where.push('COALESCE(p.paid_at, p.created_at) = ?');
        params.push(paidAtRaw);
      }
      // Ensure we don't accidentally scan everything if both are missing.
      if (!partnerId && !hasPaidAt) {
        return res.status(400).json({ success: false, message: 'Legacy payout details require partner_id or paid_at' });
      }
      where.push('(p.payout_id IS NULL OR p.payout_id = "")');
    }

    const [rows] = await db.query(
      `
      SELECT
        p.id AS payment_id,
        p.booking_id,
        p.service_name,
        p.booking_status,
        COALESCE(p.partner_final_amount, p.amount) AS partner_final_amount,
        COALESCE(p.gross_amount, p.amount) AS gross_amount,
        p.original_amount,
        p.coupon_discount,
        p.final_amount_after_discount,
        COALESCE(p.admin_commission_amount, 0) AS admin_commission_amount,
        p.partner_payment_status,
        p.payout_id,
        p.payout_status,
        p.paid_at,
        p.created_at,
        p.utr_number,
        p.partner_id,
        pr.mobile AS partner_phone,
        pr.upi_id AS partner_upi_id,
        COALESCE(pk.full_name, pr.name, CONCAT('Partner #', p.partner_id)) AS partner_name,
        p.processed_by_admin_id,
        a.name AS processed_by_admin_name,
        a.email AS processed_by_admin_email
      FROM payments p
      LEFT JOIN partners pr ON pr.id = p.partner_id
      LEFT JOIN partner_kyc pk ON pk.partner_id = p.partner_id
      LEFT JOIN admins a ON a.id = p.processed_by_admin_id
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(p.paid_at, p.created_at) DESC, p.id DESC
      LIMIT 2000
      `,
      params
    );

    if (!rows || rows.length === 0) {
      return res.json({ success: true, data: null });
    }

    const first = rows[0];
    const payoutId = first?.payout_id || payoutKey;
    const utrNumber = rows.find((r) => r?.utr_number)?.utr_number || null;
    const status = rows.find((r) => r?.payout_status)?.payout_status || (rows.find((r) => r?.partner_payment_status === 'paid') ? 'success' : null);
    const paidAt = rows.find((r) => r?.paid_at)?.paid_at || first?.paid_at || first?.created_at || null;

    const processedByName = rows.find((r) => r?.processed_by_admin_name)?.processed_by_admin_name || null;
    const processedByEmail = rows.find((r) => r?.processed_by_admin_email)?.processed_by_admin_email || null;
    const processedByAdmin = processedByName || processedByEmail || null;

    let total = 0;
    let completed = 0;
    let cancelled = 0;
    let customerPaidTotal = 0;
    let adminCommissionTotal = 0;
    let partnerEarnedTotal = 0;
    let alreadyPaid = 0;

    const services = (rows || []).map((r) => {
      total += 1;
      const bs = String(r?.booking_status || '').toLowerCase();
      if (bs === 'completed') completed += 1;
      if (bs === 'cancelled' || bs === 'canceled') cancelled += 1;

      const gross = Number(r?.gross_amount || 0);
      const finalPaid = Number(r?.final_amount_after_discount ?? r?.amount ?? r?.gross_amount ?? 0);
      const comm = Number(r?.admin_commission_amount || 0);
      const net = Number(r?.partner_final_amount || 0);
      const safeGross = Number.isFinite(gross) ? gross : 0;
      const safeFinalPaid = Number.isFinite(finalPaid) ? finalPaid : safeGross;
      const safeComm = Number.isFinite(comm) ? comm : 0;
      const safeNet = Number.isFinite(net) ? net : 0;

      customerPaidTotal += safeFinalPaid;
      adminCommissionTotal += safeComm;
      partnerEarnedTotal += safeNet;
      if (String(r?.partner_payment_status || '').toLowerCase() === 'paid') {
        alreadyPaid += safeNet;
      }

      return {
        payment_id: r?.payment_id,
        booking_id: r?.booking_id || null,
        service_name: r?.service_name || 'Service',
        gross_amount: safeGross,
        original_amount: Number(r?.original_amount ?? safeGross ?? 0),
        coupon_discount: Number(r?.coupon_discount ?? 0),
        final_amount_after_discount: safeFinalPaid,
        admin_commission_amount: safeComm,
        partner_final_amount: safeNet,
      };
    });

    const remainingAmount = Math.max(0, partnerEarnedTotal - alreadyPaid);

    return res.json({
      success: true,
      data: {
        partner: {
          id: first?.partner_id || null,
          name: first?.partner_name || null,
          phone: first?.partner_phone || null,
          upi_id: first?.partner_upi_id || null,
        },
        payout: {
          payout_id: payoutId,
          utr_number: utrNumber,
          status: status,
          paid_at: paidAt,
          processed_by_admin: processedByAdmin,
        },
        bookings: {
          total,
          completed,
          cancelled,
        },
        money: {
          customer_paid_total: customerPaidTotal,
          admin_commission_total: adminCommissionTotal,
          partner_earned_total: partnerEarnedTotal,
          already_paid: alreadyPaid,
          remaining_amount: remainingAmount,
        },
        services,
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/commission-analytics', adminProtect, async (req, res, next) => {
  try {
    await PaymentModel.ensureTable();

    const [rows] = await db.query(
      `
      SELECT
        COUNT(*) AS total_payments,
        SUM(COALESCE(p.final_amount_after_discount, p.amount, p.gross_amount)) AS total_customer_paid,
        SUM(COALESCE(p.admin_commission_amount, 0)) AS total_admin_commission,
        SUM(COALESCE(p.partner_final_amount, p.amount)) AS total_partner_earned,
        SUM(CASE WHEN COALESCE(p.partner_payment_status, 'pending') = 'paid' THEN COALESCE(p.partner_final_amount, p.amount) ELSE 0 END) AS total_partner_paid,
        SUM(CASE WHEN COALESCE(p.partner_payment_status, 'pending') <> 'paid' THEN COALESCE(p.partner_final_amount, p.amount) ELSE 0 END) AS total_partner_remaining
      FROM payments p
      WHERE COALESCE(p.payment_status, 'PAID') = 'PAID'
        AND p.partner_id IS NOT NULL
        AND (
          p.booking_status = 'completed'
          OR (
            (
              TRIM(COALESCE(p.booking_type, '')) = 'visit_salon'
              OR TRIM(COALESCE(p.service_mode, '')) = 'visit_salon'
            )
            AND p.booking_status IN ('confirmed','completed')
          )
        )
      `
    );

    const row = Array.isArray(rows) && rows.length ? rows[0] : {};
    return res.json({
      success: true,
      data: {
        total_payments: Number(row?.total_payments || 0),
        total_customer_paid: Number(row?.total_customer_paid || 0),
        total_admin_commission: Number(row?.total_admin_commission || 0),
        total_partner_earned: Number(row?.total_partner_earned || 0),
        total_partner_paid: Number(row?.total_partner_paid || 0),
        total_partner_remaining: Number(row?.total_partner_remaining || 0),
      }
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
