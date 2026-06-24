const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const BannerController = require('./banner.controller');
const { adminProtect } = require('../../middlewares/auth.middleware');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', '..', 'uploads', 'banners');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      fs.mkdirSync(uploadDir, { recursive: true });
    } catch {
      // ignore
    }
    cb(null, uploadDir);
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
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (!file) return cb(null, true);
    const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    if (isImage) return cb(null, true);
    const err = new Error('Only JPG, PNG, WebP images allowed');
    err.statusCode = 400;
    return cb(err);
  }
});

router.post('/upload', adminProtect, upload.array('images', 10), BannerController.uploadBanner);
// Public read: allows mobile/user apps to fetch banners without admin auth
router.get('/', BannerController.getAllBanners);
router.delete('/:id', adminProtect, BannerController.deleteBanner);

module.exports = router;
