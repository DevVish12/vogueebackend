const express = require('express');
const router = express.Router();
const controller = require('./payment.controller');
const { userProtect } = require('../../middlewares/auth.middleware');

router.post('/create-order', userProtect, controller.createOrder);
router.post('/verify', userProtect, controller.verifyPayment);
router.get('/my', userProtect, controller.listMyPayments);

module.exports = router;
