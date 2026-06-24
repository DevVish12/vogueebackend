const Razorpay = require('razorpay');
const crypto = require('crypto');
const PaymentModel = require('./payment.model');
const CouponController = require('../coupon/coupon.controller');
const CouponModel = require('../coupon/coupon.model');
const ServiceModel = require('../service/service.model');
const db = require('../../config/db');
const { getIO } = require('../../../socket/socket');

const round2 = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
};

const parseServiceLineItems = (serviceName) => {
    if (Array.isArray(serviceName)) {
        return serviceName
            .map((v) => String(v || '').trim())
            .filter(Boolean)
            .map((name) => ({ name, qty: 1 }));
    }

    const raw = String(serviceName || '').trim();
    if (!raw) return [];

    return raw
        .split(',')
        .map((p) => String(p || '').trim())
        .filter(Boolean)
        .map((token) => {
            const m = token.match(/^(.*?)(?:\s*x\s*(\d+))?$/i);
            const name = String(m?.[1] || token).trim();
            const qty = Number(m?.[2] || 1);
            return { name, qty: Number.isFinite(qty) && qty > 0 ? qty : 1 };
        })
        .filter((it) => it.name);
};

const buildCommissionBreakdown = async ({ serviceName, grossAmount }) => {
    const gross = Number(grossAmount);
    if (!Number.isFinite(gross) || gross <= 0) {
        return {
            gross_amount: 0,
            admin_commission_amount: 0,
            partner_final_amount: 0,
            commission_breakdown: []
        };
    }

    const items = parseServiceLineItems(serviceName);
    if (!items.length) {
        return {
            gross_amount: round2(gross),
            admin_commission_amount: 0,
            partner_final_amount: round2(gross),
            commission_breakdown: [
                {
                    service_name: String(serviceName || 'Service'),
                    qty: 1,
                    gross_amount: round2(gross),
                    commission_type: 'percentage',
                    commission_value: 0,
                    admin_commission_amount: 0,
                    partner_amount: round2(gross)
                }
            ]
        };
    }

    // Lookup commission config and catalog prices by service_name (best-effort)
    const uniqueNames = Array.from(new Set(items.map((i) => i.name)));
    let serviceRows = [];
    try {
        await ServiceModel.ensureTable();
        const [rows] = await db.query(
            `
        SELECT service_name, base_price, discount_price, commission_type, commission_value, commission_enabled
        FROM services
        WHERE LOWER(service_name) IN (${uniqueNames.map(() => '?').join(',')})
      `,
            uniqueNames.map((n) => String(n).toLowerCase())
        );
        serviceRows = Array.isArray(rows) ? rows : [];
    } catch (_) {
        serviceRows = [];
    }

    const byName = new Map(serviceRows.map((r) => [String(r.service_name || '').toLowerCase(), r]));

    const lineCatalogGross = items.map((it) => {
        const row = byName.get(String(it.name).toLowerCase());
        const base = Number(row?.base_price);
        const discount = Number(row?.discount_price);
        const unit = Number.isFinite(discount) && discount > 0
            ? discount
            : (Number.isFinite(base) && base > 0 ? base : 0);
        const qty = Number(it.qty);
        return {
            name: it.name,
            qty,
            unit_catalog_price: unit,
            catalog_gross: round2(unit * qty),
            commission_type: row?.commission_type || 'percentage',
            commission_value: Number(row?.commission_value || 0),
            commission_enabled: row?.commission_enabled === 0 ? 0 : 1
        };
    });

    const catalogTotal = round2(lineCatalogGross.reduce((sum, r) => sum + (Number.isFinite(r.catalog_gross) ? r.catalog_gross : 0), 0));
    const scale = catalogTotal > 0 ? gross / catalogTotal : 0;

    // Scale catalog gross to billed gross so total equals payment amount
    let billedRunning = 0;
    const billedLines = lineCatalogGross.map((r, idx) => {
        const isLast = idx === lineCatalogGross.length - 1;
        const billedGross = isLast
            ? round2(gross - billedRunning)
            : round2(r.catalog_gross * scale);
        billedRunning = round2(billedRunning + billedGross);

        const enabled = r.commission_enabled === 0 ? 0 : 1;
        const type = String(r.commission_type || 'percentage').toLowerCase() === 'fixed' ? 'fixed' : 'percentage';
        const valueRaw = Number.isFinite(r.commission_value) && r.commission_value >= 0 ? r.commission_value : 0;
        const value = enabled ? valueRaw : 0;

        let commission = 0;
        if (type === 'fixed') {
            commission = round2(value * (Number.isFinite(r.qty) ? r.qty : 1));
        } else {
            commission = round2((billedGross * value) / 100);
        }

        if (commission < 0) commission = 0;
        if (commission > billedGross) commission = billedGross;

        const partnerAmount = round2(billedGross - commission);

        return {
            service_name: r.name,
            qty: r.qty,
            gross_amount: billedGross,
            commission_type: enabled ? type : 'percentage',
            commission_value: enabled ? valueRaw : 0,
            commission_enabled: Boolean(enabled),
            admin_commission_amount: commission,
            partner_amount: partnerAmount
        };
    });

    let totalCommission = round2(billedLines.reduce((sum, r) => sum + (Number.isFinite(r.admin_commission_amount) ? r.admin_commission_amount : 0), 0));
    if (totalCommission > gross && billedLines.length) {
        // Clamp last line commission to avoid negative payout.
        const overflow = round2(totalCommission - gross);
        const last = billedLines[billedLines.length - 1];
        const nextCommission = Math.max(0, round2(last.admin_commission_amount - overflow));
        last.admin_commission_amount = nextCommission;
        last.partner_amount = round2(last.gross_amount - nextCommission);
        totalCommission = round2(gross);
    }

    const net = round2(gross - totalCommission);

    return {
        gross_amount: round2(gross),
        admin_commission_amount: totalCommission,
        partner_final_amount: net < 0 ? 0 : net,
        commission_breakdown: billedLines
    };
};

