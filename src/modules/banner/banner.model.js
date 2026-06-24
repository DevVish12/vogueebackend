const db = require('../../config/db');

class BannerModel {
  static async ensureTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS banners (
        id INT AUTO_INCREMENT PRIMARY KEY,
        image_url VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await db.query(query);
  }

  static async createMany(imageUrls) {
    const urls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
    if (urls.length === 0) return [];

    const values = urls.map((u) => [u]);
    const [result] = await db.query('INSERT INTO banners (image_url) VALUES ?', [values]);

    const firstId = result.insertId;
    const ids = Array.from({ length: result.affectedRows }, (_, i) => firstId + i);
    if (ids.length === 0) return [];

    const [rows] = await db.query(
      `SELECT id, image_url, created_at FROM banners WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id DESC`,
      ids
    );
    return rows;
  }

  static async getAll() {
    const [rows] = await db.query('SELECT id, image_url, created_at FROM banners ORDER BY id DESC');
    return rows;
  }

  static async getById(id) {
    const [rows] = await db.query('SELECT id, image_url, created_at FROM banners WHERE id = ? LIMIT 1', [id]);
    return rows.length ? rows[0] : null;
  }

  static async remove(id) {
    const [result] = await db.query('DELETE FROM banners WHERE id = ?', [id]);
    return result.affectedRows;
  }
}

module.exports = BannerModel;
