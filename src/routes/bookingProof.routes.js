const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const db = require('../config/db');
const generateOtp = require('../utils/generateOtp');
const { sendExpoNotification } = require('../utils/sendExpoNotification');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'service_proofs');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const type = String(file.mimetype || '').toLowerCase();
    if (type === 'image/jpeg' || type === 'image/jpg' || type === 'image/png') return cb(null, true);
    return cb(new Error('Only JPEG/PNG images are allowed'));
  },
});

// POST /api/booking/upload-proof
router.post('/upload-proof', upload.single('image'), async (req, res, next) => {
  try {
    const { bookingId, notes } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Image is required' });
    }

    const id = Number(bookingId);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ success: false, message: 'bookingId is required' });
    }

    const otp = generateOtp();

    await db.query(
      `UPDATE payments
       SET proof_image = ?, partner_notes = ?, service_otp = ?, proof_uploaded = 1
       WHERE id = ?`,
      [req.file.filename, notes || '', otp, id]
    );

    const [rows] = await db.query('SELECT *, service_name FROM payments WHERE id = ?', [id]);
    const booking = rows && rows[0] ? rows[0] : null;

    // eslint-disable-next-line no-console
    console.log('PROOF + OTP GENERATED:', otp);

    // 🔥 SOCKET EMIT TO USER
    try {
      const io = req.app.get('io');
      if (io && booking?.user_id != null && booking?.id != null) {
        // eslint-disable-next-line no-console
        console.log('EMIT PROOF TO:', `user:${booking.user_id}`);
        io.to(`user:${booking.user_id}`).emit('serviceProofUploaded', {
          bookingId: String(booking.id),
          proof_image: String(req.file.filename || ''),
          notes: String(notes || ''),
          otp: String(otp || '')
        });
      }
    } catch {
      // ignore
    }

    // Send notification to user that proof has been uploaded
    try {
      if (booking?.user_id) {
        const [userRows] = await db.query(
          'SELECT expo_push_token FROM users WHERE id = ?',
          [booking.user_id]
        );
        const userToken = userRows?.[0]?.expo_push_token;
        if (userToken) {
          await sendExpoNotification(
            userToken,
            'Service Proof Received',
            `We've received the proof for your ${booking.service_name} service. Please verify the OTP.`,
            {
              bookingId: booking.id,
              type: 'serviceProofUploaded',
            }
          );
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[upload-proof] Failed to send notification:', err?.message || err);
    }

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// POST /api/booking/verify-otp
router.post('/verify-otp', async (req, res, next) => {
  try {
    const { bookingId, otp } = req.body || {};

    const id = Number(bookingId);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ success: false, message: 'bookingId is required' });
    }

    const code = String(otp || '').trim();
    if (!code) {
      return res.status(400).json({ success: false, message: 'otp is required' });
    }

    const [rows] = await db.query('SELECT service_otp, user_id, service_name, partner_id FROM payments WHERE id = ?', [id]);
    if (!rows || !rows.length) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    if (String(rows[0].service_otp || '') !== code) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    await db.query(
      `UPDATE payments
       SET booking_status = 'completed'
       WHERE id = ?`,
      [id]
    );

    // Send notification to user that service is completed
    try {
      const booking = rows[0];
      const [userRows] = await db.query(
        'SELECT expo_push_token FROM users WHERE id = ?',
        [booking.user_id]
      );
      const userToken = userRows?.[0]?.expo_push_token;
      if (userToken) {
        await sendExpoNotification(
          userToken,
          'Service Completed',
          `Your ${booking.service_name} service has been completed`,
          {
            bookingId: id,
            type: 'serviceCompleted',
          }
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[verify-otp] Failed to send notification:', err?.message || err);
    }

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
