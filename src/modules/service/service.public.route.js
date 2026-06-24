const express = require('express');
const ServiceService = require('./service.service');

const router = express.Router();

const buildFileUrl = (req, relPath) => {
  if (!relPath) return null;
  const normalized = String(relPath).replace(/\\/g, '/').replace(/^\/+/, '');
  return `${req.protocol}://${req.get('host')}/${normalized}`;
};

const parseImagePaths = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
};

const parseBadges = (raw) => {
  if (!raw) return [];
  const normalizeBadgeName = (b) => {
    if (!b) return '';
    if (typeof b === 'string') return b.trim();
    if (typeof b === 'object') {
      const name = b?.name ?? b?.title ?? b?.label;
      return typeof name === 'string' ? name.trim() : '';
    }
    return '';
  };

  if (Array.isArray(raw)) {
    return raw
      .map(normalizeBadgeName)
      .filter(Boolean);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed)
        ? parsed
            .map(normalizeBadgeName)
            .filter(Boolean)
        : [];
    } catch {
      // Support comma-separated legacy badges strings
      return trimmed
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
};

const parseVariants = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    // Store variants as comma-separated string in many envs
    return trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
};

const toPublicServiceDto = (req, row) => {
  const imagePaths = parseImagePaths(row?.image_paths);
  const pick = row?.banner_image_path || imagePaths[0] || null;

  const price = row?.base_price != null ? Number(row.base_price) : row?.mrp != null ? Number(row.mrp) : null;
  const discountPrice = row?.discount_price != null && row.discount_price !== '' ? Number(row.discount_price) : null;
  const durationMins = row?.duration != null ? Number(row.duration) : null;

  return {
    id: Number(row.id),
    name: row.service_name,
    description: row.description || '',
    category: row.category_name || null,
    price: Number.isFinite(price) ? price : null,
    discountPrice: Number.isFinite(discountPrice) ? discountPrice : null,
    duration: Number.isFinite(durationMins) ? `${durationMins} mins` : null,
    image: buildFileUrl(req, pick),
    badges: parseBadges(row?.badges),
    variants: parseVariants(row?.variants),
    rating: row?.rating == null ? null : Number(row.rating),
    reviews: row?.reviews == null ? null : Number(row.reviews),
    isMVP: Boolean(row.is_mvp),
    isFeatured: Boolean(row.is_featured),
    isQuickRitual: Boolean(row.show_quick),
    status: row.status || 'Active'
  };
};

const toPublicServiceDetailsDto = (req, row) => {
  const imagePaths = parseImagePaths(row?.image_paths);
  const images = imagePaths.map((p) => buildFileUrl(req, p)).filter(Boolean);
  const bannerImage = row?.banner_image_path ? buildFileUrl(req, row.banner_image_path) : null;
  const video = row?.video_path ? buildFileUrl(req, row.video_path) : null;

  const price = row?.base_price != null ? Number(row.base_price) : row?.mrp != null ? Number(row.mrp) : null;
  const discountPrice = row?.discount_price != null && row.discount_price !== '' ? Number(row.discount_price) : null;
  const durationMins = row?.duration != null ? Number(row.duration) : null;

  return {
    id: Number(row.id),
    name: row.service_name,
    description: row.description || '',
    category: row.category_name || null,
    price: Number.isFinite(price) ? price : null,
    discountPrice: Number.isFinite(discountPrice) ? discountPrice : null,
    duration: Number.isFinite(durationMins) ? `${durationMins} mins` : null,
    badges: parseBadges(row?.badges),
    variants: parseVariants(row?.variants),
    images,
    bannerImage,
    video,
    isMVP: Boolean(row.is_mvp),
    isFeatured: Boolean(row.is_featured),
    isQuickRitual: Boolean(row.show_quick),
    rating: row?.rating == null ? null : Number(row.rating),
    reviews: row?.reviews == null ? null : Number(row.reviews),
    status: row.status || 'Active'
  };
};

// PUBLIC: no auth required
// GET /api/services
router.get('/', async (req, res, next) => {
  try {
    const rows = await ServiceService.listServices();
    const list = Array.isArray(rows) ? rows.map((r) => toPublicServiceDto(req, r)) : [];
    res.set('Cache-Control', 'no-store');
    return res.status(200).json(list);
  } catch (err) {
    next(err);
  }
});

// PUBLIC: no auth required
// GET /api/services/:id
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid service id' });
    }

    const row = await ServiceService.getServiceById(id);
    if (!row) {
      return res.status(404).json({ message: 'Service not found' });
    }

    res.set('Cache-Control', 'no-store');
    return res.status(200).json(toPublicServiceDetailsDto(req, row));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
