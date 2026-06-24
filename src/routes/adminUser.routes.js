const express = require('express');
const router = express.Router();

const db = require('../config/db');
const { adminProtect: adminAuth } = require('../middlewares/auth.middleware');

const AdminUserController = {
	getAllUsers: async (req, res, next) => {
		try {
			const [users] = await db.query(`
				SELECT 
					id,
					name,
					mobile,
					email,
					gender,
					city,
					avatar,
					role,
					status,
					created_at,
					updated_at
				FROM users
				ORDER BY created_at DESC
			`);

			return res.json({ users });
		} catch (error) {
			return next(error);
		}
	}
};

router.get('/users', adminAuth, AdminUserController.getAllUsers);

module.exports = router;