function normalizeDate(value) {
    const s = String(value || '').trim();
    if (!s) return null;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
}

const parseSlotDateTime = (slotDate, slotTime) => {
    const isoDate = normalizeDate(slotDate);
    const sTime = String(slotTime || '').trim();
    if (!isoDate || !sTime) return null;

    // Prefer numeric parsing to avoid Date.parse quirks.
    const m = sTime.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)?$/i);
    if (m) {
        let hours = Number(m[1]);
        const minutes = Number(m[2] || 0);
        const ampm = m[3] ? String(m[3]).toUpperCase() : null;

        if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
        if (minutes < 0 || minutes > 59) return null;

        if (ampm) {
            hours = hours % 12;
            if (ampm === 'PM') hours += 12;
        }

        if (hours < 0 || hours > 23) return null;

        const [y, mo, d] = isoDate.split('-').map(Number);
        const dt = new Date(y, mo - 1, d, hours, minutes, 0, 0);
        return Number.isNaN(dt.getTime()) ? null : dt;
    }

    // Fallback: let JS try to parse (last resort)
    const dt = new Date(`${isoDate} ${sTime}`);
    return Number.isNaN(dt.getTime()) ? null : dt;
};

function getRazorpayClient() {
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;
    if (!key_id || !key_secret) return null;
    return new Razorpay({ key_id, key_secret });
}

