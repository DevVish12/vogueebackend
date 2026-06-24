const express = require('express');
const router = express.Router();

const db = require('../config/db');
const { userProtect, partnerProtect } = require('../middlewares/auth.middleware');
const { errorResponse, successResponse } = require('../utils/response');

// Save user's Expo push token
router.post('/user/save-token', userProtect, async (req, res, next) => {
    try {
        const userId = req.user && req.user.id;
        if (!userId) return errorResponse(res, 401, 'Not authorized, token failed');

        // Accept either { token } or { expo_push_token } from clients
        const token = (req.body && (req.body.token || req.body.expo_push_token)) || null;

        if (!token || typeof token !== 'string') {
            return errorResponse(res, 400, 'Invalid token');
        }

        await db.query('UPDATE users SET expo_push_token = ? WHERE id = ?', [token, userId]);

        // Log success for debugging
        // eslint-disable-next-line no-console
        console.log('✅ Expo token saved for user', userId);

        return res.status(200).json({
            success: true,
            message: 'Expo push token saved successfully',
        });
    } catch (error) {
        // Log full error for debugging
        // eslint-disable-next-line no-console
        console.log(error);
        return next(error);
    }
});

// Save partner's Expo push token
router.post('/partner/save-token', partnerProtect, async (req, res, next) => {
    try {
        const partnerId = req.partner && req.partner.id;
        if (!partnerId) return errorResponse(res, 401, 'Not authorized, token failed');

        const token = (req.body && (req.body.token || req.body.expo_push_token)) || null;
        if (!token || typeof token !== 'string') {
            return errorResponse(res, 400, 'Invalid token');
        }

        await db.query('UPDATE partners SET expo_push_token = ? WHERE id = ?', [token, partnerId]);

        // eslint-disable-next-line no-console
        console.log('✅ Expo token saved for partner', partnerId);

        return res.status(200).json({
            success: true,
            message: 'Expo push token saved successfully',
        });
    } catch (error) {
        // eslint-disable-next-line no-console
        console.log(error);
        return next(error);
    }
});

module.exports = router;
