const cron = require('node-cron');
const db = require('../config/db');
const { dispatchPaymentRow } = require('./bookingDispatcher');
const { sendExpoNotification } = require('./sendExpoNotification');

let started = false;

const startBookingDispatchCron = () => {
    if (started) return;
    started = true;

    cron.schedule('* * * * *', async () => {
        try {
            const [rows] = await db.query(`
                SELECT p.*
                FROM payments p
                WHERE p.dispatched = 0
                    AND p.dispatch_time IS NOT NULL
                    AND p.dispatch_time <= NOW()
                    AND p.booking_status = 'pending'
                    AND COALESCE(p.booking_type, '') <> 'visit_salon'
                    AND COALESCE(p.service_mode, '') <> 'visit_salon'
      `);

            const due = Array.isArray(rows) ? rows : [];
            if (!due.length) return;

            for (const booking of due) {
                const id = Number(booking?.id);
                if (!Number.isFinite(id)) continue;

                // Claim row for this process (prevents duplicate dispatch in multi-instance setups)
                // Use dispatched=2 as in-progress (BOOLEAN in MySQL is TINYINT).
                // eslint-disable-next-line no-await-in-loop
                const [claim] = await db.query(
                    'UPDATE payments SET dispatched = 2 WHERE id = ? AND dispatched = 0',
                    [id]
                );

                if (!Number(claim?.affectedRows || 0)) continue;

                try {
                    // eslint-disable-next-line no-await-in-loop
                    await dispatchPaymentRow(booking);
                    // eslint-disable-next-line no-await-in-loop
                    await db.query('UPDATE payments SET dispatched = 1 WHERE id = ?', [id]);
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error('[dispatch-cron] dispatch failed for payment:', id, err?.message || err);
                    // Reset claim so it can be retried on next tick.
                    // eslint-disable-next-line no-await-in-loop
                    await db.query('UPDATE payments SET dispatched = 0 WHERE id = ? AND dispatched = 2', [id]);
                }
            }
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[dispatch-cron] tick failed:', err?.message || err);
        }

        // Send reminder notifications for upcoming bookings (30 minutes before)
        try {
            const thirtyMinutesFromNow = new Date(Date.now() + 30 * 60 * 1000);
            const thirtyFiveMinutesFromNow = new Date(Date.now() + 35 * 60 * 1000);

            const [acceptedBookings] = await db.query(`
                SELECT p.*, u.expo_push_token as user_token, pt.expo_push_token as partner_token
                FROM payments p
                LEFT JOIN users u ON p.user_id = u.id
                LEFT JOIN partners pt ON p.partner_id = pt.id
                WHERE p.booking_status = 'accepted'
                    AND p.slot_date = CURDATE()
                    AND STR_TO_DATE(CONCAT(p.slot_date, ' ', p.slot_time), '%Y-%m-%d %H:%i') BETWEEN ? AND ?
                    AND (p.user_reminder_sent = 0 OR p.user_reminder_sent IS NULL)
                    AND (p.partner_reminder_sent = 0 OR p.partner_reminder_sent IS NULL)
            `, [thirtyMinutesFromNow, thirtyFiveMinutesFromNow]);

            const reminders = Array.isArray(acceptedBookings) ? acceptedBookings : [];
            for (const booking of reminders) {
                const bookingId = Number(booking?.id);
                if (!Number.isFinite(bookingId)) continue;

                try {
                    // Send reminder to user
                    if (booking?.user_token) {
                        // eslint-disable-next-line no-await-in-loop
                        await sendExpoNotification(
                            booking.user_token,
                            'Service Reminder',
                            `Your ${booking.service_name} booking is starting in 30 minutes`,
                            {
                                bookingId: booking.id,
                                type: 'reminder',
                                recipient: 'user',
                            }
                        );
                    }

                    // Send reminder to partner
                    if (booking?.partner_token) {
                        // eslint-disable-next-line no-await-in-loop
                        await sendExpoNotification(
                            booking.partner_token,
                            'Service Reminder',
                            `Your ${booking.service_name} service is starting in 30 minutes`,
                            {
                                bookingId: booking.id,
                                type: 'reminder',
                                recipient: 'partner',
                            }
                        );
                    }

                    // Mark reminders as sent
                    // eslint-disable-next-line no-await-in-loop
                    await db.query(
                        'UPDATE payments SET user_reminder_sent = 1, partner_reminder_sent = 1 WHERE id = ?',
                        [bookingId]
                    );
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.warn('[reminder-cron] failed to send reminder for booking:', bookingId, err?.message || err);
                }
            }
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[reminder-cron] tick failed:', err?.message || err);
        }
    });

    // eslint-disable-next-line no-console
    console.log('✔ booking dispatch cron started (every 1 minute)');
};

module.exports = {
    startBookingDispatchCron,
};
