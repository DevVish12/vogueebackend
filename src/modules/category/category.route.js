const express = require('express');
const path = require('path');
const multer = require('multer');
const CategoryController = require('./category.controller');
const { adminProtect } = require('../../middlewares/auth.middleware');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', '..', '..', 'uploads', 'categories'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ext === '.png' || ext === '.jpg' || ext === '.jpeg' ? ext : '';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file) return cb(null, true);
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') return cb(null, true);
    const err = new Error('Only JPG or PNG allowed');
    err.statusCode = 400;
    return cb(err);
  }
});

router.get('/', adminProtect, CategoryController.list);
router.post('/', adminProtect, upload.single('image'), CategoryController.create);
router.put('/:id', adminProtect, upload.single('image'), CategoryController.update);
router.delete('/:id', adminProtect, CategoryController.remove);

module.exports = router;
