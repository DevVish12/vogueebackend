const express = require('express');
const path = require('path');
const multer = require('multer');
const ServiceController = require('./service.controller');
const { adminProtect } = require('../../middlewares/auth.middleware');

const router = express.Router();

const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		cb(null, path.join(__dirname, '..', '..', '..', 'uploads', 'services'));
	},
	filename: (req, file, cb) => {
		const mimeToExt = {
			'image/jpeg': '.jpg',
			'image/png': '.png',
			'image/webp': '.webp'
		};

		const extFromMime = mimeToExt[file.mimetype];
		const extFromName = path.extname(file.originalname || '').toLowerCase();
		const safeExt = extFromMime || (['.png', '.jpg', '.jpeg', '.webp'].includes(extFromName) ? extFromName : '.jpg');
		cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
	}
});


const upload = multer({
	storage,
	limits: { fileSize: 20 * 1024 * 1024 }, // 20MB for video
	fileFilter: (req, file, cb) => {
		if (!file) return cb(null, true);
		const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
		const isVideo = file.mimetype && file.mimetype.startsWith('video/');
		if (isImage || isVideo) return cb(null, true);
		const err = new Error('Only JPG, PNG, WebP images or video allowed');
		err.statusCode = 400;
		return cb(err);
	}
});

const multiUpload = upload.fields([
	{ name: 'bannerImage', maxCount: 1 },
	{ name: 'images', maxCount: 10 },
	{ name: 'video', maxCount: 1 }
]);

router.get('/', adminProtect, ServiceController.list);
router.post('/', adminProtect, multiUpload, ServiceController.create);
router.put('/:id', adminProtect, multiUpload, ServiceController.update);
router.patch('/:id/commission', adminProtect, ServiceController.updateCommission);
router.delete('/:id', adminProtect, ServiceController.remove);

module.exports = router;
