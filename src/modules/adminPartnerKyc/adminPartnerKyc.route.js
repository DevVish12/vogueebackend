const express = require('express');
const AdminPartnerKycController = require('./adminPartnerKyc.controller');
const { adminProtect } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.get('/', adminProtect, AdminPartnerKycController.list);
router.patch('/:id/status', adminProtect, AdminPartnerKycController.updateStatus);

// Secure document access for admin modal (do not expose uploads/kyc publicly)
router.get('/:id/file/:docType', adminProtect, AdminPartnerKycController.downloadDocument);

module.exports = router;
