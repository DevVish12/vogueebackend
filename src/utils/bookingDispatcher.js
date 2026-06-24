const db = require('../config/db');
const PaymentModel = require('../modules/payment/payment.model');
const PartnerLocationModel = require('../modules/partnerLocation/partnerLocation.model');
const { getIO, onlinePartners } = require('../../socket/socket');
const { startBookingRetryInterval } = require('./bookingRetryManager');
const { sendExpoNotification } = require('./sendExpoNotification');

const toNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

// Haversine distance in KM
const calculateDistanceKm = (lat1, lng1, lat2, lng2) => {
    const a1 = toNumber(lat1);
    const o1 = toNumber(lng1);
    const a2 = toNumber(lat2);
    const o2 = toNumber(lng2);
    if (a1 == null || o1 == null || a2 == null || o2 == null) return Number.POSITIVE_INFINITY;

    const R = 6371;
    const dLat = ((a2 - a1) * Math.PI) / 180;
    const dLng = ((o2 - o1) * Math.PI) / 180;
    const sLat1 = (a1 * Math.PI) / 180;
    const sLat2 = (a2 * Math.PI) / 180;

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(sLat1) * Math.cos(sLat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

/**
 * Dispatch a due booking to nearby online partners.
 * Keeps existing socket event names/shape used by the mobile apps.
 */
const dispatchPaymentRow = async (paymentRow) => {
    const row = paymentRow || {};
    const paymentId = Number(row.id);
    if (!Number.isFinite(paymentId)) return { ok: false, reason: 'invalid_payment_id' };

    const io = getIO();

    const userId = row.user_id;
    const bookingId = row.booking_id ?? row.id;

    const lat = Number(row.lat);
    const lng = Number(row.lng);

    const RADIUS_KM = 30;
    const EXPIRES_IN_SEC = 30;

    const bookingPayload = {
        id: row.id,
        bookingId: bookingId ?? row.id,
        userId,
        serviceName: row.service_name ?? null,
        amount: row.amount ?? null,
        address: row.address ?? null,
        slotDate: row.slot_date ?? null,
        slotTime: row.slot_time ?? null,
        lat: row.lat ?? null,
        lng: row.lng ?? null,
        status: 'searching',
        booking_status: 'searching',
        paymentStatus: row.payment_status ?? 'PAID',
        payment_status: row.payment_status ?? 'PAID',
        booking_type: row.booking_type ?? null,
        bookingType: row.booking_type ?? null,
        service_mode: row.service_mode ?? null,
        salon_id: row.salon_id ?? null,
        salon_name: row.salon_name ?? null,
        salon_address: row.salon_address ?? null,
        partner_id: row.partner_id ?? null,
    };

    const isSalonVisit = String(row?.booking_type || '').trim() === 'visit_salon' || String(row?.service_mode || '').trim() === 'visit_salon';

    if (isSalonVisit) {
        try {
            await PaymentModel.updateBookingStatusById(paymentId, 'confirmed', row?.partner_id ?? null);
        } catch (_) {
            // ignore
        }

        const salonBookingPayload = {
            ...bookingPayload,
            status: 'confirmed',
            booking_status: 'confirmed',
            paymentStatus: row.payment_status ?? 'PAID',
            payment_status: row.payment_status ?? 'PAID',
            bookingType: 'visit_salon',
            booking_type: 'visit_salon',
            service_mode: 'visit_salon',
        };

        io.to(`user:${userId}`).emit('salonBookingConfirmed', salonBookingPayload);

        if (row?.partner_id) {
            io.to(`partner:${row.partner_id}`).emit('salonAppointmentBooking', salonBookingPayload);
        }

        return { ok: true, status: 'confirmed', reason: 'visit_salon' };
    }

    // Move from pending -> searching right as we dispatch.
    try {
        await PaymentModel.updateBookingStatusById(paymentId, 'searching');
    } catch (_) {
        // ignore
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        try {
            await PaymentModel.updateBookingStatusById(paymentId, 'no_partner');
        } catch (_) {
            // ignore
        }

        io.to(`user:${userId}`).emit('noPartnerFound', {
            ...bookingPayload,
            status: 'no_partner',
            booking_status: 'no_partner',
        });

        return { ok: true, status: 'no_partner', reason: 'missing_coordinates' };
    }

    let partners = [];
    try {
        await PartnerLocationModel.ensureTable();
        const [rows] = await db.query(`
            SELECT pl.partner_id, pl.lat, pl.lng
      FROM partner_locations pl
    `);
        partners = Array.isArray(rows) ? rows : [];
    } catch (_) {
        partners = [];
    }

    const nearbyPartners = partners
        .map((p) => {
            const distanceKm = calculateDistanceKm(lat, lng, p?.lat, p?.lng);
            return {
                partner_id: p?.partner_id,
                lat: p?.lat,
                lng: p?.lng,
                distanceKm,
            };
        })
        .filter((p) => p?.partner_id != null && Number.isFinite(p.distanceKm) && p.distanceKm <= RADIUS_KM);

    // Update the user UI with how many partners are in range.
    io.to(`user:${userId}`).emit('nearbyPartnersUpdate', {
        id: bookingPayload.id,
        bookingId: bookingPayload.bookingId,
        userId: bookingPayload.userId,
        count: nearbyPartners.length,
        radiusKm: RADIUS_KM,
    });

    if (nearbyPartners.length === 0) {
        try {
            await PaymentModel.updateBookingStatusById(paymentId, 'no_partner');
        } catch (_) {
            // ignore
        }

        io.to(`user:${userId}`).emit('noPartnerFound', {
            ...bookingPayload,
            status: 'no_partner',
            booking_status: 'no_partner',
        });

        return { ok: true, status: 'no_partner', reason: 'no_partners_in_radius' };
    }

    const onlineNearbyPartners = nearbyPartners.filter((p) => onlinePartners.has(String(p?.partner_id)));

    // Send booking requests to online nearby partners
    for (const p of onlineNearbyPartners) {
        const partnerId = p?.partner_id;
        if (partnerId == null) continue;

        const distanceKm = Number(p?.distanceKm);
        const distance = Number.isFinite(distanceKm) ? `${distanceKm.toFixed(1)} km` : undefined;

        io.to(`partner:${partnerId}`).emit('newBookingRequest', {
            ...bookingPayload,
            expiresIn: EXPIRES_IN_SEC,
            distanceKm: Number.isFinite(distanceKm) ? distanceKm : undefined,
            distance,
        });

        io.emit('new_booking', {
            ...bookingPayload,
            bookingType: bookingPayload.bookingType,
        });

        // Send Expo push notification (background/foreground delivery)
        try {
            const [partnerRows] = await db.query(
                'SELECT expo_push_token FROM partners WHERE id = ?',
                [partnerId]
            );
            const partner = partnerRows?.[0];
            const token = partner?.expo_push_token;

            if (token) {
                await sendExpoNotification(
                    token,
                    'New Booking Request',
                    `${bookingPayload.serviceName} - ${distance || 'Distance unknown'}`,
                    {
                        bookingId: bookingPayload.id,
                        userId: bookingPayload.userId,
                        type: 'newBookingRequest',
                    }
                );
            }
        } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`[Dispatcher] Failed to send notification to partner ${partnerId}:`, err?.message || err);
        }
    }

    // Continuous retry interval (15s) up to 3 attempts (45s)
    startBookingRetryInterval({
        paymentId,
        userId,
        bookingPayload,
        nearbyPartners,
        onlinePartners,
        io,
        db,
        intervalMs: 15000,
        maxAttempts: 3,
        expiresInSec: EXPIRES_IN_SEC,
    });

    return { ok: true, status: 'searching', nearbyPartners: nearbyPartners.length, onlineNearbyPartners: onlineNearbyPartners.length };
};

module.exports = {
    dispatchPaymentRow,
};