function buildPublicUrl(req, relativePath) {
    const p = String(relativePath || '').trim();
    if (!p) return null;

    // If already a full URL, keep it.
    if (/^https?:\/\//i.test(p)) return p;

    const host = req.get('host');
    if (!host) return null;

    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    const normalized = p.startsWith('/') ? p : `/${p}`;
    return `${proto}://${host}${normalized}`;
}

exports.createOrder = async (req, res) => {
    try {
        if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.log('[payment] req.user:', req.user);
        }

        const razorpay = getRazorpayClient();
        if (!razorpay) {
            // eslint-disable-next-line no-console
            console.error('[payment] createOrder: missing Razorpay keys');
            return res.status(500).json({ error: 'Razorpay keys are not configured' });
        }

        const { amount } = req.body;

        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        const order = await razorpay.orders.create({
            amount: Math.round(numericAmount * 100),
            currency: 'INR',
            receipt: 'order_' + Date.now()
        });

        return res.json({
            id: order.id,
            amount: order.amount,
            currency: order.currency || 'INR'
        });
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[payment] createOrder failed:', err);
        return res.status(500).json({ error: err.message });
    }
};

exports.verifyPayment = async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            bookingData
        } = req.body;

        console.log('[STEP 1] VERIFY PAYMENT START');

        // eslint-disable-next-line no-console
        console.log('[VERIFY PAYMENT INPUT]', {
            booking_id: bookingData?.bookingId ?? bookingData?.booking_id ?? null,
            coupon_id: bookingData?.coupon_id ?? bookingData?.couponId ?? null,
            coupon_code: bookingData?.coupon_code ?? bookingData?.couponCode ?? null,
            coupon_discount: bookingData?.coupon_discount ?? null,
            original_amount: bookingData?.original_amount ?? bookingData?.amount ?? null,
            final_amount_after_discount: bookingData?.final_amount_after_discount ?? null,
            payment_id: razorpay_payment_id || null,
            user_id: req.user.id,
        });

        // eslint-disable-next-line no-console
        console.log('[PAYMENT VERIFY START]', {
            payment_id: razorpay_payment_id || null,
            order_id: razorpay_order_id || null,
            booking_id: bookingData?.bookingId ?? bookingData?.booking_id ?? null,
            coupon_id: bookingData?.coupon_id ?? bookingData?.couponId ?? null,
            coupon_code: bookingData?.coupon_code ?? bookingData?.couponCode ?? null,
            discount_amount: bookingData?.coupon_discount ?? null,
            original_amount: bookingData?.original_amount ?? bookingData?.amount ?? null,
            final_amount: bookingData?.final_amount_after_discount ?? null,
            user_id: req.user.id,
        });

        const userLat = Number(req.body.lat);
        const userLng = Number(req.body.lng);

        // eslint-disable-next-line no-console
        console.log('USER LOCATION:', userLat, userLng);

        if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) {
            console.log('[STEP 1A] EARLY RETURN: LOCATION NOT FOUND');
            return res.status(400).json({ success: false, error: 'Location not found' });
        }

        if (!process.env.RAZORPAY_KEY_SECRET) {
            console.log('[STEP 1B] EARLY RETURN: RAZORPAY SECRET MISSING');
            return res.status(500).json({ success: false, error: 'Razorpay key secret is not configured' });
        }

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            console.log('[STEP 1C] EARLY RETURN: MISSING PAYMENT FIELDS');
            return res.status(400).json({ success: false, error: 'Missing payment fields' });
        }

        const sign = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(razorpay_order_id + '|' + razorpay_payment_id)
            .digest('hex');

        if (sign !== razorpay_signature) {
            console.log('[STEP 1D] EARLY RETURN: INVALID PAYMENT SIGNATURE');
            return res.status(400).json({ success: false, error: 'Invalid payment signature' });
        }

        console.log('[STEP 2] RAZORPAY VERIFIED');

        const serviceName = bookingData?.serviceName ?? null;
        const bookingId = bookingData?.bookingId ?? null;
        const originalAmount = Number(bookingData?.original_amount ?? bookingData?.amount ?? null);
        const couponCode = String(bookingData?.coupon_code ?? bookingData?.couponCode ?? '').trim().toUpperCase();
        const couponId = bookingData?.coupon_id ?? bookingData?.couponId ?? null;
        const couponReconciliation = await CouponController.reconcileBookingCoupon({
            userId: req.user.id,
            bookingId,
            bookingData,
            amount: originalAmount
        });
        // eslint-disable-next-line no-console
        console.log('[COUPON METADATA]', {
            coupon_id: couponReconciliation?.coupon?.id ?? couponId ?? null,
            coupon_code: couponReconciliation?.coupon?.coupon_code ?? couponCode ?? null,
            booking_id: bookingId,
            payment_id: razorpay_payment_id,
            user_id: req.user.id,
            discount_amount: couponReconciliation?.discount_amount ?? null,
            original_amount: originalAmount,
            final_amount: couponReconciliation?.final_amount ?? null,
        });
        const couponDiscount = round2(couponReconciliation.discount_amount || 0);
        const finalAmountAfterDiscount = round2(couponReconciliation.final_amount || originalAmount);

        // eslint-disable-next-line no-console
        console.log('[COUPON VERIFY]', {
            coupon_id: couponReconciliation?.coupon?.id ?? couponId ?? null,
            payment_id: razorpay_payment_id,
            booking_id: bookingId,
            user_id: req.user.id,
            discount: couponDiscount,
        });
        const slotDate = normalizeDate(bookingData?.date ?? bookingData?.slotDate ?? null);
        const slotTime = bookingData?.time ?? bookingData?.slotTime ?? null;
        const bookingTypeHint = String(bookingData?.bookingType ?? bookingData?.booking_type ?? '').trim();
        const serviceModeHint = String(bookingData?.serviceMode ?? bookingData?.service_mode ?? '').trim();
        const salonId = bookingData?.salonId ?? bookingData?.salon_id ?? null;
        const salonName = bookingData?.salonName ?? bookingData?.salon_name ?? null;
        const salonAddress = bookingData?.salonAddress ?? bookingData?.salon_address ?? null;
        const salonLat = Number(bookingData?.salonLat ?? bookingData?.salon_lat ?? bookingData?.lat ?? req.body.lat);
        const salonLng = Number(bookingData?.salonLng ?? bookingData?.salon_lng ?? bookingData?.lng ?? req.body.lng);
        const address = bookingData?.address ?? salonAddress ?? null;

        const bookingDateTime = parseSlotDateTime(slotDate, slotTime);
        if (!bookingDateTime) {
            console.log('[STEP 2A] EARLY RETURN: INVALID SLOT DATE/TIME');
            return res.status(400).json({ success: false, error: 'Invalid slot date/time' });
        }

        const now = new Date();
        const diffMs = bookingDateTime - now;
        const diffMinutes = diffMs / (1000 * 60);

        if (diffMinutes < 0) {
            console.log('[STEP 2B] EARLY RETURN: INVALID PAST BOOKING');
            return res.status(400).json({ success: false, error: 'Invalid past booking' });
        }

        let booking_type = '';
        let service_mode = 'at_home';
        let booking_status = 'pending';

        const isSalonVisit = bookingTypeHint === 'visit_salon' || serviceModeHint === 'visit_salon';

        if (isSalonVisit) {
            booking_type = 'visit_salon';
            service_mode = 'visit_salon';
            booking_status = 'confirmed';
        } else if (diffMinutes <= 30) {
            booking_type = 'instant';
        } else if (diffMinutes <= 180) {
            booking_type = 'near';
        } else {
            booking_type = 'scheduled';
        }

        let dispatch_time;
        if (booking_type === 'instant') {
            dispatch_time = now;
        } else {
            dispatch_time = new Date(bookingDateTime.getTime() - 30 * 60 * 1000);
        }

        if (isSalonVisit) {
            dispatch_time = null;
        }

        const lat = booking_type === 'visit_salon' && Number.isFinite(salonLat) ? salonLat : userLat;
        const lng = booking_type === 'visit_salon' && Number.isFinite(salonLng) ? salonLng : userLng;
        const partnerId = bookingData?.partnerId ?? bookingData?.partner_id ?? null;

        console.log('[STEP 3] BEFORE PAYMENT SAVE');

        // ✅ SAVE IN DB (auto-creates table if missing)
        const createdPayment = await PaymentModel.createPayment({
            userId: req.user.id,
            bookingId,
            serviceName,
            amount: Number.isFinite(finalAmountAfterDiscount) ? round2(finalAmountAfterDiscount) : amount,
            couponId,
            couponCode,
            couponDiscount,
            originalAmount: Number.isFinite(originalAmount) ? round2(originalAmount) : amount,
            finalAmountAfterDiscount,
            transactionId: razorpay_payment_id,
            orderId: razorpay_order_id,
            signature: razorpay_signature,
            status: 'success',
            paymentStatus: 'PAID',
            bookingStatus: booking_status,
            bookingType: booking_type,
            serviceMode: service_mode,
            salonId: salonId ?? null,
            salonName: salonName ?? null,
            salonAddress: salonAddress ?? null,
            dispatchTime: dispatch_time,
            dispatched: 0,
            partnerId: partnerId ?? null,
            lat,
            lng,
            slotDate,
            slotTime,
            address
        });

        // eslint-disable-next-line no-console
        console.log('[PAYMENT SAVED]', createdPayment);

        console.log('[STEP 4] PAYMENT SAVED');

        console.log('[CREATED PAYMENT OBJECT]', createdPayment);

        console.log('[STEP 5] BEFORE BOOKING UPDATE');

        const shouldInsertCouponUsage = true;
        if (shouldInsertCouponUsage) {
            console.log('[STEP 7] BEFORE COUPON INSERT');
            console.log('[COUPON INSERT BLOCK ENTERED]');

            if (createdPayment?.couponId && Number(createdPayment?.couponDiscount || 0) > 0) {
                // eslint-disable-next-line no-console
                console.log('[COUPON USAGE INSERT START]', {
                    coupon_id: createdPayment.couponId,
                    coupon_code: createdPayment.couponCode,
                    booking_id: createdPayment.bookingId,
                    payment_id: createdPayment.id,
                    user_id: createdPayment.userId,
                    discount_amount: createdPayment.couponDiscount,
                    original_amount: createdPayment.originalAmount,
                    final_amount: createdPayment.finalAmountAfterDiscount,
                });

                try {
                    await CouponModel.recordUsage({
                        coupon_id: createdPayment.couponId,
                        coupon_code: createdPayment.couponCode,
                        user_id: createdPayment.userId,
                        booking_id: createdPayment.bookingId,
                        payment_id: createdPayment.id,
                        discount_amount: createdPayment.couponDiscount,
                        original_amount: createdPayment.originalAmount,
                        final_amount: createdPayment.finalAmountAfterDiscount,
                    });

                    // eslint-disable-next-line no-console
                    console.log('[COUPON USAGE INSERT SUCCESS]', {
                        coupon_id: createdPayment.couponId,
                        coupon_code: createdPayment.couponCode,
                        booking_id: createdPayment.bookingId,
                        payment_id: createdPayment.id,
                        user_id: createdPayment.userId,
                        discount_amount: createdPayment.couponDiscount,
                        original_amount: createdPayment.originalAmount,
                        final_amount: createdPayment.finalAmountAfterDiscount,
                    });
                } catch (usageErr) {
                    // eslint-disable-next-line no-console
                    console.log('[COUPON USAGE INSERT FAILED]', {
                        coupon_id: createdPayment.couponId,
                        coupon_code: createdPayment.couponCode,
                        booking_id: createdPayment.bookingId,
                        payment_id: createdPayment.id,
                        user_id: createdPayment.userId,
                        discount_amount: createdPayment.couponDiscount,
                        original_amount: createdPayment.originalAmount,
                        final_amount: createdPayment.finalAmountAfterDiscount,
                        error: usageErr?.message || usageErr,
                    });
                }
            }
            console.log('[STEP 8] COUPON INSERT DONE');
        }

        // eslint-disable-next-line no-console
        console.log('[PAYMENT VERIFY SUCCESS]', {
            payment_id: razorpay_payment_id,
            order_id: razorpay_order_id,
            booking_id: bookingId,
            coupon_id: couponReconciliation?.coupon?.id ?? couponId ?? null,
            coupon_code: couponReconciliation?.coupon?.coupon_code ?? couponCode ?? null,
            user_id: req.user.id,
            discount_amount: couponDiscount,
            original_amount: Number.isFinite(originalAmount) ? round2(originalAmount) : amount,
            final_amount: finalAmountAfterDiscount,
        });

        // For downstream consumers (partner app/user app), keep a consistent field.
        createdPayment.payment_status = 'PAID';
        createdPayment.paymentStatus = 'PAID';

        console.log('[STEP 6] BOOKING UPDATED');

        // ✅ Service-wise commission (best-effort; never blocks payment success)
        try {
            const commissionBaseAmount = Number.isFinite(finalAmountAfterDiscount)
                ? round2(finalAmountAfterDiscount)
                : round2(originalAmount);
            if (Number.isFinite(commissionBaseAmount) && commissionBaseAmount > 0 && createdPayment?.id) {
                const computed = await buildCommissionBreakdown({
                    serviceName,
                    grossAmount: commissionBaseAmount
                });

                await PaymentModel.setCommissionFields(createdPayment.id, {
                    grossAmount: computed.gross_amount,
                    adminCommissionAmount: computed.admin_commission_amount,
                    partnerFinalAmount: computed.partner_final_amount,
                    commissionBreakdown: computed.commission_breakdown
                });

                if (process.env.NODE_ENV !== 'production') {
                    // eslint-disable-next-line no-console
                    console.log('[commission] stored commission fields:', {
                        paymentId: createdPayment.id,
                        gross: computed.gross_amount,
                        commission: computed.admin_commission_amount,
                        net: computed.partner_final_amount,
                        lines: Array.isArray(computed.commission_breakdown)
                            ? computed.commission_breakdown.length
                            : 0
                    });
                }
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[commission] compute/store failed (ignored):', e?.message || e);
        }

        // Keep existing admin/user refresh event (best-effort)
        // IMPORTANT: Do NOT emit to partners here. Partner dispatch is cron-driven.
        try {
            const io = getIO();
            io.emit('bookingCreated', {
                userId: req.user.id,
                bookingId,
                serviceName,
                    amount: Number.isFinite(finalAmountAfterDiscount) ? round2(finalAmountAfterDiscount) : amount,
                    coupon_code: couponCode || null,
                    coupon_discount: couponDiscount,
                    original_amount: Number.isFinite(originalAmount) ? round2(originalAmount) : amount,
                    final_amount_after_discount: finalAmountAfterDiscount,
                transactionId: razorpay_payment_id,
                orderId: razorpay_order_id,
                status: 'success',
                paymentStatus: 'PAID',
                slotDate,
                slotTime,
                address,
                booking_type,
                service_mode,
                salon_id: salonId ?? null,
                salon_name: salonName ?? null,
                salon_address: salonAddress ?? null,
                partner_id: partnerId ?? null,
                dispatch_time: dispatch_time,
                createdAt: new Date().toISOString()
            });

            if (isSalonVisit) {
                const salonBookingPayload = {
                    userId: req.user.id,
                    bookingId,
                    serviceName,
                    amount: Number.isFinite(finalAmountAfterDiscount) ? round2(finalAmountAfterDiscount) : amount,
                    coupon_code: couponCode || null,
                    coupon_discount: couponDiscount,
                    original_amount: Number.isFinite(originalAmount) ? round2(originalAmount) : amount,
                    final_amount_after_discount: finalAmountAfterDiscount,
                    transactionId: razorpay_payment_id,
                    orderId: razorpay_order_id,
                    paymentStatus: 'PAID',
                    bookingStatus: 'confirmed',
                    booking_type: 'visit_salon',
                    bookingType: 'visit_salon',
                    service_mode: 'visit_salon',
                    salon_id: salonId ?? null,
                    salon_name: salonName ?? null,
                    salon_address: salonAddress ?? null,
                    slotDate,
                    slotTime,
                    address,
                    partner_id: partnerId ?? null,
                };

                io.to(`user:${req.user.id}`).emit('salonBookingConfirmed', salonBookingPayload);

                if (partnerId != null) {
                    io.to(`partner:${partnerId}`).emit('salonAppointmentBooking', salonBookingPayload);
                }
            }
        } catch (_) {
            // ignore socket errors
        }

        console.log('[STEP 9] BEFORE RESPONSE');

        return res.json({ success: true });
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[payment] verifyPayment failed:', err);
        return res.status(500).json({ error: err.message });
    }
};

