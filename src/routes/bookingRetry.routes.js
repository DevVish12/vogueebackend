const express = require('express');

const db = require('../config/db');

const router = express.Router();

router.post('/retry', async (req, res, next) => {
    try {
        const { bookingId } = req.body;

        const [rows] = await db.query('SELECT * FROM payments WHERE id=?', [bookingId]);
        if (!rows.length) return res.status(404).json({ error: 'Not found' });

        // Reschedule dispatch via DB+cron.
        // IMPORTANT: Do NOT emit to partners here (prevents early notifications and survives restarts).
        await db.query(
            "UPDATE payments SET booking_status='pending', partner_id=NULL, dispatch_time=NOW(), dispatched=0 WHERE id=?",
            [bookingId]
        );

        // eslint-disable-next-line no-console
        console.log('MANUAL RETRY (scheduled):', bookingId);

        return res.json({ success: true });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
