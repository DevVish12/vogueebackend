const express = require('express');
const controller = require('../modules/coupon/coupon.controller');
const { userProtect } = require('../middlewares/auth.middleware');

const router = express.Router();

router.post('/validate', userProtect, controller.validate);
router.get('/available', userProtect, controller.available);

module.exports = router;