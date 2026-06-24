const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { partnerProtect } = require('../../middlewares/auth.middleware');
const { errorResponse } = require('../../utils/response');
const PartnerKycController = require('./partnerKyc.controller');

const router = express.Router();

// Auth first (required so rate limiter can key by partner id)
router.use(partnerProtect);

// Per-partner rate limit: 5 requests/minute
router.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const id = req.partner?.id ?? req.user?.id;
      if (id) return `partner-${id}`;
      return ipKeyGenerator(req);
    },
    message: 'Too many attempts',
    handler: (req, res, next, options) => {
      const msg = typeof options.message === 'string' ? options.message : 'Too many attempts';
      return errorResponse(res, options.statusCode || 429, msg);
    },
  })
);

const uploadDir = path.join(__dirname, '..', '..', '..', 'uploads', 'kyc');
const salonUploadDir = path.join(uploadDir, 'salon');
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(salonUploadDir, { recursive: true });

const mimeToExt = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const isSalonAsset = file.fieldname === 'salon_logo' || file.fieldname === 'salon_gallery';
    cb(null, isSalonAsset ? salonUploadDir : uploadDir);
  },
  filename: (req, file, cb) => {
    const extFromMime = mimeToExt[file.mimetype];
    const extFromName = path.extname(file.originalname || '').toLowerCase();
    const safeExt = extFromMime || (['.png', '.jpg', '.jpeg', '.pdf'].includes(extFromName) ? extFromName : '.jpg');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB per file
  fileFilter: (req, file, cb) => {
    const isSalonAsset = file.fieldname === 'salon_logo' || file.fieldname === 'salon_gallery';
    const allowedMime = isSalonAsset ? ['image/jpeg', 'image/png'] : ['image/jpeg', 'image/png', 'application/pdf'];

    const ext = require('path').extname(file.originalname || '').toLowerCase();
    const allowedExt = isSalonAsset ? ['.jpg', '.jpeg', '.png'] : ['.jpg', '.jpeg', '.png', '.pdf'];

    if (allowedMime.includes(file.mimetype) || allowedExt.includes(ext)) {
      return cb(null, true);
    }

    const err = new Error('Invalid file type');
    err.statusCode = 400;
    return cb(err);
  },
});

const uploadFields = upload.fields([
  { name: 'aadhaar', maxCount: 1 },
  { name: 'pan', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
  { name: 'certificate', maxCount: 1 },
  { name: 'salon_logo', maxCount: 1 },
  { name: 'salon_gallery', maxCount: 5 },
]);

router.get('/me', PartnerKycController.me);

router.post('/submit', (req, res, next) => {
  uploadFields(req, res, (err) => {
    if (err) {
      // Multer file size errors
      if (err.code === 'LIMIT_FILE_SIZE') {
        err.statusCode = 400;
        err.message = 'File too large (max 2MB)';
      }
      return next(err);
    }
    return next();
  });
}, PartnerKycController.submit);

module.exports = router;
