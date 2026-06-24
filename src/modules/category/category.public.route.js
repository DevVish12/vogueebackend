const express = require('express');
const CategoryService = require('./category.service');

const router = express.Router();

const normalizeImagePath = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;

  const cleaned = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  if (cleaned.startsWith('uploads/')) return cleaned;

  const fileName = cleaned.split('/').pop();
  return fileName ? `uploads/categories/${fileName}` : '';
};

const toPublicCategoryDto = (req, row) => {
  const normalizedPath = normalizeImagePath(row?.image_path);
  const image = normalizedPath
    ? `${req.protocol}://${req.get('host')}/${normalizedPath}`
    : null;

  return {
    id: Number(row.id),
    name: row.name,
    image
  };
};

// PUBLIC: no auth required
// GET /api/categories
router.get('/', async (req, res, next) => {
  try {
    const rows = await CategoryService.listCategories();
    const data = Array.isArray(rows) ? rows.map((r) => toPublicCategoryDto(req, r)) : [];
    res.set('Cache-Control', 'no-store');
    return res.status(200).json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
