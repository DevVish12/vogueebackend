const express = require('express');
const router = express.Router();

const db = require('../config/db');
const { adminProtect } = require('../middlewares/auth.middleware');
const PaymentModel = require('../modules/payment/payment.model');
const PartnerAuthModel = require('../modules/partnerAuth/partnerAuth.model');

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
    const n = Number(value);
    return Number.isFinite(n) && String(value).trim() !== '';
};

const getBookingKey = (row) => {
    const key = row?.booking_id ?? row?.bookingId ?? row?.id;
    return key == null ? '' : String(key);
};

const AdminBookingController = {
    list: async (req, res, next) => {
        try {
            await PaymentModel.ensureTable();

            const [rows] = await db.query(
                `
        SELECT
          p.id,
          p.booking_id,
          p.user_id,
          u.name AS user_name,
          u.mobile AS user_mobile,
          u.email AS user_email,
          p.service_name,
          p.amount,
          p.original_amount,
          p.coupon_discount,
          p.final_amount_after_discount,
          p.status,
          p.booking_status,
          CASE
            WHEN COALESCE(NULLIF(TRIM(p.booking_type), ''), NULLIF(TRIM(p.service_mode), '')) = 'visit_salon' THEN 'salon'
            ELSE 'home'
          END AS booking_type,
          COALESCE(pk.full_name, pr.name, CONCAT('Partner #', p.partner_id)) AS partner_name,
          pr.mobile AS partner_phone,
          p.salon_name,
          p.salon_address,
          pk.opening_time AS salon_open_time,
          pk.closing_time AS salon_close_time,
          p.partner_id,
          p.address,
          p.transaction_id,
          p.created_at
        FROM payments p
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN partners pr ON pr.id = p.partner_id
        LEFT JOIN partner_kyc pk ON pk.partner_id = p.partner_id
        ORDER BY p.created_at DESC
        `
            );

            return res.json({ bookings: rows });
        } catch (error) {
            return next(error);
        }
    },

    listUnassigned: async (req, res, next) => {
        try {
            await PaymentModel.ensureTable();

            const bookings = await PaymentModel.getUnassignedBookings();
            return res.json({ bookings });
        } catch (error) {
            return next(error);
        }
    },

    assignPartner: async (req, res, next) => {
        try {
            await PaymentModel.ensureTable();
            await PartnerAuthModel.ensureTable();

            const bookingId = normalizeBookingKey(req.body?.bookingId);
            const partnerIdRaw = req.body?.partnerId;
            const partnerId = Number(partnerIdRaw);

            if (!bookingId) {
                return res.status(400).json({ message: 'bookingId is required' });
            }
            if (!Number.isFinite(partnerId)) {
                return res.status(400).json({ message: 'partnerId is required' });
            }

            const bookingRow = isNumericId(bookingId)
                ? await PaymentModel.getById(Number(bookingId))
                : await PaymentModel.getByBookingId(bookingId);

            if (!bookingRow) {
                return res.status(404).json({ message: 'Booking not found' });
            }

            if (bookingRow.booking_status === 'accepted' && bookingRow.partner_id) {
                return res.status(200).json({ message: 'Booking already assigned', booking: bookingRow });
            }

            if (bookingRow.booking_status !== 'no_partner') {
                return res.status(409).json({ message: 'Booking is not in no_partner status' });
            }

            const partner = await fetchPartnerWithKyc(partnerId);
            if (!partner || !partner.id) {
                return res.status(404).json({ message: 'Partner not found' });
            }

            const safePartner = toSafePartner(partner, partnerId);

            if (isNumericId(bookingId)) {
                await PaymentModel.updateBookingStatusById(Number(bookingId), 'accepted', partnerId);
            } else {
                await PaymentModel.updateBookingStatusByBookingId(bookingId, 'accepted', partnerId);
            }

            const updated = isNumericId(bookingId)
                ? await PaymentModel.getById(Number(bookingId))
                : await PaymentModel.getByBookingId(bookingId);

            const customer = updated?.user_id ? await fetchCustomerById(updated.user_id) : {};
            const distanceKm = calculateDistanceKm(updated?.lat, updated?.lng, safePartner?.lat, safePartner?.lng);
            const distance = Number.isFinite(distanceKm) ? `${distanceKm.toFixed(2)} km` : undefined;

            // eslint-disable-next-line no-console
            console.log('[ASSIGN PARTNER] SUCCESS', {
                bookingId: updated?.booking_id,
                partnerId: updated?.partner_id,
            });

            const io = req.app.get('io');
            if (io && updated) {
                // eslint-disable-next-line no-console
                const bookingAssignedPayload = {
                    id: updated.id,
                    bookingId: getBookingKey(updated),
                    userId: updated.user_id,
                    customerName: customer?.name || 'Customer',
                    customerPhone: customer?.mobile || '',
                    serviceName: updated.service_name,
                    amount: updated.final_amount_after_discount ?? updated.amount,
                    original_amount: updated.original_amount ?? updated.amount,
                    final_amount_after_discount: updated.final_amount_after_discount ?? updated.amount,
                    coupon_discount: updated.coupon_discount ?? 0,
                    address: updated.address,
                    slotDate: updated.slot_date,
                    slotTime: updated.slot_time,
                    lat: updated.lat,
                    lng: updated.lng,
                    distance,
                    status: 'accepted',
                    booking_status: 'accepted',
                    partnerId: partnerId,
                    partner: safePartner,
                };

                if (updated?.user_id) {
                    // eslint-disable-next-line no-console
                    console.log('EMIT TO USER:', updated.user_id);
                    io.to(`user:${updated.user_id}`).emit('bookingAssigned', bookingAssignedPayload);
                }

                // eslint-disable-next-line no-console
                console.log('EMIT TO PARTNER:', partnerId);
                io.to(`partner:${partnerId}`).emit('bookingAssigned', bookingAssignedPayload);
            }

            return res.json({ message: 'Partner assigned', booking: updated, partner });
        } catch (error) {
            return next(error);
        }
    },

    detail: async (req, res, next) => {
        try {
            await PaymentModel.ensureTable();

            const id = Number(req.params.id);
            if (!Number.isFinite(id)) {
                return res.status(400).json({ message: 'Invalid booking id' });
            }

            const [rows] = await db.query(
                `
        SELECT
          p.*,
          u.name AS user_name,
          u.mobile AS user_mobile,
          u.email AS user_email,
          u.gender AS user_gender,
          u.city AS user_city,
          CASE
            WHEN COALESCE(NULLIF(TRIM(p.booking_type), ''), NULLIF(TRIM(p.service_mode), '')) = 'visit_salon' THEN 'salon'
            ELSE 'home'
          END AS booking_type,
          COALESCE(pk.full_name, pr.name, CONCAT('Partner #', p.partner_id)) AS partner_name,
          pr.mobile AS partner_phone,
          pk.opening_time AS salon_open_time,
          pk.closing_time AS salon_close_time
        FROM payments p
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN partners pr ON pr.id = p.partner_id
        LEFT JOIN partner_kyc pk ON pk.partner_id = p.partner_id
        WHERE p.id = ?
        LIMIT 1
        `,
                [id]
            );

            if (!rows.length) {
                return res.status(404).json({ message: 'Booking not found' });
            }

            return res.json({ booking: rows[0] });
        } catch (error) {
            return next(error);
        }
    }
};

router.get('/bookings', adminProtect, AdminBookingController.list);
router.get('/bookings/unassigned', adminProtect, AdminBookingController.listUnassigned);
router.get('/bookings/:id', adminProtect, AdminBookingController.detail);
router.post('/assign-partner', adminProtect, AdminBookingController.assignPartner);

module.exports = router;
