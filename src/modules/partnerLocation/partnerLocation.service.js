const pool = require('../../config/db');
const PartnerLocationModel = require('./partnerLocation.model');

class PartnerLocationService {
  static async upsertLocation({ partnerId, lat, lng, address }) {
    await PartnerLocationModel.ensureTable();

    const query = `
      INSERT INTO partner_locations (partner_id, lat, lng, address)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        lat = VALUES(lat),
        lng = VALUES(lng),
        address = VALUES(address),
        updated_at = CURRENT_TIMESTAMP
    `;

    const [result] = await pool.execute(query, [partnerId, lat, lng, address ?? null]);
    return result;
  }

  static async getMyLocation({ partnerId }) {
    await PartnerLocationModel.ensureTable();
    const [rows] = await pool.execute(
      'SELECT partner_id, lat, lng, address, updated_at FROM partner_locations WHERE partner_id = ? LIMIT 1',
      [partnerId]
    );
    return rows && rows.length ? rows[0] : null;
  }

  static async findNearbyPartners({ lat, lng, radiusKm = 30, limit = 500 }) {
    await PartnerLocationModel.ensureTable();

    const latitude = Number(lat);
    const longitude = Number(lng);
    const radius = Number(radiusKm);
    const safeLimit = Math.min(2000, Math.max(1, Number(limit) || 500));

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    if (!Number.isFinite(radius) || radius <= 0) return [];

    // Haversine distance in KM.
    const query = `
      SELECT
        partner_id,
        (
          6371 * ACOS(
            LEAST(
              1,
              GREATEST(
                -1,
                (
                  COS(RADIANS(?))
                  * COS(RADIANS(lat))
                  * COS(RADIANS(lng) - RADIANS(?))
                  + SIN(RADIANS(?)) * SIN(RADIANS(lat))
                )
              )
            )
          )
        ) AS distance_km
      FROM partner_locations
      HAVING distance_km <= ?
      ORDER BY distance_km ASC
      LIMIT ?
    `;

    const [rows] = await pool.execute(query, [latitude, longitude, latitude, radius, safeLimit]);
    return Array.isArray(rows) ? rows : [];
  }
}

module.exports = PartnerLocationService;
