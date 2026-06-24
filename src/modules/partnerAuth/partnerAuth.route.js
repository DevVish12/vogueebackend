const express = require('express');
const router = express.Router();
const PartnerAuthController = require('./partnerAuth.controller');
const { partnerProtect } = require('../../middlewares/auth.middleware');

// Development-only: login/create partner by mobile number (no OTP)
router.post('/dev-login', PartnerAuthController.devLogin);

// OTP Auth Routes
router.post('/send-otp', PartnerAuthController.sendOtp);
router.post('/verify-otp', PartnerAuthController.verifyOtp);
router.post('/resend-otp', PartnerAuthController.resendOtp);

// Current partner profile
router.get('/me', partnerProtect, PartnerAuthController.me);

module.exports = router;
