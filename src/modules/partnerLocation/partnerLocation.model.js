const db = require('../../config/db');

class PartnerLocationModel {
  static async ensureTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS partner_locations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        partner_id INT NOT NULL UNIQUE,
        lat DECIMAL(10,7) NOT NULL,
        lng DECIMAL(10,7) NOT NULL,
        address TEXT DEFAULT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `;

    await db.query(query);

    // Forward-compatible migrations (ignore if already exists)
    try {
      await db.query('ALTER TABLE partner_locations ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    } catch (_) {
      // ignore
    }

    try {
      await db.query('ALTER TABLE partner_locations ADD COLUMN address TEXT DEFAULT NULL');
    } catch (_) {
      // ignore
    }

    try {
      await db.query('ALTER TABLE partner_locations ADD UNIQUE KEY uniq_partner_locations_partner_id (partner_id)');
    } catch (_) {
      // ignore
    }
  }
}

module.exports = PartnerLocationModel;
