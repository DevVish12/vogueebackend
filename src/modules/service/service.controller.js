const ServiceService = require('./service.service');
const { serviceCreateSchema, serviceUpdateSchema } = require('./service.validation');
const { successResponse, errorResponse } = require('../../utils/response');
const { getIO } = require('../../../socket/socket');
const SOCKET_EVENTS = require('../../../server/constants/socketEvents');

const emitServiceUpdated = (payload) => {
  try {
    getIO().emit('serviceUpdated', payload);
  } catch {
    // socket not initialized (or disabled) - ignore
  }
};


const buildFileUrl = (req, relPath) => {
  if (!relPath) return null;
  return `${req.protocol}://${req.get('host')}/${String(relPath).replace(/\\/g, '/')}`;
};

const buildImageUrls = (req, imagePaths) => {
  const paths = Array.isArray(imagePaths) ? imagePaths : [];
  return paths
    .filter(Boolean)
    .map((p) => buildFileUrl(req, p));
};

const toPublicService = (req, row) => {
  if (!row) return row;
  let imagePaths = [];
  if (row.image_paths) {
    try {
      const parsed = JSON.parse(row.image_paths);
      imagePaths = Array.isArray(parsed) ? parsed : [];
    } catch {
      imagePaths = [];
    }
  }
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name || null,
    serviceName: row.service_name,
    description: row.description,
    basePrice: Number(row.base_price),
    discountPrice: Number(row.discount_price),
    commissionType: row.commission_type || 'percentage',
    commissionValue: Number(row.commission_value || 0),
    commissionEnabled: row.commission_enabled === 0 ? false : true,
    duration: Number(row.duration),
    variants: row.variants || '',
    isMVP: Boolean(row.is_mvp),
    isFeatured: Boolean(row.is_featured),
    badges: (() => { try { return JSON.parse(row.badges); } catch { return []; } })(),
    // showSeasonal: Boolean(row.show_seasonal), // Removed as per requirements
    showQuick: Boolean(row.show_quick),
    rating: row.rating,
    reviews: row.reviews,
    status: row.status,
    imagePaths,
    imageUrls: buildImageUrls(req, imagePaths),
    bannerImagePath: row.banner_image_path || null,
    bannerImageUrl: buildFileUrl(req, row.banner_image_path),
    videoPath: row.video_path || null,
    videoUrl: buildFileUrl(req, row.video_path),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

const normalizeBody = (body) => {
  const b = body && typeof body === 'object' ? body : {};
  const toNullIfEmpty = (v) => {
    if (v === '' || v === null || typeof v === 'undefined') return null;
    return v;
  };
  const parseBool = (v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v === 1;
    if (typeof v === 'string') return ['true', '1', 'yes', 'on'].includes(v.toLowerCase());
    return false;
  };

  return {
    // Support both camelCase and snake_case payloads (and legacy chapter id keys)
    categoryId: typeof b.categoryId !== 'undefined'
      ? b.categoryId
      : (typeof b.category_id !== 'undefined'
        ? b.category_id
        : (typeof b.chapter_id !== 'undefined'
          ? b.chapter_id
          : b.chapterId)),
    serviceName: b.serviceName,
    description: b.description,
    basePrice: b.basePrice,
    discountPrice: toNullIfEmpty(b.discountPrice),
    commissionType: b.commissionType,
    commissionValue: toNullIfEmpty(b.commissionValue),
    commissionEnabled: typeof b.commissionEnabled === 'undefined' ? undefined : parseBool(b.commissionEnabled),
    duration: b.duration,
    variants: b.variants,
    isMVP: parseBool(b.isMVP),
    isFeatured: parseBool(b.isFeatured),
    badges: b.badges,
    // showSeasonal: parseBool(b.showSeasonal), // Removed as per requirements
    showQuick: parseBool(b.showQuick),
    rating: toNullIfEmpty(b.rating),
    reviews: toNullIfEmpty(b.reviews),
    status: b.status
  };
};

const shouldKeepBanner = (body) => {
  const v = body?.keepBanner;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
  return false;
};

const parseExistingImagePaths = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const normalizeUploadsRelativePath = (value) => {
  if (!value) return null;
  if (typeof value !== 'string') return null;

  const raw = value.trim();
  if (!raw) return null;

  const extractFromPath = (pathname) => {
    if (!pathname || typeof pathname !== 'string') return null;
    const cleaned = pathname.replace(/\\/g, '/');
    const idx = cleaned.indexOf('uploads/');
    if (idx === -1) return null;
    return cleaned.slice(idx);
  };

  // Already a relative uploads path
  if (raw.startsWith('uploads/')) return raw;

  // Absolute path-like
  const extracted = extractFromPath(raw.startsWith('/') ? raw.slice(1) : raw);
  if (extracted) return extracted;

  // Absolute URL
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const fromUrl = extractFromPath(String(u.pathname || '').replace(/^\//, ''));
      return fromUrl;
    } catch {
      return null;
    }
  }

  return null;
};

class ServiceController {
  static async list(req, res, next) {
    try {
      const rows = await ServiceService.listServices();
      return successResponse(res, 200, 'Services fetched', rows.map((r) => toPublicService(req, r)));
    } catch (err) {
      next(err);
    }
  }

  static async create(req, res, next) {
    try {
      const normalized = normalizeBody(req.body);

      const categoryIdNum = Number(normalized?.categoryId);
      if (!Number.isFinite(categoryIdNum) || categoryIdNum <= 0) {
        return errorResponse(res, 400, 'Category is required');
      }

      // Production-safe debug logging (disabled by default)
      const debugLogEnabled =
        process.env.SERVICE_CREATE_DEBUG === '1' ||
        String(req.headers['x-service-create-debug'] || '').toLowerCase() === '1';
      if (debugLogEnabled) {
        try {
          console.log('SERVICE CREATE BODY KEYS:', Object.keys(req.body || {}));
          console.log('CATEGORY ID:', normalized?.categoryId);
        } catch {
          // ignore
        }
      }

      if (typeof req.headers['x-debug'] !== 'undefined') {
        return successResponse(res, 200, 'Debug create payload', {
          body: req.body,
          normalized
        });
      }

      const { error, value } = serviceCreateSchema.validate(normalized, { abortEarly: false, convert: true });
      if (error) {
        const errors = error.details.map((d) => d.message);
        return errorResponse(res, 400, 'Validation Error', errors);
      }

      // Handle files
      const files = req.files || {};
      const images = Array.isArray(files.images) ? files.images : [];
      const bannerImage = Array.isArray(files.bannerImage) ? files.bannerImage[0] : null;
      const video = Array.isArray(files.video) ? files.video[0] : null;

      const uploadedPaths = images.map((f) => `uploads/services/${f.filename}`);
      const bannerImagePath = bannerImage ? `uploads/services/${bannerImage.filename}` : null;
      const videoPath = video ? `uploads/services/${video.filename}` : null;

      const created = await ServiceService.createService({
        ...value,
        imagePaths: uploadedPaths,
        bannerImagePath,
        videoPath
      });

      emitServiceUpdated({
        action: 'add',
        id: created?.id || null
      });
      return successResponse(res, 201, 'Service created', toPublicService(req, created));
    } catch (err) {
      next(err);
    }
  }

  static async update(req, res, next) {
    try {
      const { id } = req.params;
      const normalized = normalizeBody(req.body);

      if (typeof req.headers['x-debug'] !== 'undefined') {
        return successResponse(res, 200, 'Debug update payload', {
          id,
          body: req.body,
          normalized
        });
      }

      const { error, value } = serviceUpdateSchema.validate(normalized, { abortEarly: false, convert: true });
      if (error) {
        const errors = error.details.map((d) => d.message);
        return errorResponse(res, 400, 'Validation Error', errors);
      }

      const existing = await ServiceService.getServiceById(Number(id));
      if (!existing) {
        return errorResponse(res, 404, 'Service not found');
      }

      const commissionType = typeof value?.commissionType === 'undefined' ? (existing.commission_type || 'percentage') : value.commissionType;
      const commissionValue = typeof value?.commissionValue === 'undefined' ? Number(existing.commission_value || 0) : value.commissionValue;
      const commissionEnabled = typeof value?.commissionEnabled === 'undefined' ? (existing.commission_enabled === 0 ? false : true) : value.commissionEnabled;

      // Handle files
      const files = req.files || {};
      const images = Array.isArray(files.images) ? files.images : [];
      const bannerImage = Array.isArray(files.bannerImage) ? files.bannerImage[0] : null;
      const video = Array.isArray(files.video) ? files.video[0] : null;

      const keptPaths = parseExistingImagePaths(req.body?.existingImagePaths);
      const uploadedPaths = images.map((f) => `uploads/services/${f.filename}`);
      const nextImagePaths = [...keptPaths, ...uploadedPaths];
      const existingBannerFromBody = normalizeUploadsRelativePath(
        req.body?.existingBannerImage || req.body?.bannerImagePath
      );
      const bannerImagePath = bannerImage
        ? `uploads/services/${bannerImage.filename}`
        : (existingBannerFromBody || (shouldKeepBanner(req.body) ? existing.banner_image_path : null) || null);
      const videoPath = video ? `uploads/services/${video.filename}` : req.body.videoPath || null;

      const updated = await ServiceService.updateService(Number(id), {
        ...value,
        commissionType,
        commissionValue,
        commissionEnabled,
        imagePaths: nextImagePaths,
        bannerImagePath,
        videoPath
      });

      emitServiceUpdated({
        action: 'update',
        id: updated?.id || Number(id) || null
      });
      return successResponse(res, 200, 'Service updated', toPublicService(req, updated));
    } catch (err) {
      next(err);
    }
  }

  static async remove(req, res, next) {
    try {
      const { id } = req.params;
      const result = await ServiceService.deleteService(Number(id));

      emitServiceUpdated({
        action: 'delete',
        id: Number(id) || null
      });
      return successResponse(res, 200, result.message);
    } catch (err) {
      next(err);
    }
  }

  static async updateCommission(req, res, next) {
    try {
      const { id } = req.params;
      const normalized = normalizeBody(req.body);

      const commissionType = normalized.commissionType;
      const commissionValue = normalized.commissionValue;
      const commissionEnabled = typeof normalized.commissionEnabled === 'undefined' ? true : normalized.commissionEnabled;

      const existing = await ServiceService.getServiceById(Number(id));
      if (!existing) {
        return errorResponse(res, 404, 'Service not found');
      }

      const effectivePrice = Number(existing.discount_price || existing.base_price || 0);

      const ct = String(commissionType || existing.commission_type || 'percentage').toLowerCase();
      const finalCommissionType = ct === 'fixed' ? 'fixed' : 'percentage';
      const rawValue = commissionValue === '' || commissionValue === null || typeof commissionValue === 'undefined'
        ? Number(existing.commission_value || 0)
        : Number(commissionValue);

      const finalCommissionValue = Number.isFinite(rawValue) && rawValue >= 0 ? rawValue : 0;

      if (finalCommissionType === 'percentage' && finalCommissionValue > 100) {
        return errorResponse(res, 400, 'Validation Error', ['commissionValue must be <= 100 for percentage']);
      }

      if (finalCommissionType === 'fixed' && finalCommissionValue > effectivePrice) {
        return errorResponse(res, 400, 'Validation Error', ['commissionValue must be <= service price for fixed']);
      }

      const updated = await ServiceService.updateCommission(Number(id), {
        commissionType: finalCommissionType,
        commissionValue: finalCommissionValue,
        commissionEnabled
      });

      // Realtime updates (admin only) - best effort
      try {
        const io = getIO();
        const payload = {
          serviceId: updated?.id || Number(id) || null,
          commissionEnabled: updated?.commission_enabled === 0 ? false : true,
          commissionType: updated?.commission_type || finalCommissionType,
          commissionValue: Number(updated?.commission_value ?? finalCommissionValue ?? 0),
          updatedAt: updated?.updated_at || new Date().toISOString(),
        };

        io.to('admin-dashboard').emit(SOCKET_EVENTS.COMMISSION_UPDATED, payload);
        io.to('admin-dashboard').emit(SOCKET_EVENTS.ADMIN_ANALYTICS_UPDATED, {
          reason: 'commission_updated',
          updatedAt: payload.updatedAt,
        });
      } catch {
        // ignore socket errors
      }

      emitServiceUpdated({
        action: 'commission',
        id: updated?.id || Number(id) || null
      });

      return successResponse(res, 200, 'Commission updated', toPublicService(req, updated));
    } catch (err) {
      next(err);
    }
  }
}

module.exports = ServiceController;
