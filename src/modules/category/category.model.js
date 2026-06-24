const db = require('../../config/db');

class CategoryModel {
  static async ensureTable() {
    const createCategoriesTableQuery = `
      CREATE TABLE IF NOT EXISTS categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        image_path VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `;
    await db.query(createCategoriesTableQuery);
  }

  static async getAll() {
    const [rows] = await db.query(
      'SELECT id, name, image_path, created_at, updated_at FROM categories ORDER BY id DESC'
    );
    return rows;
  }

  static async getById(id) {
    const [rows] = await db.query(
      'SELECT id, name, image_path, created_at, updated_at FROM categories WHERE id = ?',
      [id]
    );
    return rows.length ? rows[0] : null;
  }

  static async create({ name, imagePath }) {
    const [result] = await db.query(
      'INSERT INTO categories (name, image_path) VALUES (?, ?)',
      [name, imagePath]
    );
    // Fetch and return the full row
    const [rows] = await db.query(
      'SELECT id, name, image_path, created_at, updated_at FROM categories WHERE id = ?',
      [result.insertId]
    );
    return rows[0];
  }

  static async update(id, { name, imagePath }) {
    if (typeof imagePath === 'string') {
      await db.query(
        'UPDATE categories SET name = ?, image_path = ? WHERE id = ?',
        [name, imagePath, id]
      );
    } else {
      await db.query(
        'UPDATE categories SET name = ? WHERE id = ?',
        [name, id]
      );
    }
    // Fetch and return the updated row
    const [rows] = await db.query(
      'SELECT id, name, image_path, created_at, updated_at FROM categories WHERE id = ?',
      [id]
    );
    return rows[0];
  }

  static async remove(id) {
    const [result] = await db.query('DELETE FROM categories WHERE id = ?', [id]);
    return result.affectedRows;
  }
}

module.exports = CategoryModel;
