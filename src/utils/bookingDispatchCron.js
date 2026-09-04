


// const cron = require('node-cron');
// const db = require('../config/db');
// const { dispatchPaymentRow } = require('./bookingDispatcher');
// const { sendExpoNotification } = require('./sendExpoNotification');

// let started = false;

// const startBookingDispatchCron = () => {
//     if (started) return;
//     started = true;

//     cron.schedule('* * * * *', async () => {
//         try {
//             const [rows] = await db.query(`
//                 SELECT p.*
//                 FROM payments p
//                 WHERE p.dispatched = 0
//                     AND p.dispatch_time IS NOT NULL
//                     AND p.dispatch_time <= NOW()
//                     AND p.booking_status = 'pending'
//                     AND COALESCE(p.booking_type, '') <> 'visit_salon'
//                     AND COALESCE(p.service_mode, '') <> 'visit_salon'
//       `);

//             const due = Array.isArray(rows) ? rows : [];
//             if (!due.length) return;

//             for (const booking of due) {
//                 const id = Number(booking?.id);
//                 if (!Number.isFinite(id)) continue;

//                 // Claim row for this process (prevents duplicate dispatch in multi-instance setups)
//                 // Use dispatched=2 as in-progress (BOOLEAN in MySQL is TINYINT).
//                 // eslint-disable-next-line no-await-in-loop
//                 const [claim] = await db.query(
//                     'UPDATE payments SET dispatched = 2 WHERE id = ? AND dispatched = 0',
//                     [id]
//                 );

//                 if (!Number(claim?.affectedRows || 0)) continue;

//                 try {
//                     // eslint-disable-next-line no-await-in-loop
//                     await dispatchPaymentRow(booking);
//                     // eslint-disable-next-line no-await-in-loop
//                     await db.query('UPDATE payments SET dispatched = 1 WHERE id = ?', [id]);
//                 } catch (err) {
//                     // eslint-disable-next-line no-console
//                     console.error('[dispatch-cron] dispatch failed for payment:', id, err?.message || err);
//                     // Reset claim so it can be retried on next tick.
//                     // eslint-disable-next-line no-await-in-loop
//                     await db.query('UPDATE payments SET dispatched = 0 WHERE id = ? AND dispatched = 2', [id]);
//                 }
//             }
//         } catch (err) {
//             // eslint-disable-next-line no-console
//             console.error('[dispatch-cron] tick failed:', err?.message || err);
//         }

//         // Send one reminder for accepted scheduled bookings one hour before service.
//         try {
//             const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
//             const sixtyFiveMinutesFromNow = new Date(Date.now() + 65 * 60 * 1000);

//             const [acceptedBookings] = await db.query(`
//                 SELECT p.*, u.expo_push_token as user_token
//                 FROM payments p
//                 LEFT JOIN users u ON p.user_id = u.id
//                 WHERE p.booking_status = 'accepted'
//                     AND p.slot_date IS NOT NULL
//                     AND p.slot_time IS NOT NULL
//                     AND STR_TO_DATE(CONCAT(p.slot_date, ' ', p.slot_time), '%Y-%m-%d %H:%i') BETWEEN ? AND ?
//                     AND (p.user_reminder_sent = 0 OR p.user_reminder_sent IS NULL)
//             `, [oneHourFromNow, sixtyFiveMinutesFromNow]);

//             const reminders = Array.isArray(acceptedBookings) ? acceptedBookings : [];
//             for (const booking of reminders) {
//                 const bookingId = Number(booking?.id);
//                 if (!Number.isFinite(bookingId)) continue;

//                 try {
//                     const [claim] = await db.query(
//                         'UPDATE payments SET user_reminder_sent = 2 WHERE id = ? AND (user_reminder_sent = 0 OR user_reminder_sent IS NULL) AND booking_status NOT IN (\'cancelled\', \'canceled\', \'completed\')',
//                         [bookingId]
//                     );
//                     if (!Number(claim?.affectedRows || 0)) continue;

