const express = require('express');
const router = express.Router();
const PartnerPaymentController = require('./partnerPayment.controller');
const { partnerProtect } = require('../../middlewares/auth.middleware');

// Save UPI (with verification)
router.post('/save-upi', partnerProtect, PartnerPaymentController.saveUpi);

// Get UPI status
router.get('/status', partnerProtect, PartnerPaymentController.getStatus);

module.exports = router;
