const fs = require('fs/promises');
const path = require('path');
const BannerModel = require('./banner.model');
const { successResponse, errorResponse } = require('../../utils/response');
const { getIO } = require('../../../socket/socket');

const emitBannerUpdated = (payload) => {
  try {
    const io = getIO();
    const clientsCount = io?.engine?.clientsCount;

    // Debug log as requested
    // eslint-disable-next-line no-console
    console.log('BANNER EMIT', payload, typeof clientsCount === 'number' ? { clientsCount } : '');

    io.emit('bannerUpdated', payload);
  } catch {
    // socket not initialized (or disabled) - ignore
  }
};

const buildFileUrl = (req, relPath) => {
  if (!relPath) return null;
  return `${req.protocol}://${req.get('host')}/${String(relPath).replace(/\\/g, '/')}`;
};

const toPublicBanner = (req, row) => {
  if (!row) return row;
  return {
    id: row.id,
    imageUrl: buildFileUrl(req, row.image_url),
    imagePath: row.image_url,
    createdAt: row.created_at
  };
};

const safeUnlink = async (relativePath) => {
  if (!relativePath) return;
  const absolutePath = path.join(__dirname, '..', '..', '..', relativePath);
  try {
    await fs.unlink(absolutePath);
  } catch {
    // ignore
  }
};

class BannerController {
  static async uploadBanner(req, res, next) {
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) {
        return errorResponse(res, 400, 'No images uploaded');
      }

      const imagePaths = files.map((f) => `uploads/banners/${f.filename}`);
      const created = await BannerModel.createMany(imagePaths);

      emitBannerUpdated({
        action: 'add',
        ids: created.map((r) => r.id)
      });
      return successResponse(res, 201, 'Banner uploaded', created.map((r) => toPublicBanner(req, r)));
    } catch (err) {
      next(err);
    }
  }

  static async getAllBanners(req, res, next) {
    try {
      const rows = await BannerModel.getAll();
      res.set('Cache-Control', 'no-store');
      return successResponse(res, 200, 'Banners fetched', rows.map((r) => toPublicBanner(req, r)));
    } catch (err) {
      next(err);
    }
  }

  static async deleteBanner(req, res, next) {
    try {
      const { id } = req.params;
      const bannerId = Number(id);
      if (!Number.isFinite(bannerId) || bannerId <= 0) {
        return errorResponse(res, 400, 'Invalid banner id');
      }

      const existing = await BannerModel.getById(bannerId);
      if (!existing) {
        return errorResponse(res, 404, 'Banner not found');
      }

      await BannerModel.remove(bannerId);
      await safeUnlink(existing.image_url);

      emitBannerUpdated({
        action: 'delete',
        ids: [bannerId]
      });
      return successResponse(res, 200, 'Banner deleted');
    } catch (err) {
      next(err);
    }
  }
}

module.exports = BannerController;
