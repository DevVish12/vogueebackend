const express = require('express');
const router = express.Router();
const UserAuthController = require('./userAuth.controller');
const { userProtect } = require('../../middlewares/auth.middleware');
const upload = require('../../middlewares/upload');

// Development-only: login/create user by mobile number (no OTP)
router.post('/dev-login', UserAuthController.devLogin);

// Real OTP flow routes
router.post('/send-otp', UserAuthController.sendOtp);
router.post('/resend-otp', UserAuthController.resendOtp);
router.post('/verify-otp', UserAuthController.verifyOtp);

// Required profile completion (name + gender)
router.patch('/profile', userProtect, UserAuthController.updateProfile);

// Profile image upload (optional)
router.patch(
	'/profile/image',
	userProtect,
	upload.single('avatar'),
	UserAuthController.uploadProfileImage
);

module.exports = router;
