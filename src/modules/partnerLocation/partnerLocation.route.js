const express = require('express');
const { partnerProtect } = require('../../middlewares/auth.middleware');
const PartnerLocationController = require('./partnerLocation.controller');

const router = express.Router();

router.use(partnerProtect);

router.get('/me', PartnerLocationController.me);
router.post('/update', PartnerLocationController.update);

module.exports = router;