//                     if (booking?.user_token) {
//                         void sendExpoNotification(
//                             booking.user_token,
//                             'Service Starts in 1 Hour',
//                             `Your ${booking.service_name || 'service'} service starts in 1 hour.`,
//                             {
//                                 bookingId: booking.booking_id || booking.id,
//                                 screen: 'BookingDetails',
//                             },
//                             {
//                                 type: 'SERVICE_REMINDER',
//                                 eventId: `booking_${booking.booking_id || booking.id}_REMINDER_1H`,
//                                 recipientId: booking.user_id,
//                                 recipientRole: 'user',
//                             }
//                         ).catch(() => { });
//                     }

//                     await db.query('UPDATE payments SET user_reminder_sent = 1 WHERE id = ? AND user_reminder_sent = 2', [bookingId]);
//                 } catch (err) {
//                     await db.query('UPDATE payments SET user_reminder_sent = 0 WHERE id = ? AND user_reminder_sent = 2', [bookingId]).catch(() => { });
//                     // eslint-disable-next-line no-console
//                     console.warn('[reminder-cron] failed to send reminder for booking:', bookingId, err?.message || err);
//                 }
//             }
//         } catch (err) {
//             // eslint-disable-next-line no-console
//             console.error('[reminder-cron] tick failed:', err?.message || err);
//         }
//     });

//     // eslint-disable-next-line no-console
//     console.log('✔ booking dispatch cron started (every 1 minute)');
// };

// module.exports = {
//     startBookingDispatchCron,
// };


const cron = require('node-cron');
const db = require('../config/db');
const { dispatchPaymentRowOnce } = require('./bookingDispatcher');
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

                try {
                    // eslint-disable-next-line no-await-in-loop
                    await dispatchPaymentRowOnce(id);
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error('[dispatch-cron] dispatch failed for payment:', id, err?.message || err);
                }
            }
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[dispatch-cron] tick failed:', err?.message || err);
        }

        // Send one reminder for accepted scheduled bookings one hour before service.
        try {
            const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
            const sixtyFiveMinutesFromNow = new Date(Date.now() + 65 * 60 * 1000);

            const [acceptedBookings] = await db.query(`
                SELECT p.*, u.expo_push_token as user_token
                FROM payments p
                LEFT JOIN users u ON p.user_id = u.id
                WHERE p.booking_status = 'accepted'
                    AND p.slot_date IS NOT NULL
                    AND p.slot_time IS NOT NULL
                    AND STR_TO_DATE(CONCAT(p.slot_date, ' ', p.slot_time), '%Y-%m-%d %H:%i') BETWEEN ? AND ?
                    AND (p.user_reminder_sent = 0 OR p.user_reminder_sent IS NULL)
            `, [oneHourFromNow, sixtyFiveMinutesFromNow]);

            const reminders = Array.isArray(acceptedBookings) ? acceptedBookings : [];
            for (const booking of reminders) {
                const bookingId = Number(booking?.id);
                if (!Number.isFinite(bookingId)) continue;

                try {
                    const [claim] = await db.query(
                        'UPDATE payments SET user_reminder_sent = 2 WHERE id = ? AND (user_reminder_sent = 0 OR user_reminder_sent IS NULL) AND booking_status NOT IN (\'cancelled\', \'canceled\', \'completed\')',
                        [bookingId]
                    );
                    if (!Number(claim?.affectedRows || 0)) continue;

                    if (booking?.user_token) {
                        void sendExpoNotification(
                            booking.user_token,
                            'Service Starts in 1 Hour',
                            `Your ${booking.service_name || 'service'} service starts in 1 hour.`,
                            {
                                bookingId: booking.booking_id || booking.id,
                                screen: 'BookingDetails',
                            },
                            {
                                type: 'SERVICE_REMINDER',
                                eventId: `booking_${booking.booking_id || booking.id}_REMINDER_1H`,
                                recipientId: booking.user_id,
                                recipientRole: 'user',
                            }
                        ).catch(() => { });
                    }

                    await db.query('UPDATE payments SET user_reminder_sent = 1 WHERE id = ? AND user_reminder_sent = 2', [bookingId]);
                } catch (err) {
                    await db.query('UPDATE payments SET user_reminder_sent = 0 WHERE id = ? AND user_reminder_sent = 2', [bookingId]).catch(() => { });
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