exports.listMyPayments = async (req, res) => {
    try {
        const rows = await PaymentModel.listPaymentsByUser(req.user.id);

        if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.log('[payment] PAYMENT HISTORY API:', {
                userId: req.user?.id,
                count: Array.isArray(rows) ? rows.length : 0,
                sample: Array.isArray(rows) && rows[0] ? rows[0] : null
            });
        }

        return res.json({
            payments: (Array.isArray(rows) ? rows : []).map((r) => ({
                id: r.id,

                // Core IDs / metadata
                booking_id: r.booking_id ?? null,
                transaction_id: r.transaction_id ?? null,
                order_id: r.order_id ?? null,
                // Common alternate names expected by some clients
                razorpay_payment_id: r.transaction_id ?? null,
                razorpay_order_id: r.order_id ?? null,
                payment_id: r.transaction_id ?? null,

                service_name: r.service_name,
                slot_date: normalizeDate(r?.slot_date),
                slot_time: r.slot_time,
                address: r.address,
                amount: Number.isFinite(Number(r.final_amount_after_discount ?? r.amount ?? r.original_amount))
                    ? Number(r.final_amount_after_discount ?? r.amount ?? r.original_amount)
                    : 0,
                original_amount: r.original_amount ?? null,
                final_amount_after_discount: r.final_amount_after_discount ?? null,
                coupon_discount: r.coupon_discount ?? null,

                status: r.status,
                payment_status: r.payment_status ?? null,
                paid_at: r.paid_at ?? null,
                created_at: r.created_at,

                booking_type: r.booking_type ?? null,
                service_mode: r.service_mode ?? null,
                salon_id: r.salon_id ?? null,
                salon_name: r.salon_name ?? null,
                salon_address: r.salon_address ?? null,
                dispatch_time: r.dispatch_time ?? null,
                dispatched: r.dispatched ?? 0,

                partner_payment_status: r.partner_payment_status ?? null,
                utr_number: r.utr_number ?? null,
                payout_id: r.payout_id ?? null,
                payout_status: r.payout_status ?? null,

                partner_id: r.partner_id,
                partner_name: r.partner_name,
                partner_phone: r.partner_phone,
                partner_avatar: r.partner_avatar,

                proof_image: r.proof_image,
                proof_image_path: r.proof_image
                    ? `/uploads/service_proofs/${String(r.proof_image).replace(/^\/+/g, '')}`
                    : null,
                proof_image_url: r.proof_image
                    ? buildPublicUrl(req, `/uploads/service_proofs/${String(r.proof_image).replace(/^\/+/g, '')}`)
                    : null,
                partner_notes: r.partner_notes,
                service_otp: r.service_otp,
                proof_uploaded: r.proof_uploaded ?? null,

                lat: r.lat,
                lng: r.lng,

                booking_status: r.booking_status,
            })),
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
