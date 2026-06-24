const express = require('express');
const AdminDashboardController = require('./adminDashboard.controller');
const { adminProtect } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.get('/dashboard-summary', adminProtect, AdminDashboardController.summary);

module.exports = router;