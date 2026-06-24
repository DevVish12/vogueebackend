const PartnerLocationService = require('./partnerLocation.service');
const { errorResponse } = require('../../utils/response');

class PartnerLocationController {
  static async me(req, res, next) {
    try {
      const partnerIdRaw = req.partner?.id;
      const partnerId = Number(partnerIdRaw);
      if (!partnerId || Number.isNaN(partnerId)) {
        return errorResponse(res, 401, 'Not authorized, token failed');
      }

      const row = await PartnerLocationService.getMyLocation({ partnerId });
      return res.status(200).json({
        success: true,
        message: 'Location',
        data: {
          location: row
            ? {
                partner_id: row.partner_id,
                lat: Number(row.lat),
                lng: Number(row.lng),
                address: row.address,
                updated_at: row.updated_at,
              }
            : null,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  static async update(req, res, next) {
    try {
      const partnerIdRaw = req.partner?.id;
      const partnerId = Number(partnerIdRaw);
      if (!partnerId || Number.isNaN(partnerId)) {
        return errorResponse(res, 401, 'Not authorized, token failed');
      }

      const latRaw = req.body?.lat;
      const lngRaw = req.body?.lng;
      const addressRaw = req.body?.address;
      const lat = typeof latRaw === 'number' ? latRaw : Number(latRaw);
      const lng = typeof lngRaw === 'number' ? lngRaw : Number(lngRaw);
      const address = typeof addressRaw === 'string' ? addressRaw.trim() : null;

      const errors = [];
      if (!Number.isFinite(lat)) errors.push('lat is required');
      if (!Number.isFinite(lng)) errors.push('lng is required');
      if (Number.isFinite(lat) && (lat < -90 || lat > 90)) errors.push('lat must be between -90 and 90');
      if (Number.isFinite(lng) && (lng < -180 || lng > 180)) errors.push('lng must be between -180 and 180');
      if (address && address.length > 1000) errors.push('address is too long');

      if (errors.length) {
        return errorResponse(res, 400, 'Validation Error', errors);
      }

      await PartnerLocationService.upsertLocation({
        partnerId,
        lat,
        lng,
        address: address || null,
      });

      return res.status(200).json({
        success: true,
        message: 'Location updated',
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = PartnerLocationController;
