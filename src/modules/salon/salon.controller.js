const SalonService = require('./salon.service');

class SalonController {
  static async nearby(req, res, next) {
    try {
      const lat = req.query?.lat;
      const lng = req.query?.lng;

      if (lat == null || lng == null || String(lat).trim() === '' || String(lng).trim() === '') {
        return res.status(400).json({ success: false, message: 'lat and lng are required' });
      }

      const salons = await SalonService.getNearby({ lat, lng });
      return res.status(200).json({ success: true, data: salons });
    } catch (err) {
      next(err);
    }
  }

  static async getById(req, res, next) {
    try {
      const salonId = Number(req.params.id);
      if (!Number.isFinite(salonId) || salonId <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid salon id' });
      }

      const salon = await SalonService.getById(salonId, {
        lat: req.query?.lat,
        lng: req.query?.lng,
      });

      if (!salon) {
        return res.status(404).json({ success: false, message: 'Salon not found' });
      }

      return res.status(200).json({ success: true, data: salon });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = SalonController;