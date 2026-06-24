const db = require('../../config/db');

class PaymentModel {
    static async ensureTable() {
        const createPaymentsTableQuery = `
      CREATE TABLE IF NOT EXISTS payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        booking_id VARCHAR(80) DEFAULT NULL,
        service_name VARCHAR(255) DEFAULT NULL,
        amount DECIMAL(10, 2) DEFAULT NULL,
        coupon_id INT DEFAULT NULL,
        coupon_code VARCHAR(80) DEFAULT NULL,
        coupon_discount DECIMAL(10, 2) DEFAULT NULL,
        original_amount DECIMAL(10, 2) DEFAULT NULL,
        final_amount_after_discount DECIMAL(10, 2) DEFAULT NULL,
                gross_amount DECIMAL(10, 2) DEFAULT NULL,
                admin_commission_amount DECIMAL(10, 2) DEFAULT NULL,
                partner_final_amount DECIMAL(10, 2) DEFAULT NULL,
                commission_breakdown LONGTEXT DEFAULT NULL,
        transaction_id VARCHAR(120) NOT NULL,
        order_id VARCHAR(120) DEFAULT NULL,
        signature VARCHAR(255) DEFAULT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'success',
        payment_status VARCHAR(20) DEFAULT 'PAID',
        booking_status VARCHAR(30) DEFAULT NULL,
                booking_type VARCHAR(20) DEFAULT NULL,
            service_mode VARCHAR(30) DEFAULT NULL,
            salon_id INT DEFAULT NULL,
            salon_name VARCHAR(255) DEFAULT NULL,
            salon_address TEXT DEFAULT NULL,
                dispatch_time DATETIME DEFAULT NULL,
                dispatched TINYINT DEFAULT 0,
        partner_id INT DEFAULT NULL,
                partner_payment_status ENUM('pending','paid') NOT NULL DEFAULT 'pending',
                paid_at DATETIME DEFAULT NULL,
                utr_number VARCHAR(100) DEFAULT NULL,
                payout_id VARCHAR(100) DEFAULT NULL,
                payout_status VARCHAR(50) DEFAULT NULL,
        lat DECIMAL(10, 7) DEFAULT NULL,
        lng DECIMAL(10, 7) DEFAULT NULL,
        slot_date VARCHAR(40) DEFAULT NULL,
        slot_time VARCHAR(40) DEFAULT NULL,
        address TEXT DEFAULT NULL,
        proof_image TEXT DEFAULT NULL,
        partner_notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_transaction_id (transaction_id),
        KEY idx_user_id (user_id)
      )
    `;

        await db.query(createPaymentsTableQuery);

        // Forward-compatible migrations (ignore if column exists)
        const alterQueries = [
            "ALTER TABLE payments ADD COLUMN booking_id VARCHAR(80) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN service_name VARCHAR(255) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN amount DECIMAL(10, 2) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN coupon_id INT DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN coupon_code VARCHAR(80) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN coupon_discount DECIMAL(10, 2) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN original_amount DECIMAL(10, 2) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN final_amount_after_discount DECIMAL(10, 2) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN gross_amount DECIMAL(10, 2) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN admin_commission_amount DECIMAL(10, 2) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN partner_final_amount DECIMAL(10, 2) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN commission_breakdown LONGTEXT DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN transaction_id VARCHAR(120) NOT NULL",
            "ALTER TABLE payments ADD COLUMN order_id VARCHAR(120) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN signature VARCHAR(255) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'success'",
            "ALTER TABLE payments ADD COLUMN payment_status VARCHAR(20) DEFAULT 'PAID'",

            // Booking tracking fields (do not overwrite existing 'status')
            "ALTER TABLE payments ADD COLUMN booking_status VARCHAR(30) DEFAULT NULL",

            // Dispatch scheduling fields
            "ALTER TABLE payments ADD COLUMN booking_type VARCHAR(20) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN service_mode VARCHAR(30) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN salon_id INT DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN salon_name VARCHAR(255) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN salon_address TEXT DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN dispatch_time DATETIME DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN dispatched TINYINT DEFAULT 0",
            "ALTER TABLE payments ADD COLUMN partner_id INT DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN lat DECIMAL(10, 7) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN lng DECIMAL(10, 7) DEFAULT NULL",

            "ALTER TABLE payments ADD COLUMN slot_date VARCHAR(40) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN slot_time VARCHAR(40) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN address TEXT DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN user_reminder_sent TINYINT DEFAULT 0",
            "ALTER TABLE payments ADD COLUMN partner_reminder_sent TINYINT DEFAULT 0",

            // Partner payout tracking (admin manual payouts)
            "ALTER TABLE payments ADD COLUMN partner_payment_status ENUM('pending','paid') NOT NULL DEFAULT 'pending'",
            "ALTER TABLE payments ADD COLUMN paid_at DATETIME DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN utr_number VARCHAR(100) DEFAULT NULL",

            // Razorpay payout tracking
            "ALTER TABLE payments ADD COLUMN payout_id VARCHAR(100) DEFAULT NULL",
            "ALTER TABLE payments ADD COLUMN payout_status VARCHAR(50) DEFAULT NULL",

            // Audit trail (optional)
            "ALTER TABLE payments ADD COLUMN processed_by_admin_id INT DEFAULT NULL"
        ];

        for (const q of alterQueries) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await db.query(q);
            } catch (_) {
                // ignore
            }
        }

        try {
            await db.query(`     ALTER TABLE payments 
    ADD COLUMN proof_image TEXT DEFAULT NULL
  `);
            console.log('✔ proof_image column added');
        } catch (err) {
            if (!err.message.includes('Duplicate column')) {
                console.log('proof_image error:', err.message);
            }
        }

        try {
            await db.query(`     ALTER TABLE payments 
    ADD COLUMN partner_notes TEXT DEFAULT NULL
  `);
            console.log('✔ partner_notes column added');
        } catch (err) {
            if (!err.message.includes('Duplicate column')) {
                console.log('partner_notes error:', err.message);
            }
        }

        try {
            await db.query('CREATE UNIQUE INDEX uniq_transaction_id ON payments (transaction_id)');
        } catch (_) {
            // ignore
        }

        try {
            await db.query('CREATE INDEX idx_user_id ON payments (user_id)');
        } catch (_) {
            // ignore
        }

        // Service completion proof + OTP fields
        try {
            await db.query('ALTER TABLE payments ADD COLUMN service_otp VARCHAR(10) DEFAULT NULL');
        } catch (_) {
            // ignore
        }

        try {
            await db.query('ALTER TABLE payments ADD COLUMN proof_uploaded TINYINT DEFAULT 0');
        } catch (_) {
            // ignore
        }

        try {
            await db.query(`
              ALTER TABLE payments
              MODIFY COLUMN booking_type ENUM('home','salon','visit_salon','instant','near','scheduled') DEFAULT NULL
            `);
        } catch (_) {
            // ignore
        }
    }

    static async createPayment({
        userId,
        bookingId,
        serviceName,
        amount,
        couponId,
        couponCode,
        couponDiscount,
        originalAmount,
        finalAmountAfterDiscount,
        transactionId,
        orderId,
        signature,
        status,
        paymentStatus,
        bookingStatus,
        bookingType,
        serviceMode,
        salonId,
        salonName,
        salonAddress,
        dispatchTime,
        dispatched,
        partnerId,
        lat,
        lng,
        slotDate,
        slotTime,
        address
    }) {
        await this.ensureTable();

        const [result] = await db.query(
            `INSERT INTO payments
        (user_id, booking_id, service_name, amount, coupon_id, coupon_code, coupon_discount, original_amount, final_amount_after_discount, transaction_id, order_id, signature, status, payment_status, booking_status, booking_type, service_mode, salon_id, salon_name, salon_address, dispatch_time, dispatched, partner_id, lat, lng, slot_date, slot_time, address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                userId,
                bookingId ?? null,
                serviceName ?? null,
                amount ?? null,
                couponId ?? null,
                couponCode ?? null,
                couponDiscount ?? null,
                originalAmount ?? null,
                finalAmountAfterDiscount ?? null,
                transactionId,
                orderId ?? null,
                signature ?? null,
                status || 'success',
                paymentStatus || 'PAID',
                bookingStatus ?? null,
                bookingType ?? null,
                serviceMode ?? null,
                salonId ?? null,
                salonName ?? null,
                salonAddress ?? null,
                dispatchTime ?? null,
                dispatched ?? 0,
                partnerId ?? null,
                lat ?? null,
                lng ?? null,
                slotDate ?? null,
                slotTime ?? null,
                address ?? null
            ]
        );

        return {
            id: result?.insertId,
            userId,
            bookingId: bookingId ?? null,
            serviceName: serviceName ?? null,
            amount: amount ?? null,
            couponId: couponId ?? null,
            couponCode: couponCode ?? null,
            couponDiscount: couponDiscount ?? null,
            originalAmount: originalAmount ?? null,
            finalAmountAfterDiscount: finalAmountAfterDiscount ?? null,
            status: status || 'success',
            payment_status: paymentStatus || 'PAID',
            bookingStatus: bookingStatus ?? null,
            booking_type: bookingType ?? null,
            service_mode: serviceMode ?? null,
            salon_id: salonId ?? null,
            salon_name: salonName ?? null,
            salon_address: salonAddress ?? null,
            dispatch_time: dispatchTime ?? null,
            dispatched: dispatched ?? 0,
            partnerId: partnerId ?? null,
            lat: lat ?? null,
            lng: lng ?? null,
            slotDate: slotDate ?? null,
            slotTime: slotTime ?? null,
            address: address ?? null,
            transactionId,
            orderId: orderId ?? null,
            createdAt: new Date().toISOString()
        };
    }

    static async setCommissionFields(paymentId, {
        grossAmount,
        adminCommissionAmount,
        partnerFinalAmount,
        commissionBreakdown
    }) {
        await this.ensureTable();

        const pid = Number(paymentId);
        if (!Number.isFinite(pid)) return { affectedRows: 0 };

        const g = grossAmount === '' || grossAmount === null || typeof grossAmount === 'undefined'
            ? null
            : Number(grossAmount);
        const c = adminCommissionAmount === '' || adminCommissionAmount === null || typeof adminCommissionAmount === 'undefined'
            ? null
            : Number(adminCommissionAmount);
        const n = partnerFinalAmount === '' || partnerFinalAmount === null || typeof partnerFinalAmount === 'undefined'
            ? null
            : Number(partnerFinalAmount);
        const breakdown = typeof commissionBreakdown === 'string'
            ? commissionBreakdown
            : (commissionBreakdown ? JSON.stringify(commissionBreakdown) : null);

        const [result] = await db.query(
            `
        UPDATE payments
        SET gross_amount = ?, admin_commission_amount = ?, partner_final_amount = ?, commission_breakdown = ?
        WHERE id = ?
      `,
            [
                Number.isFinite(g) ? g : null,
                Number.isFinite(c) ? c : null,
                Number.isFinite(n) ? n : null,
                breakdown,
                pid
            ]
        );

        return { affectedRows: result?.affectedRows || 0 };
    }

    static async getById(id) {
        await this.ensureTable();
        const pid = Number(id);
        if (!Number.isFinite(pid)) return null;

        const [rows] = await db.query(
            `
      SELECT
        id,
        user_id,
        booking_id,
        service_name,
        amount,
    coupon_id,
    coupon_code,
    coupon_discount,
    original_amount,
    final_amount_after_discount,
        status,
        payment_status,
        booking_status,
        booking_type,
        service_mode,
        salon_id,
        salon_name,
        salon_address,
        dispatch_time,
        dispatched,
        partner_id,
        lat,
        lng,
        transaction_id,
        order_id,
        slot_date,
        slot_time,
        address,
        created_at
      FROM payments
      WHERE id = ?
      LIMIT 1
      `,
            [pid]
        );

        return rows && rows[0] ? rows[0] : null;
    }

    static async getByBookingId(bookingId) {
        await this.ensureTable();
        const bid = bookingId == null ? '' : String(bookingId).trim();
        if (!bid) return null;

        const [rows] = await db.query(
            `
      SELECT
        id,
        user_id,
        booking_id,
        service_name,
        amount,
    coupon_id,
    coupon_code,
    coupon_discount,
    original_amount,
    final_amount_after_discount,
        status,
        payment_status,
        booking_status,
        booking_type,
        service_mode,
        salon_id,
        salon_name,
        salon_address,
        dispatch_time,
        dispatched,
        partner_id,
        lat,
        lng,
        transaction_id,
        order_id,
        slot_date,
        slot_time,
        address,
        created_at
      FROM payments
      WHERE booking_id = ?
      ORDER BY created_at DESC
      LIMIT 1
      `,
            [bid]
        );

        return rows && rows[0] ? rows[0] : null;
    }

    static async updateBookingStatusById(id, bookingStatus, partnerId = null) {
        await this.ensureTable();
        const pid = Number(id);
        if (!Number.isFinite(pid)) return false;

        await db.query(
            `UPDATE payments SET booking_status = ?, partner_id = COALESCE(?, partner_id) WHERE id = ?`,
            [bookingStatus ?? null, partnerId, pid]
        );
        return true;
    }

    static async updateBookingStatusByBookingId(bookingId, bookingStatus, partnerId = null) {
        await this.ensureTable();
        const bid = bookingId == null ? '' : String(bookingId).trim();
        if (!bid) return false;

        await db.query(
            `UPDATE payments SET booking_status = ?, partner_id = COALESCE(?, partner_id) WHERE booking_id = ?`,
            [bookingStatus ?? null, partnerId, bid]
        );
        return true;
    }

    /**
     * Atomically accept a booking by payments.id, only if it's still searching.
     * Returns true if this call won the race.
     */
    static async tryAcceptBookingById(id, partnerId) {
        await this.ensureTable();
        const pid = Number(id);
        const partner = Number(partnerId);
        if (!Number.isFinite(pid) || !Number.isFinite(partner)) return false;

        const [result] = await db.query(
            `
      UPDATE payments
      SET booking_status = 'accepted', partner_id = ?
      WHERE id = ?
        AND booking_status = 'searching'
        AND (partner_id IS NULL OR partner_id = 0)
      `,
            [partner, pid]
        );

        return Number(result?.affectedRows || 0) > 0;
    }

    /**
     * Atomically accept a booking by payments.booking_id, only if it's still searching.
     * Returns true if this call won the race.
     */
    static async tryAcceptBookingByBookingId(bookingId, partnerId) {
        await this.ensureTable();
        const bid = bookingId == null ? '' : String(bookingId).trim();
        const partner = Number(partnerId);
        if (!bid || !Number.isFinite(partner)) return false;

        const [result] = await db.query(
            `
      UPDATE payments
      SET booking_status = 'accepted', partner_id = ?
      WHERE booking_id = ?
        AND booking_status = 'searching'
        AND (partner_id IS NULL OR partner_id = 0)
      `,
            [partner, bid]
        );

        return Number(result?.affectedRows || 0) > 0;
    }

    static async listPaymentsByUser(userId) {
        await this.ensureTable();
        const uid = Number(userId);
        if (!Number.isFinite(uid)) return [];

        const [rows] = await db.query(
            `
      SELECT
        p.id,
        p.booking_id,
        p.service_name,
        p.amount,
                p.coupon_id,
                p.coupon_code,
                p.coupon_discount,
                p.original_amount,
                p.final_amount_after_discount,
        p.status,
        p.payment_status,
        p.booking_status,
        p.booking_type,
            p.service_mode,
            p.salon_id,
            p.salon_name,
            p.salon_address,
        p.dispatch_time,
        p.dispatched,
        p.partner_id,
        p.partner_payment_status,
        p.paid_at,
        p.utr_number,
        p.payout_id,
        p.payout_status,
        p.lat,
        p.lng,
        p.transaction_id,
        p.order_id,
        p.slot_date,
        p.slot_time,
        p.address,
        p.proof_image,
        p.partner_notes,
        p.service_otp,
        p.proof_uploaded,
        COALESCE(pk.full_name, pa.name) AS partner_name,
        pa.mobile AS partner_phone,
        COALESCE(pa.avatar, pk.selfie_url) AS partner_avatar,
        p.created_at
      FROM payments p
      LEFT JOIN partners pa ON p.partner_id = pa.id
      LEFT JOIN partner_kyc pk ON pk.partner_id = pa.id
      WHERE p.user_id = ?
      ORDER BY p.created_at DESC
      `,
            [uid]
        );

        return rows;
    }

    static async getUnassignedBookings() {
        await this.ensureTable();

        const [rows] = await db.query(
            `
      SELECT
        id,
        user_id,
        booking_id,
        service_name,
        amount,
        status,
        booking_status,
        partner_id,
        lat,
        lng,
        transaction_id,
        order_id,
        slot_date,
        slot_time,
        address,
        created_at
      FROM payments
      WHERE booking_status = 'no_partner'
      ORDER BY created_at DESC
      `
        );

        return rows;
    }
}

module.exports = PaymentModel;
