const express = require('express');

const db = require('../config/db');
const { partnerProtect } = require('../middlewares/auth.middleware');
const { errorResponse, successResponse } = require('../utils/response');
const PaymentModel = require('../modules/payment/payment.model');
const PartnerAuthModel = require('../modules/partnerAuth/partnerAuth.model');
const { sendExpoNotification } = require('../utils/sendExpoNotification');

const router = express.Router();

const fetchPartnerWithKyc = async (partnerId) => {
  const [rows] = await db.query(
    `
    SELECT
      p.id,
      p.mobile AS phone,
      COALESCE(p.avatar, pk.selfie_url) AS avatar,
      pk.full_name AS name,
      pk.experience,
      pk.skills,
      pk.service_latitude AS lat,
      pk.service_longitude AS lng,
      p.rating
    FROM partners p
    LEFT JOIN partner_kyc pk ON pk.partner_id = p.id
    WHERE p.id = ?
    `,
    [partnerId]
  );
  return (rows && rows[0]) || {};
};

const parseSkills = (rawSkills) => {
  let skills = [];

  try {
    skills = typeof rawSkills === 'string' ? JSON.parse(rawSkills) : rawSkills;
  } catch {
    skills = [];
  }

  return Array.isArray(skills) ? skills : [];
};

const toSafePartner = (partner, fallbackId) => {
  const skills = parseSkills(partner?.skills);
  const safePartner = {
    id: partner?.id || fallbackId,
    name: partner?.name || 'Verified Professional',
    phone: partner?.phone || '',
    rating: partner?.rating || '4.5',
    experience: partner?.experience || '1+ Years',
    avatar: partner?.avatar || '',
    skills: skills || [],
    lat: partner?.lat ?? null,
    lng: partner?.lng ?? null,
  };

  // eslint-disable-next-line no-console
  console.log('FINAL PARTNER FULL DATA:', safePartner);
  return safePartner;
};

const fetchCustomerById = async (userId) => {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return {};

  const [rows] = await db.query(
    `
    SELECT
      u.name,
      u.mobile
    FROM users u
    WHERE u.id = ?
    LIMIT 1
    `,
    [uid]
  );

  return (rows && rows[0]) || {};
};

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
  const a1 = toNumber(lat1);
  const o1 = toNumber(lon1);
  const a2 = toNumber(lat2);
  const o2 = toNumber(lon2);
  if (a1 == null || o1 == null || a2 == null || o2 == null) return null;

  const R = 6371;
  const dLat = ((a2 - a1) * Math.PI) / 180;
  const dLon = ((o2 - o1) * Math.PI) / 180;
  const sLat1 = (a1 * Math.PI) / 180;
  const sLat2 = (a2 * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(sLat1) * Math.cos(sLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const normalizeBookingKey = (value) => {
  if (value == null) return '';
  return String(value).trim();
};

const isNumericId = (value) => {
  const s = String(value == null ? '' : value).trim();
  if (!s) return false;
  if (!/^[0-9]+$/.test(s)) return false;
  const n = Number(s);
  return Number.isFinite(n);
};

const getBookingKey = (row) => {
  const key = row?.booking_id ?? row?.bookingId ?? row?.id;
  return key == null ? '' : String(key);
};

/**
 * Partner accepts a booking.
 * Body: { bookingId: <payment.id OR payments.booking_id> }
 */
router.post('/accept-booking', partnerProtect, async (req, res, next) => {
  try {
    await PaymentModel.ensureTable();
    await PartnerAuthModel.ensureTable();

    const bookingId = normalizeBookingKey(req.body?.bookingId ?? req.body?.id);
    if (!bookingId) {
      return errorResponse(res, 400, 'bookingId is required');
    }

    const partnerId = Number(req.partner?.id);
    if (!Number.isFinite(partnerId)) {
      return errorResponse(res, 401, 'Not authorized, token failed');
    }

    const bookingRow = isNumericId(bookingId)
      ? await PaymentModel.getById(Number(bookingId))
      : await PaymentModel.getByBookingId(bookingId);

    if (!bookingRow) {
      return errorResponse(res, 404, 'Booking not found');
    }

    const currentStatus = String(bookingRow.booking_status || '').trim();
    if (currentStatus !== 'searching') {
      // Spec: if not searching, treat as already accepted/closed.
      return successResponse(res, 200, 'Already accepted', { booking: bookingRow });
    }

    // Atomic first-come-first-accept.
    const accepted = isNumericId(bookingId)
      ? await PaymentModel.tryAcceptBookingById(Number(bookingId), partnerId)
      : await PaymentModel.tryAcceptBookingByBookingId(bookingId, partnerId);

    if (!accepted) {
      const latest = isNumericId(bookingId)
        ? await PaymentModel.getById(Number(bookingId))
        : await PaymentModel.getByBookingId(bookingId);
      return successResponse(res, 200, 'Already accepted', { booking: latest || bookingRow });
    }

    const updated = isNumericId(bookingId)
      ? await PaymentModel.getById(Number(bookingId))
      : await PaymentModel.getByBookingId(bookingId);

    const partner = await fetchPartnerWithKyc(partnerId);
    const safePartner = toSafePartner(partner, partnerId);

    const customer = updated?.user_id ? await fetchCustomerById(updated.user_id) : {};
    const distanceKm = calculateDistanceKm(updated?.lat, updated?.lng, safePartner?.lat, safePartner?.lng);
    const distance = Number.isFinite(distanceKm) ? `${distanceKm.toFixed(2)} km` : undefined;

    const io = req.app.get('io');
    if (io && updated?.user_id) {
      const bookingAssignedPayload = {
        id: updated.id,
        bookingId: getBookingKey(updated),
        userId: updated.user_id,
        customerName: customer?.name || 'Customer',
        customerPhone: customer?.mobile || '',
        serviceName: updated.service_name,
        amount: updated.amount,
        address: updated.address,
        slotDate: updated.slot_date,
        slotTime: updated.slot_time,
        lat: updated.lat,
        lng: updated.lng,
        booking_type: updated.booking_type ?? null,
        service_mode: updated.service_mode ?? null,
        salon_id: updated.salon_id ?? null,
        salon_name: updated.salon_name ?? null,
        salon_address: updated.salon_address ?? null,
        distance,
        status: 'accepted',
        booking_status: 'accepted',
        partnerId,
        partner: safePartner,
      };

      // eslint-disable-next-line no-console
      console.log('EMIT TO USER:', updated.user_id);
      io.to(`user:${updated.user_id}`).emit('bookingAssigned', bookingAssignedPayload);

      // eslint-disable-next-line no-console
      console.log('EMIT TO PARTNER:', partnerId);
      io.to(`partner:${partnerId}`).emit('bookingAssigned', bookingAssignedPayload);

      // Close the request for other partners.
      io.emit('bookingClosed', { bookingId: getBookingKey(updated) });

      // Send Expo notification to user that partner accepted
      try {
        const [userRows] = await db.query(
          'SELECT expo_push_token FROM users WHERE id = ?',
          [updated.user_id]
        );
        const userToken = userRows?.[0]?.expo_push_token;
        if (userToken) {
          await sendExpoNotification(
            userToken,
            'Partner Accepted',
            `${safePartner.name} has accepted your ${updated.service_name} booking`,
            {
              bookingId: updated.id,
              partnerId,
              type: 'bookingAccepted',
            }
          );
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[accept-booking] Failed to send notification:', err?.message || err);
      }
    }

    return successResponse(res, 200, 'Booking accepted', { booking: updated, partner });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
