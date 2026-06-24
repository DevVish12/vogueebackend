const db = require('../../config/db');

class PartnerPaymentModel {
  static async ensureTable() {
    // UPI columns are created by PartnerAuthModel.ensureTable()
    // This method is kept for consistency with other modules
    try {
      const columnExists = async (columnName) => {
        const [rows] = await db.query(
          `
          SELECT 1 AS ok
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'partners'
            AND COLUMN_NAME = ?
          LIMIT 1
          `,
          [columnName]
        );
        return Array.isArray(rows) && rows.length > 0;
      };

      if (!(await columnExists('upi_id'))) {
        await db.query("ALTER TABLE partners ADD COLUMN upi_id VARCHAR(100) DEFAULT NULL");
      }

      if (!(await columnExists('upi_verified'))) {
        await db.query("ALTER TABLE partners ADD COLUMN upi_verified BOOLEAN DEFAULT false");
      }

      if (!(await columnExists('upi_verified_at'))) {
        await db.query("ALTER TABLE partners ADD COLUMN upi_verified_at DATETIME DEFAULT NULL");
      }

      console.log('✔ Partner UPI columns ensured');
    } catch (err) {
      console.error('❌ Error ensuring UPI columns:', err.message);
    }
  }

  static async findByPartnerId(partnerId, conn = db) {
    const [rows] = await conn.query(
      'SELECT id, upi_id, upi_verified, upi_verified_at FROM partners WHERE id = ? LIMIT 1',
      [partnerId]
    );
    return rows.length ? rows[0] : null;
  }

  static async saveUpi(partnerId, upiId, conn = db) {
    const [result] = await conn.query(
      `UPDATE partners 
       SET upi_id = ?, upi_verified = true, upi_verified_at = NOW()
       WHERE id = ?`,
      [upiId, partnerId]
    );
    return result.affectedRows > 0;
  }

  static async getPartnerName(partnerId, conn = db) {
    const [rows] = await conn.query(
      'SELECT id, name FROM partners WHERE id = ? LIMIT 1',
      [partnerId]
    );
    return rows.length ? rows[0] : null;
  }
}

module.exports = PartnerPaymentModel;
